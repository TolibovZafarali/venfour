"""Fictional report layout, evidence integrity and historical compatibility."""
import copy
import hashlib
import json
from pathlib import Path
import unittest

import pymupdf
from tests import test_valuation_evidence_report as report_fixtures
from venfour.package_assessment import canonical_package_digest, build_final_valuation_assessment_v1
from venfour.report_evidence import resolve_report_local_evidence_source
from venfour.valuation_evidence_report import (
    ValuationEvidenceReportError, build_valuation_evidence_report_v1, render_valuation_evidence_report_pdf_v1,
    validate_valuation_evidence_report_v1, validate_valuation_evidence_report_pdf_v1,
)
from venfour.valuation_review import public_listing_url, reason_points, project_review_context, ACCENT, TINT, INK


class ValuationReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture = report_fixtures.ValuationEvidenceReportTests()
        fixture.setUp()
        try:
            source, assessment, report = fixture._report()
            cls.source, cls.assessment, cls.report = source.to_dict(), assessment.to_dict(), report.to_dict()
        finally:
            fixture.tearDown()
            fixture.doCleanups()

    def render(self, value=None):
        value = copy.deepcopy(value or self.report)
        value["reportDigest"] = canonical_package_digest({key: item for key, item in value.items() if key != "reportDigest"})
        pdf = render_valuation_evidence_report_pdf_v1(value)
        manifest = validate_valuation_evidence_report_pdf_v1(pdf, value)
        return pdf, manifest

    def text(self, pdf):
        with pymupdf.open(stream=pdf, filetype="pdf") as document:
            return " ".join("\n".join(page.get_text() for page in document).split())

    def test_complete_case_is_readable_linked_and_deterministic(self):
        pdf, manifest = self.render()
        self.assertEqual(pdf, self.render()[0])
        self.assertIn(manifest.page_count, (2, 3))
        text = self.text(pdf)
        for value in ("Vehicle Valuation Review", "$21,800.00", "$22,600.00", "No physical inspection", "not an independent appraisal"):
            self.assertIn(value, text)
        for value in ("2,024", "DESCRIPTIVE_ONLY", "LOSS_DATE_HISTORICAL", "Phase 3D", "{{", "Source and evidence index", "Higher-priced comparable listings"):
            self.assertNotIn(value, text)
        with pymupdf.open(stream=pdf, filetype="pdf") as document:
            self.assertEqual(sum(len(page.get_links()) for page in document), 5)
            for number, page in enumerate(document, 1):
                self.assertIn(f"Page {number} of {len(document)}", page.get_text())
                for block in page.get_text("dict")["blocks"]:
                    for line in block.get("lines", []):
                        for span in line["spans"]:
                            x0,y0,x1,y1=span["bbox"]
                            self.assertGreaterEqual(x0, 53)
                            self.assertLessEqual(x1, 559)
                            self.assertLessEqual(y1, 771)
                            self.assertGreaterEqual(span["size"], 8)

    def test_complete_primary_set_and_duplicate_current_observations(self):
        pdf, _ = self.render()
        text = self.text(pdf)
        for comp in self.report["independentMarketEvidence"]["comparables"][:5]:
            self.assertEqual(text.count(comp["vin"]), 1)
            self.assertIn(comp["advertisedPrice"], text)
        self.assertIn("not additional independent vehicles", text)
        self.assertIn("not combined with its statistics", text)

    def test_missing_optional_identification_and_unverified_trim(self):
        value=copy.deepcopy(self.report)
        value["reviewContext"].update(vin=None, trimVerified=False, vehicleDisplay="2024 Synthetic Sedan", sharedVehicleDescription="2024 Synthetic Sedan")
        for key in ("insurerName", "claimReference"):
            value["insurerValuationReviewed"][key].update(value=None, displayValue="Unavailable", evidenceLabel="UNAVAILABLE", evidenceIds=[])
        pdf,_=self.render(value)
        first=pymupdf.open(stream=pdf,filetype="pdf")[0].get_text()
        self.assertNotIn("Unavailable", first)
        self.assertNotIn("Claim:", first)
        self.assertNotIn("2024 Synthetic Sedan SEL\nVIN", first)
        self.assertEqual(value["reviewContext"]["vehicleDisplay"], "2024 Synthetic Sedan")
        self.assertIn("trim was not confirmed", first)

    def test_missing_material_evidence_does_not_request_an_increase(self):
        value=copy.deepcopy(self.report)
        value["executiveConclusion"].update(supportedAdvertisedPriceRange=None, classification="INSUFFICIENT_EVIDENCE", evidenceStrength="INSUFFICIENT")
        value["executiveConclusion"]["insurerValuation"]["value"].update(minorUnits=None, display="Unavailable")
        value["independentMarketEvidence"].update(primary=None, secondary=None, comparables=[])
        pdf,_=self.render(value);text=self.text(pdf)
        self.assertIn("No specific increase is supported", text)
        self.assertIn("No usable comparable set", text)
        self.assertNotIn("Please review the documented listings", text)

    def test_no_discrepancy_and_weak_current_evidence_are_qualified(self):
        for classification in ("NO_MATERIAL_DISCREPANCY", "POTENTIAL_UNDERVALUE"):
            value=copy.deepcopy(self.report)
            value["executiveConclusion"].update(classification=classification, evidenceStrength="LIMITED", evidenceBasis="CURRENT_MARKET")
            points=" ".join(reason_points(value))
            self.assertIn("current asking prices", points)
            self.assertIn("sufficient verified loss-date market evidence was not available", points)
            if classification == "NO_MATERIAL_DISCREPANCY":
                self.assertIn("do not establish a material discrepancy", points)

    def test_claim_is_bound_to_accepted_extraction_not_live_customer_fields(self):
        source=copy.deepcopy(self.source)
        source["extraction"]["normalizedReport"]["report"]["claimReferenceNumber"]="FROZEN-123"
        source["extraction"]["normalizedReportDigest"]=canonical_package_digest(source["extraction"]["normalizedReport"])
        source["snapshotDigest"]=canonical_package_digest({key:value for key,value in source.items() if key != "snapshotDigest"})
        assessment=build_final_valuation_assessment_v1(source)
        identity=self.report["identity"]
        report=build_valuation_evidence_report_v1(source_snapshot=source, final_assessment=assessment,
                report_series_id=identity["reportSeriesId"], report_version_id=identity["reportVersionId"],
                final_assessment_id=identity["finalAssessmentId"], version_number=1, generated_at=identity["generatedAt"])
        claim=report.to_dict()["insurerValuationReviewed"]["claimReference"]
        self.assertEqual(claim["value"], "FROZEN-123")
        self.assertEqual(claim["evidenceLabel"], "INSURER_EXTRACTED")
        self.assertEqual(len(claim["evidenceIds"]), 1)
        self.assertIsNone(resolve_report_local_evidence_source(source,"/extraction/normalizedReport/report/reportReferenceNumber"))
        changed=report.to_dict();changed["insurerValuationReviewed"]["claimReference"]["value"]="LIVE-456"
        changed["reportDigest"]=canonical_package_digest({key:value for key,value in changed.items() if key != "reportDigest"})
        with self.assertRaises(ValuationEvidenceReportError):
            validate_valuation_evidence_report_v1(changed,source_snapshot=source,final_assessment=assessment)

    def test_historical_template_retains_exact_bytes_and_manifest(self):
        fixture=json.loads(Path("tests/fixtures/report/legacy-report-v1.json").read_text())
        pdf=render_valuation_evidence_report_pdf_v1(fixture["report"])
        self.assertEqual(hashlib.sha256(pdf).hexdigest(),fixture["pdfSha256"])
        manifest=validate_valuation_evidence_report_pdf_v1(pdf,fixture["report"])
        self.assertEqual(manifest.template_version,"1")
        self.assertEqual(len(manifest.mandatory_section_checks),13)

    def test_sold_source_price_is_not_relabelled_as_an_advertisement(self):
        value=copy.deepcopy(self.report)
        comp=value["insurerComparableReview"]["comparables"][0]
        comp["sourcePrice"]={"amount":"$19,800.00","type":"SOLD","typeLabel":"Sold price","label":"Reported sale"}
        comp["advertisedPrice"]=None
        pdf,_=self.render(value);text=self.text(pdf)
        self.assertIn("Sold price: $19,800.00",text)
        self.assertIn("Insurer-adjusted: $20,000.00",text)
        self.assertIn("not verified completed sales",text)

    def test_long_names_urls_and_large_sets_continue_without_losing_rows(self):
        value=copy.deepcopy(self.report)
        primary=[copy.deepcopy(row) for row in value["independentMarketEvidence"]["comparables"] if row["role"] == "PRIMARY"]
        rows=[]
        for i in range(30):
            row=copy.deepcopy(primary[i%len(primary)])
            row.update(vin=f"FICTIONALVIN{i:05}",sourceListingId=f"fictional-{i}",dealer="A long fictional dealership name "*4,vehicleDisplay="2024 Synthetic Sedan with a very long trim and equipment designation")
            rows.append(row)
        value["independentMarketEvidence"]["comparables"]=rows
        value["independentMarketEvidence"]["secondary"]=None
        value["independentMarketEvidence"]["primary"]["selectedCount"]=len(rows)
        value["independentMarketEvidence"]["primary"]["prices"]["count"]=len(rows)
        value["reviewContext"]["sharedVehicleDescription"]=None
        value["reviewContext"]["comparables"][0]["listingUrl"]="https://listings.invalid/"+"vehicle-"*180
        pdf,manifest=self.render(value)
        text=self.text(pdf)
        self.assertGreater(manifest.page_count,3)
        for row in rows:self.assertIn(row["vin"],text)
        with pymupdf.open(stream=pdf,filetype="pdf") as document:
            for page in document:
                self.assertNotIn("\ufffd",page.get_text())
                for word in page.get_text("words"):
                    self.assertLessEqual(word[2],559)

    def test_private_links_are_not_embedded_and_text_is_escaped(self):
        for url in ("https://example.com/?token=secret","https://user:secret@example.com/car","http://127.0.0.1/car","https://project.supabase.co/storage/v1/object/sign/car","javascript:alert(1)"):
            self.assertIsNone(public_listing_url(url))
        value=copy.deepcopy(self.report)
        value["independentMarketEvidence"]["comparables"][0]["dealer"]='<b>Fictional & Sons</b>'
        value["reviewContext"]["comparables"][0]["listingUrl"]="https://example.com/?token=secret"
        pdf,_=self.render(value)
        self.assertIn("<b>Fictional & Sons</b>",self.text(pdf))
        with pymupdf.open(stream=pdf,filetype="pdf") as document:
            self.assertFalse(any("secret" in link.get("uri","") for page in document for link in page.get_links()))

    def test_previous_template_two_retains_exact_bytes(self):
        fixture=json.loads(Path("tests/fixtures/report/legacy-report-v2.json").read_text())
        pdf=render_valuation_evidence_report_pdf_v1(fixture["report"])
        self.assertEqual(hashlib.sha256(pdf).hexdigest(),fixture["pdfSha256"])
        self.assertEqual(validate_valuation_evidence_report_pdf_v1(pdf,fixture["report"]).template_version,"2")

    def test_case_specific_market_summary_and_recorded_search_stream(self):
        pdf,_=self.render(); text=self.text(pdf)
        for phrase in ("5 vehicles (distinct VINs)", "50,000-52,000", "100 miles around ZIP 63026", "Fictional historical market records", "The figures above use all 5", "6 mi from ZIP 63026", "$19,800.00", "Insurer-adjusted: $20,000.00"):
            self.assertIn(phrase,text)
        for phrase in ("250 miles around", "complete selected primary set", "accepted evidence", "synthetic-historical", "underpayment", "identical vehicles"):
            self.assertNotIn(phrase,text)
        with pymupdf.open(stream=pdf,filetype="pdf") as doc:
            self.assertIn("C1",doc[0].get_text())

    def test_multiple_search_areas_and_missing_metadata_are_not_inferred(self):
        source=copy.deepcopy(self.source)
        result=source["analysis"]["artifact"]["result"]
        result["marketSearch"]={"input":{"historicalRequest":result["historicalMarketResult"]["request"]},"events":[
            {"operation":{"kind":"discovery","stream":"historical","purpose":"baseline","center":{"id":"customer","postalCode":"63026","radiusMiles":100}}},
            {"operation":{"kind":"discovery","stream":"historical","purpose":"baseline","center":{"id":"other","label":"Second recorded area","radiusMiles":100}}},
        ],"origin":{"postalCode":"63026"}}
        context=project_review_context(source,self.assessment)
        self.assertIn("2 recorded search areas",context["searchDescription"])
        self.assertEqual(context["searchDescription"].count("100 miles"),2)
        self.assertNotIn("200",context["searchDescription"])
        result.pop("marketSearch");result.pop("historicalMarketResult")
        context=project_review_context(source,self.assessment)
        self.assertEqual(context["searchDescription"],"Search-area details were not retained.")
        self.assertIsNone(context["distanceReference"])
        self.assertIsNone(context["searchFilters"])

    def test_subject_vehicle_and_duplicate_rows_fail_closed_without_repair(self):
        for mutation in ("subject","vin","listing"):
            value=copy.deepcopy(self.report);rows=value["independentMarketEvidence"]["comparables"]
            if mutation=="subject": rows[0]["vin"]=value["reviewContext"]["vin"]
            elif mutation=="vin": rows[1]["vin"]=rows[0]["vin"].lower()
            else: rows[1]["sourceListingId"]=rows[0]["sourceListingId"]
            before=copy.deepcopy(value)
            with self.assertRaises(ValuationEvidenceReportError) as caught:self.render(value)
            self.assertEqual(caught.exception.code,"REPORT_COMPARISON_INTEGRITY_INVALID")
            self.assertEqual(value,before)

    def test_statistics_must_correspond_to_the_complete_displayed_set(self):
        for mutation in ("count","price","median","basis"):
            value=copy.deepcopy(self.report)
            if mutation=="count":value["independentMarketEvidence"]["primary"]["selectedCount"]+=1
            elif mutation=="price":value["independentMarketEvidence"]["comparables"][0]["advertisedPrice"]="$15,000.00"
            elif mutation=="basis":value["executiveConclusion"]["supportedAdvertisedPriceRange"]["evidenceBasis"]="CURRENT_MARKET"
            else:value["executiveConclusion"]["supportedAdvertisedPriceRange"]["median"]["minorUnits"]+=1
            with self.assertRaises(ValuationEvidenceReportError) as caught:self.render(value)
            self.assertEqual(caught.exception.code,"REPORT_COMPARISON_INTEGRITY_INVALID")

    def test_missing_vin_is_disclosed_without_identity_guessing(self):
        value=copy.deepcopy(self.report)
        value["independentMarketEvidence"]["comparables"][0]["vin"]=None
        pdf,_=self.render(value)
        self.assertIn("separate listing identifiers do not rule out an unidentified duplicate",self.text(pdf))

    def test_observations_cross_reference_a_shared_listing_when_one_vin_is_missing(self):
        value=copy.deepcopy(self.report)
        rows=value["independentMarketEvidence"]["comparables"]
        primary=next(row for row in rows if row["role"]=="PRIMARY")
        secondary=next(row for row in rows if row["role"]=="SECONDARY")
        secondary.update(vin=None,source=primary["source"],sourceListingId=primary["sourceListingId"])
        pdf,_=self.render(value)
        self.assertNotIn("Additional vehicles observed",self.text(pdf))
        self.assertIn("not additional independent vehicles",self.text(pdf))

    def test_distance_origins_follow_each_observation_stream(self):
        source=copy.deepcopy(self.source)
        source["analysis"]["artifact"]["result"]["currentMarketResult"]["request"]["postalCode"]="12345"
        context=project_review_context(source,self.assessment)
        details={row["evidenceId"]:row for row in context["comparables"]}
        for role,origin in (("primary","ZIP 63026"),("secondary","ZIP 12345")):
            row=self.assessment["externalEvidence"]["selectedComparables"][role][0]
            self.assertEqual(details[row["evidenceIds"][0]]["distanceReference"],origin)

    def test_brand_palette_has_print_legibility_and_color_is_not_semantic(self):
        def luminance(color):
            return sum(weight*(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4) for weight,v in zip((.2126,.7152,.0722),color.rgb()))
        self.assertGreater((1.05)/(luminance(ACCENT)+.05),4.5)
        self.assertGreater((luminance(TINT)+.05)/(luminance(ACCENT)+.05),4.5)
        self.assertGreater((luminance(TINT)+.05)/(luminance(INK)+.05),7)
        pdf,_=self.render()
        with pymupdf.open(stream=pdf,filetype="pdf") as document:
            colors={span["color"] for page in document for block in page.get_text("dict")["blocks"] for line in block.get("lines",[]) for span in line["spans"]}
            self.assertIn(0x1d4ed8,colors)
            for page in document:
                self.assertEqual(page.get_pixmap(colorspace=pymupdf.csGRAY,alpha=False).n,1)
        self.assertIn("Insurer vehicle valuation reviewed",self.text(pdf))
        self.assertIn("Selected comparable advertised-price range",self.text(pdf))

if __name__ == "__main__": unittest.main()
