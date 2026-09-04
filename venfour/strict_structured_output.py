"""Deterministic checks for the strict structured-output JSON Schema subset."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any


_ALLOWED_SCHEMA_KEYWORDS = frozenset(
    {
        "$defs",
        "$ref",
        "additionalProperties",
        "anyOf",
        "const",
        "definitions",
        "description",
        "enum",
        "exclusiveMaximum",
        "exclusiveMinimum",
        "format",
        "items",
        "maximum",
        "maxItems",
        "maxLength",
        "minimum",
        "minItems",
        "minLength",
        "multipleOf",
        "pattern",
        "properties",
        "required",
        "title",
        "type",
    }
)
_SUPPORTED_TYPES = frozenset(
    {"array", "boolean", "integer", "null", "number", "object", "string"}
)
_SUPPORTED_STRING_FORMATS = frozenset(
    {
        "date-time",
        "time",
        "date",
        "duration",
        "email",
        "hostname",
        "ipv4",
        "ipv6",
        "uuid",
    }
)
_FINE_TUNED_UNSUPPORTED_KEYWORDS = frozenset(
    {
        "format",
        "maxItems",
        "maxLength",
        "maximum",
        "minItems",
        "minLength",
        "minimum",
        "multipleOf",
        "pattern",
    }
)
_MAX_OBJECT_PROPERTIES = 5_000
_MAX_NESTING_LEVELS = 10
_MAX_SCHEMA_STRING_CHARACTERS = 120_000
_MAX_ENUM_VALUES = 1_000
_LARGE_ENUM_VALUE_THRESHOLD = 250
_MAX_LARGE_ENUM_STRING_CHARACTERS = 15_000


class StrictStructuredOutputSchemaError(ValueError):
    """One or more schema nodes are outside the supported strict subset."""

    def __init__(self, details: Sequence[str]) -> None:
        self.details = tuple(details)
        super().__init__("; ".join(self.details))


def _json_path(parts: Sequence[Any]) -> str:
    path = "$"
    for part in parts:
        if isinstance(part, int):
            path += f"[{part}]"
        elif isinstance(part, str) and part.isidentifier():
            path += f".{part}"
        else:
            path += f"[{json.dumps(part)}]"
    return path


def _resolve_local_reference(root: Mapping[str, Any], reference: str) -> Any:
    if reference == "#":
        return root
    if not reference.startswith("#/"):
        raise KeyError(reference)
    selected: Any = root
    for raw_part in reference[2:].split("/"):
        part = raw_part.replace("~1", "/").replace("~0", "~")
        if not isinstance(selected, Mapping) or part not in selected:
            raise KeyError(reference)
        selected = selected[part]
    return selected


def validate_strict_structured_output_schema(
    schema: Mapping[str, Any], *, fine_tuned: bool = False
) -> None:
    """Validate the provider-facing schema before any network request.

    The check follows every schema-bearing location used by the contract and
    enforces the provider's closed, fully-required object rule inside nullable
    objects, arrays, definitions, and composition branches as well as at root.
    """

    if not isinstance(schema, Mapping):
        raise StrictStructuredOutputSchemaError(("$: schema must be an object",))
    if not isinstance(fine_tuned, bool):
        raise TypeError("fine_tuned must be a boolean")

    errors: list[str] = []
    object_property_count = 0
    schema_string_characters = 0
    enum_value_count = 0
    if schema.get("type") != "object":
        errors.append("$: strict structured-output root must have type object")
    if "anyOf" in schema:
        errors.append("$: strict structured-output root cannot use anyOf")

    def walk(node: Any, path: tuple[Any, ...], nesting_level: int) -> None:
        nonlocal object_property_count
        nonlocal schema_string_characters
        nonlocal enum_value_count

        selected_path = _json_path(path)
        if not isinstance(node, Mapping):
            errors.append(f"{selected_path}: schema node must be an object")
            return
        if nesting_level > _MAX_NESTING_LEVELS:
            errors.append(
                f"{selected_path}: schema exceeds {_MAX_NESTING_LEVELS} nesting levels"
            )

        unsupported = sorted(set(node) - _ALLOWED_SCHEMA_KEYWORDS)
        for keyword in unsupported:
            errors.append(
                f"{selected_path}: unsupported strict schema keyword {keyword}"
            )
        if fine_tuned:
            for keyword in sorted(set(node) & _FINE_TUNED_UNSUPPORTED_KEYWORDS):
                errors.append(
                    f"{selected_path}: strict schema keyword {keyword} is unsupported for fine-tuned models"
                )

        if "format" in node:
            format_value = node["format"]
            if (
                not isinstance(format_value, str)
                or format_value not in _SUPPORTED_STRING_FORMATS
            ):
                errors.append(
                    f"{selected_path}.format: unsupported string format"
                )

        if "const" in node and isinstance(node["const"], str):
            schema_string_characters += len(node["const"])
        if "enum" in node:
            enum_values = node["enum"]
            if isinstance(enum_values, list):
                enum_value_count += len(enum_values)
                enum_string_characters = sum(
                    len(value) for value in enum_values if isinstance(value, str)
                )
                schema_string_characters += enum_string_characters
                if (
                    len(enum_values) > _LARGE_ENUM_VALUE_THRESHOLD
                    and enum_string_characters
                    > _MAX_LARGE_ENUM_STRING_CHARACTERS
                ):
                    errors.append(
                        f"{selected_path}.enum: large enum strings exceed {_MAX_LARGE_ENUM_STRING_CHARACTERS} characters"
                    )
            else:
                errors.append(f"{selected_path}.enum: must be an array")

        node_type = node.get("type")
        if isinstance(node_type, str):
            types = (node_type,)
        elif isinstance(node_type, list):
            types = tuple(node_type)
            if (
                not types
                or any(not isinstance(value, str) for value in types)
                or len(set(types)) != len(types)
            ):
                errors.append(f"{selected_path}.type: schema types are invalid")
        elif node_type is None:
            types = ()
        else:
            types = ()
            errors.append(f"{selected_path}.type: schema type is invalid")
        unknown_types = sorted(set(types) - _SUPPORTED_TYPES)
        if unknown_types:
            errors.append(
                f"{selected_path}.type: unsupported schema types {unknown_types}"
            )

        object_like = bool(
            "object" in types
            or "properties" in node
            or "required" in node
            or "additionalProperties" in node
        )
        if object_like:
            if "object" not in types:
                errors.append(
                    f"{selected_path}.type: object schema must explicitly include object"
                )
            properties = node.get("properties")
            if not isinstance(properties, Mapping):
                errors.append(f"{selected_path}.properties: must be an object")
                properties = {}
            object_property_count += len(properties)
            schema_string_characters += sum(
                len(name) for name in properties if isinstance(name, str)
            )
            if node.get("additionalProperties") is not False:
                errors.append(
                    f"{selected_path}.additionalProperties: must be false"
                )
            required = node.get("required")
            property_names = set(properties)
            if (
                not isinstance(required, list)
                or any(not isinstance(value, str) for value in required)
                or len(required) != len(set(required))
                or set(required) != property_names
            ):
                errors.append(
                    f"{selected_path}.required: must contain every property exactly once"
                )
            for name, child in properties.items():
                walk(
                    child,
                    (*path, "properties", name),
                    nesting_level + 1,
                )

        if "$ref" in node:
            reference = node["$ref"]
            if not isinstance(reference, str):
                errors.append(f"{selected_path}.$ref: reference must be a string")
            else:
                try:
                    target = _resolve_local_reference(schema, reference)
                except KeyError:
                    errors.append(
                        f"{selected_path}.$ref: reference must resolve within this schema"
                    )
                else:
                    if not isinstance(target, Mapping):
                        errors.append(
                            f"{selected_path}.$ref: reference target must be a schema object"
                        )

        if "items" in node:
            walk(node["items"], (*path, "items"), nesting_level + 1)

        if "anyOf" in node:
            branches = node["anyOf"]
            if (
                not isinstance(branches, list)
                or not branches
            ):
                errors.append(f"{selected_path}.anyOf: must be a nonempty array")
            else:
                for index, branch in enumerate(branches):
                    walk(
                        branch,
                        (*path, "anyOf", index),
                        nesting_level + 1,
                    )

        for definitions_key in ("$defs", "definitions"):
            if definitions_key not in node:
                continue
            definitions = node[definitions_key]
            definitions_path = (*path, definitions_key)
            if not isinstance(definitions, Mapping):
                errors.append(
                    f"{_json_path(definitions_path)}: definitions must be an object"
                )
                continue
            schema_string_characters += sum(
                len(name) for name in definitions if isinstance(name, str)
            )
            for name, child in definitions.items():
                walk(child, (*definitions_path, name), 1)

    walk(schema, (), 1)
    if object_property_count > _MAX_OBJECT_PROPERTIES:
        errors.append(
            f"$: schema has more than {_MAX_OBJECT_PROPERTIES} object properties"
        )
    if schema_string_characters > _MAX_SCHEMA_STRING_CHARACTERS:
        errors.append(
            f"$: schema strings exceed {_MAX_SCHEMA_STRING_CHARACTERS} characters"
        )
    if enum_value_count > _MAX_ENUM_VALUES:
        errors.append(
            f"$: schema has more than {_MAX_ENUM_VALUES} enum values"
        )
    if errors:
        raise StrictStructuredOutputSchemaError(tuple(dict.fromkeys(errors)))


__all__ = [
    "StrictStructuredOutputSchemaError",
    "validate_strict_structured_output_schema",
]
