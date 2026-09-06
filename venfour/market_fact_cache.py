"""Bounded server-side caching for explicit provider vehicle facts."""

from __future__ import annotations

import copy
import hashlib
import json
import threading
import time
from collections.abc import Callable, Mapping
from typing import Any, Protocol, runtime_checkable
from uuid import uuid4

from venfour.marketcheck import (
    MARKETCHECK_DRIVETRAIN_LOOKUP_MAX_ROWS,
    drivetrain_lookup_failure,
    validate_drivetrain_lookup_result,
)


@runtime_checkable
class MarketFactCacheGateway(Protocol):
    def claim_market_fact_cache(self, lookup_key: str, token: str) -> Mapping[str, Any]: ...
    def complete_market_fact_cache(self, lookup_key: str, token: str, result: Mapping[str, Any]) -> bool: ...
    def preserve_market_fact_cache_conflict(self, lookup_key: str, expected_evidence_digest: str, result: Mapping[str, Any]) -> bool: ...


def market_fact_cache_key(vin: str, *, year: int, make: str, model: str) -> str:
    identity = ["marketcheck", "active-vin-drivetrain", "1", vin.strip().upper(), year,
                " ".join(make.split()).casefold(), " ".join(model.split()).casefold()]
    return hashlib.sha256(json.dumps(identity, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def _ttl_seconds(result: Mapping[str, Any]) -> int:
    return 604800 if result["status"] == "RESOLVED" else 300 if result["status"] == "FAILED" else 86400


def saved_drivetrain_lookup(*providers: Any) -> Callable[..., dict[str, Any] | None]:
    """Inspect both search streams without preferring one conflicting source."""
    def lookup(vin: str, *, year: int, make: str, model: str) -> dict[str, Any] | None:
        results = []
        for provider in providers:
            method = getattr(provider, "saved_drivetrain", None)
            if callable(method):
                result = method(vin, year=year, make=make, model=model)
                if result is not None:
                    results.append(validate_drivetrain_lookup_result(result))
        if not results:
            return None
        failed = next((result for result in results if result["status"] == "FAILED"), None)
        if failed is not None:
            return failed
        evidence = []
        for result in results:
            for row in result["evidence"]:
                if row not in evidence:
                    evidence.append(copy.deepcopy(row))
        if len(evidence) > MARKETCHECK_DRIVETRAIN_LOOKUP_MAX_ROWS:
            result = drivetrain_lookup_failure(vin, year=year, make=make, model=model,
                                               reason_code="SAVED_PROVIDER_FACT_LIMIT_REACHED")
            result["lookupSource"] = "SAVED_PROVIDER_EVIDENCE"
            return result
        values = {row["drivetrain"] for row in evidence if row["drivetrain"] is not None}
        result = copy.deepcopy(results[0])
        result.update(status="RESOLVED" if len(values) == 1 else "CONFLICT" if values else "UNAVAILABLE",
                      drivetrain=next(iter(values)) if len(values) == 1 else None,
                      reasonCode="EXPLICIT_SAVED_PROVIDER_DRIVETRAIN" if len(values) == 1 else "CONFLICTING_EXPLICIT_DRIVETRAIN" if values else "SAVED_PROVIDER_DRIVETRAIN_UNAVAILABLE",
                      evidence=evidence, retrievedAt=max(item["retrievedAt"] for item in results),
                      lookupSource="SAVED_PROVIDER_EVIDENCE", cacheHit=False, providerRequestCount=0,
                      evidenceDigest=hashlib.sha256(json.dumps(evidence, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest())
        return validate_drivetrain_lookup_result(result)
    return lookup


class MemoryMarketFactCache:
    """Share claims and expiring results within a standalone service instance."""

    def __init__(self, *, clock: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self._rows: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def claim_market_fact_cache(self, lookup_key: str, token: str) -> Mapping[str, Any]:
        with self._lock:
            now = self._clock()
            row = self._rows.get(lookup_key)
            if row and row["expires"] > now:
                if row["result"] is not None:
                    return {"outcome": "ready", "result": copy.deepcopy(row["result"])}
                return {"outcome": "claimed" if row["token"] == token else "pending", "result": None}
            self._rows[lookup_key] = {"token": token, "expires": now + 90, "result": None}
            return {"outcome": "claimed", "result": None}

    def complete_market_fact_cache(self, lookup_key: str, token: str, result: Mapping[str, Any]) -> bool:
        validated = validate_drivetrain_lookup_result(result)
        with self._lock:
            row = self._rows.get(lookup_key)
            if not row or row["token"] != token or row["expires"] <= self._clock():
                return False
            if row["result"] is not None:
                return row["result"] == validated
            row.update(result=copy.deepcopy(validated), expires=self._clock() + _ttl_seconds(validated))
            return True

    def preserve_market_fact_cache_conflict(self, lookup_key: str, expected_evidence_digest: str,
                                           result: Mapping[str, Any]) -> bool:
        validated = validate_drivetrain_lookup_result(result)
        if validated["status"] != "CONFLICT" or validated["providerRequestCount"] != 0:
            raise ValueError("Only a saved evidence conflict can be preserved")
        with self._lock:
            now = self._clock()
            row = self._rows.get(lookup_key)
            if not row or row["expires"] <= now or row["result"] is None:
                return False
            prior = row["result"]
            if (prior["evidenceDigest"] != expected_evidence_digest
                    or prior["vin"] != validated["vin"]
                    or prior["vehicle"] != validated["vehicle"]
                    or any(item not in validated["evidence"] for item in prior["evidence"])):
                return False
            row.update(result=copy.deepcopy(validated), expires=now + _ttl_seconds(validated))
            return True


class CachedDrivetrainLookup:
    """Use a token-fenced cache before a single bounded provider lookup."""

    def __init__(self, lookup: Callable[..., Mapping[str, Any]], cache: MarketFactCacheGateway,
                 *, saved_lookup: Callable[..., Mapping[str, Any] | None] | None = None) -> None:
        if not callable(lookup) or not isinstance(cache, MarketFactCacheGateway):
            raise TypeError("lookup and market fact cache are required")
        self._lookup = lookup
        self._cache = cache
        self._saved_lookup = saved_lookup

    @staticmethod
    def _matches(result: Mapping[str, Any], vin: str, year: int, make: str, model: str) -> bool:
        return market_fact_cache_key(result["vin"], **result["vehicle"]) == market_fact_cache_key(
            vin, year=year, make=make, model=model)

    def __call__(self, vin: str, *, year: int, make: str, model: str) -> dict[str, Any]:
        key = market_fact_cache_key(vin, year=year, make=make, model=model)
        token = str(uuid4())

        def failure(reason: str) -> dict[str, Any]:
            return drivetrain_lookup_failure(vin, year=year, make=make, model=model, reason_code=reason)

        saved_result: dict[str, Any] | None = None
        if self._saved_lookup is not None:
            try:
                saved = self._saved_lookup(vin, year=year, make=make, model=model)
                if saved is not None:
                    result = validate_drivetrain_lookup_result(saved)
                    if (not self._matches(result, vin, year, make, model)
                            or result["providerRequestCount"] != 0
                            or result["lookupSource"] != "SAVED_PROVIDER_EVIDENCE"):
                        return failure("SAVED_PROVIDER_FACT_IDENTITY_INVALID")
                    saved_result = result
            except Exception:
                return failure("SAVED_PROVIDER_FACT_UNAVAILABLE")

        try:
            claim = self._cache.claim_market_fact_cache(key, token)
            if claim.get("outcome") == "ready":
                result = validate_drivetrain_lookup_result(claim["result"])
                if not self._matches(result, vin, year, make, model):
                    return saved_result if saved_result is not None else failure("CACHED_PROVIDER_FACT_IDENTITY_CONFLICT")
                if saved_result is not None:
                    merged = self._reconcile_saved(result, saved_result, failure)
                    if merged["status"] == "CONFLICT" and merged != result:
                        try:
                            self._cache.preserve_market_fact_cache_conflict(key, result["evidenceDigest"], merged)
                        except Exception:
                            # The current artifact still retains the observed conflict.
                            pass
                    return merged
                result.update(cacheHit=True, providerRequestCount=0)
                return result
            if claim.get("outcome") == "pending":
                return saved_result if saved_result is not None else failure("PROVIDER_FACT_LOOKUP_ALREADY_IN_PROGRESS")
            if claim.get("outcome") != "claimed":
                return saved_result if saved_result is not None else failure("PROVIDER_FACT_CACHE_UNAVAILABLE")
        except Exception:
            return saved_result if saved_result is not None else failure("PROVIDER_FACT_CACHE_UNAVAILABLE")

        if saved_result is not None:
            result = saved_result
        else:
            try:
                result = validate_drivetrain_lookup_result(self._lookup(vin, year=year, make=make, model=model))
                if not self._matches(result, vin, year, make, model):
                    result = failure("PROVIDER_FACT_IDENTITY_CONFLICT")
            except Exception:
                result = failure("PROVIDER_FACT_LOOKUP_FAILED")
        try:
            self._cache.complete_market_fact_cache(key, token, result)
        except Exception:
            # The immutable analysis retains this result even if cache storage fails.
            pass
        return result

    @staticmethod
    def _reconcile_saved(cached: Mapping[str, Any], saved: Mapping[str, Any],
                         failure: Callable[[str], dict[str, Any]]) -> dict[str, Any]:
        evidence = copy.deepcopy(cached["evidence"])
        for row in saved["evidence"]:
            if row not in evidence:
                evidence.append(copy.deepcopy(row))
        if len(evidence) > MARKETCHECK_DRIVETRAIN_LOOKUP_MAX_ROWS:
            result = failure("SAVED_PROVIDER_FACT_LIMIT_REACHED")
            result["lookupSource"] = "SAVED_PROVIDER_EVIDENCE"
            return result
        values = {row["drivetrain"] for row in evidence if row["drivetrain"] is not None}
        if len(values) > 1:
            status, reason = "CONFLICT", "CONFLICTING_SAVED_AND_CACHED_DRIVETRAIN"
        elif saved["status"] == "FAILED":
            # An invalid fresh source is not repaired by an older cached value.
            return copy.deepcopy(dict(saved))
        elif values:
            status, reason = "RESOLVED", "EXPLICIT_SAVED_AND_CACHED_DRIVETRAIN"
        else:
            status, reason = saved["status"], saved["reasonCode"]
        merged = copy.deepcopy(dict(cached))
        merged.update(status=status, reasonCode=reason,
                      drivetrain=next(iter(values)) if status == "RESOLVED" else None,
                      evidence=evidence,
                      evidenceDigest=hashlib.sha256(json.dumps(evidence, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest(),
                      retrievedAt=max(cached["retrievedAt"], saved["retrievedAt"]),
                      lookupSource="SAVED_PROVIDER_EVIDENCE", cacheHit=True, providerRequestCount=0)
        return validate_drivetrain_lookup_result(merged)
