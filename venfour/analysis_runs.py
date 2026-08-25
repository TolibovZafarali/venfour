"""Immutable, validated audit artifacts for complete Venfour analysis runs.

The persisted envelope deliberately contains only canonical domain data.  It
never serializes provider objects, transports, credentials, headers, or raw
provider payloads.  Validation replays the authoritative Phase 3C ranking and
Phase 3D analyzer so a saved result remains bound to its saved inputs.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import tempfile
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Protocol, runtime_checkable
from urllib.parse import parse_qsl, quote, quote_plus, unquote, urlsplit
from uuid import UUID

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import SchemaError
from referencing import Registry, Resource

from venfour.adaptive_search import (
    CURRENT_SEARCH_CEILING_REACHED,
    HISTORICAL_SEARCH_CEILING_REACHED,
    MAX_SCOPE_REACHED,
    AdaptiveSearchContractError,
    adaptive_search_policies_from_dict,
    adaptive_search_policy_from_dict,
    adaptive_search_policy_for_provider,
    replay_current_adaptive_search,
    replay_historical_adaptive_search,
)
from venfour.comparables import (
    COMPARABLE_SCORING_VERSION,
    ComparableContractError,
    ComparableTarget,
    rank_market_comparables,
    validate_comparable_ranking_result,
)
from venfour.discrepancy import (
    VALUATION_DISCREPANCY_ANALYSIS_VERSION,
    CurrentEvidenceInput,
    DiscrepancyContractError,
    HistoricalEvidenceInput,
    ValuationDiscrepancyAnalyzer,
    ValuationDiscrepancyPolicy,
    ValuationDiscrepancyRequest,
    validate_valuation_discrepancy_request,
    validate_valuation_discrepancy_result,
)
from venfour.historical_market import (
    OUT_OF_PROVIDER_RANGE,
    SUPPORTED,
    HistoricalCoverage,
    HistoricalEvidenceIssue,
    HistoricalEvidenceItem,
    HistoricalMarketSearchRequest,
    HistoricalMarketSearchResult,
    TemporalEvidence,
    historical_evidence_to_market_search_result,
    validate_historical_market_search_request,
    validate_historical_market_search_result,
)
from venfour.market import (
    MarketContractError,
    MarketDealer,
    MarketListing,
    MarketSearchRequest,
    MarketSearchResult,
    VehicleConfigurationIdentity,
    validate_market_search_request,
    validate_market_search_result,
)


ANALYSIS_RUN_SCHEMA_VERSION = "5"
ANALYSIS_RUN_ANALYSIS_VERSION = "5"

REPO_ROOT = Path(__file__).resolve().parents[1]
ANALYSIS_RUN_SCHEMA_PATH = (
    REPO_ROOT / "schemas" / "analysis" / "analysis-run.schema.json"
)
DEFAULT_ANALYSIS_RUN_DIR = REPO_ROOT / "data" / "analysis-runs"
SCHEMA_URI_ROOT = "https://schemas.venfour.local/"

_SENSITIVE_URL_PARAMETER_NAMES = frozenset(
    {
        "accesstoken",
        "apikey",
        "auth",
        "authorization",
        "clientsecret",
        "credential",
        "key",
        "password",
        "secret",
        "sig",
        "signature",
        "token",
    }
)
_SENSITIVE_FIELD_NAMES = frozenset(
    {
        "accesstoken",
        "apikey",
        "authorization",
        "authorizationheader",
        "clientsecret",
        "credential",
        "headers",
        "marketcheckapikey",
        "openaiapikey",
        "password",
        "secret",
        "token",
    }
)
_SECRET_ENVIRONMENT_NAMES = ("MARKETCHECK_API_KEY", "OPENAI_API_KEY")


@dataclass(frozen=True)
class _PersistedRadiusCapability:
    maximum_search_radius_miles: int


class AnalysisRunContractError(Exception):
    """An in-memory analysis-run artifact failed validation."""

    def __init__(self, message: str, details: tuple[str, ...] = ()) -> None:
        super().__init__(message)
        self.details = details


class AnalysisRunValidationUnavailableError(Exception):
    """Repository-local schemas could not be loaded or resolved."""


class AnalysisRunRepositoryError(Exception):
    """Base class for expected analysis-run repository failures."""


class AnalysisRunNotFoundError(AnalysisRunRepositoryError):
    """No persisted analysis run exists for the requested identifier."""


class AnalysisRunAlreadyExistsError(AnalysisRunRepositoryError):
    """An immutable artifact already exists for the requested identifier."""


class AnalysisRunWriteError(AnalysisRunRepositoryError):
    """A validated analysis artifact could not be durably published."""


class InvalidAnalysisRunArtifactError(AnalysisRunRepositoryError):
    """A persisted artifact is malformed, invalid, or internally inconsistent."""

    def __init__(self, message: str, details: tuple[str, ...] = ()) -> None:
        super().__init__(message)
        self.details = details


@dataclass(frozen=True)
class ProviderMetadata:
    """Safe provider identity metadata; provider objects are never serialized."""

    name: str
    version: str | None = None

    def __post_init__(self) -> None:
        normalized_name = self.name.strip() if isinstance(self.name, str) else self.name
        normalized_version = (
            self.version.strip() if isinstance(self.version, str) else self.version
        )
        object.__setattr__(self, "name", normalized_name)
        object.__setattr__(self, "version", normalized_version)
        if not isinstance(normalized_name, str) or not normalized_name:
            raise AnalysisRunContractError(
                "Provider metadata failed contract validation",
                ("$.name: expected a non-empty string",),
            )
        if normalized_version is not None and (
            not isinstance(normalized_version, str) or not normalized_version
        ):
            raise AnalysisRunContractError(
                "Provider metadata failed contract validation",
                ("$.version: expected a non-empty string or null",),
            )

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "version": self.version}


def _freeze_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType(
            {key: _freeze_json(child) for key, child in value.items()}
        )
    if isinstance(value, (list, tuple)):
        return tuple(_freeze_json(child) for child in value)
    return copy.deepcopy(value)


def _thaw_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _thaw_json(child) for key, child in value.items()}
    if isinstance(value, (list, tuple)):
        return [_thaw_json(child) for child in value]
    return copy.deepcopy(value)


@dataclass(frozen=True)
class AnalysisRunArtifact:
    """One immutable, complete audit record ready for later presentation."""

    run_id: str
    created_at: str
    request_digest: str
    providers: Mapping[str, Any]
    request: Mapping[str, Any]
    result: Mapping[str, Any]
    search_diagnostics_digest: str | None = None
    evidence_context: Mapping[str, Any] | None = None
    analysis_run_schema_version: str = ANALYSIS_RUN_SCHEMA_VERSION
    analysis_version: str = ANALYSIS_RUN_ANALYSIS_VERSION
    discrepancy_analysis_version: str = VALUATION_DISCREPANCY_ANALYSIS_VERSION
    comparable_scoring_version: str = COMPARABLE_SCORING_VERSION

    def __post_init__(self) -> None:
        object.__setattr__(self, "providers", _freeze_json(self.providers))
        object.__setattr__(self, "request", _freeze_json(self.request))
        object.__setattr__(self, "result", _freeze_json(self.result))
        selected_context = self.evidence_context
        if selected_context is None and self.analysis_run_schema_version == "5":
            base_request = self.request.get("baseDiscrepancyRequest", {})
            valuation = (
                base_request.get("cccVehicleValuation")
                if isinstance(base_request, Mapping)
                else None
            )
            comparables = (
                base_request.get("cccComparables", [])
                if isinstance(base_request, Mapping)
                else []
            )
            selected_context = {
                "inputMode": "REPORT",
                "reportAvailable": True,
                "reportExtractionAvailable": True,
                "reportProvider": "CCC",
                "reportAdapter": "CCC",
                "partialExtraction": False,
                "offerAvailable": False,
                "insurerValuationAvailable": valuation is not None,
                "reportComparablesAvailable": bool(comparables),
                "reportAdjustmentsAvailable": bool(comparables),
                "conditionInformationAvailable": False,
                "optionsInformationAvailable": False,
                "conditionAndOptionsDollarAdjusted": False,
            }
        if selected_context is not None:
            object.__setattr__(self, "evidence_context", _freeze_json(selected_context))

    def to_dict(self) -> dict[str, Any]:
        data = {
            "analysisRunSchemaVersion": self.analysis_run_schema_version,
            "runId": self.run_id,
            "createdAt": self.created_at,
            "analysisVersion": self.analysis_version,
            "discrepancyAnalysisVersion": self.discrepancy_analysis_version,
            "comparableScoringVersion": self.comparable_scoring_version,
            "requestDigest": self.request_digest,
            "providers": _thaw_json(self.providers),
            "request": _thaw_json(self.request),
            "result": _thaw_json(self.result),
        }
        if self.search_diagnostics_digest is not None:
            data["searchDiagnosticsDigest"] = self.search_diagnostics_digest
        if self.evidence_context is not None:
            data["evidenceContext"] = _thaw_json(self.evidence_context)
        return data

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> AnalysisRunArtifact:
        validate_analysis_run_artifact(data)
        return cls(
            run_id=data["runId"],
            created_at=data["createdAt"],
            request_digest=data["requestDigest"],
            providers=data["providers"],
            request=data["request"],
            result=data["result"],
            search_diagnostics_digest=data.get("searchDiagnosticsDigest"),
            evidence_context=data.get("evidenceContext"),
            analysis_run_schema_version=data["analysisRunSchemaVersion"],
            analysis_version=data["analysisVersion"],
            discrepancy_analysis_version=data["discrepancyAnalysisVersion"],
            comparable_scoring_version=data["comparableScoringVersion"],
        )


@runtime_checkable
class AnalysisRunRepository(Protocol):
    """Storage boundary for immutable analysis-run audit records."""

    def save(self, artifact: AnalysisRunArtifact) -> None:
        """Persist one new immutable artifact or raise a repository error."""

        ...

    def get(self, run_id: str) -> AnalysisRunArtifact:
        """Load and strictly validate one saved artifact."""

        ...


def canonical_json_bytes(data: Any) -> bytes:
    """Return the documented canonical JSON representation used for digests."""

    try:
        return json.dumps(
            data,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (RecursionError, TypeError, ValueError) as exc:
        raise AnalysisRunContractError(
            "Analysis run contains non-canonical JSON data",
            (f"$: canonical serialization failed ({exc})",),
        ) from exc


def discrepancy_request_digest(request: Mapping[str, Any]) -> str:
    """Return SHA-256 over canonical non-secret Phase 3D request JSON.

    This digest detects accidental corruption and binds the stored request
    bytes.  It is not a digital signature and does not authenticate a party
    capable of rewriting both the artifact and digest.
    """

    if not isinstance(request, Mapping):
        raise AnalysisRunContractError(
            "Discrepancy request digest input failed contract validation",
            ("$: expected an object",),
        )
    return hashlib.sha256(canonical_json_bytes(request)).hexdigest()


def search_diagnostics_digest(
    policy: Mapping[str, Any],
    diagnostics: Mapping[str, Any],
    *,
    policy_field: str = "searchPolicy",
    configured_policy: Mapping[str, Any] | None = None,
) -> str:
    """Bind configured/effective policy provenance and the attempt stream."""

    if not isinstance(policy, Mapping) or not isinstance(diagnostics, Mapping):
        raise AnalysisRunContractError(
            "Search diagnostics digest input failed contract validation",
            ("$: expected canonical policy and diagnostics objects",),
        )
    if policy_field not in {"searchPolicy", "searchPolicies"}:
        raise AnalysisRunContractError(
            "Search diagnostics digest input failed contract validation",
            ("$.policyField: is not a supported canonical field",),
        )
    if configured_policy is not None and policy_field != "searchPolicies":
        raise AnalysisRunContractError(
            "Search diagnostics digest input failed contract validation",
            ("$.configuredPolicy: requires the searchPolicies field",),
        )
    payload = {
        policy_field: policy,
        "searchDiagnostics": diagnostics,
    }
    if configured_policy is not None:
        if not isinstance(configured_policy, Mapping):
            raise AnalysisRunContractError(
                "Search diagnostics digest input failed contract validation",
                ("$.configuredPolicy: expected a canonical policy object",),
            )
        payload["configuredSearchPolicies"] = configured_policy
    return hashlib.sha256(canonical_json_bytes(payload)).hexdigest()


def _read_schema_file(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise AnalysisRunValidationUnavailableError(
            f"Analysis-run schema could not be read: {path}"
        ) from exc
    except (RecursionError, UnicodeError, ValueError) as exc:
        raise AnalysisRunValidationUnavailableError(
            f"Analysis-run schema is not valid JSON: {path}"
        ) from exc
    if not isinstance(data, dict):
        raise AnalysisRunValidationUnavailableError(
            f"Analysis-run schema root must be an object: {path}"
        )
    return data


def _schema_registry() -> Registry:
    def retrieve(uri: str) -> Resource:
        if not uri.startswith(SCHEMA_URI_ROOT):
            raise AnalysisRunValidationUnavailableError(
                "Analysis-run schema referenced a non-local resource"
            )
        relative = unquote(uri[len(SCHEMA_URI_ROOT) :])
        candidate = (REPO_ROOT / "schemas" / relative).resolve()
        schema_root = (REPO_ROOT / "schemas").resolve()
        if candidate != schema_root and schema_root not in candidate.parents:
            raise AnalysisRunValidationUnavailableError(
                "Analysis-run schema reference escapes the schema directory"
            )
        return Resource.from_contents(_read_schema_file(candidate))

    return Registry(retrieve=retrieve)


def _json_path(parts: Sequence[Any]) -> str:
    path = "$"
    for part in parts:
        if isinstance(part, int):
            path += f"[{part}]"
        elif isinstance(part, str) and part.isidentifier():
            path += f".{part}"
        else:
            path += f"[{json.dumps(part, ensure_ascii=False)}]"
    return path


def _json_compatibility_errors(data: Any) -> list[str]:
    errors: list[str] = []
    stack: list[tuple[str, Any]] = [("$", data)]
    while stack:
        path, value = stack.pop()
        if value is None or isinstance(value, (str, bool, int)):
            continue
        if isinstance(value, float):
            if not math.isfinite(value):
                errors.append(f"{path}: non-finite numbers are not valid JSON")
            continue
        if isinstance(value, Mapping):
            for key, child in value.items():
                if not isinstance(key, str):
                    errors.append(f"{path}: object keys must be strings")
                    continue
                stack.append((f"{path}.{key}", child))
            continue
        if isinstance(value, (list, tuple)):
            stack.extend(
                (f"{path}[{index}]", child)
                for index, child in enumerate(value)
            )
            continue
        errors.append(f"{path}: {type(value).__name__} is not JSON-compatible")
    return sorted(errors)


def _validate_envelope_schema(data: Any) -> None:
    compatibility_errors = _json_compatibility_errors(data)
    if compatibility_errors:
        raise AnalysisRunContractError(
            "Analysis run failed contract validation", tuple(compatibility_errors)
        )
    schema = _read_schema_file(ANALYSIS_RUN_SCHEMA_PATH)
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError as exc:
        raise AnalysisRunValidationUnavailableError(
            f"Analysis-run schema is invalid: {ANALYSIS_RUN_SCHEMA_PATH}"
        ) from exc
    validator = Draft202012Validator(
        schema,
        registry=_schema_registry(),
        format_checker=FormatChecker(),
    )
    try:
        errors = sorted(
            validator.iter_errors(data),
            key=lambda error: (_json_path(list(error.absolute_path)), error.message),
        )
    except RecursionError as exc:
        raise AnalysisRunContractError(
            "Analysis run failed schema validation",
            ("$: artifact nesting exceeds the validation limit",),
        ) from exc
    except Exception as exc:
        raise AnalysisRunValidationUnavailableError(
            "A repository-local analysis-run schema reference could not be resolved"
        ) from exc
    if errors:
        raise AnalysisRunContractError(
            "Analysis run failed schema validation",
            tuple(
                f"{_json_path(list(error.absolute_path))}: {error.message}"
                for error in errors
            ),
        )


def _prefixed_details(path: str, details: Sequence[str]) -> tuple[str, ...]:
    return tuple(
        f"{path}{detail[1:]}" if detail.startswith("$") else f"{path}: {detail}"
        for detail in details
    )


def _validate_nested(
    data: Any,
    path: str,
    validator: Callable[[Any], None],
) -> None:
    try:
        validator(data)
    except (
        MarketContractError,
        ComparableContractError,
        DiscrepancyContractError,
    ) as exc:
        raise AnalysisRunContractError(
            "Analysis run contains an invalid nested contract",
            _prefixed_details(path, getattr(exc, "details", (str(exc),))),
        ) from exc


def _market_request_from_data(data: Mapping[str, Any]) -> MarketSearchRequest:
    return MarketSearchRequest(
        year=data["year"],
        make=data["make"],
        model=data["model"],
        trim=data["trim"],
        configuration=_configuration_from_data(data.get("configuration")),
        loss_vehicle_mileage=data["lossVehicleMileage"],
        postal_code=data["postalCode"],
        radius_miles=data["radiusMiles"],
        result_limit=data["resultLimit"],
    )


def _dealer_from_data(data: Mapping[str, Any] | None) -> MarketDealer | None:
    if data is None:
        return None
    return MarketDealer(
        name=data["name"],
        city=data["city"],
        state=data["state"],
        postal_code=data["postalCode"],
    )


def _configuration_from_data(
    data: Mapping[str, Any] | None,
) -> VehicleConfigurationIdentity | None:
    if data is None:
        return None
    return VehicleConfigurationIdentity(
        source=data["source"],
        field=data["field"],
        values=tuple(data["values"]),
    )


def _listing_from_data(data: Mapping[str, Any]) -> MarketListing:
    return MarketListing(
        source=data["source"],
        source_listing_id=data["sourceListingId"],
        listing_url=data["listingUrl"],
        year=data["year"],
        make=data["make"],
        model=data["model"],
        trim=data["trim"],
        vin=data["vin"],
        mileage=data["mileage"],
        price=data["price"],
        dealer=_dealer_from_data(data["dealer"]),
        distance_miles=data["distanceMiles"],
    )


def _market_result_from_data(data: Mapping[str, Any]) -> MarketSearchResult:
    return MarketSearchResult(
        provider=data["provider"],
        request=_market_request_from_data(data["request"]),
        listings=tuple(_listing_from_data(item) for item in data["listings"]),
    )


def _historical_request_from_data(
    data: Mapping[str, Any],
) -> HistoricalMarketSearchRequest:
    return HistoricalMarketSearchRequest(
        evidence_date=data["evidenceDate"],
        year=data["year"],
        make=data["make"],
        model=data["model"],
        trim=data["trim"],
        configuration=_configuration_from_data(data.get("configuration")),
        loss_vehicle_mileage=data["lossVehicleMileage"],
        postal_code=data["postalCode"],
        radius_miles=data["radiusMiles"],
        result_limit=data["resultLimit"],
    )


def _temporal_from_data(data: Mapping[str, Any]) -> TemporalEvidence:
    return TemporalEvidence(
        status=data["status"],
        basis=data["basis"],
        evidence_date=data["evidenceDate"],
        record_first_seen_at=data["recordFirstSeenAt"],
        record_last_seen_at=data["recordLastSeenAt"],
        source_first_seen_at=data["sourceFirstSeenAt"],
        source_last_seen_at=data["sourceLastSeenAt"],
    )


def _historical_result_from_data(
    data: Mapping[str, Any],
) -> HistoricalMarketSearchResult:
    coverage = data["coverage"]
    return HistoricalMarketSearchResult(
        provider=data["provider"],
        evidence_date=data["evidenceDate"],
        as_of_date=data["asOfDate"],
        coverage=HistoricalCoverage(
            status=coverage["status"],
            history_window_days=coverage["historyWindowDays"],
        ),
        request=_historical_request_from_data(data["request"]),
        evidence=tuple(
            HistoricalEvidenceItem(
                listing=_listing_from_data(item["listing"]),
                temporal_evidence=_temporal_from_data(item["temporalEvidence"]),
            )
            for item in data["evidence"]
        ),
        issues=tuple(
            HistoricalEvidenceIssue(
                status=item["status"],
                reason=item["reason"],
                vin=item["vin"],
                source_listing_id=item["sourceListingId"],
            )
            for item in data["issues"]
        ),
    )


def _target_from_data(data: Mapping[str, Any]) -> ComparableTarget:
    return ComparableTarget(
        year=data["year"],
        make=data["make"],
        model=data["model"],
        trim=data["trim"],
        mileage=data["mileage"],
        postal_code=data["postalCode"],
    )


def _policy_from_data(data: Mapping[str, Any]) -> ValuationDiscrepancyPolicy:
    return ValuationDiscrepancyPolicy(
        max_comparison_set=data["maxComparisonSet"],
        minimum_independent_count=data["minimumIndependentCount"],
        strong_historical_minimum=data["strongHistoricalMinimum"],
        potential_gap_basis_points=data["potentialGapBasisPoints"],
        material_gap_basis_points=data["materialGapBasisPoints"],
        high_dispersion_basis_points=data["highDispersionBasisPoints"],
    )


def _base_request_from_data(data: Mapping[str, Any]) -> ValuationDiscrepancyRequest:
    return ValuationDiscrepancyRequest(
        loss_vehicle=_target_from_data(data["lossVehicle"]),
        loss_date=data["lossDate"],
        ccc_vehicle_valuation=data["cccVehicleValuation"],
        ccc_comparables=tuple(data["cccComparables"]),
        historical_evidence=None,
        current_evidence=None,
        policy=_policy_from_data(data["policy"]),
    )


def _secret_variants(values: Sequence[str]) -> tuple[str, ...]:
    variants: set[str] = set()
    for value in values:
        if not isinstance(value, str) or not value:
            continue
        variants.update(
            {
                value,
                json.dumps(value, ensure_ascii=False)[1:-1],
                quote(value, safe=""),
                quote_plus(value),
            }
        )
    return tuple(sorted((item for item in variants if item), key=len, reverse=True))


def _configured_secret_values(
    extra_values: Sequence[str], *, include_environment: bool
) -> tuple[str, ...]:
    environment_values = (
        tuple(
            value
            for name in _SECRET_ENVIRONMENT_NAMES
            if (value := os.environ.get(name))
        )
        if include_environment
        else ()
    )
    return _secret_variants(tuple(extra_values) + environment_values)


def _environment_secret_values() -> tuple[str, ...]:
    return tuple(
        value
        for name in _SECRET_ENVIRONMENT_NAMES
        if (value := os.environ.get(name))
    )


def _normalized_sensitive_name(value: str) -> str:
    return "".join(character for character in value.casefold() if character.isalnum())


def _is_sensitive_url_parameter(value: str) -> bool:
    normalized = _normalized_sensitive_name(value)
    return normalized in _SENSITIVE_URL_PARAMETER_NAMES or normalized.endswith(
        (
            "accesskey",
            "accesskeyid",
            "accountkey",
            "apikey",
            "auth",
            "authorization",
            "clientkey",
            "credential",
            "password",
            "privatekey",
            "secret",
            "secretkey",
            "signature",
            "subscriptionkey",
            "token",
        )
    )


def _security_errors(
    data: Any,
    forbidden_secret_values: Sequence[str],
    *,
    include_environment_secrets: bool,
) -> list[str]:
    errors: list[str] = []
    secret_variants = _configured_secret_values(
        forbidden_secret_values,
        include_environment=include_environment_secrets,
    )
    stack: list[tuple[str, Any]] = [("$", data)]
    while stack:
        path, value = stack.pop()
        if isinstance(value, Mapping):
            for key, child in value.items():
                if not isinstance(key, str):
                    continue
                key_contains_secret = any(
                    secret in key for secret in secret_variants
                )
                child_path = (
                    f"{path}.[REDACTED]"
                    if key_contains_secret
                    else f"{path}.{key}"
                )
                if key_contains_secret:
                    errors.append(
                        f"{path}: contains a configured secret field name"
                    )
                if _normalized_sensitive_name(key) in _SENSITIVE_FIELD_NAMES:
                    errors.append(f"{child_path}: secret-bearing fields are forbidden")
                stack.append((child_path, child))
            continue
        if isinstance(value, (list, tuple)):
            stack.extend(
                (f"{path}[{index}]", child)
                for index, child in enumerate(value)
            )
            continue
        if not isinstance(value, str):
            continue
        if any(secret in value for secret in secret_variants):
            errors.append(f"{path}: contains a configured secret value")
        decoded_value = value
        for _ in range(3):
            decoded_value = unquote(decoded_value)
            if any(secret in decoded_value for secret in secret_variants):
                errors.append(f"{path}: contains a configured secret value")
                break
        try:
            parsed = urlsplit(value)
        except ValueError:
            errors.append(
                f"{path}: malformed URL-like text cannot be persisted safely"
            )
            continue
        if parsed.username is not None or parsed.password is not None:
            errors.append(f"{path}: credential-bearing URL user info is forbidden")
        for component in (parsed.query, parsed.fragment):
            for name, parameter_value in parse_qsl(
                component, keep_blank_values=True
            ):
                if _is_sensitive_url_parameter(name):
                    errors.append(
                        f"{path}: credential-bearing URL parameters are forbidden"
                    )
                    break
                decoded_parameter = parameter_value
                for _ in range(2):
                    if any(
                        secret in decoded_parameter for secret in secret_variants
                    ):
                        errors.append(f"{path}: contains a configured secret value")
                        break
                    decoded_parameter = unquote(decoded_parameter)
    return sorted(set(errors))


def _adaptive_semantic_validation_errors(
    data: Mapping[str, Any],
    base_request: ValuationDiscrepancyRequest,
) -> list[str]:
    """Replay adaptive diagnostics against their versioned effective policies."""

    artifact_version = data["analysisRunSchemaVersion"]
    if artifact_version not in {"2", "3", "4", "5"}:
        return []

    errors: list[str] = []
    request_snapshot = data["request"]
    stage_result = data["result"]
    diagnostics = stage_result["searchDiagnostics"]

    if artifact_version == "2":
        policy_field = "searchPolicy"
        policy_data = request_snapshot[policy_field]
        try:
            shared_policy = adaptive_search_policy_from_dict(policy_data)
        except AdaptiveSearchContractError as exc:
            errors.extend(
                _prefixed_details(
                    "$.request.searchPolicy",
                    exc.details or (str(exc),),
                )
            )
            return errors
        current_policy = historical_policy = shared_policy
        configured_policies = None
        historical_ceiling_reason = MAX_SCOPE_REACHED
    else:
        policy_field = "searchPolicies"
        policy_data = request_snapshot[policy_field]
        try:
            policies = adaptive_search_policies_from_dict(policy_data)
        except AdaptiveSearchContractError as exc:
            errors.extend(
                _prefixed_details(
                    "$.request.searchPolicies",
                    exc.details or (str(exc),),
                )
            )
            return errors
        current_policy = policies.current
        historical_policy = policies.historical
        configured_policies = None
        if artifact_version in {"4", "5"}:
            try:
                configured_policies = adaptive_search_policies_from_dict(
                    request_snapshot["configuredSearchPolicies"]
                )
            except AdaptiveSearchContractError as exc:
                errors.extend(
                    _prefixed_details(
                        "$.request.configuredSearchPolicies",
                        exc.details or (str(exc),),
                    )
                )
                return errors
            for stream, configured_policy, effective_policy, request_field in (
                (
                    "current",
                    configured_policies.current,
                    current_policy,
                    "currentSearchRequest",
                ),
                (
                    "historical",
                    configured_policies.historical,
                    historical_policy,
                    "historicalSearchRequest",
                ),
            ):
                expected_effective = configured_policy
                if request_snapshot[request_field] is not None:
                    expected_effective = adaptive_search_policy_for_provider(
                        configured_policy,
                        _PersistedRadiusCapability(
                            effective_policy.stages[-1].radius_miles
                        ),
                    )
                if expected_effective != effective_policy:
                    errors.append(
                        f"$.request.searchPolicies.{stream}: must be the configured "
                        "policy constrained only by the provider radius capability"
                    )
        historical_ceiling_reason = HISTORICAL_SEARCH_CEILING_REACHED

    expected_search_digest = search_diagnostics_digest(
        policy_data,
        diagnostics,
        policy_field=policy_field,
        configured_policy=(
            request_snapshot["configuredSearchPolicies"]
            if artifact_version in {"4", "5"}
            else None
        ),
    )
    if data["searchDiagnosticsDigest"] != expected_search_digest:
        errors.append(
            "$.searchDiagnosticsDigest: does not match the canonical search "
            "policy provenance and diagnostics JSON"
        )

    current_request_data = request_snapshot["currentSearchRequest"]
    current_diagnostics = diagnostics["current"]
    if current_request_data is None:
        if current_diagnostics is not None:
            errors.append(
                "$.result.searchDiagnostics.current: must be null when current "
                "retrieval is not configured"
            )
    elif current_diagnostics is None:
        errors.append(
            "$.result.searchDiagnostics.current: configured current retrieval "
            "requires replay diagnostics"
        )
    else:
        current_ceiling_reason = (
            CURRENT_SEARCH_CEILING_REACHED
            if artifact_version in {"4", "5"}
            and configured_policies is not None
            and configured_policies.current != current_policy
            else MAX_SCOPE_REACHED
        )
        try:
            current_replay = replay_current_adaptive_search(
                _market_request_from_data(current_request_data),
                current_diagnostics,
                policy=current_policy,
                target=base_request.loss_vehicle,
                ceiling_stop_reason=current_ceiling_reason,
            )
        except AdaptiveSearchContractError as exc:
            errors.extend(
                _prefixed_details(
                    "$.result.searchDiagnostics.current",
                    exc.details or (str(exc),),
                )
            )
        else:
            if current_replay.result.to_dict() != stage_result["currentMarketResult"]:
                errors.append(
                    "$.result.currentMarketResult: does not match replay of the "
                    "stored current search diagnostics"
                )
            if current_replay.ranking.to_dict() != stage_result["currentRanking"]:
                errors.append(
                    "$.result.currentRanking: does not match replay of the stored "
                    "current search diagnostics"
                )

    historical_request_data = request_snapshot["historicalSearchRequest"]
    historical_diagnostics = diagnostics["historical"]
    if historical_request_data is None:
        if historical_diagnostics is not None:
            errors.append(
                "$.result.searchDiagnostics.historical: must be null when "
                "historical retrieval is not configured"
            )
    elif historical_diagnostics is None:
        errors.append(
            "$.result.searchDiagnostics.historical: configured historical "
            "retrieval requires replay diagnostics"
        )
    else:
        try:
            historical_replay = replay_historical_adaptive_search(
                _historical_request_from_data(historical_request_data),
                historical_diagnostics,
                policy=historical_policy,
                target=base_request.loss_vehicle,
                ceiling_stop_reason=historical_ceiling_reason,
            )
        except AdaptiveSearchContractError as exc:
            errors.extend(
                _prefixed_details(
                    "$.result.searchDiagnostics.historical",
                    exc.details or (str(exc),),
                )
            )
        else:
            if (
                historical_replay.result.to_dict()
                != stage_result["historicalMarketResult"]
            ):
                errors.append(
                    "$.result.historicalMarketResult: does not match replay of the "
                    "stored historical search diagnostics"
                )
            replayed_ranking = (
                historical_replay.ranking.to_dict()
                if historical_replay.ranking is not None
                else None
            )
            if replayed_ranking != stage_result["historicalRanking"]:
                errors.append(
                    "$.result.historicalRanking: does not match replay of the "
                    "stored historical search diagnostics"
                )

    return errors


def _semantic_validation_errors(data: Mapping[str, Any]) -> list[str]:
    errors: list[str] = []
    request_snapshot = data["request"]
    stage_result = data["result"]
    providers = data["providers"]
    for stream in ("current", "historical"):
        provider_data = providers[stream]
        if provider_data is None:
            continue
        normalized_provider = ProviderMetadata(
            name=provider_data["name"], version=provider_data["version"]
        ).to_dict()
        if provider_data != normalized_provider:
            errors.append(
                f"$.providers.{stream}: provider metadata must use normalized text"
            )
    base_data = request_snapshot["baseDiscrepancyRequest"]
    final_data = stage_result["discrepancyRequest"]

    loss_date_source = request_snapshot["lossDateSource"]
    loss_date_override = request_snapshot["lossDateOverride"]
    if loss_date_source == "OVERRIDE":
        if loss_date_override is None:
            errors.append(
                "$.request.lossDateOverride: is required when lossDateSource is "
                "OVERRIDE"
            )
        elif loss_date_override != base_data["lossDate"]:
            errors.append(
                "$.request.lossDateOverride: must match the effective base loss date"
            )
    elif loss_date_override is not None:
        errors.append(
            "$.request.lossDateOverride: must be null when lossDateSource is "
            "CCC_REPORT"
        )

    if base_data["historicalEvidence"] is not None:
        errors.append(
            "$.request.baseDiscrepancyRequest.historicalEvidence: must be null"
        )
    if base_data["currentEvidence"] is not None:
        errors.append(
            "$.request.baseDiscrepancyRequest.currentEvidence: must be null"
        )
    for field in (
        "lossVehicle",
        "lossDate",
        "cccVehicleValuation",
        "cccComparables",
        "policy",
    ):
        if base_data[field] != final_data[field]:
            errors.append(
                f"$.result.discrepancyRequest.{field}: must match the base request"
            )

    base_request = _base_request_from_data(base_data)
    errors.extend(_adaptive_semantic_validation_errors(data, base_request))
    current_search_data = request_snapshot["currentSearchRequest"]
    current_observed_date = request_snapshot["currentObservedDate"]
    current_result_data = stage_result["currentMarketResult"]
    current_ranking_data = stage_result["currentRanking"]
    current_input: CurrentEvidenceInput | None = None

    current_values = (
        current_search_data,
        current_observed_date,
        providers["current"],
        current_result_data,
        current_ranking_data,
    )
    if current_search_data is None:
        if any(item is not None for item in current_values[1:]):
            errors.append(
                "$.request.currentSearchRequest: current stage fields must all be null "
                "when current retrieval is not configured"
            )
        if final_data["currentEvidence"] is not None:
            errors.append(
                "$.result.discrepancyRequest.currentEvidence: must be null when "
                "current retrieval is not configured"
            )
    elif any(item is None for item in current_values[1:]):
        errors.append(
            "$.result.currentMarketResult: configured current retrieval requires "
            "provider metadata, observation date, result, and ranking"
        )
    else:
        current_request = _market_request_from_data(current_search_data)
        current_result = _market_result_from_data(current_result_data)
        if current_result.to_dict() != current_result_data:
            errors.append(
                "$.result.currentMarketResult: must be exact canonical normalized "
                "market data"
            )
        if current_result.request.to_dict() != current_search_data:
            errors.append(
                "$.result.currentMarketResult.request: must match the stored current "
                "search request"
            )
        expected_target = ComparableTarget(
            year=current_request.year,
            make=current_request.make,
            model=current_request.model,
            trim=current_request.trim,
            mileage=current_request.loss_vehicle_mileage,
            postal_code=current_request.postal_code,
        )
        if expected_target != base_request.loss_vehicle:
            errors.append(
                "$.request.currentSearchRequest: vehicle and postal origin must match "
                "the base loss vehicle"
            )
        if providers["current"]["name"] != current_result.provider:
            errors.append(
                "$.providers.current.name: must match the canonical current provider"
            )
        expected_current_ranking = rank_market_comparables(
            base_request.loss_vehicle, current_result
        )
        if expected_current_ranking.to_dict() != current_ranking_data:
            errors.append(
                "$.result.currentRanking: does not match Phase 3C ranking of the "
                "stored current market result"
            )
        current_input = CurrentEvidenceInput(
            ranking=expected_current_ranking,
            observed_date=current_observed_date,
        )
        if final_data["currentEvidence"] != current_input.to_dict():
            errors.append(
                "$.result.discrepancyRequest.currentEvidence: must match the stored "
                "current stage"
            )

    historical_search_data = request_snapshot["historicalSearchRequest"]
    historical_result_data = stage_result["historicalMarketResult"]
    historical_ranking_data = stage_result["historicalRanking"]
    historical_input: HistoricalEvidenceInput | None = None
    historical_values = (
        historical_search_data,
        providers["historical"],
        historical_result_data,
    )
    if historical_search_data is None:
        if any(item is not None for item in historical_values[1:]) or (
            historical_ranking_data is not None
        ):
            errors.append(
                "$.request.historicalSearchRequest: historical stage fields must all "
                "be null when historical retrieval is not configured"
            )
        if final_data["historicalEvidence"] is not None:
            errors.append(
                "$.result.discrepancyRequest.historicalEvidence: must be null when "
                "historical retrieval is not configured"
            )
    elif any(item is None for item in historical_values[1:]):
        errors.append(
            "$.result.historicalMarketResult: configured historical retrieval requires "
            "provider metadata and a canonical result"
        )
    else:
        historical_request = _historical_request_from_data(historical_search_data)
        historical_result = _historical_result_from_data(historical_result_data)
        if historical_result.to_dict() != historical_result_data:
            errors.append(
                "$.result.historicalMarketResult: must be exact canonical normalized "
                "historical data"
            )
        if historical_result.request.to_dict() != historical_search_data:
            errors.append(
                "$.result.historicalMarketResult.request: must match the stored "
                "historical search request"
            )
        expected_target = ComparableTarget(
            year=historical_request.year,
            make=historical_request.make,
            model=historical_request.model,
            trim=historical_request.trim,
            mileage=historical_request.loss_vehicle_mileage,
            postal_code=historical_request.postal_code,
        )
        if expected_target != base_request.loss_vehicle:
            errors.append(
                "$.request.historicalSearchRequest: vehicle and postal origin must "
                "match the base loss vehicle"
            )
        if historical_request.evidence_date != base_request.loss_date:
            errors.append(
                "$.request.historicalSearchRequest.evidenceDate: must match the base "
                "loss date"
            )
        if providers["historical"]["name"] != historical_result.provider:
            errors.append(
                "$.providers.historical.name: must match the canonical historical "
                "provider"
            )
        expected_historical_ranking = None
        if (
            historical_result.coverage.status == SUPPORTED
            and historical_result.listing_count > 0
        ):
            projected = historical_evidence_to_market_search_result(historical_result)
            expected_historical_ranking = rank_market_comparables(
                base_request.loss_vehicle, projected
            )
        if (
            expected_historical_ranking.to_dict()
            if expected_historical_ranking is not None
            else None
        ) != historical_ranking_data:
            errors.append(
                "$.result.historicalRanking: does not match Phase 3C ranking of the "
                "stored resolved historical evidence"
            )
        if historical_result.coverage.status == OUT_OF_PROVIDER_RANGE and (
            historical_ranking_data is not None
        ):
            errors.append(
                "$.result.historicalRanking: must be null for out-of-range coverage"
            )
        historical_input = HistoricalEvidenceInput(
            result=historical_result,
            ranking=expected_historical_ranking,
        )
        if final_data["historicalEvidence"] != historical_input.to_dict():
            errors.append(
                "$.result.discrepancyRequest.historicalEvidence: must match the "
                "stored historical stage"
            )

    expected_final_request = ValuationDiscrepancyRequest(
        loss_vehicle=base_request.loss_vehicle,
        loss_date=base_request.loss_date,
        ccc_vehicle_valuation=base_request.ccc_vehicle_valuation,
        ccc_comparables=base_request.ccc_comparables,
        historical_evidence=historical_input,
        current_evidence=current_input,
        policy=base_request.policy,
    )
    try:
        validate_valuation_discrepancy_request(expected_final_request)
    except DiscrepancyContractError as exc:
        errors.extend(
            _prefixed_details("$.result.discrepancyRequest", exc.details)
        )
    if expected_final_request.to_dict() != final_data:
        errors.append(
            "$.result.discrepancyRequest: does not match the reconstructed canonical "
            "analysis request"
        )

    expected_digest = discrepancy_request_digest(final_data)
    if data["requestDigest"] != expected_digest:
        errors.append(
            "$.requestDigest: does not match canonical discrepancy request JSON"
        )

    if not errors:
        expected_result = ValuationDiscrepancyAnalyzer().analyze(
            expected_final_request
        ).to_dict()
        if stage_result["discrepancyResult"] != expected_result:
            errors.append(
                "$.result.discrepancyResult: does not correspond to the stored "
                "discrepancy request"
            )
    return errors


def validate_analysis_run_artifact(
    artifact: AnalysisRunArtifact | Mapping[str, Any],
    *,
    forbidden_secret_values: Sequence[str] = (),
    include_environment_secrets: bool = True,
) -> None:
    """Validate schema, nested contracts, secrets, and cross-stage semantics.

    Environment secrets are checked while constructing/saving new artifacts.
    Repositories disable that ambient check on read so artifact availability is
    stable across credential rotation; explicitly configured forbidden values
    remain enforced in both directions.
    """

    if isinstance(artifact, AnalysisRunArtifact):
        try:
            data = artifact.to_dict()
        except (AttributeError, RecursionError, TypeError, ValueError) as exc:
            raise AnalysisRunContractError(
                "Analysis run failed contract validation",
                (f"$: could not serialize artifact ({exc})",),
            ) from exc
    else:
        data = artifact

    security_errors = _security_errors(
        data,
        forbidden_secret_values,
        include_environment_secrets=include_environment_secrets,
    )
    if security_errors:
        raise AnalysisRunContractError(
            "Analysis run failed secret-safety validation", tuple(security_errors)
        )
    compatibility_errors = _json_compatibility_errors(data)
    if compatibility_errors:
        raise AnalysisRunContractError(
            "Analysis run failed contract validation", tuple(compatibility_errors)
        )
    _validate_envelope_schema(data)

    request_snapshot = data["request"]
    stage_result = data["result"]
    _validate_nested(
        request_snapshot["baseDiscrepancyRequest"],
        "$.request.baseDiscrepancyRequest",
        validate_valuation_discrepancy_request,
    )
    if request_snapshot["currentSearchRequest"] is not None:
        _validate_nested(
            request_snapshot["currentSearchRequest"],
            "$.request.currentSearchRequest",
            validate_market_search_request,
        )
    if request_snapshot["historicalSearchRequest"] is not None:
        _validate_nested(
            request_snapshot["historicalSearchRequest"],
            "$.request.historicalSearchRequest",
            validate_historical_market_search_request,
        )
    if stage_result["currentMarketResult"] is not None:
        _validate_nested(
            stage_result["currentMarketResult"],
            "$.result.currentMarketResult",
            validate_market_search_result,
        )
    if stage_result["historicalMarketResult"] is not None:
        _validate_nested(
            stage_result["historicalMarketResult"],
            "$.result.historicalMarketResult",
            validate_historical_market_search_result,
        )
    if stage_result["currentRanking"] is not None:
        _validate_nested(
            stage_result["currentRanking"],
            "$.result.currentRanking",
            validate_comparable_ranking_result,
        )
    if stage_result["historicalRanking"] is not None:
        _validate_nested(
            stage_result["historicalRanking"],
            "$.result.historicalRanking",
            validate_comparable_ranking_result,
        )
    _validate_nested(
        stage_result["discrepancyRequest"],
        "$.result.discrepancyRequest",
        validate_valuation_discrepancy_request,
    )
    _validate_nested(
        stage_result["discrepancyResult"],
        "$.result.discrepancyResult",
        validate_valuation_discrepancy_result,
    )

    try:
        semantic_errors = _semantic_validation_errors(data)
    except (
        KeyError,
        TypeError,
        ValueError,
        MarketContractError,
        ComparableContractError,
    ) as exc:
        raise AnalysisRunContractError(
            "Analysis run failed semantic validation",
            (f"$: canonical stage reconstruction failed ({type(exc).__name__})",),
        ) from exc
    if semantic_errors:
        raise AnalysisRunContractError(
            "Analysis run failed semantic validation", tuple(semantic_errors)
        )


def _canonical_uuid4(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("expected a canonical UUIDv4 string")
    parsed = UUID(value)
    if parsed.version != 4 or str(parsed) != value:
        raise ValueError("expected a canonical lowercase UUIDv4 string")
    return value


def _reject_json_constant(value: str) -> Any:
    raise ValueError(f"non-finite JSON number {value}")


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate object key {key!r}")
        result[key] = value
    return result


def _load_strict_json(path: Path) -> dict[str, Any]:
    try:
        with path.open(encoding="utf-8") as handle:
            data = json.load(
                handle,
                parse_constant=_reject_json_constant,
                object_pairs_hook=_reject_duplicate_keys,
            )
    except OSError:
        raise
    except (json.JSONDecodeError, RecursionError, ValueError) as exc:
        raise InvalidAnalysisRunArtifactError(
            "Persisted analysis run is not strict JSON",
            ("$: invalid or ambiguous JSON encoding",),
        ) from exc
    if not isinstance(data, dict):
        raise InvalidAnalysisRunArtifactError(
            "Persisted analysis run is invalid", ("$: expected an object",)
        )
    return data


class FileAnalysisRunRepository:
    """Local immutable JSON repository using atomic no-overwrite publication."""

    def __init__(
        self,
        root: Path | str = DEFAULT_ANALYSIS_RUN_DIR,
        *,
        forbidden_secret_values: Sequence[str] = (),
    ) -> None:
        self.root = Path(root)
        self._forbidden_secret_values = tuple(forbidden_secret_values)

    def _path(self, run_id: str) -> Path:
        try:
            normalized = _canonical_uuid4(run_id)
        except (TypeError, ValueError, AttributeError) as exc:
            raise AnalysisRunRepositoryError(
                "Analysis run ID must be a canonical lowercase UUIDv4"
            ) from exc
        return self.root / f"{normalized}.json"

    def save(self, artifact: AnalysisRunArtifact) -> None:
        if not isinstance(artifact, AnalysisRunArtifact):
            raise AnalysisRunContractError(
                "Analysis run repository can only save AnalysisRunArtifact values",
                (f"$: got {type(artifact).__name__}",),
            )
        save_forbidden_secrets = (
            self._forbidden_secret_values + _environment_secret_values()
        )
        try:
            validate_analysis_run_artifact(
                artifact,
                forbidden_secret_values=save_forbidden_secrets,
                include_environment_secrets=False,
            )
        except AnalysisRunValidationUnavailableError as exc:
            raise AnalysisRunWriteError(
                "Analysis-run validation infrastructure is unavailable"
            ) from exc
        destination = self._path(artifact.run_id)
        data = artifact.to_dict()
        temporary_path: Path | None = None
        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=destination.parent,
                prefix=f".{destination.name}.",
                suffix=".tmp",
                delete=False,
            ) as temporary_file:
                temporary_path = Path(temporary_file.name)
                json.dump(
                    data,
                    temporary_file,
                    indent=2,
                    ensure_ascii=False,
                    allow_nan=False,
                )
                temporary_file.write("\n")
                temporary_file.flush()
                os.fsync(temporary_file.fileno())

            written = _load_strict_json(temporary_path)
            validate_analysis_run_artifact(
                written,
                forbidden_secret_values=save_forbidden_secrets,
                include_environment_secrets=False,
            )
            if written != data:
                raise AnalysisRunWriteError(
                    "Serialized analysis run did not round-trip exactly"
                )
            try:
                os.link(temporary_path, destination)
            except FileExistsError as exc:
                raise AnalysisRunAlreadyExistsError(
                    f"Analysis run {artifact.run_id} already exists"
                ) from exc
            try:
                directory_fd = os.open(destination.parent, os.O_RDONLY)
            except OSError:
                directory_fd = None
            if directory_fd is not None:
                try:
                    os.fsync(directory_fd)
                except OSError:
                    pass
                finally:
                    try:
                        os.close(directory_fd)
                    except OSError:
                        pass
        except (AnalysisRunAlreadyExistsError, AnalysisRunWriteError):
            raise
        except InvalidAnalysisRunArtifactError as exc:
            raise AnalysisRunWriteError(
                "Serialized analysis run could not be validated"
            ) from exc
        except AnalysisRunContractError as exc:
            raise AnalysisRunWriteError(
                "Serialized analysis run failed post-write validation"
            ) from exc
        except AnalysisRunValidationUnavailableError as exc:
            raise AnalysisRunWriteError(
                "Analysis-run validation infrastructure is unavailable"
            ) from exc
        except (OSError, RecursionError, TypeError, ValueError) as exc:
            raise AnalysisRunWriteError(
                f"Analysis run could not be written: {destination}"
            ) from exc
        finally:
            if temporary_path is not None:
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError:
                    pass

    def get(self, run_id: str) -> AnalysisRunArtifact:
        path = self._path(run_id)
        try:
            data = _load_strict_json(path)
        except FileNotFoundError as exc:
            raise AnalysisRunNotFoundError(
                f"Analysis run {run_id} was not found"
            ) from exc
        except InvalidAnalysisRunArtifactError:
            raise
        except OSError as exc:
            raise AnalysisRunRepositoryError(
                f"Analysis run could not be read: {path}"
            ) from exc
        try:
            validate_analysis_run_artifact(
                data,
                forbidden_secret_values=self._forbidden_secret_values,
                include_environment_secrets=False,
            )
        except AnalysisRunValidationUnavailableError as exc:
            raise AnalysisRunRepositoryError(
                "Analysis-run validation infrastructure is unavailable"
            ) from exc
        except AnalysisRunContractError as exc:
            raise InvalidAnalysisRunArtifactError(
                "Persisted analysis run failed validation", exc.details
            ) from exc
        if data["runId"] != run_id:
            raise InvalidAnalysisRunArtifactError(
                "Persisted analysis run identity does not match its storage key",
                ("$.runId: must match the requested run ID",),
            )
        return AnalysisRunArtifact(
            run_id=data["runId"],
            created_at=data["createdAt"],
            request_digest=data["requestDigest"],
            providers=data["providers"],
            request=data["request"],
            result=data["result"],
            search_diagnostics_digest=data.get("searchDiagnosticsDigest"),
            evidence_context=data.get("evidenceContext"),
            analysis_run_schema_version=data["analysisRunSchemaVersion"],
            analysis_version=data["analysisVersion"],
            discrepancy_analysis_version=data["discrepancyAnalysisVersion"],
            comparable_scoring_version=data["comparableScoringVersion"],
        )


__all__ = [
    "ANALYSIS_RUN_ANALYSIS_VERSION",
    "ANALYSIS_RUN_SCHEMA_PATH",
    "ANALYSIS_RUN_SCHEMA_VERSION",
    "DEFAULT_ANALYSIS_RUN_DIR",
    "AnalysisRunAlreadyExistsError",
    "AnalysisRunArtifact",
    "AnalysisRunContractError",
    "AnalysisRunNotFoundError",
    "AnalysisRunRepository",
    "AnalysisRunRepositoryError",
    "AnalysisRunWriteError",
    "AnalysisRunValidationUnavailableError",
    "FileAnalysisRunRepository",
    "InvalidAnalysisRunArtifactError",
    "ProviderMetadata",
    "canonical_json_bytes",
    "discrepancy_request_digest",
    "search_diagnostics_digest",
    "validate_analysis_run_artifact",
]
