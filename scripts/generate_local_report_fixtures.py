"""Generate clearly synthetic valuation-report fixtures for local browser QA."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable, Sequence

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIRECTORY = REPOSITORY_ROOT / "output" / "pdf"

NAVY = colors.HexColor("#17324D")
GREEN = colors.HexColor("#216247")
PALE_GREEN = colors.HexColor("#E8F1EC")
PALE_BLUE = colors.HexColor("#EDF3F8")
INK = colors.HexColor("#172019")
MUTED = colors.HexColor("#58655D")
LINE = colors.HexColor("#CBD5CE")

STYLES = getSampleStyleSheet()
TITLE_STYLE = ParagraphStyle(
    "FixtureTitle",
    parent=STYLES["Title"],
    textColor=NAVY,
    fontName="Helvetica-Bold",
    fontSize=23,
    leading=28,
    spaceAfter=8,
)
BADGE_STYLE = ParagraphStyle(
    "FixtureBadge",
    parent=STYLES["Normal"],
    textColor=colors.HexColor("#9B2C2C"),
    fontName="Helvetica-Bold",
    fontSize=9,
    leading=12,
    alignment=TA_CENTER,
    spaceAfter=18,
)
SECTION_STYLE = ParagraphStyle(
    "FixtureSection",
    parent=STYLES["Heading2"],
    textColor=GREEN,
    fontName="Helvetica-Bold",
    fontSize=14,
    leading=17,
    spaceBefore=8,
    spaceAfter=7,
)
BODY_STYLE = ParagraphStyle(
    "FixtureBody",
    parent=STYLES["BodyText"],
    textColor=INK,
    fontName="Helvetica",
    fontSize=9.5,
    leading=13,
)
TABLE_HEADER_STYLE = ParagraphStyle(
    "FixtureTableHeader",
    parent=BODY_STYLE,
    textColor=colors.white,
    fontName="Helvetica-Bold",
)
NOTE_STYLE = ParagraphStyle(
    "FixtureNote",
    parent=BODY_STYLE,
    textColor=MUTED,
    fontSize=8.5,
    leading=12,
    spaceBefore=12,
)


def paragraph(value: object, *, bold: bool = False) -> Paragraph:
    text = str(value)
    if bold:
        text = f"<b>{text}</b>"
    return Paragraph(text, BODY_STYLE)


def key_value_table(rows: Sequence[tuple[str, str]]) -> Table:
    table = Table(
        [[paragraph(label, bold=True), paragraph(value)] for label, value in rows],
        colWidths=[2.05 * inch, 4.25 * inch],
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), PALE_BLUE),
                ("TEXTCOLOR", (0, 0), (-1, -1), INK),
                ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def data_table(headers: Sequence[str], rows: Sequence[Sequence[str]]) -> Table:
    available_width = 6.3 * inch
    width = available_width / len(headers)
    table = Table(
        [
            [Paragraph(header, TABLE_HEADER_STYLE) for header in headers],
            *[[paragraph(value) for value in row] for row in rows],
        ],
        colWidths=[width] * len(headers),
        repeatRows=1,
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("BACKGROUND", (0, 1), (-1, -1), colors.white),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE_BLUE]),
                ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def page_footer(canvas, document) -> None:  # type: ignore[no-untyped-def]
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.line(0.7 * inch, 0.53 * inch, 7.8 * inch, 0.53 * inch)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(0.7 * inch, 0.35 * inch, "Venfour synthetic local fixture")
    canvas.drawRightString(
        7.8 * inch,
        0.35 * inch,
        f"Page {document.page}",
    )
    canvas.restoreState()


def build_fixture(
    filename: str,
    title: str,
    subtitle: str,
    sections: Iterable[tuple[str, object]],
    note: str,
) -> Path:
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIRECTORY / filename
    document = SimpleDocTemplate(
        str(output_path),
        pagesize=letter,
        rightMargin=0.7 * inch,
        leftMargin=0.7 * inch,
        topMargin=0.62 * inch,
        bottomMargin=0.72 * inch,
        title=title,
        author="Venfour",
        subject="Synthetic local valuation-report fixture",
    )
    story: list[object] = [
        Paragraph(title, TITLE_STYLE),
        Paragraph(subtitle, BODY_STYLE),
        Spacer(1, 8),
        Paragraph("SYNTHETIC LOCAL TEST FIXTURE - NOT A CUSTOMER REPORT", BADGE_STYLE),
    ]

    for heading, content in sections:
        story.append(
            KeepTogether(
                [
                    Paragraph(heading, SECTION_STYLE),
                    content,
                    Spacer(1, 6),
                ]
            )
        )

    story.append(Paragraph(note, NOTE_STYLE))
    document.build(story, onFirstPage=page_footer, onLaterPages=page_footer)
    return output_path


def main() -> None:
    outputs = [
        build_fixture(
            "venfour-local-ccc-complete.pdf",
            "CCC ONE - Market Valuation Report",
            "Prepared for Example Mutual Insurance - CCC-format local ingestion fixture",
            [
                (
                    "Claim information",
                    key_value_table(
                        [
                            ("Owner", "Taylor Example"),
                            ("Loss incident date", "August 15, 2026"),
                            ("Claim reference", "LOCAL-CCC-0001"),
                            ("Market ZIP code", "78701"),
                        ]
                    ),
                ),
                (
                    "Loss vehicle",
                    key_value_table(
                        [
                            ("VIN", "1HGCV1F43MA000001"),
                            ("Year / make / model", "2021 Honda Accord"),
                            ("Trim", "EX-L"),
                            ("Body style", "4-door sedan"),
                            ("Odometer", "47,850 miles"),
                            ("Pre-loss condition", "Average - normal wear"),
                            (
                                "Options and packages",
                                "Power moonroof; heated seats; blind-spot monitoring",
                            ),
                        ]
                    ),
                ),
                (
                    "Valuation summary",
                    key_value_table(
                        [
                            ("Base vehicle value", "$24,850"),
                            ("Condition adjustment", "-$425"),
                            ("Mileage adjustment", "-$300"),
                            ("Adjusted vehicle value", "$24,125"),
                        ]
                    ),
                ),
                (
                    "Comparable vehicles",
                    data_table(
                        ["Comparable", "Mileage", "Price", "Distance"],
                        [
                            ["2021 Accord EX-L - Example Dealer A", "44,210", "$25,490", "8 mi"],
                            ["2021 Accord EX-L - Example Dealer B", "51,330", "$24,690", "19 mi"],
                            ["2021 Accord EX-L - Example Dealer C", "46,005", "$25,150", "31 mi"],
                        ],
                    ),
                ),
            ],
            "All people, references, dealers, values, and vehicle identifiers in this document are fictional and intended only to exercise the CCC-specific extraction and confirmation path.",
        ),
        build_fixture(
            "venfour-local-unknown-provider-complete.pdf",
            "Independent Vehicle Valuation Summary",
            "Northstar Vehicle Valuations - provider-neutral local ingestion fixture",
            [
                (
                    "Report details",
                    key_value_table(
                        [
                            ("Valuation provider", "Northstar Vehicle Valuations (fictional)"),
                            ("Report reference", "LOCAL-UNKNOWN-0001"),
                            ("Loss date", "August 15, 2026"),
                            ("Market ZIP code", "78701"),
                            ("Insurer", "Example Mutual Insurance"),
                        ]
                    ),
                ),
                (
                    "Loss vehicle",
                    key_value_table(
                        [
                            ("VIN", "1HGCV1F43MA000001"),
                            ("Year / make / model", "2021 Honda Accord"),
                            ("Trim", "EX-L"),
                            ("Odometer", "47,850 miles"),
                            ("Pre-loss condition", "Average - normal wear"),
                            ("Options and packages", "Heated seats; power moonroof"),
                        ]
                    ),
                ),
                (
                    "Valuation calculation",
                    key_value_table(
                        [
                            ("Base market value", "$24,850"),
                            ("Condition adjustment", "-$425"),
                            ("Mileage adjustment", "-$300"),
                            ("Adjusted vehicle value", "$24,125"),
                        ]
                    ),
                ),
                (
                    "Comparable vehicles",
                    data_table(
                        ["Comparable", "Mileage", "Advertised price", "Distance"],
                        [
                            ["2021 Accord EX-L - Fictional Dealer A", "44,210", "$25,490", "8 mi"],
                            ["2021 Accord EX-L - Fictional Dealer B", "51,330", "$24,690", "19 mi"],
                        ],
                    ),
                ),
            ],
            "This fictional provider and synthetic data exercise Venfour's provider-neutral report path. This document is not an appraisal, settlement offer, customer record, or insurer report.",
        ),
        build_fixture(
            "venfour-local-incomplete-report.pdf",
            "Partial Vehicle Valuation Notes",
            "Unidentified source - intentionally incomplete local ingestion fixture",
            [
                (
                    "Readable details",
                    key_value_table(
                        [
                            ("Vehicle", "2021 Honda Accord"),
                            ("Odometer", "Approximately 47,850 miles"),
                            ("Loss date", "August 15, 2026"),
                            ("Insurer", "Example Mutual Insurance"),
                        ]
                    ),
                ),
                (
                    "Incomplete notes",
                    key_value_table(
                        [
                            ("Trim", "Not shown"),
                            ("Market ZIP code", "Not shown"),
                            ("Pre-loss condition", "Not shown"),
                            ("Options and packages", "Not shown"),
                            ("Vehicle value", "Illegible in source"),
                        ]
                    ),
                ),
            ],
            "This document is deliberately incomplete. It should lead to a safe partial-extraction or manual-correction experience, never a provider-not-supported dead end.",
        ),
    ]
    for output in outputs:
        print(output)


if __name__ == "__main__":
    main()
