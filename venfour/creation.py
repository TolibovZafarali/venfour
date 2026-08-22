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
from venfour.adaptive_search import (
    DEFAULT_ADAPTIVE_SEARCH_POLICIES,
    AdaptiveSearchPolicies,
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
    RunIdFactory,
)
from venfour.postal_codes import normalize_us_zip_code


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


class AnalysisUnsupportedReportError(AnalysisCreationError):
    """The report provider is outside the supported automated workflow."""


class AnalysisCreationProviderError(AnalysisCreationError):
    """A configured market-evidence provider failed during creation."""


class AnalysisCreationUnavailableError(AnalysisCreationError):
    """Required server-side creation dependencies are unavailable."""


class AnalysisCreationExecutionError(AnalysisCreationError):
    """Creation failed after valid input was accepted."""


@dataclass(frozen=True)
class AnalysisSearchSettings:
    """Server-owned, stream-specific policies for user-created analyses."""

    search_policies: AdaptiveSearchPolicies = DEFAULT_ADAPTIVE_SEARCH_POLICIES

    def __post_init__(self) -> None:
        if not isinstance(self.search_policies, AdaptiveSearchPolicies):
            raise ValueError("Analysis search settings are invalid")


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


def _normalized_postal_code(value: str) -> str:
    try:
        return normalize_us_zip_code(value)
    except (TypeError, ValueError) as exc:
        raise AnalysisCreationInputError(
            "A 5-digit US ZIP code or ZIP+4 is required"
        ) from exc


def _is_supported_ccc_provider(value: Any) -> bool:
    """Return whether extraction identified CCC as the printed report provider."""

    if not isinstance(value, str):
        return False
    return value.strip().upper() in {"CCC", "CCC ONE"}


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

        report = extraction.data.get("report")
        provider = report.get("provider") if isinstance(report, dict) else None
        if not _is_supported_ccc_provider(provider):
            raise AnalysisUnsupportedReportError(
                "The automated tester workflow supports CCC reports only"
            )

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
        )
        historical_search = (
            HistoricalMarketSearchConfiguration()
            if base_request.loss_date is not None
            else None
        )
        request = AnalysisRunRequest(
            ccc_report=extraction.data,
            postal_code=normalized_postal,
            current_search=current_search,
            historical_search=historical_search,
            search_policies=settings.search_policies,
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
    run_id_factory: RunIdFactory | None = None,
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
            run_id_factory=run_id_factory,
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
    "AnalysisUnsupportedReportError",
    "AnalysisSearchSettings",
    "create_live_analysis_creation_service",
]
