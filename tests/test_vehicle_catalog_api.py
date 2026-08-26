"""Offline tests for the public vehicle-trim catalog boundary."""

from __future__ import annotations

import os
import unittest
from unittest.mock import patch

import httpx
from starlette.testclient import TestClient

from venfour.api import create_app
from venfour.supabase_gateway import (
    SupabaseHttpGateway,
    SupabaseServerConfiguration,
)
from venfour.vehicle_catalog import VehicleTrimCatalogRequest, VehicleTrimOption


DEFAULT_TRIM_OPTIONS = tuple(
    VehicleTrimOption(
        source="marketcheck",
        id=f"marketcheck-trim-{label.casefold()}",
        label=label,
        trim=label,
        query_field="trim",
        query_values=(label,),
    )
    for label in ("LE", "SE", "XLE")
)


class RecordingVehicleTrimCatalog:
    def __init__(
        self,
        trims: tuple[VehicleTrimOption, ...] = DEFAULT_TRIM_OPTIONS,
        error: Exception | None = None,
    ) -> None:
        self.trims = trims
        self.error = error
        self.requests: list[VehicleTrimCatalogRequest] = []

    def list_trims(
        self, request: VehicleTrimCatalogRequest
    ) -> tuple[VehicleTrimOption, ...]:
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        return self.trims


class VehicleTrimCatalogApiTests(unittest.TestCase):
    def test_default_catalog_uses_openai_with_supabase_not_marketcheck(self) -> None:
        service = RecordingVehicleTrimCatalog()
        http_client = httpx.Client(
            transport=httpx.MockTransport(
                lambda _request: self.fail("trim lookup must use the injected service")
            )
        )
        self.addCleanup(http_client.close)
        gateway = SupabaseHttpGateway(
            SupabaseServerConfiguration(
                url="https://project.supabase.co",
                publishable_key="publishable-test-key",
                service_role_key="service-role-test-key",
            ),
            client=http_client,
        )
        with patch.dict(
            os.environ,
            {
                "OPENAI_API_KEY": "openai-trim-test-key",
                "MARKETCHECK_API_KEY": "marketcheck-appraisal-only-key",
            },
            clear=True,
        ), patch(
            "venfour.api.OpenAIVehicleTrimCatalog",
            return_value=service,
        ) as catalog_class:
            app = create_app(
                enable_legacy_api=False,
                supabase_gateway=gateway,
            )

        catalog_class.assert_called_once_with(
            gateway,
            api_key="openai-trim-test-key",
        )
        with TestClient(app) as client:
            response = client.get(
                "/api/v1/vehicle-trims?year=2020&make=Toyota&model=Camry"
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(service.requests), 1)

    def test_returns_exact_vehicle_trims_without_authentication(self) -> None:
        service = RecordingVehicleTrimCatalog()
        app = create_app(
            enable_legacy_api=False,
            vehicle_trim_catalog_service=service,
        )

        with TestClient(app) as client:
            response = client.get(
                "/api/v1/vehicle-trims",
                params={
                    "year": "2020",
                    "make": " Toyota ",
                    "model": " Camry ",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"trims": [option.to_dict() for option in DEFAULT_TRIM_OPTIONS]},
        )
        self.assertEqual(
            response.json()["trims"][0],
            {
                "source": "marketcheck",
                "id": "marketcheck-trim-le",
                "label": "LE",
                "trim": "LE",
                "queryField": "trim",
                "queryValues": ["LE"],
            },
        )
        self.assertEqual(response.headers["cache-control"], "private, no-store")
        self.assertEqual(
            service.requests,
            [VehicleTrimCatalogRequest(2020, "Toyota", "Camry")],
        )

    def test_rejects_missing_duplicate_unknown_and_invalid_parameters(self) -> None:
        service = RecordingVehicleTrimCatalog()
        app = create_app(
            enable_legacy_api=False,
            vehicle_trim_catalog_service=service,
        )
        invalid_queries = (
            "year=2020&make=Toyota",
            "year=2020&make=Toyota&model=Camry&extra=value",
            "year=2020&year=2021&make=Toyota&model=Camry",
            "year=20x0&make=Toyota&model=Camry",
            "year=1980&make=Toyota&model=Camry",
            "year=2020&make=Toyota%2CHonda&model=Camry",
            "year=2020&make=Toyota&model=%0ACamry",
        )

        with TestClient(app) as client:
            for query in invalid_queries:
                with self.subTest(query=query):
                    response = client.get(f"/api/v1/vehicle-trims?{query}")
                    self.assertEqual(response.status_code, 400)
                    self.assertEqual(
                        response.json()["error"]["code"],
                        "INVALID_VEHICLE_TRIM_REQUEST",
                    )

        self.assertEqual(service.requests, [])

    def test_maps_missing_or_failed_catalog_to_a_neutral_retryable_error(self) -> None:
        private_detail = "synthetic private provider detail"
        failing = RecordingVehicleTrimCatalog(error=RuntimeError(private_detail))
        query = "/api/v1/vehicle-trims?year=2020&make=Toyota&model=Camry"

        with patch.dict(os.environ, {}, clear=True):
            apps = (
                create_app(enable_legacy_api=False),
                create_app(
                    enable_legacy_api=False,
                    vehicle_trim_catalog_service=failing,
                ),
            )
        for app in apps:
            with TestClient(app) as client:
                response = client.get(query)
            self.assertEqual(response.status_code, 503)
            self.assertEqual(
                response.json()["error"]["code"],
                "VEHICLE_TRIM_LOOKUP_UNAVAILABLE",
            )
            self.assertNotIn(private_detail, response.text)

    def test_rejects_an_invalid_catalog_response(self) -> None:
        service = RecordingVehicleTrimCatalog()
        service.trims = ("XLE",)  # type: ignore[assignment]
        app = create_app(
            enable_legacy_api=False,
            vehicle_trim_catalog_service=service,
        )

        with TestClient(app) as client:
            response = client.get(
                "/api/v1/vehicle-trims?year=2020&make=Toyota&model=Camry"
            )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.json()["error"]["code"],
            "VEHICLE_TRIM_LOOKUP_UNAVAILABLE",
        )

    def test_rejects_an_invalid_injected_catalog_dependency(self) -> None:
        with self.assertRaisesRegex(TypeError, "must expose list_trims"):
            create_app(
                enable_legacy_api=False,
                vehicle_trim_catalog_service=object(),
            )


if __name__ == "__main__":
    unittest.main()
