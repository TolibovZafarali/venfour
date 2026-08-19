"""Server-only Supabase HTTP boundaries for owned appraisal analyses.

The gateway keeps every Supabase origin and credential under server control.
Callers provide only canonical identifiers and a browser access token; storage
paths are derived here and can never be selected by an HTTP request payload.
"""

from __future__ import annotations

import json
import os
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

    @contextmanager
    def materialize_total_loss_report(
        self, user_id: str, case_id: str, cache_nonce: str
    ) -> Iterator[Path]:
        object_path = self._storage_path(user_id, case_id)
        nonce = _canonical_uuid(cache_nonce, "Storage cache nonce")
        url = (
            f"{self._configuration.url}/storage/v1/object/authenticated/"
            f"{CASE_FILES_BUCKET}/{object_path}?cacheNonce={quote(nonce, safe='')}"
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
                            for chunk in response.iter_bytes(
                                DOWNLOAD_CHUNK_BYTES
                            ):
                                if not chunk:
                                    continue
                                copied += len(chunk)
                                if copied > MAX_PDF_BYTES:
                                    raise SupabaseReportInvalidError(
                                        "Private report is invalid"
                                    )
                                if len(header) < 1024:
                                    remaining = 1024 - len(header)
                                    header.extend(chunk[:remaining])
                                output.write(chunk)
                    except OSError as exc:
                        raise SupabaseUnavailableError(
                            "Temporary report storage is unavailable"
                        ) from exc
                    if copied <= 0 or b"%PDF-" not in header:
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


__all__ = [
    "CASE_FILES_BUCKET",
    "CaseAnalysisGateway",
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
