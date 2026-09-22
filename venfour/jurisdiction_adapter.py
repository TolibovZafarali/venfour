"""Non-activating jurisdiction observations at existing service boundaries."""

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
import logging
import os
from typing import Any, Mapping
from uuid import uuid4

from venfour.jurisdiction import (
    Assertion, Capability, CaseFacts, Registry, digest, evaluate,
    load_packaged_registry, resolve,
)


FLAG = "VENFOUR_JURISDICTION_MODE"
BOUNDARIES = {
    "preview_process": (Capability.PREVIEW, Capability.VALUATION),
    "checkout": (Capability.MARKET_REPORT, Capability.VALUATION, Capability.DRAFT, Capability.COACHING),
    "full_review_process": (Capability.MARKET_REPORT, Capability.VALUATION),
    "package_process": (Capability.MARKET_REPORT, Capability.VALUATION),
    "report_process": (Capability.MARKET_REPORT, Capability.VALUATION, Capability.DRAFT),
    "report_release": (Capability.MARKET_REPORT, Capability.VALUATION, Capability.DRAFT),
    "draft_process": (Capability.DRAFT,),
    "draft_release": (Capability.DRAFT,),
    "coaching_process": (Capability.COACHING,),
    "coaching_release": (Capability.COACHING,),
}
LOGGER = logging.getLogger(__name__)


def configured_mode(environment: Mapping[str, str]) -> str:
    mode = environment.get(FLAG, "off")
    if mode not in {"off", "shadow"}:
        raise ValueError(f"{FLAG} accepts only off or shadow in Phase 1")
    return mode


@dataclass(frozen=True)
class DecisionSnapshot:
    """Canonical serialized snapshot prevents mutation of nested decision data."""

    canonical_json: str
    content_digest: str

    def to_dict(self) -> dict[str, Any]:
        import json
        return json.loads(self.canonical_json)


def decide(*, case_id: str, facts: CaseFacts, facts_revision: int, boundary: str,
           registry: Registry, evaluated_at: datetime, existing_eligible: bool,
           verified_credentials: frozenset[str] = frozenset(),
           ready_terms: frozenset[str] = frozenset()) -> DecisionSnapshot:
    import json
    decisions = tuple(evaluate(facts, capability, registry, evaluated_at=evaluated_at,
                              existing_eligible=existing_eligible,
                              verified_credentials=verified_credentials,
                              ready_terms=ready_terms)
                      for capability in BOUNDARIES[boundary])
    value = {
        "schema_version": "1", "id": str(uuid4()), "case_id": case_id,
        "facts_revision": facts_revision, "facts": facts.to_dict(),
        "facts_digest": digest(facts.to_dict()), "resolution": asdict(resolve(facts)),
        "registry_version": registry.version, "registry_digest": registry.content_digest,
        "evaluated_at": evaluated_at.isoformat(), "boundary": boundary,
        "existing_eligible": existing_eligible,
        "decisions": [asdict(d) for d in decisions],
        "proposed_allowed": all(d.proposed_allowed for d in decisions),
        "verified_credentials": sorted(verified_credentials), "ready_terms": sorted(ready_terms),
    }
    return DecisionSnapshot(json.dumps(value, sort_keys=True, separators=(",", ":")), digest(value))


def observe_scope(gateway: Any, case_id: str, boundary: str, *, existing_eligible: bool = True, owner_user_id: str | None = None) -> DecisionSnapshot | None:
    """Observe only. Never intercept financial reconciliation or historical reads.

    Existing checks still run in their original order. Shadow failures are
    visible operational observations, not permission and not new live holds.
    """
    mode = configured_mode(os.environ)
    if boundary not in BOUNDARIES:
        raise ValueError("Unknown jurisdiction boundary")
    if mode == "off":
        return None

    try:
        context = (gateway.get_jurisdiction_context(case_id, owner_user_id)
                   if owner_user_id is not None else gateway.get_jurisdiction_context(case_id))
        if not isinstance(context, Mapping) or context.get("case_id") != case_id or type(context.get("revision")) is not int or context["revision"] < 0:
            raise ValueError("Invalid jurisdiction case context")
        facts = CaseFacts.from_dict(context["facts"])
        if context.get("date_of_loss") is not None:
            # Reuse the explicit intake loss date, never a ZIP-derived state.
            # Retain differing assertions so the resolver reports a conflict.
            facts = CaseFacts(facts.assertions + (Assertion(
                "loss_date", context["date_of_loss"], "legacy_intake",
                "total_loss_case_details.date_of_loss", context["intake_updated_at"],
            ),))
        snapshot = decide(case_id=case_id, facts=facts, facts_revision=context["revision"],
                          boundary=boundary, registry=load_packaged_registry(),
                          evaluated_at=datetime.now(timezone.utc), existing_eligible=existing_eligible)
        payload = snapshot.to_dict()
        LOGGER.warning("%s", json.dumps({"event": "jurisdiction_shadow_decision",
            "case_id": case_id, "boundary": boundary, "snapshot_id": payload["id"],
            "decision_digest": snapshot.content_digest,
            "proposed_allowed": payload["proposed_allowed"],
            "owner_review_required": existing_eligible and not payload["proposed_allowed"],
            "reasons": sorted({reason for d in payload["decisions"] for reason in d["reasons"]}),
        }, sort_keys=True))
        gateway.record_jurisdiction_decision(payload, snapshot.content_digest)
        return snapshot
    except Exception:
        # No fact values, uploaded content, credentials or exception text in logs.
        LOGGER.warning("%s", json.dumps({"event": "jurisdiction_shadow_unavailable",
            "case_id": case_id, "boundary": boundary, "owner_review_required": True,
        }, sort_keys=True))
        return None


def observe_reference_scope(gateway: Any, reference_id: str, reference_kind: str, boundary: str, *, access_token: str | None = None) -> DecisionSnapshot | None:
    """Resolve internal work/review identity only when shadow is requested."""
    if configured_mode(os.environ) == "off":
        return None
    try:
        if reference_kind == "release_review":
            if access_token is None:
                raise ValueError("Staff authorization required")
            packet = gateway.get_total_loss_release_review(reference_id, access_token)
            case_id = packet["case_id"] if isinstance(packet, Mapping) else None
        else:
            case_id = gateway.get_jurisdiction_reference_case(reference_id, reference_kind)
    except Exception:
        LOGGER.warning("jurisdiction_shadow_reference_unavailable")
        return None
    if not isinstance(case_id, str):
        LOGGER.warning("jurisdiction_shadow_reference_unavailable")
        return None
    return observe_scope(gateway, case_id, boundary)
