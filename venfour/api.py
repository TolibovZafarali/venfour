"""HTTP creation and presentation boundaries for Venfour analyses.

The presentation route remains a read-only projection over persisted artifacts.
The collection route validates a bounded temporary upload and delegates all
creation work to an application service. Application dependencies are selected
by :func:`create_app`; this module has no process-global service instance.
"""

from __future__ import annotations

import json
import os
import tempfile
from collections.abc import Mapping
from contextlib import asynccontextmanager
from hmac import compare_digest
from ipaddress import ip_address
from pathlib import Path
from typing import Any, Awaitable, Callable
from uuid import UUID

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.types import ASGIApp, Receive, Scope, Send

from scripts.extract_report_ai import MAX_PDF_BYTES
from venfour.analysis_runs import (
    DEFAULT_ANALYSIS_RUN_DIR,
    AnalysisRunContractError,
    AnalysisRunNotFoundError,
    AnalysisRunRepository,
    AnalysisRunRepositoryError,
    AnalysisRunValidationUnavailableError,
    FileAnalysisRunRepository,
    InvalidAnalysisRunArtifactError,
)
from venfour.creation import (
    AnalysisCreationExecutionError,
    AnalysisCreationInputError,
    AnalysisCreationProviderError,
    AnalysisCreationUnavailableError,
    AnalysisExtractionError,
    AnalysisReportValidationError,
    AnalysisUnsupportedReportError,
    create_live_analysis_creation_service,
)
from venfour.case_analyses import (
    CaseAnalysisConflictError,
    CaseAnalysisContractError,
    CaseAnalysisInputError,
    CaseAnalysisNotFoundError,
    CaseAnalysisService,
    CaseAnalysisUnavailableError,
)
from venfour.case_claim_access import (
    CaseClaimAccessConflictError,
    CaseClaimAccessError,
    CaseClaimAccessGateway,
    CaseClaimAccessInputError,
    CaseClaimAccessNotFoundError,
    CaseClaimAccessService,
    CaseClaimAccessUnavailableError,
    CaseClaimRecoveryConfiguration,
    CloudflareTurnstileVerifier,
    TurnstileRejectedError,
)
from venfour.commerce import (
    MAX_STRIPE_WEBHOOK_BODY_BYTES,
    CommerceConflictError,
    CommerceDatabaseGateway,
    CommerceError,
    CommerceInputError,
    CommerceNotFoundError,
    CommerceProviderError,
    CommerceUnavailableError,
    CommerceWebhookSignatureError,
    StripeCommerceConfiguration,
    StripeSdkGateway,
    TotalLossCommerceService,
)
from venfour.openai_vehicle_catalog import OpenAIVehicleTrimCatalog
from venfour.package_processing import (
    CloudTasksConfiguration,
    CloudTasksWorkItemDispatcher,
    GoogleOidcInternalCallerVerifier,
    InternalCallerAuthenticationError,
    InternalCallerVerifier,
    InternalOidcConfiguration,
    PackageExecutionResult,
    PackageProcessingContractError,
    PackageProcessingDatabaseGateway,
    PackageProcessingInputError,
    PackageProcessingUnavailableError,
    PackageRetryLaterError,
    PackageStaleFenceError,
    PackageWorkBusyError,
    TotalLossPackageCoordinator,
    TotalLossPackageProcessor,
)
from venfour.presentation import (
    AnalysisPresentationContractError,
    AnalysisPresentationService,
)
from venfour.postal_codes import normalize_us_zip_code
from venfour.supabase_gateway import (
    CaseAnalysisGateway,
    SupabaseAuthenticationError,
    SupabaseConfigurationError,
    SupabaseContractError,
    SupabaseHttpGateway,
    SupabaseServerConfiguration,
    SupabaseUnavailableError,
)
from venfour.vehicle_catalog import (
    MAX_VEHICLE_TRIM_OPTIONS,
    VehicleTrimCatalogRequest,
    VehicleTrimOption,
)


_ERROR_MESSAGES = {
    "AUTHENTICATION_REQUIRED": "Authentication is required.",
    "AUTHENTICATION_INVALID": "Authentication is invalid.",
    "AUTHENTICATION_UNAVAILABLE": "Authentication is temporarily unavailable.",
    "INVALID_CASE_ID": "Appraisal case ID is invalid.",
    "INVALID_RUN_ID": "Analysis run ID is invalid.",
    "CASE_NOT_FOUND": "Appraisal case was not found.",
    "ANALYSIS_NOT_FOUND": "Analysis run was not found.",
    "ANALYSIS_UNAVAILABLE": "Analysis run is unavailable.",
    "INTERNAL_ERROR": "An internal server error occurred.",
    "ROUTE_NOT_FOUND": "Route was not found.",
    "METHOD_NOT_ALLOWED": "Method is not allowed.",
    "UNSUPPORTED_MEDIA_TYPE": "Content type must be multipart/form-data.",
    "INVALID_MULTIPART_REQUEST": "Analysis creation request is invalid.",
    "REPORT_REQUIRED": "A valuation report is required.",
    "POSTAL_CODE_REQUIRED": "A postalCode is required.",
    "INVALID_POSTAL_CODE": (
        "postalCode must be a 5-digit US ZIP code or ZIP+4."
    ),
    "INVALID_REPORT": "Uploaded report is invalid.",
    "REPORT_TOO_LARGE": "Uploaded report is too large.",
    "REPORT_EXTRACTION_FAILED": "Uploaded report could not be extracted.",
    "REPORT_NOT_ANALYZABLE": "Uploaded report could not be analyzed.",
    "UNSUPPORTED_REPORT": (
        "This valuation report could not be processed automatically. "
        "Continue by confirming the available details manually."
    ),
    "MARKET_PROVIDER_UNAVAILABLE": "Market evidence is temporarily unavailable.",
    "ANALYSIS_CREATION_UNAVAILABLE": "Analysis creation is unavailable.",
    "ANALYSIS_CREATION_FAILED": "Analysis could not be created.",
    "INVALID_ANALYSIS_REQUEST": "Analysis request must not contain a body.",
    "REPORT_INTAKE_REQUIRED": "Complete report intake before starting analysis.",
    "REPORT_INTAKE_NOT_READY": "Report intake is not ready for analysis.",
    "CASE_NOT_READY": "Appraisal case is not ready for analysis.",
    "INVALID_VEHICLE_TRIM_REQUEST": (
        "Choose a valid vehicle year, make, and model."
    ),
    "VEHICLE_TRIM_LOOKUP_UNAVAILABLE": (
        "Vehicle trims are temporarily unavailable. Try again."
    ),
    "STAGING_PROXY_REQUIRED": "Staging API access is unavailable.",
    "INVALID_CLAIM_ACCESS_REQUEST": "Claim access request is invalid.",
    "CLAIM_ACCESS_CONFLICT": (
        "This claim cannot be secured from the current account state."
    ),
    "CLAIM_ACCESS_UNAVAILABLE": "Secure claim access is temporarily unavailable.",
    "SECURITY_CHECK_FAILED": "Security check failed. Please try again.",
    "INVALID_COMMERCE_REQUEST": "Commerce request is invalid.",
    "COMMERCE_CONFLICT": "Checkout is unavailable for this case state.",
    "COMMERCE_UNAVAILABLE": "Commerce is temporarily unavailable.",
    "INVALID_STRIPE_WEBHOOK": "Stripe webhook verification failed.",
    "STRIPE_WEBHOOK_TOO_LARGE": "Stripe webhook payload is too large.",
    "INVALID_WORK_ITEM_ID": "Work item ID is invalid.",
    "INVALID_INTERNAL_WORK_REQUEST": "Internal work request is invalid.",
    "INTERNAL_AUTHENTICATION_REQUIRED": (
        "Internal caller authentication is required."
    ),
    "PACKAGE_PROCESSING_UNAVAILABLE": (
        "Package processing is temporarily unavailable."
    ),
    "PACKAGE_PROCESSING_FAILED": "Package processing failed safely.",
}

LEGACY_API_ENVIRONMENT_NAME = "VENFOUR_ENABLE_LEGACY_ANALYSIS_API"
STAGING_PROXY_SECRET_ENVIRONMENT_NAME = "VENFOUR_STAGING_PROXY_SECRET"
STAGING_PROXY_HEADER_NAME = b"x-venfour-staging-proxy"
PUBLIC_APP_ORIGIN_ENVIRONMENT_NAME = "VENFOUR_PUBLIC_APP_ORIGIN"
TURNSTILE_SECRET_ENVIRONMENT_NAME = "VENFOUR_TURNSTILE_SECRET"
RECOVERY_RATE_SECRET_ENVIRONMENT_NAME = (
    "VENFOUR_CLAIM_RECOVERY_RATE_LIMIT_SECRET"
)

MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024
MAX_UPLOAD_BODY_BYTES = MAX_PDF_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
MAX_MULTIPART_FIELD_BYTES = 1024
UPLOAD_COPY_CHUNK_BYTES = 1024 * 1024
MAX_CLAIM_RECOVERY_BODY_BYTES = 8 * 1024
MAX_COMMERCE_REQUEST_BODY_BYTES = 8 * 1024

_ANALYSIS_UNAVAILABLE_ERRORS = (
    InvalidAnalysisRunArtifactError,
    AnalysisRunRepositoryError,
    AnalysisRunValidationUnavailableError,
    AnalysisRunContractError,
    AnalysisPresentationContractError,
)


class _RequestBodyTooLarge(Exception):
    pass


class _InvalidMultipartRequest(Exception):
    pass


class _ReportRequired(_InvalidMultipartRequest):
    pass


class _PostalCodeRequired(_InvalidMultipartRequest):
    pass


class _InvalidPostalCode(_InvalidMultipartRequest):
    pass


class _InvalidUploadedReport(Exception):
    pass


class _UploadedReportTooLarge(Exception):
    pass


class _UploadInfrastructureError(Exception):
    pass


class _StagingProxyGuardMiddleware:
    """Require the server-only staging proxy credential on customer API routes."""

    def __init__(self, app: ASGIApp, *, secret: str) -> None:
        self._app = app
        self._secret = secret.encode("ascii")

    async def __call__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        path = scope.get("path", "")
        if scope["type"] == "http" and (
            path.startswith("/api/") or path == "/webhooks/stripe"
        ):
            values = [
                value
                for name, value in scope.get("headers", ())
                if name == STAGING_PROXY_HEADER_NAME
            ]
            if len(values) != 1 or not compare_digest(values[0], self._secret):
                response = _private_response(
                    _error_response(403, "STAGING_PROXY_REQUIRED")
                )
                await response(scope, receive, send)
                return
        await self._app(scope, receive, send)


def _validated_staging_proxy_secret(value: str | None) -> str | None:
    if value is None:
        return None
    if (
        not isinstance(value, str)
        or not (32 <= len(value) <= 512)
        or any(
            character.isspace()
            or ord(character) < 32
            or ord(character) == 127
            or ord(character) > 126
            for character in value
        )
    ):
        raise ValueError("staging proxy secret configuration is invalid")
    return value


def _error_response(
    status_code: int,
    code: str,
    *,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        {
            "error": {
                "code": code,
                "message": _ERROR_MESSAGES[code],
            }
        },
        status_code=status_code,
        headers=headers,
    )


def _private_response(response: JSONResponse) -> JSONResponse:
    response.headers["Cache-Control"] = "private, no-store"
    return response


def _is_canonical_uuid4(value: str) -> bool:
    try:
        parsed = UUID(value)
    except (AttributeError, TypeError, ValueError):
        return False
    return parsed.version == 4 and str(parsed) == value


def _bounded_receive(
    receive: Callable[[], Awaitable[dict[str, Any]]],
    maximum_bytes: int,
) -> Callable[[], Awaitable[dict[str, Any]]]:
    received_bytes = 0

    async def limited_receive() -> dict[str, Any]:
        nonlocal received_bytes
        message = await receive()
        if message.get("type") == "http.request":
            body = message.get("body", b"")
            received_bytes += len(body)
            if received_bytes > maximum_bytes:
                raise _RequestBodyTooLarge
        return message

    return limited_receive


def _multipart_values(form: Any) -> tuple[UploadFile, str]:
    items = list(form.multi_items())
    reports = [value for name, value in items if name == "report"]
    postal_codes = [value for name, value in items if name == "postalCode"]
    if any(name not in {"report", "postalCode"} for name, _value in items):
        raise _InvalidMultipartRequest
    if not reports:
        raise _ReportRequired
    if not postal_codes:
        raise _PostalCodeRequired
    if len(items) != 2 or len(reports) != 1 or len(postal_codes) != 1:
        raise _InvalidMultipartRequest

    report = reports[0]
    postal_code = postal_codes[0]
    if not isinstance(report, UploadFile):
        raise _ReportRequired
    if not isinstance(postal_code, str):
        raise _PostalCodeRequired
    normalized_postal = postal_code.strip()
    if not normalized_postal:
        raise _PostalCodeRequired
    try:
        normalized_postal = normalize_us_zip_code(normalized_postal)
    except (TypeError, ValueError):
        raise _InvalidPostalCode
    if report.size is None or report.size <= 0:
        raise _InvalidUploadedReport
    if report.size > MAX_PDF_BYTES:
        raise _UploadedReportTooLarge
    return report, normalized_postal


def _copy_uploaded_report(upload: UploadFile, destination: Path) -> None:
    copied_bytes = 0
    try:
        upload.file.seek(0)
        with destination.open("xb") as output:
            while True:
                chunk = upload.file.read(UPLOAD_COPY_CHUNK_BYTES)
                if not chunk:
                    break
                copied_bytes += len(chunk)
                if copied_bytes > MAX_PDF_BYTES:
                    raise _UploadedReportTooLarge
                output.write(chunk)
    except _UploadedReportTooLarge:
        raise
    except (OSError, ValueError) as exc:
        raise _UploadInfrastructureError from exc
    if copied_bytes <= 0:
        raise _InvalidUploadedReport


async def _create_analysis(request: Request) -> JSONResponse:
    creation_service = request.app.state.creation_service
    if creation_service is None:
        return _error_response(503, "ANALYSIS_CREATION_UNAVAILABLE")

    content_type = request.headers.get("content-type", "")
    if content_type.partition(";")[0].strip().casefold() != "multipart/form-data":
        return _error_response(415, "UNSUPPORTED_MEDIA_TYPE")

    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            declared_length = int(content_length)
        except ValueError:
            return _error_response(400, "INVALID_MULTIPART_REQUEST")
        if declared_length < 0:
            return _error_response(400, "INVALID_MULTIPART_REQUEST")
        if declared_length > MAX_UPLOAD_BODY_BYTES:
            return _error_response(413, "REPORT_TOO_LARGE")

    limited_request = Request(
        request.scope,
        receive=_bounded_receive(request.receive, MAX_UPLOAD_BODY_BYTES),
    )
    try:
        with tempfile.TemporaryDirectory(prefix="venfour-analysis-upload-") as root:
            temporary_pdf = Path(root) / "report.pdf"
            try:
                async with limited_request.form(
                    max_files=1,
                    max_fields=1,
                    max_part_size=MAX_MULTIPART_FIELD_BYTES,
                ) as form:
                    report, postal_code = _multipart_values(form)
                    await run_in_threadpool(
                        _copy_uploaded_report, report, temporary_pdf
                    )
            except _ReportRequired:
                return _error_response(400, "REPORT_REQUIRED")
            except _PostalCodeRequired:
                return _error_response(400, "POSTAL_CODE_REQUIRED")
            except _InvalidPostalCode:
                return _error_response(400, "INVALID_POSTAL_CODE")
            except _InvalidMultipartRequest:
                return _error_response(400, "INVALID_MULTIPART_REQUEST")
            except _InvalidUploadedReport:
                return _error_response(400, "INVALID_REPORT")
            except _UploadedReportTooLarge:
                return _error_response(413, "REPORT_TOO_LARGE")
            except _UploadInfrastructureError:
                return _error_response(500, "ANALYSIS_CREATION_FAILED")
            except _RequestBodyTooLarge:
                return _error_response(413, "REPORT_TOO_LARGE")
            except (HTTPException, ValueError):
                return _error_response(400, "INVALID_MULTIPART_REQUEST")

            try:
                result = await run_in_threadpool(
                    creation_service.create,
                    temporary_pdf,
                    postal_code,
                )
            except AnalysisCreationInputError:
                return _error_response(400, "INVALID_REPORT")
            except AnalysisExtractionError:
                return _error_response(502, "REPORT_EXTRACTION_FAILED")
            except AnalysisReportValidationError:
                return _error_response(422, "REPORT_NOT_ANALYZABLE")
            except AnalysisUnsupportedReportError:
                return _error_response(422, "UNSUPPORTED_REPORT")
            except AnalysisCreationProviderError:
                return _error_response(503, "MARKET_PROVIDER_UNAVAILABLE")
            except AnalysisCreationUnavailableError:
                return _error_response(503, "ANALYSIS_CREATION_UNAVAILABLE")
            except AnalysisCreationExecutionError:
                return _error_response(500, "ANALYSIS_CREATION_FAILED")

            run_id = getattr(result, "run_id", None)
            if not _is_canonical_uuid4(run_id):
                return _error_response(500, "ANALYSIS_CREATION_FAILED")

        return JSONResponse(
            {"runId": run_id},
            status_code=201,
            headers={"Location": f"/api/v1/analyses/{run_id}"},
        )
    except _RequestBodyTooLarge:
        return _error_response(413, "REPORT_TOO_LARGE")


def _analysis_presentation(request: Request) -> JSONResponse:
    run_id = request.path_params["run_id"]
    if not _is_canonical_uuid4(run_id):
        return _error_response(400, "INVALID_RUN_ID")

    try:
        presentation = request.app.state.presentation_service.get(run_id)
        return JSONResponse(presentation.to_dict())
    except AnalysisRunNotFoundError:
        return _error_response(404, "ANALYSIS_NOT_FOUND")
    except _ANALYSIS_UNAVAILABLE_ERRORS:
        return _error_response(500, "ANALYSIS_UNAVAILABLE")
    except Exception:
        return _error_response(500, "INTERNAL_ERROR")


def _bearer_token(request: Request) -> str:
    authorization = request.headers.get("authorization")
    if not isinstance(authorization, str):
        raise SupabaseAuthenticationError("Authentication is required")
    parts = authorization.split()
    if (
        len(parts) != 2
        or parts[0].casefold() != "bearer"
        or not parts[1].strip()
    ):
        raise SupabaseAuthenticationError("Authentication is required")
    return parts[1]


async def _owned_identity(request: Request) -> str | JSONResponse:
    try:
        token = _bearer_token(request)
    except SupabaseAuthenticationError:
        return _error_response(
            401,
            "AUTHENTICATION_REQUIRED",
            headers={"WWW-Authenticate": "Bearer"},
        )
    case_service = request.app.state.case_analysis_service
    if case_service is None:
        return _error_response(503, "ANALYSIS_CREATION_UNAVAILABLE")
    try:
        return await run_in_threadpool(case_service.authenticate, token)
    except SupabaseAuthenticationError:
        return _error_response(
            401,
            "AUTHENTICATION_INVALID",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except (SupabaseUnavailableError, SupabaseContractError):
        return _error_response(503, "AUTHENTICATION_UNAVAILABLE")
    except Exception:
        return _error_response(503, "AUTHENTICATION_UNAVAILABLE")


async def _claim_access_identity(request: Request) -> str | JSONResponse:
    try:
        token = _bearer_token(request)
    except SupabaseAuthenticationError:
        return _error_response(
            401,
            "AUTHENTICATION_REQUIRED",
            headers={"WWW-Authenticate": "Bearer"},
        )
    service = request.app.state.case_claim_access_service
    if service is None:
        return _error_response(503, "CLAIM_ACCESS_UNAVAILABLE")
    try:
        return await run_in_threadpool(service.authenticate, token)
    except SupabaseAuthenticationError:
        return _error_response(
            401,
            "AUTHENTICATION_INVALID",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except (SupabaseUnavailableError, SupabaseContractError):
        return _error_response(503, "AUTHENTICATION_UNAVAILABLE")
    except Exception:
        return _error_response(503, "AUTHENTICATION_UNAVAILABLE")


def _claim_access_error(error: Exception) -> JSONResponse:
    if isinstance(error, (CaseClaimAccessNotFoundError,)):
        return _error_response(404, "CASE_NOT_FOUND")
    if isinstance(error, CaseClaimAccessConflictError):
        return _error_response(409, "CLAIM_ACCESS_CONFLICT")
    if isinstance(error, (TurnstileRejectedError, CaseClaimAccessInputError)):
        return _error_response(400, "INVALID_CLAIM_ACCESS_REQUEST")
    if isinstance(
        error,
        (
            CaseClaimAccessUnavailableError,
            SupabaseUnavailableError,
        ),
    ):
        return _error_response(503, "CLAIM_ACCESS_UNAVAILABLE")
    if isinstance(error, SupabaseAuthenticationError):
        return _error_response(
            401,
            "AUTHENTICATION_INVALID",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if isinstance(error, SupabaseContractError):
        return _error_response(503, "CLAIM_ACCESS_UNAVAILABLE")
    if isinstance(error, CaseClaimAccessError):
        return _error_response(503, "CLAIM_ACCESS_UNAVAILABLE")
    return _error_response(500, "INTERNAL_ERROR")


async def _require_empty_request_body(request: Request) -> bool:
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            if int(content_length) != 0:
                return False
        except ValueError:
            return False
    bounded = Request(request.scope, receive=_bounded_receive(request.receive, 1))
    try:
        return not bool(await bounded.body())
    except _RequestBodyTooLarge:
        return False


async def _claim_resume(request: Request) -> JSONResponse:
    if not _is_canonical_uuid4(request.path_params["case_id"]):
        return _private_response(_error_response(400, "INVALID_CASE_ID"))
    identity = await _claim_access_identity(request)
    if isinstance(identity, JSONResponse):
        return _private_response(identity)
    try:
        access_token = _bearer_token(request)
        result = await run_in_threadpool(
            request.app.state.case_claim_access_service.resolve,
            request.path_params["case_id"],
            access_token,
        )
        return _private_response(JSONResponse(result.to_dict()))
    except Exception as exc:
        return _private_response(_claim_access_error(exc))


async def _claim_access_link(request: Request) -> JSONResponse:
    if not _is_canonical_uuid4(request.path_params["case_id"]):
        return _private_response(_error_response(400, "INVALID_CASE_ID"))
    identity = await _claim_access_identity(request)
    if isinstance(identity, JSONResponse):
        return _private_response(identity)
    if not await _require_empty_request_body(request):
        return _private_response(
            _error_response(400, "INVALID_CLAIM_ACCESS_REQUEST")
        )
    try:
        access_token = _bearer_token(request)
        result = await run_in_threadpool(
            request.app.state.case_claim_access_service.access_link,
            request.path_params["case_id"],
            access_token,
        )
        return _private_response(JSONResponse(result.to_dict()))
    except Exception as exc:
        return _private_response(_claim_access_error(exc))


async def _claim_recovery_payload(request: Request) -> tuple[str, str]:
    content_type = request.headers.get("content-type", "")
    if content_type.partition(";")[0].strip().casefold() != "application/json":
        raise CaseClaimAccessInputError("Recovery request is invalid")
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            if not 0 < int(content_length) <= MAX_CLAIM_RECOVERY_BODY_BYTES:
                raise CaseClaimAccessInputError("Recovery request is invalid")
        except ValueError as exc:
            raise CaseClaimAccessInputError(
                "Recovery request is invalid"
            ) from exc
    bounded = Request(
        request.scope,
        receive=_bounded_receive(request.receive, MAX_CLAIM_RECOVERY_BODY_BYTES),
    )
    try:
        raw_body = await bounded.body()
    except _RequestBodyTooLarge as exc:
        raise CaseClaimAccessInputError("Recovery request is invalid") from exc
    try:
        payload = json.loads(raw_body)
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise CaseClaimAccessInputError("Recovery request is invalid") from exc
    if not isinstance(payload, Mapping) or set(payload) != {
        "email",
        "turnstileToken",
    }:
        raise CaseClaimAccessInputError("Recovery request is invalid")
    email = payload.get("email")
    token = payload.get("turnstileToken")
    if not isinstance(email, str) or not isinstance(token, str):
        raise CaseClaimAccessInputError("Recovery request is invalid")
    return email, token


def _claim_recovery_requester_identity(request: Request) -> str:
    if request.app.state.staging_proxy_required is not True:
        return request.client.host if request.client is not None else "unknown"

    values: list[bytes] = []
    for name, value in request.scope.get("headers", ()):
        if name.lower() == b"cf-connecting-ip":
            values.append(value)
    if len(values) != 1:
        raise CaseClaimAccessUnavailableError(
            "Recovery requester identity is unavailable"
        )
    try:
        value = values[0].decode("ascii")
        if not value or value != value.strip() or "%" in value:
            raise ValueError("client IP is invalid")
        return str(ip_address(value))
    except (UnicodeDecodeError, ValueError) as exc:
        raise CaseClaimAccessUnavailableError(
            "Recovery requester identity is unavailable"
        ) from exc


async def _claim_access_recovery(request: Request) -> JSONResponse:
    if not _is_canonical_uuid4(request.path_params["case_id"]):
        return _private_response(_error_response(400, "INVALID_CASE_ID"))
    service = request.app.state.case_claim_access_service
    if service is None:
        return _private_response(
            _error_response(503, "CLAIM_ACCESS_UNAVAILABLE")
        )
    try:
        email, turnstile_token = await _claim_recovery_payload(request)
        requester_identity = _claim_recovery_requester_identity(request)
        await run_in_threadpool(
            service.recover,
            request.path_params["case_id"],
            email,
            turnstile_token,
            requester_identity,
        )
    except TurnstileRejectedError:
        return _private_response(_error_response(400, "SECURITY_CHECK_FAILED"))
    except CaseClaimAccessInputError as exc:
        return _private_response(_claim_access_error(exc))
    except Exception as exc:
        return _private_response(_claim_access_error(exc))
    return _private_response(
        JSONResponse({"status": "accepted"}, status_code=202)
    )


def _commerce_error(error: Exception) -> JSONResponse:
    if isinstance(error, SupabaseAuthenticationError):
        return _error_response(
            401,
            "AUTHENTICATION_INVALID",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if isinstance(error, CommerceNotFoundError):
        return _error_response(404, "CASE_NOT_FOUND")
    if isinstance(error, CommerceInputError):
        return _error_response(400, "INVALID_COMMERCE_REQUEST")
    if isinstance(error, CommerceConflictError):
        return _error_response(409, "COMMERCE_CONFLICT")
    if isinstance(
        error,
        (
            CommerceUnavailableError,
            SupabaseUnavailableError,
            SupabaseContractError,
        ),
    ):
        return _error_response(503, "COMMERCE_UNAVAILABLE")
    if isinstance(error, CommerceError):
        return _error_response(503, "COMMERCE_UNAVAILABLE")
    return _error_response(500, "INTERNAL_ERROR")


async def _strict_json_object(
    request: Request,
    *,
    expected_keys: set[str],
    maximum_bytes: int,
) -> Mapping[str, Any]:
    content_type = request.headers.get("content-type", "")
    if content_type.partition(";")[0].strip().casefold() != "application/json":
        raise CommerceInputError("Commerce request is invalid")
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            if not 0 < int(content_length) <= maximum_bytes:
                raise CommerceInputError("Commerce request is invalid")
        except ValueError as exc:
            raise CommerceInputError("Commerce request is invalid") from exc
    bounded = Request(
        request.scope,
        receive=_bounded_receive(request.receive, maximum_bytes),
    )
    try:
        raw_body = await bounded.body()
    except _RequestBodyTooLarge as exc:
        raise CommerceInputError("Commerce request is invalid") from exc
    try:
        payload = json.loads(raw_body)
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise CommerceInputError("Commerce request is invalid") from exc
    if not isinstance(payload, Mapping) or set(payload) != expected_keys:
        raise CommerceInputError("Commerce request is invalid")
    return payload


async def _checkout_sessions(request: Request) -> JSONResponse:
    case_id = request.path_params["case_id"]
    if not _is_canonical_uuid4(case_id):
        return _private_response(_error_response(400, "INVALID_CASE_ID"))
    service = request.app.state.commerce_service
    if service is None:
        return _private_response(_error_response(503, "COMMERCE_UNAVAILABLE"))
    try:
        token = _bearer_token(request)
    except SupabaseAuthenticationError:
        return _private_response(
            _error_response(
                401,
                "AUTHENTICATION_REQUIRED",
                headers={"WWW-Authenticate": "Bearer"},
            )
        )
    try:
        payload = await _strict_json_object(
            request,
            expected_keys={"clientRequestId"},
            maximum_bytes=MAX_COMMERCE_REQUEST_BODY_BYTES,
        )
        client_request_id = payload.get("clientRequestId")
        if not isinstance(client_request_id, str):
            raise CommerceInputError("Commerce request is invalid")
        projection = await run_in_threadpool(
            service.create_checkout,
            case_id,
            token,
            client_request_id,
        )
        return _private_response(JSONResponse(projection.to_dict()))
    except Exception as exc:
        return _private_response(_commerce_error(exc))


async def _checkout_reconciliation(request: Request) -> JSONResponse:
    case_id = request.path_params["case_id"]
    if not _is_canonical_uuid4(case_id):
        return _private_response(_error_response(400, "INVALID_CASE_ID"))
    service = request.app.state.commerce_service
    if service is None:
        return _private_response(_error_response(503, "COMMERCE_UNAVAILABLE"))
    try:
        token = _bearer_token(request)
    except SupabaseAuthenticationError:
        return _private_response(
            _error_response(
                401,
                "AUTHENTICATION_REQUIRED",
                headers={"WWW-Authenticate": "Bearer"},
            )
        )
    try:
        payload = await _strict_json_object(
            request,
            expected_keys={"checkoutSessionId"},
            maximum_bytes=MAX_COMMERCE_REQUEST_BODY_BYTES,
        )
        checkout_session_id = payload.get("checkoutSessionId")
        if not isinstance(checkout_session_id, str):
            raise CommerceInputError("Commerce request is invalid")
        projection = await run_in_threadpool(
            service.reconcile_checkout,
            case_id,
            token,
            checkout_session_id,
        )
        return _private_response(JSONResponse(projection.to_dict()))
    except Exception as exc:
        return _private_response(_commerce_error(exc))


def _stripe_signature_header(request: Request) -> str:
    values = [
        value
        for name, value in request.scope.get("headers", ())
        if name.lower() == b"stripe-signature"
    ]
    if len(values) != 1:
        raise CommerceWebhookSignatureError("Stripe signature is invalid")
    try:
        signature = values[0].decode("ascii")
    except UnicodeDecodeError as exc:
        raise CommerceWebhookSignatureError(
            "Stripe signature is invalid"
        ) from exc
    if (
        not signature
        or signature != signature.strip()
        or len(signature) > 4096
        or any(ord(character) < 32 or ord(character) == 127 for character in signature)
    ):
        raise CommerceWebhookSignatureError("Stripe signature is invalid")
    return signature


async def _stripe_webhook(request: Request) -> JSONResponse:
    service = request.app.state.commerce_service
    if service is None:
        return _private_response(_error_response(503, "COMMERCE_UNAVAILABLE"))
    try:
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                if not 0 < int(content_length) <= MAX_STRIPE_WEBHOOK_BODY_BYTES:
                    return _private_response(
                        _error_response(413, "STRIPE_WEBHOOK_TOO_LARGE")
                    )
            except ValueError:
                return _private_response(
                    _error_response(400, "INVALID_STRIPE_WEBHOOK")
                )
        signature = _stripe_signature_header(request)
        bounded = Request(
            request.scope,
            receive=_bounded_receive(
                request.receive, MAX_STRIPE_WEBHOOK_BODY_BYTES
            ),
        )
        try:
            payload = await bounded.body()
        except _RequestBodyTooLarge:
            return _private_response(
                _error_response(413, "STRIPE_WEBHOOK_TOO_LARGE")
            )
        if not payload:
            raise CommerceWebhookSignatureError("Stripe signature is invalid")
        await run_in_threadpool(service.handle_webhook, payload, signature)
        return _private_response(JSONResponse({"status": "accepted"}))
    except CommerceWebhookSignatureError:
        return _private_response(_error_response(400, "INVALID_STRIPE_WEBHOOK"))
    except CommerceProviderError:
        return _private_response(_error_response(503, "COMMERCE_UNAVAILABLE"))
    except Exception as exc:
        return _private_response(_commerce_error(exc))


def _case_analysis_error(error: Exception) -> JSONResponse:
    if isinstance(error, CaseAnalysisInputError):
        return _error_response(400, error.code)
    if isinstance(error, CaseAnalysisNotFoundError):
        return _error_response(404, "CASE_NOT_FOUND")
    if isinstance(error, CaseAnalysisConflictError):
        return _error_response(409, error.code)
    if isinstance(error, CaseAnalysisUnavailableError):
        return _error_response(503, "ANALYSIS_CREATION_UNAVAILABLE")
    if isinstance(error, CaseAnalysisContractError):
        return _error_response(500, "ANALYSIS_UNAVAILABLE")
    return _error_response(500, "INTERNAL_ERROR")


async def _case_analysis_status(request: Request) -> JSONResponse:
    identity = await _owned_identity(request)
    if isinstance(identity, JSONResponse):
        return _private_response(identity)
    case_id = request.path_params["case_id"]
    try:
        status = await run_in_threadpool(
            request.app.state.case_analysis_service.status,
            case_id,
            identity,
        )
    except Exception as exc:
        return _private_response(_case_analysis_error(exc))
    return _private_response(JSONResponse(status.to_dict()))


async def _case_analysis_submit(request: Request) -> JSONResponse:
    identity = await _owned_identity(request)
    if isinstance(identity, JSONResponse):
        return _private_response(identity)

    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            if int(content_length) != 0:
                return _private_response(
                    _error_response(400, "INVALID_ANALYSIS_REQUEST")
                )
        except ValueError:
            return _private_response(
                _error_response(400, "INVALID_ANALYSIS_REQUEST")
            )
    body_request = Request(
        request.scope,
        receive=_bounded_receive(request.receive, 1),
    )
    try:
        if await body_request.body():
            return _private_response(
                _error_response(400, "INVALID_ANALYSIS_REQUEST")
            )
    except _RequestBodyTooLarge:
        return _private_response(
            _error_response(400, "INVALID_ANALYSIS_REQUEST")
        )

    case_id = request.path_params["case_id"]
    try:
        status = await run_in_threadpool(
            request.app.state.case_analysis_service.submit,
            case_id,
            identity,
        )
    except Exception as exc:
        return _private_response(_case_analysis_error(exc))
    status_code = 202 if status.status == "processing" else 200
    response = JSONResponse(status.to_dict(), status_code=status_code)
    if status.status == "completed" and status.run_id is not None:
        response.headers["Location"] = f"/api/v1/analyses/{status.run_id}"
    return _private_response(response)


async def _case_report_ingestion(request: Request) -> JSONResponse:
    identity = await _owned_identity(request)
    if isinstance(identity, JSONResponse):
        return _private_response(identity)
    try:
        access_token = _bearer_token(request)
    except SupabaseAuthenticationError:
        return _private_response(
            _error_response(
                401,
                "AUTHENTICATION_REQUIRED",
                headers={"WWW-Authenticate": "Bearer"},
            )
        )
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            if int(content_length) != 0:
                return _private_response(
                    _error_response(400, "INVALID_REPORT_INGESTION_REQUEST")
                )
        except ValueError:
            return _private_response(
                _error_response(400, "INVALID_REPORT_INGESTION_REQUEST")
            )
    body_request = Request(
        request.scope,
        receive=_bounded_receive(request.receive, 1),
    )
    try:
        if await body_request.body():
            return _private_response(
                _error_response(400, "INVALID_REPORT_INGESTION_REQUEST")
            )
    except _RequestBodyTooLarge:
        return _private_response(
            _error_response(400, "INVALID_REPORT_INGESTION_REQUEST")
        )

    ingestion_method = getattr(
        request.app.state.case_analysis_service, "ingest_report", None
    )
    if not callable(ingestion_method):
        return _private_response(
            _error_response(503, "REPORT_EXTRACTION_UNAVAILABLE")
        )
    case_id = request.path_params["case_id"]
    try:
        ingestion = await run_in_threadpool(
            ingestion_method,
            case_id,
            identity,
            access_token,
        )
        if callable(getattr(ingestion, "to_dict", None)):
            payload = ingestion.to_dict()
        elif isinstance(ingestion, Mapping):
            payload = dict(ingestion)
        else:
            raise CaseAnalysisContractError("Report ingestion response is invalid")
        return _private_response(JSONResponse(payload))
    except Exception as exc:
        return _private_response(_case_analysis_error(exc))


async def _owned_analysis_presentation(request: Request) -> JSONResponse:
    identity = await _owned_identity(request)
    if isinstance(identity, JSONResponse):
        return _private_response(identity)
    run_id = request.path_params["run_id"]
    try:
        presentation = await run_in_threadpool(
            request.app.state.case_analysis_service.get_presentation,
            run_id,
            identity,
        )
        return _private_response(JSONResponse(presentation))
    except CaseAnalysisInputError as exc:
        return _private_response(_error_response(400, exc.code))
    except AnalysisRunNotFoundError:
        return _private_response(_error_response(404, "ANALYSIS_NOT_FOUND"))
    except _ANALYSIS_UNAVAILABLE_ERRORS:
        return _private_response(_error_response(500, "ANALYSIS_UNAVAILABLE"))
    except (CaseAnalysisUnavailableError, SupabaseUnavailableError):
        return _private_response(
            _error_response(503, "ANALYSIS_CREATION_UNAVAILABLE")
        )
    except (CaseAnalysisContractError, SupabaseContractError):
        return _private_response(_error_response(500, "ANALYSIS_UNAVAILABLE"))
    except Exception:
        return _private_response(_error_response(500, "INTERNAL_ERROR"))


def _vehicle_trim_request(request: Request) -> VehicleTrimCatalogRequest:
    items = list(request.query_params.multi_items())
    expected_names = {"year", "make", "model"}
    if (
        len(items) != len(expected_names)
        or {name for name, _value in items} != expected_names
    ):
        raise ValueError("vehicle trim query parameters are invalid")
    values = dict(items)
    year_value = values["year"]
    if len(year_value) != 4 or not year_value.isascii() or not year_value.isdigit():
        raise ValueError("vehicle trim year is invalid")
    return VehicleTrimCatalogRequest(
        year=int(year_value),
        make=values["make"],
        model=values["model"],
    )


async def _vehicle_trims(request: Request) -> JSONResponse:
    try:
        catalog_request = _vehicle_trim_request(request)
    except (TypeError, ValueError):
        return _private_response(
            _error_response(400, "INVALID_VEHICLE_TRIM_REQUEST")
        )

    service = request.app.state.vehicle_trim_catalog_service
    if service is None:
        return _private_response(
            _error_response(503, "VEHICLE_TRIM_LOOKUP_UNAVAILABLE")
        )
    try:
        trims = await run_in_threadpool(service.list_trims, catalog_request)
        if (
            not isinstance(trims, tuple)
            or len(trims) > MAX_VEHICLE_TRIM_OPTIONS
            or any(not isinstance(trim, VehicleTrimOption) for trim in trims)
        ):
            raise TypeError("vehicle trim catalog response is invalid")
        return _private_response(
            JSONResponse({"trims": [trim.to_dict() for trim in trims]})
        )
    except Exception:
        return _private_response(
            _error_response(503, "VEHICLE_TRIM_LOOKUP_UNAVAILABLE")
        )


def _health(_request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


def _readiness(request: Request) -> JSONResponse:
    ready = bool(
        request.app.state.accepting_customer_requests
        and request.app.state.customer_path_configured
    )
    return JSONResponse(
        {"status": "ready" if ready else "not_ready"},
        status_code=200 if ready else 503,
        headers={"Cache-Control": "no-store"},
    )


def _runtime_secret_is_configured(name: str) -> bool:
    value = os.environ.get(name)
    if not isinstance(value, str):
        return False
    return bool(value) and not any(
        character.isspace() or ord(character) < 32 or ord(character) == 127
        for character in value
    )


def _internal_bearer_token(request: Request) -> str:
    values = [
        value
        for name, value in request.scope.get("headers", ())
        if name.lower() == b"authorization"
    ]
    if len(values) != 1:
        raise InternalCallerAuthenticationError(
            "Internal caller authentication is invalid"
        )
    try:
        authorization = values[0].decode("ascii")
    except UnicodeDecodeError as exc:
        raise InternalCallerAuthenticationError(
            "Internal caller authentication is invalid"
        ) from exc
    parts = authorization.split()
    if (
        len(parts) != 2
        or parts[0].casefold() != "bearer"
        or not parts[1]
    ):
        raise InternalCallerAuthenticationError(
            "Internal caller authentication is invalid"
        )
    return parts[1]


async def _internal_work_item_execute(request: Request) -> JSONResponse:
    work_item_id = request.path_params["work_item_id"]
    if not _is_canonical_uuid4(work_item_id):
        return _private_response(_error_response(400, "INVALID_WORK_ITEM_ID"))
    if not await _require_empty_request_body(request):
        return _private_response(
            _error_response(400, "INVALID_INTERNAL_WORK_REQUEST")
        )

    processor = request.app.state.package_processor
    verifier = request.app.state.internal_caller_verifier
    if processor is None or verifier is None:
        return _private_response(
            _error_response(503, "PACKAGE_PROCESSING_UNAVAILABLE")
        )
    try:
        token = _internal_bearer_token(request)
        await run_in_threadpool(verifier.verify, token)
    except InternalCallerAuthenticationError:
        return _private_response(
            _error_response(
                401,
                "INTERNAL_AUTHENTICATION_REQUIRED",
                headers={"WWW-Authenticate": "Bearer"},
            )
        )

    try:
        result = await run_in_threadpool(processor.execute, work_item_id)
        if not isinstance(result, PackageExecutionResult):
            raise PackageProcessingContractError(
                "Package processor returned an invalid result"
            )
        return _private_response(
            JSONResponse(
                {
                    "state": result.state,
                    "workItemId": result.work_item_id,
                    "packageJobId": result.package_job_id,
                    "packageStatus": result.package_status,
                    "attemptCount": result.attempt_count,
                    "sourceSnapshotId": result.source_snapshot_id,
                    "finalAssessmentId": result.final_assessment_id,
                }
            )
        )
    except PackageProcessingInputError:
        return _private_response(_error_response(400, "INVALID_WORK_ITEM_ID"))
    except (
        PackageWorkBusyError,
        PackageRetryLaterError,
        PackageStaleFenceError,
        PackageProcessingUnavailableError,
        SupabaseUnavailableError,
    ):
        return _private_response(
            _error_response(
                503,
                "PACKAGE_PROCESSING_UNAVAILABLE",
                headers={"Retry-After": "60"},
            )
        )
    except PackageProcessingContractError:
        return _private_response(_error_response(500, "PACKAGE_PROCESSING_FAILED"))
    except Exception:
        return _private_response(_error_response(500, "PACKAGE_PROCESSING_FAILED"))


async def _http_exception_response(
    _request: Request, exc: Exception
) -> JSONResponse:
    if not isinstance(exc, HTTPException):
        return _error_response(500, "INTERNAL_ERROR")
    if exc.status_code == 404:
        return _error_response(404, "ROUTE_NOT_FOUND", headers=exc.headers)
    if exc.status_code == 405:
        return _error_response(405, "METHOD_NOT_ALLOWED", headers=exc.headers)
    return _error_response(500, "INTERNAL_ERROR")


async def _internal_error_response(
    _request: Request, _exc: Exception
) -> JSONResponse:
    return _error_response(500, "INTERNAL_ERROR")


def create_app(
    presentation_service: Any | None = None,
    *,
    creation_service: Any | None = None,
    repository: AnalysisRunRepository | None = None,
    repository_root: Path | str | None = None,
    case_analysis_service: Any | None = None,
    case_claim_access_service: Any | None = None,
    commerce_service: Any | None = None,
    package_coordinator: Any | None = None,
    package_processor: Any | None = None,
    internal_caller_verifier: Any | None = None,
    vehicle_trim_catalog_service: Any | None = None,
    supabase_gateway: CaseAnalysisGateway | None = None,
    enable_legacy_api: bool | None = None,
    staging_proxy_secret: str | None = None,
) -> Starlette:
    """Build the owned case API and optional legacy upload API.

    The default composition is Supabase-backed and authenticated.  Supplying
    a legacy dependency is an explicit test/development opt-in for the old
    unauthenticated upload and presentation routes.
    """

    selected_staging_proxy_secret = _validated_staging_proxy_secret(
        staging_proxy_secret
        if staging_proxy_secret is not None
        else os.environ.get(STAGING_PROXY_SECRET_ENVIRONMENT_NAME)
    )

    if case_analysis_service is not None and supabase_gateway is not None:
        raise ValueError(
            "case_analysis_service cannot be combined with supabase_gateway"
        )

    legacy_dependencies_provided = any(
        value is not None
        for value in (
            presentation_service,
            creation_service,
            repository,
            repository_root,
        )
    )
    if enable_legacy_api is not None and not isinstance(enable_legacy_api, bool):
        raise TypeError("enable_legacy_api must be a boolean or null")
    legacy_enabled = (
        enable_legacy_api
        if enable_legacy_api is not None
        else (
            legacy_dependencies_provided
            or os.environ.get(LEGACY_API_ENVIRONMENT_NAME) == "1"
        )
    )
    if not legacy_enabled and legacy_dependencies_provided:
        raise ValueError(
            "legacy dependencies require enable_legacy_api=True"
        )

    if presentation_service is not None and (
        repository is not None or repository_root is not None
    ):
        raise ValueError(
            "presentation_service cannot be combined with repository configuration"
        )
    if repository is not None and repository_root is not None:
        raise ValueError("repository cannot be combined with repository_root")

    selected_repository = repository
    selected_service = presentation_service
    selected_creation_service = creation_service
    if legacy_enabled:
        if selected_service is None:
            if selected_repository is None:
                selected_repository = FileAnalysisRunRepository(
                    repository_root
                    if repository_root is not None
                    else DEFAULT_ANALYSIS_RUN_DIR
                )
            selected_service = AnalysisPresentationService(selected_repository)
        elif not callable(getattr(selected_service, "get", None)):
            raise TypeError("presentation_service must expose get(run_id)")

        if selected_creation_service is None and selected_repository is not None:
            selected_creation_service = create_live_analysis_creation_service(
                selected_repository
            )
        if selected_creation_service is not None and not callable(
            getattr(selected_creation_service, "create", None)
        ):
            raise TypeError(
                "creation_service must expose create(pdf_path, postal_code)"
            )
    else:
        selected_repository = None
        selected_service = None
        selected_creation_service = None

    selected_case_service = case_analysis_service
    owned_supabase_gateway: SupabaseHttpGateway | None = None
    selected_gateway: CaseAnalysisGateway | None = None
    if selected_case_service is None:
        selected_gateway = supabase_gateway
        if selected_gateway is None:
            try:
                owned_supabase_gateway = SupabaseHttpGateway(
                    SupabaseServerConfiguration.from_environment()
                )
                selected_gateway = owned_supabase_gateway
            except SupabaseConfigurationError:
                selected_gateway = None
        elif not isinstance(selected_gateway, CaseAnalysisGateway):
            raise TypeError("supabase_gateway must implement CaseAnalysisGateway")
        if selected_gateway is not None:
            selected_case_service = CaseAnalysisService(selected_gateway)
    else:
        required_methods = (
            "authenticate",
            "submit",
            "status",
            "get_presentation",
        )
        if any(
            not callable(getattr(selected_case_service, method, None))
            for method in required_methods
        ):
            raise TypeError(
                "case_analysis_service must expose auth, case, and run methods"
            )

    selected_case_claim_access_service = case_claim_access_service
    owned_case_claim_access_service: CaseClaimAccessService | None = None
    claim_recovery_configured = selected_case_claim_access_service is not None
    if selected_case_claim_access_service is None and isinstance(
        selected_gateway, CaseClaimAccessGateway
    ):
        public_app_origin = os.environ.get(PUBLIC_APP_ORIGIN_ENVIRONMENT_NAME)
        turnstile_secret = os.environ.get(TURNSTILE_SECRET_ENVIRONMENT_NAME)
        rate_limit_secret = os.environ.get(
            RECOVERY_RATE_SECRET_ENVIRONMENT_NAME
        )
        recovery_configuration = None
        turnstile_verifier = None
        if public_app_origin and turnstile_secret and rate_limit_secret:
            try:
                recovery_configuration = CaseClaimRecoveryConfiguration(
                    public_app_origin=public_app_origin,
                    rate_limit_secret=rate_limit_secret,
                    turnstile_secret=turnstile_secret,
                )
                turnstile_verifier = CloudflareTurnstileVerifier(
                    recovery_configuration.turnstile_secret,
                    expected_hostname=(
                        recovery_configuration.turnstile_hostname
                    ),
                    allow_test_response=(
                        recovery_configuration.allows_turnstile_test_response
                    ),
                )
            except (TypeError, ValueError):
                recovery_configuration = None
                turnstile_verifier = None
        claim_recovery_configured = recovery_configuration is not None
        owned_case_claim_access_service = CaseClaimAccessService(
            selected_gateway,
            recovery_configuration=recovery_configuration,
            turnstile_verifier=turnstile_verifier,
        )
        selected_case_claim_access_service = owned_case_claim_access_service
    elif selected_case_claim_access_service is not None:
        required_claim_methods = (
            "authenticate",
            "resolve",
            "access_link",
            "recover",
        )
        if any(
            not callable(getattr(selected_case_claim_access_service, method, None))
            for method in required_claim_methods
        ):
            raise TypeError(
                "case_claim_access_service must expose auth and claim-access methods"
            )

    selected_package_coordinator = package_coordinator
    selected_package_processor = package_processor
    selected_internal_caller_verifier = internal_caller_verifier
    owned_package_dispatcher: CloudTasksWorkItemDispatcher | None = None

    if selected_package_coordinator is None and isinstance(
        selected_gateway, PackageProcessingDatabaseGateway
    ):
        package_dispatcher = None
        try:
            cloud_tasks_configuration = CloudTasksConfiguration.from_environment(
                os.environ
            )
        except (TypeError, ValueError):
            cloud_tasks_configuration = None
        if cloud_tasks_configuration is not None:
            try:
                owned_package_dispatcher = CloudTasksWorkItemDispatcher(
                    cloud_tasks_configuration
                )
                package_dispatcher = owned_package_dispatcher
            except PackageProcessingUnavailableError:
                owned_package_dispatcher = None
        selected_package_coordinator = TotalLossPackageCoordinator(
            selected_gateway,
            package_dispatcher,
        )
    elif selected_package_coordinator is not None and any(
        not callable(getattr(selected_package_coordinator, method, None))
        for method in ("ensure_for_entitlement", "reconcile_due")
    ):
        raise TypeError(
            "package_coordinator must expose entitlement and reconciliation methods"
        )

    if selected_package_processor is None and isinstance(
        selected_gateway, PackageProcessingDatabaseGateway
    ):
        selected_package_processor = TotalLossPackageProcessor(selected_gateway)
    elif selected_package_processor is not None and not callable(
        getattr(selected_package_processor, "execute", None)
    ):
        raise TypeError("package_processor must expose execute(work_item_id)")

    if selected_internal_caller_verifier is None:
        try:
            internal_oidc_configuration = InternalOidcConfiguration.from_environment(
                os.environ
            )
        except (TypeError, ValueError):
            internal_oidc_configuration = None
        if internal_oidc_configuration is not None:
            selected_internal_caller_verifier = (
                GoogleOidcInternalCallerVerifier(internal_oidc_configuration)
            )
    elif not isinstance(selected_internal_caller_verifier, InternalCallerVerifier):
        raise TypeError(
            "internal_caller_verifier must expose verify(token)"
        )

    selected_commerce_service = commerce_service
    if selected_commerce_service is None and isinstance(
        selected_gateway, CommerceDatabaseGateway
    ):
        try:
            commerce_configuration = StripeCommerceConfiguration.from_environment(
                os.environ
            )
        except (TypeError, ValueError):
            commerce_configuration = None
        if commerce_configuration is not None:
            selected_commerce_service = TotalLossCommerceService(
                selected_gateway,
                StripeSdkGateway(commerce_configuration),
                commerce_configuration,
                selected_package_coordinator,
            )
    elif selected_commerce_service is not None:
        required_commerce_methods = (
            "authenticate",
            "create_checkout",
            "reconcile_checkout",
            "handle_webhook",
            "refund",
        )
        if any(
            not callable(getattr(selected_commerce_service, method, None))
            for method in required_commerce_methods
        ):
            raise TypeError(
                "commerce_service must expose checkout and webhook methods"
            )

    selected_vehicle_trim_catalog_service = vehicle_trim_catalog_service
    trim_cache_methods = (
        "claim_vehicle_trim_cache",
        "complete_vehicle_trim_cache",
        "release_vehicle_trim_cache",
    )
    if (
        selected_vehicle_trim_catalog_service is None
        and selected_gateway is not None
        and all(
            callable(getattr(selected_gateway, method, None))
            for method in trim_cache_methods
        )
        and _runtime_secret_is_configured("OPENAI_API_KEY")
    ):
        selected_vehicle_trim_catalog_service = OpenAIVehicleTrimCatalog(
            selected_gateway,  # type: ignore[arg-type]
            api_key=os.environ.get("OPENAI_API_KEY"),
        )
    if selected_vehicle_trim_catalog_service is not None and not callable(
        getattr(selected_vehicle_trim_catalog_service, "list_trims", None)
    ):
        raise TypeError(
            "vehicle_trim_catalog_service must expose list_trims(request)"
        )

    customer_path_configured = (
        selected_case_service is not None and not legacy_enabled
    )
    if case_analysis_service is None:
        customer_path_configured = (
            customer_path_configured
            and claim_recovery_configured
            and all(
                _runtime_secret_is_configured(name)
                for name in ("OPENAI_API_KEY", "MARKETCHECK_API_KEY")
            )
        )

    routes = [
        Route("/api/v1/vehicle-trims", _vehicle_trims, methods=["GET"]),
        Route(
            "/api/v1/appraisal-cases/{case_id}/checkout-sessions",
            _checkout_sessions,
            methods=["POST"],
        ),
        Route(
            "/api/v1/appraisal-cases/{case_id}/checkout-reconciliation",
            _checkout_reconciliation,
            methods=["POST"],
        ),
        Route(
            "/api/v1/appraisal-cases/{case_id}/claim/access-recovery",
            _claim_access_recovery,
            methods=["POST"],
        ),
        Route(
            "/api/v1/appraisal-cases/{case_id}/claim/access-link",
            _claim_access_link,
            methods=["POST"],
        ),
        Route(
            "/api/v1/appraisal-cases/{case_id}/claim",
            _claim_resume,
            methods=["GET"],
        ),
        Route(
            "/api/v1/appraisal-cases/{case_id}/report-ingestion",
            _case_report_ingestion,
            methods=["POST"],
        ),
        Route(
            "/api/v1/appraisal-cases/{case_id}/analysis",
            _case_analysis_submit,
            methods=["POST"],
        ),
        Route(
            "/api/v1/appraisal-cases/{case_id}/analysis",
            _case_analysis_status,
            methods=["GET"],
        ),
        Route(
            "/api/v1/analyses/{run_id}",
            _analysis_presentation if legacy_enabled else _owned_analysis_presentation,
            methods=["GET"],
        ),
        Route("/health", _health, methods=["GET"]),
        Route("/ready", _readiness, methods=["GET"]),
        Route("/webhooks/stripe", _stripe_webhook, methods=["POST"]),
    ]
    if (
        selected_package_processor is not None
        and selected_internal_caller_verifier is not None
    ):
        routes.append(
            Route(
                "/internal/v1/work-items/{work_item_id}/execute",
                _internal_work_item_execute,
                methods=["POST"],
            )
        )
    if legacy_enabled:
        routes.insert(
            0,
            Route("/api/v1/analyses", _create_analysis, methods=["POST"]),
        )

    @asynccontextmanager
    async def lifespan(application: Starlette):
        application.state.accepting_customer_requests = True
        try:
            yield
        finally:
            application.state.accepting_customer_requests = False
            if owned_supabase_gateway is not None:
                owned_supabase_gateway.close()
            if owned_case_claim_access_service is not None:
                owned_case_claim_access_service.close()
            if owned_package_dispatcher is not None:
                owned_package_dispatcher.close()

    middleware = []
    if selected_staging_proxy_secret is not None:
        middleware.append(
            Middleware(
                _StagingProxyGuardMiddleware,
                secret=selected_staging_proxy_secret,
            )
        )

    app = Starlette(
        routes=routes,
        exception_handlers={
            HTTPException: _http_exception_response,
            Exception: _internal_error_response,
        },
        lifespan=lifespan,
        middleware=middleware,
    )
    app.router.redirect_slashes = False
    app.state.presentation_service = selected_service
    app.state.creation_service = selected_creation_service
    app.state.case_analysis_service = selected_case_service
    app.state.case_claim_access_service = selected_case_claim_access_service
    app.state.commerce_service = selected_commerce_service
    app.state.package_coordinator = selected_package_coordinator
    app.state.package_processor = selected_package_processor
    app.state.internal_caller_verifier = selected_internal_caller_verifier
    app.state.vehicle_trim_catalog_service = (
        selected_vehicle_trim_catalog_service
    )
    app.state.legacy_api_enabled = legacy_enabled
    app.state.customer_path_configured = customer_path_configured
    app.state.accepting_customer_requests = False
    app.state.staging_proxy_required = selected_staging_proxy_secret is not None
    return app


__all__ = ["create_app"]
