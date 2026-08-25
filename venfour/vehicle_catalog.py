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
MAX_VEHICLE_TRIM_QUERY_VALUES = 20
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
    ("all", "whel", "drive"): "drivetrain:awd",
    ("all", "whl", "drive"): "drivetrain:awd",
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


def _has_unsupported_text_character(value: str) -> bool:
    return any(
        ord(character) < 32
        or ord(character) == 127
        or ord(character) == 0x061C
        or ord(character) in (0x200E, 0x200F)
        or 0x202A <= ord(character) <= 0x202E
        or 0x2066 <= ord(character) <= 0x2069
        for character in value
    )


class VehicleTrimQueryValuesLimitError(ValueError):
    """One configuration has more provider aliases than can be persisted."""


def maximum_vehicle_catalog_year() -> int:
    return datetime.now(timezone.utc).year + 1


def _normalized_text(value: str, label: str) -> str:
    if not isinstance(value, str):
        raise TypeError(f"{label} must be a string")
    if _has_unsupported_text_character(value):
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
    battery_alias_signature: tuple[
        tuple[str, ...], tuple[str, ...]
    ] | None = None


def _parse_configuration(
    raw_value: str,
    *,
    query_field: str,
    redundant_prefixes: tuple[tuple[str, ...], ...] = (),
) -> _ParsedConfiguration:
    raw = _normalized_text(raw_value, "vehicle trim query value")
    display_tokens = _TOKEN_RE.findall(raw.replace("+", " plus "))
    folded_tokens = tuple(token.casefold() for token in display_tokens)
    if not folded_tokens:
        raise ValueError("vehicle trim query value is invalid")

    for prefix in redundant_prefixes:
        if (
            len(folded_tokens) > len(prefix)
            and folded_tokens[: len(prefix)] == prefix
        ):
            display_tokens = display_tokens[len(prefix) :]
            folded_tokens = folded_tokens[len(prefix) :]
            break

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

    # Battery is only eligible to collapse later when this exact catalog also
    # exposes the otherwise-identical non-Battery configuration.  A lexical
    # rule alone cannot prove that Battery is redundant for every vehicle.
    range_present = any(name.startswith("range:") for name in qualifiers)
    capacity_number = re.compile(r"[0-9]+(?:\.[0-9]+)?")
    has_capacity = "kwh" in folded_tokens or any(
        token == "battery"
        and any(
            0 <= neighbor < len(folded_tokens)
            and capacity_number.fullmatch(folded_tokens[neighbor]) is not None
            for neighbor in (position - 1, position + 1)
        )
        for position, token in enumerate(folded_tokens)
    )
    battery_alias_candidate = (
        query_field == "version"
        and "battery" in qualifiers
        and range_present
        and not has_capacity
    )

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
    battery_alias_signature = (
        (
            tuple(unknown_tokens),
            tuple(name for name in ordered_qualifiers if name != "battery"),
        )
        if battery_alias_candidate
        else None
    )
    preference = (
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
        battery_alias_signature=battery_alias_signature,
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
        ):
            raise ValueError("vehicle trim query values are invalid")
        if len(self.query_values) > MAX_VEHICLE_TRIM_QUERY_VALUES:
            raise VehicleTrimQueryValuesLimitError(
                "vehicle trim option has too many provider query values"
            )

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
    redundant_prefixes: tuple[str, ...] = (),
    allow_redundant_battery_aliases: bool = False,
) -> tuple[VehicleTrimOption, ...]:
    """Collapse only values with the same material configuration signature.

    ``redundant_prefixes`` may contain the exact year/make/model context of the
    catalog request.  A matching leading prefix is omitted from the display
    signature but retained untouched in ``query_values`` for provider calls.
    """

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
    if not isinstance(allow_redundant_battery_aliases, bool):
        raise TypeError("battery alias policy must be a boolean")
    if not isinstance(redundant_prefixes, tuple):
        raise TypeError("redundant vehicle trim prefixes must be a tuple")
    normalized_prefixes: set[tuple[str, ...]] = set()
    for value in redundant_prefixes:
        normalized = _normalized_text(value, "vehicle trim prefix")
        tokens = tuple(
            token.casefold()
            for token in _TOKEN_RE.findall(normalized.replace("+", " plus "))
        )
        if tokens:
            normalized_prefixes.add(tokens)
    ordered_prefixes = tuple(
        sorted(normalized_prefixes, key=lambda value: (-len(value), value))
    )

    parsed_values: list[_ParsedConfiguration] = []
    for value in raw_values:
        parsed_values.append(
            _parse_configuration(
                value,
                query_field=query_field,
                redundant_prefixes=ordered_prefixes,
            )
        )

    available_signatures = {parsed.signature for parsed in parsed_values}
    grouped: dict[
        tuple[tuple[str, ...], tuple[str, ...]],
        list[tuple[_ParsedConfiguration, bool]],
    ] = {}
    for parsed in parsed_values:
        collapsed_battery_alias = (
            allow_redundant_battery_aliases
            and parsed.battery_alias_signature is not None
            and parsed.battery_alias_signature in available_signatures
        )
        signature = (
            parsed.battery_alias_signature
            if collapsed_battery_alias
            else parsed.signature
        )
        assert signature is not None
        grouped.setdefault(signature, []).append(
            (parsed, collapsed_battery_alias)
        )

    options: list[VehicleTrimOption] = []
    for signature, configurations in grouped.items():
        if len({item.raw.casefold() for item, _ in configurations}) > (
            MAX_VEHICLE_TRIM_QUERY_VALUES
        ):
            raise VehicleTrimQueryValuesLimitError(
                "vehicle trim option has too many provider query values"
            )
        preferred, _ = min(
            configurations,
            key=lambda item: (
                1 if item[1] else 0,
                *item[0].preference,
            ),
        )
        values = tuple(
            configuration.raw for configuration, _ in configurations
        )
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


def normalize_vehicle_trim_catalog(
    raw_trims: list[str] | tuple[str, ...],
    raw_versions: list[str] | tuple[str, ...],
    *,
    source: str,
    redundant_prefixes: tuple[str, ...] = (),
    battery_electric_only: bool = False,
) -> tuple[VehicleTrimOption, ...]:
    """Prefer detailed versions without losing trim-only configurations.

    Version facets can describe drivetrain, powertrain, cab, battery, and other
    material configuration details, but some provider records expose only a
    trim. Exact cross-field matches keep the more precise version identity;
    every non-exact trim remains available, with related generic fallbacks
    labelled as configuration-unspecified instead of being silently hidden.
    """

    if not isinstance(battery_electric_only, bool):
        raise TypeError("battery-electric catalog policy must be a boolean")

    trim_options = normalize_vehicle_trim_options(
        raw_trims,
        source=source,
        query_field="trim",
        redundant_prefixes=redundant_prefixes,
    )
    version_options = normalize_vehicle_trim_options(
        raw_versions,
        source=source,
        query_field="version",
        redundant_prefixes=redundant_prefixes,
        allow_redundant_battery_aliases=battery_electric_only,
    )

    retained_trim_options = tuple(
        _clarify_trim_fallback(option, version_options)
        for option in trim_options
        if _matching_version_option_index(option, version_options) is None
    )
    combined = (*version_options, *retained_trim_options)
    if len(combined) > MAX_VEHICLE_TRIM_OPTIONS:
        raise ValueError("vehicle trim catalog has too many options")
    return tuple(
        sorted(
            combined,
            key=lambda option: (
                _natural_sort_key(option.label),
                option.label,
                option.id,
            ),
        )
    )


def _matching_version_option_index(
    trim_option: VehicleTrimOption,
    version_options: tuple[VehicleTrimOption, ...],
) -> int | None:
    trim_raw_keys = {value.casefold() for value in trim_option.query_values}
    trim_signature = _parse_configuration(
        trim_option.label,
        query_field="trim",
    ).signature
    matches: list[int] = []
    for index, version_option in enumerate(version_options):
        if trim_raw_keys.intersection(
            value.casefold() for value in version_option.query_values
        ):
            matches.append(index)
            continue
        version_signature = _parse_configuration(
            version_option.label,
            query_field="version",
        ).signature
        if version_signature == trim_signature:
            matches.append(index)
    return matches[0] if len(matches) == 1 else None


def _clarify_trim_fallback(
    trim_option: VehicleTrimOption,
    version_options: tuple[VehicleTrimOption, ...],
) -> VehicleTrimOption:
    trim_signature = _parse_configuration(
        trim_option.label,
        query_field="trim",
    ).signature
    trim_unknown, trim_qualifiers = trim_signature
    for option in version_options:
        version_unknown, version_qualifiers = _parse_configuration(
            option.label,
            query_field="version",
        ).signature
        if (
            version_unknown == trim_unknown
            and set(trim_qualifiers).issubset(version_qualifiers)
        ):
            clarified_label = (
                f"{trim_option.label} (configuration not specified)"
            )
            if len(clarified_label) > MAX_VEHICLE_CATALOG_TEXT_LENGTH:
                return trim_option
            return VehicleTrimOption(
                source=trim_option.source,
                id=trim_option.id,
                label=clarified_label,
                trim=trim_option.trim,
                query_field=trim_option.query_field,
                query_values=trim_option.query_values,
            )
    return trim_option


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
    "MAX_VEHICLE_TRIM_QUERY_VALUES",
    "MIN_VEHICLE_CATALOG_YEAR",
    "VEHICLE_TRIM_QUERY_FIELDS",
    "VehicleTrimCatalogProvider",
    "VehicleTrimCatalogRequest",
    "VehicleTrimOption",
    "VehicleTrimQueryValuesLimitError",
    "maximum_vehicle_catalog_year",
    "normalize_vehicle_trim_catalog",
    "normalize_vehicle_trim_options",
]
