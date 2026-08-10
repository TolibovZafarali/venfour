#!/usr/bin/env python3
"""Extract a CCC valuation report from its original PDF with OpenAI."""

from __future__ import annotations

import argparse
import copy
import json
import math
import os
import sys
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    from jsonschema import Draft202012Validator
    from jsonschema.exceptions import SchemaError
except ImportError:  # Keep imports safe so the CLI can report a clean error.
    Draft202012Validator = None

    class SchemaError(Exception):
        """Placeholder used only when jsonschema is unavailable."""


try:
    from openai import OpenAI, OpenAIError
except ImportError:  # Keep imports safe so the CLI can report a clean error.
    OpenAI = None

    class OpenAIError(Exception):
        """Placeholder used only when the OpenAI SDK is unavailable."""


REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = REPO_ROOT / "schemas" / "ccc" / "report.schema.json"
MODEL = "gpt-5.6-sol"
MAX_PDF_BYTES = 50 * 1024 * 1024

EXTRACTION_INSTRUCTIONS = """\
Extract structured facts from the supplied CCC vehicle valuation report.

This is extraction only. Do not assess whether the valuation or insurance claim is
fair, unfair, suspicious, high, low, or otherwise appropriate.

Rules:
- Use only information supported by the PDF. Never invent or estimate a value.
- Return null whenever a scalar value cannot be determined reliably.
- Include every output field. Use an empty array only when the PDF clearly contains
  no supported items for that field. If comparable or condition rows are visibly
  present, keep one item per row and use null for scalar cells that are unreadable.
- Set report.provider only to the provider visibly printed in the report, not the
  insurance carrier.
- Use only a report-level Loss Date or Loss Incident Date for report.lossDate, and
  only a field explicitly labeled Report Date for report.reportDate. Do not substitute
  Claim Reported, Last Updated, comparable update, note, history, or recall dates.
- Return money and mileage as JSON numbers without currency symbols or separators.
- Preserve every positive and negative adjustment sign. A parenthesized monetary
  adjustment is negative when the report uses accounting notation.
- Keep each comparable vehicle in its own array item. Follow a single comparable
  across pages and columns without mixing its identity, mileage, price, adjustments,
  or adjusted value with another comparable.
- Do not duplicate a comparable when it reappears on detail, summary, or contribution
  pages. Summary-only or additional comparables remain separate vehicles, but must
  not borrow adjustment amounts from detailed comparables.
- Set comparables[].number from the printed Comp number or numbered summary row,
  return comparables in numeric order, and join repeated appearances by that number.
  Bind every adjustment cell to the Comp column directly above it, including on
  continuation pages. Use arithmetic only as a cross-check, never to fill a value or
  sign that is not printed.
- Extract package, options, mileage, and condition adjustments only when the report
  explicitly attributes an amount to that category. Do not split or reverse-engineer
  a net adjustment. Use null for undisclosed category amounts; use numeric zero only
  when the PDF explicitly shows or unambiguously states zero.
- Keep the loss vehicle's condition adjustment separate from comparable-vehicle
  condition adjustments.
- For condition.items, include every component row, including rows with zero impact.
  Use the nearest section heading as category, only the row's actual inspection note
  as notes (not generic guideline text), and the exact signed amount as valueImpact.
  Populate condition.totalAdjustment only from a printed condition total; do not
  merge components or move an impact between rows.
- Use the detailed, labeled loss-vehicle fields as authoritative. Associate each
  value with its own label; do not take wrapped or nearby text from another row.
  Use only the Trim field for vehicle.trim, and a printed Transmission field for
  vehicle.transmission.
- For vehicle.bodyStyle, prefer the exact value explicitly associated with the
  Body Style label. The value must describe a physical body configuration, not a
  transmission, drivetrain, engine, package, or trim qualifier. If Body Style is
  absent, blank, or contains only such an unrelated qualifier, treat it as having
  no usable value and use an explicitly printed Body Type value as the fallback.
  Never infer a body style, and never substitute text from a composite vehicle
  heading or an adjacent row.
- Do not append cylinders, displacement, fuel, carburation, body, or transmission
  text from a composite vehicle heading to a trim.
- For vehicle.equipment, include the loss-vehicle package and each named row marked
  present by a Standard checkmark or Additional Equipment icon, once. Exclude section
  headings, odometer, absent/X rows, and equipment shown only for comparable columns.
- Express contributionPercent in percentage points as printed (for example, 12.5%
  becomes 12.5), not as a fractional ratio.
- Populate valuation.total only from an explicitly presented report total. Do not
  assume it equals adjustedVehicleValue.
- Populate valuation.conditionAdjustment from its printed value or an explicitly
  printed Total Condition Adjustments value; do not confuse a fee with an adjustment.
- Put only entries from an actual Valuation Notes section in valuationNotes. Exclude
  methodology, legends, footnotes, legal boilerplate, and added analysis.
"""


class PrototypeError(Exception):
    """Raised for an expected, user-facing prototype failure."""


class OutputValidationError(PrototypeError):
    """Raised when model JSON does not satisfy the canonical schema."""

    def __init__(self, errors: list[str]) -> None:
        super().__init__("Model output failed schema validation")
        self.errors = errors


@dataclass(frozen=True)
class AIExtractionResult:
    """Parsed model output and request metadata before local validation."""

    data: Any
    model: str
    usage: dict[str, int | None] | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Send an original CCC PDF to OpenAI and validate the extracted JSON "
            "against schemas/ccc/report.schema.json."
        )
    )
    parser.add_argument("input_pdf", type=Path, help="Path to the source CCC PDF")
    parser.add_argument("output_json", type=Path, help="Path for validated JSON")
    return parser.parse_args()


def validate_input(input_path: Path) -> None:
    if not input_path.exists():
        raise PrototypeError(f"Input file does not exist: {input_path}")
    if not input_path.is_file():
        raise PrototypeError(f"Input path is not a file: {input_path}")
    if input_path.suffix.lower() != ".pdf":
        raise PrototypeError(f"Input is not a PDF: {input_path}")

    try:
        size = input_path.stat().st_size
        with input_path.open("rb") as pdf_file:
            header = pdf_file.read(1024)
    except OSError as exc:
        raise PrototypeError(f"PDF cannot be read: {input_path} ({exc})") from exc

    if b"%PDF-" not in header:
        raise PrototypeError(f"Input is not a PDF: {input_path}")
    if size >= MAX_PDF_BYTES:
        raise PrototypeError(
            f"PDF is too large for one OpenAI request (must be under 50 MB): "
            f"{input_path}"
        )


def require_api_key() -> None:
    if not os.environ.get("OPENAI_API_KEY"):
        raise PrototypeError("OPENAI_API_KEY is not set")


def require_dependencies() -> None:
    missing: list[str] = []
    if OpenAI is None:
        missing.append("openai")
    if Draft202012Validator is None:
        missing.append("jsonschema")
    if missing:
        names = ", ".join(missing)
        raise PrototypeError(
            f"Missing Python package(s): {names}. Install dependencies with "
            "'python3 -m pip install -r requirements.txt'."
        )


def read_canonical_schema() -> dict[str, Any]:
    try:
        raw_schema = SCHEMA_PATH.read_text(encoding="utf-8")
    except OSError as exc:
        raise PrototypeError(
            f"Schema could not be read: {SCHEMA_PATH} ({exc})"
        ) from exc

    try:
        schema = json.loads(raw_schema)
    except json.JSONDecodeError as exc:
        raise PrototypeError(
            f"Schema is not valid JSON: {SCHEMA_PATH} "
            f"(line {exc.lineno}, column {exc.colno}: {exc.msg})"
        ) from exc

    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError as exc:
        raise PrototypeError(f"Canonical schema is invalid: {exc.message}") from exc

    return schema


def make_openai_schema(canonical_schema: dict[str, Any]) -> dict[str, Any]:
    """Make a strict API-only copy without changing the canonical schema.

    Structured Outputs requires every object property to be required and every
    object to reject additional properties. The canonical schema intentionally
    remains untouched and is still used for local validation.
    """

    api_schema = copy.deepcopy(canonical_schema)
    api_schema.pop("$schema", None)

    def make_objects_strict(node: Any) -> None:
        if isinstance(node, dict):
            node_type = node.get("type")
            is_object = node_type == "object" or (
                isinstance(node_type, list) and "object" in node_type
            )
            if is_object:
                properties = node.get("properties", {})
                node["required"] = list(properties)
                node["additionalProperties"] = False
            for value in node.values():
                make_objects_strict(value)
        elif isinstance(node, list):
            for value in node:
                make_objects_strict(value)

    make_objects_strict(api_schema)
    return api_schema


def upload_pdf(client: Any, input_path: Path) -> str:
    try:
        pdf_file = input_path.open("rb")
    except OSError as exc:
        raise PrototypeError(f"PDF cannot be read: {input_path} ({exc})") from exc

    try:
        with pdf_file:
            uploaded = client.files.create(file=pdf_file, purpose="user_data")
    except OSError as exc:
        raise PrototypeError(
            f"PDF could not be read during upload: {input_path} ({exc})"
        ) from exc
    except OpenAIError as exc:
        raise PrototypeError(f"PDF upload failed: {exc}") from exc

    file_id = getattr(uploaded, "id", None)
    if not file_id:
        raise PrototypeError("PDF upload failed: OpenAI returned no file ID")
    return str(file_id)


def delete_uploaded_file(client: Any, file_id: str) -> None:
    try:
        client.files.delete(file_id)
    except OpenAIError as exc:
        print(
            f"Warning: uploaded OpenAI file {file_id} could not be deleted: {exc}",
            file=sys.stderr,
        )


def request_extraction(
    client: Any, file_id: str, api_schema: dict[str, Any]
) -> Any:
    try:
        return client.responses.create(
            model=MODEL,
            instructions=EXTRACTION_INSTRUCTIONS,
            input=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_file",
                            "file_id": file_id,
                            "detail": "high",
                        },
                        {
                            "type": "input_text",
                            "text": (
                                "Extract every field represented by the supplied "
                                "JSON schema from this original CCC PDF."
                            ),
                        },
                    ],
                }
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "ccc_valuation_report",
                    "schema": api_schema,
                    "strict": True,
                }
            },
            max_output_tokens=20_000,
            store=False,
        )
    except OpenAIError as exc:
        raise PrototypeError(f"OpenAI extraction request failed: {exc}") from exc


def get_field(value: Any, name: str, default: Any = None) -> Any:
    if isinstance(value, Mapping):
        return value.get(name, default)
    return getattr(value, name, default)


def find_refusal(response: Any) -> str | None:
    for output_item in get_field(response, "output", []) or []:
        for content_item in get_field(output_item, "content", []) or []:
            if get_field(content_item, "type") == "refusal":
                refusal = get_field(content_item, "refusal")
                return str(refusal) if refusal else "The model refused the request"
    return None


def response_text(response: Any) -> str:
    refusal = find_refusal(response)
    if refusal:
        raise PrototypeError(f"OpenAI model refusal: {refusal}")

    status = get_field(response, "status")
    if status and status != "completed":
        error = get_field(response, "error")
        error_message = get_field(error, "message")
        details = get_field(response, "incomplete_details")
        reason = get_field(details, "reason", "unknown reason")
        explanation = error_message or reason
        raise PrototypeError(f"OpenAI response was not completed: {explanation}")

    for output_item in get_field(response, "output", []) or []:
        if get_field(output_item, "type") != "message":
            continue
        message_status = get_field(output_item, "status")
        if message_status and message_status != "completed":
            raise PrototypeError(
                "OpenAI returned an incomplete output message: "
                f"{message_status}"
            )

    text = get_field(response, "output_text", "")
    if callable(text):
        text = text()
    if not isinstance(text, str) or not text.strip():
        raise PrototypeError("OpenAI returned no usable JSON output")
    return text.strip()


def parse_model_json(raw_output: str) -> Any:
    try:
        data = json.loads(raw_output)
    except json.JSONDecodeError as exc:
        raise PrototypeError(
            "OpenAI output was not valid JSON "
            f"(line {exc.lineno}, column {exc.colno}: {exc.msg})"
        ) from exc
    except ValueError as exc:
        raise PrototypeError(
            f"OpenAI output could not be parsed as JSON: {exc}"
        ) from exc

    def reject_non_finite_numbers(value: Any, path: str = "$") -> None:
        if isinstance(value, float) and not math.isfinite(value):
            raise PrototypeError(
                f"OpenAI output contained a non-finite number at {path}"
            )
        if isinstance(value, dict):
            for key, child in value.items():
                reject_non_finite_numbers(child, f"{path}[{json.dumps(key)}]")
        elif isinstance(value, list):
            for index, child in enumerate(value):
                reject_non_finite_numbers(child, f"{path}[{index}]")

    reject_non_finite_numbers(data)
    return data


def json_path(parts: Any) -> str:
    path = "$"
    for part in parts:
        if isinstance(part, int):
            path += f"[{part}]"
        elif isinstance(part, str) and part.isidentifier():
            path += f".{part}"
        else:
            path += f"[{json.dumps(part)}]"
    return path


def validate_output(data: Any, canonical_schema: dict[str, Any]) -> None:
    validator = Draft202012Validator(canonical_schema)
    errors = sorted(
        validator.iter_errors(data),
        key=lambda error: (list(error.absolute_path), error.message),
    )
    if errors:
        messages = [
            f"{json_path(error.absolute_path)}: {error.message}" for error in errors
        ]
        raise OutputValidationError(messages)


def validate_comparable_numbers(data: Any) -> None:
    if not isinstance(data, dict) or not isinstance(data.get("comparables"), list):
        return

    first_indexes: dict[int, int] = {}
    errors: list[str] = []
    for index, comparable in enumerate(data["comparables"]):
        if not isinstance(comparable, dict):
            continue
        number = comparable.get("number")
        if not isinstance(number, int) or isinstance(number, bool):
            continue
        if number in first_indexes:
            errors.append(
                f"$.comparables[{index}].number: duplicate comparable number "
                f"{number} (first used at index {first_indexes[number]})"
            )
        else:
            first_indexes[number] = index
    if errors:
        raise OutputValidationError(errors)


def validate_extraction(data: Any, canonical_schema: dict[str, Any]) -> None:
    """Apply the complete local validation contract for extracted report data."""

    validate_output(data, canonical_schema)
    validate_output(data, make_openai_schema(canonical_schema))
    validate_comparable_numbers(data)


def write_output(output_path: Path, data: Any) -> None:
    temporary_path: Path | None = None
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=output_path.parent,
            prefix=f".{output_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            json.dump(
                data,
                temporary_file,
                indent=2,
                ensure_ascii=False,
                allow_nan=False,
            )
            temporary_file.write("\n")
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_path, output_path)
    except (OSError, TypeError, ValueError) as exc:
        if temporary_path is not None:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                pass
        raise PrototypeError(
            f"Output JSON could not be written: {output_path} ({exc})"
        ) from exc


def print_usage(response: Any) -> None:
    usage = get_field(response, "usage")
    if usage is None:
        print("OpenAI usage: unavailable")
        return

    input_tokens = get_field(usage, "input_tokens")
    output_tokens = get_field(usage, "output_tokens")
    total_tokens = get_field(usage, "total_tokens")
    input_details = get_field(usage, "input_tokens_details")
    output_details = get_field(usage, "output_tokens_details")
    cached_tokens = get_field(input_details, "cached_tokens")
    cache_write_tokens = get_field(input_details, "cache_write_tokens")
    reasoning_tokens = get_field(output_details, "reasoning_tokens")
    model = get_field(response, "model", MODEL)
    summary = (
        f"OpenAI usage ({model}): "
        f"input_tokens={input_tokens}, output_tokens={output_tokens}, "
        f"total_tokens={total_tokens}"
    )
    details = []
    if cached_tokens is not None:
        details.append(f"cached_input_tokens={cached_tokens}")
    if cache_write_tokens is not None:
        details.append(f"cache_write_input_tokens={cache_write_tokens}")
    if reasoning_tokens is not None:
        details.append(f"reasoning_output_tokens={reasoning_tokens}")
    if details:
        summary += ", " + ", ".join(details)
    print(summary)


def usage_details(response: Any) -> dict[str, int | None] | None:
    """Return the token fields reported by OpenAI in a JSON-friendly shape."""

    usage = get_field(response, "usage")
    if usage is None:
        return None

    input_details = get_field(usage, "input_tokens_details")
    output_details = get_field(usage, "output_tokens_details")
    return {
        "inputTokens": get_field(usage, "input_tokens"),
        "outputTokens": get_field(usage, "output_tokens"),
        "totalTokens": get_field(usage, "total_tokens"),
        "cachedInputTokens": get_field(input_details, "cached_tokens"),
        "cacheWriteInputTokens": get_field(input_details, "cache_write_tokens"),
        "reasoningOutputTokens": get_field(output_details, "reasoning_tokens"),
    }


def extract_report_with_openai(
    input_path: Path,
    canonical_schema: dict[str, Any],
) -> AIExtractionResult:
    """Run the existing live extraction boundary and return parsed model data.

    Canonical, API-strict, and comparable-number validation remain the caller's
    responsibility so orchestration layers can apply the exact same checks to
    live and deterministic fake extraction results.
    """

    validate_input(input_path)
    require_api_key()
    require_dependencies()
    api_schema = make_openai_schema(canonical_schema)

    try:
        client = OpenAI()
    except OpenAIError as exc:
        raise PrototypeError(
            f"OpenAI client could not be initialized: {exc}"
        ) from exc

    file_id = upload_pdf(client, input_path)
    try:
        response = request_extraction(client, file_id, api_schema)
    finally:
        delete_uploaded_file(client, file_id)

    # Preserve usage reporting as soon as a billable response is available,
    # including when parsing or downstream validation later fails.
    print_usage(response)
    data = parse_model_json(response_text(response))
    return AIExtractionResult(
        data=data,
        model=str(get_field(response, "model", MODEL) or MODEL),
        usage=usage_details(response),
    )


def main() -> int:
    args = parse_args()
    input_path = args.input_pdf.expanduser()
    output_path = args.output_json.expanduser()

    try:
        if input_path.resolve() == output_path.resolve():
            raise PrototypeError("Input and output paths must be different")
        validate_input(input_path)
        require_api_key()
        require_dependencies()
        canonical_schema = read_canonical_schema()

        extraction = extract_report_with_openai(input_path, canonical_schema)
        data = extraction.data
        validate_extraction(data, canonical_schema)
        write_output(output_path, data)
    except OutputValidationError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        for message in exc.errors:
            print(f"  - {message}", file=sys.stderr)
        return 1
    except (PrototypeError, OSError, RuntimeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(f"Extracted {input_path} to {output_path} with {MODEL}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
