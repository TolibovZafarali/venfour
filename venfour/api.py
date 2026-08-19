"""HTTP creation and presentation boundaries for Venfour analyses.

The presentation route remains a read-only projection over persisted artifacts.
The collection route validates a bounded temporary upload and delegates all
creation work to an application service. Application dependencies are selected
by :func:`create_app`; this module has no process-global service instance.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any, Awaitable, Callable
from uuid import UUID

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

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
    "REPORT_REQUIRED": "A CCC PDF report is required.",
    "POSTAL_CODE_REQUIRED": "A postalCode is required.",
    "INVALID_POSTAL_CODE": (
        "postalCode must be a 5-digit US ZIP code or ZIP+4."
    ),
    "INVALID_REPORT": "Uploaded report is invalid.",
    "REPORT_TOO_LARGE": "Uploaded report is too large.",
    "REPORT_EXTRACTION_FAILED": "Uploaded report could not be extracted.",
    "REPORT_NOT_ANALYZABLE": "Uploaded report could not be analyzed.",
    "MARKET_PROVIDER_UNAVAILABLE": "Market evidence is temporarily unavailable.",
    "ANALYSIS_CREATION_UNAVAILABLE": "Analysis creation is unavailable.",
    "ANALYSIS_CREATION_FAILED": "Analysis could not be created.",
    "INVALID_ANALYSIS_REQUEST": "Analysis request must not contain a body.",
    "REPORT_INTAKE_REQUIRED": "Complete report intake before starting analysis.",
    "REPORT_INTAKE_NOT_READY": "Report intake is not ready for analysis.",
    "CASE_NOT_READY": "Appraisal case is not ready for analysis.",
}

LEGACY_API_ENVIRONMENT_NAME = "VENFOUR_ENABLE_LEGACY_ANALYSIS_API"

MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024
MAX_UPLOAD_BODY_BYTES = MAX_PDF_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
MAX_MULTIPART_FIELD_BYTES = 1024
UPLOAD_COPY_CHUNK_BYTES = 1024 * 1024

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


def _health(_request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


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
    supabase_gateway: CaseAnalysisGateway | None = None,
    enable_legacy_api: bool | None = None,
) -> Starlette:
    """Build the owned case API and optional legacy upload API.

    The default composition is Supabase-backed and authenticated.  Supplying
    a legacy dependency is an explicit test/development opt-in for the old
    unauthenticated upload and presentation routes.
    """

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
    if selected_case_service is None:
        selected_gateway = supabase_gateway
        if selected_gateway is None:
            try:
                selected_gateway = SupabaseHttpGateway(
                    SupabaseServerConfiguration.from_environment()
                )
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

    routes = [
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
    ]
    if legacy_enabled:
        routes.insert(
            0,
            Route("/api/v1/analyses", _create_analysis, methods=["POST"]),
        )

    app = Starlette(
        routes=routes,
        exception_handlers={
            HTTPException: _http_exception_response,
            Exception: _internal_error_response,
        },
    )
    app.router.redirect_slashes = False
    app.state.presentation_service = selected_service
    app.state.creation_service = selected_creation_service
    app.state.case_analysis_service = selected_case_service
    app.state.legacy_api_enabled = legacy_enabled
    return app


__all__ = ["create_app"]
