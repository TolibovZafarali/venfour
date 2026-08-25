"""Confirmed provider-neutral customer input for total-loss analysis."""

from __future__ import annotations

import copy
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from venfour.postal_codes import normalize_us_zip_code
from venfour.report_ingestion import validate_normalized_report


class ValuationInputError(ValueError):
    """The database-confirmed analysis snapshot is incomplete or malformed."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field


def _first(mapping: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in mapping:
            return mapping[key]
    return None


def _required_text(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise ValuationInputError(field, f"{field} is required")
    normalized = " ".join(value.split())
    if not normalized:
        raise ValuationInputError(field, f"{field} is required")
    if len(normalized) > 500:
        raise ValuationInputError(field, f"{field} is too long")
    return normalized


def _optional_text(value: Any, field: str) -> str | None:
    if value is None:
        return None
    return _required_text(value, field)


def _required_integer(
    value: Any, field: str, *, minimum: int, maximum: int
) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValuationInputError(field, f"{field} is required")
    if value < minimum or value > maximum:
        raise ValuationInputError(field, f"{field} is outside the supported range")
    return value


def _optional_money(value: Any, field: str) -> float | int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValuationInputError(field, f"{field} is invalid")
    if not math.isfinite(float(value)) or value < 0:
        raise ValuationInputError(field, f"{field} is invalid")
    return value


def _required_date(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValuationInputError(field, f"{field} is required")
    normalized = value.strip()
    try:
        parsed = date.fromisoformat(normalized)
    except ValueError as exc:
        raise ValuationInputError(field, f"{field} must be an ISO date") from exc
    if parsed.isoformat() != normalized:
        raise ValuationInputError(field, f"{field} must be an ISO date")
    return normalized


def _condition_summary(value: Any) -> str | None:
    if isinstance(value, str):
        normalized = " ".join(value.split())
        return normalized[:4000] or None
    if isinstance(value, Mapping):
        for key in ("overall", "rating", "condition", "label", "summary"):
            child = value.get(key)
            if isinstance(child, str) and child.strip():
                return " ".join(child.split())[:4000]
        return "Customer provided condition details" if value else None
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        values = [
            " ".join(item.split())
            for item in value
            if isinstance(item, str) and item.strip()
        ]
        return "; ".join(values)[:4000] or None
    return None


def _equipment(value: Any) -> tuple[str, ...]:
    values: list[str] = []
    if isinstance(value, str):
        values = [part.strip() for part in value.split(",")]
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        values = [item for item in value if isinstance(item, str)]
    elif isinstance(value, Mapping):
        for key, child in value.items():
            if child is True and isinstance(key, str):
                values.append(key)
            elif isinstance(child, str) and child.strip():
                values.append(child)
    normalized: list[str] = []
    seen: set[str] = set()
    for value_text in values:
        text = " ".join(value_text.split())[:4000]
        key = text.casefold()
        if text and key not in seen:
            seen.add(key)
            normalized.append(text)
    return tuple(normalized[:500])


@dataclass(frozen=True)
class ConfirmedValuationInput:
    """Analysis-critical facts copied from one immutable DB claim snapshot."""

    intake_mode: str
    year: int
    make: str
    model: str
    trim: str
    mileage: int
    postal_code: str
    loss_date: str
    insurer: str
    vin: str | None = None
    insurer_offer: float | int | None = None
    condition_summary: str | None = None
    equipment: tuple[str, ...] = ()
    report_provider: str | None = None

    @classmethod
    def from_snapshot(
        cls, snapshot: Mapping[str, Any]
    ) -> ConfirmedValuationInput:
        if not isinstance(snapshot, Mapping):
            raise ValuationInputError("input_snapshot", "Input snapshot is invalid")
        mode = _required_text(
            _first(snapshot, "intake_mode", "intakeMode"), "intake_mode"
        ).casefold()
        if mode not in {"report", "manual"}:
            raise ValuationInputError("intake_mode", "Intake mode is invalid")
        try:
            postal = normalize_us_zip_code(
                _first(snapshot, "postal_code", "postalCode")
            )
        except (TypeError, ValueError) as exc:
            raise ValuationInputError(
                "postal_code", "A valid postal code is required"
            ) from exc
        condition_value = _first(
            snapshot, "vehicle_condition", "vehicleCondition"
        )
        options_value = _first(
            snapshot, "vehicle_options_packages", "vehicleOptionsPackages"
        )
        condition = _condition_summary(condition_value)
        if condition is None:
            raise ValuationInputError(
                "vehicle_condition", "Vehicle condition confirmation is required"
            )
        return cls(
            intake_mode=mode.upper(),
            vin=_optional_text(_first(snapshot, "vin"), "vin"),
            year=_required_integer(
                _first(snapshot, "vehicle_year", "vehicleYear"),
                "vehicle_year",
                minimum=1886,
                maximum=date.today().year + 2,
            ),
            make=_required_text(
                _first(snapshot, "vehicle_make", "vehicleMake"), "vehicle_make"
            ),
            model=_required_text(
                _first(snapshot, "vehicle_model", "vehicleModel"), "vehicle_model"
            ),
            trim=_required_text(
                _first(snapshot, "vehicle_trim", "vehicleTrim"), "vehicle_trim"
            ),
            mileage=_required_integer(
                _first(snapshot, "mileage_at_loss", "mileageAtLoss"),
                "mileage_at_loss",
                minimum=0,
                maximum=10_000_000,
            ),
            postal_code=postal,
            loss_date=_required_date(
                _first(snapshot, "date_of_loss", "dateOfLoss"), "date_of_loss"
            ),
            insurer=_required_text(
                _first(snapshot, "insurer_name", "insurerName"), "insurer_name"
            ),
            insurer_offer=_optional_money(
                _first(
                    snapshot,
                    "insurer_vehicle_valuation",
                    "insurerVehicleValuation",
                ),
                "insurer_vehicle_valuation",
            ),
            condition_summary=condition,
            equipment=(
                ()
                if options_value is None or options_value == "Not provided"
                else _equipment(options_value)
            ),
            report_provider=_optional_text(
                _first(snapshot, "report_provider_name", "reportProviderName"),
                "report_provider_name",
            ),
        )


def empty_normalized_report() -> dict[str, Any]:
    """Return a complete neutral shape suitable for confirmed manual facts."""

    return {
        "schemaVersion": "1",
        "report": {
            "provider": None,
            "providerId": None,
            "insurer": None,
            "reportReferenceNumber": None,
            "claimReferenceNumber": None,
            "lossDate": None,
            "reportDate": None,
            "effectiveDate": None,
        },
        "vehicle": {
            "year": None,
            "make": None,
            "model": None,
            "trim": None,
            "vin": None,
            "mileage": None,
            "location": None,
            "bodyStyle": None,
            "engine": None,
            "transmission": None,
            "fuelType": None,
            "equipment": [],
        },
        "valuation": {
            "baseVehicleValue": None,
            "conditionAdjustment": None,
            "adjustedVehicleValue": None,
            "insurerOffer": None,
            "taxes": [],
            "fees": [],
            "priorDamageAdjustment": None,
            "otherAdjustments": [],
            "total": None,
        },
        "condition": {
            "preLossCondition": None,
            "totalAdjustment": None,
            "items": [],
        },
        "comparables": [],
        "valuationNotes": [],
        "supplementalInformation": {
            "historyChecks": [],
            "historyEvents": [],
            "recalls": [],
        },
    }


def confirmed_normalized_report(
    confirmed: ConfirmedValuationInput,
    extracted_report: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Overlay customer-confirmed facts onto extracted or empty neutral data."""

    if not isinstance(confirmed, ConfirmedValuationInput):
        raise TypeError("confirmed must be ConfirmedValuationInput")
    if confirmed.intake_mode == "REPORT" and extracted_report is not None:
        validate_normalized_report(extracted_report)
        normalized = copy.deepcopy(dict(extracted_report))
    else:
        normalized = empty_normalized_report()
    report = normalized["report"]
    vehicle = normalized["vehicle"]
    valuation = normalized["valuation"]
    condition = normalized["condition"]
    report["provider"] = confirmed.report_provider or report["provider"]
    report["insurer"] = confirmed.insurer
    report["lossDate"] = confirmed.loss_date
    vehicle.update(
        {
            "year": confirmed.year,
            "make": confirmed.make,
            "model": confirmed.model,
            "trim": confirmed.trim,
            "vin": confirmed.vin,
            "mileage": confirmed.mileage,
            "equipment": list(confirmed.equipment),
        }
    )
    valuation["insurerOffer"] = confirmed.insurer_offer
    condition["preLossCondition"] = confirmed.condition_summary
    if confirmed.intake_mode == "MANUAL":
        normalized["comparables"] = []
        condition["items"] = []
        condition["totalAdjustment"] = None
        valuation["conditionAdjustment"] = None
        valuation["priorDamageAdjustment"] = None
        valuation["otherAdjustments"] = []
    validate_normalized_report(normalized)
    return normalized


def evidence_context(
    confirmed: ConfirmedValuationInput,
    normalized: Mapping[str, Any],
    *,
    adapter: str | None = None,
    partial_extraction: bool = False,
    report_extraction_available: bool | None = None,
) -> dict[str, Any]:
    """Describe available evidence without implying unsupported analysis work."""

    validate_normalized_report(normalized)
    valuation = normalized["valuation"]
    condition = normalized["condition"]
    comparables = normalized["comparables"]
    report_available = confirmed.intake_mode == "REPORT"
    extraction_available = report_available and (
        bool(report_extraction_available)
        if report_extraction_available is not None
        else adapter is not None
    )
    adjustment_values: list[Any] = [
        valuation["conditionAdjustment"],
        valuation["priorDamageAdjustment"],
        *valuation["otherAdjustments"],
    ]
    for comparable in comparables:
        adjustment_values.extend(comparable["adjustments"].values())
    adjustments_available = extraction_available and any(
        value is not None and value != [] for value in adjustment_values
    )
    insurer_valuation_available = any(
        valuation[field] is not None
        for field in ("insurerOffer", "adjustedVehicleValue", "total")
    )
    return {
        "inputMode": confirmed.intake_mode,
        "reportAvailable": report_available,
        "reportExtractionAvailable": extraction_available,
        "reportProvider": normalized["report"]["provider"],
        "reportAdapter": adapter if extraction_available else None,
        "partialExtraction": (
            bool(partial_extraction) if extraction_available else False
        ),
        "offerAvailable": confirmed.insurer_offer is not None,
        "insurerValuationAvailable": insurer_valuation_available,
        "reportComparablesAvailable": extraction_available and bool(comparables),
        "reportAdjustmentsAvailable": adjustments_available,
        "conditionInformationAvailable": confirmed.condition_summary is not None,
        "optionsInformationAvailable": True,
        "conditionAndOptionsDollarAdjusted": False,
    }


__all__ = [
    "ConfirmedValuationInput",
    "ValuationInputError",
    "confirmed_normalized_report",
    "empty_normalized_report",
    "evidence_context",
]
