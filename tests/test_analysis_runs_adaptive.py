"""Focused integrity tests for adaptive-search analysis-run artifacts."""

from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path

from venfour.adaptive_search import (
    CURRENT_SEARCH_CEILING_REACHED,
    DEFAULT_ADAPTIVE_SEARCH_POLICY,
    MAX_SCOPE_REACHED,
    AdaptiveSearchPolicies,
)
from venfour.analysis_runs import (
    AnalysisRunContractError,
    FileAnalysisRunRepository,
    search_diagnostics_digest,
    validate_analysis_run_artifact,
)
from venfour.orchestration import (
    AnalysisRunRequest,
    CurrentMarketSearchConfiguration,
    HistoricalMarketSearchConfiguration,
)

from tests.test_analysis_runs import (
    CURRENT_OBSERVED_DATE,
    POSTAL_CODE,
    RecordingCurrentProvider,
    RecordingHistoricalProvider,
    make_orchestrator,
    make_report,
)


class AdaptiveAnalysisRunIntegrityTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.root = Path(temporary_directory.name)
        repository = FileAnalysisRunRepository(self.root / "runs")
        request = AnalysisRunRequest(
            ccc_report=make_report(),
            postal_code=POSTAL_CODE,
            current_search=CurrentMarketSearchConfiguration(CURRENT_OBSERVED_DATE),
            historical_search=HistoricalMarketSearchConfiguration(),
        )
        self.artifact = make_orchestrator(
            repository,
            current_provider=RecordingCurrentProvider(),
            historical_provider=RecordingHistoricalProvider(),
        ).run(request).artifact.to_dict()

    def assert_semantic_error_contains(
        self, artifact: dict[str, object], expected: str
    ) -> None:
        with self.assertRaises(AnalysisRunContractError) as context:
            validate_analysis_run_artifact(artifact)
        self.assertTrue(
            any(expected in detail for detail in context.exception.details),
            context.exception.details,
        )

    def test_v4_diagnostics_replay_and_v1_v2_v3_remain_readable(self) -> None:
        validate_analysis_run_artifact(self.artifact)

        v4_artifact = copy.deepcopy(self.artifact)
        v4_artifact["analysisRunSchemaVersion"] = "4"
        v4_artifact["analysisVersion"] = "4"
        del v4_artifact["evidenceContext"]
        validate_analysis_run_artifact(v4_artifact)

        v3_artifact = copy.deepcopy(v4_artifact)
        v3_artifact["analysisRunSchemaVersion"] = "3"
        v3_artifact["analysisVersion"] = "3"
        del v3_artifact["request"]["configuredSearchPolicies"]
        v3_artifact["searchDiagnosticsDigest"] = search_diagnostics_digest(
            v3_artifact["request"]["searchPolicies"],
            v3_artifact["result"]["searchDiagnostics"],
            policy_field="searchPolicies",
        )
        validate_analysis_run_artifact(v3_artifact)

        v1_artifact = copy.deepcopy(v4_artifact)
        v1_artifact["analysisRunSchemaVersion"] = "1"
        v1_artifact["analysisVersion"] = "1"
        del v1_artifact["searchDiagnosticsDigest"]
        del v1_artifact["request"]["configuredSearchPolicies"]
        del v1_artifact["request"]["searchPolicies"]
        del v1_artifact["result"]["searchDiagnostics"]
        validate_analysis_run_artifact(v1_artifact)

        legacy_repository = FileAnalysisRunRepository(self.root / "legacy-v2-runs")
        legacy_policy = DEFAULT_ADAPTIVE_SEARCH_POLICY
        legacy_request = AnalysisRunRequest(
            ccc_report=make_report(),
            postal_code=POSTAL_CODE,
            current_search=CurrentMarketSearchConfiguration(CURRENT_OBSERVED_DATE),
            historical_search=HistoricalMarketSearchConfiguration(),
            search_policies=AdaptiveSearchPolicies(
                current=legacy_policy,
                historical=legacy_policy,
            ),
        )
        v2_artifact = make_orchestrator(
            legacy_repository,
            current_provider=RecordingCurrentProvider(),
            historical_provider=RecordingHistoricalProvider(),
        ).run(legacy_request).artifact.to_dict()
        v2_artifact["analysisRunSchemaVersion"] = "2"
        v2_artifact["analysisVersion"] = "2"
        del v2_artifact["evidenceContext"]
        policies = v2_artifact["request"].pop("searchPolicies")
        del v2_artifact["request"]["configuredSearchPolicies"]
        v2_artifact["request"]["searchPolicy"] = policies["current"]
        v2_artifact["result"]["searchDiagnostics"]["historical"][
            "stopReason"
        ] = MAX_SCOPE_REACHED
        v2_artifact["searchDiagnosticsDigest"] = search_diagnostics_digest(
            v2_artifact["request"]["searchPolicy"],
            v2_artifact["result"]["searchDiagnostics"],
        )
        validate_analysis_run_artifact(v2_artifact)

    def test_replay_rejects_count_stop_reason_and_policy_tampering(self) -> None:
        count_tamper = copy.deepcopy(self.artifact)
        count_tamper["result"]["searchDiagnostics"]["current"]["attempts"][0][
            "returnedCount"
        ] += 1
        self.assert_semantic_error_contains(count_tamper, "counts do not match")

        stop_tamper = copy.deepcopy(self.artifact)
        stop_tamper["result"]["searchDiagnostics"]["current"]["stopReason"] = (
            "MAX_UNIQUE_CANDIDATES"
        )
        self.assert_semantic_error_contains(
            stop_tamper, "does not match deterministic replay"
        )

        policy_tamper = copy.deepcopy(self.artifact)
        policy_tamper["request"]["searchPolicies"]["current"][
            "minimumStrongMatches"
        ] = 5
        self.assert_semantic_error_contains(policy_tamper, "continued after a stop")

    def test_current_ceiling_reason_is_derived_from_bound_policy_provenance(
        self,
    ) -> None:
        stop_tamper = copy.deepcopy(self.artifact)
        stop_tamper["result"]["searchDiagnostics"]["current"]["stopReason"] = (
            CURRENT_SEARCH_CEILING_REACHED
        )
        stop_tamper["searchDiagnosticsDigest"] = search_diagnostics_digest(
            stop_tamper["request"]["searchPolicies"],
            stop_tamper["result"]["searchDiagnostics"],
            policy_field="searchPolicies",
            configured_policy=stop_tamper["request"]["configuredSearchPolicies"],
        )
        self.assert_semantic_error_contains(
            stop_tamper, "does not match deterministic replay"
        )

        configured_tamper = copy.deepcopy(self.artifact)
        configured_tamper["request"]["configuredSearchPolicies"]["current"][
            "minimumStrongMatches"
        ] = 8
        configured_tamper["searchDiagnosticsDigest"] = search_diagnostics_digest(
            configured_tamper["request"]["searchPolicies"],
            configured_tamper["result"]["searchDiagnostics"],
            policy_field="searchPolicies",
            configured_policy=configured_tamper["request"][
                "configuredSearchPolicies"
            ],
        )
        self.assert_semantic_error_contains(
            configured_tamper,
            "must be the configured policy constrained only by the provider radius",
        )

    def test_configured_stream_requires_diagnostics(self) -> None:
        tampered = copy.deepcopy(self.artifact)
        tampered["result"]["searchDiagnostics"]["historical"] = None
        self.assert_semantic_error_contains(
            tampered, "configured historical retrieval requires replay diagnostics"
        )

    def test_unconfigured_stream_requires_null_diagnostics(self) -> None:
        repository = FileAnalysisRunRepository(self.root / "current-only-runs")
        request = AnalysisRunRequest(
            ccc_report=make_report(),
            postal_code=POSTAL_CODE,
            current_search=CurrentMarketSearchConfiguration(CURRENT_OBSERVED_DATE),
        )
        artifact = make_orchestrator(
            repository,
            current_provider=RecordingCurrentProvider(),
            historical_provider=None,
        ).run(request).artifact.to_dict()
        validate_analysis_run_artifact(artifact)
        self.assertIsNone(artifact["result"]["searchDiagnostics"]["historical"])

        artifact["result"]["searchDiagnostics"]["historical"] = copy.deepcopy(
            self.artifact["result"]["searchDiagnostics"]["historical"]
        )
        self.assert_semantic_error_contains(
            artifact, "must be null when historical retrieval is not configured"
        )

    def test_aggregate_result_must_match_diagnostic_replay(self) -> None:
        tampered = copy.deepcopy(self.artifact)
        tampered["result"]["currentMarketResult"]["listings"].reverse()
        self.assert_semantic_error_contains(
            tampered, "does not match replay of the stored current search diagnostics"
        )

    def test_digest_binds_duplicate_attempt_details_not_used_by_aggregate(self) -> None:
        tampered = copy.deepcopy(self.artifact)
        later_duplicate = tampered["result"]["searchDiagnostics"]["current"][
            "attempts"
        ][1]["result"]["listings"][0]
        later_duplicate["price"] += 1

        self.assert_semantic_error_contains(
            tampered, "searchDiagnosticsDigest"
        )


if __name__ == "__main__":
    unittest.main()
