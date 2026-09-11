"""Subject facts required by deterministic comparable qualification, before search."""

from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import date
from typing import Any

from venfour.comparables import ComparableTarget
from venfour.comparable_evidence import _TRUCK_BODY_TYPES, _REDUNDANT_DOOR_COUNTS, _fact


VEHICLE_FACT_FIELDS = (
    "bodyType", "drivetrain", "engine", "fuelType", "transmission",
    "powertrain", "cabType", "bedLength", "doors", "cylinders", "bodySubtype",
)
FIELD_LABELS = {
    "year": "Vehicle year", "make": "Make", "model": "Model", "trim": "Trim or version",
    "bodyType": "Body style", "drivetrain": "Drive type", "engine": "Engine",
    "fuelType": "Fuel type", "transmission": "Transmission", "powertrain": "Powertrain",
    "cabType": "Cab style", "bedLength": "Bed length", "doors": "Number of doors",
    "cylinders": "Number of cylinders", "bodySubtype": "Body configuration",
    "mileage": "Mileage at loss", "postalCode": "Vehicle ZIP code", "lossDate": "Date of loss",
    "vehicleFacts": "Vehicle details", "vehicle_configuration": "Trim or version",
}
_UNKNOWN = {"unknown", "not sure", "other/not sure", "other / not sure", "other", "n/a", "none", "-"}


def known(value: Any) -> bool:
    return _fact(value) is not None and _fact(value) not in _UNKNOWN


def readiness_issue(field: str, *, conflict: bool = False) -> dict[str, str]:
    label = FIELD_LABELS.get(field, field.replace("_", " ").capitalize())
    step = "claim" if field in {"mileage", "postalCode", "lossDate", "insurer_name", "insurer_vehicle_valuation"} else "vehicle"
    return {"field": field, "code": "CONFLICTING_SUBJECT_FACT" if conflict else "SUBJECT_FACT_REQUIRED",
            "message": f"Check {label.lower()}; the saved details disagree." if conflict else f"Confirm {label.lower()}.",
            "correctionStep": step}


class SubjectReadinessError(ValueError):
    def __init__(self, issues: list[dict[str, str]]) -> None:
        super().__init__("Confirm the missing vehicle or claim details before starting the review.")
        self.issues = issues

    def to_dict(self) -> dict[str, Any]:
        return {"ready": False, "issues": self.issues}


def validate_vehicle_facts(value: Any) -> dict[str, str]:
    if value is None:
        return {}
    if not isinstance(value, Mapping) or set(value) - set(VEHICLE_FACT_FIELDS):
        raise SubjectReadinessError([readiness_issue("vehicleFacts")])
    result = {}
    for field, raw in value.items():
        if not isinstance(raw, str) or not raw.strip() or len(raw) > 200 or any(ord(c) < 32 for c in raw):
            raise SubjectReadinessError([readiness_issue(field)])
        result[field] = " ".join(raw.split())
    if "drivetrain" in result and result["drivetrain"] not in {"FWD", "RWD", "AWD", "4WD"}:
        raise SubjectReadinessError([readiness_issue("drivetrain")])
    return result


def subject_readiness(target: ComparableTarget, facts: Mapping[str, Any], *,
                      loss_date: str | None, location_resolved: bool) -> list[dict[str, str]]:
    issues = []
    for field in ("year", "make", "model", "trim", "drivetrain"):
        if not known(getattr(target, field)):
            issues.append(readiness_issue(field))
    if target.mileage is None:
        issues.append(readiness_issue("mileage"))
    if not target.postal_code or not location_resolved:
        issues.append(readiness_issue("postalCode"))
    try:
        if not loss_date or date.fromisoformat(loss_date).isoformat() != loss_date:
            raise ValueError()
    except (ValueError, TypeError):
        issues.append(readiness_issue("lossDate"))
    # A customer-entered powertrain label is not a verified configuration
    # fingerprint. The adapter's engine/fuel/transmission facts still need a
    # subject-side match under comparable qualification.
    required = ["bodyType", "engine", "fuelType", "transmission"]
    if _fact(facts.get("bodyType")) in _TRUCK_BODY_TYPES:
        required.extend(("cabType", "bedLength"))
    for field in required:
        if not known(facts.get(field)):
            issues.append(readiness_issue(field))
    for field in VEHICLE_FACT_FIELDS:
        if facts.get(field) is not None and not known(facts[field]) and field not in required:
            issues.append(readiness_issue(field))
    drive = facts.get("drivetrain")
    if drive and known(target.drivetrain) and _fact(drive) != _fact(target.drivetrain):
        issues.append(readiness_issue("drivetrain", conflict=True))
    doors = _REDUNDANT_DOOR_COUNTS.get(_fact(facts.get("bodyType")))
    if doors and facts.get("doors") is not None and _fact(facts["doors"]) != doors:
        issues.append(readiness_issue("doors", conflict=True))
    encoded = re.search(r"\b(?:[ivhlw][ -]?(\d{1,2})|(\d{1,2})[ -]?(?:cylinders?|cyl))\b", _fact(facts.get("engine")) or "")
    if encoded and facts.get("cylinders") is not None:
        cylinder = next(v for v in encoded.groups() if v)
        if _fact(facts["cylinders"]) != cylinder:
            issues.append(readiness_issue("cylinders", conflict=True))
    return issues


def confirmed_subject_readiness(snapshot: Mapping[str, Any], normalized_report: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Read-only preflight of the same immutable facts used by creation."""
    from venfour.valuation_inputs import ConfirmedValuationInput, ValuationInputError, confirmed_normalized_report, apply_confirmed_vehicle_facts, snapshot_with_report_defaults
    from venfour.report_ingestion import normalized_report_to_legacy_report
    from venfour.marketcheck import configuration_drivetrain
    from venfour.discrepancy import valuation_discrepancy_request_from_report
    from venfour.efficient_search import subject_material_facts
    from venfour.search_geography import SearchGeography

    try:
        confirmed = ConfirmedValuationInput.from_snapshot(snapshot_with_report_defaults(snapshot, normalized_report))
        report = normalized_report_to_legacy_report(confirmed_normalized_report(confirmed, normalized_report))
        drive = configuration_drivetrain(confirmed.vehicle_configuration)
        if drive:
            report["vehicle"]["drivetrain"] = drive
        apply_confirmed_vehicle_facts(report, confirmed)
        target = valuation_discrepancy_request_from_report(report, postal_code=confirmed.postal_code).loss_vehicle
        issues = subject_readiness(target, subject_material_facts(report), loss_date=confirmed.loss_date,
                                   location_resolved=SearchGeography().origin(confirmed.postal_code) is not None)
    except ValuationInputError as exc:
        field = {"vehicle_year": "year", "vehicle_make": "make", "vehicle_model": "model", "vehicle_trim": "trim",
                 "mileage_at_loss": "mileage", "postal_code": "postalCode", "date_of_loss": "lossDate"}.get(exc.field, exc.field)
        issues = [readiness_issue(field)]
    except SubjectReadinessError as exc:
        issues = exc.issues
    return {"ready": not issues, "issues": issues}
