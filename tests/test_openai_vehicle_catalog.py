"""Offline tests for cached server-side vehicle trim generation."""

from __future__ import annotations

import json
import unittest
from collections.abc import Mapping
from types import SimpleNamespace
from typing import Any

from venfour.openai_vehicle_catalog import (
    OPENAI_VEHICLE_TRIM_MODEL,
    OpenAIVehicleTrimCatalog,
    VehicleTrimCatalogUnavailableError,
    vehicle_trim_lookup_key,
)
from venfour.vehicle_catalog import VehicleTrimCatalogRequest


class MemoryTrimCache:
    def __init__(self) -> None:
        self.records: dict[str, dict[str, Any]] = {}
        self.claims: list[tuple[Any, ...]] = []
        self.completions: list[tuple[Any, ...]] = []
        self.releases: list[tuple[str, str]] = []

    def claim_vehicle_trim_cache(
        self,
        lookup_key: str,
        vehicle_year: int,
        vehicle_make: str,
        vehicle_model: str,
        generation_token: str,
    ) -> Mapping[str, Any]:
        self.claims.append(
            (
                lookup_key,
                vehicle_year,
                vehicle_make,
                vehicle_model,
                generation_token,
            )
        )
        record = self.records.get(lookup_key)
        if record is None:
            self.records[lookup_key] = {
                "status": "pending",
                "token": generation_token,
            }
            return {"outcome": "claimed"}
        if record["status"] == "ready":
            return {
                "outcome": "ready",
                "trims": list(record["trims"]),
                "model_identifier": record["model"],
            }
        if record["token"] == generation_token:
            return {"outcome": "claimed"}
        return {"outcome": "pending"}

    def complete_vehicle_trim_cache(
        self,
        lookup_key: str,
        generation_token: str,
        model_identifier: str,
        trims: list[str],
    ) -> bool:
        self.completions.append(
            (lookup_key, generation_token, model_identifier, list(trims))
        )
        record = self.records.get(lookup_key)
        if (
            record is None
            or record["status"] != "pending"
            or record["token"] != generation_token
        ):
            return False
        record.update(
            status="ready",
            model=model_identifier,
            trims=list(trims),
        )
        return True

    def release_vehicle_trim_cache(
        self,
        lookup_key: str,
        generation_token: str,
    ) -> bool:
        self.releases.append((lookup_key, generation_token))
        record = self.records.get(lookup_key)
        if (
            record is None
            or record["status"] != "pending"
            or record["token"] != generation_token
        ):
            return False
        del self.records[lookup_key]
        return True


class RecordingResponses:
    def __init__(self, outputs: list[Any]) -> None:
        self.outputs = list(outputs)
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        outcome = self.outputs.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return SimpleNamespace(
            status="completed",
            output_text=json.dumps({"trims": outcome}),
            model=OPENAI_VEHICLE_TRIM_MODEL,
        )


class RecordingClient:
    def __init__(self, outputs: list[Any]) -> None:
        self.responses = RecordingResponses(outputs)


class OpenAIVehicleTrimCatalogTests(unittest.TestCase):
    def test_unseen_vehicle_uses_one_small_strict_request_and_caches_labels(
        self,
    ) -> None:
        cache = MemoryTrimCache()
        client = RecordingClient(
            [
                [
                    "Long Range Battery",
                    "Long Range",
                    " long   range ",
                    "Long Range Dual Motor All-Wheel Drive",
                    "Long Range RWD",
                    "Performance",
                    "Other / Not sure",
                ]
            ]
        )
        service = OpenAIVehicleTrimCatalog(cache, client=client)
        request = VehicleTrimCatalogRequest(2019, "Tesla", "Model 3")

        first = service.list_trims(request)
        second = service.list_trims(request)

        expected_labels = [
            "Long Range",
            "Long Range Dual Motor AWD",
            "Long Range RWD",
            "Performance",
        ]
        self.assertEqual([option.label for option in first], expected_labels)
        self.assertEqual(second, first)
        self.assertEqual(len(client.responses.calls), 1)
        self.assertEqual(len(cache.completions), 1)
        self.assertEqual(cache.completions[0][2], OPENAI_VEHICLE_TRIM_MODEL)
        self.assertEqual(cache.completions[0][3], expected_labels)

        call = client.responses.calls[0]
        self.assertEqual(call["model"], "gpt-5.6-luna")
        self.assertEqual(call["reasoning"], {"effort": "none"})
        self.assertEqual(call["max_output_tokens"], 512)
        self.assertIs(call["store"], False)
        self.assertNotIn("tools", call)
        self.assertEqual(
            json.loads(call["input"]),
            {"year": 2019, "make": "Tesla", "model": "Model 3"},
        )
        response_format = call["text"]["format"]
        self.assertEqual(response_format["type"], "json_schema")
        self.assertIs(response_format["strict"], True)
        self.assertIs(
            response_format["schema"]["additionalProperties"], False
        )

    def test_pending_claim_never_makes_a_duplicate_generation_request(self) -> None:
        cache = MemoryTrimCache()
        request = VehicleTrimCatalogRequest(2024, "Honda", "Accord")
        key = vehicle_trim_lookup_key(request)
        cache.records[key] = {"status": "pending", "token": "other-token"}
        client = RecordingClient([])
        service = OpenAIVehicleTrimCatalog(cache, client=client)

        with self.assertRaises(VehicleTrimCatalogUnavailableError):
            service.list_trims(request)
        self.assertEqual(client.responses.calls, [])
        self.assertEqual(cache.completions, [])

    def test_cached_empty_result_is_reused_without_another_request(self) -> None:
        cache = MemoryTrimCache()
        client = RecordingClient([[]])
        service = OpenAIVehicleTrimCatalog(cache, client=client)
        request = VehicleTrimCatalogRequest(1992, "Geo", "Storm")

        self.assertEqual(service.list_trims(request), ())
        self.assertEqual(service.list_trims(request), ())

        self.assertEqual(len(client.responses.calls), 1)
        self.assertEqual(cache.completions[0][3], [])
        self.assertEqual(cache.records[vehicle_trim_lookup_key(request)]["status"], "ready")

    def test_failures_and_invalid_structured_data_release_the_claim(self) -> None:
        cases = (
            RuntimeError("synthetic provider failure"),
            ["Valid", 7],
            ["x" * 101],
        )
        for index, outcome in enumerate(cases):
            with self.subTest(index=index):
                cache = MemoryTrimCache()
                client = RecordingClient([outcome])
                service = OpenAIVehicleTrimCatalog(cache, client=client)
                request = VehicleTrimCatalogRequest(
                    2020 + index, "Synthetic", f"Model {index}"
                )

                with self.assertRaises(VehicleTrimCatalogUnavailableError):
                    service.list_trims(request)
                self.assertEqual(len(cache.releases), 1)
                self.assertNotIn(vehicle_trim_lookup_key(request), cache.records)

    def test_materially_distinct_configurations_remain_separate(self) -> None:
        cases = (
            (
                VehicleTrimCatalogRequest(2023, "Toyota", "RAV4"),
                ["LE", "LE Hybrid", "XLE", "XLE Hybrid"],
            ),
            (
                VehicleTrimCatalogRequest(2022, "Ford", "F-150"),
                ["XL", "XLT", "Lariat", "King Ranch", "Raptor"],
            ),
            (
                VehicleTrimCatalogRequest(2021, "BMW", "3 Series"),
                ["330i", "330i xDrive", "M340i", "M340i xDrive"],
            ),
            (
                VehicleTrimCatalogRequest(2024, "Hyundai", "Ioniq 5"),
                ["SE Standard Range", "SE", "SEL", "Limited", "N"],
            ),
        )
        for request, labels in cases:
            with self.subTest(vehicle=request):
                service = OpenAIVehicleTrimCatalog(
                    MemoryTrimCache(),
                    client=RecordingClient([labels]),
                )

                options = service.list_trims(request)

                self.assertEqual(len(options), len(labels))
                self.assertEqual(
                    {option.label.casefold() for option in options},
                    {label.casefold() for label in labels},
                )

    def test_lookup_key_normalizes_case_width_and_whitespace(self) -> None:
        left = VehicleTrimCatalogRequest(2019, " Tesla ", "Model  3")
        right = VehicleTrimCatalogRequest(2019, "TESLA", "Ｍｏｄｅｌ 3")

        self.assertEqual(
            vehicle_trim_lookup_key(left),
            vehicle_trim_lookup_key(right),
        )
        self.assertEqual(vehicle_trim_lookup_key(left), "2019|tesla|model 3")


if __name__ == "__main__":
    unittest.main()
