"""Prepare an offline showcase from existing local, pre-launch evidence only."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from venfour.analysis_runs import FileAnalysisRunRepository
from venfour.presentation import AnalysisPresentationService

RUN_ID = "37310623-c6da-42fc-a7a6-2b7eea276378"
SOURCE_PDF_SHA256 = "0a5b6889214884cfdb91990f0bb7f8ef385d575b3aea12abe60586b9f60a0ada"
REPORT_ID = "44444444-4444-4444-8444-444444444444"
DEST = ROOT / "frontend/preview/showcase/generated"
LIMITS = [
    "Local historical showcase, prepared from a genuine report and a saved August 12, 2026 market-data run. No fresh valuation was performed.",
    "The original saved result found no material discrepancy. It does not support a claim of underpayment or a promised recovery.",
    "The saved search used ZIP 63123; the original report lists 63026. Distances retain that original search origin. This legacy mismatch has not been corrected by a new search.",
    "Owner identity, street address, claim and report references, and subject VIN are withheld. Account, payment and reading-progress states are simulated locally.",
    "This is a display projection of an older saved analysis, not a current strict-review approval or an issued customer evidence package.",
    "Advertised prices are not completed sale prices or guaranteed settlement amounts. Original data gaps remain visible.",
]


def money(value):
    return {"amountMinorUnits": value["cents"], "currency": "USD", "formatted": value["display"]}


def prices(value):
    return {"count": value["count"], "low": money(value["minimumPrice"]), "high": money(value["maximumPrice"]), "median": money(value["medianPrice"])}


def description(row):
    return " ".join(str(row[k]) for k in ("year", "make", "model", "trim") if row.get(k) is not None)


def prepare():
    import pymupdf
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
    from xml.sax.saxutils import escape

    source = ROOT / "data/raw/ccc/ccc-002-elantra-state-farm.pdf"
    extracted = ROOT / "data/extracted/ccc/ccc-002-elantra-state-farm.json"
    artifact = ROOT / f"data/analysis-runs/{RUN_ID}.json"
    for path in (source, extracted, artifact):
        if not path.is_file():
            raise SystemExit(f"Required existing local source is missing: {path.relative_to(ROOT)}. No remote fallback is allowed.")
    if hashlib.sha256(source.read_bytes()).hexdigest() != SOURCE_PDF_SHA256:
        raise SystemExit("The source PDF changed. Redaction coordinates require a fresh visual privacy review.")
    p = AnalysisPresentationService(FileAnalysisRunRepository(artifact.parent)).get(RUN_ID).to_dict()
    original = json.loads(extracted.read_text())
    if p["assessment"]["classification"] != "NO_MATERIAL_DISCREPANCY" or p["cccValuation"]["adjustedVehicleValue"]["cents"] != 1904600:
        raise SystemExit("The selected source changed. Inspect it before rebuilding the showcase.")
    DEST.mkdir(parents=True, exist_ok=True)
    primary, secondary = p["primaryExternalEvidence"], p["secondaryExternalEvidence"]
    summary = p["cccComparables"]["summary"]

    def evidence(value):
        return {k: value[k] for k in ("description", "evidenceDate", "label", "selectedCount")} | {"prices": prices(value["prices"])}

    report = {
        "reportId": REPORT_ID, "status": "published", "versionNumber": 1, "versionLabel": "v1",
        "issueDate": p["analysisCreatedAt"][:10], "suggestedFilename": "Venfour_Local_Historical_Showcase.pdf",
        "subjectVehicle": {"description": description(p["vehicle"])},
        "conclusion": {
            "classificationLabel": p["assessment"]["classificationLabel"], "continuingSupported": False,
            "summary": p["assessment"]["summary"], "insurerValuation": money(p["cccValuation"]["adjustedVehicleValue"]),
            "indicatedDifference": money(p["cccValuation"]["comparisonToPrimaryEvidence"]["difference"]),
            "supportedRange": {"low": money(primary["prices"]["minimumPrice"]), "median": money(primary["prices"]["medianPrice"]), "high": money(primary["prices"]["maximumPrice"]), "evidenceBasis": primary["evidenceBasis"]},
            "limitations": LIMITS,
            "preliminaryComparison": {"status": "HISTORICAL_SHOWCASE", "summary": LIMITS[4]},
        },
        "insurerEvidence": {
            "insurerName": "State Farm", "comparableCount": summary["totalCount"],
            "summary": {k: summary[k] for k in ("totalCount", "advertisedPriceMissingCount", "adjustedValueMissingCount", "fullyDisclosedAdjustmentCount", "partiallyDisclosedAdjustmentCount", "undisclosedAdjustmentCount", "unavailableAdjustmentCount")} | {"advertisedPrices": prices(summary["advertisedPrices"]), "adjustedValues": prices(summary["adjustedValues"])},
            "comparables": [{"vehicle": description(r), "mileage": r["mileage"], "advertisedPrice": r["advertisedPrice"]["display"], "adjustedValue": r["cccAdjustedComparableValue"]["display"], "netAdjustment": r["netAdjustment"]["display"], "adjustmentDisclosure": r["adjustmentDisclosure"], "contributionPercent": r["contributionPercent"], "adjustments": {k: v["display"] if v["cents"] is not None else None for k, v in r["adjustments"].items()}} for r in p["cccComparables"]["rows"]],
            "methodologyStatement": "Original insurer values and weights are retained. Six rows lack itemized adjustments in the saved extraction; inspect the redacted original excerpt for context. Missing details are not treated as proof of an error.",
            "adjustmentContext": "The original report adds $297 in subject condition adjustments to its $18,749 base value, producing $19,046. The first six extracted comparable rows each include a $1,351 condition deduction. These facts alone do not prove an error.",
        },
        "marketEvidence": {
            "primary": evidence(primary), "secondary": evidence(secondary),
            "evidenceDateContext": {"lossDate": p["vehicle"]["lossDate"], "historicalEvidenceDate": primary["evidenceDate"], "currentObservedDate": secondary["evidenceDate"]},
            "methodologyStatement": LIMITS[2] + " Saved selection and prices are unchanged; historical and then-current prices remain separate.",
            "comparables": [{"vehicle": description(r), "mileage": r["mileage"], "advertisedPrice": r["advertisedPrice"]["display"], "dealer": (r.get("dealer") or {}).get("name"), "location": ", ".join(str((r.get("dealer") or {}).get(k)) for k in ("city", "state") if (r.get("dealer") or {}).get(k)), "distanceMiles": r["distanceMiles"], "role": r["evidenceRole"], "temporalBasis": r["temporalBasisLabel"], "evidenceDate": r["evidenceDate"]} for stream in ("primary", "secondary") for r in p["comparablesUsed"][stream]],
        },
    }
    manifest = {
        "title": description(p["vehicle"]), "classification": p["assessment"]["classification"],
        "provenance": "Existing local source PDF, extraction, and immutable MarketCheck run; no production database or storage was read.",
        "sourceRunId": RUN_ID, "capturedAt": p["analysisCreatedAt"], "limitations": LIMITS,
        "sources": [{"path": str(path.relative_to(ROOT)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in (source, extracted, artifact)],
        "sourcePdfPagesIncluded": [1, *range(6, 16)], "redaction": "Raster-only excerpt; owner/claim headers and cover identity/reference fields removed. Other pages omitted. Financial figures are unchanged.",
        "supplements": ["Local account and browser-only workflow state", "Display adapter into the current customer review components", "Locally generated historical showcase summary PDF"],
        "alternativesReviewed": ["Camry: no material discrepancy, no loss-date historical evidence", "Earlier Elantra runs: five selected historical comparables", "Synthetic fixtures: excluded as genuine case candidates"],
    }
    encoded = json.dumps({"report": report, "manifest": manifest}, indent=2)
    for private in (original["vehicle"]["vin"], original["report"]["reportReferenceNumber"], original["report"]["claimReferenceNumber"]):
        if private and private in encoded:
            raise SystemExit("Private source identifier entered the display artifact.")
    (DEST / "case.json").write_text(encoded + "\n")

    # Retain original page imagery after removing private regions, with no source text layer.
    source_doc, redacted = pymupdf.open(source), pymupdf.open()
    for number in manifest["sourcePdfPagesIncluded"]:
        page = source_doc[number - 1]
        if number != 1:
            page.add_redact_annot(pymupdf.Rect(410, 18, 595, 70), fill=(1, 1, 1))
        if number == 1:
            page.add_redact_annot(pymupdf.Rect(30, 140, 397, 210), fill=(1, 1, 1))
            page.add_redact_annot(pymupdf.Rect(30, 325, 397, 372), fill=(1, 1, 1))
        page.apply_redactions()
        if number == 1:
            page.insert_text((42, 176), "Owner information redacted for local demonstration", fontsize=9, color=(.35, .35, .35))
            page.insert_text((42, 345), "Claim and report references redacted", fontsize=9, color=(.35, .35, .35))
        image = page.get_pixmap(matrix=pymupdf.Matrix(1.6, 1.6), alpha=False)
        clean = redacted.new_page(width=page.rect.width, height=page.rect.height + 24)
        clean.insert_text((24, 13), f"LOCAL SHOWCASE - REDACTED SOURCE EXCERPT - original page {number} of 19", fontsize=8)
        clean.insert_image(pymupdf.Rect(0, 24, page.rect.width, page.rect.height + 24), stream=image.tobytes("png"))
    redacted.set_metadata({"title": "Redacted original CCC report excerpt - local showcase"})
    redacted.save(DEST / "insurer-report-redacted.pdf", garbage=4, deflate=True)

    styles = getSampleStyleSheet()
    story = [Paragraph("Venfour | Local historical showcase", styles["Title"]), Paragraph(description(p["vehicle"]), styles["Heading1"])]
    for line in LIMITS:
        story.extend([Paragraph(escape(line), styles["BodyText"]), Spacer(1, 9)])
    story.extend([Paragraph("Saved result", styles["Heading2"]), Paragraph("Insurer vehicle value: $19,046. Historical asking-price median: $19,608. Difference: $562 (2.95%). The saved analysis found no material discrepancy.", styles["BodyText"]), Paragraph("Original report context", styles["Heading2"]), Paragraph(escape(report["insurerEvidence"]["adjustmentContext"]), styles["BodyText"]), PageBreak()])
    for role, title in (("PRIMARY", "Loss-date historical evidence"), ("SECONDARY", "Then-current market context")):
        story.append(Paragraph(title, styles["Heading1"]))
        story.append(Paragraph("Selected values from the saved August 12, 2026 run. Dealer listings were not refreshed for this demonstration. Distances are from legacy ZIP 63123.", styles["BodyText"]))
        story.append(Spacer(1, 16))
        rows = [["Dealer / location", "Mileage", "Asking price", "Miles"]]
        for r in report["marketEvidence"]["comparables"]:
            if r["role"] == role:
                rows.append([Paragraph(escape((r["dealer"] or "Unknown dealer") + " / " + r["location"]), styles["BodyText"]), f'{r["mileage"]:,}', r["advertisedPrice"], str(r["distanceMiles"])])
        table = Table(rows, colWidths=[275, 65, 90, 50], repeatRows=1)
        table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eeeeee")), ("LINEBELOW", (0, 0), (-1, -1), .3, colors.HexColor("#cccccc")), ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9)]))
        story.extend([table, Spacer(1, 18), Paragraph("Advertised prices are not guaranteed sale prices or settlement amounts.", styles["BodyText"])])
        if role == "PRIMARY": story.append(PageBreak())
    SimpleDocTemplate(str(DEST / report["suggestedFilename"]), title="Local historical showcase", author="Venfour", leftMargin=44, rightMargin=44, topMargin=42, bottomMargin=42).build(story)
    print(json.dumps({"prepared": str(DEST.relative_to(ROOT)), "classification": manifest["classification"], "historicalComparables": primary["selectedCount"], "providerRequests": 0, "databaseWrites": 0}))


if __name__ == "__main__":
    prepare()
