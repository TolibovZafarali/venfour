"""Provider-neutral vehicle catalog contracts used by customer intake."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol, runtime_checkable


MIN_VEHICLE_CATALOG_YEAR = 1981
MAX_VEHICLE_CATALOG_TEXT_LENGTH = 100
MAX_VEHICLE_TRIM_OPTIONS = 1000
VEHICLE_TRIM_QUERY_FIELDS = frozenset(("trim", "version"))

_TOKEN_RE = re.compile(r"[^\W_]+(?:\.[0-9]+)?", re.UNICODE)
_NATURAL_NUMBER_RE = re.compile(r"([0-9]+)")
_PROVIDER_ID_RE = re.compile(r"[a-z0-9][a-z0-9._-]{0,49}")

_QUALIFIER_DISPLAY = {
    "range:standard": "Standard Range",
    "range:standard-plus": "Standard Range Plus",
    "range:long": "Long Range",
    "range:extended": "Extended Range",
    "powertrain:hybrid": "Hybrid",
    "powertrain:phev": "PHEV",
    "powertrain:electric": "Electric",
    "performance": "Performance",
    "motor:dual": "Dual Motor",
    "battery": "Battery",
    "drivetrain:fwd": "FWD",
    "drivetrain:rwd": "RWD",
    "drivetrain:awd": "AWD",
    "drivetrain:4wd": "4WD",
}
_QUALIFIER_ORDER = {
    name: index for index, name in enumerate(_QUALIFIER_DISPLAY)
}

# Only vocabulary with the same customer-relevant meaning belongs here.  In
# particular, manufacturer drive systems such as xDrive and SH-AWD remain raw
# tokens because their branded names can distinguish real configurations.
_QUALIFIER_ALIASES = {
    ("standard", "range"): "range:standard",
    ("standard", "range", "plus"): "range:standard-plus",
    ("std", "range"): "range:standard",
    ("standart", "range"): "range:standard",
    ("long", "range"): "range:long",
    ("extended", "range"): "range:extended",
    ("ext", "range"): "range:extended",
    ("plug", "in", "hybrid"): "powertrain:phev",
    ("plugin", "hybrid"): "powertrain:phev",
    ("plug", "in", "electric", "hybrid"): "powertrain:phev",
    ("phev",): "powertrain:phev",
    ("hybrid",): "powertrain:hybrid",
    ("hev",): "powertrain:hybrid",
    ("battery", "electric"): "powertrain:electric",
    ("electric", "vehicle"): "powertrain:electric",
    ("electric",): "powertrain:electric",
    ("bev",): "powertrain:electric",
    ("ev",): "powertrain:electric",
    ("performance",): "performance",
    ("perfomance",): "performance",
    ("performace",): "performance",
    ("dual", "motor"): "motor:dual",
    ("twin", "motor"): "motor:dual",
    ("2", "motor"): "motor:dual",
    ("all", "wheel", "drive"): "drivetrain:awd",
    ("all", "wheel", "drv"): "drivetrain:awd",
    ("awd",): "drivetrain:awd",
    ("front", "wheel", "drive"): "drivetrain:fwd",
    ("fwd",): "drivetrain:fwd",
    ("rear", "wheel", "drive"): "drivetrain:rwd",
    ("rwd",): "drivetrain:rwd",
    ("four", "wheel", "drive"): "drivetrain:4wd",
    ("4", "wheel", "drive"): "drivetrain:4wd",
    ("four", "by", "four"): "drivetrain:4wd",
    ("4", "by", "4"): "drivetrain:4wd",
    ("4wd",): "drivetrain:4wd",
    ("4x4",): "drivetrain:4wd",
    ("battery",): "battery",
}
_ALIASES_BY_LENGTH = tuple(
    sorted(
        _QUALIFIER_ALIASES.items(),
        key=lambda item: (-len(item[0]), item[0]),
    )
)


def maximum_vehicle_catalog_year() -> int:
    return datetime.now(timezone.utc).year + 1


def _normalized_text(value: str, label: str) -> str:
    if not isinstance(value, str):
        raise TypeError(f"{label} must be a string")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError(f"{label} contains unsupported characters")
    normalized = " ".join(unicodedata.normalize("NFKC", value).split())
    if (
        not normalized
        or len(normalized) > MAX_VEHICLE_CATALOG_TEXT_LENGTH
    ):
        raise ValueError(f"{label} is invalid")
    return normalized


def _catalog_text(value: str, label: str) -> str:
    normalized = _normalized_text(value, label)
    if "," in normalized:
        raise ValueError(f"{label} is invalid")
    return normalized


def _natural_sort_key(value: str) -> tuple[tuple[int, int | str], ...]:
    parts = _NATURAL_NUMBER_RE.split(
        unicodedata.normalize("NFKC", value).casefold()
    )
    return tuple(
        (1, int(part)) if part.isdigit() else (0, part)
        for part in parts
        if part
    )


def _display_token(value: str) -> str:
    folded = value.casefold()
    styled_tokens = {
        "supercrew": "SuperCrew",
        "supercab": "SuperCab",
        "crewmax": "CrewMax",
        "doublecab": "DoubleCab",
        "kwh": "kWh",
        "ft": "ft",
        "in": "in",
    }
    if folded in styled_tokens:
        return styled_tokens[folded]
    drive_match = re.fullmatch(r"([xs])drive(.*)", folded)
    if drive_match is not None:
        return f"{drive_match.group(1)}Drive{drive_match.group(2)}"
    if re.fullmatch(r"m[0-9]+[a-z]*", folded):
        return f"M{folded[1:]}"
    if value.isupper() and len(value) <= 5:
        return value
    if any(character.isupper() for character in value[1:]):
        return value
    return value[:1].upper() + value[1:].lower()


@dataclass(frozen=True)
class _ParsedConfiguration:
    raw: str
    signature: tuple[tuple[str, ...], tuple[str, ...]]
    label: str
    preference: tuple[Any, ...]


def _parse_configuration(
    raw_value: str,
    *,
    query_field: str,
) -> _ParsedConfiguration:
    raw = _normalized_text(raw_value, "vehicle trim query value")
    display_tokens = _TOKEN_RE.findall(raw.replace("+", " plus "))
    folded_tokens = tuple(token.casefold() for token in display_tokens)
    if not folded_tokens:
        raise ValueError("vehicle trim query value is invalid")

    qualifiers: set[str] = set()
    unknown_tokens: list[str] = []
    unknown_display: list[str] = []
    alias_penalty = 0
    index = 0
    while index < len(folded_tokens):
        match: tuple[tuple[str, ...], str] | None = None
        for alias, qualifier in _ALIASES_BY_LENGTH:
            if folded_tokens[index : index + len(alias)] == alias:
                match = (alias, qualifier)
                break
        if match is None:
            unknown_tokens.append(folded_tokens[index])
            unknown_display.append(_display_token(display_tokens[index]))
            index += 1
            continue

        alias, qualifier = match
        qualifiers.add(qualifier)
        canonical_words = tuple(_QUALIFIER_DISPLAY[qualifier].casefold().split())
        if alias != canonical_words:
            alias_penalty += 1
        index += len(alias)

    # A provider version such as "Long Range Battery" uses Battery as legacy
    # wording for the already-identified range.  This exception is deliberately
    # unavailable to raw trim fallback, where Battery may be the only material
    # distinction the provider exposes.
    range_present = any(name.startswith("range:") for name in qualifiers)
    has_capacity = any(
        token == "kwh" or token.isdigit() for token in unknown_tokens
    )
    redundant_battery = (
        query_field == "version"
        and "battery" in qualifiers
        and range_present
        and not has_capacity
    )
    if redundant_battery:
        qualifiers.remove("battery")

    ordered_qualifiers = tuple(
        sorted(qualifiers, key=lambda name: (_QUALIFIER_ORDER[name], name))
    )
    label_parts = unknown_display + [
        _QUALIFIER_DISPLAY[name] for name in ordered_qualifiers
    ]
    label = " ".join(label_parts)
    if not label:
        raise ValueError("vehicle trim query value is invalid")

    signature = (
        tuple(unknown_tokens),
        ordered_qualifiers,
    )
    preference = (
        1 if redundant_battery else 0,
        alias_penalty,
        len(folded_tokens),
        len(raw),
        _natural_sort_key(raw),
        raw,
    )
    return _ParsedConfiguration(
        raw=raw,
        signature=signature,
        label=label,
        preference=preference,
    )


def _option_id(
    source: str,
    query_field: str,
    signature: tuple[tuple[str, ...], tuple[str, ...]],
) -> str:
    signature_text = "\0".join(
        (source, query_field, *signature[0], "|", *signature[1])
    )
    digest = hashlib.sha256(signature_text.encode("utf-8")).hexdigest()[:20]
    return f"{source}-{query_field}-{digest}"


@dataclass(frozen=True)
class VehicleTrimOption:
    """A clean label with the provider identities needed to resolve it."""

    source: str
    id: str
    label: str
    trim: str
    query_field: str
    query_values: tuple[str, ...]

    def __post_init__(self) -> None:
        if (
            not isinstance(self.source, str)
            or not _PROVIDER_ID_RE.fullmatch(self.source)
        ):
            raise ValueError("vehicle trim option source is invalid")
        if (
            not isinstance(self.id, str)
            or not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,99}", self.id)
        ):
            raise ValueError("vehicle trim option id is invalid")
        object.__setattr__(self, "label", _normalized_text(self.label, "label"))
        object.__setattr__(self, "trim", _normalized_text(self.trim, "trim"))
        if (
            not isinstance(self.query_field, str)
            or self.query_field not in VEHICLE_TRIM_QUERY_FIELDS
        ):
            raise ValueError("vehicle trim query field is invalid")
        if (
            not isinstance(self.query_values, tuple)
            or not self.query_values
            or len(self.query_values) > MAX_VEHICLE_TRIM_OPTIONS
        ):
            raise ValueError("vehicle trim query values are invalid")

        unique_values: dict[str, str] = {}
        for value in self.query_values:
            normalized = _normalized_text(value, "vehicle trim query value")
            if "," in normalized:
                raise ValueError("vehicle trim query value is invalid")
            unique_values.setdefault(normalized.casefold(), normalized)
        object.__setattr__(
            self,
            "query_values",
            tuple(
                sorted(
                    unique_values.values(),
                    key=lambda value: (_natural_sort_key(value), value),
                )
            ),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "id": self.id,
            "label": self.label,
            "trim": self.trim,
            "queryField": self.query_field,
            "queryValues": list(self.query_values),
        }


def normalize_vehicle_trim_options(
    raw_values: list[str] | tuple[str, ...],
    *,
    source: str,
    query_field: str,
) -> tuple[VehicleTrimOption, ...]:
    """Collapse only values with the same material configuration signature."""

    if not isinstance(source, str) or not _PROVIDER_ID_RE.fullmatch(source):
        raise ValueError("vehicle trim option source is invalid")
    if (
        not isinstance(query_field, str)
        or query_field not in VEHICLE_TRIM_QUERY_FIELDS
    ):
        raise ValueError("vehicle trim query field is invalid")
    if (
        not isinstance(raw_values, (list, tuple))
        or len(raw_values) > MAX_VEHICLE_TRIM_OPTIONS
    ):
        raise ValueError("vehicle trim query values are invalid")

    grouped: dict[
        tuple[tuple[str, ...], tuple[str, ...]], list[_ParsedConfiguration]
    ] = {}
    for value in raw_values:
        parsed = _parse_configuration(value, query_field=query_field)
        grouped.setdefault(parsed.signature, []).append(parsed)

    options: list[VehicleTrimOption] = []
    for signature, configurations in grouped.items():
        preferred = min(configurations, key=lambda item: item.preference)
        values = tuple(configuration.raw for configuration in configurations)
        options.append(
            VehicleTrimOption(
                source=source,
                id=_option_id(source, query_field, signature),
                label=preferred.label,
                trim=preferred.label,
                query_field=query_field,
                query_values=values,
            )
        )
    return tuple(
        sorted(
            options,
            key=lambda option: (
                _natural_sort_key(option.label),
                option.label,
                option.id,
            ),
        )
    )


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
    ) -> tuple[VehicleTrimOption, ...]:
        """Return the valid trim taxonomy for one exact vehicle."""


__all__ = [
    "MAX_VEHICLE_CATALOG_TEXT_LENGTH",
    "MAX_VEHICLE_TRIM_OPTIONS",
    "MIN_VEHICLE_CATALOG_YEAR",
    "VEHICLE_TRIM_QUERY_FIELDS",
    "VehicleTrimCatalogProvider",
    "VehicleTrimCatalogRequest",
    "VehicleTrimOption",
    "maximum_vehicle_catalog_year",
    "normalize_vehicle_trim_options",
]
