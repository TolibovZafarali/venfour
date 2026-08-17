"""US ZIP-code normalization for consumer analysis entry points."""

from __future__ import annotations

import re


_US_ZIP_CODE_PATTERN = re.compile(r"[0-9]{5}(?:-[0-9]{4})?")


def normalize_us_zip_code(value: object) -> str:
    """Return a trimmed 5-digit ZIP or ZIP+4, rejecting other values."""

    if not isinstance(value, str):
        raise TypeError("US ZIP code must be a string")
    normalized = value.strip()
    if _US_ZIP_CODE_PATTERN.fullmatch(normalized) is None:
        raise ValueError("US ZIP code must contain 5 digits or use ZIP+4")
    return normalized


__all__ = ["normalize_us_zip_code"]
