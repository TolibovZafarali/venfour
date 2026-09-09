"""Case-scoped normalized search checkpoints under the existing job lease."""

from __future__ import annotations

import copy
import hashlib
import json
import re
from collections.abc import Mapping
from typing import Any
from uuid import UUID


def _identity(value: Any) -> str:
    if not isinstance(value, str) or str(UUID(value)) != value:
        raise ValueError("Invalid market search processing identity")
    return value


def validate_search_progress_arguments(arguments: Mapping[str, Any], *, save: bool) -> dict[str, Any]:
    keys = {"requested_case_id", "requested_job_id", "requested_processing_token", "requested_input_digest",
            "requested_retention_days"}
    if save:
        keys.add("requested_checkpoint")
    if not isinstance(arguments, Mapping) or set(arguments) != keys:
        raise ValueError("Invalid market search checkpoint arguments")
    result = copy.deepcopy(dict(arguments))
    for key in ("requested_case_id", "requested_job_id", "requested_processing_token"):
        _identity(result[key])
    if not isinstance(result["requested_input_digest"], str) or re.fullmatch(r"[0-9a-f]{64}", result["requested_input_digest"]) is None:
        raise ValueError("Invalid search input digest")
    days = result["requested_retention_days"]
    if isinstance(days, bool) or not isinstance(days, int) or not 1 <= days <= 30:
        raise ValueError("Confirmed case evidence retention must be between 1 and 30 days")
    if save:
        CaseSearchProgress._validate(result["requested_checkpoint"])
        if result["requested_checkpoint"]["inputDigest"] != result["requested_input_digest"]:
            raise ValueError("Saved search belongs to different input")
    return result


class CaseSearchProgress:
    def __init__(self, gateway: Any, *, case_id: str, job_id: str, processing_token: str,
                 retention_days: int) -> None:
        if isinstance(retention_days, bool) or not isinstance(retention_days, int) or not 1 <= retention_days <= 30:
            raise ValueError("Confirmed case evidence retention must be between 1 and 30 days")
        for value in (case_id, job_id, processing_token):
            _identity(value)
        if any(not callable(getattr(gateway, method, None)) for method in
               ("get_case_market_search_progress", "save_case_market_search_progress")):
            raise TypeError("Case search checkpoint gateway is required")
        self.gateway = gateway
        self.identity = {"requested_case_id": case_id, "requested_job_id": job_id,
                         "requested_processing_token": processing_token}
        self.retention_days = retention_days

    def load(self, input_digest: str) -> Mapping[str, Any] | None:
        if not isinstance(input_digest, str) or not re.fullmatch(r"[0-9a-f]{64}", input_digest):
            raise ValueError("Invalid search input digest")
        result = self.gateway.get_case_market_search_progress({**self.identity, "requested_input_digest": input_digest,
                                                              "requested_retention_days": self.retention_days})
        if result is not None:
            self._validate(result)
            if result["inputDigest"] != input_digest:
                raise ValueError("Saved search belongs to different input")
        return copy.deepcopy(result)

    @staticmethod
    def _validate(checkpoint: Mapping[str, Any]) -> None:
        from venfour.analysis_runs import _security_errors
        if (not isinstance(checkpoint, Mapping) or checkpoint.get("version") != "1"
                or set(checkpoint) != {"version", "inputDigest", "input", "events", "geography", "origin", "providers", "usageBefore", "historicalTemplate"}
                or not isinstance(checkpoint.get("input"), Mapping)
                or not isinstance(checkpoint.get("inputDigest"), str)
                or re.fullmatch(r"[0-9a-f]{64}", checkpoint["inputDigest"]) is None
                or not isinstance(checkpoint.get("events"), list) or len(checkpoint["events"]) > 200
                or len(json.dumps(checkpoint, allow_nan=False).encode()) > 8_388_608):
            raise ValueError("Invalid bounded search checkpoint")
        digest = hashlib.sha256(json.dumps(checkpoint["input"], sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
        if digest != checkpoint["inputDigest"]:
            raise ValueError("Saved search input digest does not match its contents")
        stack = [checkpoint]
        while stack:
            value = stack.pop()
            if isinstance(value, Mapping):
                if any(re.sub(r"[^a-z0-9]", "", str(key).casefold()) in
                       {"rawresponse", "rawpayload", "providerresponse", "providerpayload", "requestheaders", "responseheaders"}
                       for key in value):
                    raise ValueError("Raw provider responses cannot be persisted as search checkpoints")
                stack.extend(value.values())
            elif isinstance(value, (list, tuple)):
                stack.extend(value)
        if _security_errors(checkpoint, (), include_environment_secrets=True):
            raise ValueError("Search checkpoint contains credential-bearing data")

    def save(self, checkpoint: Mapping[str, Any]) -> None:
        self._validate(checkpoint)
        result = self.gateway.save_case_market_search_progress({**self.identity,
            "requested_input_digest": checkpoint["inputDigest"], "requested_checkpoint": copy.deepcopy(dict(checkpoint)),
            "requested_retention_days": self.retention_days})
        if result is not True:
            raise ValueError("Search processing lease changed before checkpoint persistence")
