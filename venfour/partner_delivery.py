"""Durable private agreement preparation and transactional partner email delivery."""

from __future__ import annotations

import base64
import hmac
import logging
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.utils import parseaddr
from typing import Any, Callable, Protocol
from urllib.parse import urlsplit
from uuid import uuid4

import httpx

from venfour.email_delivery import EmailDeliveryError, send_prepared
from venfour.email_templates import render_email
from venfour.partner_documents import (
    PARTNER_DOCUMENT_BUCKET,
    PARTNER_DOCUMENT_FILENAME,
    PartnerDocumentError,
    canonical_uuid,
    document_sha256,
    partner_document_path,
    render_partner_agreement,
    validated_digest,
)


logger = logging.getLogger(__name__)
_RETRY_WINDOW = timedelta(hours=23)


def _origin(value: str, *, local_only: bool = False) -> str:
    parsed = urlsplit(value)
    local = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if (not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in {"", "/"} or (local_only and not local)
            or parsed.scheme not in ({"http", "https"} if local else {"https"})):
        raise ValueError("Email origin configuration is invalid")
    return value.rstrip("/")


def _email(value: Any, *, display_name: bool = False) -> str:
    if (not isinstance(value, str) or not value or len(value) > 500
            or any(char in value for char in "\r\n\x00")):
        raise ValueError("Email address is invalid")
    name, address = parseaddr(value)
    if "@" not in address or address.count("@") != 1 or not all(address.split("@")):
        raise ValueError("Email address is invalid")
    if not display_name and (name or address != value):
        raise ValueError("Email address is invalid")
    return value


@dataclass(frozen=True)
class PartnerDeliveryConfiguration:
    provider: str = "disabled"
    public_app_origin: str = ""
    sender: str = ""
    reply_to: str = ""
    resend_api_key: str = field(default="", repr=False)
    mailpit_origin: str = "http://127.0.0.1:54324"
    delivery_mode: str = "live"
    test_recipients: tuple[str, ...] = field(default=(), repr=False)

    @classmethod
    def from_environment(cls, environment: Mapping[str, str]) -> PartnerDeliveryConfiguration:
        return cls(
            provider=environment.get("VENFOUR_PARTNER_EMAIL_PROVIDER", environment.get("VENFOUR_EMAIL_PROVIDER", "disabled")).strip().lower(),
            delivery_mode=environment.get("VENFOUR_EMAIL_MODE", "disabled") if "VENFOUR_EMAIL_PROVIDER" in environment else "live",
            test_recipients=tuple(x.strip().lower() for x in environment.get("VENFOUR_EMAIL_TEST_RECIPIENTS", "").split(",") if x.strip()),
            public_app_origin=environment.get("VENFOUR_PUBLIC_APP_ORIGIN", "").strip(),
            sender=environment.get("VENFOUR_PARTNER_EMAIL_FROM", environment.get("VENFOUR_EMAIL_FROM", "")).strip(),
            reply_to=environment.get("VENFOUR_PARTNER_EMAIL_REPLY_TO", environment.get("VENFOUR_EMAIL_REPLY_TO", "")).strip(),
            resend_api_key=environment.get("RESEND_API_KEY", "").strip(),
            mailpit_origin=environment.get("VENFOUR_PARTNER_MAILPIT_ORIGIN", "http://127.0.0.1:54324").strip(),
        )

    @property
    def configuration_error(self) -> str | None:
        if self.provider == "disabled" or self.delivery_mode in {"disabled", "dry_run"}:
            return "PARTNER_EMAIL_DISABLED"
        try:
            if self.delivery_mode not in {"live", "allowlist"}:
                raise ValueError("Unknown delivery mode")
            if self.provider not in {"resend", "mailpit"}:
                raise ValueError("Unknown provider")
            _origin(self.public_app_origin)
            _email(self.sender, display_name=True)
            _email(self.reply_to, display_name=True)
            if self.provider == "resend" and not self.resend_api_key:
                raise ValueError("Missing sender credential")
            if self.provider == "mailpit":
                _origin(self.mailpit_origin, local_only=True)
                _origin(self.public_app_origin, local_only=True)
        except (ValueError, TypeError):
            return "PARTNER_EMAIL_CONFIGURATION_REQUIRED"
        return None

    @property
    def configured(self) -> bool:
        return self.configuration_error is None


class PartnerDeliveryGateway(Protocol):
    def worker(self, action: str, payload: Mapping[str, Any]) -> Any: ...

    def download_partner_document(self, object_path: str) -> bytes | None: ...

    def store_partner_document(self, object_path: str, content: bytes) -> None: ...


class _DeliveryError(Exception):
    def __init__(self, code: str, *, requires_review: bool = False) -> None:
        super().__init__(code)
        self.code = code
        self.requires_review = requires_review


class PartnerDeliveryService:
    def __init__(
        self, gateway: PartnerDeliveryGateway, configuration: PartnerDeliveryConfiguration,
        *, http_client: httpx.Client | None = None,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._gateway = gateway
        self._configuration = configuration
        self._client = http_client or httpx.Client(timeout=20, follow_redirects=False)
        self._owns_client = http_client is None
        self._now = now or (lambda: datetime.now(timezone.utc))

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def dispatch(self, *, limit: int = 3) -> dict[str, int]:
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 10:
            raise ValueError("Partner delivery batch size is invalid")
        counts = {"documents_ready": 0, "sent": 0, "deferred": 0,
                  "review_required": 0, "disabled": int(not self._configuration.configured)}
        for kind in ("document", "email"):
            if kind == "email" and not self._configuration.configured:
                continue
            for _ in range(limit):
                lease_token = str(uuid4())
                try:
                    job = self._gateway.worker(f"lease_{kind}", {"lease_token": lease_token})
                    if job is None:
                        break
                    if not isinstance(job, Mapping):
                        raise ValueError("Job reservation is invalid")
                    job_id = canonical_uuid(job.get("id"))
                    if job.get("lease_token") != lease_token:
                        raise ValueError("Job lease is invalid")
                    payload = job.get("payload")
                    if not isinstance(payload, Mapping):
                        raise ValueError("Job payload is invalid")
                except Exception:
                    logger.warning("Partner delivery reservation was deferred")
                    counts["deferred"] += 1
                    break

                lease = {"job_id": job_id, "lease_token": lease_token}
                try:
                    if kind == "document":
                        result = self._prepare_document(payload)
                    else:
                        result = self._send_email(job, lease)
                    recorded = self._gateway.worker(f"finish_{kind}", {**lease, **result})
                    if not recorded:
                        raise _DeliveryError("PARTNER_DELIVERY_ACKNOWLEDGEMENT_DEFERRED")
                    counts["documents_ready" if kind == "document" else "sent"] += 1
                except Exception as exc:
                    code = exc.code if isinstance(exc, _DeliveryError) else f"PARTNER_{kind.upper()}_PREPARATION_FAILED"
                    review = isinstance(exc, _DeliveryError) and exc.requires_review
                    failure = {**lease, "error_code": code, "requires_review": review}
                    try:
                        self._gateway.worker(f"fail_{kind}", failure)
                    except Exception:
                        logger.warning("Partner delivery failure acknowledgement was deferred")
                    logger.warning("Partner %s processing was deferred", kind)
                    counts["review_required" if review else "deferred"] += 1
        return counts

    def _prepare_document(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        expected_path = partner_document_path(payload.get("partner_id"), payload.get("agreement_id"))
        if payload.get("bucket") != PARTNER_DOCUMENT_BUCKET or payload.get("object_path") != expected_path:
            raise PartnerDocumentError("Agreement artifact identity is invalid")
        content = render_partner_agreement(payload)
        sha256 = document_sha256(content)
        existing = self._gateway.download_partner_document(expected_path)
        if existing is None:
            self._gateway.store_partner_document(expected_path, content)
            existing = self._gateway.download_partner_document(expected_path)
        if existing is None or not hmac.compare_digest(document_sha256(existing), sha256):
            raise _DeliveryError("PARTNER_DOCUMENT_INTEGRITY_FAILED", requires_review=True)
        return {"sha256": sha256, "byte_size": len(content)}

    def _send_email(self, job: Mapping[str, Any], lease: Mapping[str, str]) -> dict[str, str]:
        try:
            first_attempt = datetime.fromisoformat(str(job["first_attempt_at"]).replace("Z", "+00:00"))
            if first_attempt.tzinfo is None:
                raise ValueError("Missing timestamp timezone")
        except (KeyError, ValueError):
            raise _DeliveryError("PARTNER_EMAIL_ATTEMPT_TIMESTAMP_INVALID", requires_review=True) from None
        if self._now() >= first_attempt + _RETRY_WINDOW:
            raise _DeliveryError("PARTNER_EMAIL_RETRY_WINDOW_EXPIRED", requires_review=True)
        provider = job.get("prepared_provider")
        request_payload = job.get("prepared_payload")
        if not provider or not request_payload:
            provider = self._configuration.provider
            request_payload = self._email_payload(job["payload"], lease["job_id"], provider)
            prepared = self._gateway.worker("prepare_email", {
                **lease, "provider": provider, "payload": request_payload,
            })
            if not isinstance(prepared, Mapping):
                raise _DeliveryError("PARTNER_EMAIL_PREPARATION_DEFERRED")
            provider = prepared.get("prepared_provider")
            request_payload = prepared.get("prepared_payload")
        if provider != self._configuration.provider or not isinstance(request_payload, Mapping):
            raise _DeliveryError("PARTNER_EMAIL_PROVIDER_CHANGED", requires_review=True)
        self._validate_prepared_email(job["payload"], request_payload, provider)
        if self._configuration.delivery_mode == "allowlist" and job["payload"]["recipient_email"].lower() not in self._configuration.test_recipients:
            raise _DeliveryError("PARTNER_EMAIL_RECIPIENT_NOT_ALLOWED", requires_review=True)
        try:
            message_id = send_prepared(self._client, provider=provider, payload=request_payload,
                key=f"partner-email/{lease['job_id']}", api_key=self._configuration.resend_api_key,
                mailpit_origin=self._configuration.mailpit_origin)
        except EmailDeliveryError as error:
            raise _DeliveryError("PARTNER_" + error.code, requires_review=error.requires_review) from None
        return {"provider_message_id": message_id}

    def _email_payload(self, payload: Mapping[str, Any], job_id: str, provider: str) -> dict[str, Any]:
        recipient = _email(payload.get("recipient_email"))
        origin = _origin(self._configuration.public_app_origin)
        kind = payload.get("kind")
        attachment = None
        if kind == "invitation":
            invitation_id = canonical_uuid(payload.get("invitation_id"))
            action_url = f"{origin}/partners/invitations/{invitation_id}"
        elif kind == "agreement_copy":
            canonical_uuid(payload.get("agreement_id"))
            path = self._artifact_path(payload)
            content = self._gateway.download_partner_document(path)
            if content is None or not hmac.compare_digest(document_sha256(content), validated_digest(payload.get("sha256"))):
                raise _DeliveryError("PARTNER_DOCUMENT_INTEGRITY_FAILED", requires_review=True)
            attachment = {"filename": PARTNER_DOCUMENT_FILENAME,
                          "content": base64.b64encode(content).decode("ascii")}
            action_url = f"{origin}/partners"
        else:
            raise _DeliveryError("PARTNER_EMAIL_KIND_INVALID", requires_review=True)
        rendered = render_email("partner_" + kind, action_url=action_url, reply_to=self._configuration.reply_to)
        subject, text = rendered.subject, rendered.text
        if provider == "resend":
            result: dict[str, Any] = {"from": self._configuration.sender, "to": [recipient],
                                      "reply_to": self._configuration.reply_to, "subject": subject, "text": text, "html": rendered.html}
            if attachment:
                result["attachments"] = [attachment]
            return result
        sender_name, sender_email = parseaddr(self._configuration.sender)
        reply_name, reply_email = parseaddr(self._configuration.reply_to)
        result = {"From": {"Name": sender_name, "Email": sender_email}, "To": [{"Email": recipient}],
                  "ReplyTo": [{"Name": reply_name, "Email": reply_email}], "Subject": subject, "Text": text, "HTML": rendered.html,
                  "Headers": {"Message-ID": f"<partner-{job_id}@venfour.local>"}}
        if attachment:
            result["Attachments"] = [{"Filename": attachment["filename"], "Content": attachment["content"],
                                       "ContentType": "application/pdf"}]
        return result

    @staticmethod
    def _artifact_path(payload: Mapping[str, Any]) -> str:
        path = payload.get("object_path")
        if not isinstance(path, str):
            raise PartnerDocumentError("Agreement artifact identity is invalid")
        pieces = path.split("/")
        if len(pieces) != 5 or path != partner_document_path(pieces[1], payload.get("agreement_id")):
            raise PartnerDocumentError("Agreement artifact identity is invalid")
        if payload.get("bucket") != PARTNER_DOCUMENT_BUCKET:
            raise PartnerDocumentError("Agreement artifact bucket is invalid")
        return path

    def _validate_prepared_email(self, job_payload: Mapping[str, Any], request_payload: Mapping[str, Any], provider: str) -> None:
        recipient = _email(job_payload.get("recipient_email"))
        recipients = request_payload.get("to") if provider == "resend" else request_payload.get("To")
        expected = [recipient] if provider == "resend" else [{"Email": recipient}]
        if recipients != expected or any(key.lower() in {"cc", "bcc"} for key in request_payload):
            raise _DeliveryError("PARTNER_EMAIL_RECIPIENT_INVALID", requires_review=True)
        if job_payload.get("kind") == "agreement_copy":
            attachments = request_payload.get("attachments" if provider == "resend" else "Attachments")
            if not isinstance(attachments, list) or len(attachments) != 1:
                raise _DeliveryError("PARTNER_EMAIL_ATTACHMENT_INVALID", requires_review=True)
            encoded = attachments[0].get("content" if provider == "resend" else "Content")
            try:
                content = base64.b64decode(encoded, validate=True)
                actual = document_sha256(content)
                expected_digest = validated_digest(job_payload.get("sha256"))
                if not hmac.compare_digest(actual, expected_digest):
                    raise ValueError("Attachment digest mismatch")
            except (ValueError, TypeError):
                raise _DeliveryError("PARTNER_EMAIL_ATTACHMENT_INVALID", requires_review=True) from None
