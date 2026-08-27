"""Server-only Supabase HTTP boundaries for owned appraisal analyses.

The gateway keeps every Supabase origin and credential under server control.
Callers provide only canonical identifiers and a browser access token; storage
paths are derived here and can never be selected by an HTTP request payload.
"""

from __future__ import annotations

import json
import math
import os
import re
import tempfile
import unicodedata
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from ipaddress import ip_address
from pathlib import Path
from typing import Any, Protocol, runtime_checkable
from urllib.parse import quote, urlsplit
from uuid import UUID

import httpx

from scripts.extract_report_ai import MAX_PDF_BYTES


CASE_FILES_BUCKET = "case-files"
TOTAL_LOSS_REPORT_OBJECT = "valuation-report.pdf"
DOWNLOAD_CHUNK_BYTES = 1024 * 1024
MAX_EXTRACTION_CACHE_BYTES = 1024 * 1024
MAX_EXTRACTION_PROVIDER_CHARACTERS = 200
EXTRACTION_SCHEMA_VERSION_PATTERN = re.compile(r"[0-9]{1,16}")
MAX_VEHICLE_TRIM_CACHE_KEY_CHARACTERS = 512
MAX_VEHICLE_TRIM_CACHE_ITEMS = 50
MAX_VEHICLE_TRIM_CACHE_TEXT_CHARACTERS = 100
MAX_COMMERCE_PROVIDER_IDENTIFIER_CHARACTERS = 255
COMMERCE_CODE_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
COMMERCE_PRODUCT_PATTERN = re.compile(r"[a-z][a-z0-9_-]{0,63}")
STRIPE_DISPUTE_EVENT_TYPES = frozenset(
    {
        "charge.dispute.created",
        "charge.dispute.updated",
        "charge.dispute.closed",
        "charge.dispute.funds_withdrawn",
        "charge.dispute.funds_reinstated",
    }
)


class SupabaseGatewayError(Exception):
    """Base class for neutral server-side Supabase failures."""


class SupabaseConfigurationError(SupabaseGatewayError):
    """Required server-only Supabase configuration is absent or invalid."""


class SupabaseAuthenticationError(SupabaseGatewayError):
    """A browser access token is absent, expired, or invalid."""


class SupabaseUnavailableError(SupabaseGatewayError):
    """Supabase could not complete a required operation."""


class SupabaseContractError(SupabaseGatewayError):
    """Supabase returned data outside the checked application contract."""


class SupabaseReportNotFoundError(SupabaseGatewayError):
    """The deterministic private report object does not exist."""


class SupabaseReportInvalidError(SupabaseGatewayError):
    """The private report object is empty, oversized, or not a PDF."""


def _canonical_uuid(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise SupabaseContractError(f"{label} is invalid")
    try:
        parsed = UUID(value)
    except (AttributeError, TypeError, ValueError) as exc:
        raise SupabaseContractError(f"{label} is invalid") from exc
    if str(parsed) != value:
        raise SupabaseContractError(f"{label} is invalid")
    return value


def _canonical_cache_text(value: Any, label: str, maximum: int) -> str:
    if not isinstance(value, str) or any(
        ord(character) < 32 or ord(character) == 127 for character in value
    ):
        raise SupabaseContractError(f"{label} is invalid")
    normalized = " ".join(unicodedata.normalize("NFKC", value).split())
    if not normalized or normalized != value or len(normalized) > maximum:
        raise SupabaseContractError(f"{label} is invalid")
    return normalized


def _canonical_commerce_identifier(
    value: Any, prefix: str, label: str
) -> str:
    if (
        not isinstance(value, str)
        or not value.startswith(prefix)
        or not 4 <= len(value) <= MAX_COMMERCE_PROVIDER_IDENTIFIER_CHARACTERS
        or re.fullmatch(r"[A-Za-z0-9_]+", value) is None
    ):
        raise SupabaseContractError(f"{label} is invalid")
    return value


def _canonical_stripe_dispute_identifier(value: Any) -> str:
    if (
        not isinstance(value, str)
        or not value.startswith(("du_", "dp_"))
        or not 4 <= len(value) <= MAX_COMMERCE_PROVIDER_IDENTIFIER_CHARACTERS
        or re.fullmatch(r"[A-Za-z0-9_]+", value) is None
    ):
        raise SupabaseContractError("Stripe Dispute ID is invalid")
    return value


def _canonical_commerce_code(
    value: Any, pattern: re.Pattern[str], label: str
) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise SupabaseContractError(f"{label} is invalid")
    return value


def _canonical_minor_units(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise SupabaseContractError(f"{label} is invalid")
    return value


def _canonical_currency(value: Any, label: str) -> str:
    if not isinstance(value, str) or re.fullmatch(r"[A-Z]{3}", value) is None:
        raise SupabaseContractError(f"{label} is invalid")
    return value


def _provider_timestamp(value: Any, label: str) -> str:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise SupabaseContractError(f"{label} is invalid")
    try:
        return datetime.fromtimestamp(value, tz=UTC).isoformat()
    except (OverflowError, OSError, ValueError) as exc:
        raise SupabaseContractError(f"{label} is invalid") from exc


def _valid_hostname(value: str) -> bool:
    try:
        ip_address(value)
        return True
    except ValueError:
        pass
    try:
        ascii_hostname = value.encode("idna").decode("ascii")
    except UnicodeError:
        return False
    if not ascii_hostname or len(ascii_hostname) > 253:
        return False
    labels = ascii_hostname.split(".")
    return all(
        label
        and len(label) <= 63
        and label[0] != "-"
        and label[-1] != "-"
        and all(character.isalnum() or character == "-" for character in label)
        for label in labels
    )


def _configured_origin(value: str) -> str:
    if not isinstance(value, str) or any(
        character.isspace() or ord(character) < 32 or ord(character) == 127
        for character in value
    ):
        raise SupabaseConfigurationError("SUPABASE_URL is invalid")
    normalized = value.rstrip("/")
    try:
        parsed = urlsplit(normalized)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise SupabaseConfigurationError("SUPABASE_URL is invalid") from exc
    local_http = parsed.scheme == "http" and hostname in {
        "127.0.0.1",
        "localhost",
        "::1",
    }
    if (
        (parsed.scheme != "https" and not local_http)
        or not parsed.netloc
        or hostname is None
        or not _valid_hostname(hostname)
        or (port is not None and not 1 <= port <= 65535)
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise SupabaseConfigurationError("SUPABASE_URL is invalid")
    return normalized


def _configured_credential(value: str, label: str) -> str:
    if not isinstance(value, str):
        raise SupabaseConfigurationError(f"{label} is required")
    if any(
        character.isspace() or ord(character) < 32 or ord(character) == 127
        for character in value
    ):
        raise SupabaseConfigurationError(f"{label} is invalid")
    normalized = value.strip()
    if not normalized:
        raise SupabaseConfigurationError(f"{label} is required")
    return normalized


@dataclass(frozen=True)
class SupabaseServerConfiguration:
    url: str
    publishable_key: str
    service_role_key: str
    timeout_seconds: float = 30.0

    def __post_init__(self) -> None:
        object.__setattr__(self, "url", _configured_origin(self.url))
        for name in ("publishable_key", "service_role_key"):
            label = name.replace("_", " ").upper()
            object.__setattr__(
                self,
                name,
                _configured_credential(getattr(self, name), label),
            )
        if self.publishable_key == self.service_role_key:
            raise SupabaseConfigurationError(
                "Supabase credentials must use distinct privilege levels"
            )
        timeout = self.timeout_seconds
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)):
            raise SupabaseConfigurationError("Supabase timeout is invalid")
        if timeout <= 0:
            raise SupabaseConfigurationError("Supabase timeout is invalid")
        object.__setattr__(self, "timeout_seconds", float(timeout))

    @classmethod
    def from_environment(cls) -> SupabaseServerConfiguration:
        values = {
            "url": os.environ.get("SUPABASE_URL", ""),
            "publishable_key": os.environ.get(
                "SUPABASE_PUBLISHABLE_KEY", ""
            ),
            "service_role_key": os.environ.get(
                "SUPABASE_SERVICE_ROLE_KEY", ""
            ),
        }
        if not all(value.strip() for value in values.values()):
            raise SupabaseConfigurationError(
                "Server-side Supabase configuration is unavailable"
            )
        return cls(**values)


@runtime_checkable
class CaseAnalysisGateway(Protocol):
    def authenticate(self, access_token: str) -> str: ...

    def claim_total_loss_analysis(
        self, case_id: str, user_id: str, processing_token: str
    ) -> Mapping[str, Any]: ...

    def get_total_loss_analysis_status(
        self, case_id: str, user_id: str
    ) -> Mapping[str, Any]: ...

    def complete_total_loss_analysis(
        self,
        job_id: str,
        processing_token: str,
        run_id: str,
        artifact: Mapping[str, Any],
    ) -> bool: ...

    def fail_total_loss_analysis(
        self,
        job_id: str,
        processing_token: str,
        failure_code: str,
        retryable: bool,
    ) -> bool: ...

    def get_owned_analysis_run(
        self, run_id: str, user_id: str
    ) -> Mapping[str, Any] | str | None: ...

    def materialize_total_loss_report(
        self, user_id: str, case_id: str, cache_nonce: str
    ) -> Any: ...


@runtime_checkable
class ReportIngestionGateway(Protocol):
    """Optional v2 boundary for owned extraction and immutable source locators."""

    def get_owned_total_loss_report_storage_locator(
        self, case_id: str, access_token: str
    ) -> Mapping[str, Any]: ...

    def get_total_loss_report_extraction(
        self,
        case_id: str,
        report_upload_id: str,
        analysis_input_revision: int,
    ) -> Mapping[str, Any] | None: ...

    def persist_total_loss_report_extraction(
        self,
        case_id: str,
        report_upload_id: str,
        analysis_input_revision: int,
        provider_name: str | None,
        extraction_status: str,
        confidence: float | None,
        extraction_schema_version: str,
        normalized_report: Mapping[str, Any] | None,
    ) -> Mapping[str, Any]: ...

    def materialize_total_loss_report_from_locator(
        self,
        case_id: str,
        storage_locator: Mapping[str, Any],
        cache_nonce: str,
    ) -> Any: ...


class SupabaseHttpGateway:
    """Use fixed Supabase Auth, PostgREST RPC, and Storage endpoints."""

    def __init__(
        self,
        configuration: SupabaseServerConfiguration,
        *,
        client: httpx.Client | None = None,
    ) -> None:
        if not isinstance(configuration, SupabaseServerConfiguration):
            raise TypeError("configuration must be SupabaseServerConfiguration")
        self._configuration = configuration
        self._client = client or httpx.Client(
            timeout=configuration.timeout_seconds,
            follow_redirects=False,
        )

    def close(self) -> None:
        """Release the process-owned HTTP connection pool."""

        self._client.close()

    def _user_headers(self, access_token: str) -> dict[str, str]:
        return {
            "Accept": "application/json",
            "apikey": self._configuration.publishable_key,
            "Authorization": f"Bearer {access_token}",
        }

    def _admin_headers(self, *, json_body: bool = False) -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "apikey": self._configuration.service_role_key,
            "Authorization": f"Bearer {self._configuration.service_role_key}",
        }
        if json_body:
            headers["Content-Type"] = "application/json"
        return headers

    def authenticate(self, access_token: str) -> str:
        if not isinstance(access_token, str) or not access_token.strip():
            raise SupabaseAuthenticationError("Authentication is required")
        token = access_token.strip()
        try:
            response = self._client.get(
                f"{self._configuration.url}/auth/v1/user",
                headers=self._user_headers(token),
            )
        except httpx.HTTPError as exc:
            raise SupabaseUnavailableError(
                "Authentication service is unavailable"
            ) from exc
        if response.status_code in {401, 403}:
            raise SupabaseAuthenticationError("Authentication is invalid")
        if response.status_code != 200:
            raise SupabaseUnavailableError(
                "Authentication service is unavailable"
            )
        try:
            payload = response.json()
        except (ValueError, json.JSONDecodeError) as exc:
            raise SupabaseContractError(
                "Authentication response is invalid"
            ) from exc
        if not isinstance(payload, Mapping):
            raise SupabaseContractError("Authentication response is invalid")
        return _canonical_uuid(payload.get("id"), "Authenticated user ID")

    @staticmethod
    def _single_rpc_row(payload: Any, label: str) -> Mapping[str, Any]:
        if isinstance(payload, list):
            if len(payload) != 1 or not isinstance(payload[0], Mapping):
                raise SupabaseContractError(f"{label} response is invalid")
            return dict(payload[0])
        if isinstance(payload, Mapping):
            return dict(payload)
        raise SupabaseContractError(f"{label} response is invalid")

    @staticmethod
    def _optional_rpc_row(
        payload: Any, label: str
    ) -> Mapping[str, Any] | None:
        if payload is None or payload == []:
            return None
        return SupabaseHttpGateway._single_rpc_row(payload, label)

    def _rpc(
        self,
        name: str,
        arguments: Mapping[str, Any],
        *,
        retry_ambiguous_claim: bool = False,
    ) -> Any:
        maximum_attempts = 2 if retry_ambiguous_claim else 1
        response: httpx.Response | None = None
        last_error: httpx.HTTPError | None = None
        for attempt in range(maximum_attempts):
            try:
                response = self._client.post(
                    f"{self._configuration.url}/rest/v1/rpc/{name}",
                    headers=self._admin_headers(json_body=True),
                    json=dict(arguments),
                )
                last_error = None
            except httpx.HTTPError as exc:
                last_error = exc
                if attempt + 1 < maximum_attempts:
                    continue
                raise SupabaseUnavailableError(
                    "Supabase RPC is unavailable"
                ) from exc
            if (
                retry_ambiguous_claim
                and response.status_code >= 500
                and attempt + 1 < maximum_attempts
            ):
                continue
            break
        if response is None:
            raise SupabaseUnavailableError(
                "Supabase RPC is unavailable"
            ) from last_error
        if response.status_code < 200 or response.status_code >= 300:
            raise SupabaseUnavailableError("Supabase RPC is unavailable")
        try:
            return response.json()
        except (ValueError, json.JSONDecodeError) as exc:
            raise SupabaseContractError("Supabase RPC response is invalid") from exc

    def _user_rpc(
        self,
        name: str,
        arguments: Mapping[str, Any],
        access_token: str,
    ) -> Any:
        if not isinstance(access_token, str) or not access_token.strip():
            raise SupabaseAuthenticationError("Authentication is required")
        try:
            response = self._client.post(
                f"{self._configuration.url}/rest/v1/rpc/{name}",
                headers={
                    **self._user_headers(access_token.strip()),
                    "Content-Type": "application/json",
                },
                json=dict(arguments),
            )
        except httpx.HTTPError as exc:
            raise SupabaseUnavailableError("Supabase RPC is unavailable") from exc
        if response.status_code in {401, 403}:
            raise SupabaseAuthenticationError("Authentication is invalid")
        if response.status_code < 200 or response.status_code >= 300:
            raise SupabaseUnavailableError("Supabase RPC is unavailable")
        try:
            return response.json()
        except (ValueError, json.JSONDecodeError) as exc:
            raise SupabaseContractError("Supabase RPC response is invalid") from exc

    def claim_total_loss_analysis(
        self, case_id: str, user_id: str, processing_token: str
    ) -> Mapping[str, Any]:
        payload = self._rpc(
            "claim_total_loss_analysis",
            {
                "case_id": _canonical_uuid(case_id, "Case ID"),
                "user_id": _canonical_uuid(user_id, "User ID"),
                "processing_token": _canonical_uuid(
                    processing_token, "Processing token"
                ),
            },
            retry_ambiguous_claim=True,
        )
        return self._single_rpc_row(payload, "Analysis claim")

    def resolve_total_loss_case_claim(
        self, case_id: str, access_token: str
    ) -> Mapping[str, Any] | None:
        canonical_case_id = _canonical_uuid(case_id, "Case ID")
        payload = self._user_rpc(
            "resolve_total_loss_case_claim",
            {"requested_case_id": canonical_case_id},
            access_token,
        )
        return self._optional_rpc_row(payload, "Case claim resolver")

    def renew_total_loss_case_claim(
        self, case_id: str, access_token: str
    ) -> Mapping[str, Any] | None:
        canonical_case_id = _canonical_uuid(case_id, "Case ID")
        payload = self._user_rpc(
            "renew_total_loss_case_claim",
            {"requested_case_id": canonical_case_id},
            access_token,
        )
        return self._optional_rpc_row(payload, "Case claim renewal")

    def prepare_total_loss_case_access_recovery(
        self,
        case_id: str,
        email: str,
        requester_fingerprint: str,
        target_fingerprint: str,
    ) -> Mapping[str, Any]:
        canonical_case_id = _canonical_uuid(case_id, "Case ID")
        if (
            not isinstance(email, str)
            or not 3 <= len(email) <= 320
            or email != email.strip().lower()
        ):
            raise SupabaseContractError("Recovery email is invalid")
        for value, label in (
            (requester_fingerprint, "Requester fingerprint"),
            (target_fingerprint, "Target fingerprint"),
        ):
            if (
                not isinstance(value, str)
                or re.fullmatch(r"[0-9a-f]{64}", value) is None
            ):
                raise SupabaseContractError(f"{label} is invalid")
        payload = self._rpc(
            "prepare_total_loss_case_access_recovery",
            {
                "requested_case_id": canonical_case_id,
                "email": email,
                "requester_fingerprint": requester_fingerprint,
                "target_fingerprint": target_fingerprint,
            },
        )
        return self._single_rpc_row(payload, "Case access recovery")

    def send_total_loss_case_magic_link(
        self,
        email: str,
        claim_id: str,
        public_app_origin: str,
    ) -> None:
        canonical_claim_id = _canonical_uuid(claim_id, "Claim ID")
        if (
            not isinstance(email, str)
            or not 3 <= len(email) <= 320
            or email != email.strip().lower()
        ):
            raise SupabaseContractError("Recovery email is invalid")
        try:
            canonical_public_app_origin = _configured_origin(public_app_origin)
        except SupabaseConfigurationError as exc:
            raise SupabaseContractError("Public app origin is invalid") from exc
        callback = (
            f"{canonical_public_app_origin}/auth/callback/case-claim/"
            f"{canonical_claim_id}"
        )
        try:
            response = self._client.post(
                f"{self._configuration.url}/auth/v1/otp",
                params={"redirect_to": callback},
                headers=self._admin_headers(json_body=True),
                json={"email": email, "create_user": True},
            )
        except httpx.HTTPError as exc:
            raise SupabaseUnavailableError(
                "Case access email is unavailable"
            ) from exc
        if response.status_code < 200 or response.status_code >= 300:
            raise SupabaseUnavailableError("Case access email is unavailable")

    def reserve_total_loss_checkout(
        self,
        case_id: str,
        purchaser_user_id: str,
        client_request_id: str,
        configuration: Any,
        price: Any,
    ) -> Mapping[str, Any] | None:
        payload = self._rpc(
            "reserve_total_loss_checkout",
            {
                "requested_case_id": _canonical_uuid(case_id, "Case ID"),
                "requested_purchaser_user_id": _canonical_uuid(
                    purchaser_user_id, "Purchaser user ID"
                ),
                "requested_client_request_id": _canonical_uuid(
                    client_request_id, "Client request ID"
                ),
                "configured_product_identifier": _canonical_commerce_code(
                    getattr(configuration, "product_identifier", None),
                    COMMERCE_PRODUCT_PATTERN,
                    "Product identifier",
                ),
                "configured_product_version": _canonical_commerce_code(
                    getattr(configuration, "product_version", None),
                    COMMERCE_CODE_PATTERN,
                    "Product version",
                ),
                "configured_external_price_identifier": (
                    _canonical_commerce_identifier(
                        getattr(price, "id", None),
                        "price_",
                        "Stripe Price ID",
                    )
                ),
                "configured_amount_minor_units": _canonical_minor_units(
                    getattr(price, "unit_amount", None), "Checkout amount"
                ),
                "configured_currency": _canonical_currency(
                    getattr(price, "currency", None), "Checkout currency"
                ),
                "configured_terms_version": _canonical_commerce_code(
                    getattr(configuration, "terms_version", None),
                    COMMERCE_CODE_PATTERN,
                    "Terms version",
                ),
                "configured_refund_policy_version": _canonical_commerce_code(
                    getattr(configuration, "refund_policy_version", None),
                    COMMERCE_CODE_PATTERN,
                    "Refund policy version",
                ),
                "configured_provider_livemode": self._canonical_boolean(
                    getattr(price, "livemode", None), "Stripe provider mode"
                ),
            },
            retry_ambiguous_claim=True,
        )
        return self._optional_rpc_row(payload, "Checkout reservation")

    def authorize_total_loss_checkout_preflight(
        self, case_id: str, purchaser_user_id: str
    ) -> Mapping[str, Any] | None:
        payload = self._rpc(
            "authorize_total_loss_checkout_preflight",
            {
                "requested_case_id": _canonical_uuid(case_id, "Case ID"),
                "requested_purchaser_user_id": _canonical_uuid(
                    purchaser_user_id, "Purchaser user ID"
                ),
            },
        )
        return self._optional_rpc_row(payload, "Checkout preflight")

    def attach_total_loss_checkout_session(
        self, attempt_id: str, session: Any
    ) -> Mapping[str, Any] | None:
        payload = self._rpc(
            "attach_total_loss_checkout_session",
            {
                "requested_checkout_attempt_id": _canonical_uuid(
                    attempt_id, "Checkout attempt ID"
                ),
                "requested_external_checkout_session_id": (
                    _canonical_commerce_identifier(
                        getattr(session, "id", None),
                        "cs_",
                        "Stripe Checkout Session ID",
                    )
                ),
                "requested_external_payment_intent_id": (
                    _canonical_commerce_identifier(
                        session.payment_intent_id,
                        "pi_",
                        "Stripe PaymentIntent ID",
                    )
                    if getattr(session, "payment_intent_id", None) is not None
                    else None
                ),
                "requested_external_customer_id": (
                    _canonical_commerce_identifier(
                        session.customer_id,
                        "cus_",
                        "Stripe Customer ID",
                    )
                    if getattr(session, "customer_id", None) is not None
                    else None
                ),
                "requested_expires_at": _provider_timestamp(
                    getattr(session, "expires_at", None),
                    "Stripe Checkout expiry",
                ),
                "requested_provider_livemode": self._canonical_boolean(
                    getattr(session, "livemode", None), "Stripe provider mode"
                ),
            },
            retry_ambiguous_claim=True,
        )
        return self._optional_rpc_row(payload, "Checkout attachment")

    def recover_total_loss_checkout_attempt(
        self, context: Any, session: Any
    ) -> Mapping[str, Any]:
        payload = self._rpc(
            "recover_total_loss_checkout_attempt",
            {
                "requested_case_id": _canonical_uuid(context.case_id, "Case ID"),
                "requested_order_id": _canonical_uuid(context.order_id, "Order ID"),
                "requested_checkout_attempt_id": _canonical_uuid(
                    context.checkout_attempt_id, "Checkout attempt ID"
                ),
                "requested_purchaser_user_id": _canonical_uuid(
                    context.purchaser_user_id, "Purchaser user ID"
                ),
                "requested_external_checkout_session_id": (
                    _canonical_commerce_identifier(
                        session.id, "cs_", "Stripe Checkout Session ID"
                    )
                ),
                "requested_external_payment_intent_id": (
                    _canonical_commerce_identifier(
                        session.payment_intent_id,
                        "pi_",
                        "Stripe PaymentIntent ID",
                    )
                    if getattr(session, "payment_intent_id", None) is not None
                    else None
                ),
                "requested_external_customer_id": (
                    _canonical_commerce_identifier(
                        session.customer_id, "cus_", "Stripe Customer ID"
                    )
                    if getattr(session, "customer_id", None) is not None
                    else None
                ),
                "requested_session_status": self._canonical_choice(
                    getattr(session, "status", None),
                    {"complete", "expired"},
                    "Stripe Checkout status",
                ),
                "requested_payment_status": self._canonical_choice(
                    getattr(session, "payment_status", None),
                    {"unpaid", "paid", "no_payment_required"},
                    "Stripe payment status",
                ),
                "requested_expires_at": _provider_timestamp(
                    getattr(session, "expires_at", None),
                    "Stripe Checkout expiry",
                ),
                "requested_provider_livemode": self._canonical_boolean(
                    getattr(session, "livemode", None), "Stripe provider mode"
                ),
                "requested_external_price_identifier": (
                    _canonical_commerce_identifier(
                        getattr(session, "line_item_price_id", None),
                        "price_",
                        "Stripe Price ID",
                    )
                ),
                "requested_quantity": self._canonical_positive_integer(
                    getattr(session, "line_item_quantity", None),
                    "Stripe quantity",
                ),
                "requested_amount_minor_units": _canonical_minor_units(
                    getattr(session, "amount_total", None), "Checkout amount"
                ),
                "requested_currency": _canonical_currency(
                    getattr(session, "currency", None), "Checkout currency"
                ),
            },
            retry_ambiguous_claim=True,
        )
        return self._single_rpc_row(payload, "Checkout recovery")

    def authorize_total_loss_checkout_reconciliation(
        self, case_id: str, purchaser_user_id: str, session_id: str
    ) -> Mapping[str, Any] | None:
        payload = self._rpc(
            "authorize_total_loss_checkout_reconciliation",
            {
                "requested_case_id": _canonical_uuid(case_id, "Case ID"),
                "requested_purchaser_user_id": _canonical_uuid(
                    purchaser_user_id, "Purchaser user ID"
                ),
                "requested_external_checkout_session_id": (
                    _canonical_commerce_identifier(
                        session_id, "cs_", "Stripe Checkout Session ID"
                    )
                ),
            },
        )
        return self._optional_rpc_row(payload, "Checkout authorization")

    def resolve_total_loss_checkout_context(
        self, order_id: str, checkout_attempt_id: str
    ) -> Mapping[str, Any] | None:
        payload = self._rpc(
            "resolve_total_loss_checkout_context",
            {
                "requested_order_id": _canonical_uuid(order_id, "Order ID"),
                "requested_checkout_attempt_id": _canonical_uuid(
                    checkout_attempt_id, "Checkout attempt ID"
                ),
            },
        )
        return self._optional_rpc_row(payload, "Checkout context")

    def resolve_total_loss_checkout_context_by_session_id(
        self, external_checkout_session_id: str
    ) -> Mapping[str, Any] | None:
        payload = self._rpc(
            "resolve_total_loss_checkout_context_by_session_id",
            {
                "requested_external_checkout_session_id": (
                    _canonical_commerce_identifier(
                        external_checkout_session_id,
                        "cs_",
                        "Stripe Checkout Session ID",
                    )
                )
            },
        )
        return self._optional_rpc_row(payload, "Checkout context")

    def resolve_total_loss_payment_context(
        self, payment_intent_id: str
    ) -> Mapping[str, Any] | None:
        payload = self._rpc(
            "resolve_total_loss_payment_context",
            {
                "requested_external_payment_intent_id": (
                    _canonical_commerce_identifier(
                        payment_intent_id,
                        "pi_",
                        "Stripe PaymentIntent ID",
                    )
                )
            },
        )
        return self._optional_rpc_row(payload, "Payment context")

    def reconcile_total_loss_checkout_attempt(
        self,
        case_id: str,
        purchaser_user_id: str,
        session: Any,
    ) -> Mapping[str, Any] | None:
        payload = self._rpc(
            "reconcile_total_loss_checkout_attempt",
            {
                "requested_case_id": _canonical_uuid(case_id, "Case ID"),
                "requested_purchaser_user_id": _canonical_uuid(
                    purchaser_user_id, "Purchaser user ID"
                ),
                "requested_external_checkout_session_id": (
                    _canonical_commerce_identifier(
                        getattr(session, "id", None),
                        "cs_",
                        "Stripe Checkout Session ID",
                    )
                ),
                "requested_session_status": self._canonical_choice(
                    getattr(session, "status", None),
                    {"open", "complete", "expired"},
                    "Stripe Checkout status",
                ),
                "requested_payment_status": self._canonical_choice(
                    getattr(session, "payment_status", None),
                    {"unpaid", "paid", "no_payment_required"},
                    "Stripe payment status",
                ),
                "requested_external_payment_intent_id": (
                    _canonical_commerce_identifier(
                        session.payment_intent_id,
                        "pi_",
                        "Stripe PaymentIntent ID",
                    )
                    if getattr(session, "payment_intent_id", None) is not None
                    else None
                ),
                "requested_expires_at": _provider_timestamp(
                    getattr(session, "expires_at", None),
                    "Stripe Checkout expiry",
                ),
                "requested_provider_livemode": self._canonical_boolean(
                    getattr(session, "livemode", None), "Stripe provider mode"
                ),
                "requested_external_price_identifier": (
                    _canonical_commerce_identifier(
                        getattr(session, "line_item_price_id", None),
                        "price_",
                        "Stripe Price ID",
                    )
                ),
                "requested_quantity": self._canonical_positive_integer(
                    getattr(session, "line_item_quantity", None),
                    "Stripe quantity",
                ),
                "requested_amount_minor_units": _canonical_minor_units(
                    getattr(session, "amount_total", None), "Checkout amount"
                ),
                "requested_currency": _canonical_currency(
                    getattr(session, "currency", None), "Checkout currency"
                ),
            },
            retry_ambiguous_claim=True,
        )
        return self._optional_rpc_row(payload, "Checkout reconciliation")

    def fail_total_loss_checkout_attempt_from_webhook(
        self,
        order_id: str,
        checkout_attempt_id: str,
        external_checkout_session_id: str,
        external_event_id: str,
        webhook_processing_token: str,
        failure_code: str,
    ) -> Mapping[str, Any]:
        payload = self._rpc(
            "fail_total_loss_checkout_attempt_from_webhook",
            {
                "requested_order_id": _canonical_uuid(order_id, "Order ID"),
                "requested_checkout_attempt_id": _canonical_uuid(
                    checkout_attempt_id, "Checkout attempt ID"
                ),
                "requested_external_checkout_session_id": (
                    _canonical_commerce_identifier(
                        external_checkout_session_id,
                        "cs_",
                        "Stripe Checkout Session ID",
                    )
                ),
                "requested_external_event_id": _canonical_commerce_identifier(
                    external_event_id, "evt_", "Stripe event ID"
                ),
                "requested_webhook_processing_token": _canonical_uuid(
                    webhook_processing_token, "Webhook processing token"
                ),
                "requested_failure_code": _canonical_commerce_code(
                    failure_code,
                    re.compile(r"[A-Z][A-Z0-9_]{0,63}"),
                    "Checkout failure code",
                ),
            },
            retry_ambiguous_claim=True,
        )
        return self._single_rpc_row(payload, "Checkout webhook failure")

    def expire_total_loss_checkout_attempt_from_webhook(
        self,
        order_id: str,
        checkout_attempt_id: str,
        external_checkout_session_id: str,
        external_event_id: str,
        webhook_processing_token: str,
        expires_at: int,
    ) -> Mapping[str, Any]:
        payload = self._rpc(
            "expire_total_loss_checkout_attempt_from_webhook",
            {
                "requested_order_id": _canonical_uuid(order_id, "Order ID"),
                "requested_checkout_attempt_id": _canonical_uuid(
                    checkout_attempt_id, "Checkout attempt ID"
                ),
                "requested_external_checkout_session_id": (
                    _canonical_commerce_identifier(
                        external_checkout_session_id,
                        "cs_",
                        "Stripe Checkout Session ID",
                    )
                ),
                "requested_external_event_id": _canonical_commerce_identifier(
                    external_event_id, "evt_", "Stripe event ID"
                ),
                "requested_webhook_processing_token": _canonical_uuid(
                    webhook_processing_token, "Webhook processing token"
                ),
                "requested_expires_at": _provider_timestamp(
                    expires_at, "Stripe Checkout expiry"
                ),
            },
            retry_ambiguous_claim=True,
        )
        return self._single_rpc_row(payload, "Checkout webhook expiration")

    def claim_stripe_webhook_event(
        self,
        event: Any,
        payload_sha256: str,
        payload_size: int,
        processing_token: str,
    ) -> Mapping[str, Any]:
        if not isinstance(payload_sha256, str) or re.fullmatch(
            r"[0-9a-f]{64}", payload_sha256
        ) is None:
            raise SupabaseContractError("Webhook digest is invalid")
        if (
            isinstance(payload_size, bool)
            or not isinstance(payload_size, int)
            or not 0 < payload_size <= 256 * 1024
        ):
            raise SupabaseContractError("Webhook payload size is invalid")
        event_type = getattr(event, "type", None)
        api_version = getattr(event, "api_version", None)
        if (
            not isinstance(event_type, str)
            or not event_type
            or len(event_type) > 128
            or any(ord(character) < 32 or ord(character) == 127 for character in event_type)
            or (
                api_version is not None
                and (
                    not isinstance(api_version, str)
                    or not api_version
                    or len(api_version) > 64
                )
            )
        ):
            raise SupabaseContractError("Webhook event contract is invalid")
        payload = self._rpc(
            "claim_stripe_webhook_event",
            {
                "requested_external_event_id": _canonical_commerce_identifier(
                    getattr(event, "id", None), "evt_", "Stripe event ID"
                ),
                "requested_event_type": event_type,
                "requested_livemode": self._canonical_boolean(
                    getattr(event, "livemode", None), "Stripe event mode"
                ),
                "requested_api_version": api_version,
                "requested_payload_sha256": payload_sha256,
                "requested_payload_size": payload_size,
                "requested_provider_created_at": _provider_timestamp(
                    getattr(event, "created", None), "Stripe event timestamp"
                ),
                "requested_processing_token": _canonical_uuid(
                    processing_token, "Webhook processing token"
                ),
            },
            retry_ambiguous_claim=True,
        )
        return self._single_rpc_row(payload, "Webhook event claim")

    def finalize_stripe_webhook_event(
        self,
        webhook_event_id: str,
        processing_token: str,
        outcome: str,
        case_id: str | None,
        order_id: str | None,
        failure_code: str | None,
    ) -> Mapping[str, Any]:
        if failure_code is not None:
            failure_code = _canonical_commerce_code(
                failure_code, re.compile(r"[A-Z][A-Z0-9_]{0,63}"), "Failure code"
            )
        payload = self._rpc(
            "finalize_stripe_webhook_event",
            {
                "requested_webhook_event_id": _canonical_uuid(
                    webhook_event_id, "Webhook event ID"
                ),
                "requested_processing_token": _canonical_uuid(
                    processing_token, "Webhook processing token"
                ),
                "requested_outcome": self._canonical_choice(
                    outcome,
                    {"processed", "ignored", "failed"},
                    "Webhook outcome",
                ),
                "requested_case_id": (
                    _canonical_uuid(case_id, "Case ID")
                    if case_id is not None
                    else None
                ),
                "requested_order_id": (
                    _canonical_uuid(order_id, "Order ID")
                    if order_id is not None
                    else None
                ),
                "requested_failure_code": failure_code,
            },
            retry_ambiguous_claim=True,
        )
        return self._single_rpc_row(payload, "Webhook event finalization")

    def fulfill_total_loss_checkout_payment(
        self,
        context: Any,
        session: Any,
        payment_intent: Any,
        external_event_id: str,
        webhook_processing_token: str,
        provider_occurred_at: int,
    ) -> Mapping[str, Any]:
        payload = self._rpc(
            "fulfill_total_loss_checkout_payment",
            {
                "requested_case_id": _canonical_uuid(context.case_id, "Case ID"),
                "requested_order_id": _canonical_uuid(context.order_id, "Order ID"),
                "requested_checkout_attempt_id": _canonical_uuid(
                    context.checkout_attempt_id, "Checkout attempt ID"
                ),
                "requested_external_checkout_session_id": (
                    _canonical_commerce_identifier(
                        session.id, "cs_", "Stripe Checkout Session ID"
                    )
                ),
                "requested_external_payment_intent_id": (
                    _canonical_commerce_identifier(
                        payment_intent.id, "pi_", "Stripe PaymentIntent ID"
                    )
                ),
                "requested_external_event_id": _canonical_commerce_identifier(
                    external_event_id, "evt_", "Stripe event ID"
                ),
                "requested_webhook_processing_token": _canonical_uuid(
                    webhook_processing_token, "Webhook processing token"
                ),
                "requested_external_price_identifier": (
                    _canonical_commerce_identifier(
                        session.line_item_price_id, "price_", "Stripe Price ID"
                    )
                ),
                "requested_quantity": self._canonical_positive_integer(
                    session.line_item_quantity, "Stripe quantity"
                ),
                "requested_amount_minor_units": _canonical_minor_units(
                    payment_intent.amount_received, "Payment amount"
                ),
                "requested_currency": _canonical_currency(
                    payment_intent.currency, "Payment currency"
                ),
                "requested_provider_livemode": self._canonical_boolean(
                    payment_intent.livemode, "Stripe provider mode"
                ),
                "requested_provider_occurred_at": _provider_timestamp(
                    provider_occurred_at, "Stripe payment timestamp"
                ),
            },
            retry_ambiguous_claim=True,
        )
        return self._single_rpc_row(payload, "Payment fulfillment")

    def reserve_total_loss_refund(
        self,
        case_id: str,
        order_id: str,
        payment_transaction_id: str,
        client_request_id: str,
        reason_code: str,
        access_policy: str,
    ) -> Mapping[str, Any] | None:
        payload = self._rpc(
            "reserve_total_loss_refund",
            {
                "requested_case_id": _canonical_uuid(case_id, "Case ID"),
                "requested_order_id": _canonical_uuid(order_id, "Order ID"),
                "requested_payment_transaction_id": _canonical_uuid(
                    payment_transaction_id, "Payment transaction ID"
                ),
                "requested_client_request_id": _canonical_uuid(
                    client_request_id, "Client request ID"
                ),
                "requested_reason_code": _canonical_commerce_code(
                    reason_code,
                    re.compile(r"[A-Z][A-Z0-9_]{0,63}"),
                    "Refund reason",
                ),
                "requested_access_policy": self._canonical_choice(
                    access_policy,
                    {"retain", "revoke"},
                    "Refund access policy",
                ),
            },
            retry_ambiguous_claim=True,
        )
        return self._optional_rpc_row(payload, "Refund reservation")

    def record_total_loss_refund_result(
        self,
        refund_request_id: str,
        refund: Any,
        external_event_id: str | None,
        failure_code: str | None,
        provider_occurred_at: int,
    ) -> Mapping[str, Any]:
        if failure_code is not None:
            failure_code = _canonical_commerce_code(
                failure_code,
                re.compile(r"[A-Z][A-Z0-9_]{0,63}"),
                "Refund failure code",
            )
        payload = self._rpc(
            "record_total_loss_refund_result",
            {
                "requested_refund_request_id": _canonical_uuid(
                    refund_request_id, "Refund request ID"
                ),
                "requested_external_refund_id": _canonical_commerce_identifier(
                    refund.id, "re_", "Stripe Refund ID"
                ),
                "requested_external_event_id": (
                    _canonical_commerce_identifier(
                        external_event_id, "evt_", "Stripe event ID"
                    )
                    if external_event_id is not None
                    else None
                ),
                "requested_external_balance_transaction_id": (
                    _canonical_commerce_identifier(
                        refund.balance_transaction_id,
                        "txn_",
                        "Stripe refund BalanceTransaction ID",
                    )
                    if getattr(refund, "balance_transaction_id", None)
                    is not None
                    else None
                ),
                "requested_external_failure_balance_transaction_id": (
                    _canonical_commerce_identifier(
                        refund.failure_balance_transaction_id,
                        "txn_",
                        "Stripe refund failure BalanceTransaction ID",
                    )
                    if getattr(
                        refund,
                        "failure_balance_transaction_id",
                        None,
                    )
                    is not None
                    else None
                ),
                "requested_provider_status": self._canonical_choice(
                    refund.status,
                    {
                        "pending",
                        "requires_action",
                        "succeeded",
                        "failed",
                        "canceled",
                    },
                    "Stripe Refund status",
                ),
                "requested_provider_occurred_at": _provider_timestamp(
                    provider_occurred_at, "Stripe refund timestamp"
                ),
                "requested_failure_code": failure_code,
            },
            retry_ambiguous_claim=True,
        )
        return self._single_rpc_row(payload, "Refund result")

    def record_total_loss_dispute(
        self,
        context: Any,
        dispute: Any,
        external_event_id: str,
        event_type: str,
        dispute_status: str,
        provider_occurred_at: int,
    ) -> Mapping[str, Any]:
        payload = self._rpc(
            "record_total_loss_dispute",
            {
                "requested_case_id": _canonical_uuid(context.case_id, "Case ID"),
                "requested_order_id": _canonical_uuid(context.order_id, "Order ID"),
                "requested_payment_transaction_id": _canonical_uuid(
                    context.payment_transaction_id, "Payment transaction ID"
                ),
                "requested_external_dispute_id": _canonical_stripe_dispute_identifier(
                    dispute.id
                ),
                "requested_external_event_id": _canonical_commerce_identifier(
                    external_event_id, "evt_", "Stripe event ID"
                ),
                "requested_event_type": self._canonical_choice(
                    event_type,
                    STRIPE_DISPUTE_EVENT_TYPES,
                    "Stripe dispute event type",
                ),
                "requested_dispute_status": self._canonical_choice(
                    dispute_status,
                    {"active", "won", "lost"},
                    "Stripe dispute status",
                ),
                "requested_amount_minor_units": _canonical_minor_units(
                    dispute.amount, "Dispute amount"
                ),
                "requested_currency": _canonical_currency(
                    dispute.currency, "Dispute currency"
                ),
                "requested_provider_occurred_at": _provider_timestamp(
                    provider_occurred_at, "Stripe dispute timestamp"
                ),
            },
            retry_ambiguous_claim=True,
        )
        return self._single_rpc_row(payload, "Dispute result")

    def enqueue_total_loss_package_job(
        self, entitlement_id: str
    ) -> Mapping[str, Any]:
        payload = self._rpc(
            "enqueue_total_loss_package_job",
            {
                "requested_entitlement_id": _canonical_uuid(
                    entitlement_id, "Entitlement ID"
                )
            },
            retry_ambiguous_claim=True,
        )
        return self._single_rpc_row(payload, "Package enqueue")

    def reserve_due_workflow_work_items(
        self, dispatch_token: str, limit: int
    ) -> list[Mapping[str, Any]]:
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise SupabaseContractError("Dispatch limit is invalid")
        payload = self._rpc(
            "reserve_due_workflow_work_items",
            {
                "requested_dispatch_token": _canonical_uuid(
                    dispatch_token, "Dispatch token"
                ),
                "requested_limit": limit,
            },
            retry_ambiguous_claim=True,
        )
        if not isinstance(payload, list) or any(
            not isinstance(row, Mapping) for row in payload
        ):
            raise SupabaseContractError(
                "Work-item dispatch reservation response is invalid"
            )
        return payload

    def mark_workflow_work_item_dispatched(
        self, work_item_id: str, dispatch_token: str
    ) -> bool:
        payload = self._rpc(
            "mark_workflow_work_item_dispatched",
            {
                "requested_work_item_id": _canonical_uuid(
                    work_item_id, "Work item ID"
                ),
                "requested_dispatch_token": _canonical_uuid(
                    dispatch_token, "Dispatch token"
                ),
            },
        )
        return self._rpc_boolean(payload, "Work-item dispatch completion")

    def release_workflow_work_item_dispatch(
        self,
        work_item_id: str,
        dispatch_token: str,
        error_code: str,
        delay_seconds: int,
    ) -> bool:
        if (
            isinstance(delay_seconds, bool)
            or not isinstance(delay_seconds, int)
            or not 1 <= delay_seconds <= 86400
        ):
            raise SupabaseContractError("Dispatch retry delay is invalid")
        payload = self._rpc(
            "release_workflow_work_item_dispatch",
            {
                "requested_work_item_id": _canonical_uuid(
                    work_item_id, "Work item ID"
                ),
                "requested_dispatch_token": _canonical_uuid(
                    dispatch_token, "Dispatch token"
                ),
                "requested_error_code": _canonical_commerce_code(
                    error_code,
                    re.compile(r"[A-Z][A-Z0-9_]{0,63}"),
                    "Dispatch error code",
                ),
                "requested_delay_seconds": delay_seconds,
            },
        )
        return self._rpc_boolean(payload, "Work-item dispatch release")

    def claim_total_loss_package_work_item(
        self, work_item_id: str, processing_token: str
    ) -> Mapping[str, Any]:
        payload = self._rpc(
            "claim_total_loss_package_work_item",
            {
                "requested_work_item_id": _canonical_uuid(
                    work_item_id, "Work item ID"
                ),
                "requested_processing_token": _canonical_uuid(
                    processing_token, "Processing token"
                ),
            },
            retry_ambiguous_claim=True,
        )
        return self._single_rpc_row(payload, "Package work claim")

    def resolve_total_loss_package_source_context(
        self, work_item_id: str, processing_token: str
    ) -> Mapping[str, Any]:
        payload = self._rpc(
            "resolve_total_loss_package_source_context",
            {
                "requested_work_item_id": _canonical_uuid(
                    work_item_id, "Work item ID"
                ),
                "requested_processing_token": _canonical_uuid(
                    processing_token, "Processing token"
                ),
            },
        )
        return self._single_rpc_row(payload, "Package source context")

    @staticmethod
    def _package_digest(value: Any, label: str) -> str:
        if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
            raise SupabaseContractError(f"{label} is invalid")
        return value

    @staticmethod
    def _package_mapping(value: Any, label: str) -> Mapping[str, Any]:
        if not isinstance(value, Mapping):
            raise SupabaseContractError(f"{label} is invalid")
        return value

    @staticmethod
    def _package_timestamp(value: Any, label: str) -> str:
        if not isinstance(value, str) or not value.endswith("Z"):
            raise SupabaseContractError(f"{label} is invalid")
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise SupabaseContractError(f"{label} is invalid") from exc
        if parsed.tzinfo is None or parsed.utcoffset() != UTC.utcoffset(parsed):
            raise SupabaseContractError(f"{label} is invalid")
        return value

    def seal_total_loss_source_snapshot(
        self,
        work_item_id: str,
        processing_token: str,
        snapshot: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        source = self._package_mapping(snapshot, "Source snapshot")
        lineage = self._package_mapping(source.get("lineage"), "Source lineage")
        analysis = self._package_mapping(source.get("analysis"), "Source analysis")
        cutoff = self._package_mapping(
            source.get("evidenceCutoff"), "Evidence cutoff"
        )
        document = source.get("sourceDocument")
        extraction = source.get("extraction")
        if document is not None:
            document = self._package_mapping(document, "Source document")
        if extraction is not None:
            extraction = self._package_mapping(extraction, "Source extraction")
        byte_size = document.get("byteSize") if document is not None else None
        if byte_size is not None and (
            isinstance(byte_size, bool)
            or not isinstance(byte_size, int)
            or byte_size < 1
        ):
            raise SupabaseContractError("Source document byte size is invalid")
        current_observed_date = cutoff.get("currentObservedDate")
        if not isinstance(current_observed_date, str):
            raise SupabaseContractError("Evidence cutoff is invalid")
        payload = self._rpc(
            "seal_total_loss_source_snapshot",
            {
                "requested_work_item_id": _canonical_uuid(
                    work_item_id, "Work item ID"
                ),
                "requested_processing_token": _canonical_uuid(
                    processing_token, "Processing token"
                ),
                "requested_source_snapshot_id": _canonical_uuid(
                    lineage.get("sourceSnapshotId"), "Source snapshot ID"
                ),
                "requested_source_document_media_type": (
                    document.get("detectedMediaType") if document is not None else None
                ),
                "requested_source_document_byte_size": byte_size,
                "requested_source_document_sha256": (
                    self._package_digest(document.get("sha256"), "Document digest")
                    if document is not None
                    else None
                ),
                "requested_analysis_artifact_digest": self._package_digest(
                    analysis.get("artifactDigest"), "Analysis artifact digest"
                ),
                "requested_normalized_extraction_digest": (
                    self._package_digest(
                        extraction.get("normalizedReportDigest"),
                        "Normalized extraction digest",
                    )
                    if extraction is not None
                    else None
                ),
                "requested_evidence_cutoff": current_observed_date,
                "requested_snapshot_created_at": self._package_timestamp(
                    source.get("createdAt"), "Source snapshot creation timestamp"
                ),
                "requested_snapshot_schema_version": _canonical_commerce_code(
                    source.get("schemaVersion"),
                    COMMERCE_CODE_PATTERN,
                    "Source snapshot schema version",
                ),
                "requested_source_snapshot": dict(source),
                "requested_snapshot_digest": self._package_digest(
                    source.get("snapshotDigest"), "Source snapshot digest"
                ),
            },
        )
        return self._single_rpc_row(payload, "Source snapshot persistence")

    def persist_total_loss_final_assessment(
        self,
        work_item_id: str,
        processing_token: str,
        source_snapshot_id: str,
        assessment: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        value = self._package_mapping(assessment, "Final assessment")
        supported_range = value.get("supportedRange")
        if supported_range is not None:
            supported_range = self._package_mapping(
                supported_range, "Supported range"
            )
        insurer_value = self._package_mapping(
            value.get("insurerValuationReviewed"), "Insurer valuation"
        )
        currency = (
            supported_range.get("currency")
            if supported_range is not None
            else insurer_value.get("currency")
        )
        comparison = self._package_mapping(
            value.get("preliminaryToFinalComparison"),
            "Preliminary-to-final comparison",
        )
        reason_codes = comparison.get("reasonCodes")
        findings = value.get("findings")
        limitations = value.get("limitations")
        if not isinstance(reason_codes, list):
            raise SupabaseContractError("Assessment reason codes are invalid")
        if not isinstance(findings, list) or not isinstance(limitations, list):
            raise SupabaseContractError("Assessment findings are invalid")
        payload = self._rpc(
            "persist_total_loss_final_assessment",
            {
                "requested_work_item_id": _canonical_uuid(
                    work_item_id, "Work item ID"
                ),
                "requested_processing_token": _canonical_uuid(
                    processing_token, "Processing token"
                ),
                "requested_source_snapshot_id": _canonical_uuid(
                    source_snapshot_id, "Source snapshot ID"
                ),
                "requested_conclusion_code": _canonical_commerce_code(
                    value.get("finalClassification"),
                    re.compile(r"[A-Z][A-Z0-9_]{0,63}"),
                    "Assessment conclusion",
                ),
                "requested_currency": _canonical_currency(
                    currency, "Assessment currency"
                ),
                "requested_range_low_minor_units": (
                    supported_range.get("lowMinorUnits")
                    if supported_range is not None
                    else None
                ),
                "requested_range_median_minor_units": (
                    supported_range.get("medianMinorUnits")
                    if supported_range is not None
                    else None
                ),
                "requested_range_high_minor_units": (
                    supported_range.get("highMinorUnits")
                    if supported_range is not None
                    else None
                ),
                "requested_findings": findings,
                "requested_limitations": limitations,
                "requested_reason_codes": reason_codes,
                "requested_preliminary_to_final_comparison": dict(comparison),
                "requested_assessment": dict(value),
                "requested_methodology_version": _canonical_commerce_code(
                    value.get("methodologyVersion"),
                    COMMERCE_CODE_PATTERN,
                    "Assessment methodology version",
                ),
                "requested_schema_version": _canonical_commerce_code(
                    value.get("schemaVersion"),
                    COMMERCE_CODE_PATTERN,
                    "Assessment schema version",
                ),
                "requested_assessment_digest": self._package_digest(
                    value.get("assessmentDigest"), "Assessment digest"
                ),
            },
        )
        return self._single_rpc_row(payload, "Final assessment persistence")

    def complete_total_loss_package_work_item(
        self,
        work_item_id: str,
        processing_token: str,
        final_assessment_id: str,
        package_status: str,
        reason_code: str | None = None,
    ) -> bool:
        selected_status = self._canonical_choice(
            package_status,
            {"assessment_ready", "review_required", "new_evidence_required"},
            "Package status",
        )
        if reason_code is not None:
            reason_code = _canonical_commerce_code(
                reason_code,
                re.compile(r"[A-Z][A-Z0-9_]{0,63}"),
                "Package reason code",
            )
        payload = self._rpc(
            "complete_total_loss_package_work_item",
            {
                "requested_work_item_id": _canonical_uuid(
                    work_item_id, "Work item ID"
                ),
                "requested_processing_token": _canonical_uuid(
                    processing_token, "Processing token"
                ),
                "requested_final_assessment_id": _canonical_uuid(
                    final_assessment_id, "Final assessment ID"
                ),
                "requested_package_status": selected_status,
                "requested_reason_code": reason_code,
            },
        )
        return self._rpc_boolean(payload, "Package work completion")

    def fail_total_loss_package_work_item(
        self,
        work_item_id: str,
        processing_token: str,
        failure_code: str,
        failure_kind: str,
        retry_delay_seconds: int,
    ) -> bool:
        selected_kind = self._canonical_choice(
            failure_kind,
            {"retryable", "review_required", "terminal"},
            "Package failure kind",
        )
        delay: int | None
        if selected_kind == "retryable":
            if (
                isinstance(retry_delay_seconds, bool)
                or not isinstance(retry_delay_seconds, int)
                or not 1 <= retry_delay_seconds <= 86400
            ):
                raise SupabaseContractError("Package retry delay is invalid")
            delay = retry_delay_seconds
        else:
            delay = None
        payload = self._rpc(
            "fail_total_loss_package_work_item",
            {
                "requested_work_item_id": _canonical_uuid(
                    work_item_id, "Work item ID"
                ),
                "requested_processing_token": _canonical_uuid(
                    processing_token, "Processing token"
                ),
                "requested_failure_code": _canonical_commerce_code(
                    failure_code,
                    re.compile(r"[A-Z][A-Z0-9_]{0,63}"),
                    "Package failure code",
                ),
                "requested_failure_kind": selected_kind,
                "requested_retry_delay_seconds": delay,
            },
        )
        return self._rpc_boolean(payload, "Package work failure")

    @staticmethod
    def _canonical_boolean(value: Any, label: str) -> bool:
        if not isinstance(value, bool):
            raise SupabaseContractError(f"{label} is invalid")
        return value

    @staticmethod
    def _canonical_positive_integer(value: Any, label: str) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise SupabaseContractError(f"{label} is invalid")
        return value

    @staticmethod
    def _canonical_choice(value: Any, choices: set[str], label: str) -> str:
        if not isinstance(value, str) or value not in choices:
            raise SupabaseContractError(f"{label} is invalid")
        return value

    def get_total_loss_analysis_status(
        self, case_id: str, user_id: str
    ) -> Mapping[str, Any]:
        payload = self._rpc(
            "get_total_loss_analysis_status",
            {
                "case_id": _canonical_uuid(case_id, "Case ID"),
                "user_id": _canonical_uuid(user_id, "User ID"),
            },
        )
        return self._single_rpc_row(payload, "Analysis status")

    def claim_vehicle_trim_cache(
        self,
        lookup_key: str,
        vehicle_year: int,
        vehicle_make: str,
        vehicle_model: str,
        generation_token: str,
    ) -> Mapping[str, Any]:
        if (
            isinstance(vehicle_year, bool)
            or not isinstance(vehicle_year, int)
            or not 1981 <= vehicle_year <= 9999
        ):
            raise SupabaseContractError("Vehicle year is invalid")
        payload = self._rpc(
            "claim_vehicle_trim_cache",
            {
                "requested_lookup_key": _canonical_cache_text(
                    lookup_key,
                    "Vehicle trim lookup key",
                    MAX_VEHICLE_TRIM_CACHE_KEY_CHARACTERS,
                ),
                "requested_vehicle_year": vehicle_year,
                "requested_vehicle_make": _canonical_cache_text(
                    vehicle_make,
                    "Vehicle make",
                    MAX_VEHICLE_TRIM_CACHE_TEXT_CHARACTERS,
                ),
                "requested_vehicle_model": _canonical_cache_text(
                    vehicle_model,
                    "Vehicle model",
                    MAX_VEHICLE_TRIM_CACHE_TEXT_CHARACTERS,
                ),
                "requested_generation_token": _canonical_uuid(
                    generation_token,
                    "Vehicle trim generation token",
                ),
            },
            retry_ambiguous_claim=True,
        )
        return self._single_rpc_row(payload, "Vehicle trim cache claim")

    def complete_vehicle_trim_cache(
        self,
        lookup_key: str,
        generation_token: str,
        model_identifier: str,
        trims: list[str],
    ) -> bool:
        if (
            not isinstance(trims, list)
            or len(trims) > MAX_VEHICLE_TRIM_CACHE_ITEMS
        ):
            raise SupabaseContractError("Vehicle trim cache items are invalid")
        canonical_trims = [
            _canonical_cache_text(
                value,
                "Vehicle trim cache item",
                MAX_VEHICLE_TRIM_CACHE_TEXT_CHARACTERS,
            )
            for value in trims
        ]
        if len({value.casefold() for value in canonical_trims}) != len(
            canonical_trims
        ):
            raise SupabaseContractError("Vehicle trim cache items are invalid")
        payload = self._rpc(
            "complete_vehicle_trim_cache",
            {
                "requested_lookup_key": _canonical_cache_text(
                    lookup_key,
                    "Vehicle trim lookup key",
                    MAX_VEHICLE_TRIM_CACHE_KEY_CHARACTERS,
                ),
                "requested_generation_token": _canonical_uuid(
                    generation_token,
                    "Vehicle trim generation token",
                ),
                "requested_model_identifier": _canonical_cache_text(
                    model_identifier,
                    "Vehicle trim model identifier",
                    MAX_VEHICLE_TRIM_CACHE_TEXT_CHARACTERS,
                ),
                "requested_trims": canonical_trims,
            },
        )
        return self._rpc_boolean(payload, "Vehicle trim cache completion")

    def release_vehicle_trim_cache(
        self,
        lookup_key: str,
        generation_token: str,
    ) -> bool:
        payload = self._rpc(
            "release_vehicle_trim_cache",
            {
                "requested_lookup_key": _canonical_cache_text(
                    lookup_key,
                    "Vehicle trim lookup key",
                    MAX_VEHICLE_TRIM_CACHE_KEY_CHARACTERS,
                ),
                "requested_generation_token": _canonical_uuid(
                    generation_token,
                    "Vehicle trim generation token",
                ),
            },
        )
        return self._rpc_boolean(payload, "Vehicle trim cache release")

    def get_owned_total_loss_report_storage_locator(
        self, case_id: str, access_token: str
    ) -> Mapping[str, Any]:
        canonical_case_id = _canonical_uuid(case_id, "Case ID")
        payload = self._user_rpc(
            "get_owned_total_loss_report_storage_locator",
            {"case_id": canonical_case_id},
            access_token,
        )
        row = self._single_rpc_row(payload, "Report storage locator")
        if row.get("case_id") != canonical_case_id:
            raise SupabaseContractError("Report storage locator is invalid")
        self._validated_storage_locator(canonical_case_id, row)
        owner_id = _canonical_uuid(row.get("storage_owner_id"), "Storage owner ID")
        if row.get("backup_object_path") != "/".join(
            (owner_id, canonical_case_id, "valuation-report-backup.pdf")
        ):
            raise SupabaseContractError("Report storage backup object is invalid")
        _canonical_uuid(row.get("finalized_upload_id"), "Report upload ID")
        return row

    @staticmethod
    def _analysis_input_revision(value: Any) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise SupabaseContractError("Analysis input revision is invalid")
        return value

    def get_total_loss_report_extraction(
        self,
        case_id: str,
        report_upload_id: str,
        analysis_input_revision: int,
    ) -> Mapping[str, Any] | None:
        payload = self._rpc(
            "get_total_loss_report_extraction",
            {
                "case_id": _canonical_uuid(case_id, "Case ID"),
                "report_upload_id": _canonical_uuid(
                    report_upload_id, "Report upload ID"
                ),
                "analysis_input_revision": self._analysis_input_revision(
                    analysis_input_revision
                ),
            },
        )
        if payload is None or payload == []:
            return None
        row = self._single_rpc_row(payload, "Report extraction")
        return self._validated_extraction_row(
            row,
            case_id=case_id,
            report_upload_id=report_upload_id,
            analysis_input_revision=analysis_input_revision,
        )

    @staticmethod
    def _validated_extraction_row(
        row: Mapping[str, Any],
        *,
        case_id: str,
        report_upload_id: str,
        analysis_input_revision: int,
    ) -> Mapping[str, Any]:
        if row.get("case_id") != _canonical_uuid(case_id, "Case ID"):
            raise SupabaseContractError("Report extraction response is invalid")
        if row.get("report_upload_id") != _canonical_uuid(
            report_upload_id, "Report upload ID"
        ):
            raise SupabaseContractError("Report extraction response is invalid")
        if row.get(
            "analysis_input_revision"
        ) != SupabaseHttpGateway._analysis_input_revision(
            analysis_input_revision
        ):
            raise SupabaseContractError("Report extraction response is invalid")
        provider = row.get("provider_name")
        if provider is not None and (
            not isinstance(provider, str)
            or not provider.strip()
            or len(provider) > MAX_EXTRACTION_PROVIDER_CHARACTERS
            or any(ord(character) < 32 or ord(character) == 127 for character in provider)
        ):
            raise SupabaseContractError("Report extraction response is invalid")
        status = row.get("extraction_status")
        if status not in {"needs_confirmation", "confirmed", "failed"}:
            raise SupabaseContractError("Report extraction response is invalid")
        confidence = row.get("confidence")
        if confidence is not None and (
            isinstance(confidence, bool)
            or not isinstance(confidence, (int, float))
            or not math.isfinite(float(confidence))
            or confidence < 0
            or confidence > 1
        ):
            raise SupabaseContractError("Report extraction response is invalid")
        schema_version = row.get("extraction_schema_version")
        if (
            not isinstance(schema_version, str)
            or EXTRACTION_SCHEMA_VERSION_PATTERN.fullmatch(schema_version) is None
        ):
            raise SupabaseContractError("Report extraction response is invalid")
        normalized = row.get("normalized_report")
        if (status == "failed" and normalized is not None) or (
            status != "failed" and not isinstance(normalized, Mapping)
        ):
            raise SupabaseContractError("Report extraction response is invalid")
        return row

    def persist_total_loss_report_extraction(
        self,
        case_id: str,
        report_upload_id: str,
        analysis_input_revision: int,
        provider_name: str | None,
        extraction_status: str,
        confidence: float | None,
        extraction_schema_version: str,
        normalized_report: Mapping[str, Any] | None,
    ) -> Mapping[str, Any]:
        if provider_name is not None and (
            not isinstance(provider_name, str)
            or not provider_name.strip()
            or len(provider_name.strip()) > MAX_EXTRACTION_PROVIDER_CHARACTERS
            or any(
                ord(character) < 32 or ord(character) == 127
                for character in provider_name
            )
        ):
            raise SupabaseContractError("Report provider name is invalid")
        if extraction_status not in {"needs_confirmation", "confirmed", "failed"}:
            raise SupabaseContractError("Report extraction status is invalid")
        if confidence is not None and (
            isinstance(confidence, bool)
            or not isinstance(confidence, (int, float))
            or not math.isfinite(float(confidence))
            or confidence < 0
            or confidence > 1
        ):
            raise SupabaseContractError("Report extraction confidence is invalid")
        if (
            not isinstance(extraction_schema_version, str)
            or EXTRACTION_SCHEMA_VERSION_PATTERN.fullmatch(
                extraction_schema_version.strip()
            )
            is None
        ):
            raise SupabaseContractError("Extraction schema version is invalid")
        if (extraction_status == "failed" and normalized_report is not None) or (
            extraction_status != "failed"
            and not isinstance(normalized_report, Mapping)
        ):
            raise SupabaseContractError("Normalized report is invalid")
        normalized_payload: dict[str, Any] | None = None
        if normalized_report is not None:
            try:
                encoded_report = json.dumps(
                    dict(normalized_report),
                    ensure_ascii=True,
                    allow_nan=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
            except (TypeError, ValueError) as exc:
                raise SupabaseContractError("Normalized report is invalid") from exc
            if len(encoded_report) > MAX_EXTRACTION_CACHE_BYTES:
                raise SupabaseContractError("Normalized report is too large")
            normalized_payload = json.loads(encoded_report)
        payload = self._rpc(
            "persist_total_loss_report_extraction",
            {
                "case_id": _canonical_uuid(case_id, "Case ID"),
                "report_upload_id": _canonical_uuid(
                    report_upload_id, "Report upload ID"
                ),
                "analysis_input_revision": self._analysis_input_revision(
                    analysis_input_revision
                ),
                "provider_name": (
                    provider_name.strip() if isinstance(provider_name, str) else None
                ),
                "extraction_status": extraction_status,
                "confidence": (
                    float(confidence) if confidence is not None else None
                ),
                "extraction_schema_version": extraction_schema_version.strip(),
                "normalized_report": normalized_payload,
            },
        )
        row = self._single_rpc_row(payload, "Report extraction persistence")
        return self._validated_extraction_row(
            row,
            case_id=case_id,
            report_upload_id=report_upload_id,
            analysis_input_revision=analysis_input_revision,
        )

    @staticmethod
    def _rpc_boolean(payload: Any, label: str) -> bool:
        if isinstance(payload, bool):
            return payload
        if isinstance(payload, list) and len(payload) == 1:
            value = payload[0]
            if isinstance(value, bool):
                return value
            if isinstance(value, Mapping) and len(value) == 1:
                result = next(iter(value.values()))
                if isinstance(result, bool):
                    return result
        if isinstance(payload, Mapping) and len(payload) == 1:
            result = next(iter(payload.values()))
            if isinstance(result, bool):
                return result
        raise SupabaseContractError(f"{label} response is invalid")

    def complete_total_loss_analysis(
        self,
        job_id: str,
        processing_token: str,
        run_id: str,
        artifact: Mapping[str, Any],
    ) -> bool:
        payload = self._rpc(
            "complete_total_loss_analysis",
            {
                "job_id": _canonical_uuid(job_id, "Job ID"),
                "processing_token": _canonical_uuid(
                    processing_token, "Processing token"
                ),
                "run_id": _canonical_uuid(run_id, "Run ID"),
                "artifact": dict(artifact),
            },
        )
        return self._rpc_boolean(payload, "Analysis completion")

    def fail_total_loss_analysis(
        self,
        job_id: str,
        processing_token: str,
        failure_code: str,
        retryable: bool,
    ) -> bool:
        payload = self._rpc(
            "fail_total_loss_analysis",
            {
                "job_id": _canonical_uuid(job_id, "Job ID"),
                "processing_token": _canonical_uuid(
                    processing_token, "Processing token"
                ),
                "failure_code": failure_code,
                "retryable": retryable,
            },
        )
        return self._rpc_boolean(payload, "Analysis failure")

    def get_owned_analysis_run(
        self, run_id: str, user_id: str
    ) -> Mapping[str, Any] | str | None:
        payload = self._rpc(
            "get_owned_analysis_run",
            {
                "run_id": _canonical_uuid(run_id, "Run ID"),
                "user_id": _canonical_uuid(user_id, "User ID"),
            },
        )
        if payload is None or payload == []:
            return None
        if isinstance(payload, list):
            if len(payload) != 1:
                raise SupabaseContractError(
                    "Owned analysis response is invalid"
                )
            payload = payload[0]
        if isinstance(payload, Mapping) and set(payload) == {"artifact"}:
            payload = payload["artifact"]
        if isinstance(payload, (Mapping, str)):
            return payload
        raise SupabaseContractError("Owned analysis response is invalid")

    @staticmethod
    def _storage_path(user_id: str, case_id: str) -> str:
        user = _canonical_uuid(user_id, "User ID")
        case = _canonical_uuid(case_id, "Case ID")
        return "/".join(
            quote(segment, safe="")
            for segment in (user, case, TOTAL_LOSS_REPORT_OBJECT)
        )

    @staticmethod
    def _validated_storage_locator(
        case_id: str, storage_locator: Mapping[str, Any]
    ) -> tuple[str, str]:
        canonical_case_id = _canonical_uuid(case_id, "Case ID")
        if not isinstance(storage_locator, Mapping):
            raise SupabaseContractError("Report storage locator is invalid")
        bucket = storage_locator.get("storage_bucket", storage_locator.get("bucket_id"))
        owner_id = storage_locator.get("storage_owner_id")
        object_path = storage_locator.get(
            "storage_object_path", storage_locator.get("canonical_object_path")
        )
        if bucket != CASE_FILES_BUCKET:
            raise SupabaseContractError("Report storage bucket is invalid")
        canonical_owner = _canonical_uuid(owner_id, "Storage owner ID")
        expected_path = "/".join(
            (canonical_owner, canonical_case_id, TOTAL_LOSS_REPORT_OBJECT)
        )
        if object_path != expected_path:
            raise SupabaseContractError("Report storage object is invalid")
        return bucket, expected_path

    @contextmanager
    def _materialize_report_object(
        self, bucket: str, object_path: str, cache_nonce: str
    ) -> Iterator[Path]:
        nonce = _canonical_uuid(cache_nonce, "Storage cache nonce")
        encoded_path = "/".join(
            quote(segment, safe="") for segment in object_path.split("/")
        )
        url = (
            f"{self._configuration.url}/storage/v1/object/authenticated/"
            f"{quote(bucket, safe='')}/{encoded_path}?cacheNonce={quote(nonce, safe='')}"
        )
        try:
            with self._client.stream(
                "GET", url, headers=self._admin_headers()
            ) as response:
                if response.status_code == 404:
                    raise SupabaseReportNotFoundError(
                        "Private report was not found"
                    )
                if response.status_code < 200 or response.status_code >= 300:
                    raise SupabaseUnavailableError(
                        "Private report storage is unavailable"
                    )
                declared_length = response.headers.get("content-length")
                if declared_length is not None:
                    try:
                        parsed_length = int(declared_length)
                    except ValueError as exc:
                        raise SupabaseReportInvalidError(
                            "Private report is invalid"
                        ) from exc
                    if parsed_length <= 0 or parsed_length > MAX_PDF_BYTES:
                        raise SupabaseReportInvalidError(
                            "Private report is invalid"
                        )

                with tempfile.TemporaryDirectory(
                    prefix="venfour-case-report-"
                ) as temporary_root:
                    destination = Path(temporary_root) / "report.pdf"
                    copied = 0
                    header = bytearray()
                    try:
                        with destination.open("xb") as output:
                            for chunk in response.iter_bytes(DOWNLOAD_CHUNK_BYTES):
                                if not chunk:
                                    continue
                                copied += len(chunk)
                                if copied > MAX_PDF_BYTES:
                                    raise SupabaseReportInvalidError(
                                        "Private report is invalid"
                                    )
                                if len(header) < 5:
                                    remaining = 5 - len(header)
                                    header.extend(chunk[:remaining])
                                output.write(chunk)
                    except OSError as exc:
                        raise SupabaseUnavailableError(
                            "Temporary report storage is unavailable"
                        ) from exc
                    if copied <= 0 or bytes(header) != b"%PDF-":
                        raise SupabaseReportInvalidError(
                            "Private report is invalid"
                        )
                    yield destination
        except (
            SupabaseReportNotFoundError,
            SupabaseReportInvalidError,
            SupabaseUnavailableError,
        ):
            raise
        except httpx.HTTPError as exc:
            raise SupabaseUnavailableError(
                "Private report storage is unavailable"
            ) from exc

    @contextmanager
    def materialize_total_loss_report(
        self, user_id: str, case_id: str, cache_nonce: str
    ) -> Iterator[Path]:
        object_path = self._storage_path(user_id, case_id)
        with self._materialize_report_object(
            CASE_FILES_BUCKET, object_path, cache_nonce
        ) as destination:
            yield destination

    @contextmanager
    def materialize_total_loss_report_from_locator(
        self,
        case_id: str,
        storage_locator: Mapping[str, Any],
        cache_nonce: str,
    ) -> Iterator[Path]:
        bucket, object_path = self._validated_storage_locator(
            case_id, storage_locator
        )
        with self._materialize_report_object(
            bucket, object_path, cache_nonce
        ) as destination:
            yield destination


__all__ = [
    "CASE_FILES_BUCKET",
    "CaseAnalysisGateway",
    "MAX_EXTRACTION_CACHE_BYTES",
    "ReportIngestionGateway",
    "SupabaseAuthenticationError",
    "SupabaseConfigurationError",
    "SupabaseContractError",
    "SupabaseGatewayError",
    "SupabaseHttpGateway",
    "SupabaseReportInvalidError",
    "SupabaseReportNotFoundError",
    "SupabaseServerConfiguration",
    "SupabaseUnavailableError",
    "TOTAL_LOSS_REPORT_OBJECT",
]
