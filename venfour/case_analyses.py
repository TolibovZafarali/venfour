"""Owned, durable application boundary for total-loss case analyses.

The database owns claiming and idempotency.  This service executes a claimed
job synchronously, while a server-generated processing token fences every
completion or failure write.  Raw report locations and user ownership never
cross the public HTTP boundary.
"""

from __future__ import annotations

import json
import math
import sys
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from venfour.analysis_runs import (
    AnalysisRunArtifact,
    AnalysisRunContractError,
    AnalysisRunNotFoundError,
    AnalysisRunRepository,
    AnalysisRunRepositoryError,
    AnalysisRunValidationUnavailableError,
    AnalysisRunWriteError,
    InvalidAnalysisRunArtifactError,
    canonical_json_bytes,
)
from venfour.creation import (
    AnalysisConfirmedInputError,
    AnalysisCreationExecutionError,
    AnalysisCreationInputError,
    AnalysisCreationProviderError,
    AnalysisCreationUnavailableError,
    AnalysisExtractionError,
    AnalysisReportValidationError,
    AnalysisUnsupportedReportError,
    create_live_analysis_creation_service,
)
from venfour.presentation import AnalysisPresentationService
from venfour.postal_codes import normalize_us_zip_code
from venfour.report_ingestion import (
    NormalizedReportContractError,
    ReportDocumentInvalidError,
    ReportExtractionError as NeutralReportExtractionError,
    ReportIngestionResult,
    ReportIngestionService,
    validate_normalized_report,
)
from venfour.supabase_gateway import (
    CaseAnalysisGateway,
    ReportIngestionGateway,
    SupabaseContractError,
    SupabaseGatewayError,
    SupabaseReportInvalidError,
    SupabaseReportNotFoundError,
    SupabaseUnavailableError,
)


CASE_ANALYSIS_STATUSES = frozenset(
    {"not_submitted", "processing", "completed", "failed"}
)
CASE_ANALYSIS_OUTCOMES = frozenset(
    {
        "claimed",
        *CASE_ANALYSIS_STATUSES,
        "not_found",
        "report_intake_required",
        "intake_not_ready",
        "postal_code_required",
        "invalid_postal_code",
        "report_required",
        "case_not_ready",
    }
)
MAX_PUBLIC_OPTIONS_PACKAGES_CHARACTERS = 4_000

FAILURE_MESSAGES = {
    "REPORT_UNAVAILABLE": "The valuation report is temporarily unavailable.",
    "INVALID_REPORT": "The valuation report is invalid.",
    "REPORT_EXTRACTION_FAILED": "The valuation report could not be extracted.",
    "REPORT_NOT_ANALYZABLE": "The valuation report could not be analyzed.",
    "UNSUPPORTED_REPORT": "The valuation report could not be processed.",
    "ANALYSIS_INPUT_INVALID": (
        "Confirmed vehicle and claim information is incomplete."
    ),
    "MARKET_PROVIDER_UNAVAILABLE": "Market evidence is temporarily unavailable.",
    "ANALYSIS_CREATION_UNAVAILABLE": "Analysis creation is temporarily unavailable.",
    "ANALYSIS_CREATION_FAILED": "The analysis could not be created.",
}

OUTCOME_ERROR_CODES = {
    "report_intake_required": "REPORT_INTAKE_REQUIRED",
    "intake_not_ready": "REPORT_INTAKE_NOT_READY",
    "postal_code_required": "POSTAL_CODE_REQUIRED",
    "invalid_postal_code": "INVALID_POSTAL_CODE",
    "report_required": "REPORT_REQUIRED",
    "case_not_ready": "CASE_NOT_READY",
}


class CaseAnalysisError(Exception):
    """Base class for expected owned case-analysis failures."""


class CaseAnalysisInputError(CaseAnalysisError):
    """A case or run path identifier is malformed."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class CaseAnalysisNotFoundError(CaseAnalysisError):
    """The requested case or owned analysis is absent."""


class CaseAnalysisConflictError(CaseAnalysisError):
    """The case is owned but not ready for analysis."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class CaseAnalysisUnavailableError(CaseAnalysisError):
    """A required private persistence or orchestration boundary failed."""


class CaseAnalysisContractError(CaseAnalysisError):
    """A trusted backend boundary returned invalid case-analysis state."""


def _canonical_uuid(value: Any, label: str, *, version_four: bool = False) -> str:
    if not isinstance(value, str):
        raise CaseAnalysisContractError(f"{label} is invalid")
    try:
        parsed = UUID(value)
    except (AttributeError, TypeError, ValueError) as exc:
        raise CaseAnalysisContractError(f"{label} is invalid") from exc
    if str(parsed) != value or (version_four and parsed.version != 4):
        raise CaseAnalysisContractError(f"{label} is invalid")
    return value


def _path_uuid(value: Any, code: str) -> str:
    try:
        return _canonical_uuid(value, code, version_four=True)
    except CaseAnalysisContractError as exc:
        raise CaseAnalysisInputError(code) from exc


def _public_options_packages(value: Any) -> tuple[str | None, bool]:
    """Project extracted equipment to the bounded text field used by intake."""

    if isinstance(value, str):
        raw_items = (value,)
    elif isinstance(value, (list, tuple)) and all(
        isinstance(item, str) for item in value
    ):
        raw_items = tuple(value)
    else:
        return None, False

    items = tuple(
        normalized
        for item in raw_items
        if (normalized := " ".join(item.split()))
    )
    if not items:
        return None, False
    joined = ", ".join(items)
    if len(joined) > MAX_PUBLIC_OPTIONS_PACKAGES_CHARACTERS:
        return None, True
    return joined, False


def _strict_json_object(value: str) -> Mapping[str, Any]:
    def object_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, child in pairs:
            if key in result:
                raise ValueError(f"duplicate object key: {key}")
            result[key] = child
        return result

    def reject_constant(constant: str) -> None:
        raise ValueError(f"non-finite number: {constant}")

    try:
        decoded = json.loads(
            value,
            object_pairs_hook=object_pairs,
            parse_constant=reject_constant,
        )
    except (RecursionError, TypeError, ValueError) as exc:
        raise InvalidAnalysisRunArtifactError(
            "Persisted analysis run is not valid JSON"
        ) from exc
    if not isinstance(decoded, Mapping):
        raise InvalidAnalysisRunArtifactError(
            "Persisted analysis run root is not an object"
        )
    return decoded


class SupabaseAnalysisRunRepository:
    """User-scoped repository over the owned Supabase RPC contract."""

    def __init__(
        self,
        gateway: CaseAnalysisGateway,
        user_id: str,
        *,
        job_id: str | None = None,
        processing_token: str | None = None,
    ) -> None:
        if not isinstance(gateway, CaseAnalysisGateway):
            raise TypeError("gateway must implement CaseAnalysisGateway")
        self._gateway = gateway
        self._user_id = _canonical_uuid(user_id, "User ID")
        if (job_id is None) != (processing_token is None):
            raise ValueError("job_id and processing_token must be supplied together")
        self._job_id = (
            _canonical_uuid(job_id, "Job ID", version_four=True)
            if job_id is not None
            else None
        )
        self._processing_token = (
            _canonical_uuid(
                processing_token, "Processing token", version_four=True
            )
            if processing_token is not None
            else None
        )
        self._completed_run_id: str | None = None

    @property
    def completed_run_id(self) -> str | None:
        return self._completed_run_id

    @staticmethod
    def _validated_artifact(
        payload: Mapping[str, Any] | str,
        expected_run_id: str,
    ) -> AnalysisRunArtifact:
        decoded = _strict_json_object(payload) if isinstance(payload, str) else payload
        if not isinstance(decoded, Mapping):
            raise InvalidAnalysisRunArtifactError(
                "Persisted analysis run root is not an object"
            )
        try:
            artifact = AnalysisRunArtifact.from_dict(decoded)
        except AnalysisRunContractError as exc:
            raise InvalidAnalysisRunArtifactError(
                "Persisted analysis run failed validation",
                getattr(exc, "details", ()),
            ) from exc
        except AnalysisRunValidationUnavailableError:
            raise
        except (KeyError, RecursionError, TypeError, ValueError) as exc:
            raise InvalidAnalysisRunArtifactError(
                "Persisted analysis run failed validation"
            ) from exc
        if artifact.run_id != expected_run_id:
            raise InvalidAnalysisRunArtifactError(
                "Persisted analysis run ID does not match the requested run"
            )
        return artifact

    def get(self, run_id: str) -> AnalysisRunArtifact:
        canonical_run_id = _path_uuid(run_id, "INVALID_RUN_ID")
        try:
            payload = self._gateway.get_owned_analysis_run(
                canonical_run_id, self._user_id
            )
        except SupabaseGatewayError as exc:
            raise AnalysisRunRepositoryError(
                "Owned analysis persistence is unavailable"
            ) from exc
        if payload is None:
            raise AnalysisRunNotFoundError(
                f"Analysis run not found: {canonical_run_id}"
            )
        return self._validated_artifact(payload, canonical_run_id)

    def _matches_durable_artifact(
        self, run_id: str, expected: Mapping[str, Any]
    ) -> bool:
        try:
            durable = self.get(run_id).to_dict()
            return canonical_json_bytes(durable) == canonical_json_bytes(expected)
        except (
            AnalysisRunContractError,
            AnalysisRunRepositoryError,
            AnalysisRunValidationUnavailableError,
            CaseAnalysisError,
        ):
            return False

    def save(self, artifact: AnalysisRunArtifact) -> None:
        if self._job_id is None or self._processing_token is None:
            raise AnalysisRunWriteError(
                "Read-only owned analysis repository cannot save"
            )
        if not isinstance(artifact, AnalysisRunArtifact):
            raise InvalidAnalysisRunArtifactError(
                "Analysis run failed validation before persistence"
            )
        run_id = _path_uuid(artifact.run_id, "INVALID_RUN_ID")
        payload = artifact.to_dict()
        try:
            AnalysisRunArtifact.from_dict(payload)
            completed = self._gateway.complete_total_loss_analysis(
                self._job_id,
                self._processing_token,
                run_id,
                payload,
            )
        except (
            AnalysisRunContractError,
            AnalysisRunValidationUnavailableError,
        ):
            raise
        except SupabaseGatewayError as exc:
            if self._matches_durable_artifact(run_id, payload):
                self._completed_run_id = run_id
                return
            raise AnalysisRunWriteError(
                "Analysis run could not be durably completed"
            ) from exc
        if not completed and not self._matches_durable_artifact(run_id, payload):
            raise AnalysisRunWriteError(
                "Analysis run could not be durably completed"
            )
        self._completed_run_id = run_id


@dataclass(frozen=True)
class CaseAnalysisStatus:
    status: str
    attempt_count: int | None = None
    processing_expires_at: str | None = None
    run_id: str | None = None
    failure_code: str | None = None
    retryable: bool | None = None

    def to_dict(self) -> dict[str, Any]:
        if self.status == "not_submitted":
            return {"status": "not_submitted"}
        if self.status == "processing":
            return {
                "status": "processing",
                "attemptCount": self.attempt_count,
                "processingExpiresAt": self.processing_expires_at,
            }
        if self.status == "completed":
            return {
                "status": "completed",
                "attemptCount": self.attempt_count,
                "runId": self.run_id,
            }
        if self.status == "failed":
            failure_code = self.failure_code or "ANALYSIS_CREATION_FAILED"
            return {
                "status": "failed",
                "error": {
                    "code": failure_code,
                    "message": FAILURE_MESSAGES[failure_code],
                },
                "attemptCount": self.attempt_count,
                "retryable": bool(self.retryable),
            }
        raise CaseAnalysisContractError("Analysis status is invalid")


@dataclass(frozen=True)
class CaseReportIngestion:
    """Allowlisted customer-facing projection of a private cached extraction."""

    status: str
    provider: str | None
    adapter: str
    confidence: str
    warnings: tuple[str, ...]
    missing_fields: tuple[str, ...]
    facts: Mapping[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "provider": self.provider,
            "adapter": self.adapter,
            "confidence": self.confidence,
            "warnings": list(self.warnings),
            "missingFields": list(self.missing_fields),
            "facts": dict(self.facts),
        }


CreationServiceFactory = Callable[[AnalysisRunRepository, str], Any]
TokenFactory = Callable[[], UUID | str]
MonotonicClock = Callable[[], float]
LifecycleEventSink = Callable[[str], None]


def _stdout_lifecycle_event_sink(event_line: str) -> None:
    """Write one complete compact JSON event to standard output."""

    sys.stdout.write(f"{event_line}\n")
    sys.stdout.flush()


def _live_creation_factory(
    repository: AnalysisRunRepository, run_id: str
) -> Any:
    return create_live_analysis_creation_service(
        repository,
        run_id_factory=lambda: run_id,
    )


class CaseAnalysisService:
    """Authenticate, claim, execute, and retrieve user-owned analyses."""

    def __init__(
        self,
        gateway: CaseAnalysisGateway,
        *,
        creation_service_factory: CreationServiceFactory = _live_creation_factory,
        token_factory: TokenFactory = uuid4,
        monotonic_clock: MonotonicClock = time.monotonic,
        lifecycle_event_sink: LifecycleEventSink = _stdout_lifecycle_event_sink,
        report_ingestion_service: ReportIngestionService | None = None,
    ) -> None:
        if not isinstance(gateway, CaseAnalysisGateway):
            raise TypeError("gateway must implement CaseAnalysisGateway")
        if not callable(creation_service_factory):
            raise TypeError("creation_service_factory must be callable")
        if not callable(token_factory):
            raise TypeError("token_factory must be callable")
        if not callable(monotonic_clock):
            raise TypeError("monotonic_clock must be callable")
        if not callable(lifecycle_event_sink):
            raise TypeError("lifecycle_event_sink must be callable")
        selected_ingestion_service = (
            report_ingestion_service
            if report_ingestion_service is not None
            else ReportIngestionService()
        )
        if not callable(getattr(selected_ingestion_service, "ingest", None)):
            raise TypeError("report_ingestion_service must expose ingest(pdf_path)")
        self._gateway = gateway
        self._creation_service_factory = creation_service_factory
        self._token_factory = token_factory
        self._monotonic_clock = monotonic_clock
        self._lifecycle_event_sink = lifecycle_event_sink
        self._report_ingestion_service = selected_ingestion_service

    def _monotonic_time(self) -> float | None:
        try:
            value = self._monotonic_clock()
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                return None
            normalized = float(value)
        except Exception:
            return None
        return normalized if math.isfinite(normalized) else None

    def _emit_lifecycle_event(self, event: Mapping[str, Any]) -> None:
        try:
            event_line = json.dumps(
                dict(event),
                ensure_ascii=True,
                allow_nan=False,
                sort_keys=True,
                separators=(",", ":"),
            )
            self._lifecycle_event_sink(event_line)
        except Exception:
            # Telemetry must never change a customer's durable analysis outcome.
            return

    def _duration_ms(self, started_at: float | None) -> int:
        completed_at = self._monotonic_time()
        if started_at is None or completed_at is None:
            return 0
        elapsed_seconds = completed_at - started_at
        if not math.isfinite(elapsed_seconds) or elapsed_seconds <= 0:
            return 0
        elapsed_milliseconds = elapsed_seconds * 1000
        return int(elapsed_milliseconds) if math.isfinite(elapsed_milliseconds) else 0

    def _emit_claim_started(
        self, *, job_id: str, run_id: str, attempt_count: int
    ) -> float | None:
        started_at = self._monotonic_time()
        self._emit_lifecycle_event(
            {
                "severity": "INFO",
                "event": "case_analysis_started",
                "jobId": job_id,
                "runId": run_id,
                "attemptCount": attempt_count,
            }
        )
        return started_at

    def _emit_claim_terminal(
        self,
        status: CaseAnalysisStatus,
        *,
        job_id: str,
        run_id: str,
        attempt_count: int,
        started_at: float | None,
    ) -> None:
        if status.status == "completed":
            self._emit_lifecycle_event(
                {
                    "severity": "INFO",
                    "event": "case_analysis_completed",
                    "jobId": job_id,
                    "runId": run_id,
                    "attemptCount": attempt_count,
                    "durationMs": self._duration_ms(started_at),
                }
            )
            return
        if status.status == "failed":
            failure_code = status.failure_code or "ANALYSIS_CREATION_FAILED"
            self._emit_lifecycle_event(
                {
                    "severity": "ERROR",
                    "event": "case_analysis_failed",
                    "jobId": job_id,
                    "runId": run_id,
                    "attemptCount": attempt_count,
                    "durationMs": self._duration_ms(started_at),
                    "failureCode": failure_code,
                    "retryable": bool(status.retryable),
                }
            )

    def authenticate(self, access_token: str) -> str:
        return self._gateway.authenticate(access_token)

    @staticmethod
    def _processing_expiry(value: Any) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str) or not value.strip():
            raise CaseAnalysisContractError("Processing expiration is invalid")
        normalized = value.strip()
        try:
            parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
        except ValueError as exc:
            raise CaseAnalysisContractError(
                "Processing expiration is invalid"
            ) from exc
        if parsed.tzinfo is None:
            raise CaseAnalysisContractError("Processing expiration is invalid")
        return normalized

    @staticmethod
    def _attempt_count(row: Mapping[str, Any]) -> int:
        attempt_count = row.get("attempt_count", 0)
        if (
            isinstance(attempt_count, bool)
            or not isinstance(attempt_count, int)
            or attempt_count < 0
        ):
            raise CaseAnalysisContractError("Analysis attempt count is invalid")
        return attempt_count

    @staticmethod
    def _status_from_row(row: Mapping[str, Any]) -> CaseAnalysisStatus:
        if not isinstance(row, Mapping):
            raise CaseAnalysisContractError("Analysis status is invalid")
        outcome = row.get("outcome")
        status_value = row.get("status")
        if outcome == "not_found":
            raise CaseAnalysisNotFoundError("Case was not found")
        if outcome in OUTCOME_ERROR_CODES:
            raise CaseAnalysisConflictError(OUTCOME_ERROR_CODES[outcome])
        if outcome in CASE_ANALYSIS_STATUSES:
            status = outcome
        elif status_value in CASE_ANALYSIS_STATUSES:
            status = status_value
        else:
            raise CaseAnalysisContractError("Analysis status is invalid")

        if status == "not_submitted":
            return CaseAnalysisStatus(status=status)
        if status == "processing":
            return CaseAnalysisStatus(
                status=status,
                attempt_count=CaseAnalysisService._attempt_count(row),
                processing_expires_at=CaseAnalysisService._processing_expiry(
                    row.get("processing_expires_at")
                ),
            )
        if status == "completed":
            return CaseAnalysisStatus(
                status=status,
                attempt_count=CaseAnalysisService._attempt_count(row),
                run_id=_canonical_uuid(
                    row.get("run_id"), "Run ID", version_four=True
                ),
            )
        failure_code = row.get("failure_code")
        if failure_code not in FAILURE_MESSAGES:
            failure_code = "ANALYSIS_CREATION_FAILED"
        retryable = row.get("retryable", False)
        if not isinstance(retryable, bool):
            raise CaseAnalysisContractError("Analysis retry state is invalid")
        return CaseAnalysisStatus(
            status=status,
            attempt_count=CaseAnalysisService._attempt_count(row),
            failure_code=failure_code,
            retryable=retryable,
        )

    def _read_status(self, case_id: str, user_id: str) -> CaseAnalysisStatus:
        try:
            row = self._gateway.get_total_loss_analysis_status(case_id, user_id)
            return self._status_from_row(row)
        except CaseAnalysisError:
            raise
        except SupabaseGatewayError as exc:
            raise CaseAnalysisUnavailableError(
                "Analysis status is unavailable"
            ) from exc

    def status(self, case_id: str, user_id: str) -> CaseAnalysisStatus:
        canonical_case_id = _path_uuid(case_id, "INVALID_CASE_ID")
        canonical_user_id = _canonical_uuid(user_id, "User ID")
        return self._read_status(canonical_case_id, canonical_user_id)

    @staticmethod
    def _claimed_field(row: Mapping[str, Any], key: str, label: str) -> str:
        return _canonical_uuid(row.get(key), label, version_four=True)

    @staticmethod
    def _failure_for(error: Exception) -> tuple[str, bool]:
        if isinstance(error, SupabaseReportNotFoundError):
            return "REPORT_UNAVAILABLE", True
        if isinstance(error, SupabaseReportInvalidError):
            return "INVALID_REPORT", False
        if isinstance(error, SupabaseUnavailableError):
            return "REPORT_UNAVAILABLE", True
        if isinstance(error, AnalysisConfirmedInputError):
            return "ANALYSIS_INPUT_INVALID", False
        if isinstance(error, AnalysisCreationInputError):
            return "INVALID_REPORT", False
        if isinstance(error, AnalysisExtractionError):
            return "REPORT_EXTRACTION_FAILED", True
        if isinstance(error, AnalysisReportValidationError):
            return "REPORT_NOT_ANALYZABLE", False
        if isinstance(error, AnalysisUnsupportedReportError):
            return "UNSUPPORTED_REPORT", False
        if isinstance(error, AnalysisCreationProviderError):
            return "MARKET_PROVIDER_UNAVAILABLE", True
        if isinstance(error, AnalysisCreationUnavailableError):
            return "ANALYSIS_CREATION_UNAVAILABLE", True
        return "ANALYSIS_CREATION_FAILED", True

    @staticmethod
    def _input_revision(value: Any) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise CaseAnalysisContractError("Analysis input revision is invalid")
        return value

    @staticmethod
    def _cache_result(row: Mapping[str, Any]) -> ReportIngestionResult:
        if not isinstance(row, Mapping):
            raise CaseAnalysisContractError("Report extraction cache is invalid")
        cached = row.get("normalized_report")
        if not isinstance(cached, Mapping):
            raise CaseAnalysisContractError("Report extraction cache is invalid")
        try:
            return ReportIngestionResult.from_dict(cached)
        except (NormalizedReportContractError, TypeError, ValueError) as exc:
            raise CaseAnalysisContractError(
                "Report extraction cache is invalid"
            ) from exc

    @staticmethod
    def _public_ingestion(
        ingestion: ReportIngestionResult,
        input_snapshot: Mapping[str, Any] | None,
    ) -> CaseReportIngestion:
        normalized = ingestion.normalized_report
        report = normalized["report"]
        vehicle = normalized["vehicle"]
        valuation = normalized["valuation"]
        condition = normalized["condition"]
        snapshot = input_snapshot if isinstance(input_snapshot, Mapping) else {}

        def preferred(extracted: Any, *snapshot_keys: str) -> Any:
            if extracted is not None and extracted != []:
                return extracted
            for key in snapshot_keys:
                value = snapshot.get(key)
                if value is not None:
                    return value
            return extracted

        field_names = {
            "report.lossDate": "dateOfLoss",
            "report.insurer": "insurerName",
            "vehicle.year": "vehicleYear",
            "vehicle.make": "make",
            "vehicle.model": "model",
            "vehicle.trim": "trim",
            "vehicle.mileage": "mileageAtLoss",
            "condition.preLossCondition": "vehicleCondition",
            "vehicle.equipment": "optionsPackages",
        }
        nonblocking_fields = {
            "condition.preLossCondition",
            "vehicle.equipment",
        }
        missing = [
            field_names.get(field, field)
            for field in ingestion.missing_required_fields
            if field not in nonblocking_fields
        ]
        raw_options_packages = preferred(
            list(vehicle["equipment"]),
            "vehicle_options_packages",
            "vehicleOptionsPackages",
        )
        options_packages, options_packages_too_long = (
            _public_options_packages(raw_options_packages)
        )
        warnings = list(ingestion.warnings)
        if options_packages_too_long:
            warnings.append(
                "Confirm vehicle options and packages manually because the extracted list was too long."
            )
        postal_code = preferred(
            None, "postal_code", "postalCode", "zip_code", "zipCode"
        )
        if postal_code is None and "zipCode" not in missing:
            missing.append("zipCode")
        facts = {
            "vin": preferred(vehicle["vin"], "vin"),
            "vehicleYear": preferred(
                vehicle["year"], "vehicle_year", "vehicleYear"
            ),
            "make": preferred(vehicle["make"], "vehicle_make", "vehicleMake"),
            "model": preferred(vehicle["model"], "vehicle_model", "vehicleModel"),
            "trim": preferred(vehicle["trim"], "vehicle_trim", "vehicleTrim"),
            "mileageAtLoss": preferred(
                vehicle["mileage"], "mileage_at_loss", "mileageAtLoss"
            ),
            "zipCode": postal_code,
            "dateOfLoss": preferred(
                report["lossDate"], "date_of_loss", "dateOfLoss"
            ),
            "insurerName": preferred(
                report["insurer"], "insurer_name", "insurerName"
            ),
            "insurerVehicleValuation": preferred(
                (
                    valuation["insurerOffer"]
                    if valuation["insurerOffer"] is not None
                    else valuation["adjustedVehicleValue"]
                ),
                "insurer_vehicle_valuation",
                "insurerVehicleValuation",
            ),
            "vehicleCondition": preferred(
                condition["preLossCondition"],
                "vehicle_condition",
                "vehicleCondition",
            ),
            "optionsPackages": options_packages,
        }
        return CaseReportIngestion(
            status="partial" if missing else "complete",
            provider=ingestion.provider,
            adapter=ingestion.adapter.casefold(),
            confidence=ingestion.confidence.casefold(),
            warnings=tuple(warnings),
            missing_fields=tuple(dict.fromkeys(missing)),
            facts=facts,
        )

    def ingest_report(
        self,
        case_id: str,
        user_id: str,
        access_token: str,
    ) -> CaseReportIngestion:
        """Extract the current owned private report with a revision-fenced cache."""

        canonical_case_id = _path_uuid(case_id, "INVALID_CASE_ID")
        canonical_user_id = _canonical_uuid(user_id, "User ID")
        if not isinstance(access_token, str) or not access_token.strip():
            raise CaseAnalysisInputError("AUTHENTICATION_REQUIRED")
        if not isinstance(self._gateway, ReportIngestionGateway):
            raise CaseAnalysisUnavailableError(
                "Report ingestion persistence is unavailable"
            )
        try:
            status_row = self._gateway.get_total_loss_analysis_status(
                canonical_case_id, canonical_user_id
            )
            if not isinstance(status_row, Mapping):
                raise SupabaseContractError("Analysis status response is invalid")
            if status_row.get("outcome") == "not_found":
                raise CaseAnalysisNotFoundError("Case was not found")
            revision = self._input_revision(
                status_row.get("analysis_input_revision")
            )
            locator = self._gateway.get_owned_total_loss_report_storage_locator(
                canonical_case_id, access_token
            )
            upload_id = _canonical_uuid(
                locator.get("finalized_upload_id"),
                "Report upload ID",
                version_four=True,
            )
            cached_row = self._gateway.get_total_loss_report_extraction(
                canonical_case_id, upload_id, revision
            )
            if cached_row is not None:
                ingestion = self._cache_result(cached_row)
            else:
                with self._gateway.materialize_total_loss_report_from_locator(
                    canonical_case_id, locator, upload_id
                ) as report_path:
                    ingestion = self._report_ingestion_service.ingest(report_path)
                persisted = self._gateway.persist_total_loss_report_extraction(
                    canonical_case_id,
                    upload_id,
                    revision,
                    ingestion.provider,
                    "needs_confirmation",
                    {"LOW": 0.3, "MEDIUM": 0.65, "HIGH": 1.0}[
                        ingestion.confidence
                    ],
                    "1",
                    ingestion.to_dict(include_usage=False),
                )
                if not isinstance(persisted, Mapping):
                    raise SupabaseContractError(
                        "Report extraction persistence response is invalid"
                    )
            return self._public_ingestion(
                ingestion,
                status_row.get("input_snapshot"),
            )
        except CaseAnalysisError:
            raise
        except SupabaseReportNotFoundError as exc:
            raise CaseAnalysisConflictError("REPORT_REQUIRED") from exc
        except (SupabaseReportInvalidError, ReportDocumentInvalidError) as exc:
            raise CaseAnalysisConflictError("INVALID_REPORT") from exc
        except (NeutralReportExtractionError, NormalizedReportContractError) as exc:
            raise CaseAnalysisUnavailableError(
                "Report extraction failed"
            ) from exc
        except SupabaseGatewayError as exc:
            raise CaseAnalysisUnavailableError(
                "Report ingestion is unavailable"
            ) from exc

    def _record_failure(
        self,
        *,
        case_id: str,
        user_id: str,
        job_id: str,
        processing_token: str,
        failure_code: str,
        retryable: bool,
        attempt_count: int,
    ) -> CaseAnalysisStatus:
        try:
            current = self._read_status(case_id, user_id)
            if current.status in {"completed", "failed"}:
                return current
        except (CaseAnalysisContractError, CaseAnalysisUnavailableError):
            pass

        recorded = False
        try:
            recorded = self._gateway.fail_total_loss_analysis(
                job_id,
                processing_token,
                failure_code,
                retryable,
            )
        except SupabaseGatewayError:
            recorded = False
        if recorded:
            return CaseAnalysisStatus(
                status="failed",
                attempt_count=attempt_count,
                failure_code=failure_code,
                retryable=retryable,
            )
        try:
            current = self._read_status(case_id, user_id)
        except (CaseAnalysisContractError, CaseAnalysisUnavailableError) as exc:
            raise CaseAnalysisUnavailableError(
                "Analysis failure could not be durably recorded"
            ) from exc
        if current.status in {"completed", "failed"}:
            return current
        raise CaseAnalysisUnavailableError(
            "Analysis failure could not be durably recorded"
        )

    def _execute_claim(
        self,
        *,
        case_id: str,
        user_id: str,
        row: Mapping[str, Any],
        processing_token: str,
    ) -> CaseAnalysisStatus:
        job_id = self._claimed_field(row, "job_id", "Job ID")
        run_id = self._claimed_field(row, "run_id", "Run ID")
        attempt_count = self._attempt_count(row)
        started_at = self._emit_claim_started(
            job_id=job_id,
            run_id=run_id,
            attempt_count=attempt_count,
        )
        input_snapshot = row.get("input_snapshot")
        uses_confirmed_snapshot = isinstance(input_snapshot, Mapping)
        normalized_postal_code: str | None = None
        if not uses_confirmed_snapshot:
            postal_code = row.get("postal_code")
            try:
                normalized_postal_code = normalize_us_zip_code(postal_code)
            except (TypeError, ValueError):
                status = self._record_failure(
                    case_id=case_id,
                    user_id=user_id,
                    job_id=job_id,
                    processing_token=processing_token,
                    failure_code="ANALYSIS_CREATION_FAILED",
                    retryable=True,
                    attempt_count=attempt_count,
                )
                self._emit_claim_terminal(
                    status,
                    job_id=job_id,
                    run_id=run_id,
                    attempt_count=attempt_count,
                    started_at=started_at,
                )
                return status

        repository = SupabaseAnalysisRunRepository(
            self._gateway,
            user_id,
            job_id=job_id,
            processing_token=processing_token,
        )
        try:
            creation_service = self._creation_service_factory(repository, run_id)
            if uses_confirmed_snapshot:
                intake_mode = input_snapshot.get("intake_mode")
                if not isinstance(intake_mode, str):
                    intake_mode = row.get("intake_mode")
                normalized_mode = (
                    intake_mode.strip().casefold()
                    if isinstance(intake_mode, str)
                    else None
                )
                if normalized_mode == "manual":
                    create_confirmed = getattr(
                        creation_service, "create_from_confirmed_input", None
                    )
                    if not callable(create_confirmed):
                        raise AnalysisCreationExecutionError(
                            "Confirmed-input analysis creation is unavailable"
                        )
                    result = create_confirmed(input_snapshot)
                elif normalized_mode == "report":
                    ingestion: ReportIngestionResult | None = None
                    if (
                        row.get("report_extraction_available") is True
                        and isinstance(self._gateway, ReportIngestionGateway)
                    ):
                        try:
                            upload_id = _canonical_uuid(
                                row.get("source_report_upload_id"),
                                "Report upload ID",
                                version_four=True,
                            )
                            revision = self._input_revision(
                                row.get("analysis_input_revision")
                            )
                            cached_row = (
                                self._gateway.get_total_loss_report_extraction(
                                    case_id, upload_id, revision
                                )
                            )
                            if (
                                cached_row is not None
                                and cached_row.get("extraction_status")
                                == "confirmed"
                            ):
                                ingestion = self._cache_result(cached_row)
                        except (CaseAnalysisContractError, SupabaseGatewayError):
                            # A missing or stale cache falls back to the fenced
                            # report. Unconfirmed extraction data is never reused.
                            ingestion = None
                    if ingestion is not None:
                        create_confirmed = getattr(
                            creation_service,
                            "create_from_confirmed_input",
                            None,
                        )
                        if not callable(create_confirmed):
                            raise AnalysisCreationExecutionError(
                                "Confirmed-input analysis creation is unavailable"
                            )
                        result = create_confirmed(
                            input_snapshot,
                            report_extraction_available=True,
                            normalized_report=ingestion.to_dict()[
                                "normalizedReport"
                            ],
                            report_adapter=ingestion.adapter,
                            partial_extraction=ingestion.partial,
                        )
                    else:
                        create_report = getattr(creation_service, "create", None)
                        if not callable(create_report):
                            raise AnalysisCreationExecutionError(
                                "Report analysis creation is unavailable"
                            )
                        try:
                            normalized_postal_code = normalize_us_zip_code(
                                input_snapshot.get("postal_code")
                            )
                        except (TypeError, ValueError) as exc:
                            raise AnalysisConfirmedInputError(
                                "Confirmed report postal code is invalid"
                            ) from exc
                        materialize_report = getattr(
                            self._gateway,
                            "materialize_total_loss_report_from_locator",
                            None,
                        )
                        if not callable(materialize_report):
                            raise AnalysisCreationExecutionError(
                                "Fenced report materialization is unavailable"
                            )
                        with materialize_report(
                            case_id, row, job_id
                        ) as report_path:
                            result = create_report(
                                report_path, normalized_postal_code
                            )
                else:
                    raise AnalysisConfirmedInputError("Intake mode is invalid")
            else:
                if not callable(getattr(creation_service, "create", None)):
                    raise AnalysisCreationExecutionError(
                        "Analysis creation service is invalid"
                    )
                # Legacy report-only claims retain their original materialization
                # contract so deployed jobs and existing test doubles remain valid.
                with self._gateway.materialize_total_loss_report(
                    user_id, case_id, job_id
                ) as report_path:
                    result = creation_service.create(
                        report_path, normalized_postal_code
                    )
            if getattr(result, "run_id", None) != run_id:
                raise AnalysisCreationExecutionError(
                    "Analysis creation returned an unexpected run ID"
                )
            if repository.completed_run_id != run_id:
                raise AnalysisCreationExecutionError(
                    "Analysis creation did not durably complete"
                )
            status = CaseAnalysisStatus(
                status="completed",
                attempt_count=attempt_count,
                run_id=run_id,
            )
            self._emit_claim_terminal(
                status,
                job_id=job_id,
                run_id=run_id,
                attempt_count=attempt_count,
                started_at=started_at,
            )
            return status
        except Exception as exc:
            if repository.completed_run_id == run_id:
                status = CaseAnalysisStatus(
                    status="completed",
                    attempt_count=attempt_count,
                    run_id=run_id,
                )
            else:
                failure_code, retryable = self._failure_for(exc)
                status = self._record_failure(
                    case_id=case_id,
                    user_id=user_id,
                    job_id=job_id,
                    processing_token=processing_token,
                    failure_code=failure_code,
                    retryable=retryable,
                    attempt_count=attempt_count,
                )
            self._emit_claim_terminal(
                status,
                job_id=job_id,
                run_id=run_id,
                attempt_count=attempt_count,
                started_at=started_at,
            )
            return status

    def submit(self, case_id: str, user_id: str) -> CaseAnalysisStatus:
        canonical_case_id = _path_uuid(case_id, "INVALID_CASE_ID")
        canonical_user_id = _canonical_uuid(user_id, "User ID")
        try:
            processing_token = _canonical_uuid(
                str(self._token_factory()),
                "Processing token",
                version_four=True,
            )
        except (CaseAnalysisContractError, TypeError, ValueError) as exc:
            raise CaseAnalysisUnavailableError(
                "Analysis processing token is unavailable"
            ) from exc
        try:
            row = self._gateway.claim_total_loss_analysis(
                canonical_case_id,
                canonical_user_id,
                processing_token,
            )
        except SupabaseGatewayError as exc:
            raise CaseAnalysisUnavailableError(
                "Analysis could not be claimed"
            ) from exc
        if not isinstance(row, Mapping):
            raise CaseAnalysisContractError("Analysis claim is invalid")
        outcome = row.get("outcome")
        if outcome == "claimed":
            return self._execute_claim(
                case_id=canonical_case_id,
                user_id=canonical_user_id,
                row=row,
                processing_token=processing_token,
            )
        return self._status_from_row(row)

    def get_presentation(
        self, run_id: str, user_id: str
    ) -> Mapping[str, Any]:
        canonical_run_id = _path_uuid(run_id, "INVALID_RUN_ID")
        canonical_user_id = _canonical_uuid(user_id, "User ID")
        repository = SupabaseAnalysisRunRepository(
            self._gateway, canonical_user_id
        )
        presentation = AnalysisPresentationService(repository).get(
            canonical_run_id
        )
        return presentation.to_dict()


__all__ = [
    "CASE_ANALYSIS_STATUSES",
    "CaseAnalysisConflictError",
    "CaseAnalysisContractError",
    "CaseAnalysisError",
    "CaseAnalysisInputError",
    "CaseAnalysisNotFoundError",
    "CaseAnalysisService",
    "CaseAnalysisStatus",
    "CaseReportIngestion",
    "CaseAnalysisUnavailableError",
    "FAILURE_MESSAGES",
    "SupabaseAnalysisRunRepository",
]
