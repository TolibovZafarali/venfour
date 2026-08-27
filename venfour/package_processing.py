"""Durable orchestration for paid Total-Loss package finalization.

The database is authoritative for package/work-item identity, leases, fencing,
and terminal transitions.  This module coordinates those narrow RPCs, freezes
the already-completed analysis evidence, and invokes the deterministic package
assessment builders.  It never searches a market provider, calls an AI model,
or produces a report.

Cloud Tasks is an optional dispatch adapter.  Durable database work always
exists before dispatch is attempted, and the adapter sends only the opaque work
item identifier to the authenticated internal worker endpoint.
"""

from __future__ import annotations

import hashlib
import hmac
import re
from collections.abc import Callable, Mapping, Sequence
from contextlib import AbstractContextManager
from dataclasses import dataclass, replace
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Protocol, runtime_checkable
from urllib.parse import quote, urlsplit
from uuid import UUID, uuid4

from venfour.report_ingestion import (
    ReportDocumentInvalidError,
    validate_canonical_pdf,
)
from venfour.supabase_gateway import (
    SupabaseContractError,
    SupabaseReportInvalidError,
    SupabaseReportNotFoundError,
    SupabaseUnavailableError,
)


PACKAGE_WORK_TYPE = "total_loss_package_finalize"
PACKAGE_WORK_VERSION = "1"
PACKAGE_FAILURE_CODE_PATTERN = re.compile(r"[A-Z][A-Z0-9_]{0,63}")
PACKAGE_CODE_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")
GOOGLE_ISSUERS = frozenset({"accounts.google.com", "https://accounts.google.com"})
MAX_INTERNAL_TOKEN_CHARACTERS = 16_384
MAX_RECONCILIATION_LIMIT = 100
DEFAULT_RECONCILIATION_LIMIT = 25
MAX_DISPATCH_RETRY_DELAY_SECONDS = 3600


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class PackageProcessingError(Exception):
    """Base class for bounded package-processing failures."""


class PackageProcessingInputError(PackageProcessingError):
    """A caller supplied a malformed opaque identifier or bound."""


class PackageProcessingContractError(PackageProcessingError):
    """A trusted internal boundary returned an invalid contract."""


class PackageProcessingUnavailableError(PackageProcessingError):
    """Package processing cannot make safe progress right now."""


class PackageDispatchUnavailableError(PackageProcessingUnavailableError):
    """The optional external work dispatcher is unavailable."""


class PackageWorkBusyError(PackageProcessingUnavailableError):
    """Another valid worker currently owns the durable lease."""


class PackageRetryLaterError(PackageProcessingUnavailableError):
    """A retryable work item is not due yet."""


class PackageStaleFenceError(PackageProcessingUnavailableError):
    """The worker no longer owns both durable processing fences."""


class InternalCallerAuthenticationError(PackageProcessingError):
    """The internal caller could not prove the configured workload identity."""


def _canonical_uuid(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise PackageProcessingContractError(f"{label} is invalid")
    try:
        parsed = UUID(value)
    except (AttributeError, TypeError, ValueError) as exc:
        raise PackageProcessingContractError(f"{label} is invalid") from exc
    if parsed.version != 4 or str(parsed) != value:
        raise PackageProcessingContractError(f"{label} is invalid")
    return value


def _request_uuid(value: Any, label: str) -> str:
    try:
        return _canonical_uuid(value, label)
    except PackageProcessingContractError as exc:
        raise PackageProcessingInputError(f"{label} is invalid") from exc


def _safe_code(value: Any, label: str) -> str:
    if not isinstance(value, str) or PACKAGE_CODE_PATTERN.fullmatch(value) is None:
        raise PackageProcessingContractError(f"{label} is invalid")
    return value


def _safe_failure_code(value: Any, label: str = "Failure code") -> str:
    if (
        not isinstance(value, str)
        or PACKAGE_FAILURE_CODE_PATTERN.fullmatch(value) is None
    ):
        raise PackageProcessingContractError(f"{label} is invalid")
    return value


def _sha256_digest(value: Any, label: str) -> str:
    if not isinstance(value, str) or SHA256_PATTERN.fullmatch(value) is None:
        raise PackageProcessingContractError(f"{label} is invalid")
    return value


def _positive_attempt(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise PackageProcessingContractError(f"{label} is invalid")
    return value


def _mapping(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise PackageProcessingContractError(f"{label} is invalid")
    return value


def _optional_uuid(value: Any, label: str) -> str | None:
    if value is None:
        return None
    return _canonical_uuid(value, label)


def _reconciliation_limit(value: Any) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 1 <= value <= MAX_RECONCILIATION_LIMIT
    ):
        raise PackageProcessingInputError("Reconciliation limit is invalid")
    return value


def _configured_text(
    value: Any,
    label: str,
    *,
    pattern: re.Pattern[str],
) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise ValueError(f"{label} configuration is invalid")
    return value


_GOOGLE_RESOURCE_SEGMENT_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,62}")
_SERVICE_ACCOUNT_PATTERN = re.compile(
    r"[a-z0-9][a-z0-9._-]{2,126}@[a-z0-9][a-z0-9.-]{1,251}\.iam\.gserviceaccount\.com"
)


def _configured_https_origin(value: Any, label: str) -> str:
    if not isinstance(value, str) or value != value.strip() or not value:
        raise ValueError(f"{label} configuration is invalid")
    normalized = value.rstrip("/")
    try:
        parsed = urlsplit(normalized)
        port = parsed.port
    except ValueError as exc:
        raise ValueError(f"{label} configuration is invalid") from exc
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or (port is not None and not 1 <= port <= 65535)
    ):
        raise ValueError(f"{label} configuration is invalid")
    return normalized


@dataclass(frozen=True)
class CloudTasksConfiguration:
    """Complete optional production configuration for opaque task dispatch."""

    project: str
    location: str
    queue: str
    worker_origin: str
    oidc_service_account: str
    oidc_audience: str
    request_timeout_seconds: float = 10.0

    def __post_init__(self) -> None:
        for name in ("project", "location", "queue"):
            object.__setattr__(
                self,
                name,
                _configured_text(
                    getattr(self, name),
                    name.replace("_", " "),
                    pattern=_GOOGLE_RESOURCE_SEGMENT_PATTERN,
                ),
            )
        object.__setattr__(
            self,
            "worker_origin",
            _configured_https_origin(self.worker_origin, "worker origin"),
        )
        object.__setattr__(
            self,
            "oidc_audience",
            _configured_https_origin(self.oidc_audience, "OIDC audience"),
        )
        object.__setattr__(
            self,
            "oidc_service_account",
            _configured_text(
                self.oidc_service_account,
                "OIDC service account",
                pattern=_SERVICE_ACCOUNT_PATTERN,
            ),
        )
        timeout = self.request_timeout_seconds
        if (
            isinstance(timeout, bool)
            or not isinstance(timeout, (int, float))
            or not 0 < float(timeout) <= 60
        ):
            raise ValueError("Cloud Tasks timeout configuration is invalid")
        object.__setattr__(self, "request_timeout_seconds", float(timeout))

    @property
    def queue_path(self) -> str:
        return (
            f"projects/{self.project}/locations/{self.location}/queues/{self.queue}"
        )

    @classmethod
    def from_environment(
        cls, environment: Mapping[str, str]
    ) -> "CloudTasksConfiguration | None":
        names = {
            "project": "VENFOUR_PACKAGE_TASKS_PROJECT",
            "location": "VENFOUR_PACKAGE_TASKS_LOCATION",
            "queue": "VENFOUR_PACKAGE_TASKS_QUEUE",
            "worker_origin": "VENFOUR_PACKAGE_WORKER_ORIGIN",
            "oidc_service_account": (
                "VENFOUR_PACKAGE_TASKS_OIDC_SERVICE_ACCOUNT"
            ),
            "oidc_audience": "VENFOUR_PACKAGE_TASKS_OIDC_AUDIENCE",
        }
        values = {field: environment.get(name, "") for field, name in names.items()}
        present = {
            field for field, value in values.items() if isinstance(value, str) and value
        }
        if not present:
            return None
        if present != set(names):
            raise ValueError("Cloud Tasks configuration is incomplete")
        return cls(**values)


@dataclass(frozen=True)
class InternalOidcConfiguration:
    """Expected Google workload identity for the private worker endpoint."""

    audience: str
    service_account_email: str

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "audience",
            _configured_https_origin(self.audience, "internal OIDC audience"),
        )
        object.__setattr__(
            self,
            "service_account_email",
            _configured_text(
                self.service_account_email,
                "internal OIDC service account",
                pattern=_SERVICE_ACCOUNT_PATTERN,
            ),
        )

    @classmethod
    def from_environment(
        cls, environment: Mapping[str, str]
    ) -> "InternalOidcConfiguration | None":
        audience = environment.get("VENFOUR_PACKAGE_TASKS_OIDC_AUDIENCE", "")
        email = environment.get(
            "VENFOUR_PACKAGE_TASKS_OIDC_SERVICE_ACCOUNT", ""
        )
        if not audience and not email:
            return None
        if not audience or not email:
            raise ValueError("Internal OIDC configuration is incomplete")
        return cls(audience=audience, service_account_email=email)


@runtime_checkable
class WorkItemDispatcher(Protocol):
    def dispatch(self, work_item_id: str) -> str: ...


@runtime_checkable
class InternalCallerVerifier(Protocol):
    def verify(self, token: str) -> str: ...


@runtime_checkable
class PackageProcessingDatabaseGateway(Protocol):
    def enqueue_total_loss_package_job(
        self, entitlement_id: str
    ) -> Mapping[str, Any]: ...

    def reserve_due_workflow_work_items(
        self, dispatch_token: str, limit: int
    ) -> Sequence[Mapping[str, Any]]: ...

    def mark_workflow_work_item_dispatched(
        self, work_item_id: str, dispatch_token: str
    ) -> bool: ...

    def release_workflow_work_item_dispatch(
        self,
        work_item_id: str,
        dispatch_token: str,
        error_code: str,
        delay_seconds: int,
    ) -> bool: ...

    def claim_total_loss_package_work_item(
        self, work_item_id: str, processing_token: str
    ) -> Mapping[str, Any]: ...

    def resolve_total_loss_package_source_context(
        self, work_item_id: str, processing_token: str
    ) -> Mapping[str, Any]: ...

    def seal_total_loss_source_snapshot(
        self,
        work_item_id: str,
        processing_token: str,
        snapshot: Mapping[str, Any],
    ) -> Mapping[str, Any]: ...

    def persist_total_loss_final_assessment(
        self,
        work_item_id: str,
        processing_token: str,
        source_snapshot_id: str,
        assessment: Mapping[str, Any],
    ) -> Mapping[str, Any]: ...

    def complete_total_loss_package_work_item(
        self,
        work_item_id: str,
        processing_token: str,
        final_assessment_id: str,
        package_status: str,
        reason_code: str | None,
    ) -> bool: ...

    def fail_total_loss_package_work_item(
        self,
        work_item_id: str,
        processing_token: str,
        failure_code: str,
        failure_kind: str,
        retry_delay_seconds: int,
    ) -> bool: ...

    def materialize_total_loss_report_from_locator(
        self,
        case_id: str,
        storage_locator: Mapping[str, Any],
        cache_nonce: str,
    ) -> AbstractContextManager[Path]: ...


@runtime_checkable
class PackageAssessmentBuilder(Protocol):
    def build_source_snapshot(
        self,
        context: Mapping[str, Any],
        source_document: Mapping[str, Any] | None,
    ) -> Any: ...

    def build_final_assessment(self, source_snapshot: Any) -> Any: ...


@dataclass(frozen=True)
class PackageEnqueueResult:
    state: str
    case_id: str
    entitlement_id: str
    package_job_id: str
    work_item_id: str
    package_status: str
    work_item_status: str
    workflow_revision: int
    dispatch_attempted: bool = False


@dataclass(frozen=True)
class DispatchReconciliationResult:
    reserved: int
    dispatched: int
    failed: int
    dispatcher_configured: bool
    external_task_names: tuple[str, ...] = ()


@dataclass(frozen=True)
class PackageExecutionResult:
    state: str
    work_item_id: str
    package_job_id: str | None
    package_status: str | None
    attempt_count: int | None = None
    source_snapshot_id: str | None = None
    final_assessment_id: str | None = None


class CloudTasksWorkItemDispatcher:
    """Dispatch opaque work identities through an optional Cloud Tasks client."""

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
                raise PackageDispatchUnavailableError(
                    "Cloud Tasks support is unavailable"
                ) from exc
            try:
                client = tasks_v2.CloudTasksClient()
            except Exception as exc:  # pragma: no cover - runtime credential path
                raise PackageDispatchUnavailableError(
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
    def _task_id(work_item_id: str) -> str:
        canonical = _request_uuid(work_item_id, "Work item ID")
        digest = hashlib.sha256(canonical.encode("ascii")).hexdigest()
        return f"wi-{digest}"

    def _task_name(self, work_item_id: str) -> str:
        return f"{self._configuration.queue_path}/tasks/{self._task_id(work_item_id)}"

    def _target_url(self, work_item_id: str) -> str:
        canonical = _request_uuid(work_item_id, "Work item ID")
        return (
            f"{self._configuration.worker_origin}/internal/v1/work-items/"
            f"{quote(canonical, safe='')}/execute"
        )

    def dispatch(self, work_item_id: str) -> str:
        task_name = self._task_name(work_item_id)
        task = {
            "name": task_name,
            "http_request": {
                "http_method": "POST",
                "url": self._target_url(work_item_id),
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
            raise PackageDispatchUnavailableError(
                "Work-item dispatch is unavailable"
            ) from exc
        returned_name = (
            response.get("name")
            if isinstance(response, Mapping)
            else getattr(response, "name", None)
        )
        if returned_name != task_name:
            raise PackageDispatchUnavailableError(
                "Cloud Tasks returned an unexpected task identity"
            )
        return task_name

    def close(self) -> None:
        close = getattr(self._client, "close", None)
        if callable(close):
            close()


TokenClaimsVerifier = Callable[[str, str], Mapping[str, Any]]


class GoogleOidcInternalCallerVerifier:
    """Verify the exact Google workload identity expected by the worker."""

    def __init__(
        self,
        configuration: InternalOidcConfiguration,
        *,
        claims_verifier: TokenClaimsVerifier | None = None,
    ) -> None:
        if not isinstance(configuration, InternalOidcConfiguration):
            raise TypeError("configuration must be InternalOidcConfiguration")
        self._configuration = configuration
        self._claims_verifier = claims_verifier or self._google_claims

    @staticmethod
    def _google_claims(token: str, audience: str) -> Mapping[str, Any]:
        try:
            from google.auth.transport.requests import Request
            from google.oauth2 import id_token
        except ImportError as exc:  # pragma: no cover - depends on optional prod dep
            raise InternalCallerAuthenticationError(
                "Google OIDC verification is unavailable"
            ) from exc
        try:
            claims = id_token.verify_oauth2_token(
                token,
                Request(),
                audience=audience,
            )
        except Exception as exc:
            raise InternalCallerAuthenticationError(
                "Internal caller authentication is invalid"
            ) from exc
        if not isinstance(claims, Mapping):
            raise InternalCallerAuthenticationError(
                "Internal caller authentication is invalid"
            )
        return claims

    def verify(self, token: str) -> str:
        if (
            not isinstance(token, str)
            or not token
            or token != token.strip()
            or len(token) > MAX_INTERNAL_TOKEN_CHARACTERS
            or any(ord(character) < 33 or ord(character) == 127 for character in token)
        ):
            raise InternalCallerAuthenticationError(
                "Internal caller authentication is invalid"
            )
        try:
            claims = self._claims_verifier(token, self._configuration.audience)
        except InternalCallerAuthenticationError:
            raise
        except Exception as exc:
            raise InternalCallerAuthenticationError(
                "Internal caller authentication is invalid"
            ) from exc
        if not isinstance(claims, Mapping):
            raise InternalCallerAuthenticationError(
                "Internal caller authentication is invalid"
            )
        audience = claims.get("aud")
        issuer = claims.get("iss")
        email = claims.get("email")
        email_verified = claims.get("email_verified")
        if (
            audience != self._configuration.audience
            or issuer not in GOOGLE_ISSUERS
            or not isinstance(email, str)
            or not hmac.compare_digest(email, self._configuration.service_account_email)
            or email_verified is not True
        ):
            raise InternalCallerAuthenticationError(
                "Internal caller authentication is invalid"
            )
        return email


class TotalLossPackageCoordinator:
    """Create durable package work and reconcile its external dispatch."""

    _enqueue_states = frozenset({"created", "existing"})
    _package_statuses = frozenset(
        {
            "queued",
            "processing",
            "source_frozen",
            "assessment_ready",
            "review_required",
            "new_evidence_required",
            "retryable_failed",
            "failed",
        }
    )
    _work_item_statuses = frozenset(
        {
            "queued",
            "dispatching",
            "processing",
            "completed",
            "retryable_failed",
            "terminal_failed",
        }
    )

    def __init__(
        self,
        database: PackageProcessingDatabaseGateway,
        dispatcher: WorkItemDispatcher | None = None,
        *,
        token_factory: Callable[[], Any] = uuid4,
    ) -> None:
        if not isinstance(database, PackageProcessingDatabaseGateway):
            raise TypeError("database must implement PackageProcessingDatabaseGateway")
        if dispatcher is not None and not isinstance(dispatcher, WorkItemDispatcher):
            raise TypeError("dispatcher must implement WorkItemDispatcher")
        if not callable(token_factory):
            raise TypeError("token_factory must be callable")
        self._database = database
        self._dispatcher = dispatcher
        self._token_factory = token_factory

    def _new_token(self, label: str) -> str:
        try:
            return _canonical_uuid(str(self._token_factory()), label)
        except (PackageProcessingContractError, TypeError, ValueError) as exc:
            raise PackageProcessingUnavailableError(
                f"{label} is unavailable"
            ) from exc

    @classmethod
    def _enqueue_result(
        cls, row: Mapping[str, Any], *, dispatch_attempted: bool
    ) -> PackageEnqueueResult:
        row = _mapping(row, "Package enqueue response")
        state = row.get("outcome")
        package_status = row.get("package_status")
        work_item_status = row.get("work_item_status")
        revision = row.get("workflow_revision")
        if (
            state not in cls._enqueue_states
            or package_status not in cls._package_statuses
            or work_item_status not in cls._work_item_statuses
            or isinstance(revision, bool)
            or not isinstance(revision, int)
            or revision < 1
        ):
            raise PackageProcessingContractError(
                "Package enqueue response is invalid"
            )
        return PackageEnqueueResult(
            state=state,
            case_id=_canonical_uuid(row.get("case_id"), "Case ID"),
            entitlement_id=_canonical_uuid(
                row.get("entitlement_id"), "Entitlement ID"
            ),
            package_job_id=_canonical_uuid(
                row.get("package_job_id"), "Package job ID"
            ),
            work_item_id=_canonical_uuid(row.get("work_item_id"), "Work item ID"),
            package_status=package_status,
            work_item_status=work_item_status,
            workflow_revision=revision,
            dispatch_attempted=dispatch_attempted,
        )

    def ensure_for_entitlement(
        self,
        entitlement_id: str,
        *,
        dispatch_limit: int = DEFAULT_RECONCILIATION_LIMIT,
    ) -> PackageEnqueueResult:
        canonical_entitlement_id = _request_uuid(entitlement_id, "Entitlement ID")
        row = self._database.enqueue_total_loss_package_job(
            canonical_entitlement_id
        )
        result = self._enqueue_result(row, dispatch_attempted=False)
        if result.entitlement_id != canonical_entitlement_id:
            raise PackageProcessingContractError(
                "Package enqueue response changed entitlement identity"
            )
        attempted = False
        if self._dispatcher is not None and result.work_item_status in {
            "queued",
            "retryable_failed",
        }:
            reconciliation = self.reconcile_due(limit=dispatch_limit)
            attempted = reconciliation.reserved > 0
        return replace(result, dispatch_attempted=attempted)

    @staticmethod
    def _dispatch_delay(attempt_count: int) -> int:
        _positive_attempt(attempt_count, "Dispatch attempt count")
        return min(
            MAX_DISPATCH_RETRY_DELAY_SECONDS,
            2 ** min(attempt_count, 10),
        )

    def reconcile_due(
        self, *, limit: int = DEFAULT_RECONCILIATION_LIMIT
    ) -> DispatchReconciliationResult:
        selected_limit = _reconciliation_limit(limit)
        if self._dispatcher is None:
            return DispatchReconciliationResult(0, 0, 0, False)
        dispatch_token = self._new_token("Dispatch token")
        rows = self._database.reserve_due_workflow_work_items(
            dispatch_token, selected_limit
        )
        if not isinstance(rows, Sequence) or isinstance(rows, (str, bytes, bytearray)):
            raise PackageProcessingContractError(
                "Work-item dispatch reservation is invalid"
            )
        dispatched = 0
        failed = 0
        names: list[str] = []
        for value in rows:
            row = _mapping(value, "Work-item dispatch reservation")
            work_item_id = _canonical_uuid(row.get("work_item_id"), "Work item ID")
            _canonical_uuid(row.get("package_job_id"), "Package job ID")
            if row.get("work_type") != PACKAGE_WORK_TYPE:
                raise PackageProcessingContractError("Work item type is invalid")
            if str(row.get("work_version")) != PACKAGE_WORK_VERSION:
                raise PackageProcessingContractError("Work item version is invalid")
            attempt_count = _positive_attempt(
                row.get("dispatch_attempt_count"), "Dispatch attempt count"
            )
            try:
                task_name = self._dispatcher.dispatch(work_item_id)
                if not isinstance(task_name, str) or not task_name:
                    raise PackageDispatchUnavailableError(
                        "Dispatcher returned an invalid task identity"
                    )
                if not self._database.mark_workflow_work_item_dispatched(
                    work_item_id, dispatch_token
                ):
                    raise PackageStaleFenceError(
                        "Work-item dispatch fence is stale"
                    )
                dispatched += 1
                names.append(task_name)
            except PackageStaleFenceError:
                raise
            except Exception:
                failed += 1
                released = self._database.release_workflow_work_item_dispatch(
                    work_item_id,
                    dispatch_token,
                    "TASK_DISPATCH_UNAVAILABLE",
                    self._dispatch_delay(attempt_count),
                )
                if not released:
                    raise PackageStaleFenceError(
                        "Work-item dispatch failure fence is stale"
                    )
        return DispatchReconciliationResult(
            reserved=len(rows),
            dispatched=dispatched,
            failed=failed,
            dispatcher_configured=True,
            external_task_names=tuple(names),
        )


class DeterministicPackageAssessmentBuilder:
    """Adapt authoritative database/source rows to package-assessment V1."""

    def __init__(self, *, clock: Callable[[], datetime] = _utc_now) -> None:
        if not callable(clock):
            raise TypeError("clock must be callable")
        self._clock = clock

    @staticmethod
    def _required_text(value: Any, label: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise PackageProcessingContractError(f"{label} is invalid")
        return value

    @classmethod
    def _optional_text(cls, value: Any, label: str) -> str | None:
        if value is None:
            return None
        return cls._required_text(value, label)

    @staticmethod
    def _required_integer(value: Any, label: str) -> int:
        if isinstance(value, bool) or not isinstance(value, int):
            raise PackageProcessingContractError(f"{label} is invalid")
        return value

    @classmethod
    def _vehicle_configuration(cls, value: Any) -> Mapping[str, Any] | None:
        if value is None:
            return None
        configuration = _mapping(value, "Vehicle configuration")
        if set(configuration) != {"source", "field", "values"}:
            raise PackageProcessingContractError(
                "Vehicle configuration is invalid"
            )
        raw_values = configuration.get("values")
        if not isinstance(raw_values, Sequence) or isinstance(
            raw_values, (str, bytes, bytearray)
        ):
            raise PackageProcessingContractError(
                "Vehicle configuration is invalid"
            )
        return {
            "source": cls._required_text(
                configuration.get("source"), "Vehicle configuration source"
            ),
            "field": cls._required_text(
                configuration.get("field"), "Vehicle configuration field"
            ),
            "values": [
                cls._required_text(item, "Vehicle configuration value")
                for item in raw_values
            ],
        }

    @staticmethod
    def _loss_date(value: Any) -> str:
        if isinstance(value, datetime) or not isinstance(value, (str, date)):
            raise PackageProcessingContractError("Loss date is invalid")
        try:
            parsed = value if isinstance(value, date) else date.fromisoformat(value)
        except ValueError as exc:
            raise PackageProcessingContractError("Loss date is invalid") from exc
        return parsed.isoformat()

    @staticmethod
    def _timestamp(value: Any, label: str) -> str | None:
        if value is None:
            return None
        if not isinstance(value, (str, datetime)):
            raise PackageProcessingContractError(f"{label} is invalid")
        try:
            parsed = (
                value
                if isinstance(value, datetime)
                else datetime.fromisoformat(value.replace("Z", "+00:00"))
            )
        except ValueError as exc:
            raise PackageProcessingContractError(f"{label} is invalid") from exc
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise PackageProcessingContractError(f"{label} is invalid")
        return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    def _created_at(self) -> str:
        try:
            value = self._clock()
        except Exception as exc:
            raise PackageProcessingUnavailableError(
                "Source snapshot clock is unavailable"
            ) from exc
        timestamp = self._timestamp(value, "Source snapshot creation timestamp")
        if timestamp is None:
            raise PackageProcessingContractError(
                "Source snapshot creation timestamp is invalid"
            )
        return timestamp

    @staticmethod
    def _insurer_minor_units(value: Any) -> int | None:
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
            raise PackageProcessingContractError(
                "Confirmed insurer valuation is invalid"
            )
        try:
            amount = Decimal(str(value))
            minor_units = amount * Decimal(100)
        except (InvalidOperation, ValueError) as exc:
            raise PackageProcessingContractError(
                "Confirmed insurer valuation is invalid"
            ) from exc
        if (
            not amount.is_finite()
            or amount < 0
            or minor_units != minor_units.to_integral_value()
        ):
            raise PackageProcessingContractError(
                "Confirmed insurer valuation is invalid"
            )
        return int(minor_units)

    @classmethod
    def _confirmed_facts(cls, context: Mapping[str, Any]) -> dict[str, Any]:
        raw = _mapping(context.get("confirmed_facts"), "Confirmed facts")
        return {
            "vin": cls._optional_text(raw.get("vin"), "VIN"),
            "year": cls._required_integer(raw.get("vehicle_year"), "Vehicle year"),
            "make": cls._required_text(raw.get("vehicle_make"), "Vehicle make"),
            "model": cls._required_text(raw.get("vehicle_model"), "Vehicle model"),
            "trim": cls._required_text(raw.get("vehicle_trim"), "Vehicle trim"),
            "vehicleConfiguration": cls._vehicle_configuration(
                raw.get("vehicle_configuration")
            ),
            "mileage": cls._required_integer(
                raw.get("mileage_at_loss"), "Vehicle mileage"
            ),
            "postalCode": cls._required_text(
                raw.get("postal_code"), "Postal code"
            ),
            "lossDate": cls._loss_date(raw.get("date_of_loss")),
            "insurerName": cls._required_text(
                raw.get("insurer_name"), "Insurer name"
            ),
            "insurerVehicleValuationMinorUnits": cls._insurer_minor_units(
                raw.get("insurer_vehicle_valuation")
            ),
            "priorTitleStatus": cls._optional_text(
                raw.get("prior_title_status"), "Prior title status"
            ),
            "condition": cls._optional_text(
                raw.get("vehicle_condition"), "Vehicle condition"
            ),
            "existingDamageDescription": cls._optional_text(
                raw.get("existing_damage_description"),
                "Existing damage description",
            ),
            "optionsPackages": cls._optional_text(
                raw.get("vehicle_options_packages"), "Options and packages"
            ),
            "intakeCompletedAt": cls._timestamp(
                raw.get("intake_completed_at"),
                "Intake completion timestamp",
            ),
        }

    @staticmethod
    def _preliminary_presentation(context: Mapping[str, Any]) -> Mapping[str, Any]:
        explicit = context.get("preliminary_presentation")
        if isinstance(explicit, Mapping):
            return explicit
        snapshot = _mapping(
            context.get("preliminary_snapshot"), "Preliminary snapshot"
        )
        nested = snapshot.get("presentation")
        if isinstance(nested, Mapping):
            return nested
        if "presentationVersion" in snapshot:
            return snapshot
        artifact = _mapping(context.get("analysis_artifact"), "Analysis artifact")
        try:
            from venfour.analysis_runs import AnalysisRunArtifact
            from venfour.presentation import AnalysisPresentationProjector

            return AnalysisPresentationProjector().project(
                AnalysisRunArtifact.from_dict(artifact)
            ).to_dict()
        except Exception as exc:
            raise PackageProcessingContractError(
                "Preliminary presentation cannot be replayed"
            ) from exc

    @staticmethod
    def _extraction(
        context: Mapping[str, Any], document: Mapping[str, Any]
    ) -> Mapping[str, Any]:
        wrapper = dict(
            _mapping(context.get("normalized_extraction"), "Normalized extraction")
        )
        return {
            "rowSchemaVersion": _safe_code(
                context.get("extraction_schema_version"),
                "Extraction row schema version",
            ),
            "wrapperSchemaVersion": wrapper.get("schemaVersion"),
            "adapter": wrapper.get("adapter"),
            "provider": wrapper.get("provider"),
            "providerId": wrapper.get("providerId"),
            "confidence": wrapper.get("confidence"),
            "partial": wrapper.get("partial"),
            "warnings": wrapper.get("warnings"),
            "missingRequiredFields": wrapper.get("missingRequiredFields"),
            "model": wrapper.get("model"),
            "extractedAt": DeterministicPackageAssessmentBuilder._timestamp(
                context.get("extraction_extracted_at"),
                "Extraction timestamp",
            ),
            "normalizedReport": wrapper.get("normalizedReport"),
            "documentSha256": wrapper.get("documentSha256"),
        }

    def build_source_snapshot(
        self,
        context: Mapping[str, Any],
        source_document: Mapping[str, Any] | None,
    ) -> Any:
        try:
            from venfour.package_assessment import (
                build_total_loss_source_snapshot_v1,
            )
        except ImportError as exc:
            raise PackageProcessingUnavailableError(
                "Package assessment builder is unavailable"
            ) from exc
        intake_mode = context.get("source_intake_mode")
        extraction = (
            self._extraction(context, source_document)
            if source_document is not None
            else None
        )
        lineage = {
            "caseId": context.get("case_id"),
            "packageJobId": context.get("package_job_id"),
            "entitlementId": context.get("entitlement_id"),
            "preliminarySnapshotId": context.get("preliminary_snapshot_id"),
            "sourceSnapshotId": context.get("source_snapshot_id"),
            "analysisJobId": context.get("analysis_job_id"),
            "analysisRunId": context.get("analysis_run_id"),
            "ownerUserIdAtCreation": context.get("owner_user_id"),
            "productIdentifier": context.get("product_identifier"),
            "productVersion": context.get("product_version"),
        }
        return build_total_loss_source_snapshot_v1(
            created_at=self._created_at(),
            lineage=lineage,
            intake_mode=intake_mode,
            analysis_input_revision=context.get("source_analysis_input_revision"),
            analysis_input_id=context.get("source_analysis_input_id"),
            confirmed_facts=self._confirmed_facts(context),
            artifact=_mapping(context.get("analysis_artifact"), "Analysis artifact"),
            preliminary_presentation=self._preliminary_presentation(context),
            preliminary_snapshot=_mapping(
                context.get("preliminary_snapshot"), "Preliminary snapshot"
            ),
            preliminary_snapshot_digest=context.get("preliminary_snapshot_digest"),
            preliminary_snapshot_schema_version=context.get(
                "preliminary_snapshot_schema_version"
            ),
            source_document=source_document,
            extraction=extraction,
            validation_checks=(),
            validation_limitations=(),
        )

    @staticmethod
    def build_final_assessment(source_snapshot: Any) -> Any:
        try:
            from venfour.package_assessment import (
                build_final_valuation_assessment_v1,
            )
        except ImportError as exc:
            raise PackageProcessingUnavailableError(
                "Package assessment builder is unavailable"
            ) from exc
        return build_final_valuation_assessment_v1(source_snapshot)


@dataclass(frozen=True)
class _FailureDisposition:
    code: str
    kind: str
    retry_delay_seconds: int


class TotalLossPackageProcessor:
    """Execute one opaque work item under database-owned dual fencing."""

    _claim_outcomes = frozenset(
        {"claimed", "busy", "completed", "terminal_failed"}
    )
    _terminal_package_statuses = frozenset(
        {"assessment_ready", "review_required", "new_evidence_required"}
    )

    def __init__(
        self,
        database: PackageProcessingDatabaseGateway,
        *,
        assessment_builder: PackageAssessmentBuilder | None = None,
        token_factory: Callable[[], Any] = uuid4,
        retry_delay_seconds: int = 60,
    ) -> None:
        if not isinstance(database, PackageProcessingDatabaseGateway):
            raise TypeError(
                "database must implement PackageProcessingDatabaseGateway"
            )
        selected_builder = (
            assessment_builder or DeterministicPackageAssessmentBuilder()
        )
        if not isinstance(selected_builder, PackageAssessmentBuilder):
            raise TypeError(
                "assessment_builder must implement PackageAssessmentBuilder"
            )
        if not callable(token_factory):
            raise TypeError("token_factory must be callable")
        if (
            isinstance(retry_delay_seconds, bool)
            or not isinstance(retry_delay_seconds, int)
            or not 1 <= retry_delay_seconds <= MAX_DISPATCH_RETRY_DELAY_SECONDS
        ):
            raise ValueError("Package retry delay is invalid")
        self._database = database
        self._assessment_builder = selected_builder
        self._token_factory = token_factory
        self._retry_delay_seconds = retry_delay_seconds

    def _new_identifier(self, label: str) -> str:
        try:
            return _canonical_uuid(str(self._token_factory()), label)
        except (PackageProcessingContractError, TypeError, ValueError) as exc:
            raise PackageProcessingUnavailableError(
                f"{label} is unavailable"
            ) from exc

    @staticmethod
    def _serialized(value: Any, label: str) -> Mapping[str, Any]:
        to_dict = getattr(value, "to_dict", None)
        payload = to_dict() if callable(to_dict) else value
        return dict(_mapping(payload, label))

    @staticmethod
    def _claim_result(
        row: Mapping[str, Any], work_item_id: str, processing_token: str
    ) -> PackageExecutionResult:
        row = _mapping(row, "Package work claim")
        outcome = row.get("outcome")
        if outcome not in TotalLossPackageProcessor._claim_outcomes:
            raise PackageProcessingContractError("Package work claim is invalid")
        returned_work_item_id = _canonical_uuid(
            row.get("work_item_id"), "Work item ID"
        )
        if returned_work_item_id != work_item_id:
            raise PackageProcessingContractError(
                "Package work claim changed work-item identity"
            )
        package_job_id = _canonical_uuid(
            row.get("package_job_id"), "Package job ID"
        )
        package_status = row.get("package_status")
        if not isinstance(package_status, str):
            raise PackageProcessingContractError("Package work claim is invalid")
        attempt_count = row.get("attempt_count")
        if outcome == "claimed":
            _positive_attempt(attempt_count, "Package attempt count")
            if _canonical_uuid(
                row.get("processing_token"), "Processing token"
            ) != processing_token:
                raise PackageProcessingContractError(
                    "Package work claim changed processing fence"
                )
        elif attempt_count is not None:
            _positive_attempt(attempt_count, "Package attempt count")
        return PackageExecutionResult(
            state=outcome,
            work_item_id=work_item_id,
            package_job_id=package_job_id,
            package_status=package_status,
            attempt_count=attempt_count,
            source_snapshot_id=_optional_uuid(
                row.get("source_snapshot_id"), "Source snapshot ID"
            ),
            final_assessment_id=_optional_uuid(
                row.get("final_assessment_id"), "Final assessment ID"
            ),
        )

    @staticmethod
    def _source_document(
        context: Mapping[str, Any], validated: Any, byte_size: int
    ) -> Mapping[str, Any]:
        if (
            isinstance(byte_size, bool)
            or not isinstance(byte_size, int)
            or byte_size < 1
        ):
            raise PackageProcessingContractError("Source report size is invalid")
        expected_byte_size = context.get("storage_byte_size")
        if expected_byte_size is not None and expected_byte_size != byte_size:
            raise PackageProcessingContractError(
                "Source report size changed after lineage resolution"
            )
        return {
            "bucket": context.get("storage_bucket_id"),
            "storageOwnerId": context.get("storage_owner_id"),
            "objectPath": context.get("storage_object_name"),
            "uploadId": context.get("source_report_upload_id"),
            "originalFilename": context.get("source_report_original_filename"),
            "uploadedAt": context.get("source_report_uploaded_at"),
            "detectedMediaType": "application/pdf",
            "declaredMimeType": context.get("storage_media_type"),
            "pageCount": validated.page_count,
            "byteSize": byte_size,
            "sha256": validated.sha256,
        }

    def _build_source_snapshot(
        self,
        context: Mapping[str, Any],
        *,
        work_item_id: str,
    ) -> Any:
        mode = context.get("source_intake_mode")
        if mode == "manual":
            return self._assessment_builder.build_source_snapshot(context, None)
        if mode != "report":
            raise PackageProcessingContractError("Source intake mode is invalid")
        case_id = _canonical_uuid(context.get("case_id"), "Case ID")
        locator = {
            "storage_bucket": context.get("storage_bucket_id"),
            "storage_owner_id": context.get("storage_owner_id"),
            "storage_object_path": context.get("storage_object_name"),
        }
        with self._database.materialize_total_loss_report_from_locator(
            case_id,
            locator,
            work_item_id,
        ) as report_path:
            validated = validate_canonical_pdf(report_path)
            document = self._source_document(
                context,
                validated,
                report_path.stat().st_size,
            )
            return self._assessment_builder.build_source_snapshot(
                context, document
            )

    def _source_snapshot_id(
        self,
        claimed: PackageExecutionResult,
        context: Mapping[str, Any],
    ) -> str:
        existing_id = _optional_uuid(
            context.get("existing_source_snapshot_id"),
            "Existing source snapshot ID",
        )
        if (
            claimed.source_snapshot_id is not None
            and existing_id is not None
            and claimed.source_snapshot_id != existing_id
        ):
            raise PackageProcessingContractError(
                "Source snapshot identity changed after claim"
            )
        return (
            claimed.source_snapshot_id
            or existing_id
            or self._new_identifier("Source snapshot ID")
        )

    @staticmethod
    def _existing_source_snapshot(
        context: Mapping[str, Any],
        source_snapshot_id: str,
    ) -> Mapping[str, Any] | None:
        value = context.get("existing_source_snapshot")
        existing_id = context.get("existing_source_snapshot_id")
        if value is None:
            if existing_id is not None:
                raise PackageProcessingContractError(
                    "Existing source snapshot payload is missing"
                )
            return None
        if existing_id is None:
            raise PackageProcessingContractError(
                "Existing source snapshot identity is missing"
            )
        payload = dict(_mapping(value, "Existing source snapshot"))
        lineage = _mapping(payload.get("lineage"), "Source snapshot lineage")
        if (
            _canonical_uuid(
                lineage.get("sourceSnapshotId"), "Source snapshot ID"
            )
            != source_snapshot_id
        ):
            raise PackageProcessingContractError(
                "Existing source snapshot changed its identity"
            )
        digest = _sha256_digest(
            payload.get("snapshotDigest"), "Source snapshot digest"
        )
        expected_digest = context.get("existing_source_snapshot_digest")
        if expected_digest is not None and expected_digest != digest:
            raise PackageProcessingContractError(
                "Existing source snapshot changed its digest"
            )
        try:
            from venfour.package_assessment import (
                validate_total_loss_source_snapshot_v1,
            )
        except ImportError as exc:  # pragma: no cover - required by M4 runtime
            raise PackageProcessingUnavailableError(
                "Package assessment validation is unavailable"
            ) from exc
        validate_total_loss_source_snapshot_v1(payload)
        return payload

    @staticmethod
    def _validate_source_payload_identity(
        payload: Mapping[str, Any],
        source_snapshot_id: str,
    ) -> str:
        lineage = _mapping(payload.get("lineage"), "Source snapshot lineage")
        if (
            _canonical_uuid(
                lineage.get("sourceSnapshotId"), "Source snapshot ID"
            )
            != source_snapshot_id
        ):
            raise PackageProcessingContractError(
                "Source snapshot builder changed its identity"
            )
        return _sha256_digest(
            payload.get("snapshotDigest"), "Source snapshot digest"
        )

    @staticmethod
    def _validate_assessment_payload_identity(
        payload: Mapping[str, Any],
        *,
        package_job_id: str,
        source_snapshot_id: str,
    ) -> str:
        lineage = _mapping(payload.get("lineage"), "Final assessment lineage")
        if (
            _canonical_uuid(lineage.get("packageJobId"), "Package job ID")
            != package_job_id
            or _canonical_uuid(
                lineage.get("sourceSnapshotId"), "Source snapshot ID"
            )
            != source_snapshot_id
        ):
            raise PackageProcessingContractError(
                "Final assessment builder changed its lineage"
            )
        return _sha256_digest(
            payload.get("assessmentDigest"), "Final assessment digest"
        )

    @staticmethod
    def _assessment_completion(
        assessment: Mapping[str, Any],
    ) -> tuple[str, str | None]:
        continuation_status = assessment.get("continuationStatus")
        if continuation_status in {
            "SUPPORTS_CONTINUATION",
            "DOES_NOT_SUPPORT_CONTINUATION",
        }:
            return "assessment_ready", None
        if continuation_status == "NEW_EVIDENCE_REQUIRED":
            return "new_evidence_required", "NEW_EVIDENCE_REQUIRED"
        if continuation_status == "REVIEW_REQUIRED":
            candidates: list[Any] = []
            comparison = assessment.get("preliminaryToFinalComparison")
            if isinstance(comparison, Mapping):
                reason_codes = comparison.get("reasonCodes")
                if isinstance(reason_codes, Sequence) and not isinstance(
                    reason_codes, (str, bytes, bytearray)
                ):
                    candidates.extend(reason_codes)
            validation_issues = assessment.get("validationIssues")
            if isinstance(validation_issues, Sequence) and not isinstance(
                validation_issues, (str, bytes, bytearray)
            ):
                for issue in validation_issues:
                    candidates.append(
                        issue.get("code") if isinstance(issue, Mapping) else issue
                    )
            for candidate in candidates:
                try:
                    return "review_required", _safe_failure_code(candidate)
                except PackageProcessingContractError:
                    continue
            return "review_required", "ASSESSMENT_REVIEW_REQUIRED"
        raise PackageProcessingContractError(
            "Assessment continuation status is invalid"
        )

    def _failure_for(self, error: Exception) -> _FailureDisposition:
        from venfour.package_assessment import PackageAssessmentError

        if isinstance(error, PackageAssessmentError):
            classification = getattr(error, "classification", None)
            code = getattr(error, "code", "PACKAGE_ASSESSMENT_INVALID")
            try:
                safe_code = _safe_failure_code(code)
            except PackageProcessingContractError:
                safe_code = "PACKAGE_ASSESSMENT_INVALID"
            if classification == "RETRYABLE_OPERATIONAL_FAILURE":
                return _FailureDisposition(
                    safe_code, "retryable", self._retry_delay_seconds
                )
            if classification in {
                "HUMAN_REVIEW_REQUIRED",
                "NEW_EVIDENCE_REQUIRED",
            }:
                return _FailureDisposition(safe_code, "review_required", 0)
            return _FailureDisposition(safe_code, "terminal", 0)
        if isinstance(
            error,
            (
                SupabaseUnavailableError,
                SupabaseContractError,
                PackageProcessingUnavailableError,
            ),
        ):
            return _FailureDisposition(
                "PACKAGE_DEPENDENCY_UNAVAILABLE",
                "retryable",
                self._retry_delay_seconds,
            )
        if isinstance(error, SupabaseReportNotFoundError):
            return _FailureDisposition("SOURCE_REPORT_MISSING", "review_required", 0)
        if isinstance(
            error,
            (
                SupabaseReportInvalidError,
                ReportDocumentInvalidError,
            ),
        ):
            return _FailureDisposition("SOURCE_REPORT_INVALID", "terminal", 0)
        if isinstance(error, PackageProcessingContractError):
            return _FailureDisposition("SOURCE_LINEAGE_CONFLICT", "terminal", 0)
        return _FailureDisposition(
            "PACKAGE_PROCESSING_FAILED",
            "retryable",
            self._retry_delay_seconds,
        )

    def _record_failure(
        self,
        work_item_id: str,
        processing_token: str,
        error: Exception,
    ) -> None:
        disposition = self._failure_for(error)
        try:
            recorded = self._database.fail_total_loss_package_work_item(
                work_item_id,
                processing_token,
                disposition.code,
                disposition.kind,
                disposition.retry_delay_seconds,
            )
        except Exception as exc:
            raise PackageProcessingUnavailableError(
                "Package failure could not be durably recorded"
            ) from exc
        if not recorded:
            raise PackageStaleFenceError(
                "Package failure fence is stale"
            )

    def execute(self, work_item_id: str) -> PackageExecutionResult:
        canonical_work_item_id = _request_uuid(work_item_id, "Work item ID")
        processing_token = self._new_identifier("Processing token")
        try:
            claim_row = self._database.claim_total_loss_package_work_item(
                canonical_work_item_id, processing_token
            )
        except Exception as exc:
            raise PackageProcessingUnavailableError(
                "Package work could not be claimed"
            ) from exc
        claimed = self._claim_result(
            claim_row, canonical_work_item_id, processing_token
        )
        if claimed.state == "busy":
            raise PackageWorkBusyError("Package work is already processing")
        if claimed.state in {"completed", "terminal_failed"}:
            return claimed
        if claimed.state != "claimed" or claimed.package_job_id is None:
            raise PackageProcessingContractError("Package work claim is invalid")

        try:
            resolved_context = _mapping(
                self._database.resolve_total_loss_package_source_context(
                    canonical_work_item_id, processing_token
                ),
                "Package source context",
            )
            if (
                _canonical_uuid(
                    resolved_context.get("work_item_id"), "Work item ID"
                )
                != canonical_work_item_id
                or _canonical_uuid(
                    resolved_context.get("package_job_id"), "Package job ID"
                )
                != claimed.package_job_id
                or resolved_context.get("lineage_current") is not True
            ):
                raise PackageProcessingContractError(
                    "Package source lineage is invalid"
                )
            source_snapshot_id = self._source_snapshot_id(
                claimed, resolved_context
            )
            context = dict(resolved_context)
            context["source_snapshot_id"] = source_snapshot_id
            source_snapshot = self._existing_source_snapshot(
                context, source_snapshot_id
            )
            if source_snapshot is None:
                source_snapshot = self._build_source_snapshot(
                    context,
                    work_item_id=canonical_work_item_id,
                )
            source_payload = self._serialized(
                source_snapshot, "Source snapshot"
            )
            expected_source_digest = self._validate_source_payload_identity(
                source_payload, source_snapshot_id
            )
            sealed = _mapping(
                self._database.seal_total_loss_source_snapshot(
                    canonical_work_item_id,
                    processing_token,
                    source_payload,
                ),
                "Source snapshot persistence",
            )
            if sealed.get("outcome") not in {"created", "existing"}:
                raise PackageProcessingContractError(
                    "Source snapshot persistence is invalid"
                )
            if (
                _canonical_uuid(
                    sealed.get("source_snapshot_id"), "Source snapshot ID"
                )
                != source_snapshot_id
            ):
                raise PackageProcessingContractError(
                    "Source snapshot persistence changed its identity"
                )
            if sealed.get("source_snapshot_digest") != expected_source_digest:
                raise PackageProcessingContractError(
                    "Source snapshot persistence changed its digest"
                )

            assessment = self._assessment_builder.build_final_assessment(
                source_snapshot
            )
            assessment_payload = self._serialized(
                assessment, "Final assessment"
            )
            expected_assessment_digest = self._validate_assessment_payload_identity(
                assessment_payload,
                package_job_id=claimed.package_job_id,
                source_snapshot_id=source_snapshot_id,
            )
            package_status, reason_code = self._assessment_completion(
                assessment_payload
            )
            persisted = _mapping(
                self._database.persist_total_loss_final_assessment(
                    canonical_work_item_id,
                    processing_token,
                    source_snapshot_id,
                    assessment_payload,
                ),
                "Final assessment persistence",
            )
            if persisted.get("outcome") not in {"created", "existing"}:
                raise PackageProcessingContractError(
                    "Final assessment persistence is invalid"
                )
            final_assessment_id = _canonical_uuid(
                persisted.get("final_assessment_id"), "Final assessment ID"
            )
            if persisted.get("assessment_digest") != expected_assessment_digest:
                raise PackageProcessingContractError(
                    "Final assessment persistence changed its digest"
                )
            completed = self._database.complete_total_loss_package_work_item(
                canonical_work_item_id,
                processing_token,
                final_assessment_id,
                package_status,
                reason_code,
            )
            if not completed:
                raise PackageStaleFenceError(
                    "Package completion fence is stale"
                )
            return PackageExecutionResult(
                state="completed",
                work_item_id=canonical_work_item_id,
                package_job_id=claimed.package_job_id,
                package_status=package_status,
                attempt_count=claimed.attempt_count,
                source_snapshot_id=source_snapshot_id,
                final_assessment_id=final_assessment_id,
            )
        except PackageStaleFenceError:
            raise
        except Exception as exc:
            self._record_failure(
                canonical_work_item_id,
                processing_token,
                exc,
            )
            disposition = self._failure_for(exc)
            if disposition.kind == "retryable":
                raise PackageProcessingUnavailableError(
                    "Package processing will be retried"
                ) from exc
            return PackageExecutionResult(
                state=(
                    "review_required"
                    if disposition.kind == "review_required"
                    else "terminal_failed"
                ),
                work_item_id=canonical_work_item_id,
                package_job_id=claimed.package_job_id,
                package_status=(
                    "review_required"
                    if disposition.kind == "review_required"
                    else "failed"
                ),
                attempt_count=claimed.attempt_count,
            )


__all__ = [
    "CloudTasksConfiguration",
    "CloudTasksWorkItemDispatcher",
    "DEFAULT_RECONCILIATION_LIMIT",
    "DeterministicPackageAssessmentBuilder",
    "DispatchReconciliationResult",
    "GoogleOidcInternalCallerVerifier",
    "InternalCallerAuthenticationError",
    "InternalCallerVerifier",
    "InternalOidcConfiguration",
    "MAX_RECONCILIATION_LIMIT",
    "PACKAGE_WORK_TYPE",
    "PACKAGE_WORK_VERSION",
    "PackageAssessmentBuilder",
    "PackageDispatchUnavailableError",
    "PackageEnqueueResult",
    "PackageExecutionResult",
    "PackageProcessingContractError",
    "PackageProcessingDatabaseGateway",
    "PackageProcessingError",
    "PackageProcessingInputError",
    "PackageProcessingUnavailableError",
    "PackageRetryLaterError",
    "PackageStaleFenceError",
    "PackageWorkBusyError",
    "TotalLossPackageCoordinator",
    "TotalLossPackageProcessor",
    "WorkItemDispatcher",
]
