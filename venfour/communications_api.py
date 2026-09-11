"""Private staff controls and narrowly authenticated delivery endpoints."""
from __future__ import annotations

import json
import re
from hmac import compare_digest

from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse
from starlette.routing import Route

from venfour.communications import CommunicationError


def private(response):
    response.headers.update({"Cache-Control": "no-store, private", "Pragma": "no-cache", "Referrer-Policy": "no-referrer",
                             "X-Content-Type-Options": "nosniff"})
    return response


def service(request):
    instance = request.app.state.communication_service
    if instance is None:
        raise CommunicationError()
    return instance


def token(request):
    headers = request.headers.getlist("authorization")
    if len(headers) != 1 or not headers[0].startswith("Bearer ") or not headers[0][7:].strip():
        raise CommunicationError(401, "AUTHENTICATION_REQUIRED")
    return headers[0][7:]


async def body(request, maximum=16384):
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > maximum:
            raise CommunicationError(413, "EMAIL_REQUEST_TOO_LARGE")
    return bytes(content)


def error_response(error):
    status = error.status if isinstance(error, CommunicationError) else 503
    code = error.code if isinstance(error, CommunicationError) else "COMMUNICATIONS_UNAVAILABLE"
    # Never return provider exception bodies, SQL, addresses, tokens or secrets.
    return private(JSONResponse({"error": {"code": code, "message": "Email operation could not be completed."}}, status_code=status))


async def staff(request: Request):
    try:
        instance, access_token = service(request), token(request)
        if request.method == "GET":
            return private(JSONResponse(await run_in_threadpool(instance.overview, access_token)))
        data = json.loads(await body(request))
        if not isinstance(data, dict) or set(data) != {"action", "payload"} or not isinstance(data["payload"], dict):
            raise CommunicationError(400, "INVALID_COMMUNICATION_REQUEST")
        action, payload = data["action"], data["payload"]
        if action == "preview" and set(payload) == {"template_key"}:
            result = await run_in_threadpool(instance.preview, payload["template_key"], access_token)
        elif action == "test_send" and set(payload) == {"template_key", "request_id"}:
            result = await run_in_threadpool(instance.test_send, payload["template_key"], payload["request_id"], access_token)
        elif action in {"settings", "automation", "plan"}:
            fields = {"settings": {"mode", "revision"}, "automation": {"template_key", "enabled", "delay_seconds", "revision"}, "plan": set()}
            if set(payload) != fields[action]:
                raise CommunicationError(400, "INVALID_COMMUNICATION_REQUEST")
            result = await run_in_threadpool(instance.gateway.staff, action, payload, access_token)
        else:
            raise CommunicationError(400, "INVALID_COMMUNICATION_REQUEST")
        return private(JSONResponse(result))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return error_response(CommunicationError(400, "INVALID_COMMUNICATION_REQUEST"))
    except Exception as error:
        return error_response(error)


async def dispatch(request):
    try:
        instance = service(request)
        expected = instance.config.dispatch_secret
        if not expected or not compare_digest(token(request), expected):
            raise CommunicationError(401, "AUTHENTICATION_REQUIRED")
        if await body(request, 2) not in {b"", b"{}"}:
            raise CommunicationError(400, "INVALID_COMMUNICATION_REQUEST")
        return private(JSONResponse(await run_in_threadpool(instance.dispatch)))
    except Exception as error:
        return error_response(error)


async def auth_hook(request):
    try:
        instance = service(request)
        content = await body(request, 65536)
        for name in ("webhook-id", "webhook-signature", "webhook-timestamp"):
            if len(request.headers.getlist(name)) != 1:
                raise CommunicationError(401, "EMAIL_SIGNATURE_INVALID")
        records = await run_in_threadpool(instance.auth_hook, content, request.headers)
        return private(JSONResponse({}, background=BackgroundTask(instance.record_auth_results, records)))
    except Exception as error:
        status = error.status if isinstance(error, CommunicationError) else 503
        return private(JSONResponse({"error": {"http_code": status, "message": "Authentication email is temporarily unavailable."}}, status_code=status))


async def webhook(request):
    try:
        instance = service(request)
        content = await body(request, 65536)
        for name in ("svix-id", "svix-signature", "svix-timestamp"):
            if len(request.headers.getlist(name)) != 1:
                raise CommunicationError(401, "EMAIL_SIGNATURE_INVALID")
        return private(JSONResponse(await run_in_threadpool(instance.webhook, content, request.headers)))
    except Exception as error:
        return error_response(error)


async def preferences(request):
    try:
        value = request.path_params["preference_token"]
        if not re.fullmatch(r"[0-9a-f]{64}", value):
            raise CommunicationError(400, "INVALID_COMMUNICATION_REQUEST")
        content = "<p>Stop optional reminders about your Venfour cases. Essential messages you request will continue.</p><form method='post'><button type='submit'>Stop optional reminders</button></form>"
        if request.method == "POST":
            await body(request, 128)
            await run_in_threadpool(service(request).gateway.worker, "unsubscribe", {"token": value})
            content = "<p>Your request has been recorded. Optional case reminders will stop for any matching email subscription. Essential messages you request will continue.</p>"
        response = HTMLResponse("<!doctype html><html lang='en'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Venfour email preferences</title><body style='margin:48px auto;padding:24px;max-width:520px;font:17px/1.6 Arial;color:#172741'><h1>Email preferences</h1>" + content + "</body></html>")
        response.headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
        return private(response)
    except Exception as error:
        return error_response(error)


def communication_routes():
    return [Route("/api/v1/staff/communications", staff, methods=["GET", "POST"]),
            Route("/internal/v1/communications/dispatch", dispatch, methods=["POST"]),
            Route("/hooks/auth/email", auth_hook, methods=["POST"]),
            Route("/webhooks/resend", webhook, methods=["POST"]),
            Route("/emails/preferences/{preference_token}", preferences, methods=["GET", "POST"])]
