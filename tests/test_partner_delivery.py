"""Retained agreement artifacts and fenced delivery recovery contracts."""

from __future__ import annotations

import base64
import copy
import hashlib
import json
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import httpx
import pymupdf

from venfour.partner_delivery import PartnerDeliveryConfiguration, PartnerDeliveryService
from venfour.analysis_runs import canonical_json_bytes
from venfour.partner_documents import (
    PartnerDocumentError, document_sha256, partner_document_path, render_partner_agreement,
)


PARTNER_ID = "b1000000-0000-4000-8000-000000000001"
AGREEMENT_ID = "b1000000-0000-4000-8000-000000000002"
JOB_ID = "b1000000-0000-4000-8000-000000000003"
INVITATION_ID = "b1000000-0000-4000-8000-000000000004"
NOW = datetime(2026, 9, 8, 12, tzinfo=timezone.utc)
PATH = partner_document_path(PARTNER_ID, AGREEMENT_ID)


def agreement_fixture(*, long: bool = False):
    body = "Reviewed fixture wording only. Prices < limits & written terms apply.\nA literal <b>tag</b> is plain text."
    if long:
        body = "\n\n".join(f"Paragraph {i + 1}. {body} " + ("Customer introductions and qualifying purchases are governed by these reviewed terms. " * 12)
                            for i in range(16))
    signature = {"user_id": "b1000000-0000-4000-8000-000000000005", "typed_legal_name": "Renée O’Connor",
                 "typed_title": "Owner", "verified_email": "partner@example.test", "signed_at": NOW.isoformat(),
                 "electronic_consent": True, "pdf_email_consent": True, "authority_confirmed": True}
    payload = {
        "agreement_id": AGREEMENT_ID, "partner_id": PARTNER_ID,
        "bucket": "partner-agreements", "object_path": PATH,
        "snapshot": {
            "template_id": "b1000000-0000-4000-8000-000000000006", "template_version": 1,
            "agreement_revision": 1, "title": "Referral Partner Agreement - Local Fixture",
            "sections": [{"heading": "Reviewed program terms", "body": body}],
            "business_name": "Ozark & River", "legal_business_name": "Ozark & River LLC",
            "address_line1": "100 Example Street", "address_line2": "Suite 4", "city": "Columbia",
            "state": "MO", "postal_code": "65201", "country": "US", "contact_name": "Renée O’Connor",
            "contact_title": "Owner", "contact_email": "partner@example.test",
            "commission_amount_minor_units": 12345, "currency": "USD",
            "signing_statement": "Review this entire agreement before choosing to sign.",
        },
        "partner_signature": signature,
        "manager_signature": {**signature, "user_id": "b1000000-0000-4000-8000-000000000007",
                              "typed_legal_name": "Jordan Review", "typed_title": "Manager",
                              "verified_email": "manager@example.test"},
    }
    payload["content_sha256"] = hashlib.sha256(canonical_json_bytes(payload["snapshot"])).hexdigest()
    return payload


def configuration(provider="resend", **overrides):
    return PartnerDeliveryConfiguration(
        provider=provider, public_app_origin="http://127.0.0.1:5173" if provider == "mailpit" else "https://venfour.example",
        sender="Venfour <partners@example.test>", reply_to="support@example.test", resend_api_key="secret-unit-test",
        **overrides,
    )


class MemoryDeliveryGateway:
    def __init__(self, document=None, email=None):
        self.document = document
        self.email = email
        self.objects = {}
        self.calls = []
        self.fail_storage = False
        self.lose_email_acknowledgement = False
        self.fail_document_acknowledgement = False
        self.leased = set()

    def worker(self, action, payload):
        self.calls.append((action, copy.deepcopy(payload)))
        kind = "email" if action.endswith("email") else "document"
        job = self.email if kind == "email" else self.document
        if action.startswith("lease_"):
            if job is None or job.get("status") in {"sent", "ready", "review"} or kind in self.leased:
                return None
            self.leased.add(kind)
            job["lease_token"] = payload["lease_token"]
            return copy.deepcopy(job)
        if action == "prepare_email":
            self.email.setdefault("prepared_provider", payload["provider"])
            self.email.setdefault("prepared_payload", copy.deepcopy(payload["payload"]))
            return copy.deepcopy(self.email)
        if action == "finish_email" and self.lose_email_acknowledgement:
            self.lose_email_acknowledgement = False
            raise RuntimeError("Lost acknowledgement")
        if action == "finish_document" and self.fail_document_acknowledgement:
            self.fail_document_acknowledgement = False
            raise RuntimeError("Lost acknowledgement")
        if action.startswith("finish_"):
            job["status"] = "sent" if kind == "email" else "ready"
        if action.startswith("fail_"):
            job["status"] = "review" if payload.get("requires_review") else "pending"
        return True

    def restart(self):
        self.leased.clear()

    def download_partner_document(self, path):
        return self.objects.get(path)

    def store_partner_document(self, path, content):
        if self.fail_storage:
            raise RuntimeError("Storage temporarily unavailable")
        if path in self.objects and self.objects[path] != content:
            raise ValueError("Create-only collision")
        self.objects[path] = content


def document_job():
    return {"id": JOB_ID, "kind": "agreement_pdf", "payload": agreement_fixture()}


def email_job(kind="invitation", **overrides):
    payload = {"kind": kind, "recipient_email": "partner@example.test", "business_name": "Ozark & River"}
    if kind == "invitation":
        payload["invitation_id"] = INVITATION_ID
    else:
        payload.update({"agreement_id": AGREEMENT_ID, "bucket": "partner-agreements", "object_path": PATH})
    return {"id": JOB_ID, "first_attempt_at": NOW.isoformat(), "payload": payload, **overrides}


class PartnerDocumentTests(unittest.TestCase):
    def test_render_is_repeatable_and_contains_exact_plain_text_and_signature_evidence(self):
        payload = agreement_fixture()
        before = copy.deepcopy(payload)
        first = render_partner_agreement(payload)
        self.assertEqual(first, render_partner_agreement(payload))
        self.assertEqual(payload, before)
        with pymupdf.open(stream=first, filetype="pdf") as document:
            text = "\n".join(page.get_text() for page in document)
        for expected in ("Renée O’Connor", "USD 123.45", "Prices < limits & written terms apply.",
                         "<b>tag</b>", "Jordan Review", "Agreement PDF by email: agreed", payload["content_sha256"]):
            self.assertIn(expected, text)
        altered = copy.deepcopy(payload)
        altered["manager_signature"]["typed_legal_name"] = "Different Manager"
        self.assertNotEqual(document_sha256(first), document_sha256(render_partner_agreement(altered)))

    def test_long_agreement_spans_pages_and_retains_last_clause_and_signatures(self):
        content = render_partner_agreement(agreement_fixture(long=True))
        with pymupdf.open(stream=content, filetype="pdf") as document:
            self.assertGreater(len(document), 3)
            text = "\n".join(page.get_text() for page in document)
            self.assertIn("Paragraph 16.", text)
            self.assertIn("Jordan Review", text)
            for page in document:
                for block in page.get_text("blocks"):
                    self.assertGreaterEqual(block[0], 45)
                    self.assertLessEqual(block[2], 568)

    def test_concurrent_rendering_uses_the_same_retained_bytes(self):
        payload = agreement_fixture()
        with ThreadPoolExecutor(max_workers=4) as pool:
            copies = list(pool.map(render_partner_agreement, [payload] * 8))
        self.assertEqual(len(set(copies)), 1)

    def test_invalid_signature_identity_terms_and_storage_paths_fail_closed(self):
        mutations = [
            lambda p: p.update(manager_signature=None),
            lambda p: p["partner_signature"].update(pdf_email_consent=False),
            lambda p: p["manager_signature"].update(authority_confirmed=False),
            lambda p: p["manager_signature"].update(signed_at="2026-09-08"),
            lambda p: p["partner_signature"].update(verified_email="other@example.test"),
            lambda p: p["snapshot"].update(commission_amount_minor_units=True),
            lambda p: p["snapshot"].update(currency="EUR"),
            lambda p: p.update(object_path="../../customer.pdf"),
            lambda p: p.update(bucket="case-deliverables"),
            lambda p: p.update(content_sha256="invalid"),
            lambda p: p["snapshot"].update(legal_business_name="Changed after signing"),
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                payload = agreement_fixture()
                mutation(payload)
                with self.assertRaises(PartnerDocumentError):
                    render_partner_agreement(payload)


class PartnerConfigurationTests(unittest.TestCase):
    def test_missing_invalid_and_remote_mailpit_settings_disable_only_partner_email(self):
        for config in (PartnerDeliveryConfiguration(), PartnerDeliveryConfiguration(provider="unknown"),
                       configuration("mailpit", mailpit_origin="https://external.example"),
                       PartnerDeliveryConfiguration(provider="resend", public_app_origin="https://venfour.example")):
            self.assertFalse(config.configured)
            self.assertIsNotNone(config.configuration_error)
        self.assertTrue(configuration().configured)
        self.assertTrue(configuration("mailpit").configured)
        self.assertNotIn("secret-unit-test", repr(configuration()))


class PartnerDeliveryTests(unittest.TestCase):
    def service(self, gateway, handler=None, config=None):
        client = httpx.Client(transport=httpx.MockTransport(handler or (lambda request: httpx.Response(200, json={"id": "provider-id"})) ))
        self.addCleanup(client.close)
        return PartnerDeliveryService(gateway, config or configuration(), http_client=client, now=lambda: NOW)

    def test_disabled_sender_still_renders_and_seals_document(self):
        gateway = MemoryDeliveryGateway(document=document_job(), email=email_job())
        result = self.service(gateway, config=PartnerDeliveryConfiguration()).dispatch()
        self.assertEqual(result["documents_ready"], 1)
        self.assertEqual(result["disabled"], 1)
        self.assertIn(PATH, gateway.objects)
        self.assertNotIn("lease_email", [action for action, _ in gateway.calls])
        final = next(payload for action, payload in gateway.calls if action == "finish_document")
        self.assertEqual(final["sha256"], document_sha256(gateway.objects[PATH]))

    def test_rendering_and_storage_failures_preserve_job_for_retry(self):
        for failure in ("render", "store"):
            with self.subTest(failure=failure):
                gateway = MemoryDeliveryGateway(document=document_job())
                gateway.fail_storage = failure == "store"
                service = self.service(gateway)
                if failure == "render":
                    with patch("venfour.partner_delivery.render_partner_agreement", side_effect=RuntimeError("private detail")):
                        self.assertEqual(service.dispatch()["deferred"], 1)
                else:
                    self.assertEqual(service.dispatch()["deferred"], 1)
                self.assertEqual(gateway.document["status"], "pending")
                gateway.fail_storage = False
                gateway.restart()
                self.assertEqual(service.dispatch()["documents_ready"], 1)

    def test_document_restart_reuses_exact_storage_bytes_and_rejects_replacement(self):
        gateway = MemoryDeliveryGateway(document=document_job())
        gateway.fail_document_acknowledgement = True
        service = self.service(gateway)
        self.assertEqual(service.dispatch()["deferred"], 1)
        retained = gateway.objects[PATH]
        gateway.restart()
        self.assertEqual(self.service(gateway).dispatch()["documents_ready"], 1)
        self.assertEqual(gateway.objects[PATH], retained)
        gateway.document["status"] = "pending"
        gateway.objects[PATH] = b"%PDF-tampered"
        gateway.restart()
        self.assertEqual(service.dispatch()["review_required"], 1)
        self.assertEqual(gateway.objects[PATH], b"%PDF-tampered")

    def test_resend_exact_payload_and_key_survive_lost_acknowledgement_and_restart(self):
        requests = []
        def handler(request):
            requests.append(request)
            return httpx.Response(200, json={"id": "same-provider-id"})
        gateway = MemoryDeliveryGateway(email=email_job())
        gateway.lose_email_acknowledgement = True
        self.assertEqual(self.service(gateway, handler).dispatch()["deferred"], 1)
        gateway.restart()
        changed_config = PartnerDeliveryConfiguration(provider="resend", public_app_origin="https://changed.example",
                                                      sender="changed@example.test", reply_to="changed@example.test", resend_api_key="new-secret")
        self.assertEqual(self.service(gateway, handler, changed_config).dispatch()["sent"], 1)
        self.assertEqual(requests[0].content, requests[1].content)
        self.assertEqual(requests[0].headers["Idempotency-Key"], requests[1].headers["Idempotency-Key"])
        self.assertIn(INVITATION_ID, requests[0].content.decode())
        self.assertNotIn("manager@example.test", requests[0].content.decode())

    def test_retry_window_and_payload_conflict_stop_for_review(self):
        gateway = MemoryDeliveryGateway(email=email_job(first_attempt_at=(NOW - timedelta(hours=23)).isoformat()))
        calls = []
        self.assertEqual(self.service(gateway, lambda r: calls.append(r)).dispatch()["review_required"], 1)
        self.assertEqual(calls, [])
        self.assertEqual(gateway.email["status"], "review")
        gateway = MemoryDeliveryGateway(email=email_job())
        handler = lambda r: httpx.Response(409, json={"name": "invalid_idempotent_request"})
        self.assertEqual(self.service(gateway, handler).dispatch()["review_required"], 1)

    def test_transient_provider_and_timeout_failures_are_retryable_without_sensitive_logs(self):
        for failure in ("timeout", "server", "concurrent"):
            def handler(request):
                if failure == "timeout":
                    raise httpx.ReadTimeout("private partner@example.test", request=request)
                return httpx.Response(503 if failure == "server" else 409, json={"name": "concurrent_idempotent_requests"})
            gateway = MemoryDeliveryGateway(email=email_job())
            with self.assertLogs("venfour.partner_delivery", level="WARNING") as log:
                self.assertEqual(self.service(gateway, handler).dispatch()["deferred"], 1)
            self.assertEqual(gateway.email["status"], "pending")
            self.assertNotIn("partner@example.test", " ".join(log.output))

    def test_attachment_matches_retained_download_and_manual_resend_changes_only_delivery_identity(self):
        content = render_partner_agreement(agreement_fixture())
        requests = []
        def handler(request):
            requests.append(request)
            return httpx.Response(200, json={"id": "provider-id"})
        first = email_job("agreement_copy")
        first["payload"]["sha256"] = document_sha256(content)
        gateway = MemoryDeliveryGateway(email=first)
        gateway.objects[PATH] = content
        self.assertEqual(self.service(gateway, handler).dispatch()["sent"], 1)
        gateway.email = email_job("agreement_copy", id="b1000000-0000-4000-8000-000000000099")
        gateway.email["payload"]["sha256"] = document_sha256(content)
        gateway.restart()
        self.assertEqual(self.service(gateway, handler).dispatch()["sent"], 1)
        for request in requests:
            payload = json.loads(request.content)
            self.assertEqual(payload["to"], ["partner@example.test"])
            self.assertIn("share your referral link", payload["text"])
            self.assertNotIn("later release", payload["text"])
            self.assertEqual(base64.b64decode(payload["attachments"][0]["content"]), gateway.download_partner_document(PATH))
        self.assertNotEqual(requests[0].headers["Idempotency-Key"], requests[1].headers["Idempotency-Key"])

    def test_changed_artifact_or_recipient_never_reaches_provider(self):
        content = render_partner_agreement(agreement_fixture())
        job = email_job("agreement_copy")
        job["payload"]["sha256"] = document_sha256(content)
        gateway = MemoryDeliveryGateway(email=job)
        gateway.objects[PATH] = b"%PDF-tampered"
        calls = []
        self.assertEqual(self.service(gateway, lambda r: calls.append(r)).dispatch()["review_required"], 1)
        self.assertFalse(calls)
        gateway = MemoryDeliveryGateway(email=email_job(prepared_provider="resend", prepared_payload={"to": ["wrong@example.test"]}))
        self.assertEqual(self.service(gateway, lambda r: calls.append(r)).dispatch()["review_required"], 1)
        self.assertFalse(calls)

    def test_mailpit_search_recovers_existing_message_without_duplicate_send(self):
        requests = []
        def handler(request):
            requests.append(request)
            return httpx.Response(200, json={"messages": [{"ID": "already-captured"}]})
        gateway = MemoryDeliveryGateway(email=email_job())
        self.assertEqual(self.service(gateway, handler, configuration("mailpit")).dispatch()["sent"], 1)
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].method, "GET")
        self.assertIn("message-id", str(requests[0].url))

    def test_mailpit_send_uses_local_capture_endpoint_and_pdf_attachment(self):
        requests = []
        def handler(request):
            requests.append(request)
            return httpx.Response(200, json={"messages": []} if request.method == "GET" else {"ID": "captured"})
        content = render_partner_agreement(agreement_fixture())
        job = email_job("agreement_copy")
        job["payload"]["sha256"] = document_sha256(content)
        gateway = MemoryDeliveryGateway(email=job)
        gateway.objects[PATH] = content
        self.assertEqual(self.service(gateway, handler, configuration("mailpit")).dispatch()["sent"], 1)
        payload = json.loads(requests[-1].content)
        self.assertEqual(base64.b64decode(payload["Attachments"][0]["Content"]), content)
        self.assertEqual(payload["To"], [{"Email": "partner@example.test"}])
        self.assertEqual(str(requests[-1].url), "http://127.0.0.1:54324/api/v1/send")

    def test_lost_preparation_lease_never_sends_email(self):
        gateway = MemoryDeliveryGateway(email=email_job())
        original_worker = gateway.worker
        def worker(action, payload):
            return None if action == "prepare_email" else original_worker(action, payload)
        gateway.worker = worker
        calls = []
        self.assertEqual(self.service(gateway, lambda request: calls.append(request)).dispatch()["deferred"], 1)
        self.assertFalse(calls)

    def test_provider_switch_and_missing_attempt_timestamp_require_review(self):
        for job in (email_job(prepared_provider="mailpit", prepared_payload={"To": [{"Email": "partner@example.test"}]}),
                    email_job(first_attempt_at=None)):
            gateway = MemoryDeliveryGateway(email=job)
            calls = []
            self.assertEqual(self.service(gateway, lambda request: calls.append(request)).dispatch()["review_required"], 1)
            self.assertFalse(calls)


if __name__ == "__main__":
    unittest.main()
