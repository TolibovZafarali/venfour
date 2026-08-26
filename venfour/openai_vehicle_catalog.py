"""Cached server-side trim generation for the customer vehicle selector."""

from __future__ import annotations

import json
import unicodedata
from collections.abc import Mapping
from typing import Any, Protocol
from uuid import uuid4

from openai import OpenAI

from venfour.vehicle_catalog import (
    OTHER_VEHICLE_TRIM_LABEL,
    VehicleTrimCatalogRequest,
    VehicleTrimOption,
    normalize_generated_vehicle_trim_options,
)


OPENAI_VEHICLE_TRIM_MODEL = "gpt-5.6-luna"
OPENAI_VEHICLE_TRIM_SOURCE = "openai"
MAX_GENERATED_VEHICLE_TRIMS = 50

_TRIM_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "trims": {
            "type": "array",
            "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 100,
            },
            "maxItems": MAX_GENERATED_VEHICLE_TRIMS,
        }
    },
    "required": ["trims"],
    "additionalProperties": False,
}

_TRIM_INSTRUCTIONS = """Return the actual consumer-facing trim or version names offered by the manufacturer for the exact year, make, and model supplied. Use concise canonical marketed names, not dealer inventory descriptions. Remove duplicates, obsolete aliases, spelling variants, and attributes repeated as alternate names. Do not create separate entries for drivetrain, engine, battery, range, body style, cab, bed, or performance attributes unless the manufacturer marketed that attribute as part of a genuinely distinct trim or version name for this exact vehicle. Preserve genuinely distinct marketed versions. Never invent a name. If the lineup cannot be identified with reasonable confidence, return an empty trims array. Do not browse the web."""


class VehicleTrimCatalogUnavailableError(Exception):
    """A transient trim generation or cache operation did not complete."""


class VehicleTrimCacheGateway(Protocol):
    """Minimal persistent cache surface required by trim generation."""

    def claim_vehicle_trim_cache(
        self,
        lookup_key: str,
        vehicle_year: int,
        vehicle_make: str,
        vehicle_model: str,
        generation_token: str,
    ) -> Mapping[str, Any]: ...

    def complete_vehicle_trim_cache(
        self,
        lookup_key: str,
        generation_token: str,
        model_identifier: str,
        trims: list[str],
    ) -> bool: ...

    def release_vehicle_trim_cache(
        self,
        lookup_key: str,
        generation_token: str,
    ) -> bool: ...


def vehicle_trim_lookup_key(request: VehicleTrimCatalogRequest) -> str:
    """Return the stable normalized key shared by every server instance."""

    def key_part(value: str) -> str:
        return " ".join(unicodedata.normalize("NFKC", value).split()).casefold()

    return "|".join(
        (str(request.year), key_part(request.make), key_part(request.model))
    )


class OpenAIVehicleTrimCatalog:
    """Generate one canonical trim list per persistent year/make/model key."""

    def __init__(
        self,
        cache: VehicleTrimCacheGateway,
        *,
        api_key: str | None = None,
        client: Any | None = None,
    ) -> None:
        required_cache_methods = (
            "claim_vehicle_trim_cache",
            "complete_vehicle_trim_cache",
            "release_vehicle_trim_cache",
        )
        if any(
            not callable(getattr(cache, method, None))
            for method in required_cache_methods
        ):
            raise TypeError("cache must expose the vehicle trim cache methods")
        if client is None:
            if not isinstance(api_key, str) or not api_key:
                raise ValueError("OpenAI API key is required")
            client = OpenAI(api_key=api_key, timeout=10.0, max_retries=0)
        if not callable(getattr(getattr(client, "responses", None), "create", None)):
            raise TypeError("client must expose responses.create")
        self._cache = cache
        self._client = client

    def list_trims(
        self, request: VehicleTrimCatalogRequest
    ) -> tuple[VehicleTrimOption, ...]:
        if not isinstance(request, VehicleTrimCatalogRequest):
            raise TypeError("request must be VehicleTrimCatalogRequest")

        lookup_key = vehicle_trim_lookup_key(request)
        generation_token = str(uuid4())
        try:
            claim = self._cache.claim_vehicle_trim_cache(
                lookup_key,
                request.year,
                request.make,
                request.model,
                generation_token,
            )
            outcome = claim.get("outcome")
            if outcome == "ready":
                return self._options_from_cache_claim(claim)
            if outcome == "pending":
                raise VehicleTrimCatalogUnavailableError(
                    "vehicle trim generation is already in progress"
                )
            if outcome != "claimed":
                raise VehicleTrimCatalogUnavailableError(
                    "vehicle trim cache claim is invalid"
                )

            options = self._request_options(request)
            labels = [option.label for option in options]
            if not self._cache.complete_vehicle_trim_cache(
                lookup_key,
                generation_token,
                OPENAI_VEHICLE_TRIM_MODEL,
                labels,
            ):
                raise VehicleTrimCatalogUnavailableError(
                    "vehicle trim cache completion failed"
                )
            return options
        except Exception as exc:
            try:
                self._cache.release_vehicle_trim_cache(
                    lookup_key,
                    generation_token,
                )
            except Exception:
                pass
            if isinstance(exc, VehicleTrimCatalogUnavailableError):
                raise
            raise VehicleTrimCatalogUnavailableError(
                "vehicle trim lookup is unavailable"
            ) from exc

    @staticmethod
    def _options_from_cache_claim(
        claim: Mapping[str, Any],
    ) -> tuple[VehicleTrimOption, ...]:
        if set(claim) != {"outcome", "trims", "model_identifier"}:
            raise ValueError("vehicle trim cache response is invalid")
        model_identifier = claim.get("model_identifier")
        if (
            not isinstance(model_identifier, str)
            or not model_identifier
            or len(model_identifier) > 100
        ):
            raise ValueError("vehicle trim cache model is invalid")
        return _validated_generated_options(claim.get("trims"))

    def _request_options(
        self, request: VehicleTrimCatalogRequest
    ) -> tuple[VehicleTrimOption, ...]:
        response = self._client.responses.create(
            model=OPENAI_VEHICLE_TRIM_MODEL,
            reasoning={"effort": "none"},
            instructions=_TRIM_INSTRUCTIONS,
            input=json.dumps(
                {
                    "year": request.year,
                    "make": request.make,
                    "model": request.model,
                },
                ensure_ascii=True,
                separators=(",", ":"),
            ),
            text={
                "format": {
                    "type": "json_schema",
                    "name": "vehicle_trim_catalog",
                    "schema": _TRIM_RESPONSE_SCHEMA,
                    "strict": True,
                }
            },
            max_output_tokens=512,
            store=False,
        )
        if getattr(response, "status", "completed") != "completed":
            raise ValueError("vehicle trim response is incomplete")
        output_text = getattr(response, "output_text", None)
        if not isinstance(output_text, str) or not output_text:
            raise ValueError("vehicle trim response is empty")
        try:
            payload = json.loads(output_text)
        except json.JSONDecodeError as exc:
            raise ValueError("vehicle trim response is invalid") from exc
        if (
            not isinstance(payload, Mapping)
            or set(payload) != {"trims"}
        ):
            raise ValueError("vehicle trim response is invalid")
        return _validated_generated_options(payload["trims"])


def _validated_generated_options(value: Any) -> tuple[VehicleTrimOption, ...]:
    if (
        not isinstance(value, list)
        or len(value) > MAX_GENERATED_VEHICLE_TRIMS
        or any(not isinstance(item, str) for item in value)
    ):
        raise ValueError("vehicle trim list is invalid")
    filtered = [
        item
        for item in value
        if " ".join(unicodedata.normalize("NFKC", item).split()).casefold()
        != OTHER_VEHICLE_TRIM_LABEL.casefold()
    ]
    return normalize_generated_vehicle_trim_options(
        filtered,
        source=OPENAI_VEHICLE_TRIM_SOURCE,
    )


__all__ = [
    "MAX_GENERATED_VEHICLE_TRIMS",
    "OPENAI_VEHICLE_TRIM_MODEL",
    "OPENAI_VEHICLE_TRIM_SOURCE",
    "OpenAIVehicleTrimCatalog",
    "VehicleTrimCacheGateway",
    "VehicleTrimCatalogUnavailableError",
    "vehicle_trim_lookup_key",
]
