"""Authenticated referral-partner operations and private agreement storage."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping
from datetime import datetime
from typing import Any
from uuid import UUID

import httpx

from venfour.supabase_gateway import SupabaseHttpGateway


class PartnerError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


STAFF_ACTIONS = frozenset({
    "access", "staff_list", "staff_get", "staff_create", "staff_edit",
    "template_list", "template_save", "template_publish", "invite", "resend",
    "revoke", "countersign", "document_retry", "email_retry", "staff_agreement_document",
    "referral_summary", "referral_list", "link_state",
})
PARTNER_ACTIONS = frozenset({
    "access", "partner_list", "partner_get", "invitation_get", "invitation_accept",
    "profile_save", "agreement_prepare", "sign", "agreement_document",
    "referral_summary", "referral_list",
})
_REFERRAL_ACTIONS = frozenset({"referral_summary", "referral_list", "link_state"})
_OBJECT_PATH = re.compile(
    r"partners/([0-9a-f-]{36})/agreements/([0-9a-f-]{36})/signed\.pdf\Z"
)
MAX_PARTNER_PDF_BYTES = 10 * 1024 * 1024


def _uuid(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        return str(UUID(value)) == value
    except ValueError:
        return False


def _integer(value: Any, minimum: int = 0, maximum: int | None = None) -> bool:
    return type(value) is int and value >= minimum and (maximum is None or value <= maximum)


def _timestamp(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).tzinfo is not None
    except ValueError:
        return False


def _referral_payload(action: str, payload: Mapping[str, Any]) -> None:
    fields = {"partner_id"}
    if action == "referral_list":
        fields |= {"page", "page_size"}
    elif action == "link_state":
        fields |= {"expected_revision", "enabled", "request_id"}
    valid = set(payload) <= fields and _uuid(payload.get("partner_id"))
    if action == "referral_list":
        valid = valid and _integer(payload.get("page", 1), 1, 100000) and _integer(payload.get("page_size", 50), 1, 100)
    elif action == "link_state":
        valid = valid and _uuid(payload.get("request_id")) and _integer(payload.get("expected_revision"), 1) and type(payload.get("enabled")) is bool
    if not valid:
        raise PartnerError(400, "INVALID_PARTNER_REQUEST", "Check the referral record and requested action.")


def _referral_response(action: str, result: Any) -> Any:
    """Keep customer identity and underlying case/payment records outside this API."""
    valid = isinstance(result, Mapping)
    if valid and action == "referral_list":
        valid = (set(result) == {"items", "total", "page", "page_size"}
                 and isinstance(result.get("items"), list) and _integer(result.get("total"))
                 and _integer(result.get("page"), 1, 100000) and _integer(result.get("page_size"), 1, 100))
        if valid:
            valid = len(result["items"]) <= result["page_size"]
            for item in result["items"]:
                if not isinstance(item, Mapping):
                    valid = False
                    break
                purchased = item.get("purchased_at")
                valid = valid and (set(item) == {"id", "submitted_at", "purchased_at", "status"}
                                   and _uuid(item.get("id")) and _timestamp(item.get("submitted_at"))
                                   and isinstance(item.get("status"), str) and item["status"] in {"submitted", "purchased", "refunded", "under_review"}
                                   and (purchased is None if item.get("status") == "submitted" else _timestamp(purchased)))
    elif valid:
        summary = result.get("summary")
        link = result.get("link")
        valid = (set(result) == {"link", "summary"} and isinstance(summary, Mapping)
                 and set(summary) == {"submitted_count", "purchased_count", "refunded_count", "under_review_count"}
                 and all(_integer(value) for value in summary.values()))
        if link is not None:
            valid = (valid and isinstance(link, Mapping)
                     and set(link) == {"id", "code", "status", "revision", "created_at"}
                     and _uuid(link.get("id")) and isinstance(link.get("code"), str)
                     and re.fullmatch(r"[0-9a-f]{48}", link["code"]) is not None
                     and isinstance(link.get("status"), str) and link["status"] in {"active", "paused"}
                     and _integer(link.get("revision"), 1) and _timestamp(link.get("created_at")))
    if not valid:
        raise PartnerError(503, "PARTNER_UNAVAILABLE", "Referral records are temporarily unavailable.")
    return result


class PartnerGateway(SupabaseHttpGateway):
    """Use the caller's token for all interactive domain authorization."""

    def operation(self, action: str, payload: Mapping[str, Any], token: str) -> Any:
        try:
            response = self._client.post(
                f"{self._configuration.url}/rest/v1/rpc/referral_partner_operation",
                headers={**self._user_headers(token), "Content-Type": "application/json"},
                json={"p_action": action, "p_payload": dict(payload)},
            )
        except httpx.HTTPError as exc:
            raise PartnerError(503, "PARTNER_UNAVAILABLE", "Partner services are temporarily unavailable.") from exc
        if response.is_success:
            try:
                return response.json()
            except ValueError as exc:
                raise PartnerError(503, "PARTNER_UNAVAILABLE", "Partner services are temporarily unavailable.") from exc
        try:
            error = response.json()
        except ValueError:
            error = {}
        code = error.get("code") if isinstance(error, dict) else None
        if response.status_code == 401 or code == "28000":
            raise PartnerError(401, "AUTHENTICATION_REQUIRED", "Sign in with your verified invitation email.")
        if response.status_code == 403 or code == "42501":
            raise PartnerError(403, "PARTNER_ACCESS_DENIED", "You do not have access to this partner record.")
        if code in {"P0002", "02000"}:
            raise PartnerError(404, "PARTNER_NOT_FOUND", "This partner record or invitation is unavailable.")
        if code in {"40001", "55000", "23505"}:
            raise PartnerError(409, "PARTNER_CONFLICT", "This record changed or the invitation is no longer valid. Refresh and review it again.")
        if code in {"22023", "22P02", "23514", "23502"}:
            raise PartnerError(400, "INVALID_PARTNER_REQUEST", "Check the required details and confirmations.")
        raise PartnerError(503, "PARTNER_UNAVAILABLE", "Partner services are temporarily unavailable.")

    def worker(self, action: str, payload: Mapping[str, Any]) -> Any:
        return self._rpc("referral_partner_worker", {"p_action": action, "p_payload": dict(payload)})

    def _partner_object_url(self, object_path: str) -> str:
        match = _OBJECT_PATH.fullmatch(object_path)
        if match is None or any(str(UUID(part)) != part for part in match.groups()):
            raise PartnerError(500, "PARTNER_DOCUMENT_INVALID", "The agreement copy is unavailable.")
        return f"{self._configuration.url}/storage/v1/object/partner-agreements/{object_path}"

    def download_partner_document(self, object_path: str) -> bytes | None:
        url = self._partner_object_url(object_path)
        try:
            with self._client.stream("GET", url, headers=self._admin_headers()) as response:
                if response.status_code == 404:
                    return None
                if response.status_code == 400:
                    # Storage uses 400 for a missing object in some releases.
                    response.read()
                    try:
                        if str(response.json().get("statusCode")) == "404":
                            return None
                    except ValueError:
                        pass
                if response.status_code != 200:
                    raise PartnerError(503, "PARTNER_DOCUMENT_UNAVAILABLE", "The agreement copy is temporarily unavailable.")
                chunks, size = [], 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > MAX_PARTNER_PDF_BYTES:
                        raise PartnerError(500, "PARTNER_DOCUMENT_INVALID", "The agreement copy is unavailable.")
                    chunks.append(chunk)
                content = b"".join(chunks)
        except httpx.HTTPError as exc:
            raise PartnerError(503, "PARTNER_DOCUMENT_UNAVAILABLE", "The agreement copy is temporarily unavailable.") from exc
        if not content.startswith(b"%PDF-"):
            raise PartnerError(500, "PARTNER_DOCUMENT_INVALID", "The agreement copy is unavailable.")
        return content

    def store_partner_document(self, object_path: str, content: bytes) -> None:
        if not content.startswith(b"%PDF-") or len(content) > MAX_PARTNER_PDF_BYTES:
            raise ValueError("Invalid partner PDF")
        try:
            response = self._client.post(
                self._partner_object_url(object_path), content=content,
                headers={**self._admin_headers(), "Content-Type": "application/pdf", "x-upsert": "false"},
            )
        except httpx.HTTPError:
            if self.download_partner_document(object_path) == content:
                return
            raise
        if response.is_success:
            return
        if response.status_code in {400, 409} and self.download_partner_document(object_path) == content:
            return
        raise PartnerError(503, "PARTNER_DOCUMENT_UNAVAILABLE", "The agreement copy could not be stored.")


class PartnerService:
    def __init__(self, gateway: PartnerGateway, *, email_configured: bool = False) -> None:
        self.gateway = gateway
        self.email_configured = email_configured

    def operation(self, action: str, payload: Mapping[str, Any], token: str, *, staff: bool) -> Any:
        if action not in (STAFF_ACTIONS if staff else PARTNER_ACTIONS):
            raise PartnerError(400, "INVALID_PARTNER_REQUEST", "This partner action is unavailable.")
        if action in _REFERRAL_ACTIONS:
            _referral_payload(action, payload)
        if action in {"invite", "resend", "email_retry"} and not self.email_configured:
            # Check current authorization even when sending is disabled.
            access = self.gateway.operation("access", {}, token)
            if not isinstance(access, Mapping) or not access.get("is_partner_manager"):
                raise PartnerError(403, "PARTNER_ACCESS_DENIED", "Partner manager access is required.")
            raise PartnerError(503, "PARTNER_EMAIL_UNCONFIGURED", "Partner email sending is not configured.")
        database_action = f"staff_{action}" if staff and action in {"referral_summary", "referral_list"} else action
        result = self.gateway.operation(database_action, payload, token)
        if action in _REFERRAL_ACTIONS:
            return _referral_response(action, result)
        if action == "access" and isinstance(result, Mapping):
            result = {**result, "email_configured": self.email_configured}
        return result

    def document(self, agreement_id: str, token: str, *, staff: bool) -> bytes:
        try:
            if str(UUID(agreement_id)) != agreement_id:
                raise ValueError
        except ValueError as exc:
            raise PartnerError(400, "INVALID_PARTNER_REQUEST", "The agreement identifier is invalid.") from exc
        action = "staff_agreement_document" if staff else "agreement_document"
        locator = self.operation(action, {"agreement_id": agreement_id}, token, staff=staff)
        if not isinstance(locator, Mapping) or not isinstance(locator.get("object_path"), str):
            raise PartnerError(409, "PARTNER_DOCUMENT_PREPARING", "The agreement PDF is being prepared. The signed text remains available.")
        content = self.gateway.download_partner_document(locator["object_path"])
        if content is None or hashlib.sha256(content).hexdigest() != locator.get("sha256"):
            raise PartnerError(503, "PARTNER_DOCUMENT_UNAVAILABLE", "The agreement copy is temporarily unavailable.")
        return content
