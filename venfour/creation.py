"""Application service for turning one canonical report PDF into an analysis run."""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from scripts.extract_report_ai import (
    AIExtractionResult,
    OutputValidationError,
    PrototypeError,
    extract_report_with_openai,
    read_canonical_schema,
    validate_extraction,
    validate_input,
)
from venfour.analysis_runs import AnalysisRunRepository
from venfour.discrepancy import (
    DiscrepancyContractError,
    valuation_discrepancy_request_from_report,
)
from venfour.market import MarketProviderError
from venfour.marketcheck import MarketCheckHistoricalProvider, MarketCheckProvider
from venfour.orchestration import (
    AnalysisExecutionError,
    AnalysisInputError,
    AnalysisOrchestrator,
    AnalysisPersistenceError,
    AnalysisRetrievalError,
    AnalysisRunRequest,
    AnalysisRunResult,
    CurrentMarketSearchConfiguration,
    HistoricalMarketSearchConfiguration,
)


Extractor = Callable[[Path, dict[str, Any]], AIExtractionResult]
SchemaLoader = Callable[[], dict[str, Any]]
DateFactory = Callable[[], date]
AvailabilityCheck = Callable[[], None]
OrchestratorFactory = Callable[[date], AnalysisOrchestrator]


class AnalysisCreationError(Exception):
    """Base class for expected analysis-creation failures."""


class AnalysisCreationInputError(AnalysisCreationError):
    """The submitted postal code or local source PDF is invalid."""


class AnalysisExtractionError(AnalysisCreationError):
    """The extraction boundary could not return a usable response."""


class AnalysisReportValidationError(AnalysisCreationError):
    """Extracted report data cannot enter the current analysis pipeline."""


class AnalysisCreationProviderError(AnalysisCreationError):
    """A configured market-evidence provider failed during creation."""


class AnalysisCreationUnavailableError(AnalysisCreationError):
    """Required server-side creation dependencies are unavailable."""


class AnalysisCreationExecutionError(AnalysisCreationError):
    """Creation failed after valid input was accepted."""


@dataclass(frozen=True)
class AnalysisSearchSettings:
    """Server-owned retrieval bounds for every user-created analysis."""

    current_radius_miles: int = 50
    current_result_limit: int = 25
    historical_radius_miles: int = 50
    historical_result_limit: int = 25

    def __post_init__(self) -> None:
        try:
            CurrentMarketSearchConfiguration(
                observed_date="2000-01-01",
                radius_miles=self.current_radius_miles,
                result_limit=self.current_result_limit,
            )
            HistoricalMarketSearchConfiguration(
                radius_miles=self.historical_radius_miles,
                result_limit=self.historical_result_limit,
            )
        except AnalysisInputError as exc:
            raise ValueError("Analysis search settings are invalid") from exc


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


def _normalized_postal_code(value: str) -> str:
    normalized = value.strip() if isinstance(value, str) else value
    if not isinstance(normalized, str) or not normalized:
        raise AnalysisCreationInputError("A verified postal code is required")
    return normalized


class AnalysisCreationService:
    """Extract, validate, orchestrate, and persist one uploaded report."""

    def __init__(
        self,
        orchestrator_factory: OrchestratorFactory,
        *,
        extractor: Extractor = extract_report_with_openai,
        schema_loader: SchemaLoader = read_canonical_schema,
        date_factory: DateFactory = _utc_today,
        search_settings: AnalysisSearchSettings | None = None,
        availability_check: AvailabilityCheck | None = None,
    ) -> None:
        if not callable(orchestrator_factory):
            raise TypeError("orchestrator_factory must be callable")
        if not callable(extractor):
            raise TypeError("extractor must be callable")
        if not callable(schema_loader):
            raise TypeError("schema_loader must be callable")
        if not callable(date_factory):
            raise TypeError("date_factory must be callable")
        if availability_check is not None and not callable(availability_check):
            raise TypeError("availability_check must be callable")
        selected_settings = (
            search_settings
            if search_settings is not None
            else AnalysisSearchSettings()
        )
        if not isinstance(selected_settings, AnalysisSearchSettings):
            raise TypeError("search_settings must be AnalysisSearchSettings")

        self._orchestrator_factory = orchestrator_factory
        self._extractor = extractor
        self._schema_loader = schema_loader
        self._date_factory = date_factory
        self._search_settings = selected_settings
        self._availability_check = availability_check

    def create(self, pdf_path: Path | str, postal_code: str) -> AnalysisRunResult:
        """Create and persist one run from a temporary local PDF."""

        source_path = Path(pdf_path)
        normalized_postal = _normalized_postal_code(postal_code)
        try:
            validate_input(source_path)
        except (PrototypeError, OSError, RuntimeError, TypeError, ValueError) as exc:
            raise AnalysisCreationInputError("Uploaded report is invalid") from exc

        if self._availability_check is not None:
            try:
                self._availability_check()
            except AnalysisCreationUnavailableError:
                raise
            except Exception as exc:
                raise AnalysisCreationUnavailableError(
                    "Analysis creation dependencies are unavailable"
                ) from exc

        try:
            canonical_schema = self._schema_loader()
        except (PrototypeError, OSError, RuntimeError, TypeError, ValueError) as exc:
            raise AnalysisCreationExecutionError(
                "Canonical report validation is unavailable"
            ) from exc

        try:
            extraction = self._extractor(source_path, canonical_schema)
        except OutputValidationError as exc:
            raise AnalysisReportValidationError(
                "Extracted report failed canonical validation"
            ) from exc
        except (PrototypeError, OSError, RuntimeError, TypeError, ValueError) as exc:
            raise AnalysisExtractionError("Report extraction failed") from exc
        if not isinstance(extraction, AIExtractionResult):
            raise AnalysisExtractionError(
                "Report extractor did not return AIExtractionResult"
            )

        try:
            validate_extraction(extraction.data, canonical_schema)
        except OutputValidationError as exc:
            raise AnalysisReportValidationError(
                "Extracted report failed canonical validation"
            ) from exc
        except (PrototypeError, OSError, RuntimeError, TypeError, ValueError) as exc:
            raise AnalysisCreationExecutionError(
                "Canonical report validation could not complete"
            ) from exc
        try:
            observed_date = self._date_factory()
        except Exception as exc:
            raise AnalysisCreationExecutionError(
                "Analysis observation date is unavailable"
            ) from exc
        if not isinstance(observed_date, date) or isinstance(observed_date, datetime):
            raise AnalysisCreationExecutionError(
                "Analysis observation date must be a date"
            )

        try:
            base_request = valuation_discrepancy_request_from_report(
                extraction.data,
                postal_code=normalized_postal,
            )
        except DiscrepancyContractError as exc:
            raise AnalysisReportValidationError(
                "Extracted report cannot be analyzed"
            ) from exc
        if (
            base_request.loss_date is not None
            and date.fromisoformat(base_request.loss_date) > observed_date
        ):
            raise AnalysisReportValidationError(
                "Report loss date cannot be in the future"
            )

        settings = self._search_settings
        current_search = CurrentMarketSearchConfiguration(
            observed_date=observed_date.isoformat(),
            radius_miles=settings.current_radius_miles,
            result_limit=settings.current_result_limit,
        )
        historical_search = (
            HistoricalMarketSearchConfiguration(
                radius_miles=settings.historical_radius_miles,
                result_limit=settings.historical_result_limit,
            )
            if base_request.loss_date is not None
            else None
        )
        request = AnalysisRunRequest(
            ccc_report=extraction.data,
            postal_code=normalized_postal,
            current_search=current_search,
            historical_search=historical_search,
        )

        try:
            orchestrator = self._orchestrator_factory(observed_date)
        except AnalysisCreationUnavailableError:
            raise
        except Exception as exc:
            raise AnalysisCreationExecutionError(
                "Analysis orchestration could not be configured"
            ) from exc
        if not callable(getattr(orchestrator, "run", None)):
            raise AnalysisCreationExecutionError(
                "Analysis orchestrator does not expose run(request)"
            )

        try:
            result = orchestrator.run(request)
        except AnalysisInputError as exc:
            raise AnalysisReportValidationError(
                "Extracted report cannot be analyzed"
            ) from exc
        except AnalysisRetrievalError as exc:
            raise AnalysisCreationProviderError(
                "Market evidence retrieval failed"
            ) from exc
        except (AnalysisExecutionError, AnalysisPersistenceError) as exc:
            raise AnalysisCreationExecutionError("Analysis creation failed") from exc
        if not isinstance(result, AnalysisRunResult):
            raise AnalysisCreationExecutionError(
                "Analysis orchestrator did not return AnalysisRunResult"
            )
        return result


def create_live_analysis_creation_service(
    repository: AnalysisRunRepository,
    *,
    search_settings: AnalysisSearchSettings | None = None,
    date_factory: DateFactory = _utc_today,
) -> AnalysisCreationService:
    """Build the default runtime composition without eager credential checks."""

    if not isinstance(repository, AnalysisRunRepository):
        raise TypeError("repository must implement AnalysisRunRepository save/get")

    def require_configuration() -> None:
        configured = all(
            isinstance(os.environ.get(name), str) and os.environ[name].strip()
            for name in ("OPENAI_API_KEY", "MARKETCHECK_API_KEY")
        )
        if not configured:
            raise AnalysisCreationUnavailableError(
                "Analysis creation dependencies are unavailable"
            )

    def orchestrator_factory(as_of_date: date) -> AnalysisOrchestrator:
        api_key = os.environ.get("MARKETCHECK_API_KEY")
        try:
            current_provider = MarketCheckProvider(api_key)
            historical_provider = MarketCheckHistoricalProvider(
                api_key,
                as_of_date=as_of_date,
            )
        except (MarketProviderError, TypeError, ValueError) as exc:
            raise AnalysisCreationUnavailableError(
                "Analysis creation dependencies are unavailable"
            ) from exc
        return AnalysisOrchestrator(
            repository,
            current_provider=current_provider,
            historical_provider=historical_provider,
        )

    return AnalysisCreationService(
        orchestrator_factory,
        date_factory=date_factory,
        search_settings=search_settings,
        availability_check=require_configuration,
    )


__all__ = [
    "AnalysisCreationError",
    "AnalysisCreationExecutionError",
    "AnalysisCreationInputError",
    "AnalysisCreationProviderError",
    "AnalysisCreationService",
    "AnalysisCreationUnavailableError",
    "AnalysisExtractionError",
    "AnalysisReportValidationError",
    "AnalysisSearchSettings",
    "create_live_analysis_creation_service",
]
