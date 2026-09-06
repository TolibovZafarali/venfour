"""Provider-neutral application orchestration for a complete analysis run.

This module coordinates existing CCC projection, provider discovery, Phase 3C
ranking, Phase 3D analysis, and immutable audit persistence.  It owns no market
matching, ranking, historical-resolution, or discrepancy business rules.
"""

from __future__ import annotations

import copy
import json
import logging
import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from venfour.adaptive_search import (
    DEFAULT_ADAPTIVE_SEARCH_POLICIES,
    AdaptiveSearchContractError,
    AdaptiveSearchPolicies,
    AdaptiveSearchPolicy,
    adaptive_discover_historical_market_evidence,
    adaptive_discover_market_listings,
    adaptive_search_policy_for_provider,
)
from venfour.analysis_runs import (
    AnalysisRunArtifact,
    AnalysisRunContractError,
    AnalysisRunRepository,
    AnalysisRunValidationUnavailableError,
    ProviderMetadata,
    discrepancy_request_digest,
    search_diagnostics_digest,
    validate_analysis_run_artifact,
)
from venfour.comparables import ComparableContractError
from venfour.discrepancy import (
    CurrentEvidenceInput,
    DiscrepancyContractError,
    HistoricalEvidenceInput,
    ValuationDiscrepancyAnalyzer,
    ValuationDiscrepancyPolicy,
    ValuationDiscrepancyResult,
    validate_valuation_discrepancy_request,
    validate_valuation_discrepancy_result,
    valuation_discrepancy_request_from_report,
)
from venfour.historical_market import (
    HistoricalMarketProvider,
    HistoricalMarketSearchRequest,
    normalize_historical_market_search_request,
)
from venfour.market import (
    MarketContractError,
    MarketProvider,
    MarketProviderAuthenticationError,
    MarketProviderDiagnostic,
    MarketProviderError,
    MarketProviderRateLimitError,
    MarketProviderResponseError,
    MarketProviderUnavailableError,
    MarketSearchRequest,
    VehicleConfigurationIdentity,
    normalize_market_search_request,
)
from venfour.preliminary_qualification import qualify_preliminary


RunIdFactory = Callable[[], UUID | str]
Clock = Callable[[], datetime]


class _UnspecifiedQualificationSource:
    """Keep direct report calls distinct from explicitly unavailable sources."""


_UNSPECIFIED_QUALIFICATION_SOURCE = _UnspecifiedQualificationSource()

_PROVIDER_DIAGNOSTICS_ENV = "VENFOUR_PROVIDER_DIAGNOSTICS"
_PROVIDER_DIAGNOSTICS_LOGGER = logging.getLogger("venfour.provider_diagnostics")
_PROVIDER_DIAGNOSTIC_STAGES = {
    "active": "current_inventory_search",
    "recents": "historical_candidate_discovery",
    "history": "vin_history_verification",
}
_PROVIDER_ERROR_CLASSES = (
    MarketProviderAuthenticationError,
    MarketProviderRateLimitError,
    MarketProviderUnavailableError,
    MarketProviderResponseError,
    MarketProviderError,
)


def _provider_error_class(failure: MarketProviderError) -> str:
    return next(
        error_type.__name__
        for error_type in _PROVIDER_ERROR_CLASSES
        if isinstance(failure, error_type)
    )


class AnalysisOrchestrationError(Exception):
    """Base class for expected application-layer analysis failures."""


class AnalysisInputError(AnalysisOrchestrationError):
    """The normalized CCC input or orchestration configuration is invalid."""

    def __init__(self, message: str, details: tuple[str, ...] = ()) -> None:
        super().__init__(message)
        self.details = details


class AnalysisRetrievalError(AnalysisOrchestrationError):
    """A current or historical provider failed before analysis could complete."""

    def __init__(
        self,
        stage: str,
        provider_error_type: str,
        diagnostic: MarketProviderDiagnostic | None = None,
    ) -> None:
        super().__init__(f"{stage.capitalize()} market retrieval failed")
        self.stage = stage
        self.provider_error_type = provider_error_type
        self.diagnostic = diagnostic


def _emit_local_provider_diagnostic(
    stream: str, failure: MarketProviderError
) -> None:
    """Log only fixed, allowlisted provider fields when explicitly enabled."""

    if os.environ.get(_PROVIDER_DIAGNOSTICS_ENV) != "1":
        return
    diagnostic = failure.diagnostic
    endpoint_category = (
        diagnostic.endpoint_category if diagnostic is not None else None
    )
    payload: dict[str, Any] = {
        "event": "market_provider_failure",
        "stream": stream,
        "stage": _PROVIDER_DIAGNOSTIC_STAGES.get(
            endpoint_category, "provider_boundary"
        ),
        "providerErrorClass": _provider_error_class(failure),
    }
    if diagnostic is not None:
        payload.update(diagnostic.to_dict())
    _PROVIDER_DIAGNOSTICS_LOGGER.warning(
        "%s", json.dumps(payload, sort_keys=True, separators=(",", ":"))
    )


class AnalysisExecutionError(AnalysisOrchestrationError):
    """Canonical pipeline stages could not produce a valid deterministic result."""


class AnalysisPersistenceError(AnalysisOrchestrationError):
    """Analysis completed, but its audit artifact was not successfully saved."""

    def __init__(self, run_id: str) -> None:
        super().__init__(
            f"Analysis run {run_id} completed but its audit artifact was not saved"
        )
        self.run_id = run_id


def _canonical_date(value: str, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise AnalysisInputError(
            "Analysis date failed contract validation",
            (f"{path}: expected an ISO YYYY-MM-DD date",),
        )
    normalized = value.strip()
    try:
        parsed = date.fromisoformat(normalized)
    except ValueError as exc:
        raise AnalysisInputError(
            "Analysis date failed contract validation",
            (f"{path}: expected an ISO YYYY-MM-DD date",),
        ) from exc
    if parsed.isoformat() != normalized:
        raise AnalysisInputError(
            "Analysis date failed contract validation",
            (f"{path}: expected an ISO YYYY-MM-DD date",),
        )
    return normalized


@dataclass(frozen=True)
class CurrentMarketSearchConfiguration:
    """Current-market observation provenance for an adaptive search."""

    observed_date: str

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "observed_date",
            _canonical_date(self.observed_date, "$.currentSearch.observedDate"),
        )


@dataclass(frozen=True)
class HistoricalMarketSearchConfiguration:
    """Enable adaptive historical retrieval for the normalized loss date."""


@dataclass(frozen=True)
class AnalysisRunRequest:
    """One complete application-layer analysis attempt.

    Presence of a search configuration enables that temporal stream. The
    server-owned adaptive policy controls every bounded search attempt.

    ``qualification_source_report`` preserves printed report facts separately
    from customer-confirmed analysis inputs. Direct report callers default to
    ``ccc_report``; callers with an unavailable source must pass ``None``.
    """

    ccc_report: Mapping[str, Any]
    postal_code: str | None = None
    loss_date_override: str | None = None
    current_search: CurrentMarketSearchConfiguration | None = None
    historical_search: HistoricalMarketSearchConfiguration | None = None
    evidence_context: Mapping[str, Any] | None = None
    qualification_source_report: (
        Mapping[str, Any] | None | _UnspecifiedQualificationSource
    ) = _UNSPECIFIED_QUALIFICATION_SOURCE
    vehicle_configuration: VehicleConfigurationIdentity | None = None
    search_policies: AdaptiveSearchPolicies = field(
        default_factory=lambda: DEFAULT_ADAPTIVE_SEARCH_POLICIES
    )
    discrepancy_policy: ValuationDiscrepancyPolicy = field(
        default_factory=ValuationDiscrepancyPolicy
    )

    def __post_init__(self) -> None:
        if not isinstance(self.ccc_report, Mapping):
            raise AnalysisInputError(
                "Normalized CCC report must be a JSON object",
                ("$.cccReport: expected an object",),
            )
        object.__setattr__(self, "ccc_report", copy.deepcopy(dict(self.ccc_report)))
        if self.evidence_context is not None:
            if not isinstance(self.evidence_context, Mapping):
                raise AnalysisInputError(
                    "Analysis evidence context failed contract validation",
                    ("$.evidenceContext: expected an object or null",),
                )
            object.__setattr__(
                self,
                "evidence_context",
                copy.deepcopy(dict(self.evidence_context)),
            )
        source_report = self.qualification_source_report
        if source_report is _UNSPECIFIED_QUALIFICATION_SOURCE:
            source_report = (
                self.ccc_report
                if self.evidence_context is None
                or self.evidence_context.get("inputMode") == "REPORT"
                else None
            )
        if source_report is not None and not isinstance(source_report, Mapping):
            raise AnalysisInputError(
                "Qualification source report must be a JSON object or null",
                ("$.qualificationSourceReport: expected an object or null",),
            )
        object.__setattr__(
            self,
            "qualification_source_report",
            copy.deepcopy(dict(source_report)) if source_report is not None else None,
        )
        normalized_postal = (
            self.postal_code.strip()
            if isinstance(self.postal_code, str)
            else self.postal_code
        )
        if normalized_postal == "":
            normalized_postal = None
        if normalized_postal is not None and not isinstance(normalized_postal, str):
            raise AnalysisInputError(
                "Analysis postal code failed contract validation",
                ("$.postalCode: expected a string or null",),
            )
        object.__setattr__(self, "postal_code", normalized_postal)
        if self.loss_date_override is not None and not isinstance(
            self.loss_date_override, str
        ):
            raise AnalysisInputError(
                "Analysis loss-date override failed contract validation",
                ("$.lossDateOverride: expected a string or null",),
            )
        if self.current_search is not None and not isinstance(
            self.current_search, CurrentMarketSearchConfiguration
        ):
            raise AnalysisInputError(
                "Current market search configuration is invalid"
            )
        if self.historical_search is not None and not isinstance(
            self.historical_search, HistoricalMarketSearchConfiguration
        ):
            raise AnalysisInputError(
                "Historical market search configuration is invalid"
            )
        if self.vehicle_configuration is not None and not isinstance(
            self.vehicle_configuration, VehicleConfigurationIdentity
        ):
            raise AnalysisInputError("Vehicle configuration identity is invalid")
        if not isinstance(self.discrepancy_policy, ValuationDiscrepancyPolicy):
            raise AnalysisInputError("Discrepancy policy is invalid")
        if not isinstance(self.search_policies, AdaptiveSearchPolicies):
            raise AnalysisInputError("Adaptive search policies are invalid")


@dataclass(frozen=True)
class AnalysisRunResult:
    """A complete analysis run returned only after successful persistence."""

    artifact: AnalysisRunArtifact

    @property
    def run_id(self) -> str:
        return self.artifact.run_id

    @property
    def created_at(self) -> str:
        return self.artifact.created_at

    @property
    def discrepancy_result(self) -> Mapping[str, Any]:
        return self.artifact.to_dict()["result"]["discrepancyResult"]

    @property
    def classification(self) -> str:
        return self.artifact.result["discrepancyResult"]["classification"]


class AnalysisOrchestrator:
    """Coordinate existing deterministic stages and persist one audit record."""

    def __init__(
        self,
        repository: AnalysisRunRepository,
        *,
        current_provider: MarketProvider | None = None,
        historical_provider: HistoricalMarketProvider | None = None,
        current_provider_version: str | None = None,
        historical_provider_version: str | None = None,
        analyzer: ValuationDiscrepancyAnalyzer | None = None,
        run_id_factory: RunIdFactory | None = None,
        clock: Clock | None = None,
    ) -> None:
        if not isinstance(repository, AnalysisRunRepository):
            raise AnalysisInputError(
                "Analysis run repository does not implement save/get"
            )
        self._repository = repository
        self._current_provider = current_provider
        self._historical_provider = historical_provider
        self._current_provider_version = self._normalize_provider_version(
            current_provider_version, "$.currentProviderVersion"
        )
        self._historical_provider_version = self._normalize_provider_version(
            historical_provider_version, "$.historicalProviderVersion"
        )
        self._analyzer = analyzer if analyzer is not None else ValuationDiscrepancyAnalyzer()
        if not callable(getattr(self._analyzer, "analyze", None)):
            raise AnalysisInputError("Discrepancy analyzer must expose analyze(request)")
        self._run_id_factory = run_id_factory if run_id_factory is not None else uuid4
        self._clock = clock if clock is not None else lambda: datetime.now(timezone.utc)

    @staticmethod
    def _normalize_provider_version(value: str | None, path: str) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str) or not value.strip():
            raise AnalysisInputError(
                "Provider version metadata failed contract validation",
                (f"{path}: expected a non-empty string or null",),
            )
        return value.strip()

    @staticmethod
    def _validate_normalized_report(report: Mapping[str, Any]) -> None:
        try:
            from scripts.extract_report_ai import (
                OutputValidationError,
                PrototypeError,
            )
            from venfour.report_ingestion import (
                NormalizedReportContractError,
                validate_effective_report,
            )
        except ImportError as exc:
            raise AnalysisExecutionError(
                "Canonical CCC validation support is unavailable"
            ) from exc
        try:
            validate_effective_report(report)
        except NormalizedReportContractError as exc:
            raise AnalysisInputError(
                "Normalized report failed validation", tuple(exc.details)
            ) from exc
        except OutputValidationError as exc:
            raise AnalysisInputError(
                "Normalized CCC report failed validation", tuple(exc.errors)
            ) from exc
        except (PrototypeError, OSError, TypeError, ValueError) as exc:
            raise AnalysisExecutionError(
                "Normalized CCC report validation could not complete"
            ) from exc

    @staticmethod
    def _new_run_id(factory: RunIdFactory) -> str:
        try:
            raw = factory()
        except Exception as exc:
            raise AnalysisExecutionError("Run ID factory failed") from exc
        try:
            parsed = raw if isinstance(raw, UUID) else UUID(raw)
        except (TypeError, ValueError, AttributeError) as exc:
            raise AnalysisExecutionError(
                "Run ID factory did not produce a UUID"
            ) from exc
        if parsed.version != 4:
            raise AnalysisExecutionError("Run ID factory must produce UUIDv4 values")
        return str(parsed)

    @staticmethod
    def _created_at(clock: Clock) -> str:
        try:
            value = clock()
        except Exception as exc:
            raise AnalysisExecutionError("Analysis clock failed") from exc
        if not isinstance(value, datetime) or value.tzinfo is None:
            raise AnalysisExecutionError(
                "Analysis clock must produce a timezone-aware datetime"
            )
        try:
            offset = value.utcoffset()
        except Exception as exc:
            raise AnalysisExecutionError("Analysis clock timezone is invalid") from exc
        if offset is None:
            raise AnalysisExecutionError(
                "Analysis clock must produce a timezone-aware datetime"
            )
        try:
            return (
                value.astimezone(timezone.utc)
                .isoformat(timespec="microseconds")
                .replace("+00:00", "Z")
            )
        except (OverflowError, ValueError) as exc:
            raise AnalysisExecutionError(
                "Analysis clock could not be normalized to UTC"
            ) from exc

    @staticmethod
    def _current_request(
        base: Any,
        policy: AdaptiveSearchPolicy,
        configuration: VehicleConfigurationIdentity | None = None,
    ) -> MarketSearchRequest:
        first_stage = policy.stages[0]
        return normalize_market_search_request(
            MarketSearchRequest(
                year=base.loss_vehicle.year,
                make=base.loss_vehicle.make,
                model=base.loss_vehicle.model,
                trim=base.loss_vehicle.trim,
                drivetrain=base.loss_vehicle.drivetrain,
                drivetrain_recorded=base.loss_vehicle.drivetrain_recorded,
                configuration=configuration,
                loss_vehicle_mileage=base.loss_vehicle.mileage,
                postal_code=base.loss_vehicle.postal_code,
                radius_miles=first_stage.radius_miles,
                result_limit=first_stage.result_limit,
            )
        )

    @staticmethod
    def _historical_request(
        base: Any,
        policy: AdaptiveSearchPolicy,
        configuration: VehicleConfigurationIdentity | None = None,
    ) -> HistoricalMarketSearchRequest:
        if base.loss_date is None:
            raise AnalysisInputError(
                "Historical retrieval requires a normalized loss date",
                ("$.lossDate: historical search is configured",),
            )
        if base.loss_vehicle.postal_code is None:
            raise AnalysisInputError(
                "Historical retrieval requires a postal code",
                ("$.postalCode: historical search is configured",),
            )
        first_stage = policy.stages[0]
        return normalize_historical_market_search_request(
            HistoricalMarketSearchRequest(
                evidence_date=base.loss_date,
                year=base.loss_vehicle.year,
                make=base.loss_vehicle.make,
                model=base.loss_vehicle.model,
                trim=base.loss_vehicle.trim,
                drivetrain=base.loss_vehicle.drivetrain,
                drivetrain_recorded=base.loss_vehicle.drivetrain_recorded,
                configuration=configuration,
                loss_vehicle_mileage=base.loss_vehicle.mileage,
                postal_code=base.loss_vehicle.postal_code,
                radius_miles=first_stage.radius_miles,
                result_limit=first_stage.result_limit,
            )
        )

    @staticmethod
    def _effective_policy_for_provider(
        policy: AdaptiveSearchPolicy,
        provider: object,
        stream: str,
    ) -> AdaptiveSearchPolicy:
        """Constrain configured stages to an adapter's declared geography."""

        try:
            return adaptive_search_policy_for_provider(policy, provider)
        except AdaptiveSearchContractError as exc:
            raise AnalysisInputError(
                f"{stream.capitalize()} provider capability is invalid",
                tuple(exc.details),
            ) from exc

    def run(self, request: AnalysisRunRequest) -> AnalysisRunResult:
        """Execute one complete run, returning only after its artifact is saved."""

        if not isinstance(request, AnalysisRunRequest):
            raise AnalysisInputError("request must be AnalysisRunRequest")
        self._validate_normalized_report(request.ccc_report)
        if request.qualification_source_report is not None:
            self._validate_normalized_report(request.qualification_source_report)
        try:
            base_request = valuation_discrepancy_request_from_report(
                request.ccc_report,
                postal_code=request.postal_code,
                loss_date_override=request.loss_date_override,
                policy=request.discrepancy_policy,
            )
            validate_valuation_discrepancy_request(base_request)
        except (DiscrepancyContractError, ComparableContractError) as exc:
            raise AnalysisInputError(
                "Normalized CCC analysis inputs failed projection",
                tuple(getattr(exc, "details", ())),
            ) from exc

        if (
            request.historical_search is not None
            and self._historical_provider is None
        ):
            raise AnalysisInputError(
                "Historical search is configured without a historical provider"
            )
        if request.current_search is not None and self._current_provider is None:
            raise AnalysisInputError(
                "Current search is configured without a current provider"
            )

        configured_current_policy = request.search_policies.current
        current_policy = configured_current_policy
        historical_policy = request.search_policies.historical
        if request.current_search is not None:
            current_policy = self._effective_policy_for_provider(
                current_policy, self._current_provider, "current"
            )
        if request.historical_search is not None:
            historical_policy = self._effective_policy_for_provider(
                historical_policy, self._historical_provider, "historical"
            )
        effective_search_policies = AdaptiveSearchPolicies(
            current=current_policy,
            historical=historical_policy,
        )

        try:
            current_search_request = (
                self._current_request(
                    base_request,
                    current_policy,
                    request.vehicle_configuration,
                )
                if request.current_search is not None
                else None
            )
            historical_search_request = (
                self._historical_request(
                    base_request,
                    historical_policy,
                    request.vehicle_configuration,
                )
                if request.historical_search is not None
                else None
            )
        except MarketContractError as exc:
            raise AnalysisInputError(
                "Market search configuration failed canonical validation",
                tuple(getattr(exc, "details", ())),
            ) from exc

        historical_result = None
        historical_ranking = None
        historical_input = None
        historical_diagnostics = None
        if historical_search_request is not None:
            try:
                adaptive_historical = adaptive_discover_historical_market_evidence(
                    historical_search_request,
                    self._historical_provider,
                    historical_policy,
                    target=base_request.loss_vehicle,
                )
                historical_result = adaptive_historical.result
                historical_ranking = adaptive_historical.ranking
                historical_diagnostics = adaptive_historical.diagnostics
            except MarketProviderError as exc:
                _emit_local_provider_diagnostic("historical", exc)
                raise AnalysisRetrievalError(
                    "historical", _provider_error_class(exc), exc.diagnostic
                ) from exc
            except (
                AdaptiveSearchContractError,
                MarketContractError,
                ComparableContractError,
            ) as exc:
                raise AnalysisExecutionError(
                    "Historical evidence search could not complete"
                ) from exc
            try:
                historical_input = HistoricalEvidenceInput(
                    result=historical_result, ranking=historical_ranking
                )
            except (
                AdaptiveSearchContractError,
                MarketContractError,
                ComparableContractError,
            ) as exc:
                raise AnalysisExecutionError(
                    "Historical evidence could not be ranked"
                ) from exc

        current_result = None
        current_ranking = None
        current_input = None
        current_diagnostics = None
        if current_search_request is not None:
            try:
                adaptive_current = adaptive_discover_market_listings(
                    current_search_request,
                    self._current_provider,
                    configured_current_policy,
                    target=base_request.loss_vehicle,
                )
                if adaptive_current.provider_failure is not None:
                    _emit_local_provider_diagnostic(
                        "current", adaptive_current.provider_failure
                    )
                current_result = adaptive_current.result
                current_ranking = adaptive_current.ranking
                current_diagnostics = adaptive_current.diagnostics
            except MarketProviderError as exc:
                _emit_local_provider_diagnostic("current", exc)
                raise AnalysisRetrievalError(
                    "current", _provider_error_class(exc), exc.diagnostic
                ) from exc
            except (
                AdaptiveSearchContractError,
                MarketContractError,
                ComparableContractError,
            ) as exc:
                raise AnalysisExecutionError(
                    "Current evidence search could not complete"
                ) from exc
            try:
                current_input = CurrentEvidenceInput(
                    ranking=current_ranking,
                    observed_date=request.current_search.observed_date,
                )
            except (AdaptiveSearchContractError, ComparableContractError) as exc:
                raise AnalysisExecutionError(
                    "Current evidence could not be ranked"
                ) from exc

        try:
            discrepancy_request = valuation_discrepancy_request_from_report(
                request.ccc_report,
                postal_code=request.postal_code,
                loss_date_override=base_request.loss_date,
                historical_evidence=historical_input,
                current_evidence=current_input,
                policy=request.discrepancy_policy,
            )
            validate_valuation_discrepancy_request(discrepancy_request)
            discrepancy_result: ValuationDiscrepancyResult = self._analyzer.analyze(
                discrepancy_request
            )
            if not isinstance(discrepancy_result, ValuationDiscrepancyResult):
                raise TypeError(
                    "discrepancy analyzer did not return ValuationDiscrepancyResult"
                )
            validate_valuation_discrepancy_result(discrepancy_result)
        except Exception as exc:
            raise AnalysisExecutionError(
                "Deterministic discrepancy analysis failed"
            ) from exc

        run_id = self._new_run_id(self._run_id_factory)
        created_at = self._created_at(self._clock)
        current_metadata = (
            ProviderMetadata(
                current_result.provider, self._current_provider_version
            ).to_dict()
            if current_result is not None
            else None
        )
        historical_metadata = (
            ProviderMetadata(
                historical_result.provider, self._historical_provider_version
            ).to_dict()
            if historical_result is not None
            else None
        )
        discrepancy_request_data = discrepancy_request.to_dict()
        configured_search_policies_data = request.search_policies.to_dict()
        search_policies_data = effective_search_policies.to_dict()
        search_diagnostics_data = {
            "current": (
                current_diagnostics.to_dict()
                if current_diagnostics is not None
                else None
            ),
            "historical": (
                historical_diagnostics.to_dict()
                if historical_diagnostics is not None
                else None
            ),
        }
        artifact = AnalysisRunArtifact(
            run_id=run_id,
            created_at=created_at,
            request_digest=discrepancy_request_digest(discrepancy_request_data),
            search_diagnostics_digest=search_diagnostics_digest(
                search_policies_data,
                search_diagnostics_data,
                policy_field="searchPolicies",
                configured_policy=configured_search_policies_data,
            ),
            providers={
                "current": current_metadata,
                "historical": historical_metadata,
            },
            request={
                "baseDiscrepancyRequest": base_request.to_dict(),
                "lossDateSource": (
                    "OVERRIDE"
                    if request.loss_date_override is not None
                    else "CCC_REPORT"
                ),
                "lossDateOverride": (
                    base_request.loss_date
                    if request.loss_date_override is not None
                    else None
                ),
                "currentSearchRequest": (
                    current_result.request.to_dict()
                    if current_result is not None
                    else None
                ),
                "historicalSearchRequest": (
                    historical_result.request.to_dict()
                    if historical_result is not None
                    else None
                ),
                "currentObservedDate": (
                    request.current_search.observed_date
                    if request.current_search is not None
                    else None
                ),
                "configuredSearchPolicies": configured_search_policies_data,
                "searchPolicies": search_policies_data,
                "qualificationSourceReport": request.qualification_source_report,
            },
            result={
                "currentMarketResult": (
                    current_result.to_dict() if current_result is not None else None
                ),
                "historicalMarketResult": (
                    historical_result.to_dict()
                    if historical_result is not None
                    else None
                ),
                "currentRanking": (
                    current_ranking.to_dict() if current_ranking is not None else None
                ),
                "historicalRanking": (
                    historical_ranking.to_dict()
                    if historical_ranking is not None
                    else None
                ),
                "discrepancyRequest": discrepancy_request_data,
                "discrepancyResult": discrepancy_result.to_dict(),
                "searchDiagnostics": search_diagnostics_data,
            },
            evidence_context=request.evidence_context,
            discrepancy_analysis_version=discrepancy_result.analysis_version,
        )
        try:
            artifact_data = artifact.to_dict()
            qualification = qualify_preliminary(
                source_report=artifact_data["request"]["qualificationSourceReport"],
                evidence_context=artifact_data["evidenceContext"],
                discrepancy_request=discrepancy_request_data,
                discrepancy_result=artifact_data["result"]["discrepancyResult"],
                current_ranking=artifact_data["result"]["currentRanking"],
                historical_ranking=artifact_data["result"]["historicalRanking"],
            )
            artifact = replace(
                artifact,
                result={
                    **artifact_data["result"],
                    "preliminaryQualification": qualification,
                },
            )
        except Exception as exc:
            raise AnalysisExecutionError(
                "Deterministic preliminary qualification failed"
            ) from exc
        try:
            validate_analysis_run_artifact(artifact)
        except (
            AnalysisRunContractError,
            AnalysisRunValidationUnavailableError,
        ) as exc:
            raise AnalysisExecutionError(
                "Completed analysis could not produce a valid audit artifact"
            ) from exc

        try:
            self._repository.save(artifact)
        except Exception as exc:
            raise AnalysisPersistenceError(run_id) from exc
        return AnalysisRunResult(artifact=artifact)


__all__ = [
    "AnalysisExecutionError",
    "AnalysisInputError",
    "AnalysisOrchestrationError",
    "AnalysisOrchestrator",
    "AnalysisPersistenceError",
    "AnalysisRetrievalError",
    "AnalysisRunRequest",
    "AnalysisRunResult",
    "CurrentMarketSearchConfiguration",
    "HistoricalMarketSearchConfiguration",
]
