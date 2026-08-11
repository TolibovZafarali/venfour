"""Read-only HTTP presentation boundary for persisted Venfour analyses.

Phase 3F exposes the deterministic Phase 3E presentation contract without
reading artifacts, invoking providers, or performing analysis in the HTTP
layer.  Application dependencies are selected by :func:`create_app`; this
module intentionally has no process-global application or service instance.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from uuid import UUID

from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

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
from venfour.presentation import (
    AnalysisPresentationContractError,
    AnalysisPresentationService,
)


_ERROR_MESSAGES = {
    "INVALID_RUN_ID": "Analysis run ID is invalid.",
    "ANALYSIS_NOT_FOUND": "Analysis run was not found.",
    "ANALYSIS_UNAVAILABLE": "Analysis run is unavailable.",
    "INTERNAL_ERROR": "An internal server error occurred.",
    "ROUTE_NOT_FOUND": "Route was not found.",
    "METHOD_NOT_ALLOWED": "Method is not allowed.",
}

_ANALYSIS_UNAVAILABLE_ERRORS = (
    InvalidAnalysisRunArtifactError,
    AnalysisRunRepositoryError,
    AnalysisRunValidationUnavailableError,
    AnalysisRunContractError,
    AnalysisPresentationContractError,
)


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
    repository: AnalysisRunRepository | None = None,
    repository_root: Path | str | None = None,
) -> Starlette:
    """Build the read-only API with one explicit presentation dependency.

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

    selected_service = presentation_service
    if selected_service is None:
        selected_repository = repository
        if selected_repository is None:
            selected_repository = FileAnalysisRunRepository(
                repository_root
                if repository_root is not None
                else DEFAULT_ANALYSIS_RUN_DIR
            )
        selected_service = AnalysisPresentationService(selected_repository)
    elif not callable(getattr(selected_service, "get", None)):
        raise TypeError("presentation_service must expose get(run_id)")

    app = Starlette(
        routes=[
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
    return app


__all__ = ["create_app"]
