"""Provider facts are reused without sharing customer case data."""

import copy
import hashlib
import json
import unittest
from unittest.mock import Mock

import httpx

from venfour.market_fact_cache import CachedDrivetrainLookup, MemoryMarketFactCache, market_fact_cache_key, saved_drivetrain_lookup
from venfour.marketcheck import drivetrain_lookup_failure, validate_drivetrain_lookup_result
from venfour.supabase_gateway import SupabaseContractError, SupabaseHttpGateway, SupabaseServerConfiguration

VIN = "KM8HACABXTU436557"
VEHICLE = {"year": 2026, "make": "Hyundai", "model": "Kona"}
TOKEN = "10000000-0000-4000-8000-000000000001"


def result_fixture(status="RESOLVED"):
    result = drivetrain_lookup_failure(VIN, **VEHICLE, reason_code="CONTROLLED_PROVIDER_RESULT", retrieved_at="2026-09-05T12:00:00Z")
    result.update(status=status, providerRequestCount=1)
    if status == "RESOLVED":
        result["drivetrain"] = "4WD"
        result["evidence"] = [{"listingId": "controlled-listing", "vin": VIN, **VEHICLE,
                               "rawDrivetrain": "4WD", "drivetrain": "4WD",
                               "sourcePath": "$.listings[0].build.drivetrain", "endpointCategory": "active",
                               "retrievedAt": result["retrievedAt"]}]
        result["evidenceDigest"] = hashlib.sha256(json.dumps(result["evidence"], sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    return validate_drivetrain_lookup_result(result)


def rehash(result):
    result["evidenceDigest"] = hashlib.sha256(json.dumps(result["evidence"], sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    return validate_drivetrain_lookup_result(result)


def saved_fixture(drivetrain="FWD"):
    result = result_fixture()
    result.update(drivetrain=drivetrain, retrievedAt="2026-09-05T13:00:00Z",
                  lookupSource="SAVED_PROVIDER_EVIDENCE", providerRequestCount=0)
    result["evidence"][0].update(listingId="new-saved-listing", rawDrivetrain=drivetrain,
                                drivetrain=drivetrain, retrievedAt=result["retrievedAt"])
    return rehash(result)


def conflict_fixture():
    result = result_fixture()
    result.update(status="CONFLICT", drivetrain=None)
    result["evidence"].extend(saved_fixture()["evidence"])
    return rehash(result)


class MarketFactCacheTests(unittest.TestCase):
    def store(self, cache, result):
        key = market_fact_cache_key(VIN, **VEHICLE)
        self.assertEqual(cache.claim_market_fact_cache(key, TOKEN)["outcome"], "claimed")
        self.assertTrue(cache.complete_market_fact_cache(key, TOKEN, result))
        return key

    def test_success_unavailable_and_failure_are_reused_across_lookup_instances(self):
        for status in ("RESOLVED", "UNAVAILABLE", "FAILED"):
            with self.subTest(status=status):
                cache = MemoryMarketFactCache()
                provider = Mock(return_value=result_fixture(status))
                first = CachedDrivetrainLookup(provider, cache)(VIN, **VEHICLE)
                second = CachedDrivetrainLookup(provider, cache)(VIN, **VEHICLE)
                self.assertEqual(provider.call_count, 1)
                self.assertTrue(second["cacheHit"])
                self.assertEqual(second["providerRequestCount"], 0)
                self.assertEqual(first["evidenceDigest"], second["evidenceDigest"])
                self.assertEqual(first["retrievedAt"], second["retrievedAt"])

    def test_failure_expiry_allows_one_new_lookup(self):
        now = [0.0]
        cache = MemoryMarketFactCache(clock=lambda: now[0])
        provider = Mock(return_value=result_fixture("FAILED"))
        lookup = CachedDrivetrainLookup(provider, cache)
        lookup(VIN, **VEHICLE)
        now[0] = 299
        self.assertTrue(lookup(VIN, **VEHICLE)["cacheHit"])
        now[0] = 301
        self.assertFalse(lookup(VIN, **VEHICLE)["cacheHit"])
        self.assertEqual(provider.call_count, 2)

    def test_pending_claim_does_not_duplicate_provider_work(self):
        cache = MemoryMarketFactCache()
        key = market_fact_cache_key(VIN, **VEHICLE)
        cache.claim_market_fact_cache(key, TOKEN)
        provider = Mock()
        result = CachedDrivetrainLookup(provider, cache)(VIN, **VEHICLE)
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["reasonCode"], "PROVIDER_FACT_LOOKUP_ALREADY_IN_PROGRESS")
        provider.assert_not_called()

    def test_cache_failure_does_not_bypass_cost_controls(self):
        cache = Mock(spec=MemoryMarketFactCache)
        cache.claim_market_fact_cache.side_effect = RuntimeError("unavailable")
        provider = Mock()
        result = CachedDrivetrainLookup(provider, cache)(VIN, **VEHICLE)
        self.assertEqual(result["reasonCode"], "PROVIDER_FACT_CACHE_UNAVAILABLE")
        provider.assert_not_called()

    def test_saved_authoritative_fact_precedes_even_an_unavailable_cache(self):
        saved = result_fixture()
        saved.update(lookupSource="SAVED_PROVIDER_EVIDENCE", providerRequestCount=0)
        cache = Mock(spec=MemoryMarketFactCache)
        cache.claim_market_fact_cache.side_effect = RuntimeError("unavailable")
        provider = Mock()
        result = CachedDrivetrainLookup(provider, cache, saved_lookup=lambda *_args, **_kwargs: saved)(VIN, **VEHICLE)
        self.assertEqual(result, saved)
        cache.claim_market_fact_cache.assert_called_once()
        provider.assert_not_called()

    def test_saved_fact_cannot_erase_a_live_cached_conflict(self):
        cache = MemoryMarketFactCache()
        prior = conflict_fixture()
        self.store(cache, prior)
        provider = Mock()
        saved = saved_fixture("4WD")
        before = copy.deepcopy((prior, saved))
        result = CachedDrivetrainLookup(provider, cache, saved_lookup=lambda *_a, **_k: saved)(VIN, **VEHICLE)
        self.assertEqual(result["status"], "CONFLICT")
        self.assertIsNone(result["drivetrain"])
        self.assertTrue(all(row in result["evidence"] for row in prior["evidence"] + saved["evidence"]))
        self.assertEqual((prior, saved), before)
        self.assertEqual(result["providerRequestCount"], 0)
        self.assertTrue(result["cacheHit"])
        provider.assert_not_called()

    def test_new_conflict_is_retained_for_a_later_lookup_without_saved_facts(self):
        now = [0.0]
        cache = MemoryMarketFactCache(clock=lambda: now[0])
        prior, saved = result_fixture(), saved_fixture()
        key = self.store(cache, prior)
        provider = Mock()
        first = CachedDrivetrainLookup(provider, cache, saved_lookup=lambda *_a, **_k: saved)(VIN, **VEHICLE)
        second = CachedDrivetrainLookup(provider, cache)(VIN, **VEHICLE)
        self.assertEqual(first["status"], "CONFLICT")
        self.assertEqual(second, first)
        self.assertEqual(first["evidence"], prior["evidence"] + saved["evidence"])
        self.assertEqual(first["retrievedAt"], saved["retrievedAt"])
        self.assertEqual(first["providerRequestCount"], 0)
        now[0] = 86399
        self.assertEqual(cache.claim_market_fact_cache(key, "next")["outcome"], "ready")
        now[0] = 86401
        self.assertEqual(cache.claim_market_fact_cache(key, "next")["outcome"], "claimed")
        provider.assert_not_called()

    def test_cached_negative_result_cannot_erase_a_saved_explicit_fact(self):
        for status in ("FAILED", "UNAVAILABLE"):
            with self.subTest(status=status):
                cache = MemoryMarketFactCache()
                self.store(cache, result_fixture(status))
                saved = saved_fixture()
                provider = Mock()
                result = CachedDrivetrainLookup(provider, cache, saved_lookup=lambda *_a, **_k: saved)(VIN, **VEHICLE)
                self.assertEqual((result["status"], result["drivetrain"]), ("RESOLVED", "FWD"))
                self.assertEqual(result["evidence"], saved["evidence"])
                self.assertEqual(result["providerRequestCount"], 0)
                provider.assert_not_called()

    def test_expired_cached_conflict_does_not_override_fresh_saved_evidence(self):
        now = [0.0]
        cache = MemoryMarketFactCache(clock=lambda: now[0])
        self.store(cache, conflict_fixture())
        now[0] = 86401
        saved, provider = saved_fixture(), Mock()
        result = CachedDrivetrainLookup(provider, cache, saved_lookup=lambda *_a, **_k: saved)(VIN, **VEHICLE)
        later = CachedDrivetrainLookup(provider, cache)(VIN, **VEHICLE)
        self.assertEqual(result, saved)
        self.assertEqual(later["status"], "RESOLVED")
        self.assertEqual(later["evidence"], saved["evidence"])
        self.assertEqual(later["providerRequestCount"], 0)
        provider.assert_not_called()

    def test_pending_cache_claim_uses_saved_fact_without_stealing_claim(self):
        cache = MemoryMarketFactCache()
        key = market_fact_cache_key(VIN, **VEHICLE)
        cache.claim_market_fact_cache(key, TOKEN)
        saved, provider = saved_fixture(), Mock()
        result = CachedDrivetrainLookup(provider, cache, saved_lookup=lambda *_a, **_k: saved)(VIN, **VEHICLE)
        self.assertEqual(result, saved)
        self.assertEqual(cache.claim_market_fact_cache(key, TOKEN)["outcome"], "claimed")
        provider.assert_not_called()

    def test_unrelated_cached_identity_is_not_merged_with_saved_facts(self):
        other = result_fixture()
        other["vehicle"]["make"] = other["evidence"][0]["make"] = "Other"
        other = rehash(other)
        cache = Mock(spec=MemoryMarketFactCache)
        cache.claim_market_fact_cache.return_value = {"outcome": "ready", "result": other}
        saved, provider = saved_fixture(), Mock()
        result = CachedDrivetrainLookup(provider, cache, saved_lookup=lambda *_a, **_k: saved)(VIN, **VEHICLE)
        self.assertEqual(result, saved)
        cache.preserve_market_fact_cache_conflict.assert_not_called()
        provider.assert_not_called()

    def test_conflict_persistence_race_does_not_discard_observed_conflict(self):
        cache = Mock(spec=MemoryMarketFactCache)
        prior = result_fixture()
        cache.claim_market_fact_cache.return_value = {"outcome": "ready", "result": prior}
        cache.preserve_market_fact_cache_conflict.return_value = False
        saved, provider = saved_fixture(), Mock()
        result = CachedDrivetrainLookup(provider, cache, saved_lookup=lambda *_a, **_k: saved)(VIN, **VEHICLE)
        self.assertEqual(result["status"], "CONFLICT")
        cache.preserve_market_fact_cache_conflict.assert_called_once_with(market_fact_cache_key(VIN, **VEHICLE), prior["evidenceDigest"], result)
        self.assertEqual(result["providerRequestCount"], 0)
        provider.assert_not_called()

    def test_evidence_union_limit_fails_closed_without_external_lookup(self):
        prior = result_fixture()
        prior["evidence"] = [dict(prior["evidence"][0], listingId=f"old-{index}") for index in range(50)]
        prior = rehash(prior)
        cache = MemoryMarketFactCache()
        self.store(cache, prior)
        saved, provider = saved_fixture(), Mock()
        result = CachedDrivetrainLookup(provider, cache, saved_lookup=lambda *_a, **_k: saved)(VIN, **VEHICLE)
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["reasonCode"], "SAVED_PROVIDER_FACT_LIMIT_REACHED")
        self.assertIsNone(result["drivetrain"])
        self.assertEqual(result["providerRequestCount"], 0)
        provider.assert_not_called()

    def test_conflict_preservation_requires_digest_identity_and_prior_evidence(self):
        for mutation in ("digest", "identity", "evidence"):
            with self.subTest(mutation=mutation):
                cache = MemoryMarketFactCache()
                prior = result_fixture()
                key = self.store(cache, prior)
                conflict = conflict_fixture()
                conflict.update(providerRequestCount=0, lookupSource="SAVED_PROVIDER_EVIDENCE")
                expected = prior["evidenceDigest"]
                if mutation == "digest":
                    expected = "0" * 64
                elif mutation == "identity":
                    conflict["vin"] = "KM8HACAB7TU435365"
                    for row in conflict["evidence"]:
                        row["vin"] = conflict["vin"]
                else:
                    conflict["evidence"][0]["listingId"] = "replacement"
                conflict = rehash(conflict)
                self.assertFalse(cache.preserve_market_fact_cache_conflict(key, expected, conflict))
                self.assertEqual(cache.claim_market_fact_cache(key, "reader")["result"], prior)

    def test_conflict_preservation_cannot_replace_expired_or_pending_state(self):
        now = [0.0]
        cache = MemoryMarketFactCache(clock=lambda: now[0])
        prior = result_fixture()
        key = self.store(cache, prior)
        conflict = conflict_fixture()
        conflict.update(providerRequestCount=0, lookupSource="SAVED_PROVIDER_EVIDENCE")
        now[0] = 604801
        self.assertFalse(cache.preserve_market_fact_cache_conflict(key, prior["evidenceDigest"], conflict))
        cache.claim_market_fact_cache(key, "replacement")
        self.assertFalse(cache.preserve_market_fact_cache_conflict(key, prior["evidenceDigest"], conflict))
        with self.assertRaises(ValueError):
            cache.preserve_market_fact_cache_conflict(key, prior["evidenceDigest"], saved_fixture())
        conflict.update(lookupSource="ACTIVE_VIN_LOOKUP", providerRequestCount=1)
        with self.assertRaises(ValueError):
            cache.preserve_market_fact_cache_conflict(key, prior["evidenceDigest"], conflict)

    def test_both_saved_streams_are_checked_and_conflicts_remain_unresolved(self):
        first = result_fixture()
        first.update(lookupSource="SAVED_PROVIDER_EVIDENCE", providerRequestCount=0)
        second = copy.deepcopy(first)
        second["evidence"][0].update(rawDrivetrain="FWD", drivetrain="FWD", endpointCategory="recents")
        second["drivetrain"] = "FWD"
        second["evidenceDigest"] = hashlib.sha256(json.dumps(second["evidence"], sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        current = Mock(saved_drivetrain=Mock(return_value=first))
        historical = Mock(saved_drivetrain=Mock(return_value=second))
        result = saved_drivetrain_lookup(current, historical)(VIN, **VEHICLE)
        self.assertEqual(result["status"], "CONFLICT")
        self.assertIsNone(result["drivetrain"])
        self.assertEqual(result["providerRequestCount"], 0)
        current.saved_drivetrain.assert_called_once()
        historical.saved_drivetrain.assert_called_once()

    def test_cached_identity_conflict_does_not_apply_or_lookup_again(self):
        other = result_fixture()
        other["vehicle"]["make"] = "Other"
        other["evidence"][0]["make"] = "Other"
        other["evidenceDigest"] = hashlib.sha256(json.dumps(other["evidence"], sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        cache = Mock(spec=MemoryMarketFactCache)
        cache.claim_market_fact_cache.return_value = {"outcome": "ready", "result": other}
        provider = Mock()
        result = CachedDrivetrainLookup(provider, cache)(VIN, **VEHICLE)
        self.assertEqual(result["reasonCode"], "CACHED_PROVIDER_FACT_IDENTITY_CONFLICT")
        provider.assert_not_called()

    def test_expired_and_replaced_tokens_cannot_publish(self):
        now = [0.0]
        cache = MemoryMarketFactCache(clock=lambda: now[0])
        key = market_fact_cache_key(VIN, **VEHICLE)
        cache.claim_market_fact_cache(key, "first")
        now[0] = 91
        self.assertFalse(cache.complete_market_fact_cache(key, "first", result_fixture()))
        cache.claim_market_fact_cache(key, "second")
        self.assertFalse(cache.complete_market_fact_cache(key, "first", result_fixture()))
        self.assertTrue(cache.complete_market_fact_cache(key, "second", result_fixture()))

    def test_cache_key_uses_provider_version_vin_and_vehicle_identity(self):
        key = market_fact_cache_key(VIN, **VEHICLE)
        self.assertEqual(key, market_fact_cache_key(VIN.lower(), year=2026, make="HYUNDAI", model="Kona"))
        self.assertNotEqual(key, market_fact_cache_key(VIN, year=2025, make="Hyundai", model="Kona"))

    def test_gateway_uses_only_service_rpc_and_preserves_result(self):
        requests = []
        def respond(request):
            requests.append(request)
            return httpx.Response(200, json=[{"outcome": "claimed", "result": None}] if request.url.path.endswith("claim_market_fact_cache") else True)
        client = httpx.Client(transport=httpx.MockTransport(respond))
        self.addCleanup(client.close)
        gateway = SupabaseHttpGateway(SupabaseServerConfiguration(url="https://project.supabase.co", publishable_key="test-public", service_role_key="test-service"), client=client)
        key = market_fact_cache_key(VIN, **VEHICLE)
        self.assertEqual(gateway.claim_market_fact_cache(key, TOKEN)["outcome"], "claimed")
        source = result_fixture()
        before = copy.deepcopy(source)
        self.assertTrue(gateway.complete_market_fact_cache(key, TOKEN, source))
        self.assertEqual(json.loads(requests[-1].content)["requested_result"], source)
        self.assertEqual(source, before)
        self.assertTrue(all(request.headers["Authorization"] == "Bearer test-service" for request in requests))

    def test_gateway_preserves_conflicts_with_expected_digest_and_no_provider_count(self):
        requests = []
        def respond(request):
            requests.append(request)
            return httpx.Response(200, json=True)
        client = httpx.Client(transport=httpx.MockTransport(respond))
        self.addCleanup(client.close)
        gateway = SupabaseHttpGateway(SupabaseServerConfiguration(url="https://project.supabase.co", publishable_key="test-public", service_role_key="test-service"), client=client)
        key = market_fact_cache_key(VIN, **VEHICLE)
        prior = result_fixture()
        conflict = conflict_fixture()
        conflict.update(lookupSource="SAVED_PROVIDER_EVIDENCE", providerRequestCount=0)
        before = copy.deepcopy(conflict)
        self.assertTrue(gateway.preserve_market_fact_cache_conflict(key, prior["evidenceDigest"], conflict))
        self.assertEqual(conflict, before)
        self.assertEqual(requests[0].url.path, "/rest/v1/rpc/preserve_market_fact_cache_conflict")
        self.assertEqual(json.loads(requests[0].content), {
            "requested_lookup_key": key, "expected_evidence_digest": prior["evidenceDigest"],
            "requested_result": conflict,
        })
        self.assertEqual(requests[0].headers["Authorization"], "Bearer test-service")
        for invalid in (result_fixture(), dict(conflict, lookupSource="ACTIVE_VIN_LOOKUP", providerRequestCount=1)):
            with self.subTest(status=invalid["status"]):
                with self.assertRaises(SupabaseContractError):
                    gateway.preserve_market_fact_cache_conflict(key, prior["evidenceDigest"], invalid)
        with self.assertRaises(SupabaseContractError):
            gateway.preserve_market_fact_cache_conflict(key, "invalid", conflict)
        self.assertEqual(len(requests), 1)


if __name__ == "__main__":
    unittest.main()
