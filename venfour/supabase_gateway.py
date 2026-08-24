"""Server-only Supabase HTTP boundaries for owned appraisal analyses.

The gateway keeps every Supabase origin and credential under server control.
Callers provide only canonical identifiers and a browser access token; storage
paths are derived here and can never be selected by an HTTP request payload.
"""

from __future__ import annotations

import json
import math
import os
import re
import tempfile
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from ipaddress import ip_address
from pathlib import Path
from typing import Any, Protocol, runtime_checkable
from urllib.parse import quote, urlsplit
from uuid import UUID

import httpx

from scripts.extract_report_ai import MAX_PDF_BYTES


CASE_FILES_BUCKET = "case-files"
TOTAL_LOSS_REPORT_OBJECT = "valuation-report.pdf"
DOWNLOAD_CHUNK_BYTES = 1024 * 1024
MAX_EXTRACTION_CACHE_BYTES = 1024 * 1024
MAX_EXTRACTION_PROVIDER_CHARACTERS = 200
EXTRACTION_SCHEMA_VERSION_PATTERN = re.compile(r"[0-9]{1,16}")


class SupabaseGatewayError(Exception):
    """Base class for neutral server-side Supabase failures."""


class SupabaseConfigurationError(SupabaseGatewayError):
    """Required server-only Supabase configuration is absent or invalid."""


class SupabaseAuthenticationError(SupabaseGatewayError):
    """A browser access token is absent, expired, or invalid."""


class SupabaseUnavailableError(SupabaseGatewayError):
    """Supabase could not complete a required operation."""


class SupabaseContractError(SupabaseGatewayError):
    """Supabase returned data outside the checked application contract."""


class SupabaseReportNotFoundError(SupabaseGatewayError):
    """The deterministic private report object does not exist."""


class SupabaseReportInvalidError(SupabaseGatewayError):
    """The private report object is empty, oversized, or not a PDF."""


def _canonical_uuid(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise SupabaseContractError(f"{label} is invalid")
    try:
        parsed = UUID(value)
    except (AttributeError, TypeError, ValueError) as exc:
        raise SupabaseContractError(f"{label} is invalid") from exc
    if str(parsed) != value:
        raise SupabaseContractError(f"{label} is invalid")
    return value


def _valid_hostname(value: str) -> bool:
    try:
        ip_address(value)
        return True
    except ValueError:
        pass
    try:
        ascii_hostname = value.encode("idna").decode("ascii")
    except UnicodeError:
        return False
    if not ascii_hostname or len(ascii_hostname) > 253:
        return False
    labels = ascii_hostname.split(".")
    return all(
        label
        and len(label) <= 63
        and label[0] != "-"
        and label[-1] != "-"
        and all(character.isalnum() or character == "-" for character in label)
        for label in labels
    )


def _configured_origin(value: str) -> str:
    if not isinstance(value, str) or any(
        character.isspace() or ord(character) < 32 or ord(character) == 127
        for character in value
    ):
        raise SupabaseConfigurationError("SUPABASE_URL is invalid")
    normalized = value.rstrip("/")
    try:
        parsed = urlsplit(normalized)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise SupabaseConfigurationError("SUPABASE_URL is invalid") from exc
    local_http = parsed.scheme == "http" and hostname in {
        "127.0.0.1",
        "localhost",
        "::1",
    }
    if (
        (parsed.scheme != "https" and not local_http)
        or not parsed.netloc
        or hostname is None
        or not _valid_hostname(hostname)
        or (port is not None and not 1 <= port <= 65535)
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise SupabaseConfigurationError("SUPABASE_URL is invalid")
    return normalized


def _configured_credential(value: str, label: str) -> str:
    if not isinstance(value, str):
        raise SupabaseConfigurationError(f"{label} is required")
    if any(
        character.isspace() or ord(character) < 32 or ord(character) == 127
        for character in value
    ):
        raise SupabaseConfigurationError(f"{label} is invalid")
    normalized = value.strip()
    if not normalized:
        raise SupabaseConfigurationError(f"{label} is required")
    return normalized


@dataclass(frozen=True)
class SupabaseServerConfiguration:
    url: str
    publishable_key: str
    service_role_key: str
    timeout_seconds: float = 30.0

    def __post_init__(self) -> None:
        object.__setattr__(self, "url", _configured_origin(self.url))
        for name in ("publishable_key", "service_role_key"):
            label = name.replace("_", " ").upper()
            object.__setattr__(
                self,
                name,
                _configured_credential(getattr(self, name), label),
            )
        if self.publishable_key == self.service_role_key:
            raise SupabaseConfigurationError(
                "Supabase credentials must use distinct privilege levels"
            )
        timeout = self.timeout_seconds
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)):
            raise SupabaseConfigurationError("Supabase timeout is invalid")
        if timeout <= 0:
            raise SupabaseConfigurationError("Supabase timeout is invalid")
        object.__setattr__(self, "timeout_seconds", float(timeout))

    @classmethod
    def from_environment(cls) -> SupabaseServerConfiguration:
        values = {
            "url": os.environ.get("SUPABASE_URL", ""),
            "publishable_key": os.environ.get(
                "SUPABASE_PUBLISHABLE_KEY", ""
            ),
            "service_role_key": os.environ.get(
                "SUPABASE_SERVICE_ROLE_KEY", ""
            ),
        }
        if not all(value.strip() for value in values.values()):
            raise SupabaseConfigurationError(
                "Server-side Supabase configuration is unavailable"
            )
        return cls(**values)


@runtime_checkable
class CaseAnalysisGateway(Protocol):
    def authenticate(self, access_token: str) -> str: ...

    def claim_total_loss_analysis(
        self, case_id: str, user_id: str, processing_token: str
    ) -> Mapping[str, Any]: ...

    def get_total_loss_analysis_status(
        self, case_id: str, user_id: str
    ) -> Mapping[str, Any]: ...

    def complete_total_loss_analysis(
        self,
        job_id: str,
        processing_token: str,
        run_id: str,
        artifact: Mapping[str, Any],
    ) -> bool: ...

    def fail_total_loss_analysis(
        self,
        job_id: str,
        processing_token: str,
        failure_code: str,
        retryable: bool,
    ) -> bool: ...

    def get_owned_analysis_run(
        self, run_id: str, user_id: str
    ) -> Mapping[str, Any] | str | None: ...

    def materialize_total_loss_report(
        self, user_id: str, case_id: str, cache_nonce: str
    ) -> Any: ...


@runtime_checkable
class ReportIngestionGateway(Protocol):
    """Optional v2 boundary for owned extraction and immutable source locators."""

    def get_owned_total_loss_report_storage_locator(
        self, case_id: str, access_token: str
    ) -> Mapping[str, Any]: ...

    def get_total_loss_report_extraction(
        self,
        case_id: str,
        report_upload_id: str,
        analysis_input_revision: int,
    ) -> Mapping[str, Any] | None: ...

    def persist_total_loss_report_extraction(
        self,
        case_id: str,
        report_upload_id: str,
        analysis_input_revision: int,
        provider_name: str | None,
        extraction_status: str,
        confidence: float | None,
        extraction_schema_version: str,
        normalized_report: Mapping[str, Any] | None,
    ) -> Mapping[str, Any]: ...

    def materialize_total_loss_report_from_locator(
        self,
        case_id: str,
        storage_locator: Mapping[str, Any],
        cache_nonce: str,
    ) -> Any: ...


class SupabaseHttpGateway:
    """Use fixed Supabase Auth, PostgREST RPC, and Storage endpoints."""

    def __init__(
        self,
        configuration: SupabaseServerConfiguration,
        *,
        client: httpx.Client | None = None,
    ) -> None:
        if not isinstance(configuration, SupabaseServerConfiguration):
            raise TypeError("configuration must be SupabaseServerConfiguration")
        self._configuration = configuration
        self._client = client or httpx.Client(
            timeout=configuration.timeout_seconds,
            follow_redirects=False,
        )

    def close(self) -> None:
        """Release the process-owned HTTP connection pool."""

        self._client.close()

    def _user_headers(self, access_token: str) -> dict[str, str]:
        return {
            "Accept": "application/json",
            "apikey": self._configuration.publishable_key,
            "Authorization": f"Bearer {access_token}",
        }

    def _admin_headers(self, *, json_body: bool = False) -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "apikey": self._configuration.service_role_key,
            "Authorization": f"Bearer {self._configuration.service_role_key}",
        }
        if json_body:
            headers["Content-Type"] = "application/json"
        return headers

    def authenticate(self, access_token: str) -> str:
        if not isinstance(access_token, str) or not access_token.strip():
            raise SupabaseAuthenticationError("Authentication is required")
        token = access_token.strip()
        try:
            response = self._client.get(
                f"{self._configuration.url}/auth/v1/user",
                headers=self._user_headers(token),
            )
        except httpx.HTTPError as exc:
            raise SupabaseUnavailableError(
                "Authentication service is unavailable"
            ) from exc
        if response.status_code in {401, 403}:
            raise SupabaseAuthenticationError("Authentication is invalid")
        if response.status_code != 200:
            raise SupabaseUnavailableError(
                "Authentication service is unavailable"
            )
        try:
            payload = response.json()
        except (ValueError, json.JSONDecodeError) as exc:
            raise SupabaseContractError(
                "Authentication response is invalid"
            ) from exc
        if not isinstance(payload, Mapping):
            raise SupabaseContractError("Authentication response is invalid")
        return _canonical_uuid(payload.get("id"), "Authenticated user ID")

    @staticmethod
    def _single_rpc_row(payload: Any, label: str) -> Mapping[str, Any]:
        if isinstance(payload, list):
            if len(payload) != 1 or not isinstance(payload[0], Mapping):
                raise SupabaseContractError(f"{label} response is invalid")
            return dict(payload[0])
        if isinstance(payload, Mapping):
            return dict(payload)
        raise SupabaseContractError(f"{label} response is invalid")

    def _rpc(
        self,
        name: str,
        arguments: Mapping[str, Any],
        *,
        retry_ambiguous_claim: bool = False,
    ) -> Any:
        maximum_attempts = 2 if retry_ambiguous_claim else 1
        response: httpx.Response | None = None
        last_error: httpx.HTTPError | None = None
        for attempt in range(maximum_attempts):
            try:
                response = self._client.post(
                    f"{self._configuration.url}/rest/v1/rpc/{name}",
                    headers=self._admin_headers(json_body=True),
                    json=dict(arguments),
                )
                last_error = None
            except httpx.HTTPError as exc:
                last_error = exc
                if attempt + 1 < maximum_attempts:
                    continue
                raise SupabaseUnavailableError(
                    "Supabase RPC is unavailable"
                ) from exc
            if (
                retry_ambiguous_claim
                and response.status_code >= 500
                and attempt + 1 < maximum_attempts
            ):
                continue
            break
        if response is None:
            raise SupabaseUnavailableError(
                "Supabase RPC is unavailable"
            ) from last_error
        if response.status_code < 200 or response.status_code >= 300:
            raise SupabaseUnavailableError("Supabase RPC is unavailable")
        try:
            return response.json()
        except (ValueError, json.JSONDecodeError) as exc:
            raise SupabaseContractError("Supabase RPC response is invalid") from exc

    def _user_rpc(
        self,
        name: str,
        arguments: Mapping[str, Any],
        access_token: str,
    ) -> Any:
        if not isinstance(access_token, str) or not access_token.strip():
            raise SupabaseAuthenticationError("Authentication is required")
        try:
            response = self._client.post(
                f"{self._configuration.url}/rest/v1/rpc/{name}",
                headers={
                    **self._user_headers(access_token.strip()),
                    "Content-Type": "application/json",
                },
                json=dict(arguments),
            )
        except httpx.HTTPError as exc:
            raise SupabaseUnavailableError("Supabase RPC is unavailable") from exc
        if response.status_code in {401, 403}:
            raise SupabaseAuthenticationError("Authentication is invalid")
        if response.status_code < 200 or response.status_code >= 300:
            raise SupabaseUnavailableError("Supabase RPC is unavailable")
        try:
            return response.json()
        except (ValueError, json.JSONDecodeError) as exc:
            raise SupabaseContractError("Supabase RPC response is invalid") from exc

    def claim_total_loss_analysis(
        self, case_id: str, user_id: str, processing_token: str
    ) -> Mapping[str, Any]:
        payload = self._rpc(
            "claim_total_loss_analysis",
            {
                "case_id": _canonical_uuid(case_id, "Case ID"),
                "user_id": _canonical_uuid(user_id, "User ID"),
                "processing_token": _canonical_uuid(
                    processing_token, "Processing token"
                ),
            },
            retry_ambiguous_claim=True,
        )
        return self._single_rpc_row(payload, "Analysis claim")

    def get_total_loss_analysis_status(
        self, case_id: str, user_id: str
    ) -> Mapping[str, Any]:
        payload = self._rpc(
            "get_total_loss_analysis_status",
            {
                "case_id": _canonical_uuid(case_id, "Case ID"),
                "user_id": _canonical_uuid(user_id, "User ID"),
            },
        )
        return self._single_rpc_row(payload, "Analysis status")

    def get_owned_total_loss_report_storage_locator(
        self, case_id: str, access_token: str
    ) -> Mapping[str, Any]:
        canonical_case_id = _canonical_uuid(case_id, "Case ID")
        payload = self._user_rpc(
            "get_owned_total_loss_report_storage_locator",
            {"case_id": canonical_case_id},
            access_token,
        )
        row = self._single_rpc_row(payload, "Report storage locator")
        if row.get("case_id") != canonical_case_id:
            raise SupabaseContractError("Report storage locator is invalid")
        self._validated_storage_locator(canonical_case_id, row)
        owner_id = _canonical_uuid(row.get("storage_owner_id"), "Storage owner ID")
        if row.get("backup_object_path") != "/".join(
            (owner_id, canonical_case_id, "valuation-report-backup.pdf")
        ):
            raise SupabaseContractError("Report storage backup object is invalid")
        _canonical_uuid(row.get("finalized_upload_id"), "Report upload ID")
        return row

    @staticmethod
    def _analysis_input_revision(value: Any) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise SupabaseContractError("Analysis input revision is invalid")
        return value

    def get_total_loss_report_extraction(
        self,
        case_id: str,
        report_upload_id: str,
        analysis_input_revision: int,
    ) -> Mapping[str, Any] | None:
        payload = self._rpc(
            "get_total_loss_report_extraction",
            {
                "case_id": _canonical_uuid(case_id, "Case ID"),
                "report_upload_id": _canonical_uuid(
                    report_upload_id, "Report upload ID"
                ),
                "analysis_input_revision": self._analysis_input_revision(
                    analysis_input_revision
                ),
            },
        )
        if payload is None or payload == []:
            return None
        row = self._single_rpc_row(payload, "Report extraction")
        return self._validated_extraction_row(
            row,
            case_id=case_id,
            report_upload_id=report_upload_id,
            analysis_input_revision=analysis_input_revision,
        )

    @staticmethod
    def _validated_extraction_row(
        row: Mapping[str, Any],
        *,
        case_id: str,
        report_upload_id: str,
        analysis_input_revision: int,
    ) -> Mapping[str, Any]:
        if row.get("case_id") != _canonical_uuid(case_id, "Case ID"):
            raise SupabaseContractError("Report extraction response is invalid")
        if row.get("report_upload_id") != _canonical_uuid(
            report_upload_id, "Report upload ID"
        ):
            raise SupabaseContractError("Report extraction response is invalid")
        if row.get(
            "analysis_input_revision"
        ) != SupabaseHttpGateway._analysis_input_revision(
            analysis_input_revision
        ):
            raise SupabaseContractError("Report extraction response is invalid")
        provider = row.get("provider_name")
        if provider is not None and (
            not isinstance(provider, str)
            or not provider.strip()
            or len(provider) > MAX_EXTRACTION_PROVIDER_CHARACTERS
            or any(ord(character) < 32 or ord(character) == 127 for character in provider)
        ):
            raise SupabaseContractError("Report extraction response is invalid")
        status = row.get("extraction_status")
        if status not in {"needs_confirmation", "confirmed", "failed"}:
            raise SupabaseContractError("Report extraction response is invalid")
        confidence = row.get("confidence")
        if confidence is not None and (
            isinstance(confidence, bool)
            or not isinstance(confidence, (int, float))
            or not math.isfinite(float(confidence))
            or confidence < 0
            or confidence > 1
        ):
            raise SupabaseContractError("Report extraction response is invalid")
        schema_version = row.get("extraction_schema_version")
        if (
            not isinstance(schema_version, str)
            or EXTRACTION_SCHEMA_VERSION_PATTERN.fullmatch(schema_version) is None
        ):
            raise SupabaseContractError("Report extraction response is invalid")
        normalized = row.get("normalized_report")
        if (status == "failed" and normalized is not None) or (
            status != "failed" and not isinstance(normalized, Mapping)
        ):
            raise SupabaseContractError("Report extraction response is invalid")
        return row

    def persist_total_loss_report_extraction(
        self,
        case_id: str,
        report_upload_id: str,
        analysis_input_revision: int,
        provider_name: str | None,
        extraction_status: str,
        confidence: float | None,
        extraction_schema_version: str,
        normalized_report: Mapping[str, Any] | None,
    ) -> Mapping[str, Any]:
        if provider_name is not None and (
            not isinstance(provider_name, str)
            or not provider_name.strip()
            or len(provider_name.strip()) > MAX_EXTRACTION_PROVIDER_CHARACTERS
            or any(
                ord(character) < 32 or ord(character) == 127
                for character in provider_name
            )
        ):
            raise SupabaseContractError("Report provider name is invalid")
        if extraction_status not in {"needs_confirmation", "confirmed", "failed"}:
            raise SupabaseContractError("Report extraction status is invalid")
        if confidence is not None and (
            isinstance(confidence, bool)
            or not isinstance(confidence, (int, float))
            or not math.isfinite(float(confidence))
            or confidence < 0
            or confidence > 1
        ):
            raise SupabaseContractError("Report extraction confidence is invalid")
        if (
            not isinstance(extraction_schema_version, str)
            or EXTRACTION_SCHEMA_VERSION_PATTERN.fullmatch(
                extraction_schema_version.strip()
            )
            is None
        ):
            raise SupabaseContractError("Extraction schema version is invalid")
        if (extraction_status == "failed" and normalized_report is not None) or (
            extraction_status != "failed"
            and not isinstance(normalized_report, Mapping)
        ):
            raise SupabaseContractError("Normalized report is invalid")
        normalized_payload: dict[str, Any] | None = None
        if normalized_report is not None:
            try:
                encoded_report = json.dumps(
                    dict(normalized_report),
                    ensure_ascii=True,
                    allow_nan=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
            except (TypeError, ValueError) as exc:
                raise SupabaseContractError("Normalized report is invalid") from exc
            if len(encoded_report) > MAX_EXTRACTION_CACHE_BYTES:
                raise SupabaseContractError("Normalized report is too large")
            normalized_payload = json.loads(encoded_report)
        payload = self._rpc(
            "persist_total_loss_report_extraction",
            {
                "case_id": _canonical_uuid(case_id, "Case ID"),
                "report_upload_id": _canonical_uuid(
                    report_upload_id, "Report upload ID"
                ),
                "analysis_input_revision": self._analysis_input_revision(
                    analysis_input_revision
                ),
                "provider_name": (
                    provider_name.strip() if isinstance(provider_name, str) else None
                ),
                "extraction_status": extraction_status,
                "confidence": (
                    float(confidence) if confidence is not None else None
                ),
                "extraction_schema_version": extraction_schema_version.strip(),
                "normalized_report": normalized_payload,
            },
        )
        row = self._single_rpc_row(payload, "Report extraction persistence")
        return self._validated_extraction_row(
            row,
            case_id=case_id,
            report_upload_id=report_upload_id,
            analysis_input_revision=analysis_input_revision,
        )

    @staticmethod
    def _rpc_boolean(payload: Any, label: str) -> bool:
        if isinstance(payload, bool):
            return payload
        if isinstance(payload, list) and len(payload) == 1:
            value = payload[0]
            if isinstance(value, bool):
                return value
            if isinstance(value, Mapping) and len(value) == 1:
                result = next(iter(value.values()))
                if isinstance(result, bool):
                    return result
        if isinstance(payload, Mapping) and len(payload) == 1:
            result = next(iter(payload.values()))
            if isinstance(result, bool):
                return result
        raise SupabaseContractError(f"{label} response is invalid")

    def complete_total_loss_analysis(
        self,
        job_id: str,
        processing_token: str,
        run_id: str,
        artifact: Mapping[str, Any],
    ) -> bool:
        payload = self._rpc(
            "complete_total_loss_analysis",
            {
                "job_id": _canonical_uuid(job_id, "Job ID"),
                "processing_token": _canonical_uuid(
                    processing_token, "Processing token"
                ),
                "run_id": _canonical_uuid(run_id, "Run ID"),
                "artifact": dict(artifact),
            },
        )
        return self._rpc_boolean(payload, "Analysis completion")

    def fail_total_loss_analysis(
        self,
        job_id: str,
        processing_token: str,
        failure_code: str,
        retryable: bool,
    ) -> bool:
        payload = self._rpc(
            "fail_total_loss_analysis",
            {
                "job_id": _canonical_uuid(job_id, "Job ID"),
                "processing_token": _canonical_uuid(
                    processing_token, "Processing token"
                ),
                "failure_code": failure_code,
                "retryable": retryable,
            },
        )
        return self._rpc_boolean(payload, "Analysis failure")

    def get_owned_analysis_run(
        self, run_id: str, user_id: str
    ) -> Mapping[str, Any] | str | None:
        payload = self._rpc(
            "get_owned_analysis_run",
            {
                "run_id": _canonical_uuid(run_id, "Run ID"),
                "user_id": _canonical_uuid(user_id, "User ID"),
            },
        )
        if payload is None or payload == []:
            return None
        if isinstance(payload, list):
            if len(payload) != 1:
                raise SupabaseContractError(
                    "Owned analysis response is invalid"
                )
            payload = payload[0]
        if isinstance(payload, Mapping) and set(payload) == {"artifact"}:
            payload = payload["artifact"]
        if isinstance(payload, (Mapping, str)):
            return payload
        raise SupabaseContractError("Owned analysis response is invalid")

    @staticmethod
    def _storage_path(user_id: str, case_id: str) -> str:
        user = _canonical_uuid(user_id, "User ID")
        case = _canonical_uuid(case_id, "Case ID")
        return "/".join(
            quote(segment, safe="")
            for segment in (user, case, TOTAL_LOSS_REPORT_OBJECT)
        )

    @staticmethod
    def _validated_storage_locator(
        case_id: str, storage_locator: Mapping[str, Any]
    ) -> tuple[str, str]:
        canonical_case_id = _canonical_uuid(case_id, "Case ID")
        if not isinstance(storage_locator, Mapping):
            raise SupabaseContractError("Report storage locator is invalid")
        bucket = storage_locator.get("storage_bucket", storage_locator.get("bucket_id"))
        owner_id = storage_locator.get("storage_owner_id")
        object_path = storage_locator.get(
            "storage_object_path", storage_locator.get("canonical_object_path")
        )
        if bucket != CASE_FILES_BUCKET:
            raise SupabaseContractError("Report storage bucket is invalid")
        canonical_owner = _canonical_uuid(owner_id, "Storage owner ID")
        expected_path = "/".join(
            (canonical_owner, canonical_case_id, TOTAL_LOSS_REPORT_OBJECT)
        )
        if object_path != expected_path:
            raise SupabaseContractError("Report storage object is invalid")
        return bucket, expected_path

    @contextmanager
    def _materialize_report_object(
        self, bucket: str, object_path: str, cache_nonce: str
    ) -> Iterator[Path]:
        nonce = _canonical_uuid(cache_nonce, "Storage cache nonce")
        encoded_path = "/".join(
            quote(segment, safe="") for segment in object_path.split("/")
        )
        url = (
            f"{self._configuration.url}/storage/v1/object/authenticated/"
            f"{quote(bucket, safe='')}/{encoded_path}?cacheNonce={quote(nonce, safe='')}"
        )
        try:
            with self._client.stream(
                "GET", url, headers=self._admin_headers()
            ) as response:
                if response.status_code == 404:
                    raise SupabaseReportNotFoundError(
                        "Private report was not found"
                    )
                if response.status_code < 200 or response.status_code >= 300:
                    raise SupabaseUnavailableError(
                        "Private report storage is unavailable"
                    )
                declared_length = response.headers.get("content-length")
                if declared_length is not None:
                    try:
                        parsed_length = int(declared_length)
                    except ValueError as exc:
                        raise SupabaseReportInvalidError(
                            "Private report is invalid"
                        ) from exc
                    if parsed_length <= 0 or parsed_length > MAX_PDF_BYTES:
                        raise SupabaseReportInvalidError(
                            "Private report is invalid"
                        )

                with tempfile.TemporaryDirectory(
                    prefix="venfour-case-report-"
                ) as temporary_root:
                    destination = Path(temporary_root) / "report.pdf"
                    copied = 0
                    header = bytearray()
                    try:
                        with destination.open("xb") as output:
                            for chunk in response.iter_bytes(DOWNLOAD_CHUNK_BYTES):
                                if not chunk:
                                    continue
                                copied += len(chunk)
                                if copied > MAX_PDF_BYTES:
                                    raise SupabaseReportInvalidError(
                                        "Private report is invalid"
                                    )
                                if len(header) < 5:
                                    remaining = 5 - len(header)
                                    header.extend(chunk[:remaining])
                                output.write(chunk)
                    except OSError as exc:
                        raise SupabaseUnavailableError(
                            "Temporary report storage is unavailable"
                        ) from exc
                    if copied <= 0 or bytes(header) != b"%PDF-":
                        raise SupabaseReportInvalidError(
                            "Private report is invalid"
                        )
                    yield destination
        except (
            SupabaseReportNotFoundError,
            SupabaseReportInvalidError,
            SupabaseUnavailableError,
        ):
            raise
        except httpx.HTTPError as exc:
            raise SupabaseUnavailableError(
                "Private report storage is unavailable"
            ) from exc

    @contextmanager
    def materialize_total_loss_report(
        self, user_id: str, case_id: str, cache_nonce: str
    ) -> Iterator[Path]:
        object_path = self._storage_path(user_id, case_id)
        with self._materialize_report_object(
            CASE_FILES_BUCKET, object_path, cache_nonce
        ) as destination:
            yield destination

    @contextmanager
    def materialize_total_loss_report_from_locator(
        self,
        case_id: str,
        storage_locator: Mapping[str, Any],
        cache_nonce: str,
    ) -> Iterator[Path]:
        bucket, object_path = self._validated_storage_locator(
            case_id, storage_locator
        )
        with self._materialize_report_object(
            bucket, object_path, cache_nonce
        ) as destination:
            yield destination


__all__ = [
    "CASE_FILES_BUCKET",
    "CaseAnalysisGateway",
    "MAX_EXTRACTION_CACHE_BYTES",
    "ReportIngestionGateway",
    "SupabaseAuthenticationError",
    "SupabaseConfigurationError",
    "SupabaseContractError",
    "SupabaseGatewayError",
    "SupabaseHttpGateway",
    "SupabaseReportInvalidError",
    "SupabaseReportNotFoundError",
    "SupabaseServerConfiguration",
    "SupabaseUnavailableError",
    "TOTAL_LOSS_REPORT_OBJECT",
]
