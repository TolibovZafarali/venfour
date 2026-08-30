"""Opt-in checks against the running local claim launcher, Auth, and Mailpit.

Run with VENFOUR_LOCAL_POST_CONTINUE=1 .venv/bin/python -m unittest
tests.local_claim_email_otp_integration -v after starting the normal local
launcher with the same opt-in. Only disposable synthetic fixtures are changed.
"""

from __future__ import annotations

import os
import re
import socket
import time
import unittest
from html import unescape
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import httpx
from psycopg import sql

from scripts.local_claim_flow import (
    LOOPBACK,
    create_fixture,
    local_database,
    local_status,
    marked_case,
    require_local,
)


APP_ORIGIN = "http://localhost:5173"
BACKEND_ORIGIN = "http://127.0.0.1:8000"
MAILPIT_ORIGIN = "http://127.0.0.1:54324"
LOCAL_CAPTCHA_RESPONSE = "XXXX.DUMMY.TOKEN.XXXX"


@unittest.skipUnless(
    os.environ.get("VENFOUR_LOCAL_POST_CONTINUE") == "1",
    "Explicit local post-Continue opt-in is required.",
)
class LocalClaimEmailOtpIntegration(unittest.TestCase):
    """Real email tokens and hardened ownership RPCs; no provider analysis."""

    @classmethod
    def setUpClass(cls):
        require_local()
        cls.status = local_status()
        cls.auth_origin = cls.status["API_URL"]
        cls.cleanup_counts = {"cases": 0, "identities": 0, "emails": 0}
        original_dns = socket.getaddrinfo

        def loopback_dns(host, *args, **kwargs):
            value = host.decode() if isinstance(host, bytes) else host
            if value not in LOOPBACK:
                raise RuntimeError("Only loopback network access is allowed.")
            return original_dns(host, *args, **kwargs)

        cls.dns_guard = patch("socket.getaddrinfo", side_effect=loopback_dns)
        cls.dns_guard.start()
        cls.addClassCleanup(cls.dns_guard.stop)
        cls.http = httpx.Client(timeout=15, follow_redirects=False, trust_env=False)
        cls.addClassCleanup(cls.http.close)
        for origin, path in ((BACKEND_ORIGIN, "/health"), (MAILPIT_ORIGIN, "/api/v1/messages")):
            response = cls._request("GET", origin, path)
            if response.status_code != 200:
                raise RuntimeError("Start the local claim launcher and Mailpit first.")

    @classmethod
    def tearDownClass(cls):
        print(
            "Local OTP cleanup confirmed: "
            f"{cls.cleanup_counts['cases']} synthetic cases, "
            f"{cls.cleanup_counts['identities']} disposable identities, "
            f"{cls.cleanup_counts['emails']} test emails."
        )

    def setUp(self):
        self.created_cases: list[str] = []
        self.created_users: set[str] = set()
        self.created_emails: set[str] = set()
        self.created_messages: set[str] = set()
        self.addCleanup(self._cleanup_owned_fixtures)

    @classmethod
    def _request(cls, method, origin, path, **kwargs):
        parsed = urlsplit(origin)
        if (
            parsed.scheme != "http"
            or parsed.hostname not in LOOPBACK
            or parsed.port not in {5173, 8000, 54321, 54324}
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
            or not path.startswith("/")
            or path.startswith("//")
        ):
            raise RuntimeError("Only the standard loopback services are allowed.")
        return cls.http.request(method, origin + path, **kwargs)

    def _auth_headers(self, token=None, *, admin=False):
        key = self.status["SERVICE_ROLE_KEY"] if admin else self.status["ANON_KEY"]
        result = {"apikey": key}
        if token or admin:
            result["Authorization"] = "Bearer " + (token or key)
        return result

    def _expect_status(self, response, status):
        # Deliberately exclude bodies, tokens, and authenticated URLs from failures.
        self.assertEqual(response.status_code, status, "Unexpected local HTTP status.")

    def _anonymous_session(self):
        response = self._request(
            "POST", self.auth_origin, "/auth/v1/signup",
            headers=self._auth_headers(),
            json={"data": {}, "gotrue_meta_security": {"captcha_token": LOCAL_CAPTCHA_RESPONSE}},
        )
        self._expect_status(response, 200)
        session = response.json()
        self.created_users.add(session["user"]["id"])
        self.assertTrue(session["user"]["is_anonymous"])
        return session

    def _permanent_session(self):
        email = f"local-otp-integration-{uuid4().hex}@example.test"
        self.created_emails.add(email)
        response = self._request(
            "POST", self.auth_origin, "/auth/v1/admin/generate_link",
            headers=self._auth_headers(admin=True),
            json={"type": "magiclink", "email": email},
        )
        self._expect_status(response, 200)
        payload = response.json()
        self._record_email_user(email)
        response = self._request(
            "POST", self.auth_origin, "/auth/v1/verify",
            headers=self._auth_headers(),
            json={"type": "email", "token_hash": payload["hashed_token"]},
        )
        self._expect_status(response, 200)
        return response.json()

    def _case(self, session):
        fixture = create_fixture(session["user"]["id"], "supportable")
        self.created_cases.append(fixture["caseId"])
        self.created_emails.add(fixture["email"])
        response = self._backend("POST", fixture["caseId"], session, "/post-continue")
        self._expect_status(response, 200)
        return fixture

    def _backend(self, method, case_id, session, suffix="/claim", **kwargs):
        return self._request(
            method, BACKEND_ORIGIN, f"/api/v1/appraisal-cases/{case_id}{suffix}",
            headers={"Authorization": "Bearer " + session["access_token"]}, **kwargs,
        )

    def _renew(self, fixture, session):
        response = self._backend("POST", fixture["caseId"], session, "/claim/access-link")
        self._expect_status(response, 200)
        result = response.json()
        if result["state"] == "secure_required":
            self.assertEqual(result["contactEmail"], fixture["email"])
        else:
            self.assertIsNone(result["contactEmail"])
        return result

    def _record_email_user(self, email):
        self.assertIn(email, self.created_emails)
        with local_database() as db:
            row = db.execute("select id from auth.users where email=%s", (email,)).fetchone()
        if row:
            self.created_users.add(str(row["id"]))

    def _send_code(self, fixture):
        response = self._request(
            "POST", self.auth_origin, "/auth/v1/otp",
            headers=self._auth_headers(),
            params={"redirect_to": APP_ORIGIN + f"/total-loss/cases/{fixture['caseId']}/claim/checkout"},
            json={
                "email": fixture["email"], "create_user": True,
                "gotrue_meta_security": {"captcha_token": LOCAL_CAPTCHA_RESPONSE},
            },
        )
        self._record_email_user(fixture["email"])
        self._expect_status(response, 200)
        return self._read_code(fixture["email"])

    def _read_code(self, email):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            response = self._request("GET", MAILPIT_ORIGIN, "/api/v1/messages", params={"limit": 500})
            self._expect_status(response, 200)
            messages = response.json().get("messages", [])
            for message in messages:
                recipients = message.get("To", [])
                if message["ID"] in self.created_messages or not any(
                    recipient.get("Address") == email for recipient in recipients
                ):
                    continue
                self.created_messages.add(message["ID"])
                response = self._request("GET", MAILPIT_ORIGIN, "/api/v1/message/" + message["ID"])
                self._expect_status(response, 200)
                payload = response.json()
                self.assertEqual(payload["Subject"], "Your Venfour verification code")
                body = payload.get("Text") or unescape(re.sub(r"<[^>]+>", " ", payload.get("HTML", "")))
                self.assertTrue("Use this code to verify your claim:" in body)
                self.assertFalse("token_hash=" in body)
                self.assertFalse("/auth/callback/" in body)
                matches = re.findall(r"(?<!\d)(\d{3})[-\s]?(\d{3})(?!\d)", body)
                self.assertEqual(len(matches), 1, "Expected one six-digit verification code.")
                return "".join(matches[0])
            time.sleep(0.1)
        self.fail("The local verification email did not arrive in Mailpit.")

    def _verify(self, fixture, code):
        return self._request(
            "POST", self.auth_origin, "/auth/v1/verify",
            headers=self._auth_headers(),
            json={"email": fixture["email"], "token": code, "type": "email"},
        )

    def _read_legacy_intake_hash(self, email, claim_id):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            response = self._request("GET", MAILPIT_ORIGIN, "/api/v1/messages", params={"limit": 500})
            self._expect_status(response, 200)
            for message in response.json().get("messages", []):
                if message["ID"] in self.created_messages or not any(
                    recipient.get("Address") == email for recipient in message.get("To", [])
                ):
                    continue
                self.created_messages.add(message["ID"])
                response = self._request("GET", MAILPIT_ORIGIN, "/api/v1/message/" + message["ID"])
                self._expect_status(response, 200)
                payload = response.json()
                self.assertEqual(payload["Subject"], "Continue your Venfour appraisal")
                html_body = payload.get("HTML", "")
                self.assertTrue("Continue securely" in html_body, "Legacy email CTA is missing.")
                self.assertFalse("Use this code to verify your claim:" in html_body)
                links = re.findall(r'href=["\']([^"\']+)["\']', html_body)
                self.assertEqual(len(links), 1, "Expected one legacy verification link.")
                link = urlsplit(unescape(links[0]))
                self.assertTrue(
                    link.scheme == "http" and link.netloc == "localhost:5173"
                    and link.path == "/auth/callback/case-claim/" + claim_id
                    and not link.fragment,
                    "Legacy email must keep its exact local case-claim callback.",
                )
                parameters = parse_qs(link.query)
                self.assertTrue(set(parameters) == {"token_hash", "type"})
                self.assertTrue(parameters.get("type") == ["email"])
                hashes = parameters.get("token_hash", [])
                self.assertTrue(len(hashes) == 1 and bool(hashes[0]), "Legacy token hash is missing.")
                return hashes[0]
            time.sleep(0.1)
        self.fail("The local legacy intake email did not arrive in Mailpit.")

    def _complete(self, claim_id, session):
        return self._request(
            "POST", self.auth_origin, "/rest/v1/rpc/complete_total_loss_case_claim_with_context",
            headers=self._auth_headers(session["access_token"]),
            json={"claim_id": claim_id},
        )

    def test_saved_email_raw_code_wrong_code_transfer_and_replay(self):
        anonymous = self._anonymous_session()
        fixture = self._case(anonymous)
        claim = self._renew(fixture, anonymous)
        self.assertEqual(claim["state"], "secure_required")
        self.assertEqual(self._renew(fixture, anonymous)["claimId"], claim["claimId"])
        replacement = self._backend(
            "POST", fixture["caseId"], anonymous, "/claim/access-link",
            json={"email": "replacement@example.test"},
        )
        self._expect_status(replacement, 400)
        code = self._send_code(fixture)
        wrong = str((int(code) + 1) % 1_000_000).zfill(6)
        self.assertIn(self._verify(fixture, wrong).status_code, {400, 403})
        response = self._verify(fixture, code)
        self._expect_status(response, 200)
        permanent = response.json()
        self.assertFalse(permanent["user"]["is_anonymous"])
        self.assertTrue(bool(permanent["user"]["email_confirmed_at"]))
        completed = self._complete(claim["claimId"], permanent)
        self._expect_status(completed, 200)
        result = completed.json()[0]
        self.assertEqual(result["case_id"], fixture["caseId"])
        self.assertEqual(result["owner_user_id"], permanent["user"]["id"])
        self.assertEqual(result["claim_purpose"], "post_continue")
        self.assertTrue(result["ownership_transferred"])
        replay = self._complete(claim["claimId"], permanent)
        self._expect_status(replay, 200)
        self.assertEqual(replay.json()[0]["outcome"], "already_claimed")
        self.assertIn(self._verify(fixture, code).status_code, {400, 403})
        self._expect_status(self._backend("GET", fixture["caseId"], anonymous), 404)
        current = self._backend("GET", fixture["caseId"], permanent)
        self._expect_status(current, 200)
        self.assertEqual(current.json()["state"], "secured")
        self.assertEqual(current.json()["journey"]["nextState"], "checkout")

    def test_expired_auth_code_and_resend_use_same_bound_claim(self):
        anonymous = self._anonymous_session()
        fixture = self._case(anonymous)
        claim = self._renew(fixture, anonymous)
        expired_code = self._send_code(fixture)
        with local_database() as db:
            row = db.execute("select id from auth.users where email=%s", (fixture["email"],)).fetchone()
            self.assertIn(str(row["id"]), self.created_users)
            db.execute(
                "update auth.users set confirmation_sent_at=now()-interval '2 hours', "
                "recovery_sent_at=now()-interval '2 hours' where id=%s and email=%s",
                (row["id"], fixture["email"]),
            )
        self.assertIn(self._verify(fixture, expired_code).status_code, {400, 403})
        self.assertEqual(self._renew(fixture, anonymous)["claimId"], claim["claimId"])
        fresh_code = self._send_code(fixture)
        verified = self._verify(fixture, fresh_code)
        self._expect_status(verified, 200)
        self._expect_status(self._complete(claim["claimId"], verified.json()), 200)

    def test_expired_case_claim_cannot_transfer_after_successful_auth(self):
        anonymous = self._anonymous_session()
        fixture = self._case(anonymous)
        claim = self._renew(fixture, anonymous)
        code = self._send_code(fixture)
        with local_database() as db:
            marked_case(db, fixture["caseId"])
            db.execute(
                "update public.total_loss_case_identity_claims "
                "set created_at=now()-interval '2 hours', expires_at=now()-interval '1 hour' "
                "where id=%s and case_id=%s and source_user_id=%s and claimed_at is null",
                (claim["claimId"], fixture["caseId"], anonymous["user"]["id"]),
            )
        verified = self._verify(fixture, code)
        self._expect_status(verified, 200)
        self.assertIn(self._complete(claim["claimId"], verified.json()).status_code, {401, 403})
        self.assertEqual(self._backend("GET", fixture["caseId"], anonymous).json()["state"], "secure_required")

    def test_matching_permanent_owner_skips_otp_and_wrong_account_is_denied(self):
        permanent = self._permanent_session()
        fixture = self._case(permanent)
        claim = self._renew(fixture, permanent)
        self.assertEqual(claim["state"], "secured")
        self.assertIsNone(claim["claimId"])
        current = self._backend("GET", fixture["caseId"], permanent)
        self._expect_status(current, 200)
        self.assertEqual(current.json()["contactEmail"], fixture["email"])
        wrong = self._permanent_session()
        self._expect_status(self._backend("GET", fixture["caseId"], wrong), 404)
        self._expect_status(self._backend("POST", fixture["caseId"], wrong, "/claim/access-link"), 404)
        anonymous = self._anonymous_session()
        another = self._case(anonymous)
        pending = self._renew(another, anonymous)
        self.assertIn(self._complete(pending["claimId"], wrong).status_code, {401, 403})
        self.assertEqual(self._backend("GET", another["caseId"], anonymous).json()["state"], "secure_required")

    def test_existing_permanent_account_uses_code_email_and_claims_anonymous_case(self):
        anonymous = self._anonymous_session()
        fixture = self._case(anonymous)
        claim = self._renew(fixture, anonymous)
        response = self._request(
            "POST", self.auth_origin, "/auth/v1/admin/users",
            headers=self._auth_headers(admin=True),
            json={"email": fixture["email"], "email_confirm": True},
        )
        self._record_email_user(fixture["email"])
        self._expect_status(response, 200)
        existing = response.json()
        self.created_users.add(existing["id"])
        self.assertFalse(existing["is_anonymous"])
        self.assertTrue(bool(existing["email_confirmed_at"]))
        self.assertNotEqual(existing["id"], anonymous["user"]["id"])

        # A confirmed account exercises the magic-link template's code-only branch.
        code = self._send_code(fixture)
        response = self._verify(fixture, code)
        self._expect_status(response, 200)
        permanent = response.json()
        self.assertEqual(permanent["user"]["id"], existing["id"])
        completed = self._complete(claim["claimId"], permanent)
        self._expect_status(completed, 200)
        result = completed.json()[0]
        self.assertEqual(result["owner_user_id"], existing["id"])
        self.assertEqual(result["case_id"], fixture["caseId"])
        self.assertEqual(result["claim_purpose"], "post_continue")
        self.assertTrue(result["ownership_transferred"])
        replay = self._complete(claim["claimId"], permanent)
        self._expect_status(replay, 200)
        self.assertEqual(replay.json()[0]["outcome"], "already_claimed")
        self.assertFalse(replay.json()[0]["ownership_transferred"])
        self.assertIn(self._verify(fixture, code).status_code, {400, 403})
        self.assertIn(self._complete(claim["claimId"], anonymous).status_code, {401, 403})
        self._expect_status(self._backend("GET", fixture["caseId"], anonymous), 404)
        current = self._backend("GET", fixture["caseId"], permanent)
        self._expect_status(current, 200)
        self.assertEqual(current.json()["state"], "secured")
        self.assertEqual(current.json()["journey"]["nextState"], "checkout")

    def test_legacy_intake_email_keeps_callback_and_completes_intake_claim(self):
        anonymous = self._anonymous_session()
        email = f"local-intake-compatibility-{uuid4().hex}@example.test"
        self.created_emails.add(email)
        response = self._request(
            "POST", self.auth_origin, "/rest/v1/rpc/get_or_create_total_loss_draft",
            headers=self._auth_headers(anonymous["access_token"]), json={},
        )
        self._expect_status(response, 200)
        draft = response.json()
        case_id = draft["id"]
        self.created_cases.append(case_id)
        self.assertTrue(draft["user_id"] == anonymous["user"]["id"])
        with local_database() as db:
            db.execute(
                "insert into local_claim_testing.cases(case_id,mode) "
                "values(%s,'supportable')",
                (case_id,),
            )
        response = self._request(
            "POST", self.auth_origin, "/rest/v1/total_loss_case_details",
            headers=self._auth_headers(anonymous["access_token"]),
            json={"case_id": case_id, "intake_mode": "manual"},
        )
        self._expect_status(response, 201)
        response = self._request(
            "POST", self.auth_origin, "/rest/v1/rpc/save_total_loss_contact_details_and_begin_claim",
            headers=self._auth_headers(anonymous["access_token"]),
            json={
                "case_id": case_id,
                "first_name": "Local",
                "last_name": "Compatibility",
                "email": email,
                "phone_number": None,
                "service_terms_version": "2026-08-23",
                "privacy_notice_version": "2026-08-23",
                "operational_follow_up_allowed": False,
            },
        )
        self._expect_status(response, 200)
        claim = response.json()[0]
        self.assertTrue(claim["case_id"] == case_id and claim["email"] == email)
        self.assertTrue(bool(claim["claim_id"]))
        response = self._request(
            "POST", self.auth_origin, "/auth/v1/otp",
            headers=self._auth_headers(),
            params={"redirect_to": APP_ORIGIN + "/auth/callback/case-claim/" + claim["claim_id"]},
            json={
                "email": email, "create_user": True,
                "gotrue_meta_security": {"captcha_token": LOCAL_CAPTCHA_RESPONSE},
            },
        )
        self._record_email_user(email)
        self._expect_status(response, 200)
        token_hash = self._read_legacy_intake_hash(email, claim["claim_id"])
        response = self._request(
            "POST", self.auth_origin, "/auth/v1/verify",
            headers=self._auth_headers(),
            json={"type": "email", "token_hash": token_hash},
        )
        self._expect_status(response, 200)
        permanent = response.json()
        self.assertFalse(permanent["user"]["is_anonymous"])
        self.assertTrue(bool(permanent["user"]["email_confirmed_at"]))
        self.assertTrue(permanent["user"]["email"] == email)
        completed = self._complete(claim["claim_id"], permanent)
        self._expect_status(completed, 200)
        result = completed.json()[0]
        self.assertEqual(result["claim_purpose"], "intake")
        self.assertTrue(result["case_id"] == case_id)
        self.assertTrue(result["owner_user_id"] == permanent["user"]["id"])
        self.assertTrue(result["ownership_transferred"])

    def _cleanup_owned_fixtures(self):
        require_local()
        for email in self.created_emails:
            self._record_email_user(email)
        with local_database() as db:
            for case_id in self.created_cases:
                marker = marked_case(db, case_id)
                if str(marker["user_id"]) not in self.created_users:
                    raise RuntimeError("Refusing to clean up a fixture with an unexpected owner.")
                for table in ("commerce_orders", "payment_transactions", "case_entitlements", "total_loss_report_versions"):
                    exists = db.execute(
                        sql.SQL("select 1 from public.{} where case_id=%s limit 1").format(sql.Identifier(table)),
                        (case_id,),
                    ).fetchone()
                    if exists:
                        raise RuntimeError("Refusing to clean up a fixture that acquired commercial state.")
            # Only these test-created IDs are eligible. The setting is transaction-local.
            db.execute("set local session_replication_role = replica")
            for case_id in self.created_cases:
                for table in (
                    "total_loss_case_identity_claims", "total_loss_claim_workflows",
                    "total_loss_preliminary_snapshots", "analysis_runs", "total_loss_analysis_jobs",
                    "total_loss_case_contacts", "total_loss_case_details",
                ):
                    db.execute(
                        sql.SQL("delete from public.{} where case_id=%s").format(sql.Identifier(table)),
                        (case_id,),
                    )
                db.execute("delete from local_claim_testing.cases where case_id=%s", (case_id,))
                db.execute("delete from public.appraisal_cases where id=%s", (case_id,))
        with local_database() as db:
            for case_id in self.created_cases:
                remains = db.execute("select 1 from public.appraisal_cases where id=%s", (case_id,)).fetchone()
                self.assertIsNone(remains, "Synthetic case cleanup failed.")
                type(self).cleanup_counts["cases"] += 1
        for user_id in self.created_users:
            with local_database() as db:
                owned = db.execute("select 1 from public.appraisal_cases where user_id=%s limit 1", (user_id,)).fetchone()
            if owned:
                raise RuntimeError("Refusing to delete a test identity that owns an unexpected case.")
            response = self._request(
                "DELETE", self.auth_origin, "/auth/v1/admin/users/" + user_id,
                headers=self._auth_headers(admin=True),
            )
            self.assertIn(response.status_code, {200, 204}, "Test identity cleanup failed.")
            with local_database() as db:
                remains = db.execute("select 1 from auth.users where id=%s", (user_id,)).fetchone()
                self.assertIsNone(remains, "Disposable identity cleanup failed.")
            type(self).cleanup_counts["identities"] += 1
        if self.created_messages:
            response = self._request(
                "DELETE", MAILPIT_ORIGIN, "/api/v1/messages",
                json={"IDs": sorted(self.created_messages)},
            )
            self.assertIn(response.status_code, {200, 204}, "Test email cleanup failed.")
            type(self).cleanup_counts["emails"] += len(self.created_messages)
