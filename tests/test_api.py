"""Offline HTTP contract coverage for the Phase 3F read-only API.

All reports, vehicles, identifiers, providers, credentials, and prices are
fictional test data. Golden responses are produced from the existing synthetic
Phase 3D.2 orchestration fixtures through the real Phase 3E service.
"""

from __future__ import annotations

import json
import os
import socket
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

import httpx
from starlette.testclient import TestClient

from tests.test_analysis_runs import (
    CONFLICTING_PRICES,
    CONSISTENT_PRICES,
    MATERIAL_PRICES,
    POTENTIAL_PRICES,
    RUN_ID_1,
    RUN_ID_2,
    TemporaryRepositoryTestCase,
    write_artifact,
)
from venfour.analysis_runs import InvalidAnalysisRunArtifactError
from venfour.api import create_app
from venfour.discrepancy import (
    CONFLICTING_EVIDENCE,
    INSUFFICIENT_EVIDENCE,
    MATERIAL_UNDERVALUE_SIGNAL,
    NO_MATERIAL_DISCREPANCY,
    POTENTIAL_UNDERVALUE,
)
from venfour.presentation import (
    AnalysisPresentationService,
    validate_analysis_presentation,
)
from venfour.supabase_gateway import (
    SupabaseHttpGateway,
    SupabaseServerConfiguration,
)


FIXTURE_PATH = (
    Path(__file__).parent
    / "fixtures"
    / "analysis"
    / "analysis-presentation-material-undervalue.json"
)

INVALID_RUN_ID_ERROR = {
    "error": {
        "code": "INVALID_RUN_ID",
        "message": "Analysis run ID is invalid.",
    }
}
ANALYSIS_NOT_FOUND_ERROR = {
    "error": {
        "code": "ANALYSIS_NOT_FOUND",
        "message": "Analysis run was not found.",
    }
}
ANALYSIS_UNAVAILABLE_ERROR = {
    "error": {
        "code": "ANALYSIS_UNAVAILABLE",
        "message": "Analysis run is unavailable.",
    }
}
INTERNAL_ERROR = {
    "error": {
        "code": "INTERNAL_ERROR",
        "message": "An internal server error occurred.",
    }
}
ROUTE_NOT_FOUND_ERROR = {
    "error": {
        "code": "ROUTE_NOT_FOUND",
        "message": "Route was not found.",
    }
}
METHOD_NOT_ALLOWED_ERROR = {
    "error": {
        "code": "METHOD_NOT_ALLOWED",
        "message": "Method is not allowed.",
    }
}

RUNTIME_ENVIRONMENT = {
    "SUPABASE_URL": "https://runtime-test.supabase.co",
    "SUPABASE_PUBLISHABLE_KEY": "publishable-runtime-test-key",
    "SUPABASE_SERVICE_ROLE_KEY": "service-role-runtime-test-key",
    "OPENAI_API_KEY": "openai-runtime-test-key",
    "MARKETCHECK_API_KEY": "marketcheck-runtime-test-key",
}


class RecordingPresentationService:
    """Minimal injected service double that records every requested run ID."""

    def __init__(
        self,
        presentation: Any | None = None,
        *,
        error: Exception | None = None,
    ) -> None:
        self.presentation = presentation
        self.error = error
        self.run_ids: list[str] = []

    def get(self, run_id: str) -> Any:
        self.run_ids.append(run_id)
        if self.error is not None:
            raise self.error
        if self.presentation is None:
            raise AssertionError("presentation service must not be called")
        return self.presentation


class InjectedCaseAnalysisService:
    """Complete injected customer-path dependency used only by probe tests."""

    def authenticate(self, _token: str) -> str:
        raise AssertionError("readiness must not authenticate")

    def submit(self, _case_id: str, _user_id: str) -> None:
        raise AssertionError("readiness must not submit an analysis")

    def status(self, _case_id: str, _user_id: str) -> None:
        raise AssertionError("readiness must not read analysis status")

    def get_presentation(self, _run_id: str, _user_id: str) -> None:
        raise AssertionError("readiness must not retrieve an analysis")


class RuntimeProbeApiTests(unittest.TestCase):
    @staticmethod
    def probe(environment: dict[str, str]) -> tuple[Any, Any]:
        with patch.dict(os.environ, environment, clear=True):
            with TestClient(create_app(enable_legacy_api=False)) as client:
                return client.get("/health"), client.get("/ready")

    def test_liveness_is_process_only_when_runtime_configuration_is_missing(
        self,
    ) -> None:
        health, readiness = self.probe({})

        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json(), {"status": "ok"})
        self.assertEqual(readiness.status_code, 503)
        self.assertEqual(readiness.json(), {"status": "not_ready"})
        self.assertEqual(readiness.headers["cache-control"], "no-store")

    def test_readiness_requires_every_customer_path_credential(self) -> None:
        for missing_name in RUNTIME_ENVIRONMENT:
            with self.subTest(missing=missing_name):
                environment = dict(RUNTIME_ENVIRONMENT)
                del environment[missing_name]

                health, readiness = self.probe(environment)

                self.assertEqual(health.status_code, 200)
                self.assertEqual(readiness.status_code, 503)
                self.assertEqual(
                    readiness.json(), {"status": "not_ready"}
                )

    def test_readiness_rejects_malformed_runtime_configuration(self) -> None:
        malformed_overrides = (
            {"SUPABASE_URL": "http://runtime-test.supabase.co"},
            {"SUPABASE_URL": "https://runtime-test.supabase.co/rest/v1"},
            {"SUPABASE_URL": "https://user:secret@runtime-test.supabase.co"},
            {"SUPABASE_URL": "https://:443"},
            {"SUPABASE_URL": "https://runtime-test.supabase.co:notaport"},
            {"SUPABASE_URL": "https://runtime test.supabase.co"},
            {"SUPABASE_PUBLISHABLE_KEY": "publishable key"},
            {"SUPABASE_PUBLISHABLE_KEY": " publishable-key"},
            {"SUPABASE_SERVICE_ROLE_KEY": "service\nrole"},
            {
                "SUPABASE_SERVICE_ROLE_KEY": RUNTIME_ENVIRONMENT[
                    "SUPABASE_PUBLISHABLE_KEY"
                ]
            },
            {"OPENAI_API_KEY": "openai key"},
            {"OPENAI_API_KEY": "openai-key\n"},
            {"MARKETCHECK_API_KEY": "marketcheck\tkey"},
            {"MARKETCHECK_API_KEY": " marketcheck-key"},
        )
        for overrides in malformed_overrides:
            with self.subTest(names=tuple(overrides)):
                environment = {**RUNTIME_ENVIRONMENT, **overrides}

                _health, readiness = self.probe(environment)

                self.assertEqual(readiness.status_code, 503)
                self.assertEqual(
                    readiness.json(), {"status": "not_ready"}
                )
                for secret in environment.values():
                    self.assertNotIn(secret, readiness.text)

    def test_valid_readiness_is_configuration_only_and_legacy_stays_disabled(
        self,
    ) -> None:
        with patch.dict(os.environ, RUNTIME_ENVIRONMENT, clear=True):
            app = create_app()
        with patch.object(
            SupabaseHttpGateway,
            "authenticate",
            side_effect=AssertionError("readiness must not call Supabase"),
        ) as authenticate:
            with TestClient(app) as client:
                readiness = client.get("/ready")

        self.assertEqual(readiness.status_code, 200)
        self.assertEqual(readiness.json(), {"status": "ready"})
        self.assertEqual(readiness.headers["cache-control"], "no-store")
        self.assertFalse(app.state.legacy_api_enabled)
        authenticate.assert_not_called()
        for secret in RUNTIME_ENVIRONMENT.values():
            self.assertNotIn(secret, readiness.text)

    def test_injected_customer_service_is_ready_without_environment_secrets(
        self,
    ) -> None:
        with patch.dict(os.environ, {}, clear=True):
            app = create_app(
                case_analysis_service=InjectedCaseAnalysisService(),
                enable_legacy_api=False,
            )
        with TestClient(app) as client:
            readiness = client.get("/ready")

        self.assertEqual(readiness.status_code, 200)
        self.assertEqual(readiness.json(), {"status": "ready"})

    def test_readiness_tracks_lifespan_and_owned_http_client_is_closed(
        self,
    ) -> None:
        closed: list[SupabaseHttpGateway] = []
        original_close = SupabaseHttpGateway.close

        def record_close(gateway: SupabaseHttpGateway) -> None:
            closed.append(gateway)
            original_close(gateway)

        with patch.dict(os.environ, RUNTIME_ENVIRONMENT, clear=True):
            with patch.object(SupabaseHttpGateway, "close", new=record_close):
                app = create_app(enable_legacy_api=False)
                self.assertFalse(app.state.accepting_customer_requests)
                with TestClient(app) as client:
                    self.assertTrue(app.state.accepting_customer_requests)
                    self.assertEqual(client.get("/ready").status_code, 200)
                self.assertFalse(app.state.accepting_customer_requests)

        self.assertEqual(len(closed), 1)
        self.assertTrue(closed[0]._client.is_closed)

    def test_shutdown_does_not_close_an_injected_gateway_client(self) -> None:
        client = httpx.Client(transport=httpx.MockTransport(lambda _request: None))
        self.addCleanup(client.close)
        gateway = SupabaseHttpGateway(
            SupabaseServerConfiguration(
                url=RUNTIME_ENVIRONMENT["SUPABASE_URL"],
                publishable_key=RUNTIME_ENVIRONMENT[
                    "SUPABASE_PUBLISHABLE_KEY"
                ],
                service_role_key=RUNTIME_ENVIRONMENT[
                    "SUPABASE_SERVICE_ROLE_KEY"
                ],
            ),
            client=client,
        )
        with patch.dict(os.environ, RUNTIME_ENVIRONMENT, clear=True):
            app = create_app(
                supabase_gateway=gateway,
                enable_legacy_api=False,
            )
            with TestClient(app) as test_client:
                self.assertEqual(test_client.get("/ready").status_code, 200)

        self.assertFalse(client.is_closed)


class AnalysisPresentationApiTests(TemporaryRepositoryTestCase):
    def assert_json_response(
        self,
        response: Any,
        status_code: int,
        expected: Any,
    ) -> None:
        self.assertEqual(response.status_code, status_code)
        self.assertEqual(response.headers["content-type"], "application/json")
        self.assertEqual(response.json(), expected)

    def test_health_is_exact_json_and_does_not_call_the_service(self) -> None:
        service = RecordingPresentationService()

        with TestClient(create_app(presentation_service=service)) as client:
            response = client.get("/health")

        self.assert_json_response(response, 200, {"status": "ok"})
        self.assertEqual(service.run_ids, [])

    def test_golden_get_returns_the_complete_raw_phase_3e_contract(self) -> None:
        repository, _, _, artifact = self.run_saved(
            child="golden",
            historical_prices=MATERIAL_PRICES,
            current_prices=CONSISTENT_PRICES,
        )
        expected = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        validate_analysis_presentation(expected)
        self.assertEqual(expected["runId"], artifact.run_id)
        self.assertEqual(
            expected["assessment"]["classification"],
            MATERIAL_UNDERVALUE_SIGNAL,
        )

        with TestClient(
            create_app(
                presentation_service=AnalysisPresentationService(repository)
            )
        ) as client:
            response = client.get(f"/api/v1/analyses/{artifact.run_id}")

        self.assert_json_response(response, 200, expected)
        self.assertEqual(list(response.json()), list(expected))
        self.assertNotIn("data", response.json())

    def test_every_phase_3d_classification_serializes_through_http(self) -> None:
        cases = (
            ("insufficient", (), INSUFFICIENT_EVIDENCE, False),
            ("no-material", CONSISTENT_PRICES, NO_MATERIAL_DISCREPANCY, True),
            ("potential", POTENTIAL_PRICES, POTENTIAL_UNDERVALUE, True),
            ("material", MATERIAL_PRICES, MATERIAL_UNDERVALUE_SIGNAL, True),
            ("conflicting", CONFLICTING_PRICES, CONFLICTING_EVIDENCE, True),
        )
        for index, (label, prices, expected, historical) in enumerate(
            cases, start=60
        ):
            run_id = f"00000000-0000-4000-8000-{index:012d}"
            with self.subTest(classification=expected):
                repository, _, _, _ = self.run_saved(
                    child=label,
                    run_id=run_id,
                    current=False,
                    historical=historical,
                    historical_prices=prices,
                )
                with TestClient(
                    create_app(
                        presentation_service=AnalysisPresentationService(repository)
                    )
                ) as client:
                    response = client.get(f"/api/v1/analyses/{run_id}")

                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    response.headers["content-type"], "application/json"
                )
                payload = response.json()
                validate_analysis_presentation(payload)
                self.assertEqual(payload["assessment"]["classification"], expected)

    def test_unknown_valid_uuid_returns_the_exact_not_found_error(self) -> None:
        repository = self.repository("missing")

        with TestClient(
            create_app(
                presentation_service=AnalysisPresentationService(repository)
            )
        ) as client:
            response = client.get(f"/api/v1/analyses/{RUN_ID_2}")

        self.assert_json_response(response, 404, ANALYSIS_NOT_FOUND_ERROR)

    def test_repository_and_repository_root_can_be_wired_by_the_factory(
        self,
    ) -> None:
        repository, _, _, artifact = self.run_saved(child="factory-wiring")

        for app in (
            create_app(repository=repository),
            create_app(repository_root=repository.root),
        ):
            with self.subTest(service=type(app.state.presentation_service).__name__):
                with TestClient(app) as client:
                    response = client.get(
                        f"/api/v1/analyses/{artifact.run_id}"
                    )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["runId"], artifact.run_id)

    def test_malformed_uuid_is_rejected_before_service_lookup(self) -> None:
        service = RecordingPresentationService()
        malformed_ids = (
            "not-a-uuid",
            "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
            "00000000-0000-5000-8000-000000000001",
        )

        with TestClient(create_app(presentation_service=service)) as client:
            for run_id in malformed_ids:
                with self.subTest(run_id=run_id):
                    response = client.get(f"/api/v1/analyses/{run_id}")
                    self.assert_json_response(
                        response, 400, INVALID_RUN_ID_ERROR
                    )

        self.assertEqual(service.run_ids, [])

    def test_path_traversal_never_reaches_the_service_or_storage(self) -> None:
        sentinel_value = "synthetic-storage-sentinel"
        sentinel_path = self.root / "secret"
        sentinel_path.write_text(sentinel_value, encoding="utf-8")
        service = RecordingPresentationService()
        attempts = (
            "/api/v1/analyses/../../secret",
            "/api/v1/analyses/../",
            "/api/v1/analyses/%2e%2e/",
            "/api/v1/analyses/%2e%2e%2fsecret",
            "/api/v1/analyses/..%2f..%2fsecret",
        )

        with TestClient(create_app(presentation_service=service)) as client:
            for target in attempts:
                with self.subTest(target=target):
                    response = client.get(target, follow_redirects=False)
                    self.assertIn(response.status_code, (400, 404))
                    expected = (
                        INVALID_RUN_ID_ERROR
                        if response.status_code == 400
                        else ROUTE_NOT_FOUND_ERROR
                    )
                    self.assert_json_response(response, response.status_code, expected)
                    self.assertNotIn(sentinel_value, response.text)

        self.assertEqual(service.run_ids, [])
        self.assertEqual(sentinel_path.read_text(encoding="utf-8"), sentinel_value)

    def test_tampered_artifact_maps_to_a_neutral_server_error(self) -> None:
        repository, _, _, artifact = self.run_saved(child="tampered")
        artifact_path = repository.root / f"{artifact.run_id}.json"
        tampered = artifact.to_dict()
        tampered_digest = "0" * 64
        tampered["requestDigest"] = tampered_digest
        write_artifact(artifact_path, tampered)

        with TestClient(
            create_app(
                presentation_service=AnalysisPresentationService(repository)
            )
        ) as client:
            response = client.get(f"/api/v1/analyses/{artifact.run_id}")

        self.assert_json_response(response, 500, ANALYSIS_UNAVAILABLE_ERROR)
        self.assertNotIn(str(repository.root), response.text)
        self.assertNotIn(tampered_digest, response.text)

    def test_unexpected_failure_maps_to_a_neutral_internal_error(self) -> None:
        internal_detail = "synthetic-private-internal-detail"
        service = RecordingPresentationService(error=RuntimeError(internal_detail))

        with TestClient(create_app(presentation_service=service)) as client:
            response = client.get(f"/api/v1/analyses/{RUN_ID_1}")

        self.assert_json_response(response, 500, INTERNAL_ERROR)
        self.assertNotIn(internal_detail, response.text)

    def test_unknown_route_returns_json(self) -> None:
        service = RecordingPresentationService()

        with TestClient(create_app(presentation_service=service)) as client:
            response = client.get("/api/v1/unknown")

        self.assert_json_response(response, 404, ROUTE_NOT_FOUND_ERROR)
        self.assertEqual(service.run_ids, [])

    def test_repeated_gets_are_byte_deterministic(self) -> None:
        repository, _, _, artifact = self.run_saved(child="determinism")

        with TestClient(
            create_app(
                presentation_service=AnalysisPresentationService(repository)
            )
        ) as client:
            first = client.get(f"/api/v1/analyses/{artifact.run_id}")
            second = client.get(f"/api/v1/analyses/{artifact.run_id}")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.content, second.content)
        self.assertEqual(first.json(), second.json())

    def test_post_is_json_405_and_cannot_mutate_the_repository(self) -> None:
        repository, _, _, artifact = self.run_saved(child="read-only")
        before = {
            path.name: path.read_bytes()
            for path in repository.root.iterdir()
            if path.is_file()
        }

        with TestClient(
            create_app(
                presentation_service=AnalysisPresentationService(repository)
            )
        ) as client:
            response = client.post(
                f"/api/v1/analyses/{artifact.run_id}",
                json={"attemptedMutation": True},
            )

        after = {
            path.name: path.read_bytes()
            for path in repository.root.iterdir()
            if path.is_file()
        }
        self.assert_json_response(response, 405, METHOD_NOT_ALLOWED_ERROR)
        self.assertEqual(after, before)

    def test_cors_is_not_enabled_by_default(self) -> None:
        service = RecordingPresentationService()
        origin = "https://frontend.invalid"

        with TestClient(create_app(presentation_service=service)) as client:
            health = client.get("/health", headers={"Origin": origin})
            preflight = client.options(
                f"/api/v1/analyses/{RUN_ID_1}",
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "GET",
                },
            )

        for response in (health, preflight):
            self.assertNotIn("access-control-allow-origin", response.headers)
        self.assertEqual(service.run_ids, [])

    def test_configured_secrets_are_absent_from_success_and_error_payloads(
        self,
    ) -> None:
        market_secret = "synthetic-marketcheck-secret-for-api-test"
        model_secret = "synthetic-model-secret-for-api-test"
        repository, _, _, artifact = self.run_saved(child="secret-success")
        failing_service = RecordingPresentationService(
            error=InvalidAnalysisRunArtifactError(
                f"internal failure containing {market_secret}",
                (f"internal detail containing {model_secret}",),
            )
        )

        with patch.dict(
            os.environ,
            {
                "MARKETCHECK_API_KEY": market_secret,
                "OPENAI_API_KEY": model_secret,
            },
            clear=False,
        ):
            with TestClient(
                create_app(
                    presentation_service=AnalysisPresentationService(repository)
                )
            ) as client:
                success = client.get(f"/api/v1/analyses/{artifact.run_id}")
            with TestClient(
                create_app(presentation_service=failing_service)
            ) as client:
                failure = client.get(f"/api/v1/analyses/{RUN_ID_2}")

        self.assertEqual(success.status_code, 200)
        self.assert_json_response(failure, 500, ANALYSIS_UNAVAILABLE_ERROR)
        for response in (success, failure):
            self.assertNotIn(market_secret, response.text)
            self.assertNotIn(model_secret, response.text)
            self.assertNotIn("MARKETCHECK_API_KEY", response.text)
            self.assertNotIn("OPENAI_API_KEY", response.text)

    def test_get_does_not_reinvoke_providers_or_open_a_network_connection(
        self,
    ) -> None:
        repository, current, historical, artifact = self.run_saved(
            child="no-provider-calls"
        )
        self.assertIsNotNone(current)
        self.assertIsNotNone(historical)
        provider_calls = (len(current.requests), len(historical.requests))

        with patch.object(
            socket,
            "create_connection",
            side_effect=AssertionError("network access attempted"),
        ):
            with TestClient(
                create_app(
                    presentation_service=AnalysisPresentationService(repository)
                )
            ) as client:
                response = client.get(f"/api/v1/analyses/{artifact.run_id}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            (len(current.requests), len(historical.requests)), provider_calls
        )

    def test_integer_money_and_basis_point_values_remain_integers(self) -> None:
        repository, _, _, artifact = self.run_saved(
            child="integer-contract",
            historical_prices=MATERIAL_PRICES,
            current_prices=CONSISTENT_PRICES,
        )

        with TestClient(
            create_app(
                presentation_service=AnalysisPresentationService(repository)
            )
        ) as client:
            response = client.get(f"/api/v1/analyses/{artifact.run_id}")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        ccc_value = payload["cccValuation"]["adjustedVehicleValue"]["cents"]
        primary = payload["cccValuation"]["comparisonToPrimaryEvidence"]
        external_median = primary["firstValue"]["cents"]
        difference_basis_points = primary["differencePercent"]["basisPoints"]
        self.assertEqual(ccc_value, 2_000_000)
        self.assertEqual(external_median, 2_220_000)
        self.assertEqual(difference_basis_points, 1_100)
        self.assertIs(type(ccc_value), int)
        self.assertIs(type(external_median), int)
        self.assertIs(type(difference_basis_points), int)


if __name__ == "__main__":
    unittest.main()
