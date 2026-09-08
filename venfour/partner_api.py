"""Narrow HTTP routes for referral onboarding and retained agreement copies."""

from __future__ import annotations

import json
from hmac import compare_digest

from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from venfour.partner_service import PartnerError


def validated_partner_dispatch_secret(value: str | None) -> str | None:
    """Disable partner dispatch when its private credential is incomplete or unsafe."""
    if (not isinstance(value, str) or not 32 <= len(value) <= 512
            or not value.isascii() or any(char.isspace() or ord(char) < 33 or ord(char) == 127 for char in value)):
        return None
    return value


def _private(response: Response) -> Response:
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def _error(error: Exception) -> Response:
    if not isinstance(error, PartnerError):
        error = PartnerError(503, "PARTNER_UNAVAILABLE", "Partner services are temporarily unavailable.")
    return _private(JSONResponse({"error": {"code": error.code, "message": error.message}}, status_code=error.status))


def _token(request: Request) -> str:
    values = request.headers.getlist("authorization")
    if len(values) != 1:
        raise PartnerError(401, "AUTHENTICATION_REQUIRED", "Sign in to continue.")
    scheme, _, token = values[0].partition(" ")
    if scheme.lower() != "bearer" or not token or any(char.isspace() for char in token):
        raise PartnerError(401, "AUTHENTICATION_REQUIRED", "Sign in to continue.")
    return token


async def _body(request: Request, maximum: int = 131072) -> dict:
    if request.headers.get("content-type", "").partition(";")[0].strip().lower() != "application/json":
        raise PartnerError(400, "INVALID_PARTNER_REQUEST", "A JSON request is required.")
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > maximum:
            raise PartnerError(413, "PARTNER_REQUEST_TOO_LARGE", "This request is too large.")
    try:
        payload = json.loads(content)
    except (ValueError, UnicodeDecodeError) as exc:
        raise PartnerError(400, "INVALID_PARTNER_REQUEST", "The request is invalid.") from exc
    if not isinstance(payload, dict):
        raise PartnerError(400, "INVALID_PARTNER_REQUEST", "The request is invalid.")
    return payload


async def dispatch_partner_work(service: object) -> None:
    # The scheduled dispatcher is authoritative; this reduces interactive latency.
    try:
        await run_in_threadpool(service.dispatch)
    except Exception:
        pass


async def partner_operation(request: Request) -> Response:
    try:
        token = _token(request)
        service = request.app.state.partner_service
        if service is None:
            raise PartnerError(503, "PARTNER_UNAVAILABLE", "Partner services are temporarily unavailable.")
        staff = request.url.path.startswith("/api/v1/staff/")
        if request.method == "GET":
            action, payload = "access", {}
        else:
            body = await _body(request)
            if set(body) != {"action", "payload"} or not isinstance(body["action"], str) or not isinstance(body["payload"], dict):
                raise PartnerError(400, "INVALID_PARTNER_REQUEST", "The request is invalid.")
            action, payload = body["action"], body["payload"]
        result = await run_in_threadpool(service.operation, action, payload, token, staff=staff)
        delivery = request.app.state.partner_delivery_service
        background = (
            BackgroundTask(dispatch_partner_work, delivery)
            if delivery is not None and action in {"invite", "resend", "countersign", "document_retry", "email_retry"}
            else None
        )
        return _private(JSONResponse(result, background=background))
    except Exception as exc:
        return _error(exc)


async def partner_document(request: Request) -> Response:
    try:
        token = _token(request)
        service = request.app.state.partner_service
        if service is None:
            raise PartnerError(503, "PARTNER_UNAVAILABLE", "Partner services are temporarily unavailable.")
        content = await run_in_threadpool(
            service.document, request.path_params["agreement_id"], token,
            staff=request.url.path.startswith("/api/v1/staff/"),
        )
        return _private(Response(content, media_type="application/pdf", headers={
            "Content-Disposition": 'attachment; filename="Venfour-Referral-Partner-Agreement.pdf"',
        }))
    except Exception as exc:
        return _error(exc)


async def partner_dispatch(request: Request) -> Response:
    try:
        secret = validated_partner_dispatch_secret(request.app.state.partner_dispatch_secret)
        if not secret or not compare_digest(_token(request), secret):
            raise PartnerError(401, "AUTHENTICATION_REQUIRED", "Dispatcher authentication is required.")
        content = bytearray()
        async for chunk in request.stream():
            content.extend(chunk)
            if len(content) > 2:
                raise PartnerError(400, "INVALID_PARTNER_REQUEST", "The dispatcher request must be empty.")
        if bytes(content) not in {b"", b"{}"}:
            raise PartnerError(400, "INVALID_PARTNER_REQUEST", "The dispatcher request must be empty.")
        service = request.app.state.partner_delivery_service
        if service is None:
            raise PartnerError(503, "PARTNER_UNAVAILABLE", "Partner services are temporarily unavailable.")
        result = await run_in_threadpool(service.dispatch)
        return _private(JSONResponse(result))
    except Exception as exc:
        return _error(exc)


def partner_routes() -> list[Route]:
    routes = []
    for prefix in ("/api/v1/partners", "/api/v1/staff/referral-partners"):
        routes.extend([
            Route(f"{prefix}/access", partner_operation, methods=["GET"]),
            Route(f"{prefix}/operations", partner_operation, methods=["POST"]),
            Route(f"{prefix}/agreements/{{agreement_id}}/document", partner_document, methods=["GET"]),
        ])
    routes.append(Route("/internal/v1/referral-partners/dispatch", partner_dispatch, methods=["POST"]))
    return routes
