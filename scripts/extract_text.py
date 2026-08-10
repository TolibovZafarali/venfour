#!/usr/bin/env python3
"""Extract readable, page-delimited text from a PDF with PyMuPDF."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    import pymupdf
except ImportError:  # Keep import safe so the CLI can report a clean error.
    pymupdf = None


class ExtractionError(Exception):
    """Raised when the PDF cannot be converted to useful text."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Extract text from every PDF page in reading order and add numbered "
            "page separators."
        )
    )
    parser.add_argument("input_pdf", type=Path, help="Path to the source PDF")
    parser.add_argument("output_text", type=Path, help="Path for the UTF-8 text output")
    return parser.parse_args()


def validate_input(input_path: Path) -> None:
    if not input_path.exists():
        raise ExtractionError(f"Input file does not exist: {input_path}")
    if not input_path.is_file():
        raise ExtractionError(f"Input path is not a file: {input_path}")
    try:
        with input_path.open("rb") as input_file:
            header = input_file.read(1024)
    except OSError as exc:
        raise ExtractionError(f"PDF cannot be opened: {input_path} ({exc})") from exc

    if b"%PDF-" not in header:
        raise ExtractionError(f"Input is not a PDF: {input_path}")


def extract_text(input_path: Path) -> str:
    if pymupdf is None:
        raise ExtractionError(
            "PyMuPDF is not installed. Install dependencies with "
            "'python3 -m pip install -r requirements.txt'."
        )

    validate_input(input_path)

    try:
        document = pymupdf.open(input_path)
    except (OSError, RuntimeError, pymupdf.FileDataError, pymupdf.EmptyFileError) as exc:
        raise ExtractionError(f"PDF cannot be opened: {input_path} ({exc})") from exc

    try:
        if not document.is_pdf:
            raise ExtractionError(f"Input is not a PDF: {input_path}")
        if document.needs_pass:
            raise ExtractionError(
                f"PDF cannot be opened without a password: {input_path}"
            )

        page_texts: list[str] = []
        for page in document:
            try:
                # sort=True orders text by vertical, then horizontal position.
                page_texts.append(page.get_text("text", sort=True).strip())
            except (RuntimeError, ValueError) as exc:
                raise ExtractionError(
                    f"Text extraction failed on page {page.number + 1}: {exc}"
                ) from exc
    finally:
        document.close()

    combined_text = "\n".join(page_texts)
    if not any(character.isalnum() for character in combined_text):
        raise ExtractionError(f"No useful text was extracted from: {input_path}")

    sections = [
        f"===== PAGE {page_number} =====\n{page_text}"
        for page_number, page_text in enumerate(page_texts, start=1)
    ]
    return "\n\n".join(sections) + "\n"


def write_output(output_path: Path, text: str) -> None:
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(text, encoding="utf-8")
    except OSError as exc:
        raise ExtractionError(
            f"Output file could not be written: {output_path} ({exc})"
        ) from exc


def main() -> int:
    args = parse_args()
    input_path = args.input_pdf.expanduser()
    output_path = args.output_text.expanduser()

    try:
        if input_path.resolve() == output_path.resolve():
            raise ExtractionError("Input and output paths must be different.")
        text = extract_text(input_path)
        write_output(output_path, text)
    except (ExtractionError, OSError, RuntimeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(f"Extracted text from {input_path} to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
