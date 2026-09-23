"""Authenticated product facts; existing delivery and checkout authority stay separate."""

from datetime import UTC, datetime
import json
from uuid import UUID

from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse
from starlette.routing import Route

from venfour.jurisdiction import CaseFacts
from venfour.nationwide_product import configurations, enabled, product_context
from venfour.supabase_gateway import SupabaseAuthenticationError, SupabaseConflictError, SupabaseGatewayError


def response(body, status=200):
    return JSONResponse(body, status_code=status, headers={"Cache-Control": "no-store"})


async def case_product(request):
    if not enabled():
        return response({"code": "PRODUCT_NOT_ENABLED"}, 404)
    gateway = request.app.state.nationwide_product_gateway
    if gateway is None:
        return response({"code": "PRODUCT_UNAVAILABLE"}, 503)
    authorization = request.headers.get("authorization", "").split()
    if len(authorization) != 2 or authorization[0].lower() != "bearer":
        return response({"code": "AUTHENTICATION_REQUIRED"}, 401)
    token = authorization[1]
    staff = request.url.path.startswith("/api/v1/staff/")
    try:
        case_id = request.path_params["case_id"]
        if str(UUID(case_id)) != case_id:
            raise ValueError("Invalid case identity")
        if request.method == "POST":
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 32768:
                    raise ValueError("Fact request too large")
            payload = json.loads(body)
            if not isinstance(payload, dict) or set(payload) != {"expected_revision", "facts"}:
                raise ValueError("Invalid fact request")
            revision = payload["expected_revision"]
            if type(revision) is not int or revision < 0:
                raise ValueError("Invalid revision")
            facts = CaseFacts.from_dict(payload["facts"])
            if len(facts.assertions) > 64 or any(a.provenance not in {"customer", "document"} for a in facts.assertions):
                raise ValueError("Invalid customer provenance")
            await run_in_threadpool(gateway.append_product_facts, token, case_id, revision, facts.to_dict())
        context = await run_in_threadpool(gateway.get_case_product_facts, token, case_id, staff)
        product = product_context(context, as_of=datetime.now(UTC).date().isoformat())
        return response({"context": product, "delivery": context.get("delivery") if staff else None,
                         "locations": [{"code": code, "name": row.name} for code, row in configurations().items()]})
    except SupabaseAuthenticationError:
        return response({"code": "CASE_ACCESS_REQUIRED"}, 403)
    except SupabaseConflictError:
        return response({"code": "FACTS_CHANGED_RELOAD_REQUIRED"}, 409)
    except (ValueError, TypeError, KeyError):
        return response({"code": "INVALID_PRODUCT_FACTS"}, 400)
    except SupabaseGatewayError:
        return response({"code": "PRODUCT_UNAVAILABLE"}, 503)


def nationwide_product_routes():
    return [Route("/api/v1/appraisal-cases/{case_id}/product", case_product, methods=["GET", "POST"]),
            Route("/api/v1/staff/appraisal-cases/{case_id}/product", case_product, methods=["GET"])]
