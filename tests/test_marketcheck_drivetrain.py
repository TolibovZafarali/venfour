"""Offline exact-VIN specification resolution using the existing provider."""

import copy
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from tests.test_marketcheck import RecordingTransport, SYNTHETIC_KEY, make_raw_listing
from venfour.marketcheck import (
    MARKETCHECK_ACTIVE_INVENTORY_URL, MarketCheckProvider,
    drivetrain_lookup_failure, validate_drivetrain_lookup_result,
)


VIN = "1HGBH41JXMN109186"
VEHICLE = {"year": 2025, "make": "Toyota", "model": "Camry"}
OBSERVED = "2026-09-05T12:30:00Z"


def record(drive="FWD", **changes):
    row = make_raw_listing()
    row["vin"] = VIN
    row["build"]["drivetrain"] = drive
    row.update(changes)
    return row


def page(*rows):
    return {"num_found": len(rows), "listings": list(rows)}


class MarketCheckDrivetrainTests(unittest.TestCase):
    def setUp(self):
        self.timestamp = patch("venfour.marketcheck._lookup_time", return_value=OBSERVED)
        self.timestamp.start()
        self.addCleanup(self.timestamp.stop)

    def provider(self, outcomes):
        transport = RecordingTransport(outcomes)
        return MarketCheckProvider(SYNTHETIC_KEY, transport=transport), transport

    def test_explicit_value_is_identity_bound_with_safe_provenance(self):
        raw = record("4WD")
        before = copy.deepcopy(raw)
        provider, transport = self.provider([page(raw)])
        result = provider.lookup_drivetrain(VIN, **VEHICLE)
        self.assertEqual(raw, before)
        self.assertEqual((result["status"], result["drivetrain"]), ("RESOLVED", "4WD"))
        self.assertEqual(result["providerRequestCount"], 1)
        self.assertEqual(result["retrievedAt"], OBSERVED)
        self.assertEqual(result["evidence"][0], {
            "listingId": raw["id"], "vin": VIN, **VEHICLE,
            "rawDrivetrain": "4WD", "drivetrain": "4WD",
            "sourcePath": "$.listings[0].build.drivetrain",
            "endpointCategory": "active", "retrievedAt": OBSERVED,
        })
        self.assertEqual(transport.calls[0]["endpoint"], MARKETCHECK_ACTIVE_INVENTORY_URL)
        self.assertEqual(transport.calls[0]["params"], {
            "api_key": SYNTHETIC_KEY, "append_api_key": "false", "vin": VIN,
            "start": 0, "rows": 50,
        })
        self.assertEqual(transport.calls[0]["timeout"], 15.0)
        self.assertNotIn(SYNTHETIC_KEY, json.dumps(result))
        self.assertNotIn("price", json.dumps(result))

    def test_normalization_uses_only_explicit_build_drive(self):
        for explicit, expected in (("front-wheel drive", "FWD"), ("AWD", "AWD"),
                                   ("4x4", "4WD"), ("Rear Wheel Drive", "RWD"),
                                   (None, None), ("unknown", None)):
            with self.subTest(explicit=explicit):
                raw = record(explicit)
                raw["build"]["trim"] = "SE AWD"
                raw["vdp_url"] = "https://dealer.invalid/all-wheel-drive"
                raw["drivetrain"] = "AWD"
                provider, _ = self.provider([page(raw)])
                result = provider.lookup_drivetrain(VIN, **VEHICLE)
                self.assertEqual(result["drivetrain"], expected)
                self.assertEqual(result["status"], "RESOLVED" if expected else "UNAVAILABLE")

    def test_no_listing_or_no_value_is_cached_without_new_calls(self):
        for payload in (page(), page(record(None))):
            with self.subTest(payload=payload):
                provider, transport = self.provider([payload])
                first = provider.lookup_drivetrain(VIN, **VEHICLE)
                second = provider.lookup_drivetrain(VIN.lower(), **VEHICLE)
                self.assertEqual(first["status"], "UNAVAILABLE")
                self.assertEqual(len(transport.calls), 1)
                self.assertTrue(second["cacheHit"])
                self.assertEqual(second["providerRequestCount"], 0)
                self.assertEqual(first["evidenceDigest"], second["evidenceDigest"])

    def test_resolved_cached_result_does_not_alias_returned_mutable_data(self):
        provider, transport = self.provider([page(record())])
        first = provider.lookup_drivetrain(VIN, **VEHICLE)
        before = copy.deepcopy(first)
        first["evidence"][0]["drivetrain"] = "AWD"
        second = provider.lookup_drivetrain(VIN, **VEHICLE)
        self.assertEqual(second["evidence"], before["evidence"])
        self.assertEqual(second["retrievedAt"], before["retrievedAt"])
        self.assertTrue(second["cacheHit"])
        self.assertEqual(len(transport.calls), 1)

    def test_saved_actual_build_is_used_without_request(self):
        provider, transport = self.provider([])
        provider._normalize_listing(record("FWD"), 0)
        result = provider.lookup_drivetrain(VIN, **VEHICLE)
        self.assertEqual(result["lookupSource"], "SAVED_PROVIDER_EVIDENCE")
        self.assertEqual(result["status"], "RESOLVED")
        self.assertEqual(result["providerRequestCount"], 0)
        self.assertEqual(transport.calls, [])

    def test_saved_unknown_build_does_not_prevent_bounded_lookup(self):
        provider, transport = self.provider([page(record("FWD"))])
        provider._normalize_listing(record(None), 0)
        self.assertIsNone(provider.saved_drivetrain(VIN, **VEHICLE))
        self.assertEqual(provider.lookup_drivetrain(VIN, **VEHICLE)["status"], "RESOLVED")
        self.assertEqual(len(transport.calls), 1)

    def test_conflicting_explicit_values_remain_unknown(self):
        provider, _ = self.provider([page(record("FWD"), record("AWD", id="second-listing"))])
        result = provider.lookup_drivetrain(VIN, **VEHICLE)
        self.assertEqual(result["status"], "CONFLICT")
        self.assertIsNone(result["drivetrain"])
        provider, transport = self.provider([])
        provider._remember_drivetrain_record(record("FWD"), 0, "recents")
        provider._remember_drivetrain_record(record("AWD", id="second-listing"), 1, "history")
        self.assertEqual(provider.lookup_drivetrain(VIN, **VEHICLE)["status"], "CONFLICT")
        self.assertEqual(transport.calls, [])

    def test_vin_and_vehicle_mismatches_cannot_supply_a_value(self):
        for field, value in (("vin", "1HGBH41JXMN109187"), ("year", 2024),
                             ("make", "Other"), ("model", "Other")):
            with self.subTest(field=field):
                raw = record()
                (raw if field == "vin" else raw["build"])[field] = value
                provider, _ = self.provider([page(raw)])
                result = provider.lookup_drivetrain(VIN, **VEHICLE)
                self.assertEqual(result["status"], "FAILED")
                self.assertEqual(result["reasonCode"], "PROVIDER_IDENTITY_MISMATCH")
                self.assertIsNone(result["drivetrain"])

    def test_failure_and_timeout_use_only_existing_retry_budget(self):
        with patch("venfour.marketcheck.sleep") as sleeper:
            provider, transport = self.provider([TimeoutError(), TimeoutError()])
            result = provider.lookup_drivetrain(VIN, **VEHICLE)
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["reasonCode"], "PROVIDER_TEMPORARILY_UNAVAILABLE")
        self.assertEqual(result["providerRequestCount"], 2)
        self.assertEqual(len(transport.calls), 2)
        sleeper.assert_called_once_with(0.25)
        cached = provider.lookup_drivetrain(VIN, **VEHICLE)
        self.assertTrue(cached["cacheHit"])
        self.assertEqual(cached["providerRequestCount"], 0)
        with patch("venfour.marketcheck.sleep"):
            provider, _ = self.provider([TimeoutError(), page(record())])
            self.assertEqual(provider.lookup_drivetrain(VIN, **VEHICLE)["providerRequestCount"], 2)

    def test_access_failure_is_typed_without_leaking_provider_exception(self):
        provider, transport = self.provider([HTTPError("https://invalid/?api_key=" + SYNTHETIC_KEY, 403, SYNTHETIC_KEY, {}, None)])
        result = provider.lookup_drivetrain(VIN, **VEHICLE)
        self.assertEqual(result["reasonCode"], "PROVIDER_ACCESS_UNAVAILABLE")
        self.assertEqual(len(transport.calls), 1)
        self.assertNotIn(SYNTHETIC_KEY, json.dumps(result))

    def test_partial_or_malformed_response_cannot_claim_resolution(self):
        for payload in ({"num_found": 2, "listings": [record()]},
                        {"num_found": 0, "listings": "bad"},
                        page(record(["AWD"])), page(record(SYNTHETIC_KEY))):
            with self.subTest(payload=payload):
                provider, _ = self.provider([payload])
                result = provider.lookup_drivetrain(VIN, **VEHICLE)
                self.assertEqual(result["status"], "FAILED")
                self.assertNotIn(SYNTHETIC_KEY, json.dumps(result))

    def test_validator_binds_identity_value_digest_and_cache_metadata(self):
        provider, _ = self.provider([page(record())])
        result = provider.lookup_drivetrain(VIN, **VEHICLE)
        mutations = []
        for key, value in (("drivetrain", "AWD"), ("evidenceDigest", "0" * 64),
                           ("vin", "1HGBH41JXMN109187"), ("providerRequestCount", 3),
                           ("cacheHit", True)):
            changed = copy.deepcopy(result); changed[key] = value; mutations.append(changed)
        for changed in mutations:
            with self.assertRaises(ValueError):
                validate_drivetrain_lookup_result(changed)
        failure = drivetrain_lookup_failure(VIN, **VEHICLE, reason_code="CACHE_UNAVAILABLE", retrieved_at=OBSERVED)
        self.assertEqual(failure["status"], "FAILED")
        self.assertEqual(failure["providerRequestCount"], 0)

    def test_invalid_lookup_identity_fails_before_any_provider_call(self):
        provider, transport = self.provider([])
        with self.assertRaises(ValueError):
            provider.lookup_drivetrain("invalid", **VEHICLE)
        self.assertEqual(transport.calls, [])


if __name__ == "__main__":
    unittest.main()
