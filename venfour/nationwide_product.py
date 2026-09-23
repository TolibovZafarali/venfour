"""Versioned product presentation and method selection, never operating permission."""

from dataclasses import asdict, dataclass, replace
from datetime import date
from functools import lru_cache
import json
import os
from pathlib import Path
from typing import Any, Literal, Mapping, TypedDict

from venfour.jurisdiction import CaseFacts, US_JURISDICTIONS, digest, resolve

REPORT_LABEL = "Total-Loss Valuation Report"
PRODUCT_VERSION = "2026-09-22.1"
PRODUCT_FIELDS = ("vehicle_registration", "garaging_at_loss", "loss_location", "claim_type", "policy_use", "policy_issued")
SETTLEMENT_COMPONENTS = ("sales_tax", "title", "registration_transfer", "replacement_credit")
DISABLED_CAPABILITIES = (
    "direct_insurer_communication", "direct_insurer_negotiation", "formal_appraisal_clause",
    "umpire_role", "claim_right_assignment", "settlement_proceeds_assignment",
)
IMPLEMENTED_CAPABILITIES = (
    "market_evidence_report", "personalized_valuation_comparison",
    "customer_submitted_reconsideration_draft", "response_analysis_coaching",
)


class ProductPresentation(TypedDict):
    report_label: str
    appraisal_label_allowed: bool
    notes: list[str]


class ProductValuation(TypedDict):
    method: Literal["generic_product_method"]
    strategy: Literal["adaptive_local_first"]
    state_overrides: list[str]
    adjustments: Literal["existing_deterministic_method_only"]
    required_inclusions: list[str] | None
    required_exclusions: list[str] | None


class SettlementTreatment(TypedDict):
    status: Literal["unresolved_state_specific_component", "verified_state_override"]
    treatment: str | None
    included_in_vehicle_value: Literal[False]


class ProductWorkflow(TypedDict):
    information: list[str]
    disclosures: list[str] | None
    review_conditions: list[str]
    unsupported_capabilities: list[str]
    implemented_capabilities: list[str]


class ProductProvenance(TypedDict):
    source_id: str
    url: str
    reference: str
    status: Literal["research_only", "verified"]
    effective_from: str | None
    effective_until: str | None
    verified_on: str | None


def enabled() -> bool:
    return os.environ.get("VENFOUR_NATIONWIDE_PRODUCT", "false") == "true"


@dataclass(frozen=True)
class ProductConfiguration:
    code: str
    name: str
    status: str
    presentation: ProductPresentation
    valuation: ProductValuation
    settlement: Mapping[str, SettlementTreatment]
    workflow: ProductWorkflow
    provenance: tuple[ProductProvenance, ...]

    def to_dict(self):
        return asdict(self)


@lru_cache(maxsize=1)
def _inventory_json() -> str:
    raw = json.loads(Path(__file__).with_name("data").joinpath("nationwide_product_v1.json").read_text())
    rows = raw["jurisdictions"]
    if raw["version"] != PRODUCT_VERSION or raw["schema_version"] != "1" or len(rows) != 51 or {r["code"] for r in rows} != US_JURISDICTIONS:
        raise ValueError("Incomplete product inventory")
    for row in rows:
        if row["presentation"]["appraisal_label_allowed"] or row["presentation"]["report_label"] != REPORT_LABEL:
            raise ValueError("Appraisal terminology has no reviewed configuration")
        if row["valuation"]["state_overrides"] or row["status"] != "PRODUCT_READY_WITH_GENERIC_RULES":
            raise ValueError("This product version contains no verified overrides")
        if set(row["workflow"]["unsupported_capabilities"]) != set(DISABLED_CAPABILITIES):
            raise ValueError("Disabled capability changed")
        if set(row["workflow"]["implemented_capabilities"]) != set(IMPLEMENTED_CAPABILITIES):
            raise ValueError("Implemented capability changed")
        if row["valuation"] != {"method": "generic_product_method", "strategy": "adaptive_local_first",
                                "state_overrides": [], "adjustments": "existing_deterministic_method_only",
                                "required_inclusions": None, "required_exclusions": None}:
            raise ValueError("Unverified valuation treatment")
        if set(row["settlement"]) != set(SETTLEMENT_COMPONENTS) or row["workflow"]["disclosures"] is not None:
            raise ValueError("Incomplete or unverified settlement/disclosure configuration")
        if any(p["status"] != "research_only" or any(p[k] is not None for k in ("effective_from", "effective_until", "verified_on")) for p in row["provenance"]):
            raise ValueError("This product version has no verified state provenance")
        for component in row["settlement"].values():
            if component != {"status": "unresolved_state_specific_component", "treatment": None, "included_in_vehicle_value": False}:
                raise ValueError("Unverified settlement treatment")
    return json.dumps(raw, sort_keys=True)


def configurations() -> dict[str, ProductConfiguration]:
    # Return independent values; callers cannot mutate the cached registry.
    return {row["code"]: ProductConfiguration(**{**row, "provenance": tuple(row["provenance"])})
            for row in json.loads(_inventory_json())["jurisdictions"]}


@dataclass(frozen=True)
class VerifiedOverride:
    """Narrow product interpretation. Synthetic fixtures do not publish authority."""
    id: str
    jurisdiction: str
    claim_type: str
    policy_use: str
    effective_from: str
    effective_until: str
    verified_on: str
    source_url: str
    source_reference: str
    reviewed_reference: str
    max_distance_miles: int | None = None
    settlement_component: str | None = None
    settlement_note: str | None = None

    def __post_init__(self):
        if (self.jurisdiction not in US_JURISDICTIONS or self.claim_type not in {"first_party", "third_party"}
                or self.policy_use not in {"personal", "commercial"} or not self.id
                or not self.source_url.startswith("https://") or not self.source_reference or not self.reviewed_reference
                or date.fromisoformat(self.effective_from) >= date.fromisoformat(self.effective_until)):
            raise ValueError("Invalid verified product override")
        date.fromisoformat(self.verified_on)
        if self.max_distance_miles is not None and (type(self.max_distance_miles) is not int or not 1 <= self.max_distance_miles <= 250):
            raise ValueError("Override must narrow the existing search boundary")
        if (self.settlement_component is None) != (self.settlement_note is None) or (self.settlement_component is not None and self.settlement_component not in SETTLEMENT_COMPONENTS):
            raise ValueError("Invalid separate settlement component")


def applicable_overrides(facts: CaseFacts, loss_date: str | None, as_of: str, overrides: tuple[VerifiedOverride, ...] = ()):
    resolution = resolve(facts)
    if not loss_date or resolution.review_reasons or any(not facts.known(f) for f in PRODUCT_FIELDS):
        return ()
    if facts.values("loss_date") and facts.values("loss_date") != (loss_date,):
        return ()
    loss, current = date.fromisoformat(loss_date), date.fromisoformat(as_of)
    matches = tuple(rule for rule in overrides if resolution.candidates == (rule.jurisdiction,)
                    and facts.known("claim_type") == rule.claim_type and facts.known("policy_use") == rule.policy_use
                    and date.fromisoformat(rule.effective_from) <= loss < date.fromisoformat(rule.effective_until)
                    and date.fromisoformat(rule.verified_on) <= current)
    keys = [key for r in matches for key in
            (["distance"] if r.max_distance_miles is not None else []) +
            ([r.settlement_component] if r.settlement_component is not None else [])]
    if len(keys) != len(set(keys)):
        raise ValueError("Conflicting product overrides require review")
    return matches


def apply_search_overrides(policy, rules: tuple[VerifiedOverride, ...]):
    """Only narrow existing limits; never change budgets, ranking, or target prices."""
    boundaries = [r.max_distance_miles for r in rules if r.max_distance_miles is not None]
    return replace(policy, case_maximum_distance_miles=min(policy.boundary, *boundaries)) if boundaries else policy


def product_context(context: Mapping[str, Any], *, as_of: str, overrides: tuple[VerifiedOverride, ...] = ()) -> dict[str, Any]:
    date.fromisoformat(as_of)
    if type(context.get("revision", 0)) is not int or context.get("revision", 0) < 0:
        raise ValueError("Invalid fact revision")
    facts = CaseFacts.from_dict(context.get("facts") or CaseFacts().to_dict())
    resolution = resolve(facts)
    inventory = configurations()
    missing = [field for field in PRODUCT_FIELDS if not facts.known(field)]
    reasons = list(resolution.review_reasons)
    if facts.known("policy_use") == "commercial":
        reasons.append("COMMERCIAL_USE_REQUIRES_REVIEW")
    if missing:
        reasons.append("INCOMPLETE_PRODUCT_FACTS")
    loss_date = context.get("date_of_loss")
    if loss_date is not None:
        date.fromisoformat(loss_date)
    rules = applicable_overrides(facts, loss_date, as_of, overrides)
    components = [{"component": name, "status": "unresolved_state_specific_component", "note": None,
                   "amount_minor": None, "included_in_vehicle_value": False, "source": None} for name in SETTLEMENT_COMPONENTS]
    for rule in rules:
        if rule.settlement_component:
            component = next(c for c in components if c["component"] == rule.settlement_component)
            component.update(status="verified_state_override", note=rule.settlement_note, source=asdict(rule))
    unsupported = any(r.startswith("UNSUPPORTED_") or r == "UNKNOWN_LOCATION_CODE" for r in reasons)
    return {
        "schema_version": "1", "product_version": PRODUCT_VERSION, "as_of": as_of,
        "case_id": context["case_id"], "facts_revision": context.get("revision", 0), "facts": facts.to_dict(),
        "loss_date": loss_date, "candidates": list(resolution.candidates), "conflicts": list(resolution.conflicting_facts),
        "missing_facts": missing, "review_reasons": sorted(set(reasons)),
        "status": "PRODUCT_UNSUPPORTED" if unsupported else "PRODUCT_REVIEW_REQUIRED" if reasons else "PRODUCT_READY_WITH_STATE_OVERRIDES" if rules else "PRODUCT_READY_WITH_GENERIC_RULES",
        "report_label": REPORT_LABEL, "appraisal_label_allowed": False,
        "method": "verified_state_override" if any(r.max_distance_miles is not None for r in rules) else "generic_product_method",
        "generic_method_available": not unsupported, "applied_overrides": [asdict(r) for r in rules],
        "configurations": [inventory[code].to_dict() for code in resolution.candidates],
        "settlement_components": components, "settlement_total_minor": None,
        "disabled_capabilities": list(DISABLED_CAPABILITIES),
        "authority": "not_determined_by_product_configuration",
    }


def validate_frozen_context(value: Mapping[str, Any]) -> None:
    if value.get("product_version") != PRODUCT_VERSION:
        raise ValueError("Unknown frozen product version")
    # This version ships zero overrides. Future registry versions need their own replay validator.
    expected = product_context({"case_id": value["case_id"], "revision": value["facts_revision"],
                                "facts": value["facts"], "date_of_loss": value["loss_date"]}, as_of=value["as_of"])
    if digest(value) != digest(expected):
        raise ValueError("Frozen product context does not match its versioned inputs")
