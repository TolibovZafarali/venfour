"""Durable processing boundary for one current insurer-response analysis.

The database owns response lineage, leases, retry timing, and customer-visible
journey state. This module converts the database's bounded context projection
into the even smaller model contract, verifies any private response document,
and persists only strict structured output plus derived extraction metadata.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from contextlib import AbstractContextManager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Protocol, runtime_checkable
from urllib.parse import quote
from uuid import UUID, uuid4

from venfour.insurer_response_analysis import (
    INSURER_RESPONSE_ANALYSIS_PROMPT_VERSION,
    INSURER_RESPONSE_ANALYSIS_SCHEMA_VERSION,
    CaseEvidenceContext,
    CompletedInsurerResponseAnalysis,
    InsurerResponseAnalysisConfiguration,
    InsurerResponseAnalysisError,
    InsurerResponseAnalysisInputV1,
    InsurerResponseAnalysisUnavailableError,
    InsurerResponseAnalysisUnsupportedError,
    InsurerResponseDocumentUnderstanding,
    build_insurer_response_analysis_input_v1,
    make_case_evidence_reference,
    understand_insurer_response_document,
)
from venfour.package_processing import CloudTasksConfiguration
from venfour.insurer_response_recommendation import (
    InsurerResponseRecommendationError,
    build_insurer_response_recommendation_v1,
)
from venfour.supabase_gateway import (
    SupabaseContractError,
    SupabaseResponseDocumentInvalidError,
    SupabaseResponseDocumentNotFoundError,
    SupabaseUnavailableError,
)


INSURER_RESPONSE_CONTEXT_VERSION = "1"
INSURER_RESPONSE_EXTRACTION_VERSION = "1"
INSURER_RESPONSE_PROVIDER_IDENTIFIER = "openai"
DEFAULT_RESPONSE_ANALYSIS_RETRY_DELAY_SECONDS = 60
MAX_RESPONSE_ANALYSIS_RETRY_DELAY_SECONDS = 3600
MAX_CONTEXT_TEXT_CHARACTERS = 50_000
MAX_RESPONSE_TEXT_CHARACTERS = 100_000
MAX_CONTEXT_COLLECTION_ITEMS = 50
DEFAULT_RESPONSE_ANALYSIS_DISPATCH_LIMIT = 25
MAX_RESPONSE_ANALYSIS_DISPATCH_LIMIT = 100
DEFAULT_RESPONSE_ANALYSIS_RECONCILIATION_INTERVAL_SECONDS = 30.0


class InsurerResponseProcessingError(Exception):
    """Base failure for the response-analysis orchestration boundary."""


class InsurerResponseProcessingContractError(InsurerResponseProcessingError):
    """A supposedly trusted context or persistence response was malformed."""


class InsurerResponseProcessingUnavailableError(InsurerResponseProcessingError):
    """The durable processing boundary could not safely make progress."""


class InsurerResponseDispatchUnavailableError(
    InsurerResponseProcessingUnavailableError
):
    """The optional durable job dispatcher could not enqueue work."""


@runtime_checkable
class InsurerResponseAnalyzer(Protocol):
    def analyze(
        self,
        request: InsurerResponseAnalysisInputV1,
        *,
        document: InsurerResponseDocumentUnderstanding | None = None,
    ) -> CompletedInsurerResponseAnalysis: ...


@runtime_checkable
class InsurerResponseAnalysisDatabase(Protocol):
    def claim_current_total_loss_insurer_response_analysis(
        self,
        case_id: str,
        processing_token: str,
        provider_identifier: str,
        model_identifier: str,
        prompt_version: str,
        schema_version: str,
        context_version: str,
    ) -> Mapping[str, Any]: ...

    def resolve_total_loss_insurer_response_analysis_context(
        self, job_id: str, processing_token: str
    ) -> Mapping[str, Any]: ...

    def complete_total_loss_insurer_response_analysis(
        self,
        job_id: str,
        processing_token: str,
        run_id: str,
        returned_model_identifier: str,
        input_digest: str,
        result: Mapping[str, Any],
        result_digest: str,
        usage_metadata: Mapping[str, Any],
        extraction_version: str,
        extraction: Mapping[str, Any],
        extraction_digest: str,
        verified_document_digest: str | None,
        evidence_index: Mapping[str, Any],
        evidence_index_digest: str,
        recommendation: Mapping[str, Any],
        recommendation_digest: str,
    ) -> Mapping[str, Any]: ...

    def fail_total_loss_insurer_response_analysis(
        self,
        job_id: str,
        processing_token: str,
        run_id: str,
        failure_code: str,
        failure_kind: str,
        retry_delay_seconds: int,
    ) -> Mapping[str, Any]: ...

    def retry_total_loss_insurer_response_analysis(
        self,
        case_id: str,
        client_request_id: str,
        workflow_revision: int,
        access_token: str,
    ) -> Mapping[str, Any]: ...

    def materialize_total_loss_insurer_response_document(
        self,
        case_id: str,
        document_id: str,
        storage_locator: Mapping[str, Any],
        media_type: str,
        byte_size: int,
        content_digest: str,
        cache_nonce: str,
    ) -> AbstractContextManager[Path]: ...


@runtime_checkable
class InsurerResponseAnalysisDispatchDatabase(Protocol):
    def list_due_total_loss_insurer_response_analysis_jobs(
        self, limit: int
    ) -> Sequence[Mapping[str, Any]]: ...

    def resolve_total_loss_insurer_response_analysis_job_case(
        self, job_id: str
    ) -> Mapping[str, Any] | None: ...


@runtime_checkable
class InsurerResponseRecommendationDatabase(Protocol):
    def resolve_current_total_loss_insurer_response_recommendation_context(
        self, case_id: str
    ) -> Mapping[str, Any] | None: ...

    def publish_total_loss_insurer_response_recommendation(
        self, analysis_result_id: str, recommendation: Mapping[str, Any],
        recommendation_digest: str,
    ) -> Mapping[str, Any]: ...


def backfill_current_insurer_response_recommendation(
    database: InsurerResponseRecommendationDatabase, case_id: str, *, apply: bool = False,
) -> dict[str, Any]:
    """Explicitly preview or publish a missing recommendation, without reanalysis.

    Customer reads never call this maintenance path. Publication is fenced by
    the exact completed result and returns superseded if the source changed.
    """
    if not isinstance(database, InsurerResponseRecommendationDatabase):
        raise TypeError("database must implement InsurerResponseRecommendationDatabase")
    canonical_case = _request_uuid(case_id, "Case ID")
    context = database.resolve_current_total_loss_insurer_response_recommendation_context(canonical_case)
    if context is None:
        return {"outcome": "not_found"}
    context = _mapping(context, "Completed response recommendation context", keys={
        "analysis_result_id", "response_id", "analysis_result", "evidence_index",
        "final_assessment", "assessment_digest", "customer_offer", "recommendation_id",
    })
    result_id = _canonical_uuid(context["analysis_result_id"], "Response analysis result ID")
    _canonical_uuid(context["response_id"], "Insurer response ID")
    if context["recommendation_id"] is not None:
        return {
            "outcome": "already_published",
            "recommendationId": _canonical_uuid(context["recommendation_id"], "Recommendation ID"),
        }
    recommendation = build_insurer_response_recommendation_v1(
        analysis=context["analysis_result"], evidence_index=context["evidence_index"],
        final_assessment=context["final_assessment"], assessment_digest=context["assessment_digest"],
        customer_offer=context["customer_offer"],
    )
    if not apply:
        return {"outcome": "ready", "analysisResultId": result_id, "recommendation": recommendation}
    result = _mapping(database.publish_total_loss_insurer_response_recommendation(
        result_id, recommendation, _canonical_json_digest(recommendation),
    ), "Response recommendation publication", keys={"outcome", "recommendationId", "workflowRevision"})
    if result.get("outcome") not in {"published", "duplicate", "superseded"}:
        raise InsurerResponseProcessingContractError("Response recommendation publication is invalid")
    if result.get("outcome") != "superseded":
        _canonical_uuid(result.get("recommendationId"), "Recommendation ID")
        _positive_integer(result.get("workflowRevision"), "Workflow revision")
    return dict(result)


@runtime_checkable
class InsurerResponseJobDispatcher(Protocol):
    def dispatch(self, job_id: str, attempt_count: int) -> str: ...


@runtime_checkable
class InsurerResponseCaseProcessor(Protocol):
    def execute(self, case_id: str) -> "InsurerResponseExecutionResult": ...


@dataclass(frozen=True)
class InsurerResponseExecutionResult:
    state: str
    case_id: str
    job_id: str | None
    run_id: str | None
    attempt_count: int | None
    workflow_revision: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "caseId": self.case_id,
            "attemptCount": self.attempt_count,
        }


@dataclass(frozen=True)
class InsurerResponseDispatchResult:
    due: int
    dispatched: int
    failed: int
    dispatcher_configured: bool
    external_task_names: tuple[str, ...] = ()


@dataclass(frozen=True)
class InsurerResponseJobExecutionResult:
    state: str
    job_id: str
    attempt_count: int | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "jobId": self.job_id,
            "attemptCount": self.attempt_count,
        }


def _canonical_uuid(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise InsurerResponseProcessingContractError(f"{label} is invalid")
    try:
        parsed = UUID(value)
    except (AttributeError, TypeError, ValueError) as exc:
        raise InsurerResponseProcessingContractError(
            f"{label} is invalid"
        ) from exc
    if str(parsed) != value:
        raise InsurerResponseProcessingContractError(f"{label} is invalid")
    return value


def _request_uuid(value: Any, label: str) -> str:
    try:
        selected = _canonical_uuid(value, label)
    except InsurerResponseProcessingContractError as exc:
        raise ValueError(f"{label} is invalid") from exc
    if UUID(selected).version != 4:
        raise ValueError(f"{label} is invalid")
    return selected


def _mapping(
    value: Any,
    label: str,
    *,
    keys: set[str] | None = None,
) -> Mapping[str, Any]:
    if not isinstance(value, Mapping) or (
        keys is not None and set(value) != keys
    ):
        raise InsurerResponseProcessingContractError(f"{label} is invalid")
    return value


def _text(
    value: Any,
    label: str,
    *,
    nullable: bool = False,
    maximum: int = MAX_CONTEXT_TEXT_CHARACTERS,
) -> str | None:
    if value is None and nullable:
        return None
    if (
        not isinstance(value, str)
        or not value.strip()
        or value != value.strip()
        or len(value) > maximum
        or any(ord(character) < 32 and character not in "\n\r\t" for character in value)
        or any(ord(character) == 127 for character in value)
    ):
        raise InsurerResponseProcessingContractError(f"{label} is invalid")
    return value


def _optional_nonnegative_integer(value: Any, label: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise InsurerResponseProcessingContractError(f"{label} is invalid")
    return value


def _positive_integer(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise InsurerResponseProcessingContractError(f"{label} is invalid")
    return value


def _money(
    value: Any, label: str, *, nullable: bool = True
) -> tuple[int | None, str | None]:
    if value is None and nullable:
        return None, None
    item = _mapping(value, label)
    keys = set(item)
    if keys == {"amountMinorUnits", "currency"}:
        amount_value = item.get("amountMinorUnits")
    elif keys == {"minorUnits", "currency", "display"}:
        amount_value = item.get("minorUnits")
        _text(item.get("display"), f"{label} display", maximum=100)
    else:
        raise InsurerResponseProcessingContractError(f"{label} is invalid")
    amount = _optional_nonnegative_integer(
        amount_value, f"{label} amount"
    )
    currency = _text(
        item.get("currency"), f"{label} currency", maximum=3
    )
    if amount is None:
        return None, None
    if (
        not isinstance(currency, str)
        or len(currency) != 3
        or not currency.isupper()
        or not currency.isalpha()
    ):
        raise InsurerResponseProcessingContractError(f"{label} is invalid")
    return amount, currency


def _canonical_json_digest(value: Mapping[str, Any]) -> str:
    try:
        encoded = json.dumps(
            dict(value),
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise InsurerResponseProcessingContractError(
            "Derived response analysis record is invalid"
        ) from exc
    return hashlib.sha256(encoded).hexdigest()


def _dispatch_limit(value: Any) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 1 <= value <= MAX_RESPONSE_ANALYSIS_DISPATCH_LIMIT
    ):
        raise ValueError("Response analysis dispatch limit is invalid")
    return value


def _dispatch_attempt_count(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise InsurerResponseProcessingContractError(
            "Response analysis dispatch attempt count is invalid"
        )
    return value


def _durable_uuid(value: Any, label: str) -> str:
    try:
        return _request_uuid(value, label)
    except ValueError as exc:
        raise InsurerResponseProcessingContractError(
            f"{label} is invalid"
        ) from exc


class CloudTasksInsurerResponseJobDispatcher:
    """Dispatch one opaque response-analysis job through Cloud Tasks."""

    def __init__(
        self,
        configuration: CloudTasksConfiguration,
        *,
        client: Any | None = None,
        already_exists_errors: tuple[type[BaseException], ...] | None = None,
    ) -> None:
        if not isinstance(configuration, CloudTasksConfiguration):
            raise TypeError("configuration must be CloudTasksConfiguration")
        if client is None:
            try:
                from google.api_core.exceptions import AlreadyExists
                from google.cloud import tasks_v2
            except ImportError as exc:  # pragma: no cover - optional prod dep
                raise InsurerResponseDispatchUnavailableError(
                    "Cloud Tasks support is unavailable"
                ) from exc
            try:
                client = tasks_v2.CloudTasksClient()
            except Exception as exc:  # pragma: no cover - runtime credential path
                raise InsurerResponseDispatchUnavailableError(
                    "Cloud Tasks support is unavailable"
                ) from exc
            selected_already_exists = (AlreadyExists,)
        else:
            selected_already_exists = already_exists_errors or ()
        if not callable(getattr(client, "create_task", None)):
            raise TypeError("Cloud Tasks client must expose create_task")
        self._configuration = configuration
        self._client = client
        self._already_exists_errors = selected_already_exists

    @staticmethod
    def _task_id(job_id: str, attempt_count: int) -> str:
        canonical_job_id = _request_uuid(job_id, "Analysis job ID")
        selected_attempt = _dispatch_attempt_count(attempt_count)
        return f"ira-{canonical_job_id}-attempt-{selected_attempt}"

    def _task_name(self, job_id: str, attempt_count: int) -> str:
        return (
            f"{self._configuration.queue_path}/tasks/"
            f"{self._task_id(job_id, attempt_count)}"
        )

    def _target_url(self, job_id: str) -> str:
        canonical_job_id = _request_uuid(job_id, "Analysis job ID")
        return (
            f"{self._configuration.worker_origin}/internal/v1/"
            "insurer-response-analysis-jobs/"
            f"{quote(canonical_job_id, safe='')}/execute"
        )

    def dispatch(self, job_id: str, attempt_count: int) -> str:
        task_name = self._task_name(job_id, attempt_count)
        task = {
            "name": task_name,
            "http_request": {
                "http_method": "POST",
                "url": self._target_url(job_id),
                "oidc_token": {
                    "service_account_email": (
                        self._configuration.oidc_service_account
                    ),
                    "audience": self._configuration.oidc_audience,
                },
            },
        }
        try:
            response = self._client.create_task(
                request={
                    "parent": self._configuration.queue_path,
                    "task": task,
                },
                timeout=self._configuration.request_timeout_seconds,
            )
        except self._already_exists_errors:
            return task_name
        except Exception as exc:
            raise InsurerResponseDispatchUnavailableError(
                "Response analysis dispatch is unavailable"
            ) from exc
        returned_name = (
            response.get("name")
            if isinstance(response, Mapping)
            else getattr(response, "name", None)
        )
        if returned_name != task_name:
            raise InsurerResponseDispatchUnavailableError(
                "Cloud Tasks returned an unexpected task identity"
            )
        return task_name

    def close(self) -> None:
        close = getattr(self._client, "close", None)
        if callable(close):
            close()


class TotalLossInsurerResponseCoordinator:
    """Reconcile durable jobs and resolve authenticated task callbacks."""

    def __init__(
        self,
        database: InsurerResponseAnalysisDispatchDatabase,
        processor: InsurerResponseCaseProcessor,
        dispatcher: InsurerResponseJobDispatcher | None = None,
    ) -> None:
        if not isinstance(database, InsurerResponseAnalysisDispatchDatabase):
            raise TypeError(
                "database must implement response analysis dispatch methods"
            )
        if not isinstance(processor, InsurerResponseCaseProcessor):
            raise TypeError("processor must execute response analysis cases")
        if dispatcher is not None and not isinstance(
            dispatcher, InsurerResponseJobDispatcher
        ):
            raise TypeError("dispatcher must dispatch response analysis jobs")
        self._database = database
        self._processor = processor
        self._dispatcher = dispatcher

    @property
    def dispatcher_configured(self) -> bool:
        return self._dispatcher is not None

    def reconcile_due(
        self, *, limit: int = DEFAULT_RESPONSE_ANALYSIS_DISPATCH_LIMIT
    ) -> InsurerResponseDispatchResult:
        selected_limit = _dispatch_limit(limit)
        if self._dispatcher is None:
            return InsurerResponseDispatchResult(0, 0, 0, False)
        rows = self._database.list_due_total_loss_insurer_response_analysis_jobs(
            selected_limit
        )
        if not isinstance(rows, Sequence) or isinstance(
            rows, (str, bytes, bytearray)
        ):
            raise InsurerResponseProcessingContractError(
                "Response analysis due jobs are invalid"
            )
        dispatched = 0
        failed = 0
        task_names: list[str] = []
        seen_jobs: set[str] = set()
        for value in rows:
            row = _mapping(
                value,
                "Response analysis due job",
                keys={"job_id", "case_id", "attempt_count"},
            )
            job_id = _durable_uuid(row.get("job_id"), "Analysis job ID")
            _durable_uuid(row.get("case_id"), "Case ID")
            attempt_count = _dispatch_attempt_count(row.get("attempt_count"))
            if job_id in seen_jobs:
                raise InsurerResponseProcessingContractError(
                    "Response analysis due jobs contain a duplicate"
                )
            seen_jobs.add(job_id)
            try:
                task_name = self._dispatcher.dispatch(job_id, attempt_count)
                if not isinstance(task_name, str) or not task_name:
                    raise InsurerResponseDispatchUnavailableError(
                        "Dispatcher returned an invalid task identity"
                    )
                dispatched += 1
                task_names.append(task_name)
            except Exception:
                failed += 1
        return InsurerResponseDispatchResult(
            due=len(rows),
            dispatched=dispatched,
            failed=failed,
            dispatcher_configured=True,
            external_task_names=tuple(task_names),
        )

    def execute(self, job_id: str) -> InsurerResponseJobExecutionResult:
        canonical_job_id = _request_uuid(job_id, "Analysis job ID")
        row = self._database.resolve_total_loss_insurer_response_analysis_job_case(
            canonical_job_id
        )
        if row is None:
            return InsurerResponseJobExecutionResult(
                state="not_found",
                job_id=canonical_job_id,
                attempt_count=None,
            )
        resolved = _mapping(
            row,
            "Response analysis job case",
            keys={"job_id", "case_id"},
        )
        if (
            _durable_uuid(resolved.get("job_id"), "Analysis job ID")
            != canonical_job_id
        ):
            raise InsurerResponseProcessingContractError(
                "Response analysis job resolution changed identity"
            )
        case_id = _durable_uuid(resolved.get("case_id"), "Case ID")
        result = self._processor.execute(case_id)
        if not isinstance(result, InsurerResponseExecutionResult):
            raise InsurerResponseProcessingContractError(
                "Response analysis processor returned an invalid result"
            )
        if result.job_id is not None and result.job_id != canonical_job_id:
            return InsurerResponseJobExecutionResult(
                state="superseded",
                job_id=canonical_job_id,
                attempt_count=result.attempt_count,
            )
        return InsurerResponseJobExecutionResult(
            state=result.state,
            job_id=canonical_job_id,
            attempt_count=result.attempt_count,
        )


def _summary_texts(value: Any, label: str) -> tuple[str, ...]:
    """Extract only bounded, explicitly named display facts from approved JSON."""

    allowed_scalar_keys = (
        "summary",
        "description",
        "label",
        "code",
        "vehicle",
        "price",
        "advertisedPrice",
        "adjustedValue",
        "evidenceBasis",
        "relevance",
        "count",
    )
    allowed_collection_keys = (
        "items",
        "comparables",
        "selectedComparables",
        "primary",
        "secondary",
        "findings",
        "limitations",
    )
    collected: list[str] = []

    def append(item: Any, depth: int) -> None:
        if len(collected) >= MAX_CONTEXT_COLLECTION_ITEMS or depth > 3:
            return
        if isinstance(item, str):
            normalized = " ".join(item.split())
            if normalized:
                collected.append(normalized[:2_000])
            return
        if isinstance(item, Sequence) and not isinstance(
            item, (str, bytes, bytearray)
        ):
            for child in list(item)[:MAX_CONTEXT_COLLECTION_ITEMS]:
                append(child, depth + 1)
            return
        if not isinstance(item, Mapping):
            return
        parts: list[str] = []
        for key in allowed_scalar_keys:
            scalar = item.get(key)
            if isinstance(scalar, str) and scalar.strip():
                parts.append(f"{key}: {' '.join(scalar.split())[:500]}")
            elif isinstance(scalar, (int, float)) and not isinstance(scalar, bool):
                parts.append(f"{key}: {scalar}")
        amount = item.get("amountMinorUnits")
        currency = item.get("currency")
        if (
            isinstance(amount, int)
            and not isinstance(amount, bool)
            and isinstance(currency, str)
        ):
            parts.append(f"amountMinorUnits: {amount} {currency[:3]}")
        if parts:
            collected.append("; ".join(parts)[:2_000])
        for key in allowed_collection_keys:
            if key in item:
                append(item[key], depth + 1)

    append(value, 0)
    if not isinstance(value, (str, Sequence, Mapping)):
        raise InsurerResponseProcessingContractError(f"{label} is invalid")
    return tuple(dict.fromkeys(collected))


@dataclass(frozen=True)
class _AllowlistedContext:
    vehicle_year: int
    vehicle_make: str
    vehicle_model: str
    vehicle_trim: str | None
    vehicle_mileage: int | None
    insurer_name: str | None
    original_offer_minor_units: int | None
    original_offer_currency: str | None
    conclusion_code: str
    supported_range_low_minor_units: int | None
    supported_range_high_minor_units: int | None
    supported_range_currency: str | None
    findings: tuple[str, ...]
    limitations: tuple[str, ...]
    reason_codes: tuple[str, ...]
    insurer_comparable_summaries: tuple[str, ...]
    independent_market_summaries: tuple[str, ...]
    request_subject: str | None
    request_body: str
    response_text: str | None
    response_document_filename: str | None
    revised_offer_minor_units: int | None
    revised_offer_currency: str | None


def _allowlisted_context(value: Any) -> _AllowlistedContext:
    root = _mapping(
        value,
        "Response analysis context",
        keys={
            "contextVersion",
            "vehicle",
            "insurer",
            "venfourAssessment",
            "customerRequest",
            "insurerResponse",
            "journey",
        },
    )
    if root.get("contextVersion") != INSURER_RESPONSE_CONTEXT_VERSION:
        raise InsurerResponseProcessingContractError(
            "Response analysis context version is invalid"
        )
    vehicle = _mapping(
        root.get("vehicle"),
        "Response analysis vehicle",
        keys={"vin", "year", "make", "model", "trim", "mileageAtLoss"},
    )
    year = vehicle.get("year")
    if isinstance(year, bool) or not isinstance(year, int) or not 1886 <= year <= 2200:
        raise InsurerResponseProcessingContractError(
            "Response analysis vehicle year is invalid"
        )
    make = _text(vehicle.get("make"), "Response analysis vehicle make", maximum=100)
    model = _text(
        vehicle.get("model"), "Response analysis vehicle model", maximum=100
    )
    trim = _text(
        vehicle.get("trim"),
        "Response analysis vehicle trim",
        nullable=True,
        maximum=200,
    )
    mileage = _optional_nonnegative_integer(
        vehicle.get("mileageAtLoss"), "Response analysis vehicle mileage"
    )

    insurer = _mapping(
        root.get("insurer"),
        "Response analysis insurer",
        keys={"name", "originalOffer"},
    )
    insurer_name = _text(
        insurer.get("name"), "Response analysis insurer name", nullable=True, maximum=500
    )
    original_offer, original_currency = _money(
        insurer.get("originalOffer"), "Response analysis original offer"
    )

    assessment = _mapping(
        root.get("venfourAssessment"),
        "Response analysis Venfour assessment",
        keys={
            "conclusionCode",
            "supportedRange",
            "findings",
            "limitations",
            "reasonCodes",
            "insurerComparableReview",
            "independentMarketEvidence",
        },
    )
    conclusion_code = _text(
        assessment.get("conclusionCode"),
        "Response analysis conclusion",
        maximum=200,
    )
    supported_range = assessment.get("supportedRange")
    range_low: int | None = None
    range_high: int | None = None
    range_currency: str | None = None
    if supported_range is not None:
        range_value = _mapping(
            supported_range,
            "Response analysis supported range",
            keys={
                "lowMinorUnits",
                "medianMinorUnits",
                "highMinorUnits",
                "currency",
            },
        )
        range_low = _optional_nonnegative_integer(
            range_value.get("lowMinorUnits"), "Supported range low"
        )
        range_median = _optional_nonnegative_integer(
            range_value.get("medianMinorUnits"), "Supported range median"
        )
        range_high = _optional_nonnegative_integer(
            range_value.get("highMinorUnits"), "Supported range high"
        )
        range_currency_value = _text(
            range_value.get("currency"),
            "Supported range currency",
            maximum=3,
            nullable=True,
        )
        if all(value is None for value in (range_low, range_median, range_high)):
            range_low = None
            range_high = None
            range_currency = None
        else:
            range_currency = range_currency_value
            if (
                range_low is None
                or range_median is None
                or range_high is None
                or not range_low <= range_median <= range_high
                or not isinstance(range_currency, str)
                or len(range_currency) != 3
            ):
                raise InsurerResponseProcessingContractError(
                    "Response analysis supported range is invalid"
                )

    request = _mapping(
        root.get("customerRequest"),
        "Response analysis customer request",
        keys={"subject", "body", "customerReportedSentAt"},
    )
    request_subject = _text(
        request.get("subject"),
        "Response analysis request subject",
        nullable=True,
        maximum=998,
    )
    request_body = _text(
        request.get("body"),
        "Response analysis request body",
        maximum=MAX_RESPONSE_TEXT_CHARACTERS,
    )
    _text(
        request.get("customerReportedSentAt"),
        "Response analysis sent timestamp",
        nullable=True,
        maximum=64,
    )

    response = _mapping(
        root.get("insurerResponse"),
        "Response analysis insurer response",
        keys={
            "text",
            "receivedAt",
            "document",
            "customerRecordedRevisedOffer",
        },
    )
    response_text = _text(
        response.get("text"),
        "Response analysis response text",
        nullable=True,
        maximum=MAX_RESPONSE_TEXT_CHARACTERS,
    )
    _text(
        response.get("receivedAt"),
        "Response analysis receipt timestamp",
        maximum=64,
    )
    document_filename: str | None = None
    if response.get("document") is not None:
        document = _mapping(
            response.get("document"),
            "Response analysis document description",
            keys={"originalFilename", "mediaType", "byteSize"},
        )
        document_filename = _text(
            document.get("originalFilename"),
            "Response analysis document filename",
            maximum=255,
        )
        _text(
            document.get("mediaType"),
            "Response analysis document media type",
            maximum=100,
        )
        _positive_integer(
            document.get("byteSize"), "Response analysis document byte size"
        )
    revised_offer, revised_currency = _money(
        response.get("customerRecordedRevisedOffer"),
        "Response analysis revised offer",
    )

    journey = _mapping(
        root.get("journey"),
        "Response analysis journey",
        keys={"phase", "currentTask", "negotiationRoundNumber"},
    )
    _text(journey.get("phase"), "Response analysis journey phase", maximum=64)
    _text(
        journey.get("currentTask"), "Response analysis journey task", maximum=64
    )
    _positive_integer(
        journey.get("negotiationRoundNumber"),
        "Response analysis negotiation round",
    )

    findings = _summary_texts(
        assessment.get("findings"), "Response analysis findings"
    )
    limitations = _summary_texts(
        assessment.get("limitations"), "Response analysis limitations"
    )
    reason_codes = _summary_texts(
        assessment.get("reasonCodes"), "Response analysis reason codes"
    )
    comparable_summaries = _summary_texts(
        assessment.get("insurerComparableReview"),
        "Response analysis insurer comparable review",
    )
    market_summaries = _summary_texts(
        assessment.get("independentMarketEvidence"),
        "Response analysis independent market evidence",
    )
    if not findings:
        findings = (f"Deterministic conclusion: {conclusion_code}",)

    return _AllowlistedContext(
        vehicle_year=year,
        vehicle_make=str(make),
        vehicle_model=str(model),
        vehicle_trim=trim,
        vehicle_mileage=mileage,
        insurer_name=insurer_name,
        original_offer_minor_units=original_offer,
        original_offer_currency=original_currency,
        conclusion_code=str(conclusion_code),
        supported_range_low_minor_units=range_low,
        supported_range_high_minor_units=range_high,
        supported_range_currency=range_currency,
        findings=findings,
        limitations=limitations,
        reason_codes=reason_codes,
        insurer_comparable_summaries=comparable_summaries,
        independent_market_summaries=market_summaries,
        request_subject=request_subject,
        request_body=str(request_body),
        response_text=response_text,
        response_document_filename=document_filename,
        revised_offer_minor_units=revised_offer,
        revised_offer_currency=revised_currency,
    )


def _case_evidence(context: _AllowlistedContext) -> tuple[CaseEvidenceContext, ...]:
    items: list[CaseEvidenceContext] = []

    def add(
        evidence_type: str,
        namespace: str,
        summary: str,
        *,
        amount: int | None = None,
        currency: str | None = None,
    ) -> None:
        stable_identity = hashlib.sha256(summary.encode("utf-8")).hexdigest()
        items.append(
            CaseEvidenceContext(
                evidence_ref=make_case_evidence_reference(
                    namespace, stable_identity
                ),
                evidence_type=evidence_type,
                summary=summary,
                amount_minor_units=amount,
                currency=currency,
            )
        )

    if context.original_offer_minor_units is not None:
        add(
            "INSURER_VALUATION",
            "original_insurer_offer",
            "The case records the insurer's original offer.",
            amount=context.original_offer_minor_units,
            currency=context.original_offer_currency,
        )
    if context.supported_range_low_minor_units is not None:
        add(
            "VENFOUR_FINDING",
            "venfour_supported_range_low",
            "Venfour's deterministic evidence supports the saved advertised-price range.",
            amount=context.supported_range_low_minor_units,
            currency=context.supported_range_currency,
        )
        add(
            "VENFOUR_FINDING",
            "venfour_supported_range_high",
            "Upper bound of Venfour's saved advertised-price evidence range.",
            amount=context.supported_range_high_minor_units,
            currency=context.supported_range_currency,
        )
    for evidence_type, namespace, summaries in (
        ("VENFOUR_FINDING", "venfour_finding", context.findings),
        ("VENFOUR_FINDING", "venfour_limitation", context.limitations),
        ("VENFOUR_FINDING", "venfour_reason_code", context.reason_codes),
        (
            "VENFOUR_COMPARABLE",
            "insurer_comparable_review",
            context.insurer_comparable_summaries,
        ),
        (
            "VENFOUR_COMPARABLE",
            "independent_market_evidence",
            context.independent_market_summaries,
        ),
    ):
        for summary in summaries[:MAX_CONTEXT_COLLECTION_ITEMS]:
            add(evidence_type, namespace, summary)
    return tuple(items)


def _continuation_support(conclusion_code: str) -> bool | None:
    if conclusion_code in {
        "MATERIAL_UNDERVALUE_SIGNAL",
        "POTENTIAL_UNDERVALUE",
        "SUPPORTS_CONTINUATION",
    }:
        return True
    if conclusion_code in {
        "NO_MATERIAL_DISCREPANCY",
        "DOES_NOT_SUPPORT_CONTINUATION",
    }:
        return False
    return None


def _analysis_evidence_index(
    request: InsurerResponseAnalysisInputV1,
) -> dict[str, Any]:
    """Build the customer-safe citation catalog from server-owned input only."""

    response_evidence = [
        {
            "evidenceRef": str(item["evidenceRef"]),
            "sourceType": str(item["sourceType"]),
            "content": item["content"],
            "pageNumber": item["pageNumber"],
        }
        for item in request.response_materials
    ]
    case_evidence: list[dict[str, Any]] = [
        {
            "evidenceRef": str(item["evidenceRef"]),
            "evidenceType": str(item["evidenceType"]),
            "summary": str(item["summary"]),
            "amountMinorUnits": item["amountMinorUnits"],
            "currency": item["currency"],
        }
        for item in request.case_evidence
    ]

    def add_case_item(
        item: Mapping[str, Any],
        *,
        evidence_type: str,
        summary: str,
        amount_key: str | None = None,
    ) -> None:
        reference = item.get("evidenceRef")
        if not isinstance(reference, str):
            return
        if any(
            existing["evidenceRef"] == reference for existing in case_evidence
        ):
            return
        amount = item.get(amount_key) if amount_key is not None else None
        currency = item.get("currency") if amount is not None else None
        case_evidence.append(
            {
                "evidenceRef": reference,
                "evidenceType": evidence_type,
                "summary": summary[:2_000],
                "amountMinorUnits": amount,
                "currency": currency,
            }
        )

    prior = request.prior_position
    prior_summary = prior.get("summary")
    add_case_item(
        prior,
        evidence_type="INSURER_VALUATION",
        summary=(
            str(prior_summary)
            if isinstance(prior_summary, str)
            else "The saved case records the insurer's prior valuation position."
        ),
        amount_key="offerAmountMinorUnits",
    )
    assessment = request.venfour_assessment
    add_case_item(
        assessment,
        evidence_type="VENFOUR_FINDING",
        summary=str(assessment["summary"]),
    )
    customer_request = request.customer_request
    request_body = str(customer_request["body"])
    subject = customer_request.get("subject")
    add_case_item(
        customer_request,
        evidence_type="CUSTOMER_REQUEST",
        summary=(
            f"{subject}: {request_body}"
            if isinstance(subject, str)
            else request_body
        ),
    )
    return {
        "responseEvidence": response_evidence,
        "caseEvidence": case_evidence,
    }


def _analysis_input(
    context: _AllowlistedContext,
    document: InsurerResponseDocumentUnderstanding | None,
) -> InsurerResponseAnalysisInputV1:
    request_identity = hashlib.sha256(
        context.request_body.encode("utf-8")
    ).hexdigest()
    request_ref = make_case_evidence_reference(
        "customer_request", request_identity
    )
    finding_summary = " ".join(context.findings[:3])[:2_000]
    venfour_summary = (
        f"The saved deterministic case conclusion is {context.conclusion_code}. "
        f"{finding_summary}"
    ).strip()
    prior_position = None
    if context.original_offer_minor_units is not None:
        prior_position = "The case records an earlier insurer offer."
    return build_insurer_response_analysis_input_v1(
        vehicle_year=context.vehicle_year,
        vehicle_make=context.vehicle_make,
        vehicle_model=context.vehicle_model,
        vehicle_trim=context.vehicle_trim,
        vehicle_mileage=context.vehicle_mileage,
        insurer_name=context.insurer_name,
        original_offer_minor_units=context.original_offer_minor_units,
        original_offer_currency=context.original_offer_currency,
        prior_position_summary=prior_position,
        venfour_classification_label=context.conclusion_code,
        venfour_continuing_supported=_continuation_support(
            context.conclusion_code
        ),
        supported_range_low_minor_units=(
            context.supported_range_low_minor_units
        ),
        supported_range_high_minor_units=(
            context.supported_range_high_minor_units
        ),
        supported_range_currency=context.supported_range_currency,
        venfour_summary=venfour_summary,
        venfour_findings=context.findings,
        venfour_limitations=context.limitations,
        case_evidence=_case_evidence(context),
        request_subject=context.request_subject,
        request_body=context.request_body,
        request_evidence_ref=request_ref,
        response_text=context.response_text,
        document=document,
        revised_offer_minor_units=context.revised_offer_minor_units,
        revised_offer_currency=context.revised_offer_currency,
        journey_state="REVIEWING_RESPONSE",
    )


def _empty_extraction() -> dict[str, Any]:
    return {
        "status": "NOT_PROVIDED",
        "mediaType": None,
        "contentDigest": None,
        "evidenceRef": None,
        "pageCount": None,
        "passages": [],
        "limitations": [],
    }


class TotalLossInsurerResponseProcessor:
    """Claim, interpret, and durably complete one current response lineage."""

    _claim_outcomes = {
        "claimed",
        "processing",
        "retry_scheduled",
        "not_found",
        "completed",
        "terminal_failed",
        "unsupported",
        "superseded",
    }
    _job_statuses = {
        "pending",
        "processing",
        "completed",
        "retryable_failed",
        "terminal_failed",
        "unsupported",
        "superseded",
    }

    def __init__(
        self,
        database: InsurerResponseAnalysisDatabase,
        configuration: InsurerResponseAnalysisConfiguration,
        *,
        analyzer: InsurerResponseAnalyzer | None = None,
        token_factory: Callable[[], Any] = uuid4,
        retry_delay_seconds: int = DEFAULT_RESPONSE_ANALYSIS_RETRY_DELAY_SECONDS,
    ) -> None:
        if not isinstance(database, InsurerResponseAnalysisDatabase):
            raise TypeError(
                "database must implement InsurerResponseAnalysisDatabase"
            )
        if not isinstance(configuration, InsurerResponseAnalysisConfiguration):
            raise TypeError(
                "configuration must be InsurerResponseAnalysisConfiguration"
            )
        if analyzer is not None and not isinstance(analyzer, InsurerResponseAnalyzer):
            raise TypeError("analyzer must implement InsurerResponseAnalyzer")
        if not callable(token_factory):
            raise TypeError("token_factory must be callable")
        if (
            isinstance(retry_delay_seconds, bool)
            or not isinstance(retry_delay_seconds, int)
            or not 1
            <= retry_delay_seconds
            <= MAX_RESPONSE_ANALYSIS_RETRY_DELAY_SECONDS
        ):
            raise ValueError("Response analysis retry delay is invalid")
        self._database = database
        self._configuration = configuration
        self._analyzer = analyzer
        self._token_factory = token_factory
        self._retry_delay_seconds = retry_delay_seconds

    def _new_token(self) -> str:
        try:
            return _request_uuid(str(self._token_factory()), "Processing token")
        except (TypeError, ValueError) as exc:
            raise InsurerResponseProcessingUnavailableError(
                "Response analysis processing token is unavailable"
            ) from exc

    @property
    def _model_identifier(self) -> str:
        return self._configuration.model_identifier or "unconfigured"

    @staticmethod
    def should_process(response: Mapping[str, Any] | None) -> bool:
        return bool(
            isinstance(response, Mapping)
            and response.get("processingState")
            in {"pending", "processing"}
        )

    def retry(
        self,
        case_id: str,
        client_request_id: str,
        workflow_revision: int,
        access_token: str,
    ) -> dict[str, Any]:
        canonical_case = _request_uuid(case_id, "Case ID")
        canonical_request = _request_uuid(client_request_id, "Client request ID")
        revision = _positive_integer(workflow_revision, "Workflow revision")
        if not isinstance(access_token, str) or not access_token.strip():
            raise ValueError("Authentication is required")
        row = _mapping(
            self._database.retry_total_loss_insurer_response_analysis(
                canonical_case,
                canonical_request,
                revision,
                access_token,
            ),
            "Response analysis retry",
            keys={"state", "processingState", "workflowRevision"},
        )
        if (
            row.get("state") != "insurer_response_reviewing"
            or row.get("processingState") != "pending"
            or _positive_integer(
                row.get("workflowRevision"), "Workflow revision"
            )
            < revision
        ):
            raise InsurerResponseProcessingContractError(
                "Response analysis retry result is invalid"
            )
        return dict(row)

    @staticmethod
    def _claim_result(
        row: Mapping[str, Any], case_id: str, processing_token: str
    ) -> InsurerResponseExecutionResult:
        value = _mapping(
            row,
            "Response analysis claim",
            keys={
                "outcome",
                "job_id",
                "run_id",
                "attempt_count",
                "status",
                "processing_expires_at",
            },
        )
        outcome = value.get("outcome")
        status = value.get("status")
        if outcome not in TotalLossInsurerResponseProcessor._claim_outcomes:
            raise InsurerResponseProcessingContractError(
                "Response analysis claim is invalid"
            )
        if outcome == "not_found":
            if any(
                value.get(key) is not None
                for key in (
                    "job_id",
                    "run_id",
                    "attempt_count",
                    "status",
                    "processing_expires_at",
                )
            ):
                raise InsurerResponseProcessingContractError(
                    "Response analysis claim is invalid"
                )
            return InsurerResponseExecutionResult(
                state="not_found",
                case_id=case_id,
                job_id=None,
                run_id=None,
                attempt_count=None,
            )
        if status not in TotalLossInsurerResponseProcessor._job_statuses:
            raise InsurerResponseProcessingContractError(
                "Response analysis claim is invalid"
            )
        job_id = value.get("job_id")
        run_id = value.get("run_id")
        attempt_count = value.get("attempt_count")
        canonical_job = _canonical_uuid(job_id, "Response analysis job ID")
        canonical_run = (
            _canonical_uuid(run_id, "Response analysis run ID")
            if run_id is not None
            else None
        )
        if attempt_count is not None:
            attempt_count = _optional_nonnegative_integer(
                attempt_count, "Response analysis attempt count"
            )
        if outcome == "claimed" and (
            canonical_run is None
            or attempt_count is None
            or attempt_count < 1
            or status != "processing"
            or not isinstance(value.get("processing_expires_at"), str)
        ):
            raise InsurerResponseProcessingContractError(
                "Response analysis claim is invalid"
            )
        return InsurerResponseExecutionResult(
            state=outcome,
            case_id=case_id,
            job_id=canonical_job,
            run_id=canonical_run,
            attempt_count=attempt_count,
        )

    def _context(
        self,
        job_id: str,
        run_id: str,
        processing_token: str,
        expected_case_id: str,
    ) -> tuple[Mapping[str, Any], _AllowlistedContext]:
        row = _mapping(
            self._database.resolve_total_loss_insurer_response_analysis_context(
                job_id, processing_token
            ),
            "Response analysis context row",
            keys={
                "job_id",
                "run_id",
                "case_id",
                "analysis_context",
                "response_document_id",
                "response_document_bucket",
                "response_document_object_name",
                "response_document_media_type",
                "response_document_byte_size",
                "response_document_content_digest",
                "existing_extraction_version",
                "existing_extraction",
                "existing_extraction_digest",
                "final_assessment",
                "assessment_digest",
                "customer_offer",
            },
        )
        if (
            _canonical_uuid(row.get("job_id"), "Response analysis job ID")
            != job_id
            or _canonical_uuid(row.get("run_id"), "Response analysis run ID")
            != run_id
            or _canonical_uuid(row.get("case_id"), "Case ID")
            != expected_case_id
        ):
            raise InsurerResponseProcessingContractError(
                "Response analysis context lineage is invalid"
            )
        return row, _allowlisted_context(row.get("analysis_context"))

    def _document(
        self,
        context_row: Mapping[str, Any],
        context: _AllowlistedContext,
        processing_token: str,
    ) -> InsurerResponseDocumentUnderstanding | None:
        fields = (
            context_row.get("response_document_id"),
            context_row.get("response_document_bucket"),
            context_row.get("response_document_object_name"),
            context_row.get("response_document_media_type"),
            context_row.get("response_document_byte_size"),
            context_row.get("response_document_content_digest"),
        )
        if all(value is None for value in fields):
            if context.response_document_filename is not None:
                raise InsurerResponseProcessingContractError(
                    "Response document context is incomplete"
                )
            return None
        if any(value is None for value in fields):
            raise InsurerResponseProcessingContractError(
                "Response document locator is incomplete"
            )
        document_id = _canonical_uuid(fields[0], "Response document ID")
        bucket = _text(fields[1], "Response document bucket", maximum=100)
        object_name = _text(
            fields[2], "Response document object name", maximum=1_024
        )
        media_type = _text(
            fields[3], "Response document media type", maximum=100
        )
        byte_size = _positive_integer(fields[4], "Response document byte size")
        digest = _text(fields[5], "Response document digest", maximum=64)
        if (
            not isinstance(digest, str)
            or len(digest) != 64
            or any(character not in "0123456789abcdef" for character in digest)
        ):
            raise InsurerResponseProcessingContractError(
                "Response document digest is invalid"
            )
        with self._database.materialize_total_loss_insurer_response_document(
            context_row["case_id"],
            document_id,
            {
                "storage_bucket_id": bucket,
                "storage_object_name": object_name,
            },
            str(media_type),
            byte_size,
            digest,
            processing_token,
        ) as document_path:
            try:
                content = document_path.read_bytes()
            except OSError as exc:
                raise InsurerResponseProcessingUnavailableError(
                    "Response document could not be read"
                ) from exc
        return understand_insurer_response_document(
            content,
            media_type=str(media_type),
            filename=context.response_document_filename,
            expected_sha256=digest,
        )

    @staticmethod
    def _failure(error: Exception) -> tuple[str, str, int]:
        if isinstance(error, InsurerResponseAnalysisUnsupportedError):
            return error.code, "unsupported", 0
        if isinstance(error, InsurerResponseAnalysisError):
            return (
                error.code,
                "retryable" if error.retryable else "terminal",
                DEFAULT_RESPONSE_ANALYSIS_RETRY_DELAY_SECONDS
                if error.retryable
                else 0,
            )
        if isinstance(error, SupabaseResponseDocumentNotFoundError):
            return "INSURER_RESPONSE_DOCUMENT_MISSING", "terminal", 0
        if isinstance(error, SupabaseResponseDocumentInvalidError):
            return "INSURER_RESPONSE_MATERIAL_UNREADABLE", "terminal", 0
        if isinstance(
            error,
            (SupabaseUnavailableError, InsurerResponseProcessingUnavailableError),
        ):
            return (
                "INSURER_RESPONSE_ANALYSIS_DEPENDENCY_UNAVAILABLE",
                "retryable",
                DEFAULT_RESPONSE_ANALYSIS_RETRY_DELAY_SECONDS,
            )
        if isinstance(
            error,
            (SupabaseContractError, InsurerResponseProcessingContractError, InsurerResponseRecommendationError),
        ):
            return "INSURER_RESPONSE_ANALYSIS_CONTEXT_INVALID", "terminal", 0
        return (
            "INSURER_RESPONSE_ANALYSIS_FAILED",
            "retryable",
            DEFAULT_RESPONSE_ANALYSIS_RETRY_DELAY_SECONDS,
        )

    def _record_failure(
        self,
        job_id: str,
        processing_token: str,
        run_id: str,
        error: Exception,
    ) -> InsurerResponseExecutionResult:
        code, kind, default_delay = self._failure(error)
        delay = self._retry_delay_seconds if kind == "retryable" else default_delay
        try:
            row = _mapping(
                self._database.fail_total_loss_insurer_response_analysis(
                    job_id,
                    processing_token,
                    run_id,
                    code,
                    kind,
                    delay,
                ),
                "Response analysis failure",
                keys={"outcome", "status", "workflow_revision"},
            )
        except Exception as persistence_error:
            raise InsurerResponseProcessingUnavailableError(
                "Response analysis failure could not be recorded"
            ) from persistence_error
        outcome = row.get("outcome")
        status = row.get("status")
        if outcome not in {
            "retryable_failed",
            "terminal_failed",
            "unsupported",
            "duplicate",
            "superseded",
            "not_found",
        } or status not in self._job_statuses:
            raise InsurerResponseProcessingContractError(
                "Response analysis failure result is invalid"
            )
        revision = row.get("workflow_revision")
        if revision is not None:
            revision = _positive_integer(revision, "Workflow revision")
        return InsurerResponseExecutionResult(
            state=outcome,
            case_id="",
            job_id=job_id,
            run_id=run_id,
            attempt_count=None,
            workflow_revision=revision,
        )

    def execute(self, case_id: str) -> InsurerResponseExecutionResult:
        canonical_case_id = _request_uuid(case_id, "Case ID")
        processing_token = self._new_token()
        try:
            claim_row = self._database.claim_current_total_loss_insurer_response_analysis(
                canonical_case_id,
                processing_token,
                INSURER_RESPONSE_PROVIDER_IDENTIFIER,
                self._model_identifier,
                INSURER_RESPONSE_ANALYSIS_PROMPT_VERSION,
                INSURER_RESPONSE_ANALYSIS_SCHEMA_VERSION,
                INSURER_RESPONSE_CONTEXT_VERSION,
            )
            claimed = self._claim_result(
                claim_row, canonical_case_id, processing_token
            )
        except Exception as exc:
            raise InsurerResponseProcessingUnavailableError(
                "Response analysis work could not be claimed"
            ) from exc
        if claimed.state != "claimed":
            return claimed
        if claimed.job_id is None or claimed.run_id is None:
            raise InsurerResponseProcessingContractError(
                "Response analysis claim is incomplete"
            )
        try:
            if self._analyzer is None:
                raise InsurerResponseAnalysisUnavailableError(
                    "Response analyzer is not configured",
                    code="INSURER_RESPONSE_ANALYSIS_NOT_CONFIGURED",
                    retryable=True,
                )
            context_row, context = self._context(
                claimed.job_id,
                claimed.run_id,
                processing_token,
                canonical_case_id,
            )
            document = self._document(
                context_row, context, processing_token
            )
            request = _analysis_input(context, document)
            completed = self._analyzer.analyze(request, document=document)
            if not isinstance(completed, CompletedInsurerResponseAnalysis):
                raise InsurerResponseProcessingContractError(
                    "Response analyzer returned an invalid result"
                )
            extraction = (
                document.to_record() if document is not None else _empty_extraction()
            )
            result = completed.analysis.to_dict()
            usage_metadata = dict(completed.usage_metadata)
            usage_metadata.update(
                {
                    "inputSchemaVersion": completed.input_schema_version,
                    "providerOutputDigest": completed.output_digest,
                }
            )
            persisted_result_digest = _canonical_json_digest(result)
            evidence_index = _analysis_evidence_index(request)
            evidence_index_digest = _canonical_json_digest(evidence_index)
            recommendation = build_insurer_response_recommendation_v1(
                analysis=result,
                evidence_index=evidence_index,
                final_assessment=context_row["final_assessment"],
                assessment_digest=context_row["assessment_digest"],
                customer_offer=context_row["customer_offer"],
            )
            completion = _mapping(
                self._database.complete_total_loss_insurer_response_analysis(
                    claimed.job_id,
                    processing_token,
                    claimed.run_id,
                    completed.returned_model_identifier,
                    completed.input_digest,
                    result,
                    persisted_result_digest,
                    usage_metadata,
                    INSURER_RESPONSE_EXTRACTION_VERSION,
                    extraction,
                    _canonical_json_digest(extraction),
                    document.content_digest if document is not None else None,
                    evidence_index,
                    evidence_index_digest,
                    recommendation,
                    _canonical_json_digest(recommendation),
                ),
                "Response analysis completion",
                keys={"outcome", "status", "workflow_revision"},
            )
            if (
                completion.get("outcome")
                not in {"completed", "duplicate", "superseded", "not_found"}
                or completion.get("status") not in self._job_statuses
            ):
                raise InsurerResponseProcessingContractError(
                    "Response analysis completion result is invalid"
                )
            revision = completion.get("workflow_revision")
            if revision is not None:
                revision = _positive_integer(revision, "Workflow revision")
            return InsurerResponseExecutionResult(
                state=str(completion["outcome"]),
                case_id=canonical_case_id,
                job_id=claimed.job_id,
                run_id=claimed.run_id,
                attempt_count=claimed.attempt_count,
                workflow_revision=revision,
            )
        except Exception as exc:
            failed = self._record_failure(
                claimed.job_id,
                processing_token,
                claimed.run_id,
                exc,
            )
            return InsurerResponseExecutionResult(
                state=failed.state,
                case_id=canonical_case_id,
                job_id=claimed.job_id,
                run_id=claimed.run_id,
                attempt_count=claimed.attempt_count,
                workflow_revision=failed.workflow_revision,
            )


__all__ = [
    "CloudTasksInsurerResponseJobDispatcher",
    "DEFAULT_RESPONSE_ANALYSIS_DISPATCH_LIMIT",
    "DEFAULT_RESPONSE_ANALYSIS_RECONCILIATION_INTERVAL_SECONDS",
    "DEFAULT_RESPONSE_ANALYSIS_RETRY_DELAY_SECONDS",
    "INSURER_RESPONSE_CONTEXT_VERSION",
    "INSURER_RESPONSE_EXTRACTION_VERSION",
    "InsurerResponseAnalysisDatabase",
    "InsurerResponseAnalysisDispatchDatabase",
    "InsurerResponseAnalyzer",
    "InsurerResponseDispatchResult",
    "InsurerResponseDispatchUnavailableError",
    "InsurerResponseExecutionResult",
    "InsurerResponseJobExecutionResult",
    "InsurerResponseProcessingContractError",
    "InsurerResponseProcessingError",
    "InsurerResponseProcessingUnavailableError",
    "InsurerResponseRecommendationDatabase",
    "TotalLossInsurerResponseCoordinator",
    "TotalLossInsurerResponseProcessor",
    "backfill_current_insurer_response_recommendation",
]
