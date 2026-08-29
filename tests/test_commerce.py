"""Offline Stripe commerce, webhook, and HTTP contract coverage."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import unittest
from dataclasses import replace
from typing import Any, Mapping
from unittest.mock import patch

import stripe
import httpx
from starlette.testclient import TestClient

from venfour.api import create_app
from venfour.commerce import (
    MAX_STRIPE_WEBHOOK_BODY_BYTES,
    CheckoutContext,
    CheckoutProjection,
    CommerceConflictError,
    CommerceNotFoundError,
    CommerceProviderContractError,
    CommerceProviderError,
    CommerceUnavailableError,
    CommerceWebhookSignatureError,
    PaymentContext,
    RefundProjection,
    StripeCharge,
    StripeCheckoutSession,
    StripeCommerceConfiguration,
    StripeDispute,
    StripeEvent,
    StripePaymentIntent,
    StripePrice,
    StripeRefund,
    StripeSdkGateway,
    TotalLossCommerceService,
)
from venfour.supabase_gateway import (
    SupabaseAuthenticationError,
    SupabaseContractError,
    SupabaseHttpGateway,
    SupabaseServerConfiguration,
    SupabaseUnavailableError,
)


CASE_ID = "20000000-0000-4000-8000-000000000002"
ORDER_ID = "30000000-0000-4000-8000-000000000003"
ATTEMPT_ID = "40000000-0000-4000-8000-000000000004"
ATTEMPT_ID_2 = "41000000-0000-4000-8000-000000000004"
SNAPSHOT_ID = "a0000000-0000-4000-8000-00000000000a"
PAYMENT_ID = "50000000-0000-4000-8000-000000000005"
ENTITLEMENT_ID = "60000000-0000-4000-8000-000000000006"
REFUND_REQUEST_ID = "70000000-0000-4000-8000-000000000007"
REFUND_TRANSACTION_ID = "71000000-0000-4000-8000-000000000007"
REFUND_REVERSAL_TRANSACTION_ID = "72000000-0000-4000-8000-000000000007"
WEBHOOK_ROW_ID = "80000000-0000-4000-8000-000000000008"
DISPUTE_ROW_ID = "81000000-0000-4000-8000-000000000008"
DISPUTE_TRANSACTION_ID = "82000000-0000-4000-8000-000000000008"
USER_ID = "10000000-0000-4000-8000-000000000001"
CLIENT_REQUEST_ID = "90000000-0000-4000-8000-000000000009"
ACCESS_TOKEN = "browser-access-token"
EMAIL = "owner@example.test"
PRICE_ID = "price_test_total_loss_12345"
PRODUCT_ID = "prod_test_total_loss_12345"
SESSION_ID = "cs_test_checkout_12345"
SESSION_ID_2 = "cs_test_checkout_67890"
INTENT_ID = "pi_test_payment_12345"
CUSTOMER_ID = "cus_test_customer_12345"
CHARGE_ID = "ch_test_charge_12345"
REFUND_ID = "re_test_refund_12345"
REFUND_BALANCE_TRANSACTION_ID = "txn_test_refund_12345"
REFUND_FAILURE_TRANSACTION_ID = "txn_test_refund_failure_12345"
DISPUTE_ID = "dp_test_dispute_12345"
CURRENT_DISPUTE_ID = "du_test_dispute_12345"
EVENT_ID = "evt_test_event_12345"
PROCESSING_TOKEN = "b0000000-0000-4000-8000-00000000000b"
AMOUNT = 9900
CURRENCY = "USD"
NOW = 1_800_000_000
SECRET_KEY = "sk" + "_test_123456789012345678901234"
WEBHOOK_SECRET = "whsec" + "_123456789012345678901234"
STAGING_PROXY_SECRET = "staging-proxy-test-secret-value-1234567890"


def configuration(**overrides: Any) -> StripeCommerceConfiguration:
    values = {
        "secret_key": SECRET_KEY,
        "webhook_secret": WEBHOOK_SECRET,
        "price_id": PRICE_ID,
        "product_identifier": "total_loss_claim_package",
        "product_version": "v1",
        "terms_version": "2026-08-26",
        "refund_policy_version": "2026-08-26",
        "public_app_origin": "https://app.venfour.example",
    }
    values.update(overrides)
    return StripeCommerceConfiguration(**values)


def stripe_price(**overrides: Any) -> StripePrice:
    values = {
        "id": PRICE_ID,
        "unit_amount": AMOUNT,
        "currency": CURRENCY,
        "livemode": False,
        "active": True,
        "price_type": "one_time",
        "product_id": PRODUCT_ID,
        "product_active": True,
    }
    values.update(overrides)
    return StripePrice(**values)


def checkout_session(**overrides: Any) -> StripeCheckoutSession:
    values = {
        "id": SESSION_ID,
        "url": "https://checkout.stripe.com/c/pay/test-session",
        "status": "open",
        "payment_status": "unpaid",
        "mode": "payment",
        "expires_at": NOW,
        "livemode": False,
        "client_reference_id": ORDER_ID,
        "customer_id": CUSTOMER_ID,
        "customer_email": EMAIL,
        "payment_intent_id": None,
        "amount_total": AMOUNT,
        "currency": CURRENCY,
        "metadata": {
            "venfour_order_id": ORDER_ID,
            "venfour_checkout_attempt_id": ATTEMPT_ID,
        },
        "line_item_price_id": PRICE_ID,
        "line_item_quantity": 1,
    }
    values.update(overrides)
    return StripeCheckoutSession(**values)


def payment_intent(**overrides: Any) -> StripePaymentIntent:
    values = {
        "id": INTENT_ID,
        "status": "succeeded",
        "amount": AMOUNT,
        "amount_received": AMOUNT,
        "currency": CURRENCY,
        "livemode": False,
        "customer_id": CUSTOMER_ID,
        "latest_charge_id": CHARGE_ID,
        "metadata": {
            "venfour_order_id": ORDER_ID,
            "venfour_checkout_attempt_id": ATTEMPT_ID,
        },
        "created": NOW - 60,
    }
    values.update(overrides)
    return StripePaymentIntent(**values)


def stripe_refund(**overrides: Any) -> StripeRefund:
    values = {
        "id": REFUND_ID,
        "status": "succeeded",
        "amount": AMOUNT,
        "currency": CURRENCY,
        "livemode": False,
        "payment_intent_id": INTENT_ID,
        "charge_id": CHARGE_ID,
        "balance_transaction_id": REFUND_BALANCE_TRANSACTION_ID,
        "failure_balance_transaction_id": None,
        "metadata": {
            "venfour_order_id": ORDER_ID,
            "venfour_refund_request_id": REFUND_REQUEST_ID,
        },
        "created": NOW,
    }
    values.update(overrides)
    return StripeRefund(**values)


def stripe_event(event_type: str = "checkout.session.completed", **overrides: Any) -> StripeEvent:
    prefix_id = SESSION_ID
    refund_snapshot: StripeRefund | None = None
    dispute_snapshot: StripeDispute | None = None
    if event_type.startswith("refund."):
        prefix_id = REFUND_ID
        refund_snapshot = (
            stripe_refund(status="failed", balance_transaction_id=None)
            if event_type == "refund.failed"
            else stripe_refund()
        )
    elif event_type.startswith("charge.dispute."):
        prefix_id = DISPUTE_ID
        dispute_snapshot = StripeDispute(
            DISPUTE_ID,
            "needs_response",
            AMOUNT,
            CURRENCY,
            False,
            CHARGE_ID,
            NOW,
        )
    values = {
        "id": EVENT_ID,
        "type": event_type,
        "created": NOW,
        "livemode": False,
        "api_version": "2025-12-15.clover",
        "data_object_id": prefix_id,
        "refund_snapshot": refund_snapshot,
        "dispute_snapshot": dispute_snapshot,
    }
    values.update(overrides)
    return StripeEvent(**values)


def signed_stripe_event(
    event_type: str,
    data_object: Mapping[str, Any],
    *,
    event_id: str = EVENT_ID,
    event_created: int = NOW,
    event_livemode: bool = False,
) -> tuple[bytes, str]:
    payload = json.dumps(
        {
            "id": event_id,
            "type": event_type,
            "created": event_created,
            "livemode": event_livemode,
            "api_version": "2025-12-15.clover",
            "data": {"object": data_object},
        },
        separators=(",", ":"),
    ).encode()
    timestamp = int(time.time())
    signed = f"{timestamp}.".encode() + payload
    digest = hmac.new(
        WEBHOOK_SECRET.encode(), signed, hashlib.sha256
    ).hexdigest()
    return payload, f"t={timestamp},v1={digest}"


def context_row(**overrides: Any) -> dict[str, Any]:
    values = {
        "state": "reserved",
        "case_id": CASE_ID,
        "order_id": ORDER_ID,
        "order_status": "pending",
        "purchaser_user_id": USER_ID,
        "purchaser_email": EMAIL,
        "checkout_attempt_id": ATTEMPT_ID,
        "client_request_id": CLIENT_REQUEST_ID,
        "attempt_status": "creating",
        "external_checkout_session_id": None,
        "external_payment_intent_id": None,
        "external_price_identifier": PRICE_ID,
        "amount_minor_units": AMOUNT,
        "currency": CURRENCY,
        "provider_livemode": False,
        "expires_at": None,
        "entitlement_status": None,
    }
    values.update(overrides)
    return values


def payment_context_row(**overrides: Any) -> dict[str, Any]:
    values = context_row(
        payment_transaction_id=PAYMENT_ID,
        external_checkout_session_id=SESSION_ID,
        external_payment_intent_id=INTENT_ID,
        attempt_status="complete",
        order_status="paid",
        entitlement_status="active",
    )
    values.update(overrides)
    return values


class RecordingProvider:
    def __init__(self) -> None:
        self.price = stripe_price()
        self.session = checkout_session()
        self.created_session: StripeCheckoutSession | None = None
        self.created_sessions: list[StripeCheckoutSession] = []
        self.payment = payment_intent()
        self.refund = stripe_refund()
        self.dispute = StripeDispute(
            DISPUTE_ID,
            "needs_response",
            AMOUNT,
            CURRENCY,
            False,
            CHARGE_ID,
            NOW,
        )
        self.charge = StripeCharge(CHARGE_ID, INTENT_ID, CURRENCY, False)
        self.event = stripe_event()
        self.calls: list[tuple[str, Any]] = []
        self.verify_error: Exception | None = None
        self.create_errors: list[Exception] = []

    def verify_webhook(self, payload: bytes, signature: str) -> StripeEvent:
        self.calls.append(("verify_webhook", (payload, signature)))
        if self.verify_error is not None:
            raise self.verify_error
        return self.event

    def retrieve_price(self, price_id: str) -> StripePrice:
        self.calls.append(("retrieve_price", price_id))
        return self.price

    def create_checkout_session(self, **kwargs: Any) -> StripeCheckoutSession:
        self.calls.append(("create_checkout_session", kwargs))
        if self.create_errors:
            raise self.create_errors.pop(0)
        if self.created_sessions:
            return self.created_sessions.pop(0)
        return self.created_session or self.session

    def retrieve_checkout_session(self, session_id: str) -> StripeCheckoutSession:
        self.calls.append(("retrieve_checkout_session", session_id))
        return self.session

    def retrieve_payment_intent(self, payment_intent_id: str) -> StripePaymentIntent:
        self.calls.append(("retrieve_payment_intent", payment_intent_id))
        return self.payment

    def create_refund(self, **kwargs: Any) -> StripeRefund:
        self.calls.append(("create_refund", kwargs))
        return self.refund

    def retrieve_refund(self, refund_id: str) -> StripeRefund:
        self.calls.append(("retrieve_refund", refund_id))
        return self.refund

    def retrieve_charge(self, charge_id: str) -> StripeCharge:
        self.calls.append(("retrieve_charge", charge_id))
        return self.charge

    def retrieve_dispute(self, dispute_id: str) -> StripeDispute:
        self.calls.append(("retrieve_dispute", dispute_id))
        return self.dispute


class RecordingDatabase:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.reserve_row: Mapping[str, Any] | None = context_row()
        self.reserve_rows: list[Mapping[str, Any] | None] = []
        self.preflight_row: Mapping[str, Any] | None = {
            "case_id": CASE_ID,
            "purchaser_user_id": USER_ID,
            "purchaser_email": EMAIL,
            "preliminary_snapshot_id": SNAPSHOT_ID,
            "workflow_revision": 1,
            "checkout_available": True,
            "has_pending_order": False,
        }
        self.attach_row: Mapping[str, Any] | None = context_row(
            state="attached",
            attempt_status="open",
            external_checkout_session_id=SESSION_ID,
            expires_at="2027-01-15T08:00:00+00:00",
        )
        self.auth_row: Mapping[str, Any] | None = context_row(
            external_checkout_session_id=SESSION_ID,
            attempt_status="open",
        )
        self.checkout_context: Mapping[str, Any] | None = context_row(
            external_checkout_session_id=SESSION_ID,
            external_payment_intent_id=INTENT_ID,
            attempt_status="complete",
        )
        self.checkout_context_by_session: Mapping[str, Any] | None = None
        self.payment_context: Mapping[str, Any] | None = payment_context_row()
        self.reconcile_row: Mapping[str, Any] | None = {
            "outcome": "observed",
            "case_id": CASE_ID,
            "order_id": ORDER_ID,
            "checkout_attempt_id": ATTEMPT_ID,
            "order_status": "pending",
            "attempt_status": "complete",
            "entitlement_status": None,
        }
        self.failure_row: Mapping[str, Any] = {
            "outcome": "applied",
            "case_id": CASE_ID,
            "order_id": ORDER_ID,
            "checkout_attempt_id": ATTEMPT_ID,
            "order_status": "pending",
            "attempt_status": "failed",
            "entitlement_status": None,
        }
        self.expiration_row: Mapping[str, Any] = {
            "outcome": "applied",
            "case_id": CASE_ID,
            "order_id": ORDER_ID,
            "checkout_attempt_id": ATTEMPT_ID,
            "order_status": "pending",
            "attempt_status": "expired",
            "entitlement_status": None,
        }
        self.recovery_row: Mapping[str, Any] = {
            **self.expiration_row,
            "outcome": "applied",
        }
        self.claim_row: Mapping[str, Any] = {
            "state": "claimed",
            "webhook_event_id": WEBHOOK_ROW_ID,
            "processing_token": "00000000-0000-4000-8000-000000000000",
        }
        self.fulfill_row: Mapping[str, Any] = {
            "outcome": "fulfilled",
            "case_id": CASE_ID,
            "order_id": ORDER_ID,
            "checkout_attempt_id": ATTEMPT_ID,
            "payment_transaction_id": PAYMENT_ID,
            "entitlement_id": ENTITLEMENT_ID,
            "entitlement_status": "active",
            "order_status": "paid",
        }
        self.refund_reserve_row: Mapping[str, Any] | None = {
            "state": "reserved",
            "case_id": CASE_ID,
            "order_id": ORDER_ID,
            "payment_transaction_id": PAYMENT_ID,
            "refund_request_id": REFUND_REQUEST_ID,
            "refund_status": "creating",
            "provider_status": None,
            "amount_minor_units": AMOUNT,
            "currency": CURRENCY,
            "external_refund_id": None,
            "external_payment_intent_id": INTENT_ID,
            "provider_livemode": False,
            "access_policy": "retain",
            "refund_transaction_id": None,
            "refund_reversal_transaction_id": None,
            "order_status": "paid",
            "entitlement_status": "active",
        }
        self.refund_result: Mapping[str, Any] = {
            "outcome": "succeeded",
            "case_id": CASE_ID,
            "order_id": ORDER_ID,
            "refund_request_id": REFUND_REQUEST_ID,
            "refund_status": "succeeded",
            "provider_status": "succeeded",
            "refund_transaction_id": REFUND_TRANSACTION_ID,
            "refund_reversal_transaction_id": None,
            "order_status": "refunded",
            "entitlement_status": "refunded_access_retained",
        }
        self.dispute_result: Mapping[str, Any] = {
            "outcome": "applied",
            "case_id": CASE_ID,
            "order_id": ORDER_ID,
            "dispute_id": DISPUTE_ROW_ID,
            "dispute_status": "active",
            "financial_transaction_id": None,
            "order_status": "disputed",
            "entitlement_status": "suspended",
        }
        self.authenticate_error: Exception | None = None

    def authenticate(self, access_token: str) -> str:
        self.calls.append(("authenticate", access_token))
        if self.authenticate_error is not None:
            raise self.authenticate_error
        return USER_ID

    def reserve_total_loss_checkout(self, *args: Any) -> Mapping[str, Any] | None:
        self.calls.append(("reserve_total_loss_checkout", args))
        if self.reserve_rows:
            return self.reserve_rows.pop(0)
        return self.reserve_row

    def authorize_total_loss_checkout_preflight(self, *args: Any) -> Mapping[str, Any] | None:
        self.calls.append(("authorize_total_loss_checkout_preflight", args))
        return self.preflight_row

    def attach_total_loss_checkout_session(self, *args: Any) -> Mapping[str, Any] | None:
        self.calls.append(("attach_total_loss_checkout_session", args))
        return self.attach_row

    def recover_total_loss_checkout_attempt(
        self, *args: Any
    ) -> Mapping[str, Any]:
        self.calls.append(("recover_total_loss_checkout_attempt", args))
        return self.recovery_row

    def authorize_total_loss_checkout_reconciliation(self, *args: Any) -> Mapping[str, Any] | None:
        self.calls.append(("authorize_total_loss_checkout_reconciliation", args))
        return self.auth_row

    def resolve_total_loss_checkout_context(self, *args: Any) -> Mapping[str, Any] | None:
        self.calls.append(("resolve_total_loss_checkout_context", args))
        return self.checkout_context

    def resolve_total_loss_checkout_context_by_session_id(
        self, *args: Any
    ) -> Mapping[str, Any] | None:
        self.calls.append(
            ("resolve_total_loss_checkout_context_by_session_id", args)
        )
        return self.checkout_context_by_session

    def resolve_total_loss_payment_context(self, *args: Any) -> Mapping[str, Any] | None:
        self.calls.append(("resolve_total_loss_payment_context", args))
        return self.payment_context

    def reconcile_total_loss_checkout_attempt(self, *args: Any) -> Mapping[str, Any] | None:
        self.calls.append(("reconcile_total_loss_checkout_attempt", args))
        return self.reconcile_row

    def fail_total_loss_checkout_attempt_from_webhook(self, *args: Any) -> Mapping[str, Any]:
        self.calls.append(("fail_total_loss_checkout_attempt_from_webhook", args))
        return self.failure_row

    def expire_total_loss_checkout_attempt_from_webhook(
        self, *args: Any
    ) -> Mapping[str, Any]:
        self.calls.append(("expire_total_loss_checkout_attempt_from_webhook", args))
        return self.expiration_row

    def claim_stripe_webhook_event(self, event: StripeEvent, digest: str, size: int, token: str) -> Mapping[str, Any]:
        self.calls.append(("claim_stripe_webhook_event", (event, digest, size, token)))
        self.claim_row = {**self.claim_row, "processing_token": token}
        return self.claim_row

    def finalize_stripe_webhook_event(self, *args: Any) -> Mapping[str, Any]:
        self.calls.append(("finalize_stripe_webhook_event", args))
        return {"status": args[2]}

    def fulfill_total_loss_checkout_payment(self, *args: Any) -> Mapping[str, Any]:
        self.calls.append(("fulfill_total_loss_checkout_payment", args))
        return self.fulfill_row

    def reserve_total_loss_refund(self, *args: Any) -> Mapping[str, Any] | None:
        self.calls.append(("reserve_total_loss_refund", args))
        return self.refund_reserve_row

    def record_total_loss_refund_result(self, *args: Any) -> Mapping[str, Any]:
        self.calls.append(("record_total_loss_refund_result", args))
        return self.refund_result

    def record_total_loss_dispute(self, *args: Any) -> Mapping[str, Any]:
        self.calls.append(("record_total_loss_dispute", args))
        return self.dispute_result


def service(
    database: RecordingDatabase | None = None,
    provider: RecordingProvider | None = None,
    entitlement_fulfillment_hook: Any | None = None,
) -> tuple[TotalLossCommerceService, RecordingDatabase, RecordingProvider]:
    selected_database = database or RecordingDatabase()
    selected_provider = provider or RecordingProvider()
    return (
        TotalLossCommerceService(
            selected_database,
            selected_provider,
            configuration(),
            entitlement_fulfillment_hook,
        ),
        selected_database,
        selected_provider,
    )


class CommerceConfigurationTests(unittest.TestCase):
    def test_configuration_is_server_owned_and_mode_is_derived_from_key(self) -> None:
        test = configuration(public_app_origin="http://localhost:5173/")
        live = configuration(secret_key="sk" + "_live_123456789012345678901234")

        self.assertFalse(test.livemode)
        self.assertEqual(test.public_app_origin, "http://localhost:5173")
        self.assertTrue(live.livemode)
        self.assertNotIn(SECRET_KEY, repr(test))
        self.assertNotIn(WEBHOOK_SECRET, repr(test))

    def test_configuration_requires_exact_supported_key_and_identifier_shapes(self) -> None:
        for overrides in (
            {"secret_key": "sk_unknown_12345678901234567890"},
            {"secret_key": "rk" + "_test_123456789012345678901234"},
            {"webhook_secret": "secret"},
            {"price_id": "prod_wrong_12345"},
            {"product_identifier": "Total Loss"},
            {"product_version": "bad version"},
            {"public_app_origin": "https://app.venfour.example/path"},
        ):
            with self.subTest(overrides=tuple(overrides)), self.assertRaises(ValueError):
                configuration(**overrides)

    def test_environment_is_all_or_nothing(self) -> None:
        environment = {
            "STRIPE_SECRET_KEY": SECRET_KEY,
            "STRIPE_WEBHOOK_SECRET": WEBHOOK_SECRET,
            "VENFOUR_TOTAL_LOSS_STRIPE_PRICE_ID": PRICE_ID,
            "VENFOUR_TOTAL_LOSS_PRODUCT_IDENTIFIER": "total_loss_claim_package",
            "VENFOUR_TOTAL_LOSS_PRODUCT_VERSION": "v1",
            "VENFOUR_TOTAL_LOSS_TERMS_VERSION": "2026-08-26",
            "VENFOUR_TOTAL_LOSS_REFUND_POLICY_VERSION": "2026-08-26",
            "VENFOUR_PUBLIC_APP_ORIGIN": "https://app.venfour.example",
        }
        self.assertEqual(
            StripeCommerceConfiguration.from_environment(environment).price_id,
            PRICE_ID,
        )
        for missing in environment:
            with self.subTest(missing=missing), self.assertRaises(ValueError):
                StripeCommerceConfiguration.from_environment(
                    {key: value for key, value in environment.items() if key != missing}
                )


class CommerceCheckoutServiceTests(unittest.TestCase):
    def test_wrong_owner_is_denied_before_any_stripe_lookup(self) -> None:
        database = RecordingDatabase()
        database.preflight_row = None
        commerce, _, provider = service(database)

        with self.assertRaises(CommerceNotFoundError):
            commerce.create_checkout(CASE_ID, ACCESS_TOKEN, CLIENT_REQUEST_ID)

        self.assertEqual(provider.calls, [])

    def test_non_payable_owned_case_conflicts_before_any_stripe_lookup(self) -> None:
        database = RecordingDatabase()
        database.preflight_row = {
            **database.preflight_row,
            "checkout_available": False,
        }
        commerce, _, provider = service(database)

        with self.assertRaises(CommerceConflictError):
            commerce.create_checkout(CASE_ID, ACCESS_TOKEN, CLIENT_REQUEST_ID)

        self.assertEqual(provider.calls, [])

    def test_new_checkout_uses_frozen_terms_and_stable_attempt_idempotency(self) -> None:
        commerce, database, provider = service()

        result = commerce.create_checkout(CASE_ID, ACCESS_TOKEN, CLIENT_REQUEST_ID)

        self.assertEqual(
            result.to_dict(),
            {
                "state": "checkout_ready",
                "checkoutUrl": "https://checkout.stripe.com/c/pay/test-session",
                "orderStatus": "pending",
                "checkoutStatus": "open",
                "entitlementStatus": None,
            },
        )
        create = next(value for name, value in provider.calls if name == "create_checkout_session")
        self.assertEqual(create["idempotency_key"], f"venfour:checkout:v1:{ATTEMPT_ID}")
        self.assertEqual(create["customer_email"], EMAIL)
        self.assertEqual(create["price_id"], PRICE_ID)
        self.assertEqual(
            create["success_url"],
            f"https://app.venfour.example/total-loss/cases/{CASE_ID}/claim?checkout=success&session_id={{CHECKOUT_SESSION_ID}}",
        )
        self.assertEqual(
            create["cancel_url"],
            f"https://app.venfour.example/total-loss/cases/{CASE_ID}/claim?checkout=canceled",
        )
        self.assertTrue(any(name == "attach_total_loss_checkout_session" for name, _ in database.calls))

    def test_existing_open_session_is_resumed_without_creating_another(self) -> None:
        database = RecordingDatabase()
        database.reserve_row = context_row(
            state="existing",
            attempt_status="open",
            external_checkout_session_id=SESSION_ID,
        )
        commerce, _, provider = service(database)

        result = commerce.create_checkout(CASE_ID, ACCESS_TOKEN, CLIENT_REQUEST_ID)

        self.assertEqual(result.state, "checkout_ready")
        self.assertEqual(
            [name for name, _ in provider.calls],
            ["retrieve_price", "retrieve_checkout_session"],
        )

    def test_past_local_expiry_does_not_replace_authoritatively_paid_session(
        self,
    ) -> None:
        database = RecordingDatabase()
        database.reserve_row = context_row(
            state="existing",
            attempt_status="open",
            external_checkout_session_id=SESSION_ID,
            expires_at="2020-01-01T00:00:00+00:00",
        )
        database.reconcile_row = {
            **database.reconcile_row,
            "attempt_status": "complete",
        }
        provider = RecordingProvider()
        provider.session = checkout_session(
            status="complete",
            payment_status="paid",
            url=None,
            payment_intent_id=INTENT_ID,
        )
        commerce, database, provider = service(database, provider)

        result = commerce.create_checkout(
            CASE_ID, ACCESS_TOKEN, CLIENT_REQUEST_ID
        )

        self.assertEqual(result.state, "payment_pending")
        self.assertEqual(result.checkout_status, "complete")
        self.assertIn(("retrieve_checkout_session", SESSION_ID), provider.calls)
        self.assertIn(("retrieve_payment_intent", INTENT_ID), provider.calls)
        self.assertEqual(
            len(
                [
                    value
                    for name, value in database.calls
                    if name == "reserve_total_loss_checkout"
                ]
            ),
            1,
        )
        self.assertFalse(
            any(
                name == "create_checkout_session"
                for name, _ in provider.calls
            )
        )
        self.assertFalse(
            any(
                name == "fulfill_total_loss_checkout_payment"
                for name, _ in database.calls
            )
        )

    def test_provider_crash_retry_reuses_the_same_local_attempt_key(self) -> None:
        provider = RecordingProvider()
        provider.create_errors = [CommerceProviderError("temporary")]
        commerce, _, _ = service(provider=provider)

        with self.assertRaises(CommerceProviderError):
            commerce.create_checkout(CASE_ID, ACCESS_TOKEN, CLIENT_REQUEST_ID)
        commerce.create_checkout(CASE_ID, ACCESS_TOKEN, CLIENT_REQUEST_ID)

        keys = [
            value["idempotency_key"]
            for name, value in provider.calls
            if name == "create_checkout_session"
        ]
        self.assertEqual(keys, [f"venfour:checkout:v1:{ATTEMPT_ID}"] * 2)

    def test_expired_idempotent_session_after_pre_attach_crash_is_replaced_once(
        self,
    ) -> None:
        database = RecordingDatabase()
        database.reserve_rows = [
            context_row(),
            context_row(
                state="reserved",
                checkout_attempt_id=ATTEMPT_ID_2,
                attempt_status="creating",
            ),
        ]
        database.attach_row = context_row(
            state="attached",
            checkout_attempt_id=ATTEMPT_ID_2,
            attempt_status="open",
            external_checkout_session_id=SESSION_ID_2,
        )
        provider = RecordingProvider()
        provider.created_sessions = [
            checkout_session(status="expired", payment_status="unpaid", url=None),
            checkout_session(
                id=SESSION_ID_2,
                metadata={
                    "venfour_order_id": ORDER_ID,
                    "venfour_checkout_attempt_id": ATTEMPT_ID_2,
                },
            ),
        ]
        commerce, database, provider = service(database, provider)

        result = commerce.create_checkout(
            CASE_ID, ACCESS_TOKEN, CLIENT_REQUEST_ID
        )

        self.assertEqual(result.state, "checkout_ready")
        self.assertEqual(result.checkout_status, "open")
        recovery = next(
            value
            for name, value in database.calls
            if name == "recover_total_loss_checkout_attempt"
        )
        self.assertEqual(recovery[0].checkout_attempt_id, ATTEMPT_ID)
        self.assertEqual(recovery[1].id, SESSION_ID)
        creates = [
            value
            for name, value in provider.calls
            if name == "create_checkout_session"
        ]
        self.assertEqual(
            [value["idempotency_key"] for value in creates],
            [
                f"venfour:checkout:v1:{ATTEMPT_ID}",
                f"venfour:checkout:v1:{ATTEMPT_ID_2}",
            ],
        )
        self.assertEqual(
            len(
                [
                    value
                    for name, value in database.calls
                    if name == "reserve_total_loss_checkout"
                ]
            ),
            2,
        )
        attachment = next(
            value
            for name, value in database.calls
            if name == "attach_total_loss_checkout_session"
        )
        self.assertEqual(attachment[0], ATTEMPT_ID_2)

    def test_complete_unpaid_pre_attach_session_is_recovered_without_replacement(
        self,
    ) -> None:
        database = RecordingDatabase()
        database.recovery_row = {
            **database.recovery_row,
            "outcome": "applied",
            "attempt_status": "open",
        }
        provider = RecordingProvider()
        provider.session = checkout_session(
            status="complete",
            payment_status="unpaid",
            url=None,
            payment_intent_id=INTENT_ID,
        )
        commerce, database, provider = service(database, provider)

        result = commerce.create_checkout(
            CASE_ID, ACCESS_TOKEN, CLIENT_REQUEST_ID
        )

        self.assertEqual(result.state, "payment_pending")
        self.assertEqual(result.checkout_status, "open")
        self.assertEqual(
            [
                value["idempotency_key"]
                for name, value in provider.calls
                if name == "create_checkout_session"
            ],
            [f"venfour:checkout:v1:{ATTEMPT_ID}"],
        )
        self.assertFalse(
            any(name == "retrieve_payment_intent" for name, _ in provider.calls)
        )
        self.assertFalse(
            any(
                name
                in {
                    "attach_total_loss_checkout_session",
                    "fulfill_total_loss_checkout_payment",
                }
                for name, _ in database.calls
            )
        )

    def test_expired_session_is_reconciled_and_replaced_in_one_controlled_retry(self) -> None:
        database = RecordingDatabase()
        database.reserve_rows = [
            context_row(
                state="existing",
                attempt_status="open",
                external_checkout_session_id=SESSION_ID,
            ),
            context_row(
                state="reserved",
                checkout_attempt_id=ATTEMPT_ID_2,
                attempt_status="creating",
                external_checkout_session_id=None,
            ),
        ]
        database.attach_row = context_row(
            state="attached",
            checkout_attempt_id=ATTEMPT_ID_2,
            attempt_status="open",
            external_checkout_session_id=SESSION_ID_2,
        )
        database.reconcile_row = {
            **database.reconcile_row,
            "attempt_status": "expired",
        }
        provider = RecordingProvider()
        provider.session = checkout_session(status="expired", url=None)
        provider.created_session = checkout_session(
            id=SESSION_ID_2,
            metadata={
                "venfour_order_id": ORDER_ID,
                "venfour_checkout_attempt_id": ATTEMPT_ID_2,
            },
        )
        commerce, database, _ = service(database, provider)

        result = commerce.create_checkout(CASE_ID, ACCESS_TOKEN, CLIENT_REQUEST_ID)

        self.assertEqual(result.state, "checkout_ready")
        self.assertTrue(any(name == "reconcile_total_loss_checkout_attempt" for name, _ in database.calls))
        reservations = [
            value
            for name, value in database.calls
            if name == "reserve_total_loss_checkout"
        ]
        self.assertEqual(len(reservations), 2)
        create = next(
            value
            for name, value in provider.calls
            if name == "create_checkout_session"
        )
        self.assertEqual(
            create["idempotency_key"],
            f"venfour:checkout:v1:{ATTEMPT_ID_2}",
        )

    def test_invalid_or_mutated_price_fails_before_order_reservation(self) -> None:
        for price in (
            stripe_price(active=False),
            stripe_price(product_active=False),
            stripe_price(price_type="recurring"),
            stripe_price(livemode=True),
        ):
            with self.subTest(price=price):
                provider = RecordingProvider()
                provider.price = price
                commerce, database, _ = service(provider=provider)
                with self.assertRaises(CommerceConflictError):
                    commerce.create_checkout(CASE_ID, ACCESS_TOKEN, CLIENT_REQUEST_ID)
                self.assertFalse(any(name == "reserve_total_loss_checkout" for name, _ in database.calls))

    def test_provider_contract_mismatch_never_attaches_session(self) -> None:
        provider = RecordingProvider()
        provider.session = checkout_session(amount_total=AMOUNT + 1)
        commerce, database, _ = service(provider=provider)

        with self.assertRaises(CommerceProviderContractError):
            commerce.create_checkout(CASE_ID, ACCESS_TOKEN, CLIENT_REQUEST_ID)
        self.assertFalse(any(name == "attach_total_loss_checkout_session" for name, _ in database.calls))

    def test_checkout_session_requires_the_frozen_purchaser_email(self) -> None:
        provider = RecordingProvider()
        provider.session = checkout_session(customer_email=None)
        commerce, database, _ = service(provider=provider)

        with self.assertRaises(CommerceProviderContractError):
            commerce.create_checkout(CASE_ID, ACCESS_TOKEN, CLIENT_REQUEST_ID)

        self.assertFalse(
            any(
                name == "attach_total_loss_checkout_session"
                for name, _ in database.calls
            )
        )

    def test_already_fulfilled_returns_no_provider_or_checkout_identifier(self) -> None:
        database = RecordingDatabase()
        database.reserve_row = context_row(
            state="already_fulfilled",
            order_status="paid",
            entitlement_status="active",
            attempt_status="complete",
        )
        commerce, _, provider = service(database)

        result = commerce.create_checkout(CASE_ID, ACCESS_TOKEN, CLIENT_REQUEST_ID)

        self.assertEqual(result.state, "already_fulfilled")
        self.assertIsNone(result.checkout_url)
        self.assertEqual([name for name, _ in provider.calls], ["retrieve_price"])


class CommerceReconciliationTests(unittest.TestCase):
    def test_reconciliation_authorizes_before_retrieving_stripe(self) -> None:
        database = RecordingDatabase()
        database.auth_row = None
        commerce, _, provider = service(database)

        with self.assertRaises(CommerceNotFoundError):
            commerce.reconcile_checkout(CASE_ID, ACCESS_TOKEN, SESSION_ID)

        self.assertEqual(provider.calls, [])

    def test_paid_reconciliation_verifies_payment_intent_but_never_fulfills(self) -> None:
        provider = RecordingProvider()
        provider.session = checkout_session(
            status="complete",
            payment_status="paid",
            url=None,
            payment_intent_id=INTENT_ID,
        )
        database = RecordingDatabase()
        database.auth_row = context_row(
            external_checkout_session_id=SESSION_ID,
            external_payment_intent_id=INTENT_ID,
            attempt_status="complete",
        )
        commerce, database, provider = service(database, provider)

        result = commerce.reconcile_checkout(CASE_ID, ACCESS_TOKEN, SESSION_ID)

        self.assertEqual(result.state, "reconciled")
        self.assertIn(("retrieve_payment_intent", INTENT_ID), provider.calls)
        self.assertFalse(any(name == "fulfill_total_loss_checkout_payment" for name, _ in database.calls))

    def test_paid_reconciliation_rejects_non_succeeded_payment(self) -> None:
        provider = RecordingProvider()
        provider.session = checkout_session(
            status="complete",
            payment_status="paid",
            url=None,
            payment_intent_id=INTENT_ID,
        )
        provider.payment = payment_intent(status="processing")
        database = RecordingDatabase()
        database.auth_row = context_row(
            external_checkout_session_id=SESSION_ID,
            external_payment_intent_id=INTENT_ID,
        )
        commerce, database, _ = service(database, provider)

        with self.assertRaises(CommerceProviderContractError):
            commerce.reconcile_checkout(CASE_ID, ACCESS_TOKEN, SESSION_ID)
        self.assertFalse(any(name == "reconcile_total_loss_checkout_attempt" for name, _ in database.calls))

    def test_paid_reconciliation_rejects_a_different_payment_customer(self) -> None:
        provider = RecordingProvider()
        provider.session = checkout_session(
            status="complete",
            payment_status="paid",
            url=None,
            payment_intent_id=INTENT_ID,
        )
        provider.payment = payment_intent(
            customer_id="cus_test_other_customer_12345"
        )
        database = RecordingDatabase()
        database.auth_row = context_row(
            external_checkout_session_id=SESSION_ID,
            external_payment_intent_id=INTENT_ID,
        )
        commerce, database, _ = service(database, provider)

        with self.assertRaises(CommerceProviderContractError):
            commerce.reconcile_checkout(CASE_ID, ACCESS_TOKEN, SESSION_ID)

        self.assertFalse(
            any(
                name == "reconcile_total_loss_checkout_attempt"
                for name, _ in database.calls
            )
        )


class CommerceWebhookTests(unittest.TestCase):
    def test_invalid_signature_stops_before_database_claim(self) -> None:
        provider = RecordingProvider()
        provider.verify_error = CommerceWebhookSignatureError("invalid")
        commerce, database, _ = service(provider=provider)

        with self.assertRaises(CommerceWebhookSignatureError):
            commerce.handle_webhook(b"raw", "bad")

        self.assertEqual(database.calls, [])

    def test_successful_checkout_fulfills_once_then_finalizes(self) -> None:
        provider = RecordingProvider()
        provider.session = checkout_session(
            status="complete",
            payment_status="paid",
            url=None,
            payment_intent_id=INTENT_ID,
        )
        commerce, database, _ = service(provider=provider)

        outcome = commerce.handle_webhook(b"signed-raw", "valid")

        self.assertEqual(outcome, "processed")
        names = [name for name, _ in database.calls]
        self.assertIn("fulfill_total_loss_checkout_payment", names)
        self.assertEqual(names[-1], "finalize_stripe_webhook_event")
        fulfillment = next(
            value
            for name, value in database.calls
            if name == "fulfill_total_loss_checkout_payment"
        )
        self.assertEqual(fulfillment[-1], NOW)
        self.assertNotEqual(fulfillment[-1], provider.payment.created)
        claim_args = next(value for name, value in database.calls if name == "claim_stripe_webhook_event")
        self.assertEqual(claim_args[1], hashlib.sha256(b"signed-raw").hexdigest())
        self.assertEqual(claim_args[2], len(b"signed-raw"))

    def test_verified_entitlement_is_enqueued_before_event_finalization(
        self,
    ) -> None:
        class RecordingHook:
            def __init__(self, database: RecordingDatabase) -> None:
                self.database = database
                self.entitlement_ids: list[str] = []

            def ensure_for_entitlement(self, entitlement_id: str) -> None:
                self.entitlement_ids.append(entitlement_id)
                self.database.calls.append(
                    ("ensure_for_entitlement", (entitlement_id,))
                )

        provider = RecordingProvider()
        provider.session = checkout_session(
            status="complete",
            payment_status="paid",
            url=None,
            payment_intent_id=INTENT_ID,
        )
        database = RecordingDatabase()
        hook = RecordingHook(database)
        commerce, database, _ = service(database, provider, hook)

        self.assertEqual(commerce.handle_webhook(b"signed-raw", "valid"), "processed")

        self.assertEqual(hook.entitlement_ids, [ENTITLEMENT_ID])
        names = [name for name, _ in database.calls]
        self.assertLess(
            names.index("fulfill_total_loss_checkout_payment"),
            names.index("ensure_for_entitlement"),
        )
        self.assertLess(
            names.index("ensure_for_entitlement"),
            names.index("finalize_stripe_webhook_event"),
        )

    def test_package_enqueue_failure_keeps_webhook_retryable(self) -> None:
        class FailingHook:
            def ensure_for_entitlement(self, _entitlement_id: str) -> None:
                raise SupabaseUnavailableError("package enqueue unavailable")

        provider = RecordingProvider()
        provider.session = checkout_session(
            status="complete",
            payment_status="paid",
            url=None,
            payment_intent_id=INTENT_ID,
        )
        commerce, database, _ = service(
            provider=provider,
            entitlement_fulfillment_hook=FailingHook(),
        )

        with self.assertRaises(SupabaseUnavailableError):
            commerce.handle_webhook(b"signed-raw", "valid")

        finalization = [
            values
            for name, values in database.calls
            if name == "finalize_stripe_webhook_event"
        ][-1]
        self.assertEqual(finalization[2], "failed")

    def test_webhook_uses_the_order_frozen_email_after_auth_email_changes(
        self,
    ) -> None:
        provider = RecordingProvider()
        provider.session = checkout_session(
            status="complete",
            payment_status="paid",
            url=None,
            payment_intent_id=INTENT_ID,
            customer_email=EMAIL,
        )
        database = RecordingDatabase()
        database.preflight_row = {
            **database.preflight_row,
            "purchaser_email": "changed@example.test",
        }
        database.checkout_context = context_row(
            purchaser_email=EMAIL,
            external_checkout_session_id=SESSION_ID,
            external_payment_intent_id=INTENT_ID,
            attempt_status="complete",
        )
        commerce, database, _ = service(database, provider)

        self.assertEqual(commerce.handle_webhook(b"raw", "valid"), "processed")

        self.assertFalse(
            any(
                name in {"authenticate", "authorize_total_loss_checkout_preflight"}
                for name, _ in database.calls
            )
        )
        self.assertTrue(
            any(
                name == "fulfill_total_loss_checkout_payment"
                for name, _ in database.calls
            )
        )

    def test_completed_but_unpaid_session_never_grants_entitlement(self) -> None:
        provider = RecordingProvider()
        provider.session = checkout_session(
            status="complete",
            url=None,
            payment_intent_id=INTENT_ID,
        )
        database = RecordingDatabase()
        database.reconcile_row = {
            **database.reconcile_row,
            "attempt_status": "open",
        }
        commerce, database, _ = service(database, provider)

        self.assertEqual(commerce.handle_webhook(b"raw", "valid"), "processed")

        names = [name for name, _ in database.calls]
        self.assertIn("reconcile_total_loss_checkout_attempt", names)
        self.assertNotIn("fulfill_total_loss_checkout_payment", names)

    def test_async_payment_failure_is_terminal_and_allows_controlled_retry(self) -> None:
        provider = RecordingProvider()
        provider.event = stripe_event("checkout.session.async_payment_failed")
        provider.session = checkout_session(
            status="complete",
            payment_status="unpaid",
            url=None,
            payment_intent_id=INTENT_ID,
        )
        commerce, database, _ = service(provider=provider)

        self.assertEqual(commerce.handle_webhook(b"raw", "valid"), "processed")

        failure = next(
            value
            for name, value in database.calls
            if name == "fail_total_loss_checkout_attempt_from_webhook"
        )
        self.assertEqual(failure[0:4], (ORDER_ID, ATTEMPT_ID, SESSION_ID, EVENT_ID))
        self.assertEqual(failure[-1], "ASYNC_PAYMENT_FAILED")
        self.assertFalse(
            any(
                name == "fulfill_total_loss_checkout_payment"
                for name, _ in database.calls
            )
        )

    def test_older_completed_event_after_async_failure_is_acknowledged_terminal(
        self,
    ) -> None:
        provider = RecordingProvider()
        provider.event = stripe_event("checkout.session.completed")
        provider.session = checkout_session(
            status="complete",
            payment_status="unpaid",
            url=None,
            payment_intent_id=INTENT_ID,
        )
        database = RecordingDatabase()
        database.checkout_context = context_row(
            external_checkout_session_id=SESSION_ID,
            external_payment_intent_id=INTENT_ID,
            attempt_status="failed",
        )
        database.reconcile_row = {
            **database.reconcile_row,
            "outcome": "already_terminal",
            "attempt_status": "failed",
        }
        commerce, database, _ = service(database, provider)

        self.assertEqual(commerce.handle_webhook(b"older", "valid"), "processed")

        names = [name for name, _ in database.calls]
        self.assertIn("reconcile_total_loss_checkout_attempt", names)
        self.assertNotIn("fulfill_total_loss_checkout_payment", names)
        self.assertEqual(names[-1], "finalize_stripe_webhook_event")

    def test_terminal_reconciliation_rejects_incoherent_local_state(self) -> None:
        incoherent_rows = (
            {
                "outcome": "already_terminal",
                "attempt_status": "failed",
                "order_status": "paid",
                "entitlement_status": "active",
            },
            {
                "outcome": "already_terminal",
                "attempt_status": "expired",
            },
        )
        for overrides in incoherent_rows:
            with self.subTest(overrides=overrides):
                provider = RecordingProvider()
                provider.event = stripe_event("checkout.session.completed")
                provider.session = checkout_session(
                    status="complete",
                    payment_status="unpaid",
                    url=None,
                    payment_intent_id=INTENT_ID,
                )
                database = RecordingDatabase()
                database.checkout_context = context_row(
                    external_checkout_session_id=SESSION_ID,
                    external_payment_intent_id=INTENT_ID,
                    attempt_status="failed",
                )
                database.reconcile_row = {
                    **database.reconcile_row,
                    **overrides,
                }
                commerce, database, _ = service(database, provider)

                with self.assertRaises(SupabaseContractError):
                    commerce.handle_webhook(b"older", "valid")

                self.assertNotIn(
                    "fulfill_total_loss_checkout_payment",
                    [name for name, _ in database.calls],
                )

    def test_expired_session_uses_the_claimed_event_transition(self) -> None:
        provider = RecordingProvider()
        provider.event = stripe_event("checkout.session.expired")
        provider.session = checkout_session(
            status="expired",
            payment_status="unpaid",
            url=None,
            payment_intent_id=None,
        )
        database = RecordingDatabase()
        database.checkout_context = context_row(
            external_checkout_session_id=SESSION_ID,
            external_payment_intent_id=None,
        )
        commerce, database, _ = service(database, provider)

        self.assertEqual(commerce.handle_webhook(b"raw", "valid"), "processed")

        expiration = next(
            value
            for name, value in database.calls
            if name == "expire_total_loss_checkout_attempt_from_webhook"
        )
        self.assertEqual(
            expiration,
            (ORDER_ID, ATTEMPT_ID, SESSION_ID, EVENT_ID, expiration[4], NOW),
        )
        claim = next(
            value
            for name, value in database.calls
            if name == "claim_stripe_webhook_event"
        )
        self.assertEqual(expiration[4], claim[3])
        self.assertFalse(
            any(
                name == "reconcile_total_loss_checkout_attempt"
                for name, _ in database.calls
            )
        )

    def test_delayed_terminal_events_acknowledge_coherent_later_financial_states(
        self,
    ) -> None:
        cases = (
            (
                "checkout.session.expired",
                "expiration_row",
                "expired",
                "paid",
                "active",
            ),
            (
                "checkout.session.async_payment_failed",
                "failure_row",
                "failed",
                "refunded",
                "refunded_access_retained",
            ),
            (
                "checkout.session.expired",
                "expiration_row",
                "expired",
                "disputed",
                "suspended",
            ),
            (
                "checkout.session.async_payment_failed",
                "failure_row",
                "failed",
                "refunded",
                "suspended",
            ),
        )
        for event_type, result_name, attempt_status, order_status, entitlement_status in cases:
            with self.subTest(order_status=order_status):
                provider = RecordingProvider()
                provider.event = stripe_event(event_type)
                if event_type == "checkout.session.expired":
                    provider.session = checkout_session(
                        status="expired",
                        payment_status="unpaid",
                        url=None,
                        payment_intent_id=None,
                    )
                else:
                    provider.session = checkout_session(
                        status="complete",
                        payment_status="unpaid",
                        url=None,
                        payment_intent_id=INTENT_ID,
                    )
                database = RecordingDatabase()
                if event_type == "checkout.session.expired":
                    database.checkout_context = context_row(
                        external_checkout_session_id=SESSION_ID,
                        external_payment_intent_id=None,
                    )
                setattr(
                    database,
                    result_name,
                    {
                        "outcome": "stale",
                        "case_id": CASE_ID,
                        "order_id": ORDER_ID,
                        "checkout_attempt_id": ATTEMPT_ID,
                        "order_status": order_status,
                        "attempt_status": attempt_status,
                        "entitlement_status": entitlement_status,
                    },
                )
                commerce, database, _ = service(database, provider)

                self.assertEqual(
                    commerce.handle_webhook(b"raw", "valid"), "processed"
                )
                finalize = [
                    value
                    for name, value in database.calls
                    if name == "finalize_stripe_webhook_event"
                ][-1]
                self.assertEqual(finalize[2], "processed")

    def test_delayed_terminal_event_rejects_an_incoherent_stale_projection(
        self,
    ) -> None:
        provider = RecordingProvider()
        provider.event = stripe_event("checkout.session.async_payment_failed")
        provider.session = checkout_session(
            status="complete",
            payment_status="unpaid",
            url=None,
            payment_intent_id=INTENT_ID,
        )
        database = RecordingDatabase()
        database.failure_row = {
            **database.failure_row,
            "outcome": "stale",
            "order_status": "paid",
            "entitlement_status": None,
        }
        commerce, database, _ = service(database, provider)

        with self.assertRaisesRegex(
            SupabaseContractError, "terminal response is invalid"
        ):
            commerce.handle_webhook(b"raw", "valid")

        finalize = [
            value
            for name, value in database.calls
            if name == "finalize_stripe_webhook_event"
        ][-1]
        self.assertEqual(finalize[2], "failed")

    def test_processed_duplicate_does_not_retrieve_provider_objects(self) -> None:
        database = RecordingDatabase()
        database.claim_row = {
            "state": "processed",
            "webhook_event_id": WEBHOOK_ROW_ID,
            "processing_token": "00000000-0000-4000-8000-000000000000",
        }
        commerce, _, provider = service(database)

        self.assertEqual(commerce.handle_webhook(b"raw", "valid"), "processed")
        self.assertEqual([name for name, _ in provider.calls], ["verify_webhook"])

    def test_in_progress_duplicate_is_retryable_not_acknowledged(self) -> None:
        database = RecordingDatabase()
        database.claim_row = {
            "state": "in_progress",
            "webhook_event_id": WEBHOOK_ROW_ID,
            "processing_token": "00000000-0000-4000-8000-000000000000",
        }
        commerce, _, _ = service(database)

        with self.assertRaises(CommerceUnavailableError):
            commerce.handle_webhook(b"raw", "valid")

    def test_reclaimed_delivery_fences_the_stale_worker_with_a_fresh_token(
        self,
    ) -> None:
        class ReclaimingDatabase(RecordingDatabase):
            def __init__(self) -> None:
                super().__init__()
                self.commerce: TotalLossCommerceService | None = None
                self.processing_tokens: list[str] = []
                self.active_processing_token: str | None = None
                self.reentered = False
                self.reclaimed_outcome: str | None = None
                self.accepted_fulfillment_tokens: list[str] = []

            def claim_stripe_webhook_event(
                self,
                event: StripeEvent,
                digest: str,
                size: int,
                token: str,
            ) -> Mapping[str, Any]:
                self.calls.append(
                    ("claim_stripe_webhook_event", (event, digest, size, token))
                )
                self.processing_tokens.append(token)
                self.active_processing_token = token
                return {
                    "state": "claimed",
                    "webhook_event_id": WEBHOOK_ROW_ID,
                    "processing_token": token,
                }

            def fulfill_total_loss_checkout_payment(
                self, *args: Any
            ) -> Mapping[str, Any]:
                self.calls.append(("fulfill_total_loss_checkout_payment", args))
                processing_token = args[4]
                if not self.reentered:
                    self.reentered = True
                    if self.commerce is None:
                        raise AssertionError("Commerce service was not attached")
                    # Simulate the lease expiring and a redelivery reclaiming the
                    # event while the original worker is still in flight.
                    self.reclaimed_outcome = self.commerce.handle_webhook(
                        b"same-signed-payload", "valid"
                    )
                if processing_token != self.active_processing_token:
                    raise SupabaseContractError("Webhook processing lease is stale")
                self.accepted_fulfillment_tokens.append(processing_token)
                return self.fulfill_row

            def finalize_stripe_webhook_event(
                self, *args: Any
            ) -> Mapping[str, Any]:
                self.calls.append(("finalize_stripe_webhook_event", args))
                if args[1] != self.active_processing_token:
                    raise SupabaseContractError("Webhook processing lease is stale")
                return {"status": args[2]}

        provider = RecordingProvider()
        provider.session = checkout_session(
            status="complete",
            payment_status="paid",
            url=None,
            payment_intent_id=INTENT_ID,
        )
        database = ReclaimingDatabase()
        commerce, _, _ = service(database, provider)
        database.commerce = commerce

        with patch(
            "venfour.commerce.uuid4",
            side_effect=[
                PROCESSING_TOKEN,
                "c0000000-0000-4000-8000-00000000000c",
            ],
        ):
            with self.assertRaisesRegex(SupabaseContractError, "lease is stale"):
                commerce.handle_webhook(b"same-signed-payload", "valid")

        self.assertEqual(len(database.processing_tokens), 2)
        self.assertNotEqual(*database.processing_tokens)
        self.assertEqual(database.reclaimed_outcome, "processed")
        self.assertEqual(
            database.accepted_fulfillment_tokens,
            [database.processing_tokens[1]],
        )

    def test_unsupported_event_is_deduplicated_and_audited_as_ignored(self) -> None:
        provider = RecordingProvider()
        provider.event = stripe_event("customer.created", data_object_id=CUSTOMER_ID)
        commerce, database, _ = service(provider=provider)

        self.assertEqual(commerce.handle_webhook(b"raw", "valid"), "ignored")

        finalize = next(value for name, value in database.calls if name == "finalize_stripe_webhook_event")
        self.assertEqual(finalize[2], "ignored")
        self.assertIsNone(finalize[3])

    def test_unrelated_supported_events_are_authoritatively_ignored(self) -> None:
        cases = (
            "checkout.session.completed",
            "refund.updated",
            "charge.dispute.created",
        )
        for event_type in cases:
            with self.subTest(event_type=event_type):
                provider = RecordingProvider()
                provider.event = stripe_event(event_type)
                database = RecordingDatabase()
                if event_type.startswith("checkout."):
                    provider.session = checkout_session(metadata={})
                elif event_type.startswith("refund."):
                    provider.refund = stripe_refund(metadata={})
                    provider.event = replace(
                        provider.event, refund_snapshot=provider.refund
                    )
                    database.payment_context = None
                else:
                    database.payment_context = None
                    provider.payment = payment_intent(metadata={})
                commerce, database, _ = service(database, provider)

                self.assertEqual(
                    commerce.handle_webhook(b"unrelated", "valid"), "ignored"
                )

                finalize = [
                    value
                    for name, value in database.calls
                    if name == "finalize_stripe_webhook_event"
                ][-1]
                self.assertEqual(finalize[2], "ignored")
                self.assertIsNone(finalize[3])
                self.assertIsNone(finalize[4])

    def test_local_checkout_and_refund_missing_venfour_metadata_fail_closed(
        self,
    ) -> None:
        cases = ("checkout.session.completed", "refund.updated")
        for event_type in cases:
            with self.subTest(event_type=event_type):
                provider = RecordingProvider()
                provider.event = stripe_event(event_type)
                database = RecordingDatabase()
                if event_type.startswith("checkout."):
                    provider.session = checkout_session(metadata={})
                    database.checkout_context_by_session = context_row(
                        external_checkout_session_id=SESSION_ID,
                        external_payment_intent_id=None,
                        attempt_status="open",
                    )
                else:
                    provider.refund = stripe_refund(metadata={})
                    provider.event = replace(
                        provider.event, refund_snapshot=provider.refund
                    )
                commerce, database, _ = service(database, provider)

                with self.assertRaises(CommerceProviderContractError):
                    commerce.handle_webhook(b"local-metadata-loss", "valid")

                finalize = [
                    value
                    for name, value in database.calls
                    if name == "finalize_stripe_webhook_event"
                ][-1]
                self.assertEqual(finalize[2], "failed")
                self.assertEqual(finalize[5], "PROVIDER_CONTRACT_INVALID")
                self.assertFalse(
                    any(
                        name
                        in {
                            "fulfill_total_loss_checkout_payment",
                            "record_total_loss_refund_result",
                        }
                        for name, _ in database.calls
                    )
                )

    def test_dispute_before_checkout_fulfillment_retries_then_suspends(
        self,
    ) -> None:
        provider = RecordingProvider()
        provider.event = stripe_event("charge.dispute.created")
        database = RecordingDatabase()
        database.payment_context = payment_context_row(
            payment_transaction_id=None
        )
        commerce, database, _ = service(database, provider)

        with self.assertRaises(CommerceNotFoundError):
            commerce.handle_webhook(b"same-dispute", "valid")

        first_finalize = [
            value
            for name, value in database.calls
            if name == "finalize_stripe_webhook_event"
        ][-1]
        self.assertEqual(first_finalize[2], "failed")
        self.assertEqual(first_finalize[5], "LOCAL_CONTEXT_NOT_FOUND")
        self.assertFalse(
            any(name == "record_total_loss_dispute" for name, _ in database.calls)
        )

        database.calls.clear()
        database.payment_context = payment_context_row()
        self.assertEqual(
            commerce.handle_webhook(b"same-dispute", "valid"), "processed"
        )
        self.assertTrue(
            any(name == "record_total_loss_dispute" for name, _ in database.calls)
        )
        final = [
            value
            for name, value in database.calls
            if name == "finalize_stripe_webhook_event"
        ][-1]
        self.assertEqual(final[2], "processed")
        self.assertEqual(final[3], CASE_ID)
        self.assertEqual(final[4], ORDER_ID)

    def test_partial_venfour_metadata_remains_fail_closed(self) -> None:
        cases = (
            (
                "checkout.session.completed",
                {"venfour_order_id": ORDER_ID},
            ),
            (
                "refund.updated",
                {"venfour_refund_request_id": REFUND_REQUEST_ID},
            ),
        )
        for event_type, metadata in cases:
            with self.subTest(event_type=event_type):
                provider = RecordingProvider()
                provider.event = stripe_event(event_type)
                if event_type.startswith("checkout."):
                    provider.session = checkout_session(metadata=metadata)
                else:
                    provider.refund = stripe_refund(metadata=metadata)
                    provider.event = replace(
                        provider.event, refund_snapshot=provider.refund
                    )
                commerce, database, _ = service(provider=provider)

                with self.assertRaises(CommerceProviderContractError):
                    commerce.handle_webhook(b"partial", "valid")

                finalize = [
                    value
                    for name, value in database.calls
                    if name == "finalize_stripe_webhook_event"
                ][-1]
                self.assertEqual(finalize[2], "failed")
                self.assertEqual(finalize[5], "PROVIDER_CONTRACT_INVALID")

    def test_duplicate_payment_is_fail_closed_and_records_operational_failure(self) -> None:
        provider = RecordingProvider()
        provider.session = checkout_session(
            status="complete",
            payment_status="paid",
            url=None,
            payment_intent_id=INTENT_ID,
        )
        database = RecordingDatabase()
        database.fulfill_row = {
            **database.fulfill_row,
            "outcome": "duplicate_payment",
        }
        commerce, database, _ = service(database, provider)

        with self.assertRaises(CommerceConflictError):
            commerce.handle_webhook(b"raw", "valid")

        finalize = [value for name, value in database.calls if name == "finalize_stripe_webhook_event"][-1]
        self.assertEqual(finalize[2], "failed")
        self.assertEqual(finalize[5], "DUPLICATE_PAYMENT")

    def test_refund_event_retrieves_authoritative_state_and_records_result(self) -> None:
        provider = RecordingProvider()
        provider.event = stripe_event("refund.updated")
        commerce, database, _ = service(provider=provider)

        self.assertEqual(commerce.handle_webhook(b"raw", "valid"), "processed")

        self.assertTrue(any(name == "resolve_total_loss_payment_context" for name, _ in database.calls))
        record = next(value for name, value in database.calls if name == "record_total_loss_refund_result")
        self.assertEqual(record[0], REFUND_REQUEST_ID)
        self.assertEqual(record[2], EVENT_ID)

    def test_successful_refund_keeps_clean_duplicate_payment_coverage(
        self,
    ) -> None:
        provider = RecordingProvider()
        provider.event = stripe_event("refund.updated")
        database = RecordingDatabase()
        database.refund_result = {
            **database.refund_result,
            "order_status": "paid",
            "entitlement_status": "active",
        }
        commerce, database, provider = service(database, provider)

        self.assertEqual(
            commerce.handle_webhook(b"aggregate-refund", "valid"),
            "processed",
        )
        self.assertEqual(
            sum(name == "retrieve_refund" for name, _ in provider.calls), 1
        )
        self.assertEqual(
            sum(
                name == "record_total_loss_refund_result"
                for name, _ in database.calls
            ),
            1,
        )
        self.assertFalse(
            any(name == "create_refund" for name, _ in provider.calls)
        )

        provider_call_count = len(provider.calls)
        database.claim_row = {
            **database.claim_row,
            "state": "processed",
        }
        self.assertEqual(
            commerce.handle_webhook(b"aggregate-refund", "valid"),
            "processed",
        )
        self.assertEqual(len(provider.calls), provider_call_count + 1)
        self.assertEqual(provider.calls[-1][0], "verify_webhook")

    def test_successful_refund_accepts_exact_aggregate_projection_matrix(
        self,
    ) -> None:
        valid_projections = (
            ("paid", "active"),
            ("disputed", "suspended"),
            ("refunded", "refunded_access_retained"),
            ("refunded", "revoked"),
            ("refunded", "suspended"),
        )
        for order_status, entitlement_status in valid_projections:
            with self.subTest(
                order_status=order_status,
                entitlement_status=entitlement_status,
            ):
                provider = RecordingProvider()
                provider.event = stripe_event("refund.updated")
                database = RecordingDatabase()
                database.refund_result = {
                    **database.refund_result,
                    "order_status": order_status,
                    "entitlement_status": entitlement_status,
                }
                commerce, _, _ = service(database, provider)

                self.assertEqual(
                    commerce.handle_webhook(b"refund-matrix", "valid"),
                    "processed",
                )

        invalid_projections = (
            ("paid", "suspended"),
            ("disputed", "revoked"),
            ("refunded", "active"),
        )
        for order_status, entitlement_status in invalid_projections:
            with self.subTest(
                invalid_order_status=order_status,
                invalid_entitlement_status=entitlement_status,
            ):
                provider = RecordingProvider()
                provider.event = stripe_event("refund.updated")
                database = RecordingDatabase()
                database.refund_result = {
                    **database.refund_result,
                    "order_status": order_status,
                    "entitlement_status": entitlement_status,
                }
                commerce, database, _ = service(database, provider)

                with self.assertRaises(SupabaseContractError):
                    commerce.handle_webhook(
                        b"invalid-refund-matrix", "valid"
                    )
                finalize = [
                    value
                    for name, value in database.calls
                    if name == "finalize_stripe_webhook_event"
                ][-1]
                self.assertEqual(finalize[2], "failed")
                self.assertEqual(finalize[5], "DATABASE_UNAVAILABLE")

    def test_delayed_refund_event_uses_signed_snapshot_before_newer_failure(
        self,
    ) -> None:
        provider = RecordingProvider()
        snapshot = stripe_refund(created=NOW - 120)
        provider.refund = replace(
            snapshot,
            status="failed",
            failure_balance_transaction_id=REFUND_FAILURE_TRANSACTION_ID,
        )
        provider.event = stripe_event(
            "refund.created",
            id="evt_test_delayed_refund_created_12345",
            created=NOW - 60,
            refund_snapshot=snapshot,
        )
        database = RecordingDatabase()
        database.refund_result = {
            **database.refund_result,
            "outcome": "stale",
            "refund_status": "failed",
            "provider_status": "failed",
            "refund_transaction_id": REFUND_TRANSACTION_ID,
            "refund_reversal_transaction_id": (
                REFUND_REVERSAL_TRANSACTION_ID
            ),
            "order_status": "paid",
            "entitlement_status": "active",
        }
        commerce, database, _ = service(database, provider)

        self.assertEqual(
            commerce.handle_webhook(b"delayed-refund-created", "valid"),
            "processed",
        )
        created_record = next(
            value
            for name, value in database.calls
            if name == "record_total_loss_refund_result"
        )
        self.assertEqual(created_record[1], snapshot)
        self.assertEqual(created_record[1].status, "succeeded")
        self.assertIsNone(created_record[3])
        self.assertEqual(created_record[4], NOW - 60)

        database.calls.clear()
        provider.event = stripe_event(
            "refund.failed",
            id="evt_test_refund_failed_after_created_12345",
            created=NOW,
            refund_snapshot=provider.refund,
        )
        database.refund_result = {
            **database.refund_result,
            "outcome": "failed",
        }

        self.assertEqual(
            commerce.handle_webhook(b"refund-failed", "valid"),
            "processed",
        )
        failed_record = next(
            value
            for name, value in database.calls
            if name == "record_total_loss_refund_result"
        )
        self.assertEqual(failed_record[1], provider.refund)
        self.assertEqual(failed_record[3], "PROVIDER_REFUND_FAILED")
        self.assertEqual(failed_record[4], NOW)

    def test_refund_event_rejects_snapshot_identity_drift(self) -> None:
        provider = RecordingProvider()
        provider.event = stripe_event(
            "refund.updated",
            refund_snapshot=stripe_refund(amount=AMOUNT + 1),
        )
        commerce, database, _ = service(provider=provider)

        with self.assertRaises(CommerceProviderContractError):
            commerce.handle_webhook(b"refund-snapshot-drift", "valid")

        self.assertFalse(
            any(
                name == "record_total_loss_refund_result"
                for name, _ in database.calls
            )
        )
        finalize = [
            value
            for name, value in database.calls
            if name == "finalize_stripe_webhook_event"
        ][-1]
        self.assertEqual(finalize[2], "failed")
        self.assertEqual(finalize[5], "PROVIDER_CONTRACT_INVALID")

    def test_refund_terminal_and_stale_events_are_acknowledged_without_regression(self) -> None:
        cases = (
            (
                "refund.failed",
                "failed",
                "PROVIDER_REFUND_FAILED",
                "already_failed",
            ),
            (
                "refund.updated",
                "canceled",
                "PROVIDER_REFUND_CANCELED",
                "already_canceled",
            ),
            ("refund.updated", "pending", None, "stale"),
        )
        for event_type, status, failure_code, outcome in cases:
            with self.subTest(status=status, outcome=outcome):
                provider = RecordingProvider()
                provider.refund = stripe_refund(
                    status=status,
                    balance_transaction_id=(
                        None if status in {"pending", "failed", "canceled"} else REFUND_BALANCE_TRANSACTION_ID
                    ),
                )
                provider.event = stripe_event(
                    event_type, refund_snapshot=provider.refund
                )
                database = RecordingDatabase()
                database.refund_result = {
                    **database.refund_result,
                    "outcome": outcome,
                    "refund_status": (
                        "succeeded" if outcome == "stale" else status
                    ),
                    "provider_status": (
                        "succeeded" if outcome == "stale" else status
                    ),
                    "refund_transaction_id": (
                        REFUND_TRANSACTION_ID if outcome == "stale" else None
                    ),
                    "refund_reversal_transaction_id": None,
                    "order_status": (
                        "refunded" if outcome == "stale" else "paid"
                    ),
                    "entitlement_status": (
                        "refunded_access_retained"
                        if outcome == "stale"
                        else "active"
                    ),
                }
                commerce, database, _ = service(database, provider)

                self.assertEqual(
                    commerce.handle_webhook(b"raw", "valid"), "processed"
                )
                record = next(
                    value
                    for name, value in database.calls
                    if name == "record_total_loss_refund_result"
                )
                self.assertEqual(record[3], failure_code)

    def test_requires_action_refund_remains_pending_until_authoritative_success(self) -> None:
        provider = RecordingProvider()
        database = RecordingDatabase()
        commerce, database, provider = service(database, provider)

        provider.refund = stripe_refund(
            status="requires_action", balance_transaction_id=None
        )
        provider.event = stripe_event(
            "refund.updated", refund_snapshot=provider.refund
        )
        database.refund_result = {
            **database.refund_result,
            "outcome": "pending",
            "refund_status": "pending",
            "provider_status": "requires_action",
            "refund_transaction_id": None,
            "refund_reversal_transaction_id": None,
            "order_status": "paid",
            "entitlement_status": "active",
        }
        self.assertEqual(commerce.handle_webhook(b"first", "valid"), "processed")
        first_record = next(
            value
            for name, value in database.calls
            if name == "record_total_loss_refund_result"
        )
        self.assertEqual(first_record[1].status, "requires_action")
        self.assertIsNone(first_record[3])
        self.assertEqual(database.refund_result["order_status"], "paid")
        self.assertEqual(database.refund_result["entitlement_status"], "active")

        database.calls.clear()
        provider.refund = stripe_refund(status="succeeded")
        provider.event = stripe_event(
            "refund.updated",
            id="evt_test_refund_succeeded_12345",
            refund_snapshot=provider.refund,
        )
        database.refund_result = {
            **database.refund_result,
            "outcome": "succeeded",
            "refund_status": "succeeded",
            "provider_status": "succeeded",
            "refund_transaction_id": REFUND_TRANSACTION_ID,
            "refund_reversal_transaction_id": None,
            "order_status": "refunded",
            "entitlement_status": "refunded_access_retained",
        }
        self.assertEqual(commerce.handle_webhook(b"second", "valid"), "processed")
        second_record = next(
            value
            for name, value in database.calls
            if name == "record_total_loss_refund_result"
        )
        self.assertEqual(second_record[1].status, "succeeded")
        self.assertIsNone(second_record[3])

    def test_newer_refund_failure_reverses_succeeded_refund_idempotently(
        self,
    ) -> None:
        cases = (
            (
                "refund.failed",
                "failed",
                "PROVIDER_REFUND_FAILED",
                "already_failed",
            ),
            (
                "refund.updated",
                "canceled",
                "PROVIDER_REFUND_CANCELED",
                "already_canceled",
            ),
        )
        for event_type, status, failure_code, replay_outcome in cases:
            with self.subTest(status=status):
                provider = RecordingProvider()
                provider.refund = stripe_refund(
                    status=status,
                    failure_balance_transaction_id=(
                        REFUND_FAILURE_TRANSACTION_ID
                    ),
                )
                provider.event = stripe_event(
                    event_type, refund_snapshot=provider.refund
                )
                database = RecordingDatabase()
                terminal_result = {
                    **database.refund_result,
                    "outcome": status,
                    "refund_status": status,
                    "provider_status": status,
                    "refund_transaction_id": REFUND_TRANSACTION_ID,
                    "refund_reversal_transaction_id": (
                        REFUND_REVERSAL_TRANSACTION_ID
                    ),
                    "order_status": "paid",
                    "entitlement_status": "active",
                }
                database.refund_result = terminal_result
                commerce, database, _ = service(database, provider)

                self.assertEqual(
                    commerce.handle_webhook(b"newer-terminal", "valid"),
                    "processed",
                )
                record = next(
                    value
                    for name, value in database.calls
                    if name == "record_total_loss_refund_result"
                )
                self.assertEqual(
                    record[1].balance_transaction_id,
                    REFUND_BALANCE_TRANSACTION_ID,
                )
                self.assertEqual(
                    record[1].failure_balance_transaction_id,
                    REFUND_FAILURE_TRANSACTION_ID,
                )
                self.assertEqual(record[3], failure_code)

                database.calls.clear()
                database.refund_result = {
                    **terminal_result,
                    "outcome": replay_outcome,
                }
                self.assertEqual(
                    commerce.handle_webhook(b"same-terminal", "valid"),
                    "processed",
                )

                database.calls.clear()
                provider.refund = stripe_refund(
                    status="succeeded", created=NOW - 30
                )
                provider.event = stripe_event(
                    "refund.updated",
                    id=f"evt_test_older_{status}_12345",
                    created=NOW - 30,
                    refund_snapshot=provider.refund,
                )
                database.refund_result = {
                    **terminal_result,
                    "outcome": "stale",
                }
                self.assertEqual(
                    commerce.handle_webhook(b"older-success", "valid"),
                    "processed",
                )

    def test_old_failed_or_reversed_refund_replay_after_new_refund_is_stale(
        self,
    ) -> None:
        cases = (
            (
                "failed",
                None,
                None,
                None,
                None,
                "refunded_access_retained",
            ),
            (
                "canceled",
                REFUND_BALANCE_TRANSACTION_ID,
                REFUND_FAILURE_TRANSACTION_ID,
                REFUND_TRANSACTION_ID,
                REFUND_REVERSAL_TRANSACTION_ID,
                "suspended",
            ),
        )
        for (
            status,
            balance_id,
            failure_balance_id,
            refund_transaction_id,
            reversal_transaction_id,
            entitlement_status,
        ) in cases:
            with self.subTest(status=status):
                provider = RecordingProvider()
                provider.refund = stripe_refund(
                    status=status,
                    balance_transaction_id=balance_id,
                    failure_balance_transaction_id=failure_balance_id,
                )
                provider.event = stripe_event(
                    "refund.failed" if status == "failed" else "refund.updated",
                    refund_snapshot=provider.refund,
                )
                database = RecordingDatabase()
                database.refund_result = {
                    **database.refund_result,
                    "outcome": "stale",
                    "refund_status": status,
                    "provider_status": status,
                    "refund_transaction_id": refund_transaction_id,
                    "refund_reversal_transaction_id": reversal_transaction_id,
                    "order_status": "refunded",
                    "entitlement_status": entitlement_status,
                }
                commerce, database, _ = service(database, provider)

                self.assertEqual(
                    commerce.handle_webhook(b"old-refund-a", "valid"),
                    "processed",
                )

                database.calls.clear()
                database.refund_result = {
                    **database.refund_result,
                    "outcome": status,
                }
                with self.assertRaises(SupabaseContractError):
                    commerce.handle_webhook(
                        b"incoherent-current-refund-a", "valid"
                    )

    def test_dispute_before_refund_preserves_refund_and_terminal_access_state(
        self,
    ) -> None:
        cases = (
            ("won", "refunded_access_retained"),
            ("lost", "suspended"),
        )
        for dispute_status, expected_entitlement in cases:
            with self.subTest(dispute_status=dispute_status):
                provider = RecordingProvider()
                database = RecordingDatabase()
                commerce, database, _ = service(database, provider)

                provider.event = stripe_event("charge.dispute.created")
                self.assertEqual(
                    commerce.handle_webhook(b"dispute-first", "valid"),
                    "processed",
                )

                database.calls.clear()
                provider.event = stripe_event(
                    "refund.updated", id="evt_test_refund_after_dispute_12345"
                )
                provider.refund = stripe_refund(status="succeeded")
                database.refund_result = {
                    **database.refund_result,
                    "outcome": "succeeded",
                    "order_status": "refunded",
                    "entitlement_status": "suspended",
                }
                self.assertEqual(
                    commerce.handle_webhook(b"refund-second", "valid"),
                    "processed",
                )
                refund_projection = database.refund_result
                self.assertEqual(refund_projection["order_status"], "refunded")
                self.assertEqual(
                    refund_projection["entitlement_status"], "suspended"
                )

                database.calls.clear()
                provider.dispute = replace(
                    provider.dispute, status=dispute_status
                )
                provider.event = stripe_event(
                    "charge.dispute.closed",
                    id=f"evt_test_dispute_{dispute_status}_12345",
                    dispute_snapshot=provider.dispute,
                )
                database.dispute_result = {
                    **database.dispute_result,
                    "outcome": "applied",
                    "dispute_status": dispute_status,
                    "order_status": "refunded",
                    "entitlement_status": expected_entitlement,
                }
                self.assertEqual(
                    commerce.handle_webhook(b"dispute-terminal", "valid"),
                    "processed",
                )
                self.assertEqual(
                    database.dispute_result["order_status"], "refunded"
                )
                self.assertEqual(
                    database.dispute_result["entitlement_status"],
                    expected_entitlement,
                )

    def test_active_dispute_suspends_through_database_transition(self) -> None:
        provider = RecordingProvider()
        provider.event = stripe_event("charge.dispute.created")
        commerce, database, _ = service(provider=provider)

        self.assertEqual(commerce.handle_webhook(b"raw", "valid"), "processed")

        record = next(value for name, value in database.calls if name == "record_total_loss_dispute")
        self.assertEqual(record[3], "charge.dispute.created")
        self.assertEqual(record[4], "active")

    def test_adverse_dispute_keeps_clean_duplicate_payment_coverage(
        self,
    ) -> None:
        provider = RecordingProvider()
        provider.event = stripe_event("charge.dispute.created")
        database = RecordingDatabase()
        database.dispute_result = {
            **database.dispute_result,
            "order_status": "paid",
            "entitlement_status": "active",
        }
        commerce, database, provider = service(database, provider)

        self.assertEqual(
            commerce.handle_webhook(b"aggregate-dispute", "valid"),
            "processed",
        )
        self.assertEqual(
            sum(name == "retrieve_dispute" for name, _ in provider.calls), 1
        )
        self.assertEqual(
            sum(
                name == "record_total_loss_dispute"
                for name, _ in database.calls
            ),
            1,
        )
        self.assertFalse(
            any(
                name
                in {
                    "create_refund",
                    "fulfill_total_loss_checkout_payment",
                }
                for name, _ in provider.calls
            )
        )

    def test_dispute_accepts_exact_aggregate_projection_matrix(self) -> None:
        cases = (
            (
                "needs_response",
                "active",
                (
                    ("paid", "active"),
                    ("disputed", "suspended"),
                    ("refunded", "suspended"),
                ),
            ),
            (
                "won",
                "won",
                (
                    ("paid", "active"),
                    ("disputed", "suspended"),
                    ("refunded", "suspended"),
                    ("refunded", "refunded_access_retained"),
                    ("refunded", "revoked"),
                ),
            ),
        )
        for provider_status, result_status, projections in cases:
            for order_status, entitlement_status in projections:
                with self.subTest(
                    provider_status=provider_status,
                    order_status=order_status,
                    entitlement_status=entitlement_status,
                ):
                    provider = RecordingProvider()
                    provider.dispute = replace(
                        provider.dispute, status=provider_status
                    )
                    provider.event = stripe_event(
                        "charge.dispute.closed"
                        if result_status == "won"
                        else "charge.dispute.created",
                        dispute_snapshot=provider.dispute,
                    )
                    database = RecordingDatabase()
                    database.dispute_result = {
                        **database.dispute_result,
                        "dispute_status": result_status,
                        "order_status": order_status,
                        "entitlement_status": entitlement_status,
                    }
                    commerce, _, _ = service(database, provider)

                    self.assertEqual(
                        commerce.handle_webhook(
                            b"dispute-matrix", "valid"
                        ),
                        "processed",
                    )

        invalid_cases = (
            ("needs_response", "active", "refunded", "revoked"),
            ("lost", "lost", "refunded", "refunded_access_retained"),
            ("won", "won", "refunded", "active"),
        )
        for (
            provider_status,
            result_status,
            order_status,
            entitlement_status,
        ) in invalid_cases:
            with self.subTest(
                invalid_provider_status=provider_status,
                invalid_order_status=order_status,
                invalid_entitlement_status=entitlement_status,
            ):
                provider = RecordingProvider()
                provider.dispute = replace(
                    provider.dispute, status=provider_status
                )
                provider.event = stripe_event(
                    "charge.dispute.closed"
                    if result_status in {"won", "lost"}
                    else "charge.dispute.created",
                    dispute_snapshot=provider.dispute,
                )
                database = RecordingDatabase()
                database.dispute_result = {
                    **database.dispute_result,
                    "dispute_status": result_status,
                    "order_status": order_status,
                    "entitlement_status": entitlement_status,
                }
                commerce, database, _ = service(database, provider)

                with self.assertRaises(SupabaseContractError):
                    commerce.handle_webhook(
                        b"invalid-dispute-matrix", "valid"
                    )
                finalize = [
                    value
                    for name, value in database.calls
                    if name == "finalize_stripe_webhook_event"
                ][-1]
                self.assertEqual(finalize[2], "failed")
                self.assertEqual(finalize[5], "DATABASE_UNAVAILABLE")

    def test_first_observed_prevented_dispute_maps_to_favorable_terminal(self) -> None:
        provider = RecordingProvider()
        provider.dispute = replace(provider.dispute, status="prevented")
        provider.event = stripe_event(
            "charge.dispute.created", dispute_snapshot=provider.dispute
        )
        database = RecordingDatabase()
        database.dispute_result = {
            **database.dispute_result,
            "outcome": "applied",
            "dispute_status": "won",
            "order_status": "paid",
            "entitlement_status": "active",
        }
        commerce, database, _ = service(database, provider)

        self.assertEqual(commerce.handle_webhook(b"raw", "valid"), "processed")

        record = next(
            value for name, value in database.calls if name == "record_total_loss_dispute"
        )
        self.assertEqual(record[3], "charge.dispute.created")
        self.assertEqual(record[4], "won")

    def test_active_dispute_updated_to_prevented_maps_to_won(self) -> None:
        provider = RecordingProvider()
        provider.dispute = replace(provider.dispute, status="prevented")
        provider.event = stripe_event(
            "charge.dispute.updated", dispute_snapshot=provider.dispute
        )
        database = RecordingDatabase()
        database.dispute_result = {
            **database.dispute_result,
            "outcome": "applied",
            "dispute_status": "won",
            "order_status": "paid",
            "entitlement_status": "active",
        }
        commerce, database, _ = service(database, provider)

        self.assertEqual(commerce.handle_webhook(b"raw", "valid"), "processed")

        record = next(
            value for name, value in database.calls if name == "record_total_loss_dispute"
        )
        self.assertEqual(record[3], "charge.dispute.updated")
        self.assertEqual(record[4], "won")

    def test_dispute_larger_than_original_payment_is_recorded_conservatively(self) -> None:
        provider = RecordingProvider()
        provider.dispute = replace(provider.dispute, amount=AMOUNT + 500)
        provider.event = stripe_event(
            "charge.dispute.created", dispute_snapshot=provider.dispute
        )
        commerce, database, _ = service(provider=provider)

        self.assertEqual(commerce.handle_webhook(b"raw", "valid"), "processed")

        record = next(
            value for name, value in database.calls if name == "record_total_loss_dispute"
        )
        self.assertEqual(record[1].amount, AMOUNT + 500)
        self.assertEqual(record[3], "charge.dispute.created")
        self.assertEqual(record[4], "active")

    def test_current_dispute_identifier_prefix_is_accepted_end_to_end(self) -> None:
        provider = RecordingProvider()
        provider.dispute = replace(provider.dispute, id=CURRENT_DISPUTE_ID)
        provider.event = stripe_event(
            "charge.dispute.created",
            data_object_id=CURRENT_DISPUTE_ID,
            dispute_snapshot=provider.dispute,
        )
        commerce, database, _ = service(provider=provider)

        self.assertEqual(commerce.handle_webhook(b"raw", "valid"), "processed")

        self.assertIn(("retrieve_dispute", CURRENT_DISPUTE_ID), provider.calls)
        record = next(
            value for name, value in database.calls if name == "record_total_loss_dispute"
        )
        self.assertEqual(record[1].id, CURRENT_DISPUTE_ID)

    def test_dispute_event_rejects_other_identifier_prefixes_before_retrieval(self) -> None:
        provider = RecordingProvider()
        provider.event = stripe_event(
            "charge.dispute.created", data_object_id="di_test_dispute_12345"
        )
        commerce, _, provider = service(provider=provider)

        with self.assertRaises(CommerceProviderContractError):
            commerce.handle_webhook(b"raw", "valid")

        self.assertFalse(
            any(name == "retrieve_dispute" for name, _ in provider.calls)
        )

    def test_warning_closed_and_warning_to_formal_keep_exact_event_semantics(self) -> None:
        cases = (
            ("charge.dispute.closed", "warning_closed", "won"),
            ("charge.dispute.created", "warning_needs_response", "active"),
            ("charge.dispute.updated", "needs_response", "active"),
        )
        for event_type, provider_status, expected_status in cases:
            with self.subTest(event_type=event_type, provider_status=provider_status):
                provider = RecordingProvider()
                provider.dispute = replace(provider.dispute, status=provider_status)
                provider.event = stripe_event(
                    event_type, dispute_snapshot=provider.dispute
                )
                commerce, database, _ = service(provider=provider)

                self.assertEqual(
                    commerce.handle_webhook(b"raw", "valid"), "processed"
                )

                record = next(
                    value
                    for name, value in database.calls
                    if name == "record_total_loss_dispute"
                )
                self.assertEqual(record[3], event_type)
                self.assertEqual(record[4], expected_status)

    def test_funds_events_remain_distinct_from_dispute_status_projection(self) -> None:
        cases = (
            ("charge.dispute.funds_withdrawn", "lost", "lost"),
            ("charge.dispute.funds_reinstated", "won", "won"),
        )
        for event_type, provider_status, expected_status in cases:
            with self.subTest(event_type=event_type):
                provider = RecordingProvider()
                provider.dispute = replace(provider.dispute, status=provider_status)
                provider.event = stripe_event(
                    event_type, dispute_snapshot=provider.dispute
                )
                commerce, database, _ = service(provider=provider)

                self.assertEqual(
                    commerce.handle_webhook(b"raw", "valid"), "processed"
                )

                record = next(
                    value
                    for name, value in database.calls
                    if name == "record_total_loss_dispute"
                )
                self.assertEqual(record[3], event_type)
                self.assertEqual(record[4], expected_status)

    def test_out_of_order_stale_dispute_is_successfully_acknowledged(self) -> None:
        provider = RecordingProvider()
        provider.event = stripe_event("charge.dispute.updated")
        database = RecordingDatabase()
        database.dispute_result = {
            **database.dispute_result,
            "outcome": "stale",
            "order_status": "disputed",
            "entitlement_status": "suspended",
        }
        commerce, _, _ = service(database, provider)

        self.assertEqual(commerce.handle_webhook(b"raw", "valid"), "processed")

    def test_delayed_dispute_event_uses_signed_status_before_current_close(
        self,
    ) -> None:
        provider = RecordingProvider()
        snapshot = replace(
            provider.dispute,
            status="needs_response",
            created=NOW - 120,
        )
        provider.dispute = replace(snapshot, status="won")
        provider.event = stripe_event(
            "charge.dispute.created",
            id="evt_test_delayed_dispute_created_12345",
            created=NOW - 60,
            dispute_snapshot=snapshot,
        )
        database = RecordingDatabase()
        database.dispute_result = {
            **database.dispute_result,
            "outcome": "stale",
            "dispute_status": "won",
            "order_status": "paid",
            "entitlement_status": "active",
        }
        commerce, database, _ = service(database, provider)

        self.assertEqual(
            commerce.handle_webhook(b"delayed-dispute-created", "valid"),
            "processed",
        )
        created_record = next(
            value
            for name, value in database.calls
            if name == "record_total_loss_dispute"
        )
        self.assertEqual(created_record[1], snapshot)
        self.assertEqual(created_record[4], "active")
        self.assertEqual(created_record[5], NOW - 60)

        database.calls.clear()
        provider.event = stripe_event(
            "charge.dispute.closed",
            id="evt_test_dispute_closed_after_created_12345",
            created=NOW,
            dispute_snapshot=provider.dispute,
        )
        database.dispute_result = {
            **database.dispute_result,
            "outcome": "applied",
        }

        self.assertEqual(
            commerce.handle_webhook(b"dispute-closed", "valid"),
            "processed",
        )
        closed_record = next(
            value
            for name, value in database.calls
            if name == "record_total_loss_dispute"
        )
        self.assertEqual(closed_record[1], provider.dispute)
        self.assertEqual(closed_record[4], "won")
        self.assertEqual(closed_record[5], NOW)


class CommerceRefundTests(unittest.TestCase):
    def test_full_refund_uses_stable_idempotency_and_retained_access_policy(self) -> None:
        commerce, database, provider = service()

        result = commerce.refund(
            case_id=CASE_ID,
            order_id=ORDER_ID,
            payment_transaction_id=PAYMENT_ID,
            client_request_id=CLIENT_REQUEST_ID,
            reason_code="FAIR_RESULT",
            access_policy="retain",
        )

        self.assertEqual(result.refund_status, "succeeded")
        reserve = next(value for name, value in database.calls if name == "reserve_total_loss_refund")
        self.assertEqual(reserve[-1], "retain")
        create = next(value for name, value in provider.calls if name == "create_refund")
        self.assertEqual(create["idempotency_key"], f"venfour:refund:v1:{REFUND_REQUEST_ID}")
        self.assertEqual(create["amount_minor_units"], AMOUNT)

    def test_full_refund_can_explicitly_revoke_access(self) -> None:
        database = RecordingDatabase()
        database.refund_reserve_row = {
            **database.refund_reserve_row,
            "access_policy": "revoke",
        }
        database.refund_result = {
            **database.refund_result,
            "outcome": "succeeded",
            "refund_status": "succeeded",
            "provider_status": "succeeded",
            "order_status": "refunded",
            "entitlement_status": "revoked",
        }
        commerce, database, _ = service(database)

        result = commerce.refund(
            case_id=CASE_ID,
            order_id=ORDER_ID,
            payment_transaction_id=PAYMENT_ID,
            client_request_id=CLIENT_REQUEST_ID,
            reason_code="CUSTOMER_CANCELLATION",
            access_policy="revoke",
        )

        self.assertEqual(result.entitlement_status, "revoked")
        reserve = next(value for name, value in database.calls if name == "reserve_total_loss_refund")
        self.assertEqual(reserve[-1], "revoke")

    def test_existing_refund_replay_returns_local_state_without_provider_call(self) -> None:
        database = RecordingDatabase()
        database.refund_reserve_row = {
            **database.refund_reserve_row,
            "state": "existing",
            "refund_status": "pending",
            "external_refund_id": REFUND_ID,
            "provider_status": "pending",
        }
        commerce, _, provider = service(database)

        result = commerce.refund(
            case_id=CASE_ID,
            order_id=ORDER_ID,
            payment_transaction_id=PAYMENT_ID,
            client_request_id=CLIENT_REQUEST_ID,
            reason_code="FAIR_RESULT",
            access_policy="retain",
        )

        self.assertEqual(result.state, "existing")
        self.assertEqual(result.refund_status, "pending")
        self.assertFalse(any(name == "retrieve_refund" for name, _ in provider.calls))
        self.assertFalse(any(name == "create_refund" for name, _ in provider.calls))

    def test_existing_creating_refund_resumes_same_provider_idempotency_key(self) -> None:
        database = RecordingDatabase()
        database.refund_reserve_row = {
            **database.refund_reserve_row,
            "state": "existing",
        }
        commerce, _, provider = service(database)

        result = commerce.refund(
            case_id=CASE_ID,
            order_id=ORDER_ID,
            payment_transaction_id=PAYMENT_ID,
            client_request_id=CLIENT_REQUEST_ID,
            reason_code="NO_MATERIAL_DISPUTE_SUPPORTED",
            access_policy="retain",
        )

        self.assertEqual(result.refund_status, "succeeded")
        creates = [
            value for name, value in provider.calls if name == "create_refund"
        ]
        self.assertEqual(len(creates), 1)
        self.assertEqual(
            creates[0]["idempotency_key"],
            f"venfour:refund:v1:{REFUND_REQUEST_ID}",
        )

    def test_succeeded_refund_replay_after_dispute_uses_only_local_state(
        self,
    ) -> None:
        database = RecordingDatabase()
        database.refund_reserve_row = {
            **database.refund_reserve_row,
            "state": "already_succeeded",
            "refund_status": "succeeded",
            "provider_status": "succeeded",
            "external_refund_id": REFUND_ID,
            "refund_transaction_id": REFUND_TRANSACTION_ID,
            "order_status": "refunded",
            "entitlement_status": "suspended",
        }
        commerce, _, provider = service(database)

        result = commerce.refund(
            case_id=CASE_ID,
            order_id=ORDER_ID,
            payment_transaction_id=PAYMENT_ID,
            client_request_id=CLIENT_REQUEST_ID,
            reason_code="FAIR_RESULT",
            access_policy="retain",
        )

        self.assertEqual(result.state, "already_succeeded")
        self.assertEqual(result.order_status, "refunded")
        self.assertEqual(result.entitlement_status, "suspended")
        self.assertFalse(provider.calls)

    def test_succeeded_refund_replay_preserves_clean_duplicate_coverage(
        self,
    ) -> None:
        database = RecordingDatabase()
        database.refund_reserve_row = {
            **database.refund_reserve_row,
            "state": "already_succeeded",
            "refund_status": "succeeded",
            "provider_status": "succeeded",
            "external_refund_id": REFUND_ID,
            "refund_transaction_id": REFUND_TRANSACTION_ID,
            "order_status": "paid",
            "entitlement_status": "active",
        }
        commerce, database, provider = service(database)

        result = commerce.refund(
            case_id=CASE_ID,
            order_id=ORDER_ID,
            payment_transaction_id=PAYMENT_ID,
            client_request_id=CLIENT_REQUEST_ID,
            reason_code="FAIR_RESULT",
            access_policy="retain",
        )

        self.assertEqual(result.state, "already_succeeded")
        self.assertEqual(result.refund_status, "succeeded")
        self.assertEqual(result.order_status, "paid")
        self.assertEqual(result.entitlement_status, "active")
        self.assertFalse(provider.calls)
        self.assertEqual(
            [name for name, _ in database.calls],
            ["reserve_total_loss_refund"],
        )

    def test_pre_record_crash_retry_reuses_refund_provider_idempotency_key(self) -> None:
        commerce, _, provider = service()

        for _ in range(2):
            result = commerce.refund(
                case_id=CASE_ID,
                order_id=ORDER_ID,
                payment_transaction_id=PAYMENT_ID,
                client_request_id=CLIENT_REQUEST_ID,
                reason_code="FAIR_RESULT",
                access_policy="retain",
            )
            self.assertEqual(result.refund_status, "succeeded")

        creates = [
            value for name, value in provider.calls if name == "create_refund"
        ]
        self.assertEqual(len(creates), 2)
        self.assertEqual(
            {value["idempotency_key"] for value in creates},
            {f"venfour:refund:v1:{REFUND_REQUEST_ID}"},
        )

    def test_canceled_refund_records_a_bounded_terminal_failure_code(self) -> None:
        provider = RecordingProvider()
        provider.refund = stripe_refund(
            status="canceled", balance_transaction_id=None
        )
        database = RecordingDatabase()
        database.refund_reserve_row = {
            **database.refund_reserve_row,
            "access_policy": "revoke",
        }
        database.refund_result = {
            **database.refund_result,
            "outcome": "canceled",
            "refund_status": "canceled",
            "provider_status": "canceled",
            "refund_transaction_id": None,
            "refund_reversal_transaction_id": None,
            "order_status": "paid",
            "entitlement_status": "active",
        }
        commerce, database, _ = service(database, provider)

        commerce.refund(
            case_id=CASE_ID,
            order_id=ORDER_ID,
            payment_transaction_id=PAYMENT_ID,
            client_request_id=CLIENT_REQUEST_ID,
            reason_code="CUSTOMER_CANCELLATION",
            access_policy="revoke",
        )

        record = next(
            value
            for name, value in database.calls
            if name == "record_total_loss_refund_result"
        )
        self.assertEqual(record[3], "PROVIDER_REFUND_CANCELED")


class StubStripeResource:
    def __init__(self, value: Mapping[str, Any]) -> None:
        self.value = value
        self.calls: list[tuple[Any, ...]] = []

    def create(self, *args: Any) -> Mapping[str, Any]:
        self.calls.append(args)
        return self.value

    def retrieve(self, *args: Any) -> Mapping[str, Any]:
        self.calls.append(args)
        return self.value


class FakeStripeClient:
    def __init__(self) -> None:
        product = {"id": PRODUCT_ID, "active": True}
        self.prices = StubStripeResource(
            {
                "id": PRICE_ID,
                "unit_amount": AMOUNT,
                "currency": "usd",
                "livemode": False,
                "active": True,
                "type": "one_time",
                "product": product,
            }
        )
        session = {
            "id": SESSION_ID,
            "url": "https://checkout.stripe.com/c/pay/test-session",
            "status": "open",
            "payment_status": "unpaid",
            "mode": "payment",
            "expires_at": NOW,
            "livemode": False,
            "client_reference_id": ORDER_ID,
            "customer": None,
            "customer_email": EMAIL,
            "payment_intent": INTENT_ID,
            "amount_total": AMOUNT,
            "currency": "usd",
            "metadata": {
                "venfour_order_id": ORDER_ID,
                "venfour_checkout_attempt_id": ATTEMPT_ID,
            },
        }
        self.checkout = type("Checkout", (), {"sessions": StubStripeResource(session)})()
        self.payment_intents = StubStripeResource({})
        self.refunds = StubStripeResource({})
        self.charges = StubStripeResource({})
        self.disputes = StubStripeResource({})
        self.v1 = type(
            "V1",
            (),
            {
                "prices": self.prices,
                "checkout": self.checkout,
                "payment_intents": self.payment_intents,
                "refunds": self.refunds,
                "charges": self.charges,
                "disputes": self.disputes,
            },
        )()


class StripeSdkGatewayTests(unittest.TestCase):
    def test_checkout_uses_card_only_minimal_metadata_and_stable_sdk_option(self) -> None:
        client = FakeStripeClient()
        gateway = StripeSdkGateway(configuration(), client=client)

        result = gateway.create_checkout_session(
            case_id=CASE_ID,
            order_id=ORDER_ID,
            checkout_attempt_id=ATTEMPT_ID,
            price_id=PRICE_ID,
            customer_email=EMAIL,
            success_url="https://app.venfour.example/success",
            cancel_url="https://app.venfour.example/cancel",
            idempotency_key=f"venfour:checkout:v1:{ATTEMPT_ID}",
        )

        self.assertEqual(result.id, SESSION_ID)
        params, options = client.checkout.sessions.calls[0]
        self.assertEqual(params["mode"], "payment")
        self.assertEqual(params["payment_method_types"], ["card"])
        self.assertEqual(params["adaptive_pricing"], {"enabled": False})
        self.assertEqual(params["line_items"], [{"price": PRICE_ID, "quantity": 1}])
        self.assertEqual(
            set(params["metadata"]),
            {"venfour_order_id", "venfour_checkout_attempt_id"},
        )
        self.assertNotIn("case", json.dumps(params).lower())
        self.assertEqual(options, {"idempotency_key": f"venfour:checkout:v1:{ATTEMPT_ID}"})

    def test_price_retrieval_requires_expanded_active_one_time_contract(self) -> None:
        client = FakeStripeClient()
        gateway = StripeSdkGateway(configuration(), client=client)

        price = gateway.retrieve_price(PRICE_ID)

        self.assertEqual(price, stripe_price())
        self.assertEqual(client.prices.calls, [(PRICE_ID, {"expand": ["product"]})])

    def test_payment_refund_charge_and_dispute_retrieval_is_strictly_projected(self) -> None:
        client = FakeStripeClient()
        client.payment_intents.value = {
            "id": INTENT_ID,
            "status": "succeeded",
            "amount": AMOUNT,
            "amount_received": AMOUNT,
            "currency": "usd",
            "livemode": False,
            "customer": CUSTOMER_ID,
            "latest_charge": {"id": CHARGE_ID},
            "metadata": {
                "venfour_order_id": ORDER_ID,
                "venfour_checkout_attempt_id": ATTEMPT_ID,
            },
            "created": NOW - 60,
        }
        client.refunds.value = {
            "id": REFUND_ID,
            "status": "succeeded",
            "amount": AMOUNT,
            "currency": "usd",
            "payment_intent": INTENT_ID,
            "charge": CHARGE_ID,
            "balance_transaction": REFUND_BALANCE_TRANSACTION_ID,
            "failure_balance_transaction": None,
            "metadata": {
                "venfour_order_id": ORDER_ID,
                "venfour_refund_request_id": REFUND_REQUEST_ID,
            },
            "created": NOW,
        }
        client.charges.value = {
            "id": CHARGE_ID,
            "payment_intent": INTENT_ID,
            "currency": "usd",
            "livemode": False,
        }
        client.disputes.value = {
            "id": DISPUTE_ID,
            "status": "needs_response",
            "amount": AMOUNT,
            "currency": "usd",
            "livemode": False,
            "charge": CHARGE_ID,
            "created": NOW,
        }
        gateway = StripeSdkGateway(configuration(), client=client)

        self.assertEqual(gateway.retrieve_payment_intent(INTENT_ID), payment_intent())
        self.assertEqual(gateway.retrieve_refund(REFUND_ID), stripe_refund())
        self.assertEqual(
            gateway.retrieve_charge(CHARGE_ID),
            StripeCharge(CHARGE_ID, INTENT_ID, CURRENCY, False),
        )
        self.assertEqual(
            gateway.retrieve_dispute(DISPUTE_ID),
            StripeDispute(
                DISPUTE_ID,
                "needs_response",
                AMOUNT,
                CURRENCY,
                False,
                CHARGE_ID,
                NOW,
            ),
        )

    def test_refund_create_uses_configured_mode_when_object_omits_it(self) -> None:
        client = FakeStripeClient()
        client.refunds.value = {
            "id": REFUND_ID,
            "status": "succeeded",
            "amount": AMOUNT,
            "currency": "usd",
            "payment_intent": INTENT_ID,
            "charge": CHARGE_ID,
            "balance_transaction": REFUND_BALANCE_TRANSACTION_ID,
            "failure_balance_transaction": None,
            "metadata": {
                "venfour_order_id": ORDER_ID,
                "venfour_refund_request_id": REFUND_REQUEST_ID,
            },
            "created": NOW,
        }
        gateway = StripeSdkGateway(configuration(), client=client)

        refund = gateway.create_refund(
            payment_intent_id=INTENT_ID,
            amount_minor_units=AMOUNT,
            order_id=ORDER_ID,
            refund_request_id=REFUND_REQUEST_ID,
            idempotency_key="venfour:refund:v1:test",
        )

        self.assertEqual(refund, stripe_refund())
        self.assertFalse(refund.livemode)

    def test_refund_rejects_object_mode_that_conflicts_with_configuration(
        self,
    ) -> None:
        client = FakeStripeClient()
        client.refunds.value = {
            "id": REFUND_ID,
            "status": "succeeded",
            "amount": AMOUNT,
            "currency": "usd",
            "livemode": True,
            "payment_intent": INTENT_ID,
            "charge": CHARGE_ID,
            "balance_transaction": REFUND_BALANCE_TRANSACTION_ID,
            "failure_balance_transaction": None,
            "metadata": {
                "venfour_order_id": ORDER_ID,
                "venfour_refund_request_id": REFUND_REQUEST_ID,
            },
            "created": NOW,
        }
        gateway = StripeSdkGateway(configuration(), client=client)

        with self.assertRaises(CommerceProviderContractError):
            gateway.retrieve_refund(REFUND_ID)

    def test_dispute_retrieval_accepts_only_current_and_legacy_prefixes(self) -> None:
        client = FakeStripeClient()
        gateway = StripeSdkGateway(configuration(), client=client)

        for dispute_id in (CURRENT_DISPUTE_ID, DISPUTE_ID):
            with self.subTest(dispute_id=dispute_id):
                client.disputes.value = {
                    "id": dispute_id,
                    "status": "needs_response",
                    "amount": AMOUNT,
                    "currency": "usd",
                    "livemode": False,
                    "charge": CHARGE_ID,
                    "created": NOW,
                }
                self.assertEqual(
                    gateway.retrieve_dispute(dispute_id).id,
                    dispute_id,
                )

        for invalid_id in ("di_test_dispute_12345", "test_dispute_12345"):
            with self.subTest(invalid_id=invalid_id), self.assertRaises(
                CommerceProviderContractError
            ):
                gateway.retrieve_dispute(invalid_id)

    def test_refund_retrieval_accepts_requires_action_as_nonterminal(self) -> None:
        client = FakeStripeClient()
        client.refunds.value = {
            "id": REFUND_ID,
            "status": "requires_action",
            "amount": AMOUNT,
            "currency": "usd",
            "livemode": False,
            "payment_intent": INTENT_ID,
            "charge": CHARGE_ID,
            "metadata": {
                "venfour_order_id": ORDER_ID,
                "venfour_refund_request_id": REFUND_REQUEST_ID,
            },
            "created": NOW,
        }
        gateway = StripeSdkGateway(configuration(), client=client)

        refund = gateway.retrieve_refund(REFUND_ID)

        self.assertEqual(refund.status, "requires_action")

    def test_refund_retrieval_projects_authoritative_failure_reversal(self) -> None:
        client = FakeStripeClient()
        client.refunds.value = {
            "id": REFUND_ID,
            "status": "failed",
            "amount": AMOUNT,
            "currency": "usd",
            "livemode": False,
            "payment_intent": INTENT_ID,
            "charge": CHARGE_ID,
            "balance_transaction": REFUND_BALANCE_TRANSACTION_ID,
            "failure_balance_transaction": REFUND_FAILURE_TRANSACTION_ID,
            "metadata": {
                "venfour_order_id": ORDER_ID,
                "venfour_refund_request_id": REFUND_REQUEST_ID,
            },
            "created": NOW,
        }
        gateway = StripeSdkGateway(configuration(), client=client)

        self.assertEqual(
            gateway.retrieve_refund(REFUND_ID),
            stripe_refund(
                status="failed",
                failure_balance_transaction_id=REFUND_FAILURE_TRANSACTION_ID,
            ),
        )

        client.refunds.value = {
            **client.refunds.value,
            "status": "succeeded",
        }
        with self.assertRaises(CommerceProviderContractError):
            gateway.retrieve_refund(REFUND_ID)

    def test_sdk_allows_unrelated_objects_without_venfour_contract_fields(
        self,
    ) -> None:
        client = FakeStripeClient()
        client.checkout.sessions.value = {
            "id": SESSION_ID,
            "url": None,
            "status": "complete",
            "payment_status": "paid",
            "mode": "subscription",
            "expires_at": NOW,
            "livemode": False,
            "metadata": {},
        }
        client.refunds.value = {
            "id": REFUND_ID,
            "status": "succeeded",
            "amount": AMOUNT,
            "currency": "usd",
            "livemode": False,
            "payment_intent": INTENT_ID,
            "metadata": {},
            "created": NOW,
        }
        gateway = StripeSdkGateway(configuration(), client=client)

        session = gateway.retrieve_checkout_session(SESSION_ID)
        refund = gateway.retrieve_refund(REFUND_ID)

        self.assertEqual(session.metadata, {})
        self.assertIsNone(session.client_reference_id)
        self.assertIsNone(session.line_item_price_id)
        self.assertEqual(refund.metadata, {})
        self.assertEqual(refund.payment_intent_id, INTENT_ID)

    def test_official_webhook_verifier_accepts_exact_raw_bytes_and_rejects_tampering(self) -> None:
        gateway = StripeSdkGateway(configuration(), client=FakeStripeClient())
        timestamp = int(time.time())
        payload = json.dumps(
            {
                "id": EVENT_ID,
                "type": "checkout.session.completed",
                "created": NOW,
                "livemode": False,
                "api_version": "2025-12-15.clover",
                "data": {"object": {"id": SESSION_ID}},
            },
            separators=(",", ":"),
        ).encode()
        signed = f"{timestamp}.".encode() + payload
        digest = hmac.new(WEBHOOK_SECRET.encode(), signed, hashlib.sha256).hexdigest()
        header = f"t={timestamp},v1={digest}"

        self.assertEqual(gateway.verify_webhook(payload, header).id, EVENT_ID)
        with self.assertRaises(CommerceWebhookSignatureError):
            gateway.verify_webhook(payload + b" ", header)

    def test_official_webhook_verifier_projects_signed_lifecycle_snapshots(
        self,
    ) -> None:
        gateway = StripeSdkGateway(configuration(), client=FakeStripeClient())
        refund_object = {
            "id": REFUND_ID,
            "status": "succeeded",
            "amount": AMOUNT,
            "currency": "usd",
            "payment_intent": INTENT_ID,
            "charge": CHARGE_ID,
            "balance_transaction": REFUND_BALANCE_TRANSACTION_ID,
            "failure_balance_transaction": None,
            "metadata": {
                "venfour_order_id": ORDER_ID,
                "venfour_refund_request_id": REFUND_REQUEST_ID,
            },
            "created": NOW - 120,
        }
        refund_payload, refund_header = signed_stripe_event(
            "refund.created",
            refund_object,
            event_id="evt_test_signed_refund_12345",
            event_created=NOW - 60,
        )

        refund_event = gateway.verify_webhook(
            refund_payload, refund_header
        )

        self.assertEqual(
            refund_event.refund_snapshot,
            stripe_refund(created=NOW - 120),
        )
        self.assertIsNone(refund_event.dispute_snapshot)

        dispute_object = {
            "id": CURRENT_DISPUTE_ID,
            "status": "prevented",
            "amount": AMOUNT + 500,
            "currency": "usd",
            "livemode": False,
            "charge": CHARGE_ID,
            "created": NOW - 120,
        }
        dispute_payload, dispute_header = signed_stripe_event(
            "charge.dispute.closed",
            dispute_object,
            event_id="evt_test_signed_dispute_12345",
            event_created=NOW,
        )

        dispute_event = gateway.verify_webhook(
            dispute_payload, dispute_header
        )

        self.assertEqual(
            dispute_event.dispute_snapshot,
            StripeDispute(
                CURRENT_DISPUTE_ID,
                "prevented",
                AMOUNT + 500,
                CURRENCY,
                False,
                CHARGE_ID,
                NOW - 120,
            ),
        )
        self.assertIsNone(dispute_event.refund_snapshot)

    def test_official_webhook_verifier_rejects_refund_mode_conflict(
        self,
    ) -> None:
        gateway = StripeSdkGateway(configuration(), client=FakeStripeClient())
        payload, header = signed_stripe_event(
            "refund.created",
            {
                "id": REFUND_ID,
                "status": "succeeded",
                "amount": AMOUNT,
                "currency": "usd",
                "livemode": True,
                "payment_intent": INTENT_ID,
                "charge": CHARGE_ID,
                "balance_transaction": REFUND_BALANCE_TRANSACTION_ID,
                "failure_balance_transaction": None,
                "metadata": {
                    "venfour_order_id": ORDER_ID,
                    "venfour_refund_request_id": REFUND_REQUEST_ID,
                },
                "created": NOW,
            },
            event_livemode=False,
        )

        with self.assertRaises(CommerceProviderContractError):
            gateway.verify_webhook(payload, header)

    def test_official_webhook_verifier_rejects_malformed_signed_snapshots(
        self,
    ) -> None:
        gateway = StripeSdkGateway(configuration(), client=FakeStripeClient())
        refund_object = {
            "id": REFUND_ID,
            "status": "succeeded",
            "amount": AMOUNT,
            "currency": "usd",
            "livemode": False,
            "payment_intent": INTENT_ID,
            "charge": CHARGE_ID,
            "balance_transaction": REFUND_BALANCE_TRANSACTION_ID,
            "failure_balance_transaction": None,
            "metadata": {
                "venfour_order_id": ORDER_ID,
                "venfour_refund_request_id": REFUND_REQUEST_ID,
            },
            "created": NOW,
        }
        failed_payload, failed_header = signed_stripe_event(
            "refund.failed", refund_object
        )
        dispute_payload, dispute_header = signed_stripe_event(
            "charge.dispute.created",
            {
                "id": DISPUTE_ID,
                "status": "needs_response",
                "amount": AMOUNT,
                "currency": "usd",
                "livemode": True,
                "charge": CHARGE_ID,
                "created": NOW,
            },
        )

        for payload, header in (
            (failed_payload, failed_header),
            (dispute_payload, dispute_header),
        ):
            with self.subTest(payload=payload), self.assertRaises(
                CommerceProviderContractError
            ):
                gateway.verify_webhook(payload, header)


class SupabaseCommerceGatewayTests(unittest.TestCase):
    def test_refund_reversal_rpc_sends_both_provider_balance_identities(
        self,
    ) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json=[{"outcome": "failed"}])

        client = httpx.Client(
            transport=httpx.MockTransport(handler), follow_redirects=False
        )
        self.addCleanup(client.close)
        gateway = SupabaseHttpGateway(
            SupabaseServerConfiguration(
                url="https://project.supabase.co",
                publishable_key="publishable-test-key",
                service_role_key="service-role-test-key",
            ),
            client=client,
        )

        gateway.record_total_loss_refund_result(
            REFUND_REQUEST_ID,
            stripe_refund(
                status="failed",
                failure_balance_transaction_id=(
                    REFUND_FAILURE_TRANSACTION_ID
                ),
            ),
            EVENT_ID,
            "PROVIDER_REFUND_FAILED",
            NOW,
        )

        self.assertEqual(len(requests), 1)
        self.assertEqual(
            requests[0].url.path.rsplit("/", 1)[-1],
            "record_total_loss_refund_result",
        )
        self.assertEqual(
            json.loads(requests[0].content),
            {
                "requested_refund_request_id": REFUND_REQUEST_ID,
                "requested_external_refund_id": REFUND_ID,
                "requested_external_event_id": EVENT_ID,
                "requested_external_balance_transaction_id": (
                    REFUND_BALANCE_TRANSACTION_ID
                ),
                "requested_external_failure_balance_transaction_id": (
                    REFUND_FAILURE_TRANSACTION_ID
                ),
                "requested_provider_status": "failed",
                "requested_provider_occurred_at": (
                    "2027-01-15T08:00:00+00:00"
                ),
                "requested_failure_code": "PROVIDER_REFUND_FAILED",
            },
        )

    def test_service_role_commerce_rpcs_use_exact_names_and_arguments(self) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json=[{"status": "ok"}])

        client = httpx.Client(
            transport=httpx.MockTransport(handler), follow_redirects=False
        )
        self.addCleanup(client.close)
        gateway = SupabaseHttpGateway(
            SupabaseServerConfiguration(
                url="https://project.supabase.co",
                publishable_key="publishable-test-key",
                service_role_key="service-role-test-key",
            ),
            client=client,
        )
        config = configuration()
        price = stripe_price()
        session = checkout_session(payment_intent_id=INTENT_ID)
        expired_session = checkout_session(
            status="expired",
            payment_status="unpaid",
            url=None,
            payment_intent_id=None,
        )
        event = stripe_event()
        checkout_context = CheckoutContext.from_row(
            context_row(
                external_checkout_session_id=SESSION_ID,
                external_payment_intent_id=INTENT_ID,
            )
        )
        payment_context = PaymentContext.from_row(payment_context_row())

        gateway.authorize_total_loss_checkout_preflight(CASE_ID, USER_ID)
        gateway.reserve_total_loss_checkout(
            CASE_ID, USER_ID, CLIENT_REQUEST_ID, config, price
        )
        gateway.attach_total_loss_checkout_session(ATTEMPT_ID, session)
        gateway.recover_total_loss_checkout_attempt(
            checkout_context, expired_session
        )
        gateway.authorize_total_loss_checkout_reconciliation(
            CASE_ID, USER_ID, SESSION_ID
        )
        gateway.resolve_total_loss_checkout_context(ORDER_ID, ATTEMPT_ID)
        gateway.resolve_total_loss_checkout_context_by_session_id(SESSION_ID)
        gateway.resolve_total_loss_payment_context(INTENT_ID)
        gateway.reconcile_total_loss_checkout_attempt(CASE_ID, USER_ID, session)
        gateway.fail_total_loss_checkout_attempt_from_webhook(
            ORDER_ID,
            ATTEMPT_ID,
            SESSION_ID,
            EVENT_ID,
            PROCESSING_TOKEN,
            "ASYNC_PAYMENT_FAILED",
        )
        gateway.expire_total_loss_checkout_attempt_from_webhook(
            ORDER_ID,
            ATTEMPT_ID,
            SESSION_ID,
            EVENT_ID,
            PROCESSING_TOKEN,
            NOW,
        )
        gateway.claim_stripe_webhook_event(
            event, "a" * 64, 128, PROCESSING_TOKEN
        )
        gateway.fulfill_total_loss_checkout_payment(
            checkout_context,
            session,
            payment_intent(),
            EVENT_ID,
            PROCESSING_TOKEN,
            NOW,
        )
        gateway.finalize_stripe_webhook_event(
            WEBHOOK_ROW_ID,
            PROCESSING_TOKEN,
            "processed",
            CASE_ID,
            ORDER_ID,
            None,
        )
        gateway.reserve_total_loss_refund(
            CASE_ID,
            ORDER_ID,
            PAYMENT_ID,
            CLIENT_REQUEST_ID,
            "FAIR_RESULT",
            "retain",
        )
        gateway.record_total_loss_refund_result(
            REFUND_REQUEST_ID,
            stripe_refund(
                status="requires_action", balance_transaction_id=None
            ),
            EVENT_ID,
            None,
            NOW,
        )
        gateway.record_total_loss_dispute(
            payment_context,
            StripeDispute(
                CURRENT_DISPUTE_ID,
                "needs_response",
                AMOUNT,
                CURRENCY,
                False,
                CHARGE_ID,
                NOW,
            ),
            EVENT_ID,
            "charge.dispute.created",
            "active",
            NOW,
        )

        names = [request.url.path.rsplit("/", 1)[-1] for request in requests]
        self.assertEqual(
            names,
            [
                "authorize_total_loss_checkout_preflight",
                "reserve_total_loss_checkout",
                "attach_total_loss_checkout_session",
                "recover_total_loss_checkout_attempt",
                "authorize_total_loss_checkout_reconciliation",
                "resolve_total_loss_checkout_context",
                "resolve_total_loss_checkout_context_by_session_id",
                "resolve_total_loss_payment_context",
                "reconcile_total_loss_checkout_attempt",
                "fail_total_loss_checkout_attempt_from_webhook",
                "expire_total_loss_checkout_attempt_from_webhook",
                "claim_stripe_webhook_event",
                "fulfill_total_loss_checkout_payment",
                "finalize_stripe_webhook_event",
                "reserve_total_loss_refund",
                "record_total_loss_refund_result",
                "record_total_loss_dispute",
            ],
        )
        for request in requests:
            self.assertEqual(
                request.headers["authorization"], "Bearer service-role-test-key"
            )
            self.assertEqual(request.headers["apikey"], "service-role-test-key")
        reserve = json.loads(requests[1].content)
        self.assertEqual(
            reserve,
            {
                "requested_case_id": CASE_ID,
                "requested_purchaser_user_id": USER_ID,
                "requested_client_request_id": CLIENT_REQUEST_ID,
                "configured_product_identifier": "total_loss_claim_package",
                "configured_product_version": "v1",
                "configured_external_price_identifier": PRICE_ID,
                "configured_amount_minor_units": AMOUNT,
                "configured_currency": CURRENCY,
                "configured_terms_version": "2026-08-26",
                "configured_refund_policy_version": "2026-08-26",
                "configured_provider_livemode": False,
            },
        )
        expiration = json.loads(
            requests[
                names.index("expire_total_loss_checkout_attempt_from_webhook")
            ].content
        )
        self.assertEqual(
            expiration,
            {
                "requested_order_id": ORDER_ID,
                "requested_checkout_attempt_id": ATTEMPT_ID,
                "requested_external_checkout_session_id": SESSION_ID,
                "requested_external_event_id": EVENT_ID,
                "requested_webhook_processing_token": PROCESSING_TOKEN,
                "requested_expires_at": "2027-01-15T08:00:00+00:00",
            },
        )
        recovery = json.loads(
            requests[
                names.index("recover_total_loss_checkout_attempt")
            ].content
        )
        self.assertEqual(
            recovery,
            {
                "requested_case_id": CASE_ID,
                "requested_order_id": ORDER_ID,
                "requested_checkout_attempt_id": ATTEMPT_ID,
                "requested_purchaser_user_id": USER_ID,
                "requested_external_checkout_session_id": SESSION_ID,
                "requested_external_payment_intent_id": None,
                "requested_external_customer_id": CUSTOMER_ID,
                "requested_session_status": "expired",
                "requested_payment_status": "unpaid",
                "requested_expires_at": "2027-01-15T08:00:00+00:00",
                "requested_provider_livemode": False,
                "requested_external_price_identifier": PRICE_ID,
                "requested_quantity": 1,
                "requested_amount_minor_units": AMOUNT,
                "requested_currency": CURRENCY,
            },
        )
        fulfillment = json.loads(
            requests[names.index("fulfill_total_loss_checkout_payment")].content
        )
        self.assertEqual(
            fulfillment["requested_webhook_processing_token"], PROCESSING_TOKEN
        )
        self.assertEqual(fulfillment["requested_external_event_id"], EVENT_ID)
        self.assertEqual(
            fulfillment["requested_provider_occurred_at"],
            "2027-01-15T08:00:00+00:00",
        )
        refund_result = json.loads(
            requests[names.index("record_total_loss_refund_result")].content
        )
        self.assertEqual(
            refund_result["requested_provider_status"], "requires_action"
        )
        self.assertIsNone(
            refund_result["requested_external_balance_transaction_id"]
        )
        self.assertIsNone(
            refund_result[
                "requested_external_failure_balance_transaction_id"
            ]
        )
        self.assertIsNone(refund_result["requested_failure_code"])
        dispute = json.loads(
            requests[names.index("record_total_loss_dispute")].content
        )
        self.assertEqual(dispute["requested_event_type"], "charge.dispute.created")
        self.assertEqual(dispute["requested_dispute_status"], "active")
        self.assertEqual(dispute["requested_external_dispute_id"], CURRENT_DISPUTE_ID)


class RecordingCommerceHttpService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.checkout = CheckoutProjection(
            "checkout_ready",
            "https://checkout.stripe.com/c/pay/test-session",
            "pending",
            "open",
            None,
        )
        self.reconciliation = CheckoutProjection(
            "reconciled", None, "pending", "complete", None
        )
        self.webhook_error: Exception | None = None

    def authenticate(self, token: str) -> str:
        return USER_ID

    def create_checkout(self, *args: Any) -> CheckoutProjection:
        self.calls.append(("create_checkout", args))
        return self.checkout

    def reconcile_checkout(self, *args: Any) -> CheckoutProjection:
        self.calls.append(("reconcile_checkout", args))
        return self.reconciliation

    def handle_webhook(self, payload: bytes, signature: str) -> str:
        self.calls.append(("handle_webhook", (payload, signature)))
        if self.webhook_error is not None:
            raise self.webhook_error
        return "processed"

    def refund(self, **_kwargs: Any) -> RefundProjection:
        raise AssertionError("refund is internal-only")


class CommerceApiTests(unittest.TestCase):
    def app(self, commerce: RecordingCommerceHttpService, **kwargs: Any) -> Any:
        return create_app(
            commerce_service=commerce,
            enable_legacy_api=False,
            **kwargs,
        )

    def test_checkout_endpoint_requires_auth_and_exact_bounded_json(self) -> None:
        commerce = RecordingCommerceHttpService()
        path = f"/api/v1/appraisal-cases/{CASE_ID}/checkout-sessions"
        with TestClient(self.app(commerce)) as client:
            unauthenticated = client.post(path, json={"clientRequestId": CLIENT_REQUEST_ID})
            malformed = client.post(
                path,
                headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
                json={"clientRequestId": CLIENT_REQUEST_ID, "amount": 1},
            )
            accepted = client.post(
                path,
                headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
                json={"clientRequestId": CLIENT_REQUEST_ID},
            )

        self.assertEqual(unauthenticated.status_code, 401)
        self.assertEqual(malformed.status_code, 400)
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.json(), commerce.checkout.to_dict())
        self.assertEqual(commerce.calls, [("create_checkout", (CASE_ID, ACCESS_TOKEN, CLIENT_REQUEST_ID))])
        self.assertEqual(accepted.headers["cache-control"], "private, no-store")

    def test_checkout_retry_recovers_complete_paid_pre_attach_without_fulfillment(
        self,
    ) -> None:
        database = RecordingDatabase()
        database.recovery_row = {
            **database.recovery_row,
            "outcome": "applied",
            "attempt_status": "complete",
        }
        provider = RecordingProvider()
        provider.session = checkout_session(
            status="complete",
            payment_status="paid",
            url=None,
            payment_intent_id=INTENT_ID,
        )
        commerce, database, provider = service(database, provider)
        path = f"/api/v1/appraisal-cases/{CASE_ID}/checkout-sessions"

        with TestClient(self.app(commerce)) as client:
            response = client.post(
                path,
                headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
                json={"clientRequestId": CLIENT_REQUEST_ID},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "state": "payment_pending",
                "checkoutUrl": None,
                "orderStatus": "pending",
                "checkoutStatus": "complete",
                "entitlementStatus": None,
            },
        )
        self.assertEqual(
            len(
                [
                    value
                    for name, value in provider.calls
                    if name == "create_checkout_session"
                ]
            ),
            1,
        )
        self.assertIn(("retrieve_payment_intent", INTENT_ID), provider.calls)
        self.assertFalse(
            any(
                name
                in {
                    "attach_total_loss_checkout_session",
                    "fulfill_total_loss_checkout_payment",
                }
                for name, _ in database.calls
            )
        )

    def test_reconciliation_endpoint_passes_only_owned_identifiers(self) -> None:
        commerce = RecordingCommerceHttpService()
        path = f"/api/v1/appraisal-cases/{CASE_ID}/checkout-reconciliation"
        with TestClient(self.app(commerce)) as client:
            response = client.post(
                path,
                headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
                json={"checkoutSessionId": SESSION_ID},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            commerce.calls,
            [("reconcile_checkout", (CASE_ID, ACCESS_TOKEN, SESSION_ID))],
        )

    def test_webhook_passes_exact_raw_body_and_signature(self) -> None:
        commerce = RecordingCommerceHttpService()
        payload = b'{"signed":"bytes exactly"}\n'
        with TestClient(self.app(commerce)) as client:
            response = client.post(
                "/webhooks/stripe",
                content=payload,
                headers={"Stripe-Signature": "t=123,v1=abc"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            commerce.calls,
            [("handle_webhook", (payload, "t=123,v1=abc"))],
        )

    def test_webhook_rejects_missing_signature_and_oversized_body(self) -> None:
        commerce = RecordingCommerceHttpService()
        with TestClient(self.app(commerce)) as client:
            missing = client.post("/webhooks/stripe", content=b"{}")
            oversized = client.post(
                "/webhooks/stripe",
                content=b"x" * (MAX_STRIPE_WEBHOOK_BODY_BYTES + 1),
                headers={"Stripe-Signature": "t=123,v1=abc"},
            )

        self.assertEqual(missing.status_code, 400)
        self.assertEqual(oversized.status_code, 413)
        self.assertEqual(commerce.calls, [])

    def test_in_progress_webhook_returns_retryable_non_2xx(self) -> None:
        commerce = RecordingCommerceHttpService()
        commerce.webhook_error = CommerceUnavailableError("in progress")
        with TestClient(self.app(commerce)) as client:
            response = client.post(
                "/webhooks/stripe",
                content=b"{}",
                headers={"Stripe-Signature": "t=123,v1=abc"},
            )

        self.assertEqual(response.status_code, 503)

    def test_staging_proxy_guard_covers_exact_webhook_path(self) -> None:
        commerce = RecordingCommerceHttpService()
        with TestClient(
            self.app(commerce, staging_proxy_secret=STAGING_PROXY_SECRET)
        ) as client:
            denied = client.post(
                "/webhooks/stripe",
                content=b"{}",
                headers={"Stripe-Signature": "t=123,v1=abc"},
            )
            allowed = client.post(
                "/webhooks/stripe",
                content=b"{}",
                headers={
                    "Stripe-Signature": "t=123,v1=abc",
                    "X-Venfour-Staging-Proxy": STAGING_PROXY_SECRET,
                },
            )

        self.assertEqual(denied.status_code, 403)
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(len(commerce.calls), 1)

    def test_missing_commerce_configuration_does_not_break_existing_readiness(self) -> None:
        class ExistingCaseService:
            def authenticate(self, _token: str) -> str: return USER_ID
            def submit(self, *_args: Any) -> None: pass
            def status(self, *_args: Any) -> None: pass
            def get_presentation(self, *_args: Any) -> None: pass

        with patch.dict(os.environ, {}, clear=True):
            app = create_app(
                case_analysis_service=ExistingCaseService(),
                enable_legacy_api=False,
            )
        with TestClient(app) as client:
            readiness = client.get("/ready")
            checkout = client.post(
                f"/api/v1/appraisal-cases/{CASE_ID}/checkout-sessions",
                headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
                json={"clientRequestId": CLIENT_REQUEST_ID},
            )

        self.assertEqual(readiness.status_code, 200)
        self.assertEqual(checkout.status_code, 503)


if __name__ == "__main__":
    unittest.main()
