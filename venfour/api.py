"""HTTP creation and presentation boundaries for Venfour analyses.

The presentation route remains a read-only projection over persisted artifacts.
The collection route validates a bounded temporary upload and delegates all
creation work to an application service. Application dependencies are selected
by :func:`create_app`; this module has no process-global service instance.
"""

from __future__ import annotations

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
from venfour.presentation import (
    AnalysisPresentationContractError,
    AnalysisPresentationService,
)
from venfour.postal_codes import normalize_us_zip_code


_ERROR_MESSAGES = {
    "INVALID_RUN_ID": "Analysis run ID is invalid.",
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
}

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
    if report.size >= MAX_PDF_BYTES:
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
                if copied_bytes >= MAX_PDF_BYTES:
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
) -> Starlette:
    """Build the API with explicit creation and presentation dependencies.

    A caller may inject a presentation service, a repository, or an isolated
    repository root.  These alternatives are mutually exclusive so the
    selected dependency flow is unambiguous.
    """

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

    selected_creation_service = creation_service
    if selected_creation_service is None and selected_repository is not None:
        selected_creation_service = create_live_analysis_creation_service(
            selected_repository
        )
    if selected_creation_service is not None and not callable(
        getattr(selected_creation_service, "create", None)
    ):
        raise TypeError("creation_service must expose create(pdf_path, postal_code)")

    app = Starlette(
        routes=[
            Route("/api/v1/analyses", _create_analysis, methods=["POST"]),
            Route(
                "/api/v1/analyses/{run_id}",
                _analysis_presentation,
                methods=["GET"],
            ),
            Route("/health", _health, methods=["GET"]),
        ],
        exception_handlers={
            HTTPException: _http_exception_response,
            Exception: _internal_error_response,
        },
    )
    app.router.redirect_slashes = False
    app.state.presentation_service = selected_service
    app.state.creation_service = selected_creation_service
    return app


__all__ = ["create_app"]
