"""Delivery coordination on the existing Supabase boundary and case records."""
from __future__ import annotations

import hashlib
import logging
from dataclasses import asdict
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode, urlsplit
from uuid import UUID, uuid4

import httpx
from standardwebhooks.webhooks import Webhook

from venfour.email_delivery import EmailConfiguration, EmailDeliveryError, email_address, email_payload, send_prepared, trusted_origin
from venfour.email_templates import LAYOUT_VERSION, TEMPLATES, render_email, render_preview, template_catalogue
from venfour.supabase_gateway import SupabaseHttpGateway

logger = logging.getLogger(__name__)


class CommunicationError(Exception):
    def __init__(self, status=503, code="COMMUNICATIONS_UNAVAILABLE"):
        super().__init__(code)
        self.status, self.code = status, code


class CommunicationGateway(SupabaseHttpGateway):
    def worker(self, action: str, payload: Mapping[str, Any] | None = None):
        return self._rpc("communication_worker", {"p_action": action, "p_payload": dict(payload or {})})

    def staff(self, action: str, payload: Mapping[str, Any], token: str):
        try:
            response = self._client.post(f"{self._configuration.url}/rest/v1/rpc/communication_staff_operation",
                headers={**self._user_headers(token), "Content-Type": "application/json"},
                json={"p_action": action, "p_payload": dict(payload)}, timeout=5)
            if response.is_success:
                return response.json()
            body = response.json()
            code = body.get("code")
            status = (401 if response.status_code == 401 else 403 if code == "42501" else
                      409 if code == "40001" else 400 if code in {"22023", "22P02", "23514"} else 503)
            raise CommunicationError(status)
        except (httpx.HTTPError, ValueError):
            raise CommunicationError() from None


def verify_email_signature(body: bytes, headers: Mapping[str, str], secret: str, *, resend=False):
    prefix = "svix" if resend else "webhook"
    names = {f"webhook-{field}": headers.get(f"{prefix}-{field}", "") for field in ("id", "timestamp", "signature")}
    try:
        if not secret or len(names["webhook-id"]) > 256:
            raise ValueError()
        result = Webhook(secret.removeprefix("v1,")).verify(body, names)
        if not isinstance(result, dict):
            raise ValueError()
        return result
    except Exception:
        raise CommunicationError(401, "EMAIL_SIGNATURE_INVALID") from None


def _uuid(value):
    try:
        if not isinstance(value, str) or str(UUID(value)) != value:
            raise ValueError()
        return value
    except (ValueError, TypeError):
        raise CommunicationError(400, "EMAIL_CONTEXT_INVALID") from None


def auth_messages(payload: Mapping[str, Any], config: EmailConfiguration, supabase_origin: str):
    """Use only provider-signed token data; never mint tokens or transfer ownership."""
    try:
        user, data = payload["user"], payload["email_data"]
        action = data["email_action_type"]
        recipient = email_address(user.get("email") or (user.get("new_email") if action == "email_change" else ""))
        origin = trusted_origin(config.app_origin)
        # The hook's site_url can be the Auth API origin, unlike SMTP's SiteURL.
        if trusted_origin(data["site_url"]) not in {origin, trusted_origin(supabase_origin)}:
            raise ValueError()
        redirect = data.get("redirect_to") or origin + "/auth/callback"
        parsed = urlsplit(redirect)
        if trusted_origin(f"{parsed.scheme}://{parsed.netloc}") != origin or parsed.fragment:
            raise ValueError()
        path = parsed.path.rstrip("/")
        key, code, url = "auth_access", "", ""
        if action in {"signup", "magiclink"}:
            if path in {"", "/auth/callback"}:
                key, code = "auth_sign_in", data["token"]
            elif path.startswith("/total-loss/cases/") and path.endswith("/claim/checkout"):
                parts = path.split("/")
                if len(parts) != 6:
                    raise ValueError()
                _uuid(parts[3])
                key, code = "auth_claim", data["token"]
            else:
                parts = path.split("/")
                if path.startswith("/auth/callback/case-claim/") and len(parts) == 5:
                    _uuid(parts[4])
                elif len(parts) == 6 and parts[1:3] == ["auth", "callback"] and parts[3] in {"preview", "preview-ready"}:
                    _uuid(parts[4]); _uuid(parts[5])
                    if parts[3] == "preview-ready":
                        key = "auth_preview_ready"
                else:
                    raise ValueError()
                # Preserve the exact case and claim route and original type=email contract.
                if parsed.query:
                    raise ValueError()
                token_hash = data["token_hash"]
                if not isinstance(token_hash, str) or not 16 <= len(token_hash) <= 512:
                    raise ValueError()
                url = redirect + "?" + urlencode({"token_hash": token_hash, "type": "email"})
            return [(recipient, key, code, url)]
        if action == "reauthentication":
            return [(recipient, "auth_reauthentication", data["token"], "")]
        if "auth_" + action in TEMPLATES and action.endswith("_notification"):
            # Notifications carry no code, claim facts, or mutable account metadata.
            if action == "email_changed_notification":
                recipient = email_address(data["old_email"])
            return [(recipient, "auth_" + action, "", "")]
        if action not in {"email_change", "recovery", "invite"}:
            raise ValueError()
        def verify_url(token_hash):
            if not isinstance(token_hash, str) or not 16 <= len(token_hash) <= 512:
                raise ValueError()
            return trusted_origin(supabase_origin) + "/auth/v1/verify?" + urlencode({"token": token_hash, "type": action, "redirect_to": redirect})
        if action == "email_change":
            new_email = email_address(user["new_email"])
            current_hash, new_hash = data.get("token_hash_new"), data.get("token_hash")
            if current_hash and new_hash:
                # Supabase's legacy field names are reversed: _new belongs to CURRENT email.
                return [(recipient, "auth_email_change", data["token"], verify_url(current_hash)),
                        (new_email, "auth_email_change", data["token_new"], verify_url(new_hash))]
            return [(new_email, "auth_email_change", data.get("token_new") or data["token"], verify_url(new_hash))]
        return [(recipient, "auth_" + action, "", verify_url(data["token_hash"]))]
    except (ValueError, TypeError, KeyError, AttributeError):
        raise CommunicationError(400, "EMAIL_CONTEXT_INVALID") from None


class CommunicationService:
    def __init__(self, gateway, configuration: EmailConfiguration, *, client=None, supabase_origin="", now=None):
        self.gateway, self.config = gateway, configuration
        self.supabase_origin = supabase_origin
        self.client = client or httpx.Client(timeout=20, follow_redirects=False)
        self.owns_client = client is None
        self.now = now or (lambda: datetime.now(timezone.utc))
        self.configuration_error = None
        try:
            configuration.validate()
        except ValueError:
            self.configuration_error = "EMAIL_CONFIGURATION_REQUIRED"

    def close(self):
        if self.owns_client:
            self.client.close()

    def overview(self, token):
        result = self.gateway.staff("overview", {}, token)
        # Deliberately omit all secrets, allowlisted addresses, recipients, payloads and tokens.
        result["configuration"] = {"provider": self.config.provider, "mode": self.config.mode,
            "error": self.configuration_error, "auth_hook_enabled": self.config.auth_enabled,
            "webhook_configured": bool(self.config.webhook_secret),
            "test_send_configured": bool(self.config.allowlist) and not self.configuration_error and self.config.provider != "disabled" and self.config.mode in {"allowlist", "live"},
            "app_origin": self.config.app_origin,
            "identities": [{"name": name, "from": getattr(self.config, f"{name}_sender", "") or self.config.sender,
                            "reply_to": getattr(self.config, f"{name}_reply_to", "") or self.config.reply_to}
                           for name in ("customer", "auth", "partner")]}
        result["templates"] = [template | {"preview": asdict(self._preview(template["key"]))}
                               for template in template_catalogue()]
        return result

    def preview(self, key, token):
        self.gateway.staff("overview", {}, token)
        rendered = self._preview(key)
        return asdict(rendered)

    def _preview(self, key):
        if key not in TEMPLATES:
            raise CommunicationError(404, "EMAIL_TEMPLATE_NOT_FOUND")
        template = TEMPLATES[key]
        reply = (getattr(self.config, f"{template.identity}_reply_to", "") or self.config.reply_to)
        return render_preview(key, reply_to=reply, brand_origin=self.config.app_origin or "https://venfour.com")

    def test_send(self, key, request_id, token):
        identity = self.gateway.staff("test_access", {}, token)
        recipient = email_address(identity["email"])
        _uuid(request_id)
        if self.configuration_error or recipient not in self.config.allowlist or not self.config.may_send(recipient):
            raise CommunicationError(409, "EMAIL_TEST_RECIPIENT_NOT_ALLOWED")
        if key not in TEMPLATES:
            raise CommunicationError(404, "EMAIL_TEMPLATE_NOT_FOUND")
        sender, reply = self.config.identity(TEMPLATES[key].identity)
        rendered = self._preview(key)
        message_key = f"email-test/{hashlib.sha256(recipient.encode()).hexdigest()[:16]}/{request_id}"
        lease = str(uuid4())
        reserved = self.gateway.worker("begin_test", {"source_key": message_key, "template_key": key,
            "recipient_hash": hashlib.sha256(recipient.lower().encode()).hexdigest(), "lease_token": lease,
            "provider": self.config.provider, "template_version": LAYOUT_VERSION})
        if not reserved:
            raise CommunicationError(409, "EMAIL_TEST_DEFERRED")
        if reserved["status"] == "accepted":
            return {"status": "accepted"}
        prepared = email_payload(rendered, recipient=recipient, sender=sender, reply_to=reply, provider=self.config.provider, message_key=message_key)
        message_id = send_prepared(self.client, provider=self.config.provider, payload=prepared, key=message_key,
            api_key=self.config.api_key, mailpit_origin=self.config.mailpit_origin)
        if not self.gateway.worker("finish_test", {"source_key": message_key, "lease_token": lease, "provider_message_id": message_id}):
            raise CommunicationError(503, "EMAIL_ACKNOWLEDGEMENT_DEFERRED")
        return {"status": "accepted"}

    def dispatch(self):
        if self.configuration_error:
            raise CommunicationError()
        if self.config.mode in {"disabled", "dry_run"} or self.config.provider == "disabled":
            return self.gateway.worker("plan")
        allowed = {"recipients": list(self.config.allowlist)} if self.config.mode == "allowlist" else {}
        self.gateway.worker("discover", allowed)
        counts = {"accepted": 0, "deferred": 0}
        for _ in range(3):
            token = str(uuid4())
            job = self.gateway.worker("lease", {**allowed, "lease_token": token})
            if job is None:
                break
            lease = {"id": _uuid(job["id"]), "lease_token": token}
            try:
                if job.get("lease_token") != token or not self.config.may_send(job["recipient_email"]):
                    raise EmailDeliveryError("EMAIL_RECIPIENT_NOT_ALLOWED", requires_review=True)
                first = datetime.fromisoformat(job["first_attempt_at"].replace("Z", "+00:00"))
                if first.tzinfo is None or self.now() >= first + timedelta(hours=23):
                    raise EmailDeliveryError("EMAIL_RETRY_WINDOW_EXPIRED", requires_review=True)
                key = job["template_key"]
                case_id = _uuid(job["case_id"])
                suffix = "/return" if key in {"intake_reminder", "free_review_ready", "free_review_reminder"} else "/claim"
                action_url = trusted_origin(self.config.app_origin) + f"/total-loss/cases/{case_id}{suffix}"
                if key == "intake_reminder":
                    action_url = trusted_origin(self.config.app_origin) + "/total-loss/start?" + urlencode({"caseId": case_id})
                unsubscribe = (trusted_origin(self.config.api_origin) + "/emails/preferences/" + job["unsubscribe_token"] if job["category"] == "follow_up" else "")
                sender, reply = self.config.identity()
                rendered = render_email(key, action_url=action_url, reply_to=reply, unsubscribe_url=unsubscribe,
                    brand_origin=self.config.app_origin)
                prepared = job.get("prepared_payload") or email_payload(rendered, recipient=job["recipient_email"], sender=sender, reply_to=reply,
                    provider=self.config.provider, message_key=f"communication/{job['id']}", unsubscribe_url=unsubscribe)
                current = self.gateway.worker("prepare", {**lease, "prepared_payload": prepared,
                    "provider": self.config.provider, "template_version": LAYOUT_VERSION})
                if current is None:
                    continue
                provider = current["prepared_provider"]
                prepared = current["prepared_payload"]
                recipient_list = prepared.get("to") if provider == "resend" else prepared.get("To")
                expected = [job["recipient_email"]] if provider == "resend" else [{"Email": job["recipient_email"]}]
                if provider != self.config.provider or recipient_list != expected or any(k.lower() in {"cc", "bcc"} for k in prepared):
                    raise EmailDeliveryError("EMAIL_PREPARED_IDENTITY_CHANGED", requires_review=True)
                message_id = send_prepared(self.client, provider=provider, payload=prepared, key=f"communication/{job['id']}",
                    api_key=self.config.api_key, mailpit_origin=self.config.mailpit_origin)
                if not self.gateway.worker("finish", {**lease, "provider_message_id": message_id}):
                    raise EmailDeliveryError("EMAIL_ACKNOWLEDGEMENT_DEFERRED")
                counts["accepted"] += 1
            except Exception as error:
                code = error.code if isinstance(error, EmailDeliveryError) else "EMAIL_PROCESSING_DEFERRED"
                try:
                    self.gateway.worker("fail", {**lease, "error_code": code,
                        "requires_review": isinstance(error, EmailDeliveryError) and error.requires_review})
                except Exception:
                    logger.warning("Communication acknowledgement deferred")
                logger.warning("Communication processing deferred")
                counts["deferred"] += 1
        return counts

    def auth_hook(self, body, headers):
        if not self.config.auth_enabled or self.configuration_error:
            raise CommunicationError(503, "AUTH_EMAIL_HOOK_DISABLED")
        payload = verify_email_signature(body, headers, self.config.hook_secret)
        messages = auth_messages(payload, self.config, self.supabase_origin)
        if any(not self.config.may_send(message[0], auth=True) for message in messages):
            # Never acknowledge a suppressed code as sent and never redirect it to a test recipient.
            raise CommunicationError(503, "AUTH_EMAIL_RECIPIENT_NOT_ALLOWED")
        def deliver(message):
            recipient, key, code, url = message
            sender, reply = self.config.identity("auth")
            rendered = render_email(key, code=code, action_url=url, reply_to=reply, brand_origin=self.config.app_origin)
            # Stable across hook retries, including partial secure-email-change delivery.
            digest = hashlib.sha256((headers["webhook-id"] + "\x00" + recipient).encode()).hexdigest()
            message_key = "auth-email/" + digest
            prepared = email_payload(rendered, recipient=recipient, sender=sender, reply_to=reply, provider=self.config.provider, message_key=message_key)
            message_id = send_prepared(self.client, provider=self.config.provider, payload=prepared, key=message_key,
                api_key=self.config.api_key, mailpit_origin=self.config.mailpit_origin,
                timeout=httpx.Timeout(connect=0.75, read=2, write=0.5, pool=0.25))
            # No tokens, links, rendered bodies or raw provider payloads are persisted.
            return {"source_key": message_key, "template_key": key, "provider_message_id": message_id,
                    "recipient_hash": hashlib.sha256(recipient.lower().encode()).hexdigest(), "template_version": LAYOUT_VERSION}
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(deliver, messages))
        return results

    def record_auth_results(self, results):
        for result in results:
            try:
                self.gateway.worker("record_auth", result)
            except Exception:
                # Delivery succeeds independently of telemetry; never rotate a code for a logging failure.
                logger.warning("Auth email delivery telemetry deferred")

    def webhook(self, body, headers):
        payload = verify_email_signature(body, headers, self.config.webhook_secret, resend=True)
        event_type = payload.get("type")
        if event_type not in {"email.sent", "email.delivered", "email.delivery_delayed", "email.bounced", "email.complained", "email.failed", "email.suppressed"}:
            return {}
        try:
            data = payload["data"]
            message_id = data["email_id"]
            occurred = datetime.fromisoformat(payload["created_at"].replace("Z", "+00:00"))
            if occurred.tzinfo is None or not isinstance(message_id, str) or not 1 <= len(message_id) <= 256:
                raise ValueError()
            args = {"event_id": headers["svix-id"], "provider_message_id": message_id, "event_type": event_type, "occurred_at": occurred.isoformat()}
            recipients = data.get("to", [])
            if event_type in {"email.bounced", "email.complained"} and isinstance(recipients, list) and len(recipients) == 1:
                address = email_address(recipients[0]).strip().lower()
                args["recipient_hash"] = hashlib.sha256(address.encode()).hexdigest()
            self.gateway.worker("event", args)
        except (ValueError, TypeError, KeyError):
            raise CommunicationError(400, "EMAIL_EVENT_INVALID") from None
        return {}
