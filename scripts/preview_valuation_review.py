"""Render fictional review samples from a frozen local evidence envelope."""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

import pymupdf

from venfour.package_assessment import canonical_package_digest
from venfour.valuation_evidence_report import (
    build_valuation_evidence_report_v1,
    render_valuation_evidence_report_pdf_v1,
    validate_valuation_evidence_report_pdf_v1,
)


def write_sample(report, output, name):
    report = copy.deepcopy(report)
    report["reportDigest"] = canonical_package_digest({key: value for key, value in report.items() if key != "reportDigest"})
    pdf = render_valuation_evidence_report_pdf_v1(report, fictional=True)
    manifest = validate_valuation_evidence_report_pdf_v1(pdf, report)
    path = output / f"fictional-{name}.pdf"
    path.write_bytes(pdf)
    (output / f"fictional-{name}.json").write_text(json.dumps(report, indent=2) + "\n")
    for old_page in output.glob(f"fictional-{name}-page-*.png"):
        old_page.unlink()
    for old_page in output.glob(f"fictional-{name}-gray-*.png"):
        old_page.unlink()
    with pymupdf.open(stream=pdf, filetype="pdf") as document:
        for number, page in enumerate(document, 1):
            page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False).save(output / f"fictional-{name}-page-{number}.png")
            page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), colorspace=pymupdf.csGRAY, alpha=False).save(output / f"fictional-{name}-gray-{number}.png")
    return {"file": path.name, "pages": manifest.page_count, "sha256": manifest.pdf_sha256}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixture", type=Path, help="JSON containing source, assessment and original report; fictional data only")
    parser.add_argument("--name", required=True)
    parser.add_argument("--output", type=Path, default=Path("output/pdf/valuation-review"))
    parser.add_argument("--edge-cases", action="store_true", help="Also render explicitly fictional presentation stress variants")
    args = parser.parse_args()
    data = json.loads(args.fixture.read_text())
    identity = data["report"]["identity"]
    report = build_valuation_evidence_report_v1(
        source_snapshot=data["source"], final_assessment=data["assessment"],
        report_series_id=identity["reportSeriesId"], report_version_id=identity["reportVersionId"],
        final_assessment_id=identity["finalAssessmentId"], version_number=identity["versionNumber"],
        generated_at=identity["generatedAt"],
    ).to_dict()
    args.output.mkdir(parents=True, exist_ok=True)
    results = [write_sample(report, args.output, args.name)]
    if args.edge_cases:
        missing = copy.deepcopy(report)
        missing["reviewContext"].update(vin=None, trimVerified=False, vehicleDisplay="2024 Synthetic Sedan", sharedVehicleDescription="2024 Synthetic Sedan")
        for key in ("insurerName", "claimReference"):
            missing["insurerValuationReviewed"][key].update(value=None, displayValue="Unavailable", evidenceLabel="UNAVAILABLE", evidenceIds=[])
        results.append(write_sample(missing, args.output, "missing-identification"))
        insufficient = copy.deepcopy(report)
        insufficient["executiveConclusion"].update(classification="INSUFFICIENT_EVIDENCE", evidenceStrength="INSUFFICIENT", supportedAdvertisedPriceRange=None)
        insufficient["independentMarketEvidence"].update(primary=None, secondary=None, comparables=[])
        insufficient["insurerComparableReview"]["comparables"] = []
        results.append(write_sample(insufficient, args.output, "insufficient-evidence"))
        stress = copy.deepcopy(report)
        primary = [row for row in stress["independentMarketEvidence"]["comparables"] if row["role"] == "PRIMARY"]
        stress["independentMarketEvidence"]["comparables"] = []
        for number in range(18):
            row = copy.deepcopy(primary[number % len(primary)])
            row.update(vin=f"FICTIONALVIN{number:05}", sourceListingId=f"fictional-layout-{number}", dealer="Fictional International Automotive and Specialty Vehicle Retail Center " * 2,
                       vehicleDisplay="2024 Synthetic Sedan Extended Touring Special Equipment Edition")
            stress["independentMarketEvidence"]["comparables"].append(row)
        stress["independentMarketEvidence"]["secondary"] = None
        stress["independentMarketEvidence"]["primary"]["selectedCount"] = 18
        stress["independentMarketEvidence"]["primary"]["prices"]["count"] = 18
        stress["reviewContext"]["sharedVehicleDescription"] = None
        stress["reviewContext"]["comparables"][0]["listingUrl"] = "https://listings.invalid/" + "long-vehicle-reference-" * 60
        results.append(write_sample(stress, args.output, "large-set"))
        # These variants exercise layout only; they are not new analysis results.
    (args.output / f"{args.name}-manifest.json").write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
