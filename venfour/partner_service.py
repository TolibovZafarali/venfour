"""Authenticated referral-partner operations and private agreement storage."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping
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
})
PARTNER_ACTIONS = frozenset({
    "access", "partner_list", "partner_get", "invitation_get", "invitation_accept",
    "profile_save", "agreement_prepare", "sign", "agreement_document",
})
_OBJECT_PATH = re.compile(
    r"partners/([0-9a-f-]{36})/agreements/([0-9a-f-]{36})/signed\.pdf\Z"
)
MAX_PARTNER_PDF_BYTES = 10 * 1024 * 1024


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
        if action in {"invite", "resend", "email_retry"} and not self.email_configured:
            # Check current authorization even when sending is disabled.
            access = self.gateway.operation("access", {}, token)
            if not isinstance(access, Mapping) or not access.get("is_partner_manager"):
                raise PartnerError(403, "PARTNER_ACCESS_DENIED", "Partner manager access is required.")
            raise PartnerError(503, "PARTNER_EMAIL_UNCONFIGURED", "Partner email sending is not configured.")
        result = self.gateway.operation(action, payload, token)
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
