"""Provider-neutral vehicle catalog contracts used by customer intake."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol, runtime_checkable


MIN_VEHICLE_CATALOG_YEAR = 1981
MAX_VEHICLE_CATALOG_TEXT_LENGTH = 100


def maximum_vehicle_catalog_year() -> int:
    return datetime.now(timezone.utc).year + 1


def _catalog_text(value: str, label: str) -> str:
    if not isinstance(value, str):
        raise TypeError(f"{label} must be a string")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError(f"{label} contains unsupported characters")
    normalized = " ".join(value.split())
    if (
        not normalized
        or len(normalized) > MAX_VEHICLE_CATALOG_TEXT_LENGTH
        or "," in normalized
    ):
        raise ValueError(f"{label} is invalid")
    return normalized


@dataclass(frozen=True)
class VehicleTrimCatalogRequest:
    """One exact year/make/model taxonomy lookup."""

    year: int
    make: str
    model: str

    def __post_init__(self) -> None:
        if (
            isinstance(self.year, bool)
            or not isinstance(self.year, int)
            or self.year < MIN_VEHICLE_CATALOG_YEAR
            or self.year > maximum_vehicle_catalog_year()
        ):
            raise ValueError("year is outside the supported vehicle catalog range")
        object.__setattr__(self, "make", _catalog_text(self.make, "make"))
        object.__setattr__(self, "model", _catalog_text(self.model, "model"))


@runtime_checkable
class VehicleTrimCatalogProvider(Protocol):
    def list_trims(
        self, request: VehicleTrimCatalogRequest
    ) -> tuple[str, ...]:
        """Return the valid trim taxonomy for one exact vehicle."""


__all__ = [
    "MAX_VEHICLE_CATALOG_TEXT_LENGTH",
    "MIN_VEHICLE_CATALOG_YEAR",
    "VehicleTrimCatalogProvider",
    "VehicleTrimCatalogRequest",
    "maximum_vehicle_catalog_year",
]
