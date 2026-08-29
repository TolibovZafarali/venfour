"""Private preview-email delivery and enumeration-safe result recovery."""

from __future__ import annotations

import logging
from typing import Any, Mapping, Protocol, runtime_checkable
from uuid import uuid4

from venfour.case_claim_access import (
    CaseClaimRecoveryConfiguration,
    TurnstileRejectedError,
    TurnstileVerifier,
    _canonical_uuid,
    _validated_turnstile_token,
    normalize_recovery_email,
)
from venfour.supabase_gateway import SupabaseContractError


logger = logging.getLogger(__name__)


@runtime_checkable
class PreviewAccessGateway(Protocol):
    def request_total_loss_preview_recovery(
        self, case_id: str | None, email: str,
        requester_fingerprint: str, target_fingerprint: str,
    ) -> None: ...

    def reserve_total_loss_preview_email(
        self, lease_token: str, case_id: str | None,
    ) -> Mapping[str, Any] | None: ...

    def finish_total_loss_preview_email(
        self, email_id: str, lease_token: str, delivered: bool,
    ) -> bool: ...

    def send_total_loss_preview_magic_link(
        self, email: str, case_id: str, claim_id: str,
        public_app_origin: str, kind: str,
    ) -> None: ...


class PreviewAccessService:
    def __init__(
        self, gateway: PreviewAccessGateway, *,
        configuration: CaseClaimRecoveryConfiguration,
        turnstile_verifier: TurnstileVerifier,
    ) -> None:
        if not isinstance(gateway, PreviewAccessGateway):
            raise TypeError("gateway must implement PreviewAccessGateway")
        self._gateway = gateway
        self._configuration = configuration
        self._verifier = turnstile_verifier

    def recover(
        self, case_id: str | None, email: str, turnstile_token: str,
        requester_identity: str,
    ) -> None:
        selected_case_id = _canonical_uuid(case_id, "Case ID") if case_id else None
        selected_email = normalize_recovery_email(email)
        token = _validated_turnstile_token(turnstile_token)
        if not self._verifier.verify(token):
            raise TurnstileRejectedError("Security check was rejected")
        configuration = self._configuration
        try:
            # Matching and sending happen behind the service-role boundary.
            # Unknown addresses and temporary failures have the same response.
            self._gateway.request_total_loss_preview_recovery(
                selected_case_id, selected_email,
                configuration.fingerprint("requester", requester_identity or "unknown"),
                configuration.fingerprint("target", f"preview:{selected_email}"),
            )
        except Exception:
            logger.warning("Preview recovery enqueue was deferred")

    def dispatch(self, case_id: str | None = None, *, limit: int = 3) -> dict[str, int]:
        if case_id is not None:
            case_id = _canonical_uuid(case_id, "Case ID")
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 3:
            raise ValueError("Delivery batch size is invalid")
        counts = {"sent": 0, "deferred": 0}
        for _ in range(limit):
            lease_token = str(uuid4())
            try:
                row = self._gateway.reserve_total_loss_preview_email(lease_token, case_id)
                if row is None:
                    break
                email_id = _canonical_uuid(row.get("email_id"), "Email ID")
                owned_case_id = _canonical_uuid(row.get("case_id"), "Case ID")
                claim_id = _canonical_uuid(row.get("claim_id"), "Claim ID")
                email = normalize_recovery_email(row.get("recipient_email"))
                kind = row.get("kind")
                if kind not in {"ready", "recovery"} or (
                    case_id is not None and owned_case_id != case_id
                ):
                    raise SupabaseContractError("Preview email reservation is invalid")
            except Exception:
                counts["deferred"] += 1
                logger.warning("Preview email reservation was deferred")
                break

            delivered = False
            try:
                self._gateway.send_total_loss_preview_magic_link(
                    email, owned_case_id, claim_id,
                    self._configuration.public_app_origin, kind,
                )
                delivered = True
            except Exception:
                logger.warning("Preview email delivery was deferred")
            try:
                recorded = self._gateway.finish_total_loss_preview_email(
                    email_id, lease_token, delivered,
                )
            except Exception:
                recorded = False
                logger.warning("Preview email acknowledgement was deferred")
            counts["sent" if delivered and recorded else "deferred"] += 1
        return counts
