"""Dormant paid-delivery fencing and explicit operator recovery.

Enrollment is database-owner-only and restricted to isolated rehearsal data.
Neither off nor shadow enrolls cases or converts observations into holds.
"""

from datetime import datetime, timedelta, timezone
from functools import wraps
from typing import Any

from venfour.jurisdiction import Assertion, CaseFacts, load_packaged_registry
from venfour.jurisdiction_adapter import decide


class PaidDeliveryHeld(Exception):
    """Acknowledged delivery suspension, never a retryable processing failure."""


def require_paid_delivery(gateway: Any, reference: str, kind: str = "case", *, owner_user_id: str | None = None) -> None:
    check = getattr(gateway, "check_paid_delivery", None)
    if not callable(check):
        raise TypeError("Paid delivery requires an authoritative database fence")
    result = check(reference, kind, owner_user_id)
    if result not in {"unenrolled", "released", "financial_recovery"}:
        raise PaidDeliveryHeld("New fulfillment requires operator recovery")


def fenced_delivery(kind: str = "case", gateway_attr: str = "_database"):
    """Fence before claiming work, including direct processor entry points."""
    def decorate(method):
        @wraps(method)
        def run(self, reference, *args, **kwargs):
            require_paid_delivery(getattr(self, gateway_attr), reference, kind)
            return method(self, reference, *args, **kwargs)
        return run
    return decorate


class PaidDeliveryRecoveryService:
    def __init__(self, gateway, commerce, *, registry_loader=load_packaged_registry,
                 clock=lambda: datetime.now(timezone.utc)):
        self.gateway = gateway
        self.commerce = commerce
        self.registry_loader = registry_loader
        self.clock = clock

    def inspect(self, access_token: str, case_id: str | None = None, after_case_id: str | None = None):
        return self.gateway.inspect_paid_delivery(access_token, case_id, after_case_id)

    def resolve(self, case_id: str, action: str, request_id: str, access_token: str):
        if action not in {"release", "cancel_refund"}:
            raise ValueError("Unsupported paid-delivery recovery action")
        operator_id = self.gateway.authenticate(access_token)
        # Authorization precedes reading private facts or evaluating scope.
        self.gateway.inspect_paid_delivery(access_token, case_id)
        snapshot = None
        valid_until = None
        if action == "release":
            review_context = self.gateway.get_paid_delivery_review_context(case_id)
            context = review_context["context"]
            facts = CaseFacts.from_dict(context["facts"])
            if context.get("date_of_loss") is not None:
                facts = CaseFacts(facts.assertions + (Assertion(
                    "loss_date", context["date_of_loss"], "legacy_intake",
                    "total_loss_case_details.date_of_loss", context["intake_updated_at"],
                ),))
            now = self.clock()
            registry = self.registry_loader()
            snapshot = decide(case_id=case_id, facts=facts,
                facts_revision=context["revision"], boundary="checkout",
                registry=registry, evaluated_at=now, existing_eligible=True)
            payload = snapshot.to_dict()
            # Conditions remain empty until a reviewed, case-bound credential /
            # terms provider exists. Staff membership cannot satisfy them.
            payload["delivery_context"] = dict(context)
            payload["delivery_authority_revision"] = review_context["authority_revision"]
            from venfour.jurisdiction import digest
            self.gateway.record_jurisdiction_decision(payload, digest(payload))
            snapshot = payload["id"]
            deadlines = [now + timedelta(minutes=5),
                         (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)]
            for rule in registry.rules:
                for value in (rule.review_due_at, rule.revoked_at):
                    if value is not None:
                        when = datetime.fromisoformat(value.replace("Z", "+00:00"))
                        if when > now:
                            deadlines.append(when)
            valid_until = min(deadlines).isoformat()
        result = self.gateway.resolve_paid_delivery(case_id, operator_id, action,
                                                    request_id, snapshot, valid_until)
        if result.get("state") == "cancelled" and result.get("payment_transaction_id") is not None:
            # The transaction already cancelled new work and reserved this exact
            # refund. A provider failure leaves durable, explicitly retryable
            # operator recovery; it never reopens fulfillment.
            if not callable(getattr(self.commerce, "refund", None)):
                from venfour.supabase_gateway import SupabaseUnavailableError
                raise SupabaseUnavailableError("Refund recovery service is unavailable")
            refund = self.commerce.refund(case_id=case_id, order_id=result["order_id"],
                payment_transaction_id=result["payment_transaction_id"],
                client_request_id=result["refund_request_key"],
                reason_code="JURISDICTION_NONFULFILLMENT", access_policy="retain")
            return {**result, "refund_status": refund.refund_status}
        return result
