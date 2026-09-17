"""Build fictional local records through the current deterministic domain code."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import socket
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
DEST = ROOT / "frontend/preview/showcase/generated"
CASE_ID = "33333333-3333-4333-8333-333333333333"
USER_ID = "22222222-2222-4222-8222-222222222222"
REPORT_ID = "44444444-4444-4444-8444-444444444444"
INPUT_ID = "11111111-1111-4111-8111-111111111111"
DATE = "2026-09-16T12:00:00Z"


def uid(number):
    return f"00000000-0000-4000-8000-{number:012d}"


def money(value):
    if value is None:
        return None
    return {"amountMinorUnits": value.get("minorUnits", value.get("cents")),
            "currency": value.get("currency", "USD"), "formatted": value.get("display")}


def price_summary(value):
    if not value:
        return None
    return {"count": value["count"], "low": money(value["minimumPrice"]),
            "median": money(value["medianPrice"]), "high": money(value["maximumPrice"])}


def customer_report(value):
    """Use the current customer-delivery RPC's field projection of a built report."""
    from venfour.customer_delivery import validate_report_projection
    conclusion = value["executiveConclusion"]
    limits = value["assumptionsAndLimitations"]["limitations"]
    insurer = value["insurerComparableReview"]
    market = value["independentMarketEvidence"]
    supported = conclusion["supportedAdvertisedPriceRange"]
    difference = next(fact for row in value["adjustmentsAndCalculations"]["calculations"]
                      if row["code"] == "PRIMARY_EVIDENCE_COMPARISON" for fact in row["values"] if fact["key"] == "difference")
    def evidence(row):
        return None if row is None else {**{k: row[k] for k in ("label", "description", "evidenceDate", "selectedCount")}, "prices": price_summary(row["prices"])}
    projected = {
        "reportId": REPORT_ID, "versionNumber": 1, "versionLabel": "v1", "status": "published",
        "title": "Venfour Total-Loss Valuation Evidence Package",
        "issueDate": value["identity"]["issueDate"], "suggestedFilename": value["identity"]["suggestedFilename"],
        "subjectVehicle": {"description": value["subjectVehicle"]["vehicleDisplay"]},
        "conclusion": {
            "classificationLabel": conclusion["classificationLabel"],
            "continuingSupported": conclusion["continuationStatus"] == "SUPPORTS_CONTINUATION",
            "insurerValuation": money(conclusion["insurerValuation"]["value"]),
            "supportedRange": {**{k: money(supported[k]) for k in ("low", "median", "high")}, "evidenceBasis": "Current advertised-price evidence"},
            "indicatedDifference": {"amountMinorUnits": difference["value"], "currency": "USD", "formatted": difference["displayValue"]},
            "summary": conclusion["summary"], "limitations": [r["description"] for r in limits],
            "preliminaryComparison": {k: value["preliminaryVersusFinal"][k] for k in ("status", "summary")},
        },
        "insurerEvidence": {
            "insurerName": value["insurerValuationReviewed"]["insurerName"]["value"],
            "comparableCount": len(insurer["comparables"]),
            "summary": {**{k: insurer["summary"][k] for k in ("totalCount", "advertisedPriceMissingCount", "adjustedValueMissingCount", "fullyDisclosedAdjustmentCount", "partiallyDisclosedAdjustmentCount", "undisclosedAdjustmentCount", "unavailableAdjustmentCount")}, **{k: price_summary(insurer["summary"][k]) for k in ("advertisedPrices", "adjustedValues")}},
            "comparables": [{**{k: row.get(k) for k in ("mileage", "advertisedPrice", "adjustedValue", "netAdjustment", "adjustments", "adjustmentDisclosure", "contributionPercent")},
                             "vehicle": row["vehicleDisplay"], **({"sourcePrice": row["sourcePrice"]} if "sourcePrice" in row else {})} for row in insurer["comparables"]],
            "methodologyStatement": insurer["methodologyStatement"],
            "adjustmentContext": "Insurer adjustments are shown as disclosed in the reviewed report; Venfour does not invent missing adjustment details.",
        },
        "marketEvidence": {
            "primary": evidence(market["primary"]), "secondary": evidence(market["secondary"]),
            "comparables": [{**{k: row.get(k) for k in ("role", "mileage", "advertisedPrice", "dealer", "location", "distanceMiles", "evidenceDate", "temporalBasis")}, "vehicle": row["vehicleDisplay"]} for row in market["comparables"]],
            "methodologyStatement": value["adjustmentsAndCalculations"]["methodologyStatement"],
            "evidenceDateContext": {k: value["evidenceCutoff"][k] for k in ("lossDate", "currentObservedDate", "historicalEvidenceDate")},
            **{k: market[k] for k in ("marketSearchContext", "higherPricedComparableListings") if k in market},
        },
    }
    return validate_report_projection(projected)


def prepare():
    from tests.full_review_fixtures import strict_fixture
    from venfour.full_review_payment import payment_readiness, strict_result_eligible
    from venfour.package_assessment import build_total_loss_source_snapshot_v1, build_final_valuation_assessment_v1, canonical_package_digest
    from venfour.valuation_evidence_report import build_valuation_evidence_report_v1, render_valuation_evidence_report_pdf_v1
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib import colors

    fixture = strict_fixture()
    from venfour.full_review_calculation import calculate_report_review
    fixture["extraction"]["normalizedReport"]["report"].update(claimReferenceNumber="DEMO-2026-0142", reportDate="2026-08-05")
    calculation = calculate_report_review(fixture["artifact"], fixture["extraction"], fixture["readiness"], report_id=uid(18), created_at=DATE)
    assert strict_result_eligible(calculation), "The synthetic evidence must pass the real strict payment gate."
    p, artifact = calculation["presentation"], calculation["artifact"]
    vehicle, extraction = p["vehicle"], fixture["extraction"]
    DEST.mkdir(parents=True, exist_ok=True)
    filename = "Synthetic_Insurer_Valuation.pdf"
    styles = getSampleStyleSheet()
    story = [Paragraph("SYNTHETIC SAMPLE — NOT AN INSURER-ISSUED REPORT", styles["Heading1"]),
             Paragraph("Example Insurance · Claim DEMO-2026-0142", styles["Heading2"]),
             Paragraph("Jordan Example · 123 Example Street, Fenton, MO 63026", styles["Normal"]), Spacer(1, 16)]
    title = " ".join(str(vehicle[k]) for k in ("year", "make", "model", "trim"))
    for line in [title, f"Fictional VIN: {extraction['normalizedReport']['vehicle']['vin']}",
                 f"Mileage: {vehicle['mileage']:,} · Loss: {vehicle['lossDate']} · ZIP: {vehicle['postalCode']}",
                 "2.0L I4 · FWD · Automatic · Standard SEL equipment",
                 f"Vehicle valuation: {p['insurerValuation']['value']['display']} before taxes, fees or deductible."]:
        story.append(Paragraph(line, styles["Normal"]))
    story.append(Spacer(1, 18))
    rows = [["Comparable", "Mileage", "Listed", "Net adjustment", "Adjusted"]]
    for row in p["cccComparables"]["rows"]:
        rows.append([f"2024 Elantra SEL #{len(rows)}", f"{row['mileage']:,}", row["advertisedPrice"]["display"], row["netAdjustment"]["display"], row["cccAdjustedComparableValue"]["display"]])
    table = Table(rows, colWidths=[140, 65, 85, 100, 85]); table.setStyle(TableStyle([("GRID", (0,0),(-1,-1), .5, colors.grey), ("BACKGROUND", (0,0),(-1,0), colors.whitesmoke), ("TOPPADDING", (0,0),(-1,-1), 9), ("BOTTOMPADDING", (0,0),(-1,-1), 9)]))
    story.extend([table, Spacer(1, 18), Paragraph("All identities, documents, listings and offers in this case are fictional. This sample supplies the same structured inputs as a customer report; it is not evidence about a real vehicle or claim.", styles["Normal"])])
    SimpleDocTemplate(str(DEST / filename), title="Synthetic insurer valuation sample", author="Venfour", invariant=True).build(story)
    pdf = (DEST / filename).read_bytes(); digest = hashlib.sha256(pdf).hexdigest()
    extraction["documentSha256"] = digest
    facts = {"vin": extraction["normalizedReport"]["vehicle"]["vin"], "year": vehicle["year"], "make": vehicle["make"], "model": vehicle["model"], "trim": vehicle["trim"],
             "vehicleConfiguration": None, "mileage": vehicle["mileage"], "postalCode": vehicle["postalCode"], "lossDate": vehicle["lossDate"], "insurerName": "Example Insurance",
             "insurerVehicleValuationMinorUnits": p["insurerValuation"]["value"]["cents"], "priorTitleStatus": None, "condition": None, "existingDamageDescription": None, "optionsPackages": None, "intakeCompletedAt": DATE}
    document = {"bucket": "case-files", "storageOwnerId": USER_ID, "objectPath": f"{USER_ID}/{CASE_ID}/{filename}", "uploadId": uid(18), "originalFilename": filename, "uploadedAt": DATE,
                "detectedMediaType": "application/pdf", "declaredMimeType": "application/pdf", "byteSize": len(pdf), "pageCount": 1, "sha256": digest}
    source_extraction = {k:v for k,v in extraction.items() if k != "schemaVersion"}
    source_extraction.update(rowSchemaVersion="1", wrapperSchemaVersion=extraction["schemaVersion"], extractedAt=DATE)
    preliminary = {"schemaVersion": "1", "presentation": p, "customerVisibleResult": {"classification": p["assessment"]["classification"], "insurerValueMinorUnits": facts["insurerVehicleValuationMinorUnits"]}}
    source = build_total_loss_source_snapshot_v1(
        lineage={"caseId": CASE_ID, "packageJobId": uid(12), "entitlementId": uid(13), "preliminarySnapshotId": uid(14), "sourceSnapshotId": uid(15), "analysisJobId": uid(16), "analysisRunId": artifact["runId"], "ownerUserIdAtCreation": USER_ID, "productIdentifier": "total_loss_advisory_package", "productVersion": "v1"},
        created_at=DATE, intake_mode="REPORT", analysis_input_revision=1, analysis_input_id=INPUT_ID, confirmed_facts=facts, artifact=artifact,
        preliminary_presentation=p, preliminary_snapshot=preliminary, preliminary_snapshot_digest=canonical_package_digest(preliminary), preliminary_snapshot_schema_version="1", source_document=document, extraction=source_extraction)
    assessment = build_final_valuation_assessment_v1(source)
    built = build_valuation_evidence_report_v1(source_snapshot=source, final_assessment=assessment, report_series_id=uid(20), report_version_id=REPORT_ID, final_assessment_id=uid(21), version_number=1, generated_at=DATE)
    report = customer_report(built.to_dict())
    assert report["conclusion"]["continuingSupported"], "The published report must independently support continuation."
    (DEST / report["suggestedFilename"]).write_bytes(render_valuation_evidence_report_pdf_v1(built, fictional=True))
    import tempfile
    from tests.test_efficient_analysis import run_analysis
    from tests.test_efficient_search import candidate
    from tests.test_analysis_runs import make_report
    from venfour.presentation import AnalysisPresentationProjector
    def free_input():
        value = make_report()
        value["report"]["lossDate"] = vehicle["lossDate"]
        return value
    with tempfile.TemporaryDirectory() as directory, patch("tests.test_efficient_analysis.make_report", side_effect=free_input):
        free_artifact, _, _, _ = run_analysis(directory, [candidate(i, price=24000+i*100) for i in range(12)], offer=20000, source_report=False, free_estimate=True)
    free_analysis = AnalysisPresentationProjector().project(free_artifact).to_dict()
    assert free_analysis["presentationVersion"] == "8"
    assert free_analysis["preliminaryResult"]["outcome"] == "ESTIMATE"
    context = {"case_id": CASE_ID, "source_run_id": free_artifact.run_id, "source_input_id": INPUT_ID, "source_input_revision": 1,
               "report": {"id": uid(18), "revision": 1, "status": "ready", "readiness": fixture["readiness"], "document_sha256": digest}}
    context["strict_review"] = {**{k:v for k,v in context.items() if k != "report"}, "id": uid(22), "report_id": uid(18), "report_revision": 1, "document_sha256": digest, "review_version": "1", "calculation": calculation, "calculation_digest": canonical_package_digest(calculation)}
    readiness = payment_readiness(context)
    assert readiness["eligible"]

    from tests.test_insurer_response_analysis import InsurerResponseAnalysisFixture
    from venfour.insurer_response_analysis import CaseEvidenceContext, make_case_evidence_reference, validate_insurer_response_analysis_v1
    from venfour.insurer_response_processing import _analysis_evidence_index
    from venfour.insurer_response_recommendation import build_insurer_response_recommendation_v1
    response_text = "Hello Jordan, we reviewed your reconsideration request and the attached vehicle evidence. Our revised vehicle valuation is $24,500.00, before taxes, fees and any deductible. Please confirm whether you wish to accept this revised valuation. Regards, Taylor Morgan, Example Insurance."
    response_fixture = InsurerResponseAnalysisFixture(); response_fixture.setUp()
    request_fields = dict(vehicle_year=vehicle["year"], vehicle_make=vehicle["make"], vehicle_model=vehicle["model"], vehicle_trim=vehicle["trim"], vehicle_mileage=vehicle["mileage"], insurer_name="Example Insurance",
        original_offer_minor_units=facts["insurerVehicleValuationMinorUnits"], prior_position_summary="The original vehicle valuation was $20,000.",
        supported_range_low_minor_units=assessment.to_dict()["supportedRange"]["lowMinorUnits"], supported_range_high_minor_units=assessment.to_dict()["supportedRange"]["highMinorUnits"],
        response_text=response_text, revised_offer_minor_units=2450000,
        case_evidence=(CaseEvidenceContext(make_case_evidence_reference("finding", "synthetic-market"), "VENFOUR_FINDING", p["assessment"]["summary"]),))
    request = response_fixture._request(**request_fields)
    response_analysis = response_fixture._valid_payload(request)
    response_analysis["analysisSummary"].update(whatInsurerSaid="The insurer revised the vehicle valuation to $24,500 after reviewing your request.", whatThisMeans="You have a revised valuation of $24,500 to consider. It is not a confirmed settlement until you confirm the outcome.")
    response_analysis["insurerPosition"]["summary"] = "The revised vehicle valuation is $24,500 before taxes, fees and any deductible."
    response_analysis["requestDisposition"].update(category="ACCEPTED", summary="The insurer reviewed the request and revised the valuation.")
    response_analysis.update(responsePoints=[], insurerArguments=[], unresolvedIssues=[])
    validate_insurer_response_analysis_v1(response_analysis, request=request)
    evidence = _analysis_evidence_index(request)
    recommendation = build_insurer_response_recommendation_v1(analysis=response_analysis, evidence_index=evidence, final_assessment=assessment.to_dict(), assessment_digest=assessment.to_dict()["assessmentDigest"], customer_offer={"amountMinorUnits": 2450000, "currency": "USD"})
    from venfour.insurer_response_analysis import understand_insurer_response_document
    response_filename = "Synthetic_Insurer_Response.pdf"
    SimpleDocTemplate(str(DEST / response_filename), title="Synthetic insurer response", invariant=True).build([
        Paragraph("SYNTHETIC SAMPLE — NOT AN INSURER-ISSUED LETTER", styles["Heading1"]),
        Paragraph("Example Insurance · Claim DEMO-2026-0142", styles["Heading2"]),
        Paragraph(response_text, styles["Normal"])])
    response_bytes = (DEST / response_filename).read_bytes()
    response_document = {"documentId": uid(30), "byteSize": len(response_bytes), "mediaType": "application/pdf", "originalFilename": response_filename}
    document_request = response_fixture._request(**request_fields, document=understand_insurer_response_document(response_bytes, media_type="application/pdf", filename=response_filename))
    document_analysis = copy.deepcopy(response_analysis)
    document_analysis["inputCoverage"] = document_request.to_dict()["inputCoverage"]
    validate_insurer_response_analysis_v1(document_analysis, request=document_request)
    document_evidence = _analysis_evidence_index(document_request)
    document_recommendation = build_insurer_response_recommendation_v1(analysis=document_analysis, evidence_index=document_evidence, final_assessment=assessment.to_dict(), assessment_digest=assessment.to_dict()["assessmentDigest"], customer_offer={"amountMinorUnits": 2450000, "currency": "USD"})
    template = json.loads((ROOT / "templates/total-loss-reconsideration-email.json").read_text())
    request_message = {"subject": template["subjectWithClaim"] % "DEMO-2026-0142",
        "body": "\n\n".join([template["greeting"] % "Taylor", template["opening"],
            template["request"] % (p["insurerValuation"]["value"]["display"], title),
            template["findings"]["CCC_BELOW_EXTERNAL_RANGE"], template["reviewRequest"], template["thanks"],
            "\n".join([template["signoff"], "Jordan Example", "314-555-0142"])])}
    data = {"responseDocument": response_document, "responseDocumentDigest": hashlib.sha256(response_bytes).hexdigest(),
        "responseWithDocument": {"analysis": document_analysis, "analysisEvidence": document_evidence, "recommendation": document_recommendation},
        "requestMessage": request_message, "manifest": {"title": title, "sourceRunId": free_artifact.run_id, "capturedAt": DATE, "classification": p["assessment"]["classification"], "synthetic": True},
        "facts": facts, "filename": filename, "analysis": free_analysis, "report": report,
        "fullReview": {"caseId": CASE_ID, "stage": "full_review", "analysisInputId": INPUT_ID, "analysisInputRevision": 1, "status": "ready", "ready": True, "checkoutAvailable": readiness["eligible"], "locked": False, "canReuseReport": True, "report": {"id": uid(18), "revision": 1, "filename": filename}, "issues": [], "message": "Your report is saved.", "paymentReadiness": readiness},
        "response": {"text": response_text, "offer": 2450000, "analysis": response_analysis, "analysisEvidence": evidence, "recommendation": recommendation}}
    (DEST / "case.json").write_text(json.dumps(data, indent=2) + "\n")
    (DEST / "domain-evidence.json").write_text(json.dumps({"source": source.to_dict(), "assessment": assessment.to_dict(), "report": built.to_dict(), "paymentReadiness": readiness}, indent=2) + "\n")
    print(json.dumps({"prepared": str(DEST.relative_to(ROOT)), "classification": p["assessment"]["classification"], "eligible": readiness["eligible"], "continuingSupported": report["conclusion"]["continuingSupported"], "responsePolicy": recommendation["state"], "externalRequests": 0}))


if __name__ == "__main__":
    with patch.object(socket.socket, "connect", side_effect=RuntimeError("The local fixture cannot use the network")), patch("socket.create_connection", side_effect=RuntimeError("The local fixture cannot use the network")):
        prepare()
