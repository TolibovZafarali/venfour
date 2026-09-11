"""Shared sender configuration and provider transport; no customer workflow logic."""

from __future__ import annotations

from dataclasses import dataclass, field
from email.utils import parseaddr
from typing import Any, Mapping
from urllib.parse import urlsplit

import httpx

from venfour.email_templates import RenderedEmail


def email_address(value: str, *, display_name: bool = False) -> str:
    if not isinstance(value, str) or not value or len(value) > 320 or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError("Email address is invalid")
    name, address = parseaddr(value)
    if address.count("@") != 1 or not all(address.split("@")) or any(c.isspace() for c in address):
        raise ValueError("Email address is invalid")
    if not display_name and (name or value != address):
        raise ValueError("Email address is invalid")
    return value


def trusted_origin(value: str, *, local_only: bool = False) -> str:
    parsed = urlsplit(value)
    local = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if (not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in {"", "/"} or any(ord(c) < 33 for c in value)
            or (local_only and not local) or parsed.scheme not in ({"http", "https"} if local else {"https"})):
        raise ValueError("Email origin configuration is invalid")
    return value.rstrip("/")


@dataclass(frozen=True)
class EmailConfiguration:
    provider: str = "disabled"
    mode: str = "disabled"
    app_origin: str = ""
    api_origin: str = ""
    sender: str = ""
    reply_to: str = ""
    auth_sender: str = ""
    auth_reply_to: str = ""
    partner_sender: str = ""
    partner_reply_to: str = ""
    api_key: str = field(default="", repr=False)
    hook_secret: str = field(default="", repr=False)
    webhook_secret: str = field(default="", repr=False)
    dispatch_secret: str = field(default="", repr=False)
    allowlist: tuple[str, ...] = field(default=(), repr=False)
    mailpit_origin: str = "http://127.0.0.1:54324"
    auth_enabled: bool = False

    @classmethod
    def from_environment(cls, env: Mapping[str, str]):
        return cls(provider=env.get("VENFOUR_EMAIL_PROVIDER", "disabled"),
                   mode=env.get("VENFOUR_EMAIL_MODE", "disabled"),
                   app_origin=env.get("VENFOUR_PUBLIC_APP_ORIGIN", ""),
                   api_origin=env.get("VENFOUR_EMAIL_PUBLIC_API_ORIGIN", ""),
                   sender=env.get("VENFOUR_EMAIL_FROM", ""), reply_to=env.get("VENFOUR_EMAIL_REPLY_TO", ""),
                   auth_sender=env.get("VENFOUR_AUTH_EMAIL_FROM", ""), auth_reply_to=env.get("VENFOUR_AUTH_EMAIL_REPLY_TO", ""),
                   partner_sender=env.get("VENFOUR_PARTNER_EMAIL_FROM", ""), partner_reply_to=env.get("VENFOUR_PARTNER_EMAIL_REPLY_TO", ""),
                   api_key=env.get("RESEND_API_KEY", ""), hook_secret=env.get("VENFOUR_AUTH_EMAIL_HOOK_SECRET", ""),
                   webhook_secret=env.get("RESEND_WEBHOOK_SECRET", ""), dispatch_secret=env.get("VENFOUR_EMAIL_DISPATCH_SECRET", ""),
                   allowlist=tuple(x.strip().lower() for x in env.get("VENFOUR_EMAIL_TEST_RECIPIENTS", "").split(",") if x.strip()),
                   mailpit_origin=env.get("VENFOUR_EMAIL_MAILPIT_ORIGIN", "http://127.0.0.1:54324"),
                   auth_enabled=env.get("VENFOUR_AUTH_EMAIL_HOOK_ENABLED", "0") == "1")

    def identity(self, name="customer"):
        sender = getattr(self, f"{name}_sender", "") if name != "customer" else ""
        reply = getattr(self, f"{name}_reply_to", "") if name != "customer" else ""
        return email_address(sender or self.sender, display_name=True), email_address(reply or self.reply_to, display_name=True)

    def validate(self):
        if self.provider not in {"disabled", "resend", "mailpit"} or self.mode not in {"disabled", "dry_run", "allowlist", "live"}:
            raise ValueError("Email configuration is invalid")
        if self.provider == "disabled":
            if self.auth_enabled:
                raise ValueError("Auth email transport is disabled")
            return
        trusted_origin(self.app_origin, local_only=self.provider == "mailpit")
        trusted_origin(self.api_origin, local_only=self.provider == "mailpit")
        self.identity()
        self.identity("auth")
        if self.provider == "resend" and not self.api_key:
            raise ValueError("Email credential is required")
        if self.provider == "mailpit":
            trusted_origin(self.mailpit_origin, local_only=True)
        for address in self.allowlist:
            email_address(address)
        if self.mode == "allowlist" and not self.allowlist:
            raise ValueError("Test recipients are required")
        if self.mode != "disabled" and (not 32 <= len(self.dispatch_secret) <= 512 or not self.dispatch_secret.isascii() or any(c.isspace() for c in self.dispatch_secret)):
            raise ValueError("Email dispatcher configuration is required")
        if self.auth_enabled and (not self.hook_secret or self.mode not in {"allowlist", "live"}):
            raise ValueError("Auth hook requires an active delivery mode and signature secret")

    def may_send(self, recipient: str, *, auth=False) -> bool:
        if self.provider == "disabled" or self.mode in {"disabled", "dry_run"}:
            return False
        return self.mode == "live" or recipient.lower() in self.allowlist


class EmailDeliveryError(Exception):
    def __init__(self, code: str, *, requires_review=False):
        super().__init__(code)
        self.code, self.requires_review = code, requires_review


def email_payload(rendered: RenderedEmail, *, recipient: str, sender: str, reply_to: str,
                  provider: str, message_key: str, unsubscribe_url: str = "") -> dict[str, Any]:
    email_address(recipient)
    email_address(sender, display_name=True)
    email_address(reply_to, display_name=True)
    headers = {"X-Entity-Ref-ID": message_key}
    if unsubscribe_url:
        headers.update({"List-Unsubscribe": f"<{unsubscribe_url}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"})
    if provider == "resend":
        return {"from": sender, "reply_to": reply_to, "to": [recipient], "subject": rendered.subject,
                "html": rendered.html, "text": rendered.text, "headers": headers}
    if provider != "mailpit":
        raise EmailDeliveryError("EMAIL_DISABLED")
    name, address = parseaddr(sender)
    reply_name, reply_address = parseaddr(reply_to)
    headers["Message-ID"] = f"<{message_key.replace('/', '-')}@venfour.local>"
    return {"From": {"Name": name, "Email": address}, "ReplyTo": [{"Name": reply_name, "Email": reply_address}],
            "To": [{"Email": recipient}], "Subject": rendered.subject, "HTML": rendered.html, "Text": rendered.text, "Headers": headers}


def send_prepared(client: httpx.Client, *, provider: str, payload: Mapping[str, Any],
                  key: str, api_key: str = "", mailpit_origin="http://127.0.0.1:54324",
                  timeout: float | httpx.Timeout = 20) -> str:
    try:
        if provider == "resend":
            response = client.post("https://api.resend.com/emails", json=dict(payload),
                                   headers={"Authorization": f"Bearer {api_key}", "Idempotency-Key": key}, timeout=timeout)
        elif provider == "mailpit":
            origin = trusted_origin(mailpit_origin, local_only=True)
            message_id = payload.get("Headers", {}).get("Message-ID", "").strip("<>")
            if not message_id:
                raise EmailDeliveryError("EMAIL_MESSAGE_ID_REQUIRED", requires_review=True)
            search = client.get(f"{origin}/api/v1/search", params={"query": f"message-id:{message_id}", "limit": 2}, timeout=timeout)
            search.raise_for_status()
            messages = search.json().get("messages", [])
            if messages:
                return str(messages[0]["ID"])
            response = client.post(f"{origin}/api/v1/send", json=dict(payload), timeout=timeout)
        else:
            raise EmailDeliveryError("EMAIL_DISABLED", requires_review=True)
    except (httpx.HTTPError, ValueError, KeyError):
        raise EmailDeliveryError("EMAIL_PROVIDER_UNCERTAIN") from None
    if not response.is_success:
        try:
            name = response.json().get("name")
        except (ValueError, AttributeError):
            name = None
        retryable = response.status_code >= 500 or response.status_code in {408, 425, 429} or (response.status_code == 409 and name == "concurrent_idempotent_requests")
        raise EmailDeliveryError("EMAIL_PROVIDER_REJECTED", requires_review=not retryable)
    try:
        message_id = response.json().get("id" if provider == "resend" else "ID")
        if not isinstance(message_id, str) or not 0 < len(message_id) <= 256:
            raise ValueError()
    except (ValueError, AttributeError):
        raise EmailDeliveryError("EMAIL_PROVIDER_UNCERTAIN") from None
    return message_id
