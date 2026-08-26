"""Secure Total-Loss case-claim and recovery application boundaries.

The database remains authoritative for case eligibility, ownership, claim
issuance, and transfer.  This module validates the bounded database projection,
verifies public recovery challenges, and delegates email delivery to Supabase
Auth without exposing claim-match state to a public caller.
"""

from __future__ import annotations

import hashlib
import hmac
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Mapping, Protocol, runtime_checkable
from urllib.parse import urlsplit
from uuid import UUID

import httpx

from venfour.supabase_gateway import (
    SupabaseContractError,
)


CLAIM_RECOVERY_TURNSTILE_ACTION = "claim-recovery"
MAX_TURNSTILE_TOKEN_CHARACTERS = 2048
TURNSTILE_ALWAYS_PASS_TEST_SECRET = "1x0000000000000000000000000000000AA"
SAFE_TASK_PATTERN = re.compile(r"[a-z][a-z0-9_]{0,63}")
SAFE_EMAIL_PATTERN = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")


class CaseClaimAccessError(Exception):
    """Base class for bounded case-claim access failures."""


class CaseClaimAccessInputError(CaseClaimAccessError):
    """The caller supplied a malformed public request."""


class CaseClaimAccessNotFoundError(CaseClaimAccessError):
    """The requested case is not visible through this owner boundary."""


class CaseClaimAccessConflictError(CaseClaimAccessError):
    """The case cannot safely issue an access claim in its current state."""


class CaseClaimAccessUnavailableError(CaseClaimAccessError):
    """A required claim-access dependency is unavailable."""


class TurnstileRejectedError(CaseClaimAccessInputError):
    """The public recovery security check was rejected."""


def _canonical_uuid(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise SupabaseContractError(f"{label} is invalid")
    try:
        parsed = UUID(value)
    except (AttributeError, TypeError, ValueError) as exc:
        raise SupabaseContractError(f"{label} is invalid") from exc
    if parsed.version != 4 or str(parsed) != value:
        raise SupabaseContractError(f"{label} is invalid")
    return value


def _canonical_timestamp(value: Any, label: str) -> str:
    if (
        not isinstance(value, str)
        or not value
        or len(value) > 64
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        raise SupabaseContractError(f"{label} is invalid")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise SupabaseContractError(f"{label} is invalid") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise SupabaseContractError(f"{label} is invalid")
    return value


def normalize_recovery_email(value: Any) -> str:
    """Return the same conservative normalized shape used by the claim RPC."""

    if not isinstance(value, str):
        raise CaseClaimAccessInputError("Recovery email is invalid")
    normalized = value.strip().lower()
    if (
        not 3 <= len(normalized) <= 320
        or SAFE_EMAIL_PATTERN.fullmatch(normalized) is None
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
        or any(character in value for character in ("\u061c", "\u200e", "\u200f"))
        or any("\u202a" <= character <= "\u202e" for character in value)
        or any("\u2066" <= character <= "\u2069" for character in value)
    ):
        raise CaseClaimAccessInputError("Recovery email is invalid")
    return normalized


def _validated_turnstile_token(value: Any) -> str:
    if (
        not isinstance(value, str)
        or not value
        or len(value) > MAX_TURNSTILE_TOKEN_CHARACTERS
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        raise TurnstileRejectedError("Security check is invalid")
    return value


def _configured_origin(value: str) -> str:
    if not isinstance(value, str) or any(
        character.isspace() or ord(character) < 32 or ord(character) == 127
        for character in value
    ):
        raise ValueError("public app origin configuration is invalid")
    normalized = value.rstrip("/")
    try:
        parsed = urlsplit(normalized)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise ValueError("public app origin configuration is invalid") from exc
    local_http = parsed.scheme == "http" and hostname in {
        "127.0.0.1",
        "localhost",
        "::1",
    }
    if (
        (parsed.scheme != "https" and not local_http)
        or not parsed.netloc
        or hostname is None
        or (port is not None and not 1 <= port <= 65535)
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("public app origin configuration is invalid")
    return normalized


def _configured_secret(value: str, label: str) -> str:
    if (
        not isinstance(value, str)
        or not value
        or len(value) > 1024
        or any(character.isspace() for character in value)
        or any(ord(character) < 33 or ord(character) == 127 for character in value)
    ):
        raise ValueError(f"{label} configuration is invalid")
    return value


@dataclass(frozen=True)
class CaseClaimRecoveryConfiguration:
    public_app_origin: str
    rate_limit_secret: str
    turnstile_secret: str

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "public_app_origin", _configured_origin(self.public_app_origin)
        )
        object.__setattr__(
            self,
            "turnstile_secret",
            _configured_secret(self.turnstile_secret, "Turnstile secret"),
        )
        object.__setattr__(
            self,
            "rate_limit_secret",
            _configured_secret(self.rate_limit_secret, "Recovery rate-limit secret"),
        )
        if hmac.compare_digest(self.turnstile_secret, self.rate_limit_secret):
            raise ValueError("Recovery secrets must be distinct")

    def fingerprint(self, kind: str, value: str) -> str:
        if kind not in {"requester", "target"}:
            raise ValueError("Recovery fingerprint kind is invalid")
        derived_key = hmac.new(
            self.rate_limit_secret.encode("utf-8"),
            b"venfour:claim-recovery:fingerprint-key:v1",
            hashlib.sha256,
        ).digest()
        return hmac.new(
            derived_key,
            f"{kind}:v1:{value}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    @property
    def turnstile_hostname(self) -> str:
        hostname = urlsplit(self.public_app_origin).hostname
        if hostname is None:  # Defensive: the origin is validated at construction.
            raise ValueError("public app origin configuration is invalid")
        return hostname.casefold()

    @property
    def allows_turnstile_test_response(self) -> bool:
        return self.turnstile_hostname in {"127.0.0.1", "localhost", "::1"} and (
            hmac.compare_digest(
                self.turnstile_secret,
                TURNSTILE_ALWAYS_PASS_TEST_SECRET,
            )
        )


@runtime_checkable
class TurnstileVerifier(Protocol):
    def verify(self, token: str) -> bool: ...


class CloudflareTurnstileVerifier:
    """Verify one claim-recovery token against Cloudflare Siteverify."""

    _endpoint = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

    def __init__(
        self,
        secret: str,
        *,
        expected_hostname: str,
        allow_test_response: bool = False,
        client: httpx.Client | None = None,
        timeout_seconds: float = 10.0,
    ) -> None:
        self._secret = _configured_secret(secret, "Turnstile secret")
        if (
            not isinstance(expected_hostname, str)
            or not expected_hostname
            or any(
                character.isspace()
                or ord(character) < 32
                or ord(character) == 127
                for character in expected_hostname
            )
        ):
            raise ValueError("Turnstile hostname configuration is invalid")
        self._expected_hostname = expected_hostname.casefold()
        if not isinstance(allow_test_response, bool):
            raise TypeError("allow_test_response must be a boolean")
        if allow_test_response and (
            self._expected_hostname not in {"127.0.0.1", "localhost", "::1"}
            or not hmac.compare_digest(
                self._secret,
                TURNSTILE_ALWAYS_PASS_TEST_SECRET,
            )
        ):
            raise ValueError("Turnstile test response configuration is invalid")
        if (
            isinstance(timeout_seconds, bool)
            or not isinstance(timeout_seconds, (int, float))
            or not 0 < timeout_seconds <= 60
        ):
            raise ValueError("Turnstile timeout configuration is invalid")
        self._allow_test_response = allow_test_response
        self._owned_client = client is None
        self._client = client or httpx.Client(
            timeout=timeout_seconds,
            follow_redirects=False,
        )

    def close(self) -> None:
        if self._owned_client:
            self._client.close()

    def verify(self, token: str) -> bool:
        canonical_token = _validated_turnstile_token(token)
        try:
            response = self._client.post(
                self._endpoint,
                data={"secret": self._secret, "response": canonical_token},
            )
        except httpx.HTTPError as exc:
            raise CaseClaimAccessUnavailableError(
                "Security check is unavailable"
            ) from exc
        if response.status_code != 200:
            raise CaseClaimAccessUnavailableError("Security check is unavailable")
        try:
            payload = response.json()
        except ValueError as exc:
            raise CaseClaimAccessUnavailableError(
                "Security check is unavailable"
            ) from exc
        if not isinstance(payload, Mapping):
            raise CaseClaimAccessUnavailableError("Security check is unavailable")
        if payload.get("success") is not True:
            return False
        if self._allow_test_response:
            return True
        hostname = payload.get("hostname")
        return (
            payload.get("action") == CLAIM_RECOVERY_TURNSTILE_ACTION
            and isinstance(hostname, str)
            and hmac.compare_digest(
                hostname.casefold(),
                self._expected_hostname,
            )
        )


@runtime_checkable
class CaseClaimAccessGateway(Protocol):
    def authenticate(self, access_token: str) -> str: ...

    def resolve_total_loss_case_claim(
        self, case_id: str, access_token: str
    ) -> Mapping[str, Any] | None: ...

    def renew_total_loss_case_claim(
        self, case_id: str, access_token: str
    ) -> Mapping[str, Any] | None: ...

    def prepare_total_loss_case_access_recovery(
        self,
        case_id: str,
        email: str,
        requester_fingerprint: str,
        target_fingerprint: str,
    ) -> Mapping[str, Any]: ...

    def send_total_loss_case_magic_link(
        self,
        email: str,
        claim_id: str,
        public_app_origin: str,
    ) -> None: ...


@dataclass(frozen=True)
class ClaimWorkflowProjection:
    phase: str
    current_task: str
    revision: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "phase": self.phase,
            "currentTask": self.current_task,
            "revision": self.revision,
        }


@dataclass(frozen=True)
class ClaimCommerceProjection:
    checkout_available: bool
    order_status: str | None
    payment_status: str | None
    entitlement_status: str | None
    next_task: str | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "checkoutAvailable": self.checkout_available,
            "orderStatus": self.order_status,
            "paymentStatus": self.payment_status,
            "entitlementStatus": self.entitlement_status,
            "nextTask": self.next_task,
        }


@dataclass(frozen=True)
class ClaimResumeState:
    state: str
    case_id: str
    contact_email: str | None
    workflow: ClaimWorkflowProjection | None
    commerce: ClaimCommerceProjection | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "caseId": self.case_id,
            "contactEmail": self.contact_email,
            "workflow": self.workflow.to_dict() if self.workflow else None,
            "commerce": self.commerce.to_dict() if self.commerce else None,
        }


@dataclass(frozen=True)
class ClaimAccessLink:
    state: str
    case_id: str
    contact_email: str | None
    claim_id: str | None
    expires_at: str | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "caseId": self.case_id,
            "contactEmail": self.contact_email,
            "claimId": self.claim_id,
            "expiresAt": self.expires_at,
        }


class CaseClaimAccessService:
    """Coordinate authenticated resume and neutral public recovery behavior."""

    _states = {"secure_required", "secured", "account_switch_required"}
    _database_states = _states | {"account_mismatch"}
    _phases = {"review", "initial_request", "negotiation", "resolution"}
    _order_statuses = {
        "pending",
        "paid",
        "partially_refunded",
        "refunded",
        "disputed",
        "void",
    }
    _payment_statuses = {"pending", "succeeded", "refunded", "disputed"}
    _entitlement_statuses = {
        "active",
        "refunded_access_retained",
        "suspended",
        "revoked",
    }

    def __init__(
        self,
        gateway: CaseClaimAccessGateway,
        *,
        recovery_configuration: CaseClaimRecoveryConfiguration | None = None,
        turnstile_verifier: TurnstileVerifier | None = None,
    ) -> None:
        if not isinstance(gateway, CaseClaimAccessGateway):
            raise TypeError("gateway must implement CaseClaimAccessGateway")
        if (recovery_configuration is None) != (turnstile_verifier is None):
            raise ValueError(
                "recovery configuration and Turnstile verifier must be "
                "provided together"
            )
        self._gateway = gateway
        self._recovery_configuration = recovery_configuration
        self._turnstile_verifier = turnstile_verifier

    def close(self) -> None:
        close = getattr(self._turnstile_verifier, "close", None)
        if callable(close):
            close()

    def authenticate(self, access_token: str) -> str:
        return self._gateway.authenticate(access_token)

    def resolve(self, case_id: str, access_token: str) -> ClaimResumeState:
        canonical_case_id = _canonical_uuid(case_id, "Case ID")
        row = self._gateway.resolve_total_loss_case_claim(
            canonical_case_id, access_token
        )
        if row is None:
            raise CaseClaimAccessNotFoundError("Case claim was not found")
        return self._resume_state(row, canonical_case_id)

    def access_link(self, case_id: str, access_token: str) -> ClaimAccessLink:
        canonical_case_id = _canonical_uuid(case_id, "Case ID")
        row = self._gateway.renew_total_loss_case_claim(
            canonical_case_id, access_token
        )
        if row is None:
            raise CaseClaimAccessNotFoundError("Case claim was not found")
        return self._access_link(row, canonical_case_id)

    def recover(
        self,
        case_id: str,
        email: str,
        turnstile_token: str,
        requester_identity: str,
    ) -> None:
        canonical_case_id = _canonical_uuid(case_id, "Case ID")
        normalized_email = normalize_recovery_email(email)
        canonical_token = _validated_turnstile_token(turnstile_token)
        if not isinstance(requester_identity, str) or not requester_identity:
            requester_identity = "unknown"

        configuration = self._recovery_configuration
        verifier = self._turnstile_verifier
        if configuration is None or verifier is None:
            raise CaseClaimAccessUnavailableError(
                "Case recovery is unavailable"
            )
        if not verifier.verify(canonical_token):
            raise TurnstileRejectedError("Security check was rejected")

        # Everything after a successful challenge is deliberately neutral.
        # A missing case, email mismatch, rate limit, database outage, and mail
        # delivery failure all result in the same public 202 response.
        try:
            requester_fingerprint = configuration.fingerprint(
                "requester", requester_identity
            )
            target_fingerprint = configuration.fingerprint(
                "target", f"{canonical_case_id}:{normalized_email}"
            )
            row = self._gateway.prepare_total_loss_case_access_recovery(
                canonical_case_id,
                normalized_email,
                requester_fingerprint,
                target_fingerprint,
            )
            send_allowed = row.get("send_allowed") is True
            if not send_allowed:
                return
            requested_email = row.get("requested_email")
            claim_id = row.get("claim_id")
            if requested_email != normalized_email:
                raise SupabaseContractError("Recovery response is invalid")
            canonical_claim_id = _canonical_uuid(claim_id, "Claim ID")
            self._gateway.send_total_loss_case_magic_link(
                normalized_email,
                canonical_claim_id,
                configuration.public_app_origin,
            )
        except Exception:
            return

    @classmethod
    def _workflow(cls, row: Mapping[str, Any]) -> ClaimWorkflowProjection | None:
        values = (
            row.get("workflow_phase"),
            row.get("workflow_current_task"),
            row.get("workflow_revision"),
        )
        if all(value is None for value in values):
            return None
        phase, current_task, revision = values
        if (
            phase not in cls._phases
            or not isinstance(current_task, str)
            or SAFE_TASK_PATTERN.fullmatch(current_task) is None
            or isinstance(revision, bool)
            or not isinstance(revision, int)
            or revision < 1
        ):
            raise SupabaseContractError("Claim workflow response is invalid")
        return ClaimWorkflowProjection(phase, current_task, revision)

    @classmethod
    def _resume_state(
        cls, row: Mapping[str, Any], expected_case_id: str
    ) -> ClaimResumeState:
        case_id = _canonical_uuid(row.get("case_id"), "Case ID")
        state = row.get("state")
        if case_id != expected_case_id or state not in cls._database_states:
            raise SupabaseContractError("Claim resume response is invalid")
        if state == "account_mismatch":
            state = "account_switch_required"
        contact_email = row.get("contact_email")
        if state == "secure_required":
            contact_email = normalize_recovery_email(contact_email)
        elif contact_email is not None:
            contact_email = normalize_recovery_email(contact_email)
        if state == "account_switch_required":
            contact_email = None
        commerce = cls._commerce(row, state)
        return ClaimResumeState(
            state=state,
            case_id=case_id,
            contact_email=contact_email,
            workflow=cls._workflow(row),
            commerce=commerce,
        )

    @classmethod
    def _commerce(
        cls, row: Mapping[str, Any], state: str
    ) -> ClaimCommerceProjection | None:
        checkout_available = row.get("checkout_available")
        order_status = row.get("commerce_order_status")
        payment_status = row.get("payment_status")
        entitlement_status = row.get("entitlement_status")
        next_task = row.get("next_task")
        if state != "secured":
            if (
                (checkout_available is not None and checkout_available is not False)
                or order_status is not None
                or payment_status is not None
                or entitlement_status is not None
                or next_task is not None
            ):
                raise SupabaseContractError(
                    "Claim commerce response is invalid"
                )
            return None
        if (
            not isinstance(checkout_available, bool)
            or (
                order_status is not None
                and order_status not in cls._order_statuses
            )
            or (
                payment_status is not None
                and payment_status not in cls._payment_statuses
            )
            or (
                entitlement_status is not None
                and entitlement_status not in cls._entitlement_statuses
            )
            or (
                next_task is not None
                and (
                    not isinstance(next_task, str)
                    or SAFE_TASK_PATTERN.fullmatch(next_task) is None
                )
            )
        ):
            raise SupabaseContractError("Claim commerce response is invalid")
        return ClaimCommerceProjection(
            checkout_available=checkout_available,
            order_status=order_status,
            payment_status=payment_status,
            entitlement_status=entitlement_status,
            next_task=next_task,
        )

    @classmethod
    def _access_link(
        cls, row: Mapping[str, Any], expected_case_id: str
    ) -> ClaimAccessLink:
        case_id = _canonical_uuid(row.get("case_id"), "Case ID")
        state = row.get("state")
        if case_id != expected_case_id or state not in cls._database_states:
            raise SupabaseContractError("Claim access-link response is invalid")
        if state == "account_mismatch":
            state = "account_switch_required"
        contact_email = row.get("contact_email")
        claim_id = row.get("claim_id")
        expires_at = row.get("claim_expires_at")
        if state == "secure_required":
            contact_email = normalize_recovery_email(contact_email)
            claim_id = _canonical_uuid(claim_id, "Claim ID")
            expires_at = _canonical_timestamp(expires_at, "Claim expiry")
        else:
            contact_email = None
            if claim_id is not None or expires_at is not None:
                raise SupabaseContractError(
                    "Claim access-link response is invalid"
                )
        return ClaimAccessLink(
            state=state,
            case_id=case_id,
            contact_email=contact_email,
            claim_id=claim_id,
            expires_at=expires_at,
        )


__all__ = [
    "CLAIM_RECOVERY_TURNSTILE_ACTION",
    "MAX_TURNSTILE_TOKEN_CHARACTERS",
    "CaseClaimAccessConflictError",
    "CaseClaimAccessError",
    "CaseClaimAccessGateway",
    "CaseClaimAccessInputError",
    "CaseClaimAccessNotFoundError",
    "CaseClaimAccessService",
    "CaseClaimAccessUnavailableError",
    "CaseClaimRecoveryConfiguration",
    "ClaimAccessLink",
    "ClaimCommerceProjection",
    "ClaimResumeState",
    "CloudflareTurnstileVerifier",
    "TurnstileRejectedError",
    "TURNSTILE_ALWAYS_PASS_TEST_SECRET",
    "TurnstileVerifier",
    "normalize_recovery_email",
]
