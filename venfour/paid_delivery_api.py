"""Internal staff recovery endpoints; no jurisdiction approval endpoint."""

import json

from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse
from starlette.routing import Route

from venfour.supabase_gateway import SupabaseAuthenticationError, SupabaseGatewayError
from venfour.commerce import CommerceError


def response(body, status=200):
    return JSONResponse(body, status_code=status, headers={"Cache-Control": "no-store"})


async def paid_delivery_held_response(request, error):
    return response({"code": "PAID_DELIVERY_HELD"}, 409)


async def recovery(request):
    from uuid import UUID
    service = request.app.state.paid_delivery_recovery_service
    if service is None:
        return response({"code": "RECOVERY_UNAVAILABLE"}, 503)
    authorization = request.headers.get("authorization", "").split()
    if len(authorization) != 2 or authorization[0].lower() != "bearer":
        return response({"code": "AUTHENTICATION_REQUIRED"}, 401)
    token = authorization[1]
    try:
        case_id = request.path_params.get("case_id")
        after = request.query_params.get("after")
        for identifier in (case_id, after):
            if identifier is not None and (not isinstance(identifier, str) or str(UUID(identifier)) != identifier):
                raise ValueError("Invalid case identity")
        if request.method == "GET":
            rows = await run_in_threadpool(service.inspect, token, case_id, after)
            return response({"items": rows, "nextAfter": rows[-1]["case_id"] if len(rows) == 100 else None})
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 4096:
                raise ValueError("Recovery request is too large")
        payload = json.loads(body)
        if not isinstance(payload, dict) or set(payload) != {"action", "requestId"}:
            raise ValueError("Invalid recovery request")
        if not isinstance(payload["requestId"], str) or str(UUID(payload["requestId"])) != payload["requestId"]:
            raise ValueError("Invalid request identity")
        result = await run_in_threadpool(service.resolve, case_id, payload["action"], payload["requestId"], token)
        return response(result, 409 if result.get("state") == "held" else 200)
    except SupabaseAuthenticationError:
        return response({"code": "RECOVERY_AUTHORITY_REQUIRED"}, 403)
    except (ValueError, TypeError):
        return response({"code": "INVALID_RECOVERY_REQUEST"}, 400)
    except (SupabaseGatewayError, CommerceError):
        return response({"code": "RECOVERY_UNAVAILABLE"}, 503)


def paid_delivery_routes():
    return [
        Route("/api/v1/staff/paid-delivery-holds", recovery, methods=["GET"]),
        Route("/api/v1/staff/paid-delivery-holds/{case_id}", recovery, methods=["GET"]),
        Route("/api/v1/staff/paid-delivery-holds/{case_id}/resolve", recovery, methods=["POST"]),
    ]
