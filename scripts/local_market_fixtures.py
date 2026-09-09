"""Fictional report and provider fixtures for the localhost valuation journey."""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

from scripts.extract_report_ai import AIExtractionResult
from venfour.report_ingestion import ReportExtractionError, validate_canonical_pdf
from venfour.search_geography import SearchGeography, distance_miles

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "local-market"
SCENARIOS = ("dense", "expansion", "limited", "failure", "budget", "resume")
SUBJECT_VINS = {name: f"KMHLM4AG0RU9{index:05d}" for index, name in enumerate(SCENARIOS, 1)}


def report_data(scenario, loss_date):
    return {
        "schemaVersion": "2",
        "report": {"provider": "CCC", "reportReferenceNumber": "LOCAL-MARKET-" + scenario,
                   "claimReferenceNumber": "FICTIONAL-" + scenario, "lossDate": loss_date,
                   "reportDate": loss_date, "insurer": "Example Insurance", "effectiveDate": None},
        "vehicle": {"year": 2024, "make": "Hyundai", "model": "Elantra", "trim": "SEL",
                    "vin": SUBJECT_VINS[scenario], "mileage": 50000, "location": "Fenton, MO 63026",
                    "bodyStyle": "Sedan", "engine": "2.0L I4", "transmission": "Automatic",
                    "fuelType": "Unleaded", "equipment": [], "drivetrain": "FWD",
                    "drivetrainSource": {"page": 1, "section": "Vehicle Information",
                                         "label": "Drive type", "text": "FWD"}},
        "valuation": {"baseVehicleValue": 17000, "conditionAdjustment": 0,
                      "adjustedVehicleValue": 17000, "total": 17000},
        "condition": {"totalAdjustment": 0, "items": []},
        "comparables": [], "contributionRows": [],
        "valuationNotes": ["Fictional local test. No real market or insurer evidence."],
        "supplementalInformation": {"historyChecks": [], "historyEvents": [], "recalls": []},
    }


def extract_fixture(path, schema):
    text = validate_canonical_pdf(path).provider_text
    for scenario in SCENARIOS:
        if f"LOCAL-MARKET-{scenario}" in text:
            import re
            found = re.search(r"Loss date: (\d{4}-\d{2}-\d{2})", text)
            if found:
                return AIExtractionResult(data=report_data(scenario, found[1]),
                                          model="local-fixture", usage={"input_tokens": 0, "output_tokens": 0})
    raise ReportExtractionError("Upload one of the labeled local market test PDFs.")


def generate_reports():
    from scripts.generate_local_report_fixtures import build_fixture, key_value_table
    import scripts.generate_local_report_fixtures as generator
    generator.OUTPUT_DIRECTORY = OUTPUT
    loss_date = (date.today() - timedelta(days=14)).isoformat()
    for scenario in SCENARIOS:
        build_fixture(f"{scenario}.pdf", f"Valuation test: {scenario}", "CCC ONE synthetic report fixture",
            [("Vehicle Information", key_value_table([
                ("Fixture reference", "LOCAL-MARKET-" + scenario),
                ("Vehicle", "2024 Hyundai Elantra SEL"), ("VIN", SUBJECT_VINS[scenario]),
                ("Mileage", "50,000"), ("Drive type", "FWD"), ("Body", "Sedan"),
                ("Engine / transmission", "2.0L I4 / Automatic"), ("Fuel", "Unleaded"),
                ("Location", "Fenton, MO 63026"), ("Insurer", "Example Insurance"),
                ("Loss date", f"Loss date: {loss_date}"), ("Vehicle value / offer", "$17,000"),
                ("Condition", "Good; no adjustments")]))],
            "Fictional data for localhost only. Dealer URLs use reserved .invalid domains. "
            "No live provider request or actual valuation is represented.")


class FixtureTransport:
    """Return provider-shaped bytes; the real adapters reserve every attempt."""
    def __init__(self, scenario, *, loss_date, record, vehicle=None, postal_code="63026"):
        self.scenario, self.loss_date, self.record = scenario, loss_date, record
        self.vehicle = vehicle if vehicle is not None else report_data(scenario, loss_date)["vehicle"]
        self.geography = SearchGeography()
        self.origin = self.geography.origin(postal_code)
        self.rows = {}
        self.points = []
        if self.origin is None:
            return
        self.points = [self.origin]
        for _ in range(4):
            point = self.geography.next_center(self.origin, self.points,
                endpoint_radius_miles=100, outer_boundary_miles=250)
            if point is None:
                break
            self.points.append(point)
        for branch, point in enumerate(self.points):
            for index in range(60):
                serial = branch * 100 + index
                identity = f"{(self.vehicle.get('vin') or 'KMHLM4AG0RU')[:11]}{serial:06d}"
                self.rows[identity] = {
                    "id": f"fictional-{serial}", "vin": identity,
                    "price": 20000 + index * 100, "miles": (self.vehicle.get("mileage") or 50000) + index * 20,
                    "vdp_url": f"https://local-market.invalid/vehicles/{serial}",
                    "source": "local-market.invalid", "inventory_type": "used", "seller_type": "dealer",
                    "dealer": {"name": f"Fictional Dealer {serial}", "city": point["label"],
                               "state": "MO" if postal_code == "63026" else None,
                               "zip": postal_code if branch == 0 else None, "latitude": point["latitude"],
                               "longitude": point["longitude"]},
                    "build": {key: self.vehicle.get(source) for key, source in {
                        "year": "year", "make": "make", "model": "model", "trim": "trim",
                        "drivetrain": "drivetrain", "body_type": "bodyStyle", "engine": "engine",
                        "fuel_type": "fuelType", "transmission": "transmission"}.items()},
                    "dist": distance_miles(self.origin, point),
                }

    def get(self, endpoint, params, headers, timeout):
        self.record({"event": "fixture_attempt", "endpoint": endpoint,
                     "params": {key: value for key, value in params.items() if key != "api_key"}})
        if self.scenario == "failure":
            raise TimeoutError("Simulated provider timeout; no network request")
        if "/history/" in endpoint:
            row = self.rows.get(endpoint.rsplit("/", 1)[-1])
            if row is None:
                return b"[]"
            center = row["dealer"]
            start = date.fromisoformat(self.loss_date) - timedelta(days=1)
            end = date.fromisoformat(self.loss_date) + timedelta(days=1)
            record = {"id": row["id"], "vin": row["vin"], "price": row["price"], "miles": row["miles"],
                      "vdp_url": row["vdp_url"], "source": row["source"], "seller_name": center["name"],
                      "city": center["city"], "state": center["state"], "zip": center["zip"],
                      "latitude": center["latitude"], "longitude": center["longitude"],
                      "inventory_type": "used", "seller_type": "dealer",
                      "first_seen_at_date": start.isoformat() + "T00:00:00Z",
                      "last_seen_at_date": end.isoformat() + "T23:59:59Z"}
            payload = [record] if params["page"] == 1 else []
        elif endpoint.endswith("terms"):
            payload = {"trims": [self.vehicle.get("trim")], "drivetrain": [self.vehicle.get("drivetrain")]}
        elif self.origin is None:
            payload = {"num_found": 0, "listings": []}
        else:
            point = {"latitude": float(params.get("latitude", self.origin["latitude"])),
                     "longitude": float(params.get("longitude", self.origin["longitude"]))}
            branch = min(range(len(self.points)), key=lambda i: distance_miles(point, self.points[i]))
            count = (60 if self.scenario in {"dense", "resume", "budget"} and branch == 0 else
                     1 if self.scenario == "limited" and branch == 0 else
                     2 if self.scenario == "expansion" and branch == 0 else
                     60 if self.scenario == "expansion" and branch == 1 else 0)
            pool = [row for row in self.rows.values() if branch * 100 <= int(row["vin"][-6:]) < branch * 100 + count]
            if params.get("vin"):
                pool = [self.rows[params["vin"]]] if params["vin"] in self.rows else []
            if params.get("sort_by") == "price":
                pool.sort(key=lambda item: item["price"], reverse=True)
            payload = {"num_found": len(pool), "listings": pool[params.get("start", 0):params.get("start", 0) + params.get("rows", 50)]}
        return json.dumps(payload).encode()
