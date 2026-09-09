"""Isolation and fixture contracts for the localhost market test composition."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pymupdf

from scripts.local_market_fixtures import FixtureTransport, SCENARIOS, SUBJECT_VINS, report_data
from scripts.local_market_flow import DOCUMENT_CONNECTIONS, ingestion_service, network_audit, require_mock
from scripts.extract_report_ai import AIExtractionResult
from venfour.report_ingestion import ReportExtractionError


class LocalMarketConfigurationTests(unittest.TestCase):
    def test_requires_explicit_mode_and_rejects_hosted_or_live_modes(self):
        base = {"VENFOUR_LOCAL_POST_CONTINUE": "1", "VENFOUR_LOCAL_MARKET_FIXTURES": "1"}
        with patch.dict(os.environ, base, clear=True):
            require_mock()
        for extra in ({"VENFOUR_LOCAL_MARKET_FIXTURES": "0"}, {"K_SERVICE": "hosted"},
                      {"SUPABASE_URL": "https://remote.invalid"}, {"VENFOUR_LOCAL_FULL_FLOW": "1"},
                      {"VENFOUR_LOCAL_STRIPE_CHECKOUT": "1"}):
            with self.subTest(extra=extra), patch.dict(os.environ, {**base, **extra}, clear=True):
                with self.assertRaises(RuntimeError):
                    require_mock()

    def test_every_labeled_pdf_uses_the_real_ingestion_contract(self):
        with tempfile.TemporaryDirectory() as folder:
            for scenario in SCENARIOS:
                path = Path(folder) / f"{scenario}.pdf"
                with pymupdf.open() as doc:
                    page = doc.new_page()
                    page.insert_text((50, 50), f"CCC ONE LOCAL-MARKET-{scenario}\nLoss date: 2026-08-26")
                    doc.save(path)
                result = ingestion_service().ingest(path)
                self.assertEqual(result.normalized_report["vehicle"]["vin"], SUBJECT_VINS[scenario])
                self.assertEqual(result.normalized_report["vehicle"]["drivetrain"], "FWD")
                self.assertEqual(result.normalized_report["valuation"]["adjustedVehicleValue"], 17000)

    def test_own_report_requires_a_document_reader_credential(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True):
            path = Path(folder) / "unrecognized.pdf"
            with pymupdf.open() as doc:
                doc.new_page().insert_text((50, 50), "An unrecognized local test document")
                doc.save(path)
            with self.assertRaises(ReportExtractionError):
                ingestion_service().ingest(path)

    def test_own_ccc_report_uses_the_existing_reader_and_restores_network_isolation(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"OPENAI_API_KEY": "local-test"}), \
                patch("scripts.local_market_flow.OUTPUT", Path(folder)):
            path = Path(folder) / "customer-report.pdf"
            with pymupdf.open() as doc:
                doc.new_page().insert_text((50, 50), "CCC ONE Valuation Report")
                doc.save(path)
            payload = report_data("dense", "2026-08-26")
            payload["vehicle"].update(year=2018, make="Toyota", model="Camry", trim="LE", vin="4T1B11HK0JU123456")

            def document_reader(path, schema):
                self.assertIsNotNone(DOCUMENT_CONNECTIONS.get())
                network_audit("socket.getaddrinfo", ("api.openai.com", 443, 0, 0, 0))
                with self.assertRaises(PermissionError):
                    network_audit("socket.getaddrinfo", ("api.marketcheck.com", 443, 0, 0, 0))
                return AIExtractionResult(payload, "local-test", None)

            with patch("scripts.extract_report_ai.extract_report_with_openai", side_effect=document_reader) as reader:
                result = ingestion_service().ingest(path)
            self.assertEqual(reader.call_count, 1)
            self.assertEqual(result.normalized_report["vehicle"]["make"], "Toyota")
            self.assertIsNone(DOCUMENT_CONNECTIONS.get())

    def test_fixture_listings_follow_customer_vehicle_and_zip_without_guessing_unknown_powertrain(self):
        vehicle = {"year": 2018, "make": "Toyota", "model": "Camry", "trim": "LE",
                   "vin": "4T1B11HK0JU123456", "mileage": 89000}
        transport = FixtureTransport("expansion", loss_date="2026-08-26", record=lambda event: None,
                                     vehicle=vehicle, postal_code="60601")
        payload = json.loads(transport.get("/search", {}, {}, 1))
        self.assertEqual(payload["num_found"], 2)
        row = payload["listings"][0]
        self.assertEqual((row["build"]["make"], row["build"]["model"], row["build"]["trim"]), ("Toyota", "Camry", "LE"))
        self.assertEqual(row["miles"], 89000)
        self.assertEqual(row["dealer"]["zip"], "60601")
        self.assertIsNone(row["build"]["drivetrain"])
        self.assertEqual(row["price"], 20000)
        self.assertEqual(json.loads(transport.get("/history/unknown", {"page": 1}, {}, 1)), [])

    def test_fixture_transport_honors_pagination_without_network_access(self):
        calls = []
        transport = FixtureTransport("dense", loss_date="2026-08-26", record=calls.append)
        endpoint = "https://api.marketcheck.com/v2/search/car/recents"
        first = json.loads(transport.get(endpoint, {"start": 0, "rows": 50}, {}, 1))
        second = json.loads(transport.get(endpoint, {"start": 50, "rows": 50}, {}, 1))
        self.assertEqual((len(first["listings"]), len(second["listings"])), (50, 10))
        self.assertFalse({r["vin"] for r in first["listings"]} & {r["vin"] for r in second["listings"]})
        self.assertEqual(len(calls), 2)


class LocalMarketNetworkGuardTests(unittest.TestCase):
    def test_document_scope_allows_only_its_resolved_tls_addresses(self):
        with tempfile.TemporaryDirectory() as folder, patch("scripts.local_market_flow.OUTPUT", Path(folder)):
            token = DOCUMENT_CONNECTIONS.set({"192.0.2.20"})
            try:
                network_audit("socket.connect", (None, ("192.0.2.20", 443)))
                for address in (("192.0.2.21", 443), ("192.0.2.20", 80)):
                    with self.assertRaises(PermissionError):
                        network_audit("socket.connect", (None, address))
            finally:
                DOCUMENT_CONNECTIONS.reset(token)
            with self.assertRaises(PermissionError):
                network_audit("socket.connect", (None, ("192.0.2.20", 443)))

    def test_audit_hook_rejects_external_dns_and_direct_ip_connections(self):
        with tempfile.TemporaryDirectory() as folder, patch("scripts.local_market_flow.OUTPUT", Path(folder)):
            for host in ("api.marketcheck.com", "unconfigured-provider.invalid", "8.8.8.8"):
                with self.assertRaises(PermissionError):
                    network_audit("socket.getaddrinfo", (host, 443, 0, 0, 0))
            with self.assertRaises(PermissionError):
                network_audit("socket.connect", (None, ("192.0.2.2", 443)))
            network_audit("socket.getaddrinfo", ("localhost", 8000, 0, 0, 0))
            network_audit("socket.connect", (None, ("127.0.0.1", 54321)))
            network_audit("socket.connect", (None, ("::1", 8000, 0, 0)))


if __name__ == "__main__":
    unittest.main()
