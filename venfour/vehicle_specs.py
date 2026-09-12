"""Conservative, provider-neutral comparison of explicitly recorded specifications.

Vocabulary aliases are evidence of equivalent descriptions, not evidence of an
unrecorded specification. Partial descriptions may conflict on a known attribute
but cannot certify an unknown one. Raw inputs remain in every comparison.
"""

from __future__ import annotations

import copy
import re
from collections.abc import Mapping
from decimal import Decimal
from typing import Any


VERSION = "2"
_UNKNOWN = {"", "unknown", "not sure", "other", "other not sure", "n a", "none", "not applicable"}


def words(value: Any) -> str:
    if isinstance(value, bool) or value is None:
        return ""
    return " ".join(re.sub(r"[^a-z0-9]+", " ", str(value).casefold()).split())


def _aliases(groups: Mapping[str, tuple[str, ...]]) -> dict[str, str]:
    return {words(alias): canonical for canonical, aliases in groups.items() for alias in (canonical, *aliases)}


_BODY = _aliases({
    "suv": ("sport utility", "sports utility", "sport utility vehicle", "sports utility vehicle", "crossover", "crossover SUV", "crossover utility vehicle", "CUV",
            "Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)", "Sport Utility Vehicle [SUV]/Multipurpose Vehicle [MPV]"),
    "sedan": ("sedan/saloon", "saloon"), "hatchback": ("hatchback/liftback/notchback", "liftback"),
    "convertible": ("convertible/cabriolet", "cabriolet"), "coupe": (),
    "pickup": ("pickup truck", "truck"), "wagon": ("station wagon", "estate"), "minivan": ("mini van",), "van": (),
})
_DRIVE = _aliases({
    "FWD": ("front wheel drive", "FWD/Front-Wheel Drive"), "RWD": ("rear wheel drive", "RWD/Rear-Wheel Drive"),
    "AWD": ("all wheel drive", "AWD/All-Wheel Drive"), "4WD": ("four wheel drive", "4 wheel drive", "4x4", "4WD/4-Wheel Drive/4x4"),
})
_FUEL = _aliases({
    "gasoline": ("unleaded", "gas", "petrol", "premium unleaded", "regular unleaded"), "diesel": (),
    "electric": ("electric fuel system", "battery electric", "BEV"),
    "hybrid": ("gas/electric hybrid", "gasoline hybrid", "electric / unleaded", "gasoline / electric", "HEV"),
    "plug-in hybrid": ("PHEV", "plug in hybrid electric"),
    "flex fuel": ("flexible fuel", "E85 / gasoline", "FFV"), "hydrogen": ("fuel cell",),
})
_CAB = _aliases({"regular": ("regular cab", "standard cab", "single cab"), "extended": ("extended cab",), "crew": ("crew cab",)})
_SIZE = _aliases({"subcompact": ("sub compact",), "compact": (), "midsize": ("mid size",), "fullsize": ("full size",), "small": (), "large": ()})


def canonical(field: str, value: Any) -> Any:
    text = words(value)
    if text in _UNKNOWN:
        return None
    if field in {"bodyType", "drivetrain", "fuelType", "cabType", "bodySubtype"}:
        return {"bodyType": _BODY, "drivetrain": _DRIVE, "fuelType": _FUEL, "cabType": _CAB, "bodySubtype": _SIZE}[field].get(text)
    if field in {"doors", "cylinders"}:
        match = re.fullmatch(r"(\d{1,2})(?: 0)?(?: doors?| cylinders?| cyl)?", text)
        return int(match[1]) if match and 0 < int(match[1]) < 20 else None
    if field == "bedLength":
        match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(in(?:ches)?|\"|ft|feet|foot|')\s*", str(value), re.I)
        return round(float(match[1]) * (12 if match[2].lower() in {"ft", "feet", "foot", "'"} else 1), 3) if match else None
    if field == "transmission":
        if re.search(r"\b(?:automatic|auto)\b", text) and re.search(r"\bmanual\b", text):
            return None
        kind = next((name for name, pattern in (
            ("cvt", r"\b(?:cvt|continuously variable(?: transmission)?)\b"),
            ("dct", r"\b(?:dct|dual clutch(?: transmission)?)\b"),
            ("amt", r"\b(?:amt|automated manual(?: transmission)?)\b"),
            ("automatic", r"\b(?:automatic|auto|at)\b"),
            ("manual", r"\b(?:manual|mt)\b"),
        ) if re.search(pattern, text)), None)
        speed = re.search(r"\b(\d{1,2}) (?:speed|spd)\b", text)
        return {"kind": kind, "speeds": int(speed[1]) if speed else None} if kind else None
    # Powertrain is sometimes an engine name, sometimes an electrification
    # category. Only explicit categories certify its meaning.
    if field == "powertrain":
        fuel = _FUEL.get(text)
        return ("combustion" if fuel in {"gasoline", "diesel", "flex fuel"} else fuel) or {"ice": "combustion", "internal combustion": "combustion", "internal combustion engine": "combustion"}.get(text)
    return text


def engine_attributes(facts: Mapping[str, Any]) -> dict[str, Any]:
    raw = str(facts.get("engine") or "").casefold()
    displacement_pattern = r"(?<![\d.])(\d+(?:\.\d+)?)\s*(?:l(?:iters?|itres?)?|cc)\b"
    displacement = re.search(displacement_pattern, raw)
    alternatives = {Decimal(m[1]) / (1000 if m[0].endswith("cc") else 1) for m in re.finditer(displacement_pattern, raw)}
    ambiguous_displacement = len(alternatives) > 1
    litres = None
    if displacement and not ambiguous_displacement:
        litres = Decimal(displacement[1]) / (1000 if displacement[0].endswith("cc") else 1)
        if not 0 < litres < 20:
            litres = None
    layout = re.search(r"\b([ivhlw])\s*[- ]?\s*(\d{1,2})\b", raw)
    if not layout:
        layout = re.search(r"\b(inline|in.line|v.shaped|boxer|flat)\s*[- ]?\s*(\d{1,2})\b", raw)
    cylinder = re.search(r"\b(\d{1,2})\s*[- ]?\s*(?:cylinders?|cyl)\b", raw)
    encoded = int(layout[2]) if layout else int(cylinder[1]) if cylinder else None
    explicit = canonical("cylinders", facts.get("cylinders"))
    aspiration = None
    if re.search(r"\b(?:non[ -]?turbo|naturally aspirated|n/?a)\b", raw):
        aspiration = "natural"
    elif re.search(r"\b(?:twin[ -]?turbo|biturbo)\b", raw):
        aspiration = "twin turbo"
    elif re.search(r"\b(?:turbo|turbocharged|turbodiesel)\b", raw):
        aspiration = "turbo"
    elif re.search(r"\b(?:supercharged|supercharger)\b", raw):
        aspiration = "supercharged"
    fuel = canonical("fuelType", facts.get("fuelType")) or canonical("fuelType", facts.get("powertrain"))
    power = canonical("powertrain", facts.get("powertrain"))
    engine_power = "plug-in hybrid" if re.search(r"\b(?:phev|plug[ -]?in hybrid)\b", raw) else "hybrid" if re.search(r"\b(?:hybrid|hev)\b", raw) else "electric" if re.search(r"\b(?:bev|electric motor|battery electric)\b", raw) else "combustion" if re.search(r"\b(?:non[ -]?hybrid|combustion)\b", raw) else None
    # Non-hybrid must be checked before the generic hybrid token.
    if re.search(r"\bnon[ -]?hybrid\b", raw):
        engine_power = "combustion"
    category = fuel if fuel in {"hybrid", "plug-in hybrid", "electric", "hydrogen"} else "combustion" if fuel in {"gasoline", "diesel", "flex fuel"} else None
    power_category = "combustion" if power in {"gasoline", "diesel", "flex fuel"} else power
    electrification = engine_power or power_category or category
    layout_name = ({"l": "i", "inline": "i", "in-line": "i", "in line": "i", "v-shaped": "v", "v shaped": "v", "boxer": "h", "flat": "h"}.get(layout[1], layout[1]) if layout else None)
    variant = next((name for name, pattern in (("high output", r"\b(?:high output|h o)\b"), ("standard output", r"\b(?:standard output|low output)\b")) if re.search(pattern, words(raw))), None)
    remaining = re.sub(r"\(family:.*?\)", "", raw)
    for pattern in (r"(?<![\d.])\d+(?:\.\d+)?\s*(?:l(?:iters?|itres?)?|cc)\b", r"\b(?:[ivhlw]|inline|in.line|v.shaped|boxer|flat)\s*[- ]?\s*\d{1,2}\b", r"\b\d{1,2}\s*[- ]?\s*(?:cylinders?|cyl)\b",
                    r"\b(?:naturally aspirated|non[ -]?turbo|twin[ -]?turbo|turbocharged|turbo|biturbo|supercharged|supercharger|n/a|non[ -]?hybrid|plug[ -]?in hybrid|hybrid|phev|hev|bev|battery electric|electric motor|electric|gasoline|diesel|high output|standard output|low output)\b"):
        remaining = re.sub(pattern, "", remaining)
    return {"unresolvedVariant": ambiguous_displacement or bool(words(remaining)), "variant": variant, "displacementLiters": float(litres) if litres is not None else None,
            "cylinders": explicit or encoded, "layout": layout_name, "fuel": fuel,
            "aspiration": aspiration, "electrification": electrification,
            "internalConflict": bool(explicit and encoded and explicit != encoded) or bool(engine_power and category and engine_power != category)}


def comparison(field: str, left: Any, right: Any, *, subject: Mapping[str, Any] | None = None,
               candidate: Mapping[str, Any] | None = None) -> dict[str, Any]:
    a, b = canonical(field, left), canonical(field, right)
    status, reason = "UNRESOLVED", "SPECIFICATION_NOT_ESTABLISHED"
    if field == "engine":
        a, b = engine_attributes(subject or {"engine": left}), engine_attributes(candidate or {"engine": right})
        conflicts = []
        unknown = []
        for key in ("displacementLiters", "cylinders", "layout", "fuel", "aspiration", "electrification", "variant"):
            av, bv = a[key], b[key]
            if av is not None and bv is not None:
                same = abs(av - bv) <= 0.01 if key == "displacementLiters" else av == bv
                if not same:
                    if key == "aspiration" and {av, bv} == {"turbo", "twin turbo"}:
                        unknown.append(key)
                    else:
                        conflicts.append(key)
            elif av is not None or bv is not None:
                unknown.append(key)
        if a["internalConflict"] or b["internalConflict"]:
            conflicts.append("internallyContradictoryFacts")
        if conflicts:
            status, reason = "CONFLICT", "EXPLICIT_ATTRIBUTE_CONFLICT:" + ",".join(conflicts)
        elif all(a[key] is not None and b[key] is not None for key in ("displacementLiters", "cylinders")) and not unknown and not a["unresolvedVariant"] and not b["unresolvedVariant"]:
            status, reason = "MATCH", "RECORDED_ENGINE_ATTRIBUTES_AGREE"
        elif a["electrification"] == b["electrification"] == "electric" and words(left) == words(right) and words(left) in {"electric", "electric motor", "battery electric"}:
            status, reason = "MATCH", "EXPLICIT_ELECTRIC_CONFIGURATION_AGREES"
        else:
            reason = "ENGINE_ATTRIBUTES_INCOMPLETE_OR_FAMILY_LABEL_ONLY"
    elif a is not None and b is not None:
        if a == b:
            status, reason = "MATCH", "CANONICAL_ATTRIBUTES_AGREE"
        elif field == "transmission":
            if a["kind"] != b["kind"] and {a["kind"], b["kind"]} <= {"automatic", "cvt", "dct", "amt"} and "automatic" in {a["kind"], b["kind"]}:
                reason = "GENERIC_AUTOMATIC_DOES_NOT_IDENTIFY_TRANSMISSION_TYPE"
            elif a["kind"] == b["kind"] and (a["speeds"] is None or b["speeds"] is None):
                reason = "TRANSMISSION_SPEEDS_UNRESOLVED"
            else:
                status, reason = "CONFLICT", "EXPLICIT_TRANSMISSION_CONFLICT"
        elif field == "doors" and {a, b} == {4, 5} and any(canonical("bodyType", facts.get("bodyType")) in {"suv", "hatchback", "wagon"} for facts in (subject or {}, candidate or {})):
            reason = "LIFTGATE_DOOR_COUNT_CONVENTION_UNRESOLVED"
        elif field in {"trim", "equipment"}:
            reason = "UNRECOGNIZED_VARIANT_VOCABULARY"
        else:
            status, reason = "CONFLICT", "EXPLICIT_CANONICAL_CONFLICT"
    return {"field": field, "subject": copy.deepcopy(left), "listing": copy.deepcopy(right),
            "canonicalSubject": a, "canonicalListing": b, "status": status, "reason": reason,
            "normalizationVersion": VERSION}


def material_conflicts(observations: list[Mapping[str, Any]]) -> bool:
    for index, left in enumerate(observations):
        for right in observations[index + 1:]:
            a, b = left.get("materialFacts") or {}, right.get("materialFacts") or {}
            for container, fields in (("listing", ("year", "make", "model", "trim", "drivetrain")),
                                      ("materialFacts", ("bodyType", "bodySubtype", "cabType", "bedLength", "doors", "powertrain", "engine", "fuelType", "transmission", "cylinders"))):
                if any(comparison(field, (left.get(container) or {}).get(field), (right.get(container) or {}).get(field), subject=a, candidate=b)["status"] == "CONFLICT" for field in fields):
                    return True
    return False
