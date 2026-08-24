"""Application service for turning one canonical report PDF into an analysis run."""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping
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
from venfour.report_ingestion import (
    NormalizedReportContractError,
    ReportDocumentInvalidError,
    ReportExtractionError,
    ReportIngestionService,
    normalized_report_to_legacy_report,
)
from venfour.valuation_inputs import (
    ConfirmedValuationInput,
    ValuationInputError,
    confirmed_normalized_report,
    evidence_context,
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


class AnalysisConfirmedInputError(AnalysisCreationInputError):
    """The immutable database-confirmed intake snapshot is incomplete."""


class AnalysisExtractionError(AnalysisCreationError):
    """The extraction boundary could not return a usable response."""


class AnalysisReportValidationError(AnalysisCreationError):
    """Extracted report data cannot enter the current analysis pipeline."""


class AnalysisUnsupportedReportError(AnalysisCreationError):
    """Deprecated compatibility error; provider identity is no longer a gate."""


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
        ingestion_service: ReportIngestionService | None = None,
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
        if ingestion_service is not None and not callable(
            getattr(ingestion_service, "ingest", None)
        ):
            raise TypeError("ingestion_service must expose ingest(pdf_path)")
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
        self._ingestion_service = ingestion_service

    def _require_availability(self) -> None:
        if self._availability_check is None:
            return
        try:
            self._availability_check()
        except AnalysisCreationUnavailableError:
            raise
        except Exception as exc:
            raise AnalysisCreationUnavailableError(
                "Analysis creation dependencies are unavailable"
            ) from exc

    def _observed_date(self) -> date:
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
        return observed_date

    @staticmethod
    def _legacy_evidence_context(report_data: Mapping[str, Any]) -> dict[str, Any]:
        report = report_data.get("report")
        vehicle = report_data.get("vehicle")
        valuation = report_data.get("valuation")
        condition = report_data.get("condition")
        comparables = report_data.get("comparables")
        provider = report.get("provider") if isinstance(report, Mapping) else None
        adjusted_value = (
            valuation.get("adjustedVehicleValue")
            if isinstance(valuation, Mapping)
            else None
        )
        comparable_rows = comparables if isinstance(comparables, list) else []
        adjustments_available = any(
            isinstance(row, Mapping)
            and isinstance(row.get("adjustments"), Mapping)
            and any(value is not None for value in row["adjustments"].values())
            for row in comparable_rows
        )
        provider_name = (
            provider.strip()
            if isinstance(provider, str) and provider.strip()
            else None
        )
        return {
            "inputMode": "REPORT",
            "reportAvailable": True,
            "reportExtractionAvailable": True,
            "reportProvider": provider_name,
            "reportAdapter": (
                "CCC"
                if provider_name is not None
                and provider_name.casefold() in {"ccc", "ccc one"}
                else "GENERIC"
            ),
            "partialExtraction": False,
            "offerAvailable": False,
            "insurerValuationAvailable": adjusted_value is not None,
            "reportComparablesAvailable": bool(comparable_rows),
            "reportAdjustmentsAvailable": adjustments_available,
            "conditionInformationAvailable": bool(
                isinstance(condition, Mapping) and condition.get("items")
            ),
            "optionsInformationAvailable": bool(
                isinstance(vehicle, Mapping) and vehicle.get("equipment")
            ),
            "conditionAndOptionsDollarAdjusted": False,
        }

    def _run_legacy_report(
        self,
        report_data: Mapping[str, Any],
        postal_code: str,
        *,
        loss_date_override: str | None = None,
        selected_evidence_context: Mapping[str, Any] | None = None,
    ) -> AnalysisRunResult:
        normalized_postal = _normalized_postal_code(postal_code)
        self._require_availability()
        observed_date = self._observed_date()
        try:
            base_request = valuation_discrepancy_request_from_report(
                report_data,
                postal_code=normalized_postal,
            )
        except DiscrepancyContractError as exc:
            raise AnalysisReportValidationError(
                "Valuation information cannot be analyzed"
            ) from exc
        effective_loss_date = loss_date_override or base_request.loss_date
        if (
            effective_loss_date is not None
            and date.fromisoformat(effective_loss_date) > observed_date
        ):
            raise AnalysisReportValidationError(
                "Date of loss cannot be in the future"
            )
        current_search = CurrentMarketSearchConfiguration(
            observed_date=observed_date.isoformat(),
        )
        historical_search = (
            HistoricalMarketSearchConfiguration()
            if effective_loss_date is not None
            else None
        )
        request = AnalysisRunRequest(
            ccc_report=report_data,
            postal_code=normalized_postal,
            loss_date_override=loss_date_override,
            current_search=current_search,
            historical_search=historical_search,
            evidence_context=(
                selected_evidence_context
                if selected_evidence_context is not None
                else self._legacy_evidence_context(report_data)
            ),
            search_policies=self._search_settings.search_policies,
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
                "Valuation information cannot be analyzed"
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

    def create(self, pdf_path: Path | str, postal_code: str) -> AnalysisRunResult:
        """Create a provider-neutral report run from a temporary canonical PDF."""

        source_path = Path(pdf_path)
        _normalized_postal_code(postal_code)
        self._require_availability()
        if self._ingestion_service is not None:
            try:
                ingestion = self._ingestion_service.ingest(source_path)
                report_data = normalized_report_to_legacy_report(
                    ingestion.to_dict()["normalizedReport"]
                )
            except ReportDocumentInvalidError as exc:
                raise AnalysisCreationInputError("Uploaded report is invalid") from exc
            except ReportExtractionError as exc:
                raise AnalysisExtractionError("Report extraction failed") from exc
            except NormalizedReportContractError as exc:
                raise AnalysisReportValidationError(
                    "Extracted report failed normalized validation"
                ) from exc
            context = self._legacy_evidence_context(report_data)
            context.update(
                {
                    "reportProvider": ingestion.provider,
                    "reportAdapter": ingestion.adapter,
                    "partialExtraction": ingestion.partial,
                    "offerAvailable": ingestion.normalized_report["valuation"][
                        "insurerOffer"
                    ]
                    is not None,
                }
            )
            return self._run_legacy_report(
                report_data,
                postal_code,
                selected_evidence_context=context,
            )

        try:
            validate_input(source_path)
        except (PrototypeError, OSError, RuntimeError, TypeError, ValueError) as exc:
            raise AnalysisCreationInputError("Uploaded report is invalid") from exc

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

        return self._run_legacy_report(extraction.data, postal_code)

    def create_from_confirmed_input(
        self,
        input_snapshot: Mapping[str, Any],
        *,
        normalized_report: Mapping[str, Any] | None = None,
        report_adapter: str | None = None,
        partial_extraction: bool = False,
        report_extraction_available: bool | None = None,
    ) -> AnalysisRunResult:
        """Create a report or manual run from a trusted immutable DB snapshot."""

        try:
            confirmed = ConfirmedValuationInput.from_snapshot(input_snapshot)
            normalized = confirmed_normalized_report(
                confirmed, normalized_report
            )
            report_data = normalized_report_to_legacy_report(normalized)
            selected_adapter = report_adapter
            if normalized_report is not None and selected_adapter is None:
                selected_adapter = "GENERIC"
            context = evidence_context(
                confirmed,
                normalized,
                adapter=selected_adapter,
                partial_extraction=partial_extraction,
                report_extraction_available=(
                    normalized_report is not None
                    if report_extraction_available is None
                    else report_extraction_available
                ),
            )
        except (ValuationInputError, NormalizedReportContractError) as exc:
            raise AnalysisConfirmedInputError(
                "Confirmed valuation information is incomplete"
            ) from exc
        return self._run_legacy_report(
            report_data,
            confirmed.postal_code,
            loss_date_override=confirmed.loss_date,
            selected_evidence_context=context,
        )


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
        configured = isinstance(os.environ.get("MARKETCHECK_API_KEY"), str) and bool(
            os.environ["MARKETCHECK_API_KEY"].strip()
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
        ingestion_service=ReportIngestionService(),
    )


__all__ = [
    "AnalysisConfirmedInputError",
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
