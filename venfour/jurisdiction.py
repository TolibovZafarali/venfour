"""Research inventory and conservative, capability-specific scope decisions.

This module does not determine applicable law. Only an explicitly reviewed scope
can match facts; the packaged registry contains no such approvals.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from datetime import date, datetime, timezone
from enum import Enum
import hashlib
import json
from pathlib import Path
from typing import Any, Mapping


DATA = Path(__file__).parent / "data"
US_JURISDICTIONS = frozenset("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split())
TERRITORIES = frozenset({"AS", "GU", "MP", "PR", "VI", "UM"})


class Capability(str, Enum):
    PREVIEW = "case_specific_preview"
    MARKET_REPORT = "market_evidence_report"
    VALUATION = "personalized_valuation"
    DRAFT = "customer_reconsideration_draft"
    COACHING = "insurer_response_coaching"
    NEGOTIATION = "insurer_contact_negotiation"
    APPRAISAL = "formal_appraisal_clause"
    EXPERT = "umpire_expert_role"
    REFERRAL_MARKETING = "referral_marketing"
    REFERRAL_COMPENSATION = "referral_compensation"


OUT_OF_SCOPE = frozenset({Capability.NEGOTIATION, Capability.APPRAISAL, Capability.EXPERT})
LOCATION_FIELDS = frozenset({
    "customer_residence", "garaging_at_loss", "vehicle_registration",
    "policy_issued", "policy_delivered", "loss_location", "provider_location",
})
DATE_FIELDS = frozenset({"loss_date", "policy_start", "policy_end", "settlement_date"})
FACT_FIELDS = LOCATION_FIELDS | DATE_FIELDS | {"claim_type", "policy_use", "provider_role", "assigned_credential_ref"}
FACT_CHOICES = {
    "claim_type": {"first_party", "third_party"},
    "policy_use": {"personal", "commercial"},
    "provider_role": {"valuation_service", "licensed_adjuster", "appraiser", "umpire", "expert", "referral_partner"},
}


def _text(value: Any) -> str:
    if not isinstance(value, str) or not value.strip() or value != value.strip() or len(value) > 512 or any(ord(c) < 32 for c in value):
        raise ValueError("Expected bounded non-empty text")
    return value


def _date(value: str) -> date:
    parsed = date.fromisoformat(value)
    if parsed.isoformat() != value:
        raise ValueError("Expected ISO date")
    return parsed


def _instant(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Expected timezone-aware timestamp")
    return parsed


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


@dataclass(frozen=True)
class Assertion:
    field: str
    value: str | None
    provenance: str
    reference: str
    recorded_at: str

    def __post_init__(self) -> None:
        if self.field not in FACT_FIELDS or self.provenance not in {"customer", "document", "staff", "legacy_intake"}:
            raise ValueError("Unknown fact field or provenance")
        _text(self.reference)
        _instant(self.recorded_at)
        if self.value is not None:
            _text(self.value)
            if self.field in DATE_FIELDS:
                _date(self.value)
            if self.field in FACT_CHOICES and self.value not in FACT_CHOICES[self.field]:
                raise ValueError("Invalid fact choice")


@dataclass(frozen=True)
class CaseFacts:
    assertions: tuple[Assertion, ...] = ()
    schema_version: str = "1"

    def __post_init__(self) -> None:
        if self.schema_version != "1" or not isinstance(self.assertions, tuple) or len(self.assertions) > 128 or any(not isinstance(a, Assertion) for a in self.assertions):
            raise ValueError("Invalid jurisdiction facts")

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> CaseFacts:
        if not isinstance(value, Mapping) or set(value) != {"schema_version", "assertions"} or not isinstance(value["assertions"], list):
            raise ValueError("Invalid jurisdiction facts envelope")
        return cls(tuple(Assertion(**row) for row in value["assertions"]), value["schema_version"])

    def to_dict(self) -> dict[str, Any]:
        return {"schema_version": self.schema_version, "assertions": [asdict(a) for a in self.assertions]}

    def values(self, field: str) -> tuple[str, ...]:
        return tuple(sorted({a.value for a in self.assertions if a.field == field and a.value is not None}))

    def known(self, field: str) -> str | None:
        values = self.values(field)
        return values[0] if len(values) == 1 else None


@dataclass(frozen=True)
class Resolution:
    candidates: tuple[str, ...]
    missing_facts: tuple[str, ...]
    conflicting_facts: tuple[str, ...]
    review_reasons: tuple[str, ...]


def resolve(facts: CaseFacts) -> Resolution:
    candidates, reasons = set(), set()
    for field in LOCATION_FIELDS:
        for value in facts.values(field):
            if value.startswith("US-") and value[3:] in US_JURISDICTIONS:
                candidates.add(value[3:])
            elif value.startswith("US-") and value[3:] in TERRITORIES:
                reasons.add("UNSUPPORTED_TERRITORY")
            elif len(value) >= 4 and value[2] == "-" and value[:2].isascii() and value[:2].isalpha() and value[:2].isupper() and value[:2] != "US":
                reasons.add("UNSUPPORTED_COUNTRY")
            else:
                reasons.add("UNKNOWN_LOCATION_CODE")
    missing = tuple(sorted(field for field in FACT_FIELDS if not facts.values(field)))
    conflicts = tuple(sorted(field for field in FACT_FIELDS if len(facts.values(field)) > 1))
    if conflicts:
        reasons.add("CONFLICTING_FACTS")
    if not candidates:
        reasons.add("JURISDICTION_UNKNOWN")
    if len(candidates) > 1:
        reasons.add("MULTIPLE_JURISDICTIONS_REQUIRE_REVIEWED_SCOPE")
    start, end = facts.known("policy_start"), facts.known("policy_end")
    if start and end and _date(start) > _date(end):
        reasons.add("INVALID_POLICY_PERIOD")
    return Resolution(tuple(sorted(candidates)), missing, conflicts, tuple(sorted(reasons)))


@dataclass(frozen=True)
class Source:
    id: str
    jurisdiction: str
    title: str
    url: str
    authority_type: str
    locator: str
    accessed_on: str
    limitations: str
    document_version: str | None = None
    document_digest: str | None = None
    effective_from: str | None = None
    effective_until: str | None = None


@dataclass(frozen=True)
class ResearchObservation:
    jurisdiction_code: str
    jurisdiction_name: str
    research_status: str
    scope_question: str
    source_ids: tuple[str, ...]
    unresolved_workstreams: tuple[str, ...]


@dataclass(frozen=True)
class ResearchInventory:
    schema_version: str
    sources: tuple[Source, ...]
    observations: tuple[ResearchObservation, ...]
    content_digest: str

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> ResearchInventory:
        if raw.get("schema_version") != "0.1-research-only" or raw.get("production_activation_permitted") is not False or raw.get("approved_rules") != []:
            raise ValueError("Research cannot contain operational permissions")
        if raw.get("coverage", {}).get("legal_clearances") != 0 or raw.get("coverage", {}).get("launch_approvals") != 0:
            raise ValueError("Research cannot claim approvals")
        sources = tuple(Source(**s) for s in raw["sources"])
        source_ids = {s.id for s in sources}
        if len(sources) != 67 or len(source_ids) != len(sources):
            raise ValueError("Invalid research source inventory")
        for source in sources:
            if not source.url.startswith("https://") or not source.locator or not source.authority_type:
                raise ValueError("Invalid research source")
            _date(source.accessed_on)
        if len(raw["jurisdictions"]) != 51 or {r["jurisdiction_code"] for r in raw["jurisdictions"]} != US_JURISDICTIONS:
            raise ValueError("Expected exactly 51 unique jurisdiction records")
        if {c["id"] for c in raw["capability_catalog"]} != {c.value for c in Capability} or len(raw["capability_catalog"]) != len(Capability):
            raise ValueError("Invalid capability catalog")
        observations = []
        for row in raw["jurisdictions"]:
            if row["launch_approval"] is not None or set(row["capability_reviews"]) != {c.value for c in Capability}:
                raise ValueError("Research cannot approve launch")
            if any(r != {"review_status": "not_determined", "approved_rule_id": None, "approval_evidence": None} for r in row["capability_reviews"].values()):
                raise ValueError("Research cannot approve a capability")
            if not set(row["source_ids"]).issubset(source_ids):
                raise ValueError("Unknown research source")
            observations.append(ResearchObservation(row["jurisdiction_code"], row["jurisdiction_name"], row["research_status"], row["scope_question"], tuple(row["source_ids"]), tuple(row["unresolved_workstreams"])))
        return cls(raw["schema_version"], sources, tuple(observations), digest(raw))


@dataclass(frozen=True)
class Applicability:
    id: str
    version: int
    capability: Capability
    candidate_jurisdictions: tuple[str, ...]
    claim_type: str
    policy_use: str
    provider_role: str
    required_facts: tuple[str, ...]
    date_anchor: str
    review_evidence: str
    reviewed_by: str
    reviewed_at: str
    source_ids: tuple[str, ...]
    assumptions: tuple[str, ...]


@dataclass(frozen=True)
class OperationalRule:
    id: str
    version: int
    applicability_id: str
    applicability_version: int
    determination: str
    effective_from: str
    effective_until: str | None
    approved_by: str
    approved_at: str
    approval_evidence: str
    review_due_at: str
    revoked_at: str | None
    required_credential_refs: tuple[str, ...]
    required_terms: tuple[str, ...]
    limitations: tuple[str, ...]


@dataclass(frozen=True)
class Registry:
    version: str
    interpretations: tuple[Applicability, ...]
    rules: tuple[OperationalRule, ...]
    content_digest: str

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any], *, authorized_reviewers: frozenset[str], source_ids: frozenset[str]) -> Registry:
        if set(raw) != {"schema_version", "version", "interpretations", "rules"} or raw["schema_version"] != "1":
            raise ValueError("Invalid operational registry")
        _text(raw["version"])
        interpretations = []
        for value in raw["interpretations"]:
            row = dict(value)
            row["capability"] = Capability(row["capability"])
            for field in ("candidate_jurisdictions", "required_facts", "source_ids", "assumptions"):
                if not isinstance(row[field], list) or any(not isinstance(v, str) for v in row[field]):
                    raise ValueError("Expected scope array")
                row[field] = tuple(row[field])
            item = Applicability(**row)
            if type(item.version) is not int or item.version < 1 or item.reviewed_by not in authorized_reviewers:
                raise ValueError("Applicability requires an authorized reviewer")
            _text(item.id)
            _text(item.review_evidence)
            _instant(item.reviewed_at)
            if not item.source_ids or not set(item.source_ids).issubset(source_ids):
                raise ValueError("Applicability requires referenced sources")
            if not item.candidate_jurisdictions or not set(item.candidate_jurisdictions).issubset(US_JURISDICTIONS) or len(set(item.candidate_jurisdictions)) != len(item.candidate_jurisdictions):
                raise ValueError("Invalid reviewed jurisdiction scope")
            if not set(item.required_facts).issubset(FACT_FIELDS) or item.date_anchor not in DATE_FIELDS | {"service_date", "unresolved"}:
                raise ValueError("Invalid applicability facts/date anchor")
            for field in ("claim_type", "policy_use", "provider_role"):
                if getattr(item, field) not in FACT_CHOICES[field]:
                    raise ValueError("Invalid applicability role or claim scope")
            interpretations.append(item)
        identities = {(i.id, i.version) for i in interpretations}
        if len(identities) != len(interpretations):
            raise ValueError("Duplicate applicability version")
        rules = []
        for value in raw["rules"]:
            row = dict(value)
            for field in ("required_credential_refs", "required_terms", "limitations"):
                if not isinstance(row[field], list):
                    raise ValueError("Expected requirements array")
                row[field] = tuple(_text(v) for v in row[field])
            item = OperationalRule(**row)
            if type(item.version) is not int or item.version < 1 or type(item.applicability_version) is not int or (item.applicability_id, item.applicability_version) not in identities:
                raise ValueError("Unknown applicability version")
            if item.approved_by not in authorized_reviewers:
                raise ValueError("Operational approval requires an authorized reviewer")
            _text(item.id)
            _text(item.approval_evidence)
            approved_at = _instant(item.approved_at)
            interpretation = next(i for i in interpretations if (i.id, i.version) == (item.applicability_id, item.applicability_version))
            if approved_at < _instant(interpretation.reviewed_at) or _instant(item.review_due_at) <= approved_at:
                raise ValueError("Invalid approval/review interval")
            if item.revoked_at is not None and _instant(item.revoked_at) < approved_at:
                raise ValueError("Invalid revocation date")
            if item.determination not in {"unresolved", "not_applicable", "permitted", "limited", "prohibited"}:
                raise ValueError("Invalid operational determination")
            start = _date(item.effective_from)
            if item.effective_until is not None and _date(item.effective_until) <= start:
                raise ValueError("Invalid effective interval")
            if item.determination == "limited" and not (item.limitations or item.required_terms or item.required_credential_refs):
                raise ValueError("Limited permission requires explicit conditions")
            rules.append(item)
        if len({(r.id, r.version) for r in rules}) != len(rules):
            raise ValueError("Duplicate operational rule version")
        return cls(raw["version"], tuple(interpretations), tuple(rules), digest(raw))


def load_packaged_registry() -> Registry:
    # No runtime/upload/research write path. Reviewer authority is separately
    # maintained through the repository's restricted release review process.
    research = ResearchInventory.from_dict(json.loads((DATA / "jurisdiction_research_seed.json").read_text()))
    reviewers = json.loads((DATA / "jurisdiction_reviewers.json").read_text())
    if set(reviewers) != {"schema_version", "authorized_reviewers"} or reviewers["schema_version"] != "1":
        raise ValueError("Invalid reviewer authority manifest")
    authority = reviewers["authorized_reviewers"]
    if not isinstance(authority, list) or any(not isinstance(v, str) for v in authority) or len(set(authority)) != len(authority):
        raise ValueError("Invalid reviewer identities")
    for reviewer in authority:
        _text(reviewer)
    raw = json.loads((DATA / "jurisdiction_registry.json").read_text())
    registry = Registry.from_dict(raw, authorized_reviewers=frozenset(authority), source_ids=frozenset(s.id for s in research.sources))
    return replace(registry, content_digest=digest({
        "registry": raw, "reviewer_authority": reviewers, "research_digest": research.content_digest,
    }))


@dataclass(frozen=True)
class CapabilityDecision:
    capability: str
    determination: str
    proposed_allowed: bool
    reasons: tuple[str, ...]
    rule_versions: tuple[str, ...]


def evaluate(facts: CaseFacts, capability: Capability, registry: Registry, *, evaluated_at: datetime, existing_eligible: bool, verified_credentials: frozenset[str] = frozenset(), ready_terms: frozenset[str] = frozenset()) -> CapabilityDecision:
    if not isinstance(capability, Capability) or type(existing_eligible) is not bool or evaluated_at.tzinfo is None:
        raise ValueError("Invalid decision context")
    resolution = resolve(facts)
    reasons = set(resolution.review_reasons) - {"MULTIPLE_JURISDICTIONS_REQUIRE_REVIEWED_SCOPE"}
    if not existing_eligible:
        reasons.add("EXISTING_ELIGIBILITY_REFUSED")
    if capability in OUT_OF_SCOPE:
        reasons.add("OUT_OF_EXPANSION_SCOPE")
    for field in ("claim_type", "policy_use", "provider_role"):
        if facts.known(field) is None:
            reasons.add("MISSING_" + field.upper())
    applicable = []
    for scope in registry.interpretations:
        if scope.capability != capability or set(scope.candidate_jurisdictions) != set(resolution.candidates):
            continue
        if any(facts.known(field) != getattr(scope, field) for field in ("claim_type", "policy_use", "provider_role")):
            continue
        for rule in registry.rules:
            if (rule.applicability_id, rule.applicability_version) != (scope.id, scope.version):
                continue
            if scope.date_anchor == "unresolved":
                reasons.add("UNRESOLVED_DATE_ANCHOR")
                continue
            anchor = evaluated_at.astimezone(timezone.utc).date().isoformat() if scope.date_anchor == "service_date" else facts.known(scope.date_anchor)
            if anchor is None:
                reasons.add("MISSING_DATE_ANCHOR")
                continue
            if _date(anchor) < _date(rule.effective_from) or (rule.effective_until and _date(anchor) >= _date(rule.effective_until)):
                continue
            if evaluated_at < _instant(rule.approved_at) or evaluated_at >= _instant(rule.review_due_at) or (rule.revoked_at and evaluated_at >= _instant(rule.revoked_at)):
                continue
            applicable.append(rule)
            if scope.assumptions:
                reasons.add("APPLICABILITY_ASSUMPTIONS_REQUIRE_IMPLEMENTATION_REVIEW")
            if any(facts.known(field) is None for field in scope.required_facts):
                reasons.add("MISSING_REQUIRED_FACTS")
            if not set(rule.required_credential_refs).issubset(verified_credentials):
                reasons.add("CREDENTIALS_NOT_VERIFIED")
            if rule.limitations:
                reasons.add("LIMITATIONS_REQUIRE_IMPLEMENTATION_REVIEW")
            if not set(rule.required_terms).issubset(ready_terms):
                reasons.add("TERMS_NOT_READY")
    if not applicable:
        reasons.add("MISSING_CURRENT_APPROVAL")
        if len(resolution.candidates) > 1:
            reasons.add("MULTIPLE_JURISDICTIONS_REQUIRE_REVIEWED_SCOPE")
    if len(applicable) > 1:
        reasons.add("OVERLAPPING_OPERATIONAL_RULES")
    determination = applicable[0].determination if len(applicable) == 1 else "unresolved"
    if determination not in {"permitted", "limited"}:
        reasons.add("SCOPE_" + determination.upper())
    return CapabilityDecision(capability.value, determination, not reasons, tuple(sorted(reasons)), tuple(sorted(f"{r.id}@{r.version}" for r in applicable)))
