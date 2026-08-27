"""Server-owned Stripe commerce and entitlement coordination.

Stripe is deliberately kept behind a narrow provider boundary.  The database
owns purchase eligibility, frozen order terms, checkout-attempt concurrency,
financial history, and entitlement transitions.  Browser reconciliation can
observe provider state, but only a verified webhook can fulfill an order.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Mapping, Protocol, runtime_checkable
from urllib.parse import urlencode, urlsplit
from uuid import UUID, uuid4

import stripe

from venfour.supabase_gateway import (
    SupabaseAuthenticationError,
    SupabaseContractError,
    SupabaseUnavailableError,
)


STRIPE_PROVIDER = "stripe"
MAX_STRIPE_WEBHOOK_BODY_BYTES = 256 * 1024
MAX_PROVIDER_IDENTIFIER_CHARACTERS = 255
SAFE_CODE_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
SAFE_PRODUCT_PATTERN = re.compile(r"[a-z][a-z0-9_-]{0,63}")
SAFE_REASON_PATTERN = re.compile(r"[A-Z][A-Z0-9_]{0,63}")
SAFE_EMAIL_PATTERN = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")
SAFE_PROVIDER_ID_PATTERN = re.compile(r"[A-Za-z0-9_]{4,255}")
STRIPE_DISPUTE_ID_PREFIXES = ("du_", "dp_")
CHECKOUT_METADATA_KEYS = frozenset(
    {"venfour_order_id", "venfour_checkout_attempt_id"}
)
REFUND_METADATA_KEYS = frozenset(
    {"venfour_order_id", "venfour_refund_request_id"}
)

SUPPORTED_CHECKOUT_EVENT_TYPES = frozenset(
    {
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
        "checkout.session.async_payment_failed",
        "checkout.session.expired",
    }
)
SUPPORTED_REFUND_EVENT_TYPES = frozenset(
    {
        "refund.created",
        "refund.updated",
        "refund.failed",
    }
)
SUPPORTED_DISPUTE_EVENT_TYPES = frozenset(
    {
        "charge.dispute.created",
        "charge.dispute.updated",
        "charge.dispute.closed",
        "charge.dispute.funds_withdrawn",
        "charge.dispute.funds_reinstated",
    }
)


class CommerceError(Exception):
    """Base class for bounded commerce failures."""


class CommerceInputError(CommerceError):
    """The caller supplied a malformed commerce request."""


class CommerceNotFoundError(CommerceError):
    """No commerce resource is visible through the owner boundary."""


class CommerceConflictError(CommerceError):
    """The requested commerce transition is not currently eligible."""


class CommerceUnavailableError(CommerceError):
    """A required commerce dependency is unavailable."""


class CommerceProviderError(CommerceUnavailableError):
    """Stripe could not complete or prove a requested operation."""


class CommerceProviderContractError(CommerceProviderError):
    """Stripe returned data outside the checked commerce contract."""


class CommerceWebhookSignatureError(CommerceInputError):
    """A Stripe webhook signature or signed envelope is invalid."""


class CommerceDuplicatePaymentError(CommerceConflictError):
    """A second successful payment requires operational remediation."""


@runtime_checkable
class EntitlementFulfillmentHook(Protocol):
    """Internal continuation invoked only after verified entitlement grant."""

    def ensure_for_entitlement(self, entitlement_id: str) -> Any: ...


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


def _request_uuid(value: Any, label: str) -> str:
    try:
        return _canonical_uuid(value, label)
    except SupabaseContractError as exc:
        raise CommerceInputError(f"{label} is invalid") from exc


def _provider_uuid(value: Any, label: str) -> str:
    try:
        return _canonical_uuid(value, label)
    except SupabaseContractError as exc:
        raise CommerceProviderContractError(f"{label} is invalid") from exc


def _provider_identifier(value: Any, prefix: str, label: str) -> str:
    if (
        not isinstance(value, str)
        or not value.startswith(prefix)
        or SAFE_PROVIDER_ID_PATTERN.fullmatch(value) is None
    ):
        raise CommerceProviderContractError(f"{label} is invalid")
    return value


def _dispute_identifier(value: Any, label: str) -> str:
    if (
        not isinstance(value, str)
        or not value.startswith(STRIPE_DISPUTE_ID_PREFIXES)
        or SAFE_PROVIDER_ID_PATTERN.fullmatch(value) is None
    ):
        raise CommerceProviderContractError(f"{label} is invalid")
    return value


def _database_provider_identifier(value: Any, prefix: str, label: str) -> str:
    try:
        return _provider_identifier(value, prefix, label)
    except CommerceProviderContractError as exc:
        raise SupabaseContractError(f"{label} is invalid") from exc


def _positive_minor_units(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise SupabaseContractError(f"{label} is invalid")
    return value


def _provider_positive_minor_units(value: Any, label: str) -> int:
    try:
        return _positive_minor_units(value, label)
    except SupabaseContractError as exc:
        raise CommerceProviderContractError(f"{label} is invalid") from exc


def _currency(value: Any, label: str) -> str:
    if not isinstance(value, str) or re.fullmatch(r"[A-Z]{3}", value) is None:
        raise SupabaseContractError(f"{label} is invalid")
    return value


def _provider_currency(value: Any) -> str:
    if not isinstance(value, str) or re.fullmatch(r"[a-zA-Z]{3}", value) is None:
        raise CommerceProviderContractError("Stripe currency is invalid")
    return value.upper()


def _unix_timestamp(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise CommerceProviderContractError(f"{label} is invalid")
    try:
        datetime.fromtimestamp(value, tz=UTC)
    except (OverflowError, OSError, ValueError) as exc:
        raise CommerceProviderContractError(f"{label} is invalid") from exc
    return value


def _timestamp_string(value: int) -> str:
    return datetime.fromtimestamp(value, tz=UTC).isoformat()


def _database_timestamp(value: Any, label: str) -> str:
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


def _normalized_email(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise SupabaseContractError(f"{label} is invalid")
    normalized = value.strip().lower()
    if (
        value != normalized
        or not 3 <= len(value) <= 320
        or SAFE_EMAIL_PATTERN.fullmatch(value) is None
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        raise SupabaseContractError(f"{label} is invalid")
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
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or (port is not None and not 1 <= port <= 65535)
    ):
        raise ValueError("public app origin configuration is invalid")
    return normalized


def _configured_secret(value: str, prefix: str, label: str) -> str:
    if (
        not isinstance(value, str)
        or not value.startswith(prefix)
        or not 16 <= len(value) <= 1024
        or any(character.isspace() for character in value)
        or any(ord(character) < 33 or ord(character) == 127 for character in value)
    ):
        raise ValueError(f"{label} configuration is invalid")
    return value


def _configured_code(value: str, pattern: re.Pattern[str], label: str) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise ValueError(f"{label} configuration is invalid")
    return value


@dataclass(frozen=True)
class StripeCommerceConfiguration:
    secret_key: str = field(repr=False)
    webhook_secret: str = field(repr=False)
    price_id: str
    product_identifier: str
    product_version: str
    terms_version: str
    refund_policy_version: str
    public_app_origin: str

    def __post_init__(self) -> None:
        secret = self.secret_key
        if isinstance(secret, str) and secret.startswith("sk_test_"):
            key_prefix = "sk_test_"
        elif isinstance(secret, str) and secret.startswith("sk_live_"):
            key_prefix = "sk_live_"
        else:
            raise ValueError("Stripe secret key configuration is invalid")
        object.__setattr__(
            self,
            "secret_key",
            _configured_secret(secret, key_prefix, "Stripe secret key"),
        )
        object.__setattr__(
            self,
            "webhook_secret",
            _configured_secret(
                self.webhook_secret, "whsec_", "Stripe webhook secret"
            ),
        )
        try:
            price_id = _provider_identifier(
                self.price_id, "price_", "Stripe Price ID"
            )
        except CommerceProviderContractError as exc:
            raise ValueError("Stripe Price ID configuration is invalid") from exc
        object.__setattr__(self, "price_id", price_id)
        object.__setattr__(
            self,
            "product_identifier",
            _configured_code(
                self.product_identifier, SAFE_PRODUCT_PATTERN, "product identifier"
            ),
        )
        for name in ("product_version", "terms_version", "refund_policy_version"):
            object.__setattr__(
                self,
                name,
                _configured_code(
                    getattr(self, name), SAFE_CODE_PATTERN, name.replace("_", " ")
                ),
            )
        object.__setattr__(
            self, "public_app_origin", _configured_origin(self.public_app_origin)
        )

    @property
    def livemode(self) -> bool:
        return self.secret_key.startswith("sk_live_")

    @classmethod
    def from_environment(cls, environment: Mapping[str, str]) -> "StripeCommerceConfiguration":
        names = {
            "secret_key": "STRIPE_SECRET_KEY",
            "webhook_secret": "STRIPE_WEBHOOK_SECRET",
            "price_id": "VENFOUR_TOTAL_LOSS_STRIPE_PRICE_ID",
            "product_identifier": "VENFOUR_TOTAL_LOSS_PRODUCT_IDENTIFIER",
            "product_version": "VENFOUR_TOTAL_LOSS_PRODUCT_VERSION",
            "terms_version": "VENFOUR_TOTAL_LOSS_TERMS_VERSION",
            "refund_policy_version": "VENFOUR_TOTAL_LOSS_REFUND_POLICY_VERSION",
            "public_app_origin": "VENFOUR_PUBLIC_APP_ORIGIN",
        }
        values = {field: environment.get(name, "") for field, name in names.items()}
        if not all(isinstance(value, str) and value for value in values.values()):
            raise ValueError("Stripe commerce configuration is unavailable")
        return cls(**values)


@dataclass(frozen=True)
class StripePrice:
    id: str
    unit_amount: int
    currency: str
    livemode: bool
    active: bool
    price_type: str
    product_id: str
    product_active: bool


@dataclass(frozen=True)
class StripeCheckoutSession:
    id: str
    url: str | None
    status: str
    payment_status: str
    mode: str
    expires_at: int
    livemode: bool
    client_reference_id: str | None
    customer_id: str | None
    customer_email: str | None
    payment_intent_id: str | None
    amount_total: int | None
    currency: str | None
    metadata: Mapping[str, str]
    line_item_price_id: str | None
    line_item_quantity: int | None


@dataclass(frozen=True)
class StripePaymentIntent:
    id: str
    status: str
    amount: int
    amount_received: int
    currency: str
    livemode: bool
    customer_id: str | None
    latest_charge_id: str | None
    metadata: Mapping[str, str]
    created: int


@dataclass(frozen=True)
class StripeRefund:
    id: str
    status: str
    amount: int
    currency: str
    livemode: bool
    payment_intent_id: str | None
    charge_id: str | None
    balance_transaction_id: str | None
    failure_balance_transaction_id: str | None
    metadata: Mapping[str, str]
    created: int


@dataclass(frozen=True)
class StripeCharge:
    id: str
    payment_intent_id: str | None
    currency: str
    livemode: bool


@dataclass(frozen=True)
class StripeDispute:
    id: str
    status: str
    amount: int
    currency: str
    livemode: bool
    charge_id: str
    created: int


@dataclass(frozen=True)
class StripeEvent:
    id: str
    type: str
    created: int
    livemode: bool
    api_version: str | None
    data_object_id: str
    refund_snapshot: StripeRefund | None = None
    dispute_snapshot: StripeDispute | None = None


def _plain_mapping(value: Any, label: str) -> Mapping[str, Any]:
    if hasattr(value, "to_dict_recursive"):
        value = value.to_dict_recursive()
    elif hasattr(value, "to_dict"):
        value = value.to_dict()
    if not isinstance(value, Mapping):
        raise CommerceProviderContractError(f"{label} is invalid")
    return value


def _optional_provider_id(value: Any, prefix: str, label: str) -> str | None:
    if value is None:
        return None
    if isinstance(value, Mapping):
        value = value.get("id")
    return _provider_identifier(value, prefix, label)


def _optional_provider_text(value: Any, label: str) -> str | None:
    if value is None:
        return None
    if (
        not isinstance(value, str)
        or not value
        or len(value) > 255
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        raise CommerceProviderContractError(f"{label} is invalid")
    return value


def _metadata(value: Any) -> Mapping[str, str]:
    if value is None:
        return {}
    row = _plain_mapping(value, "Stripe metadata")
    if len(row) > 20:
        raise CommerceProviderContractError("Stripe metadata is invalid")
    result: dict[str, str] = {}
    for key, item in row.items():
        if (
            not isinstance(key, str)
            or not isinstance(item, str)
            or not key
            or len(key) > 64
            or len(item) > 255
        ):
            raise CommerceProviderContractError("Stripe metadata is invalid")
        result[key] = item
    return result


def _has_exact_venfour_metadata(
    metadata: Mapping[str, str], expected_keys: frozenset[str]
) -> bool:
    venfour_keys = frozenset(
        key for key in metadata if key.startswith("venfour_")
    )
    if not venfour_keys:
        return False
    if venfour_keys != expected_keys:
        raise CommerceProviderContractError("Stripe Venfour metadata is invalid")
    return True


def _checkout_url(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > 2048:
        raise CommerceProviderContractError("Stripe Checkout URL is invalid")
    try:
        parsed = urlsplit(value)
    except ValueError as exc:
        raise CommerceProviderContractError("Stripe Checkout URL is invalid") from exc
    if (
        parsed.scheme != "https"
        or parsed.hostname != "checkout.stripe.com"
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise CommerceProviderContractError("Stripe Checkout URL is invalid")
    return value


@runtime_checkable
class StripeProviderGateway(Protocol):
    def verify_webhook(self, payload: bytes, signature: str) -> StripeEvent: ...

    def retrieve_price(self, price_id: str) -> StripePrice: ...

    def create_checkout_session(
        self,
        *,
        case_id: str,
        order_id: str,
        checkout_attempt_id: str,
        price_id: str,
        customer_email: str,
        success_url: str,
        cancel_url: str,
        idempotency_key: str,
    ) -> StripeCheckoutSession: ...

    def retrieve_checkout_session(self, session_id: str) -> StripeCheckoutSession: ...

    def retrieve_payment_intent(self, payment_intent_id: str) -> StripePaymentIntent: ...

    def create_refund(
        self,
        *,
        payment_intent_id: str,
        amount_minor_units: int,
        order_id: str,
        refund_request_id: str,
        idempotency_key: str,
    ) -> StripeRefund: ...

    def retrieve_refund(self, refund_id: str) -> StripeRefund: ...

    def retrieve_charge(self, charge_id: str) -> StripeCharge: ...

    def retrieve_dispute(self, dispute_id: str) -> StripeDispute: ...


class StripeSdkGateway:
    """Small checked adapter over the official Stripe Python SDK."""

    def __init__(
        self,
        configuration: StripeCommerceConfiguration,
        *,
        client: Any | None = None,
    ) -> None:
        if not isinstance(configuration, StripeCommerceConfiguration):
            raise TypeError("configuration must be StripeCommerceConfiguration")
        self._configuration = configuration
        self._client = client or stripe.StripeClient(
            configuration.secret_key,
            max_network_retries=2,
        )

    @staticmethod
    def _provider_call(call: Any, *args: Any, **kwargs: Any) -> Any:
        try:
            return call(*args, **kwargs)
        except stripe.StripeError as exc:
            raise CommerceProviderError("Stripe is unavailable") from exc
        except (TimeoutError, OSError) as exc:
            raise CommerceProviderError("Stripe is unavailable") from exc

    def verify_webhook(self, payload: bytes, signature: str) -> StripeEvent:
        if (
            not isinstance(payload, bytes)
            or not payload
            or len(payload) > MAX_STRIPE_WEBHOOK_BODY_BYTES
            or not isinstance(signature, str)
            or not signature
            or len(signature) > 4096
            or any(ord(character) < 32 or ord(character) == 127 for character in signature)
        ):
            raise CommerceWebhookSignatureError("Stripe signature is invalid")
        try:
            event = stripe.Webhook.construct_event(
                payload,
                signature,
                self._configuration.webhook_secret,
            )
        except (ValueError, stripe.SignatureVerificationError) as exc:
            raise CommerceWebhookSignatureError("Stripe signature is invalid") from exc
        row = _plain_mapping(event, "Stripe event")
        data = _plain_mapping(row.get("data"), "Stripe event data")
        obj = _plain_mapping(data.get("object"), "Stripe event object")
        event_id = _provider_identifier(row.get("id"), "evt_", "Stripe event ID")
        event_type = row.get("type")
        if (
            not isinstance(event_type, str)
            or not event_type
            or len(event_type) > 128
            or any(ord(character) < 32 or ord(character) == 127 for character in event_type)
        ):
            raise CommerceProviderContractError("Stripe event type is invalid")
        livemode = row.get("livemode")
        if not isinstance(livemode, bool):
            raise CommerceProviderContractError("Stripe event mode is invalid")
        api_version = row.get("api_version")
        if api_version is not None and (
            not isinstance(api_version, str)
            or not api_version
            or len(api_version) > 64
            or any(ord(character) < 32 or ord(character) == 127 for character in api_version)
        ):
            raise CommerceProviderContractError("Stripe API version is invalid")
        data_object_id = obj.get("id")
        if not isinstance(data_object_id, str) or not data_object_id:
            raise CommerceProviderContractError("Stripe event object is invalid")
        refund_snapshot: StripeRefund | None = None
        dispute_snapshot: StripeDispute | None = None
        if event_type in SUPPORTED_REFUND_EVENT_TYPES:
            refund_snapshot = self._refund(obj, expected_livemode=livemode)
            if (
                refund_snapshot.id != data_object_id
                or refund_snapshot.livemode != livemode
                or (
                    event_type == "refund.failed"
                    and refund_snapshot.status != "failed"
                )
            ):
                raise CommerceProviderContractError(
                    "Stripe refund event snapshot is invalid"
                )
        elif event_type in SUPPORTED_DISPUTE_EVENT_TYPES:
            dispute_snapshot = self._dispute(obj)
            if (
                dispute_snapshot.id != data_object_id
                or dispute_snapshot.livemode != livemode
            ):
                raise CommerceProviderContractError(
                    "Stripe dispute event snapshot is invalid"
                )
        return StripeEvent(
            id=event_id,
            type=event_type,
            created=_unix_timestamp(row.get("created"), "Stripe event timestamp"),
            livemode=livemode,
            api_version=api_version,
            data_object_id=data_object_id,
            refund_snapshot=refund_snapshot,
            dispute_snapshot=dispute_snapshot,
        )

    def retrieve_price(self, price_id: str) -> StripePrice:
        price_id = _provider_identifier(price_id, "price_", "Stripe Price ID")
        value = self._provider_call(
            self._client.v1.prices.retrieve,
            price_id,
            {"expand": ["product"]},
        )
        row = _plain_mapping(value, "Stripe Price")
        product = _plain_mapping(row.get("product"), "Stripe Product")
        active = row.get("active")
        product_active = product.get("active")
        livemode = row.get("livemode")
        if not all(isinstance(item, bool) for item in (active, product_active, livemode)):
            raise CommerceProviderContractError("Stripe Price is invalid")
        price_type = row.get("type")
        if price_type not in {"one_time", "recurring"}:
            raise CommerceProviderContractError("Stripe Price type is invalid")
        result = StripePrice(
            id=_provider_identifier(row.get("id"), "price_", "Stripe Price ID"),
            unit_amount=_provider_positive_minor_units(
                row.get("unit_amount"), "Stripe amount"
            ),
            currency=_provider_currency(row.get("currency")),
            livemode=livemode,
            active=active,
            price_type=price_type,
            product_id=_provider_identifier(
                product.get("id"), "prod_", "Stripe Product ID"
            ),
            product_active=product_active,
        )
        if result.id != price_id:
            raise CommerceProviderContractError("Stripe Price identity changed")
        return result

    def create_checkout_session(
        self,
        *,
        case_id: str,
        order_id: str,
        checkout_attempt_id: str,
        price_id: str,
        customer_email: str,
        success_url: str,
        cancel_url: str,
        idempotency_key: str,
    ) -> StripeCheckoutSession:
        metadata = {
            "venfour_order_id": order_id,
            "venfour_checkout_attempt_id": checkout_attempt_id,
        }
        value = self._provider_call(
            self._client.v1.checkout.sessions.create,
            {
                "mode": "payment",
                "payment_method_types": ["card"],
                "adaptive_pricing": {"enabled": False},
                "line_items": [{"price": price_id, "quantity": 1}],
                "customer_email": customer_email,
                "client_reference_id": order_id,
                "success_url": success_url,
                "cancel_url": cancel_url,
                "metadata": metadata,
                "payment_intent_data": {"metadata": metadata},
            },
            {"idempotency_key": idempotency_key},
        )
        return self._checkout_session(value, fallback_price_id=price_id)

    def retrieve_checkout_session(self, session_id: str) -> StripeCheckoutSession:
        session_id = _provider_identifier(
            session_id, "cs_", "Stripe Checkout Session ID"
        )
        value = self._provider_call(
            self._client.v1.checkout.sessions.retrieve,
            session_id,
            {"expand": ["line_items.data.price", "payment_intent"]},
        )
        result = self._checkout_session(value)
        if result.id != session_id:
            raise CommerceProviderContractError(
                "Stripe Checkout Session identity changed"
            )
        return result

    def _checkout_session(
        self, value: Any, *, fallback_price_id: str | None = None
    ) -> StripeCheckoutSession:
        row = _plain_mapping(value, "Stripe Checkout Session")
        metadata = _metadata(row.get("metadata"))
        is_venfour = _has_exact_venfour_metadata(
            metadata, CHECKOUT_METADATA_KEYS
        )
        status = row.get("status")
        payment_status = row.get("payment_status")
        mode = row.get("mode")
        livemode = row.get("livemode")
        if status not in {"open", "complete", "expired"}:
            raise CommerceProviderContractError("Stripe Checkout status is invalid")
        if payment_status not in {"unpaid", "paid", "no_payment_required"}:
            raise CommerceProviderContractError("Stripe payment status is invalid")
        if mode not in {"payment", "setup", "subscription"} or not isinstance(
            livemode, bool
        ):
            raise CommerceProviderContractError("Stripe Checkout mode is invalid")
        price_id: str | None = None
        quantity: int | None = None
        client_reference_id = _optional_provider_text(
            row.get("client_reference_id"), "Stripe client reference"
        )
        customer_id = _optional_provider_id(
            row.get("customer"), "cus_", "Stripe Customer ID"
        )
        customer_email: str | None = None
        payment_intent_id = _optional_provider_id(
            row.get("payment_intent"),
            "pi_",
            "Stripe PaymentIntent ID",
        )
        amount_total: int | None = None
        currency: str | None = None
        if is_venfour:
            line_items = row.get("line_items")
            line_data: Any = None
            if isinstance(line_items, Mapping):
                line_data = line_items.get("data")
            if isinstance(line_data, list) and len(line_data) == 1:
                line = _plain_mapping(line_data[0], "Stripe Checkout line item")
                price = line.get("price")
                if isinstance(price, Mapping):
                    price = price.get("id")
                price_id = _provider_identifier(
                    price, "price_", "Stripe Price ID"
                )
                quantity = line.get("quantity")
            elif fallback_price_id is not None:
                price_id = _provider_identifier(
                    fallback_price_id, "price_", "Stripe Price ID"
                )
                quantity = 1
            else:
                raise CommerceProviderContractError(
                    "Stripe Checkout line items are invalid"
                )
            if (
                isinstance(quantity, bool)
                or not isinstance(quantity, int)
                or quantity < 1
            ):
                raise CommerceProviderContractError(
                    "Stripe Checkout quantity is invalid"
                )
            client_reference_id = _provider_uuid(
                client_reference_id, "Stripe order reference"
            )
            customer_details = row.get("customer_details")
            customer_email = row.get("customer_email")
            if (
                isinstance(customer_details, Mapping)
                and customer_details.get("email") is not None
            ):
                customer_email = customer_details.get("email")
            if customer_email is not None:
                try:
                    customer_email = _normalized_email(
                        customer_email, "Stripe customer email"
                    )
                except SupabaseContractError as exc:
                    raise CommerceProviderContractError(
                        "Stripe customer email is invalid"
                    ) from exc
            amount_total = _provider_positive_minor_units(
                row.get("amount_total"), "Stripe total"
            )
            currency = _provider_currency(row.get("currency"))
        return StripeCheckoutSession(
            id=_provider_identifier(
                row.get("id"), "cs_", "Stripe Checkout Session ID"
            ),
            url=_checkout_url(row.get("url")),
            status=status,
            payment_status=payment_status,
            mode=mode,
            expires_at=_unix_timestamp(row.get("expires_at"), "Stripe Checkout expiry"),
            livemode=livemode,
            client_reference_id=client_reference_id,
            customer_id=customer_id,
            customer_email=customer_email,
            payment_intent_id=payment_intent_id,
            amount_total=amount_total,
            currency=currency,
            metadata=metadata,
            line_item_price_id=price_id,
            line_item_quantity=quantity,
        )

    def retrieve_payment_intent(self, payment_intent_id: str) -> StripePaymentIntent:
        payment_intent_id = _provider_identifier(
            payment_intent_id, "pi_", "Stripe PaymentIntent ID"
        )
        value = self._provider_call(
            self._client.v1.payment_intents.retrieve,
            payment_intent_id,
            {"expand": ["latest_charge"]},
        )
        row = _plain_mapping(value, "Stripe PaymentIntent")
        livemode = row.get("livemode")
        if not isinstance(livemode, bool):
            raise CommerceProviderContractError("Stripe PaymentIntent mode is invalid")
        status = row.get("status")
        if not isinstance(status, str) or not status or len(status) > 64:
            raise CommerceProviderContractError("Stripe PaymentIntent status is invalid")
        result = StripePaymentIntent(
            id=_provider_identifier(row.get("id"), "pi_", "Stripe PaymentIntent ID"),
            status=status,
            amount=_provider_positive_minor_units(
                row.get("amount"), "Stripe payment amount"
            ),
            amount_received=_provider_positive_minor_units(
                row.get("amount_received"), "Stripe amount received"
            ),
            currency=_provider_currency(row.get("currency")),
            livemode=livemode,
            customer_id=_optional_provider_id(row.get("customer"), "cus_", "Stripe Customer ID"),
            latest_charge_id=_optional_provider_id(
                row.get("latest_charge"), "ch_", "Stripe Charge ID"
            ),
            metadata=_metadata(row.get("metadata")),
            created=_unix_timestamp(row.get("created"), "Stripe payment timestamp"),
        )
        if result.id != payment_intent_id:
            raise CommerceProviderContractError(
                "Stripe PaymentIntent identity changed"
            )
        return result

    def create_refund(
        self,
        *,
        payment_intent_id: str,
        amount_minor_units: int,
        order_id: str,
        refund_request_id: str,
        idempotency_key: str,
    ) -> StripeRefund:
        value = self._provider_call(
            self._client.v1.refunds.create,
            {
                "payment_intent": payment_intent_id,
                "amount": amount_minor_units,
                "metadata": {
                    "venfour_order_id": order_id,
                    "venfour_refund_request_id": refund_request_id,
                },
            },
            {"idempotency_key": idempotency_key},
        )
        return self._refund(
            value,
            expected_livemode=self._configuration.livemode,
        )

    def retrieve_refund(self, refund_id: str) -> StripeRefund:
        refund_id = _provider_identifier(refund_id, "re_", "Stripe Refund ID")
        value = self._provider_call(self._client.v1.refunds.retrieve, refund_id)
        result = self._refund(
            value,
            expected_livemode=self._configuration.livemode,
        )
        if result.id != refund_id:
            raise CommerceProviderContractError("Stripe Refund identity changed")
        return result

    @staticmethod
    def _refund(value: Any, *, expected_livemode: bool) -> StripeRefund:
        row = _plain_mapping(value, "Stripe Refund")
        if not isinstance(expected_livemode, bool):
            raise CommerceProviderContractError("Stripe Refund mode is invalid")
        metadata = _metadata(row.get("metadata"))
        is_venfour = _has_exact_venfour_metadata(
            metadata, REFUND_METADATA_KEYS
        )
        status = row.get("status")
        if status not in {
            "pending",
            "requires_action",
            "succeeded",
            "failed",
            "canceled",
        }:
            raise CommerceProviderContractError("Stripe Refund status is invalid")
        if "livemode" in row:
            object_livemode = row.get("livemode")
            if (
                not isinstance(object_livemode, bool)
                or object_livemode != expected_livemode
            ):
                raise CommerceProviderContractError("Stripe Refund mode is invalid")
        payment_intent_id = _optional_provider_id(
            row.get("payment_intent"),
            "pi_",
            "Stripe PaymentIntent ID",
        )
        charge_id = _optional_provider_id(
            row.get("charge"), "ch_", "Stripe Charge ID"
        )
        balance_transaction_id = _optional_provider_id(
            row.get("balance_transaction"),
            "txn_",
            "Stripe refund BalanceTransaction ID",
        )
        failure_balance_transaction_id = _optional_provider_id(
            row.get("failure_balance_transaction"),
            "txn_",
            "Stripe refund failure BalanceTransaction ID",
        )
        if is_venfour:
            if payment_intent_id is None:
                raise CommerceProviderContractError(
                    "Stripe PaymentIntent ID is invalid"
                )
            if status not in {"failed", "canceled"} and (
                failure_balance_transaction_id is not None
            ):
                raise CommerceProviderContractError(
                    "Stripe refund reversal is invalid"
                )
        return StripeRefund(
            id=_provider_identifier(row.get("id"), "re_", "Stripe Refund ID"),
            status=status,
            amount=_provider_positive_minor_units(
                row.get("amount"), "Stripe refund amount"
            ),
            currency=_provider_currency(row.get("currency")),
            livemode=expected_livemode,
            payment_intent_id=payment_intent_id,
            charge_id=charge_id,
            balance_transaction_id=balance_transaction_id,
            failure_balance_transaction_id=failure_balance_transaction_id,
            metadata=metadata,
            created=_unix_timestamp(row.get("created"), "Stripe refund timestamp"),
        )

    def retrieve_charge(self, charge_id: str) -> StripeCharge:
        charge_id = _provider_identifier(charge_id, "ch_", "Stripe Charge ID")
        value = self._provider_call(self._client.v1.charges.retrieve, charge_id)
        row = _plain_mapping(value, "Stripe Charge")
        livemode = row.get("livemode")
        if not isinstance(livemode, bool):
            raise CommerceProviderContractError("Stripe Charge mode is invalid")
        result = StripeCharge(
            id=_provider_identifier(row.get("id"), "ch_", "Stripe Charge ID"),
            payment_intent_id=_optional_provider_id(
                row.get("payment_intent"), "pi_", "Stripe PaymentIntent ID"
            ),
            currency=_provider_currency(row.get("currency")),
            livemode=livemode,
        )
        if result.id != charge_id:
            raise CommerceProviderContractError("Stripe Charge identity changed")
        return result

    def retrieve_dispute(self, dispute_id: str) -> StripeDispute:
        dispute_id = _dispute_identifier(dispute_id, "Stripe Dispute ID")
        value = self._provider_call(self._client.v1.disputes.retrieve, dispute_id)
        result = self._dispute(value)
        if result.id != dispute_id:
            raise CommerceProviderContractError("Stripe Dispute identity changed")
        return result

    @staticmethod
    def _dispute(value: Any) -> StripeDispute:
        row = _plain_mapping(value, "Stripe Dispute")
        livemode = row.get("livemode")
        status = row.get("status")
        if (
            not isinstance(livemode, bool)
            or not isinstance(status, str)
            or not status
            or len(status) > 64
            or any(
                ord(character) < 32 or ord(character) == 127
                for character in status
            )
        ):
            raise CommerceProviderContractError("Stripe Dispute is invalid")
        return StripeDispute(
            id=_dispute_identifier(row.get("id"), "Stripe Dispute ID"),
            status=status,
            amount=_provider_positive_minor_units(
                row.get("amount"), "Stripe dispute amount"
            ),
            currency=_provider_currency(row.get("currency")),
            livemode=livemode,
            charge_id=_provider_identifier(row.get("charge"), "ch_", "Stripe Charge ID"),
            created=_unix_timestamp(row.get("created"), "Stripe dispute timestamp"),
        )


@runtime_checkable
class CommerceDatabaseGateway(Protocol):
    def authenticate(self, access_token: str) -> str: ...

    def authorize_total_loss_checkout_preflight(
        self, case_id: str, purchaser_user_id: str
    ) -> Mapping[str, Any] | None: ...

    def reserve_total_loss_checkout(
        self,
        case_id: str,
        purchaser_user_id: str,
        client_request_id: str,
        configuration: StripeCommerceConfiguration,
        price: StripePrice,
    ) -> Mapping[str, Any] | None: ...

    def attach_total_loss_checkout_session(
        self, attempt_id: str, session: StripeCheckoutSession
    ) -> Mapping[str, Any] | None: ...

    def recover_total_loss_checkout_attempt(
        self, context: "CheckoutContext", session: StripeCheckoutSession
    ) -> Mapping[str, Any]: ...

    def authorize_total_loss_checkout_reconciliation(
        self, case_id: str, purchaser_user_id: str, session_id: str
    ) -> Mapping[str, Any] | None: ...

    def resolve_total_loss_checkout_context(
        self, order_id: str, checkout_attempt_id: str
    ) -> Mapping[str, Any] | None: ...

    def resolve_total_loss_checkout_context_by_session_id(
        self, external_checkout_session_id: str
    ) -> Mapping[str, Any] | None: ...

    def resolve_total_loss_payment_context(
        self, payment_intent_id: str
    ) -> Mapping[str, Any] | None: ...

    def reconcile_total_loss_checkout_attempt(
        self,
        case_id: str,
        purchaser_user_id: str,
        session: StripeCheckoutSession,
    ) -> Mapping[str, Any] | None: ...

    def fail_total_loss_checkout_attempt_from_webhook(
        self,
        order_id: str,
        checkout_attempt_id: str,
        external_checkout_session_id: str,
        external_event_id: str,
        webhook_processing_token: str,
        failure_code: str,
    ) -> Mapping[str, Any]: ...

    def expire_total_loss_checkout_attempt_from_webhook(
        self,
        order_id: str,
        checkout_attempt_id: str,
        external_checkout_session_id: str,
        external_event_id: str,
        webhook_processing_token: str,
        expires_at: int,
    ) -> Mapping[str, Any]: ...

    def claim_stripe_webhook_event(
        self,
        event: StripeEvent,
        payload_sha256: str,
        payload_size: int,
        processing_token: str,
    ) -> Mapping[str, Any]: ...

    def finalize_stripe_webhook_event(
        self,
        webhook_event_id: str,
        processing_token: str,
        outcome: str,
        case_id: str | None,
        order_id: str | None,
        failure_code: str | None,
    ) -> Mapping[str, Any]: ...

    def fulfill_total_loss_checkout_payment(
        self,
        context: "CheckoutContext",
        session: StripeCheckoutSession,
        payment_intent: StripePaymentIntent,
        external_event_id: str,
        webhook_processing_token: str,
        provider_occurred_at: int,
    ) -> Mapping[str, Any]: ...

    def reserve_total_loss_refund(
        self,
        case_id: str,
        order_id: str,
        payment_transaction_id: str,
        client_request_id: str,
        reason_code: str,
        access_policy: str,
    ) -> Mapping[str, Any] | None: ...

    def record_total_loss_refund_result(
        self,
        refund_request_id: str,
        refund: StripeRefund,
        external_event_id: str | None,
        failure_code: str | None,
        provider_occurred_at: int,
    ) -> Mapping[str, Any]: ...

    def record_total_loss_dispute(
        self,
        context: "PaymentContext",
        dispute: StripeDispute,
        external_event_id: str,
        event_type: str,
        dispute_status: str,
        provider_occurred_at: int,
    ) -> Mapping[str, Any]: ...


@dataclass(frozen=True)
class CheckoutContext:
    case_id: str
    order_id: str
    checkout_attempt_id: str
    purchaser_user_id: str
    purchaser_email: str
    external_price_identifier: str
    amount_minor_units: int
    currency: str
    provider_livemode: bool
    external_checkout_session_id: str | None
    external_payment_intent_id: str | None

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> "CheckoutContext":
        livemode = row.get("provider_livemode")
        if not isinstance(livemode, bool):
            raise SupabaseContractError("Checkout provider mode is invalid")
        session_id = row.get("external_checkout_session_id")
        intent_id = row.get("external_payment_intent_id")
        if session_id is not None:
            session_id = _database_provider_identifier(
                session_id, "cs_", "Checkout Session ID"
            )
        if intent_id is not None:
            intent_id = _database_provider_identifier(
                intent_id, "pi_", "PaymentIntent ID"
            )
        return cls(
            case_id=_canonical_uuid(row.get("case_id"), "Case ID"),
            order_id=_canonical_uuid(row.get("order_id"), "Order ID"),
            checkout_attempt_id=_canonical_uuid(
                row.get("checkout_attempt_id"), "Checkout attempt ID"
            ),
            purchaser_user_id=_canonical_uuid(
                row.get("purchaser_user_id"), "Purchaser user ID"
            ),
            purchaser_email=_normalized_email(
                row.get("purchaser_email"), "Purchaser email"
            ),
            external_price_identifier=_database_provider_identifier(
                row.get("external_price_identifier"), "price_", "Stripe Price ID"
            ),
            amount_minor_units=_positive_minor_units(
                row.get("amount_minor_units"), "Checkout amount"
            ),
            currency=_currency(row.get("currency"), "Checkout currency"),
            provider_livemode=livemode,
            external_checkout_session_id=session_id,
            external_payment_intent_id=intent_id,
        )


@dataclass(frozen=True)
class PaymentContext:
    case_id: str
    order_id: str
    checkout_attempt_id: str
    payment_transaction_id: str
    external_payment_intent_id: str
    amount_minor_units: int
    currency: str
    provider_livemode: bool

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> "PaymentContext":
        livemode = row.get("provider_livemode")
        if not isinstance(livemode, bool):
            raise SupabaseContractError("Payment provider mode is invalid")
        return cls(
            case_id=_canonical_uuid(row.get("case_id"), "Case ID"),
            order_id=_canonical_uuid(row.get("order_id"), "Order ID"),
            checkout_attempt_id=_canonical_uuid(
                row.get("checkout_attempt_id"), "Checkout attempt ID"
            ),
            payment_transaction_id=_canonical_uuid(
                row.get("payment_transaction_id"), "Payment transaction ID"
            ),
            external_payment_intent_id=_database_provider_identifier(
                row.get("external_payment_intent_id"), "pi_", "PaymentIntent ID"
            ),
            amount_minor_units=_positive_minor_units(
                row.get("amount_minor_units"), "Payment amount"
            ),
            currency=_currency(row.get("currency"), "Payment currency"),
            provider_livemode=livemode,
        )


@dataclass(frozen=True)
class CheckoutProjection:
    state: str
    checkout_url: str | None
    order_status: str | None
    checkout_status: str | None
    entitlement_status: str | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "checkoutUrl": self.checkout_url,
            "orderStatus": self.order_status,
            "checkoutStatus": self.checkout_status,
            "entitlementStatus": self.entitlement_status,
        }


@dataclass(frozen=True)
class RefundProjection:
    state: str
    refund_status: str
    order_status: str | None
    entitlement_status: str | None


class TotalLossCommerceService:
    """Coordinate checked Stripe operations with authoritative database RPCs."""

    def __init__(
        self,
        database: CommerceDatabaseGateway,
        provider: StripeProviderGateway,
        configuration: StripeCommerceConfiguration,
        entitlement_fulfillment_hook: EntitlementFulfillmentHook | None = None,
    ) -> None:
        if not isinstance(database, CommerceDatabaseGateway):
            raise TypeError("database must implement CommerceDatabaseGateway")
        if not isinstance(provider, StripeProviderGateway):
            raise TypeError("provider must implement StripeProviderGateway")
        if not isinstance(configuration, StripeCommerceConfiguration):
            raise TypeError("configuration must be StripeCommerceConfiguration")
        if (
            entitlement_fulfillment_hook is not None
            and not isinstance(
                entitlement_fulfillment_hook, EntitlementFulfillmentHook
            )
        ):
            raise TypeError(
                "entitlement_fulfillment_hook must expose "
                "ensure_for_entitlement(entitlement_id)"
            )
        self._database = database
        self._provider = provider
        self._configuration = configuration
        self._entitlement_fulfillment_hook = entitlement_fulfillment_hook

    def authenticate(self, access_token: str) -> str:
        return self._database.authenticate(access_token)

    def create_checkout(
        self, case_id: str, access_token: str, client_request_id: str
    ) -> CheckoutProjection:
        canonical_case_id = _request_uuid(case_id, "Case ID")
        request_id = _request_uuid(client_request_id, "Client request ID")
        purchaser_id = self._database.authenticate(access_token)
        preflight = self._database.authorize_total_loss_checkout_preflight(
            canonical_case_id, purchaser_id
        )
        if preflight is None:
            raise CommerceNotFoundError("Checkout was not found")
        checkout_available = preflight.get("checkout_available")
        if (
            _canonical_uuid(preflight.get("case_id"), "Case ID")
            != canonical_case_id
            or _canonical_uuid(
                preflight.get("purchaser_user_id"), "Purchaser user ID"
            )
            != purchaser_id
            or not isinstance(checkout_available, bool)
            or not isinstance(preflight.get("has_pending_order"), bool)
        ):
            raise SupabaseContractError("Checkout preflight response is invalid")
        _normalized_email(preflight.get("purchaser_email"), "Purchaser email")
        _canonical_uuid(
            preflight.get("preliminary_snapshot_id"),
            "Preliminary snapshot ID",
        )
        workflow_revision = preflight.get("workflow_revision")
        if (
            isinstance(workflow_revision, bool)
            or not isinstance(workflow_revision, int)
            or workflow_revision < 1
        ):
            raise SupabaseContractError("Checkout preflight response is invalid")
        if not checkout_available:
            raise CommerceConflictError("Checkout is unavailable")
        price = self._provider.retrieve_price(self._configuration.price_id)
        self._validate_price(price)
        row = self._database.reserve_total_loss_checkout(
            canonical_case_id,
            purchaser_id,
            request_id,
            self._configuration,
            price,
        )
        if row is None:
            raise CommerceNotFoundError("Checkout was not found")
        state = row.get("state")
        if state == "unavailable":
            raise CommerceConflictError("Checkout is unavailable")
        if state not in {"reserved", "existing", "already_fulfilled"}:
            raise SupabaseContractError("Checkout reservation response is invalid")
        if state == "already_fulfilled":
            return self._safe_projection(row, "already_fulfilled", None)
        context = CheckoutContext.from_row(row)
        if context.case_id != canonical_case_id or context.purchaser_user_id != purchaser_id:
            raise SupabaseContractError("Checkout reservation response is invalid")
        if (
            context.external_price_identifier != price.id
            or context.amount_minor_units != price.unit_amount
            or context.currency != price.currency
            or context.provider_livemode != price.livemode
        ):
            raise SupabaseContractError("Checkout reservation contract changed")

        if context.external_checkout_session_id is not None:
            session = self._provider.retrieve_checkout_session(
                context.external_checkout_session_id
            )
            self._validate_session(session, context)
            if session.status == "open":
                if session.url is None:
                    raise CommerceProviderContractError(
                        "Stripe Checkout URL is unavailable"
                    )
                return self._safe_projection(row, "checkout_ready", session.url)
            if session.payment_status == "paid":
                if session.payment_intent_id is None:
                    raise CommerceProviderContractError(
                        "Paid Checkout has no PaymentIntent"
                    )
                payment_intent = self._provider.retrieve_payment_intent(
                    session.payment_intent_id
                )
                self._validate_payment_intent(
                    payment_intent, session, context
                )
            reconciled = self._database.reconcile_total_loss_checkout_attempt(
                canonical_case_id, purchaser_id, session
            )
            self._validate_observed_reconciliation(
                reconciled, context, session
            )
            if session.status == "expired":
                replacement = self._database.reserve_total_loss_checkout(
                    canonical_case_id,
                    purchaser_id,
                    request_id,
                    self._configuration,
                    price,
                )
                if replacement is None:
                    raise CommerceUnavailableError(
                        "Checkout replacement was not reserved"
                    )
                replacement_state = replacement.get("state")
                if replacement_state == "already_fulfilled":
                    return self._safe_projection(
                        replacement, "already_fulfilled", None
                    )
                if replacement_state != "reserved":
                    raise CommerceConflictError(
                        "Checkout replacement is unavailable"
                    )
                row = replacement
                context = CheckoutContext.from_row(replacement)
                if (
                    context.case_id != canonical_case_id
                    or context.purchaser_user_id != purchaser_id
                    or context.external_checkout_session_id is not None
                    or context.external_price_identifier != price.id
                    or context.amount_minor_units != price.unit_amount
                    or context.currency != price.currency
                    or context.provider_livemode != price.livemode
                ):
                    raise SupabaseContractError(
                        "Checkout replacement response is invalid"
                    )
            else:
                return self._safe_projection(
                    reconciled, "payment_pending", None
                )

        success_url, cancel_url = self._return_urls(canonical_case_id)
        session = self._provider.create_checkout_session(
            case_id=canonical_case_id,
            order_id=context.order_id,
            checkout_attempt_id=context.checkout_attempt_id,
            price_id=context.external_price_identifier,
            customer_email=context.purchaser_email,
            success_url=success_url,
            cancel_url=cancel_url,
            idempotency_key=self._checkout_idempotency_key(
                context.checkout_attempt_id
            ),
        )
        self._validate_session(session, context)
        if session.status != "open":
            recovered = self._recover_pre_attach_checkout(context, session)
            if session.status == "complete":
                return self._safe_projection(
                    recovered, "payment_pending", None
                )
            replacement = self._database.reserve_total_loss_checkout(
                canonical_case_id,
                purchaser_id,
                request_id,
                self._configuration,
                price,
            )
            if replacement is None:
                raise CommerceUnavailableError(
                    "Checkout replacement was not reserved"
                )
            replacement_state = replacement.get("state")
            if replacement_state == "already_fulfilled":
                return self._safe_projection(
                    replacement, "already_fulfilled", None
                )
            if replacement_state != "reserved":
                raise CommerceConflictError(
                    "Checkout replacement is unavailable"
                )
            previous_context = context
            row = replacement
            context = CheckoutContext.from_row(replacement)
            if (
                context.case_id != canonical_case_id
                or context.order_id != previous_context.order_id
                or context.purchaser_user_id != purchaser_id
                or context.purchaser_email != previous_context.purchaser_email
                or context.checkout_attempt_id
                == previous_context.checkout_attempt_id
                or context.external_checkout_session_id is not None
                or context.external_price_identifier != price.id
                or context.amount_minor_units != price.unit_amount
                or context.currency != price.currency
                or context.provider_livemode != price.livemode
            ):
                raise SupabaseContractError(
                    "Checkout replacement response is invalid"
                )
            session = self._provider.create_checkout_session(
                case_id=canonical_case_id,
                order_id=context.order_id,
                checkout_attempt_id=context.checkout_attempt_id,
                price_id=context.external_price_identifier,
                customer_email=context.purchaser_email,
                success_url=success_url,
                cancel_url=cancel_url,
                idempotency_key=self._checkout_idempotency_key(
                    context.checkout_attempt_id
                ),
            )
            self._validate_session(session, context)
            if session.status != "open":
                recovered = self._recover_pre_attach_checkout(
                    context, session
                )
                if session.status == "complete":
                    return self._safe_projection(
                        recovered, "payment_pending", None
                    )
                raise CommerceConflictError(
                    "Checkout replacement is unavailable"
                )
        if (
            session.status != "open"
            or session.payment_status != "unpaid"
            or session.url is None
        ):
            raise CommerceProviderContractError(
                "New Stripe Checkout Session is not open"
            )
        attached = self._database.attach_total_loss_checkout_session(
            context.checkout_attempt_id, session
        )
        if attached is None:
            raise CommerceUnavailableError("Checkout Session was not persisted")
        attached_context = CheckoutContext.from_row(attached)
        if (
            attached_context.case_id != context.case_id
            or attached_context.order_id != context.order_id
            or attached_context.checkout_attempt_id != context.checkout_attempt_id
            or attached_context.external_checkout_session_id != session.id
        ):
            raise SupabaseContractError("Checkout attachment response is invalid")
        return self._safe_projection(attached, "checkout_ready", session.url)

    def reconcile_checkout(
        self, case_id: str, access_token: str, checkout_session_id: str
    ) -> CheckoutProjection:
        canonical_case_id = _request_uuid(case_id, "Case ID")
        try:
            session_id = _provider_identifier(
                checkout_session_id,
                "cs_",
                "Stripe Checkout Session ID",
            )
        except CommerceProviderContractError as exc:
            raise CommerceInputError("Checkout Session ID is invalid") from exc
        purchaser_id = self._database.authenticate(access_token)
        authorized = self._database.authorize_total_loss_checkout_reconciliation(
            canonical_case_id, purchaser_id, session_id
        )
        if authorized is None:
            raise CommerceNotFoundError("Checkout was not found")
        context = CheckoutContext.from_row(authorized)
        if (
            context.case_id != canonical_case_id
            or context.purchaser_user_id != purchaser_id
            or context.external_checkout_session_id != session_id
        ):
            raise SupabaseContractError("Checkout authorization response is invalid")
        session = self._provider.retrieve_checkout_session(session_id)
        self._validate_session(session, context)
        if session.payment_status == "paid":
            if session.payment_intent_id is None:
                raise CommerceProviderContractError(
                    "Paid Checkout has no PaymentIntent"
                )
            payment_intent = self._provider.retrieve_payment_intent(
                session.payment_intent_id
            )
            self._validate_payment_intent(payment_intent, session, context)
        projection = self._database.reconcile_total_loss_checkout_attempt(
            canonical_case_id, purchaser_id, session
        )
        if projection is None:
            raise CommerceNotFoundError("Checkout was not found")
        self._validate_observed_reconciliation(projection, context, session)
        return self._safe_projection(projection, "reconciled", None)

    def handle_webhook(self, payload: bytes, signature: str) -> str:
        event = self._provider.verify_webhook(payload, signature)
        if event.livemode != self._configuration.livemode:
            raise CommerceProviderContractError("Stripe event mode is invalid")
        # Every claim attempt needs a new fencing token. A deterministic token
        # would let a worker whose lease expired mutate state after a later
        # delivery reclaimed the same event.
        processing_token = str(uuid4())
        claim = self._database.claim_stripe_webhook_event(
            event,
            hashlib.sha256(payload).hexdigest(),
            len(payload),
            processing_token,
        )
        state = claim.get("state")
        if state in {"processed", "ignored"}:
            return state
        if state == "in_progress":
            raise CommerceUnavailableError("Webhook event is already processing")
        if state != "claimed":
            raise SupabaseContractError("Webhook claim response is invalid")
        webhook_event_id = _canonical_uuid(
            claim.get("webhook_event_id"), "Webhook event ID"
        )
        claimed_token = _canonical_uuid(
            claim.get("processing_token"), "Webhook processing token"
        )
        if claimed_token != processing_token:
            raise SupabaseContractError("Webhook claim response is invalid")
        case_id: str | None = None
        order_id: str | None = None
        try:
            if event.type in SUPPORTED_CHECKOUT_EVENT_TYPES:
                case_id, order_id = self._handle_checkout_event(
                    event, claimed_token
                )
            elif event.type in SUPPORTED_REFUND_EVENT_TYPES:
                case_id, order_id = self._handle_refund_event(event)
            elif event.type in SUPPORTED_DISPUTE_EVENT_TYPES:
                case_id, order_id = self._handle_dispute_event(event)
            else:
                case_id, order_id = None, None
            if case_id is None and order_id is None:
                outcome = "ignored"
            elif case_id is not None and order_id is not None:
                outcome = "processed"
            else:
                raise SupabaseContractError(
                    "Webhook processing result is invalid"
                )
            self._finalize_event(
                webhook_event_id,
                claimed_token,
                outcome,
                case_id,
                order_id,
                None,
            )
            return outcome
        except Exception as exc:
            failure_code = self._failure_code(exc)
            try:
                self._finalize_event(
                    webhook_event_id,
                    claimed_token,
                    "failed",
                    case_id,
                    order_id,
                    failure_code,
                )
            except Exception:
                pass
            raise

    def refund(
        self,
        *,
        case_id: str,
        order_id: str,
        payment_transaction_id: str,
        client_request_id: str,
        reason_code: str,
        access_policy: str,
    ) -> RefundProjection:
        canonical_case_id = _request_uuid(case_id, "Case ID")
        canonical_order_id = _request_uuid(order_id, "Order ID")
        canonical_payment_id = _request_uuid(
            payment_transaction_id, "Payment transaction ID"
        )
        canonical_request_id = _request_uuid(client_request_id, "Client request ID")
        if not isinstance(reason_code, str) or SAFE_REASON_PATTERN.fullmatch(reason_code) is None:
            raise CommerceInputError("Refund reason is invalid")
        if access_policy not in {"retain", "revoke"}:
            raise CommerceInputError("Refund access policy is invalid")
        row = self._database.reserve_total_loss_refund(
            canonical_case_id,
            canonical_order_id,
            canonical_payment_id,
            canonical_request_id,
            reason_code,
            access_policy,
        )
        if row is None:
            raise CommerceNotFoundError("Refund payment was not found")
        state = row.get("state")
        if state not in {"reserved", "existing", "already_succeeded"}:
            raise SupabaseContractError("Refund reservation response is invalid")
        refund_request_id = _canonical_uuid(
            row.get("refund_request_id"), "Refund request ID"
        )
        if (
            _canonical_uuid(
                row.get("payment_transaction_id"),
                "Payment transaction ID",
            )
            != canonical_payment_id
            or row.get("access_policy") != access_policy
        ):
            raise SupabaseContractError(
                "Refund reservation response is invalid"
            )
        amount = _positive_minor_units(row.get("amount_minor_units"), "Refund amount")
        currency = _currency(row.get("currency"), "Refund currency")
        payment_intent_id = _database_provider_identifier(
            row.get("external_payment_intent_id"), "pi_", "PaymentIntent ID"
        )
        livemode = row.get("provider_livemode")
        if not isinstance(livemode, bool) or livemode != self._configuration.livemode:
            raise SupabaseContractError("Refund provider mode is invalid")
        projection = self._refund_projection(
            row,
            case_id=canonical_case_id,
            order_id=canonical_order_id,
            refund_request_id=refund_request_id,
        )
        external_refund_id = row.get("external_refund_id")
        if external_refund_id is not None:
            external_refund_id = _database_provider_identifier(
                external_refund_id, "re_", "Stripe Refund ID"
            )
        if state in {"already_succeeded", "existing"}:
            if (
                (projection.refund_status == "creating")
                != (external_refund_id is None)
            ):
                raise SupabaseContractError(
                    "Refund reservation response is invalid"
                )
            return projection
        if external_refund_id is not None:
            raise SupabaseContractError("Refund reservation response is invalid")
        refund = self._provider.create_refund(
            payment_intent_id=payment_intent_id,
            amount_minor_units=amount,
            order_id=canonical_order_id,
            refund_request_id=refund_request_id,
            idempotency_key=self._refund_idempotency_key(refund_request_id),
        )
        self._validate_refund(
            refund,
            refund_request_id=refund_request_id,
            order_id=canonical_order_id,
            payment_intent_id=payment_intent_id,
            amount_minor_units=amount,
            currency=currency,
            livemode=livemode,
        )
        recorded = self._database.record_total_loss_refund_result(
            refund_request_id,
            refund,
            None,
            self._refund_failure_code(refund.status),
            refund.created,
        )
        return self._refund_projection(
            recorded,
            case_id=canonical_case_id,
            order_id=canonical_order_id,
            refund_request_id=refund_request_id,
        )

    def _handle_checkout_event(
        self, event: StripeEvent, processing_token: str
    ) -> tuple[str | None, str | None]:
        session = self._provider.retrieve_checkout_session(
            _provider_identifier(
                event.data_object_id, "cs_", "Stripe Checkout Session ID"
            )
        )
        identity = self._session_metadata_ids(session)
        if identity is None:
            context_row = (
                self._database.resolve_total_loss_checkout_context_by_session_id(
                    session.id
                )
            )
            if context_row is None:
                return None, None
            context = CheckoutContext.from_row(context_row)
            if (
                context.external_checkout_session_id != session.id
                or session.client_reference_id != context.order_id
            ):
                raise CommerceProviderContractError(
                    "Stripe Checkout contract is invalid"
                )
            raise CommerceProviderContractError(
                "Stripe Checkout Venfour metadata is missing"
            )
        order_id, attempt_id = identity
        context_row = self._database.resolve_total_loss_checkout_context(
            order_id, attempt_id
        )
        if context_row is None:
            raise CommerceNotFoundError("Webhook checkout was not found")
        context = CheckoutContext.from_row(context_row)
        self._validate_session(session, context)
        if event.type == "checkout.session.expired":
            if session.status != "expired" or session.payment_status != "unpaid":
                raise CommerceProviderContractError(
                    "Expired Checkout contract is invalid"
                )
            result = self._database.expire_total_loss_checkout_attempt_from_webhook(
                context.order_id,
                context.checkout_attempt_id,
                session.id,
                event.id,
                processing_token,
                session.expires_at,
            )
            self._validate_terminal_checkout_result(
                result, context, "expired"
            )
            return context.case_id, context.order_id
        if event.type == "checkout.session.async_payment_failed":
            result = self._database.fail_total_loss_checkout_attempt_from_webhook(
                context.order_id,
                context.checkout_attempt_id,
                session.id,
                event.id,
                processing_token,
                "ASYNC_PAYMENT_FAILED",
            )
            self._validate_terminal_checkout_result(result, context, "failed")
            return context.case_id, context.order_id
        if session.payment_status != "paid":
            reconciled = self._database.reconcile_total_loss_checkout_attempt(
                context.case_id, context.purchaser_user_id, session
            )
            self._validate_observed_reconciliation(
                reconciled, context, session
            )
            return context.case_id, context.order_id
        if session.payment_intent_id is None:
            raise CommerceProviderContractError("Paid Checkout has no PaymentIntent")
        payment_intent = self._provider.retrieve_payment_intent(
            session.payment_intent_id
        )
        self._validate_payment_intent(payment_intent, session, context)
        result = self._database.fulfill_total_loss_checkout_payment(
            context,
            session,
            payment_intent,
            event.id,
            processing_token,
            event.created,
        )
        outcome = result.get("outcome")
        if outcome == "duplicate_payment":
            raise CommerceDuplicatePaymentError(
                "Duplicate successful payment requires remediation"
            )
        if outcome not in {"fulfilled", "already_fulfilled"}:
            raise SupabaseContractError("Payment fulfillment response is invalid")
        entitlement_id = _canonical_uuid(
            result.get("entitlement_id"), "Entitlement ID"
        )
        if self._entitlement_fulfillment_hook is not None:
            # This hook runs before the signed Stripe event is finalized. A
            # database failure therefore remains retryable through webhook
            # redelivery, while the coordinator treats queue-dispatch failure
            # as non-fatal after its durable work item has committed.
            self._entitlement_fulfillment_hook.ensure_for_entitlement(
                entitlement_id
            )
        return context.case_id, context.order_id

    def _handle_refund_event(
        self, event: StripeEvent
    ) -> tuple[str | None, str | None]:
        snapshot = event.refund_snapshot
        if snapshot is None:
            raise CommerceProviderContractError(
                "Stripe refund event snapshot is invalid"
            )
        current_refund = self._provider.retrieve_refund(
            _provider_identifier(event.data_object_id, "re_", "Stripe Refund ID")
        )
        self._validate_refund_event_snapshot(
            event, snapshot, current_refund
        )
        refund = snapshot
        if not _has_exact_venfour_metadata(
            refund.metadata, REFUND_METADATA_KEYS
        ):
            if refund.payment_intent_id is None:
                return None, None
            context_row = self._database.resolve_total_loss_payment_context(
                refund.payment_intent_id
            )
            if context_row is None:
                return None, None
            local_context = CheckoutContext.from_row(context_row)
            if (
                local_context.external_payment_intent_id
                != refund.payment_intent_id
                or local_context.provider_livemode != refund.livemode
            ):
                raise CommerceProviderContractError(
                    "Stripe refund contract is invalid"
                )
            raise CommerceProviderContractError(
                "Stripe Refund Venfour metadata is missing"
            )
        refund_request_id = _provider_uuid(
            refund.metadata.get("venfour_refund_request_id"), "Refund request ID"
        )
        order_id = _provider_uuid(
            refund.metadata.get("venfour_order_id"), "Order ID"
        )
        if refund.payment_intent_id is None:
            raise CommerceProviderContractError(
                "Stripe refund PaymentIntent is invalid"
            )
        context_row = self._database.resolve_total_loss_payment_context(
            refund.payment_intent_id
        )
        if context_row is None:
            raise CommerceNotFoundError("Refund payment was not found")
        if context_row.get("payment_transaction_id") is None:
            local_context = CheckoutContext.from_row(context_row)
            if (
                local_context.external_payment_intent_id
                != refund.payment_intent_id
                or local_context.provider_livemode != refund.livemode
            ):
                raise CommerceProviderContractError(
                    "Stripe refund contract is invalid"
                )
            raise CommerceNotFoundError(
                "Refund payment is awaiting local fulfillment"
            )
        context = PaymentContext.from_row(context_row)
        self._validate_refund(
            current_refund,
            refund_request_id=refund_request_id,
            order_id=order_id,
            payment_intent_id=context.external_payment_intent_id,
            amount_minor_units=context.amount_minor_units,
            currency=context.currency,
            livemode=context.provider_livemode,
        )
        self._validate_refund(
            refund,
            refund_request_id=refund_request_id,
            order_id=order_id,
            payment_intent_id=context.external_payment_intent_id,
            amount_minor_units=context.amount_minor_units,
            currency=context.currency,
            livemode=context.provider_livemode,
        )
        result = self._database.record_total_loss_refund_result(
            refund_request_id,
            refund,
            event.id,
            self._refund_failure_code(refund.status),
            event.created,
        )
        self._refund_projection(
            result,
            case_id=context.case_id,
            order_id=context.order_id,
            refund_request_id=refund_request_id,
        )
        return context.case_id, context.order_id

    def _handle_dispute_event(
        self, event: StripeEvent
    ) -> tuple[str | None, str | None]:
        snapshot = event.dispute_snapshot
        if snapshot is None:
            raise CommerceProviderContractError(
                "Stripe dispute event snapshot is invalid"
            )
        current_dispute = self._provider.retrieve_dispute(
            _dispute_identifier(event.data_object_id, "Stripe Dispute ID")
        )
        if (
            current_dispute.id != snapshot.id
            or current_dispute.id != event.data_object_id
            or current_dispute.amount != snapshot.amount
            or current_dispute.currency != snapshot.currency
            or current_dispute.livemode != snapshot.livemode
            or current_dispute.charge_id != snapshot.charge_id
            or current_dispute.created != snapshot.created
        ):
            raise CommerceProviderContractError(
                "Stripe dispute event snapshot is invalid"
            )
        self._dispute_status(current_dispute.status)
        dispute = snapshot
        charge = self._provider.retrieve_charge(dispute.charge_id)
        if (
            charge.id != dispute.charge_id
            or charge.currency != dispute.currency
            or charge.livemode != dispute.livemode
        ):
            raise CommerceProviderContractError("Stripe dispute Charge is invalid")
        if charge.payment_intent_id is None:
            return None, None
        payment_intent = self._provider.retrieve_payment_intent(
            charge.payment_intent_id
        )
        if (
            payment_intent.id != charge.payment_intent_id
            or payment_intent.latest_charge_id != charge.id
            or payment_intent.currency != charge.currency
            or payment_intent.livemode != charge.livemode
        ):
            raise CommerceProviderContractError(
                "Stripe dispute PaymentIntent contract is invalid"
            )
        payment_identity = self._order_attempt_metadata_ids(
            payment_intent.metadata
        )
        context_row = self._database.resolve_total_loss_payment_context(
            charge.payment_intent_id
        )
        if context_row is None:
            if payment_identity is None:
                return None, None
            raise CommerceNotFoundError(
                "Dispute payment is awaiting local fulfillment"
            )
        if context_row.get("payment_transaction_id") is None:
            local_context = CheckoutContext.from_row(context_row)
            if (
                payment_identity
                != (
                    local_context.order_id,
                    local_context.checkout_attempt_id,
                )
                or payment_intent.id
                != local_context.external_payment_intent_id
                or payment_intent.amount
                != local_context.amount_minor_units
                or payment_intent.amount_received
                != local_context.amount_minor_units
                or payment_intent.currency != local_context.currency
                or payment_intent.livemode
                != local_context.provider_livemode
            ):
                raise CommerceProviderContractError(
                    "Stripe dispute PaymentIntent contract is invalid"
                )
            raise CommerceNotFoundError(
                "Dispute payment is awaiting local fulfillment"
            )
        context = PaymentContext.from_row(context_row)
        self._validate_dispute_payment_intent(
            payment_intent, charge, context
        )
        if (
            context.external_payment_intent_id != charge.payment_intent_id
            or context.currency != dispute.currency
            or context.provider_livemode != dispute.livemode
        ):
            raise CommerceProviderContractError("Stripe dispute contract is invalid")
        mapped_status = self._dispute_status(dispute.status)
        result = self._database.record_total_loss_dispute(
            context,
            dispute,
            event.id,
            event.type,
            mapped_status,
            event.created,
        )
        self._validate_dispute_result(result, context, event)
        return context.case_id, context.order_id

    @classmethod
    def _validate_dispute_result(
        cls,
        row: Mapping[str, Any],
        context: PaymentContext,
        event: StripeEvent,
    ) -> None:
        outcome = row.get("outcome")
        dispute_status = row.get("dispute_status")
        if (
            outcome not in {"applied", "stale", "duplicate"}
            or _canonical_uuid(row.get("case_id"), "Dispute case ID")
            != context.case_id
            or _canonical_uuid(row.get("order_id"), "Dispute order ID")
            != context.order_id
            or dispute_status not in {"active", "won", "lost"}
        ):
            raise SupabaseContractError("Dispute result response is invalid")
        _canonical_uuid(row.get("dispute_id"), "Dispute ID")
        transaction_id = row.get("financial_transaction_id")
        if transaction_id is not None:
            _canonical_uuid(transaction_id, "Financial transaction ID")
            if outcome != "applied" or event.type not in {
                "charge.dispute.funds_withdrawn",
                "charge.dispute.funds_reinstated",
            }:
                raise SupabaseContractError("Dispute result response is invalid")
        projection = (row.get("order_status"), row.get("entitlement_status"))
        valid_projections = {
            ("paid", "active"),
            ("disputed", "suspended"),
            ("refunded", "suspended"),
        }
        if dispute_status == "won":
            valid_projections.update(
                {
                    ("refunded", "refunded_access_retained"),
                    ("refunded", "revoked"),
                }
            )
        if projection not in valid_projections:
            raise SupabaseContractError("Dispute result response is invalid")
        cls._safe_projection(row, "reconciled", None)

    def _recover_pre_attach_checkout(
        self,
        context: CheckoutContext,
        session: StripeCheckoutSession,
    ) -> Mapping[str, Any]:
        if session.status == "expired":
            if session.payment_status != "unpaid":
                raise CommerceProviderContractError(
                    "Expired Checkout contract is invalid"
                )
        elif session.status == "complete":
            if session.payment_status in {"paid", "no_payment_required"}:
                if session.payment_intent_id is None:
                    raise CommerceProviderContractError(
                        "Paid Checkout has no PaymentIntent"
                    )
                payment_intent = self._provider.retrieve_payment_intent(
                    session.payment_intent_id
                )
                self._validate_payment_intent(
                    payment_intent, session, context
                )
            elif session.payment_status != "unpaid":
                raise CommerceProviderContractError(
                    "Completed Checkout contract is invalid"
                )
        else:
            raise CommerceProviderContractError(
                "Checkout recovery contract is invalid"
            )
        recovered = self._database.recover_total_loss_checkout_attempt(
            context, session
        )
        self._validate_pre_attach_checkout_recovery(
            recovered, context, session
        )
        return recovered

    @classmethod
    def _validate_pre_attach_checkout_recovery(
        cls,
        row: Mapping[str, Any],
        context: CheckoutContext,
        session: StripeCheckoutSession,
    ) -> None:
        expected_attempt_status = (
            "expired"
            if session.status == "expired"
            else (
                "open" if session.payment_status == "unpaid" else "complete"
            )
        )
        allowed_outcomes = (
            {"applied", "already_terminal"}
            if expected_attempt_status in {"expired", "complete"}
            else {"applied", "already_observed"}
        )
        if (
            row.get("outcome") not in allowed_outcomes
            or _canonical_uuid(row.get("case_id"), "Checkout case ID")
            != context.case_id
            or _canonical_uuid(row.get("order_id"), "Checkout order ID")
            != context.order_id
            or _canonical_uuid(
                row.get("checkout_attempt_id"), "Checkout attempt ID"
            )
            != context.checkout_attempt_id
            or row.get("order_status") != "pending"
            or row.get("attempt_status") != expected_attempt_status
            or row.get("entitlement_status") is not None
        ):
            raise SupabaseContractError(
                "Checkout recovery response is invalid"
            )
        cls._safe_projection(row, "reconciled", None)

    @classmethod
    def _validate_observed_reconciliation(
        cls,
        row: Mapping[str, Any] | None,
        context: CheckoutContext,
        session: StripeCheckoutSession,
    ) -> None:
        if row is None:
            raise SupabaseContractError("Checkout reconciliation response is invalid")
        expected_attempt_status = session.status
        if session.status == "complete" and session.payment_status == "unpaid":
            expected_attempt_status = "open"
        if (
            _canonical_uuid(row.get("case_id"), "Checkout case ID")
            != context.case_id
            or _canonical_uuid(row.get("order_id"), "Checkout order ID")
            != context.order_id
            or _canonical_uuid(
                row.get("checkout_attempt_id"), "Checkout attempt ID"
            )
            != context.checkout_attempt_id
        ):
            raise SupabaseContractError("Checkout reconciliation response is invalid")
        outcome = row.get("outcome")
        if outcome == "observed":
            coherent = row.get("attempt_status") == expected_attempt_status
        elif outcome == "already_terminal":
            coherent = (
                row.get("order_status") == "pending"
                and row.get("entitlement_status") is None
                and (
                    (
                        session.status == "complete"
                        and session.payment_status == "unpaid"
                        and row.get("attempt_status") == "failed"
                    )
                    or (
                        session.status == "expired"
                        and session.payment_status == "unpaid"
                        and row.get("attempt_status") == "expired"
                    )
                )
            )
        elif outcome == "stale":
            attempt_status = row.get("attempt_status")
            coherent_attempt = (
                attempt_status == "complete"
                and session.status == "complete"
                and session.payment_status in {"paid", "no_payment_required"}
            ) or (
                attempt_status == "failed"
                and session.status == "complete"
                and session.payment_status == "unpaid"
            ) or (
                attempt_status == "expired"
                and session.status == "expired"
                and session.payment_status == "unpaid"
            )
            coherent = coherent_attempt and cls._coherent_later_financial_state(
                row.get("order_status"), row.get("entitlement_status")
            )
        else:
            coherent = False
        if not coherent:
            raise SupabaseContractError("Checkout reconciliation response is invalid")
        cls._safe_projection(row, "reconciled", None)

    @classmethod
    def _validate_terminal_checkout_result(
        cls,
        row: Mapping[str, Any],
        context: CheckoutContext,
        expected_attempt_status: str,
    ) -> None:
        if (
            _canonical_uuid(row.get("case_id"), "Checkout case ID")
            != context.case_id
            or _canonical_uuid(row.get("order_id"), "Checkout order ID")
            != context.order_id
            or _canonical_uuid(
                row.get("checkout_attempt_id"), "Checkout attempt ID"
            )
            != context.checkout_attempt_id
            or row.get("attempt_status") != expected_attempt_status
        ):
            raise SupabaseContractError("Checkout terminal response is invalid")
        outcome = row.get("outcome")
        order_status = row.get("order_status")
        entitlement_status = row.get("entitlement_status")
        if outcome in {"applied", "already_terminal"}:
            coherent = order_status == "pending" and entitlement_status is None
        elif outcome == "stale":
            coherent = cls._coherent_later_financial_state(
                order_status, entitlement_status
            )
        else:
            coherent = False
        if not coherent:
            raise SupabaseContractError("Checkout terminal response is invalid")
        cls._safe_projection(row, "reconciled", None)

    @staticmethod
    def _coherent_later_financial_state(
        order_status: Any, entitlement_status: Any
    ) -> bool:
        return (order_status, entitlement_status) in {
            ("paid", "active"),
            ("refunded", "refunded_access_retained"),
            ("refunded", "revoked"),
            ("refunded", "suspended"),
            ("disputed", "suspended"),
            ("disputed", "revoked"),
            ("void", None),
        }

    def _validate_price(self, price: StripePrice) -> None:
        if (
            price.id != self._configuration.price_id
            or not price.active
            or not price.product_active
            or price.price_type != "one_time"
            or price.livemode != self._configuration.livemode
        ):
            raise CommerceConflictError("Configured Stripe Price is unavailable")

    @staticmethod
    def _session_metadata_ids(
        session: StripeCheckoutSession,
    ) -> tuple[str, str] | None:
        return TotalLossCommerceService._order_attempt_metadata_ids(
            session.metadata
        )

    @staticmethod
    def _order_attempt_metadata_ids(
        metadata: Mapping[str, str],
    ) -> tuple[str, str] | None:
        if not _has_exact_venfour_metadata(metadata, CHECKOUT_METADATA_KEYS):
            return None
        order_id = _provider_uuid(
            metadata.get("venfour_order_id"), "Stripe order metadata"
        )
        attempt_id = _provider_uuid(
            metadata.get("venfour_checkout_attempt_id"),
            "Stripe checkout-attempt metadata",
        )
        return order_id, attempt_id

    @classmethod
    def _validate_session(
        cls, session: StripeCheckoutSession, context: CheckoutContext
    ) -> None:
        identity = cls._session_metadata_ids(session)
        if identity is None:
            raise CommerceProviderContractError(
                "Stripe Checkout contract is invalid"
            )
        order_id, attempt_id = identity
        if (
            session.mode != "payment"
            or session.client_reference_id != context.order_id
            or order_id != context.order_id
            or attempt_id != context.checkout_attempt_id
            or session.line_item_price_id != context.external_price_identifier
            or session.line_item_quantity != 1
            or session.amount_total != context.amount_minor_units
            or session.currency != context.currency
            or session.livemode != context.provider_livemode
            or (
                context.external_checkout_session_id is not None
                and session.id != context.external_checkout_session_id
            )
            or (
                context.external_payment_intent_id is not None
                and session.payment_intent_id != context.external_payment_intent_id
            )
            or session.customer_email != context.purchaser_email
        ):
            raise CommerceProviderContractError("Stripe Checkout contract is invalid")

    @staticmethod
    def _validate_payment_intent(
        payment: StripePaymentIntent,
        session: StripeCheckoutSession,
        context: CheckoutContext,
    ) -> None:
        identity = TotalLossCommerceService._order_attempt_metadata_ids(
            payment.metadata
        )
        if (
            payment.id != session.payment_intent_id
            or payment.status != "succeeded"
            or payment.amount != context.amount_minor_units
            or payment.amount_received != context.amount_minor_units
            or payment.currency != context.currency
            or payment.livemode != context.provider_livemode
            or payment.customer_id != session.customer_id
            or identity != (context.order_id, context.checkout_attempt_id)
        ):
            raise CommerceProviderContractError("Stripe payment contract is invalid")

    @staticmethod
    def _validate_dispute_payment_intent(
        payment: StripePaymentIntent,
        charge: StripeCharge,
        context: PaymentContext,
    ) -> None:
        identity = TotalLossCommerceService._order_attempt_metadata_ids(
            payment.metadata
        )
        if (
            payment.id != charge.payment_intent_id
            or payment.id != context.external_payment_intent_id
            or payment.status != "succeeded"
            or payment.amount != context.amount_minor_units
            or payment.amount_received != context.amount_minor_units
            or payment.currency != context.currency
            or payment.livemode != context.provider_livemode
            or payment.latest_charge_id != charge.id
            or identity != (context.order_id, context.checkout_attempt_id)
        ):
            raise CommerceProviderContractError(
                "Stripe dispute PaymentIntent contract is invalid"
            )

    @staticmethod
    def _validate_refund(
        refund: StripeRefund,
        *,
        refund_request_id: str,
        order_id: str,
        payment_intent_id: str,
        amount_minor_units: int,
        currency: str,
        livemode: bool,
    ) -> None:
        financial_identity_is_valid = (
            refund.status == "succeeded"
            and refund.balance_transaction_id is not None
            and refund.failure_balance_transaction_id is None
        ) or (
            refund.status in {"failed", "canceled"}
            and (
                (
                    refund.balance_transaction_id is None
                    and refund.failure_balance_transaction_id is None
                )
                or (
                    refund.balance_transaction_id is not None
                    and refund.failure_balance_transaction_id is not None
                )
            )
        ) or (
            refund.status in {"pending", "requires_action"}
            and refund.failure_balance_transaction_id is None
        )
        if (
            refund.payment_intent_id != payment_intent_id
            or refund.amount != amount_minor_units
            or refund.currency != currency
            or refund.livemode != livemode
            or refund.metadata.get("venfour_refund_request_id") != refund_request_id
            or refund.metadata.get("venfour_order_id") != order_id
            or not financial_identity_is_valid
        ):
            raise CommerceProviderContractError("Stripe refund contract is invalid")

    @staticmethod
    def _validate_refund_event_snapshot(
        event: StripeEvent,
        snapshot: StripeRefund,
        current: StripeRefund,
    ) -> None:
        valid_statuses = {
            "pending",
            "requires_action",
            "succeeded",
            "failed",
            "canceled",
        }
        if (
            snapshot.id != event.data_object_id
            or current.id != snapshot.id
            or snapshot.status not in valid_statuses
            or current.status not in valid_statuses
            or (
                event.type == "refund.failed"
                and snapshot.status != "failed"
            )
            or current.amount != snapshot.amount
            or current.currency != snapshot.currency
            or current.livemode != snapshot.livemode
            or current.payment_intent_id != snapshot.payment_intent_id
            or current.charge_id != snapshot.charge_id
            or current.metadata != snapshot.metadata
            or current.created != snapshot.created
            or (
                snapshot.balance_transaction_id is not None
                and current.balance_transaction_id
                != snapshot.balance_transaction_id
            )
            or (
                snapshot.failure_balance_transaction_id is not None
                and current.failure_balance_transaction_id
                != snapshot.failure_balance_transaction_id
            )
        ):
            raise CommerceProviderContractError(
                "Stripe refund event snapshot is invalid"
            )

    def _return_urls(self, case_id: str) -> tuple[str, str]:
        path = f"/total-loss/cases/{case_id}/claim"
        success = self._configuration.public_app_origin + path + "?" + urlencode(
            {
                "checkout": "success",
                "session_id": "{CHECKOUT_SESSION_ID}",
            },
            safe="{}",
        )
        cancel = self._configuration.public_app_origin + path + "?" + urlencode(
            {"checkout": "canceled"}
        )
        return success, cancel

    @staticmethod
    def _checkout_idempotency_key(attempt_id: str) -> str:
        return f"venfour:checkout:v1:{attempt_id}"

    @staticmethod
    def _refund_idempotency_key(refund_request_id: str) -> str:
        return f"venfour:refund:v1:{refund_request_id}"

    @staticmethod
    def _safe_projection(
        row: Mapping[str, Any], state: str, checkout_url: str | None
    ) -> CheckoutProjection:
        order_status = row.get("order_status")
        checkout_status = row.get("attempt_status")
        entitlement_status = row.get("entitlement_status")
        if order_status is not None and order_status not in {
            "pending",
            "paid",
            "partially_refunded",
            "refunded",
            "disputed",
            "void",
        }:
            raise SupabaseContractError("Commerce order status is invalid")
        if checkout_status is not None and checkout_status not in {
            "creating",
            "open",
            "complete",
            "expired",
            "failed",
        }:
            raise SupabaseContractError("Checkout attempt status is invalid")
        if entitlement_status is not None and entitlement_status not in {
            "active",
            "refunded_access_retained",
            "suspended",
            "revoked",
        }:
            raise SupabaseContractError("Entitlement status is invalid")
        return CheckoutProjection(
            state=state,
            checkout_url=checkout_url,
            order_status=order_status,
            checkout_status=checkout_status,
            entitlement_status=entitlement_status,
        )

    @classmethod
    def _refund_projection(
        cls,
        row: Mapping[str, Any],
        *,
        case_id: str,
        order_id: str,
        refund_request_id: str,
    ) -> RefundProjection:
        if (
            _canonical_uuid(row.get("case_id"), "Refund case ID") != case_id
            or _canonical_uuid(row.get("order_id"), "Refund order ID")
            != order_id
            or _canonical_uuid(
                row.get("refund_request_id"), "Refund request ID"
            )
            != refund_request_id
        ):
            raise SupabaseContractError("Refund result response is invalid")
        status = row.get("refund_status")
        if status not in {
            "creating",
            "pending",
            "succeeded",
            "failed",
            "canceled",
        }:
            raise SupabaseContractError("Refund status is invalid")
        provider_status = row.get("provider_status")
        if (
            status == "creating"
            and provider_status is not None
        ) or (
            status == "pending"
            and provider_status not in {"pending", "requires_action"}
        ) or (
            status not in {"creating", "pending"}
            and provider_status != status
        ):
            raise SupabaseContractError("Refund provider status is invalid")
        state = row.get("outcome") or row.get("state")
        if state not in {
            "reserved",
            "existing",
            "already_succeeded",
            "pending",
            "succeeded",
            "failed",
            "canceled",
            "stale",
            "already_failed",
            "already_canceled",
        }:
            raise SupabaseContractError("Refund state is invalid")
        valid_state_status = (
            (state == "stale" and status != "creating")
            or (state == "reserved" and status == "creating")
            or (
                state == "existing"
                and status in {"creating", "pending", "failed", "canceled"}
            )
            or (state == "already_succeeded" and status == "succeeded")
            or (state == "pending" and status == "pending")
            or (state == "succeeded" and status == "succeeded")
            or (state in {"failed", "already_failed"} and status == "failed")
            or (
                state in {"canceled", "already_canceled"}
                and status == "canceled"
            )
        )
        if not valid_state_status:
            raise SupabaseContractError("Refund state is invalid")
        refund_transaction_id = row.get("refund_transaction_id")
        reversal_transaction_id = row.get("refund_reversal_transaction_id")
        if refund_transaction_id is not None:
            _canonical_uuid(refund_transaction_id, "Refund transaction ID")
        if reversal_transaction_id is not None:
            _canonical_uuid(
                reversal_transaction_id, "Refund reversal transaction ID"
            )
        if status in {"creating", "pending"}:
            financial_state_is_valid = (
                refund_transaction_id is None
                and reversal_transaction_id is None
            )
        elif status == "succeeded":
            financial_state_is_valid = (
                refund_transaction_id is not None
                and reversal_transaction_id is None
            )
        else:
            financial_state_is_valid = (
                refund_transaction_id is None
                and reversal_transaction_id is None
            ) or (
                refund_transaction_id is not None
                and reversal_transaction_id is not None
            )
        order_status = row.get("order_status")
        entitlement_status = row.get("entitlement_status")
        projection = (order_status, entitlement_status)
        if status == "succeeded":
            projection_is_coherent = projection in {
                ("paid", "active"),
                ("disputed", "suspended"),
                ("refunded", "refunded_access_retained"),
                ("refunded", "revoked"),
                ("refunded", "suspended"),
            }
        elif state == "stale" and order_status == "refunded":
            projection_is_coherent = projection in {
                ("refunded", "refunded_access_retained"),
                ("refunded", "revoked"),
                ("refunded", "suspended"),
            }
        else:
            projection_is_coherent = projection in {
                ("paid", "active"),
                ("disputed", "suspended"),
            }
        if not financial_state_is_valid or not projection_is_coherent:
            raise SupabaseContractError("Refund result response is invalid")
        cls._safe_projection(row, "reconciled", None)
        return RefundProjection(
            state=state,
            refund_status=status,
            order_status=order_status,
            entitlement_status=entitlement_status,
        )

    @staticmethod
    def _refund_failure_code(status: str) -> str | None:
        if status == "failed":
            return "PROVIDER_REFUND_FAILED"
        if status == "canceled":
            return "PROVIDER_REFUND_CANCELED"
        return None

    @staticmethod
    def _dispute_status(status: str) -> str:
        if status in {"won", "warning_closed", "prevented"}:
            return "won"
        if status == "lost":
            return "lost"
        if status in {
            "warning_needs_response",
            "warning_under_review",
            "needs_response",
            "under_review",
        }:
            return "active"
        raise CommerceProviderContractError("Stripe dispute status is invalid")

    def _finalize_event(
        self,
        webhook_event_id: str,
        processing_token: str,
        outcome: str,
        case_id: str | None,
        order_id: str | None,
        failure_code: str | None,
    ) -> None:
        row = self._database.finalize_stripe_webhook_event(
            webhook_event_id,
            processing_token,
            outcome,
            case_id,
            order_id,
            failure_code,
        )
        expected = "failed" if outcome == "failed" else outcome
        if row.get("status") != expected:
            raise SupabaseContractError("Webhook finalization response is invalid")

    @staticmethod
    def _failure_code(error: Exception) -> str:
        if isinstance(error, CommerceDuplicatePaymentError):
            return "DUPLICATE_PAYMENT"
        if isinstance(error, CommerceProviderContractError):
            return "PROVIDER_CONTRACT_INVALID"
        if isinstance(error, CommerceProviderError):
            return "PROVIDER_UNAVAILABLE"
        if isinstance(error, (SupabaseUnavailableError, SupabaseContractError)):
            return "DATABASE_UNAVAILABLE"
        if isinstance(error, CommerceNotFoundError):
            return "LOCAL_CONTEXT_NOT_FOUND"
        return "PROCESSING_FAILED"


__all__ = [
    "MAX_STRIPE_WEBHOOK_BODY_BYTES",
    "CommerceConflictError",
    "CommerceDatabaseGateway",
    "CommerceDuplicatePaymentError",
    "CommerceError",
    "CommerceInputError",
    "CommerceNotFoundError",
    "CommerceProviderContractError",
    "CommerceProviderError",
    "CommerceUnavailableError",
    "CommerceWebhookSignatureError",
    "CheckoutContext",
    "CheckoutProjection",
    "EntitlementFulfillmentHook",
    "PaymentContext",
    "RefundProjection",
    "StripeCharge",
    "StripeCheckoutSession",
    "StripeCommerceConfiguration",
    "StripeDispute",
    "StripeEvent",
    "StripePaymentIntent",
    "StripePrice",
    "StripeProviderGateway",
    "StripeRefund",
    "StripeSdkGateway",
    "TotalLossCommerceService",
]
