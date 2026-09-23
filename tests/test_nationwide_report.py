"""Frozen nationwide presentation preserves the existing monetary conclusions."""
import copy
import unittest
from pathlib import Path

import pymupdf
from tests import test_valuation_evidence_report as fixtures
from venfour.nationwide_product import product_context, REPORT_LABEL
from venfour.package_assessment import canonical_package_digest
from venfour.valuation_evidence_report import (
    build_valuation_evidence_report_v1, render_valuation_evidence_report_pdf_v1,
    validate_valuation_evidence_report_v1, validate_valuation_evidence_report_pdf_v1,
    ValuationEvidenceReportError,
)
from test_nationwide_product import facts

class NationwideReportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        helper = fixtures.ValuationEvidenceReportTests()
        helper.setUp()
        cls.addClassCleanup(helper.doCleanups)
        cls.source, cls.assessment, cls.legacy = helper._report()
        identity = cls.legacy.to_dict()['identity']
        cls.context = product_context({'case_id': identity['caseId'], 'revision': 7, 'facts': facts().to_dict(), 'date_of_loss': '2026-09-01'}, as_of='2026-09-22')
        cls.report = build_valuation_evidence_report_v1(source_snapshot=cls.source, final_assessment=cls.assessment,
            report_series_id=identity['reportSeriesId'], report_version_id=identity['reportVersionId'],
            final_assessment_id=identity['finalAssessmentId'], version_number=identity['versionNumber'],
            generated_at=identity['generatedAt'], product_context=cls.context)
    def test_frozen_context_does_not_change_value_evidence_or_adjustments(self):
        actual, legacy = self.report.to_dict(), self.legacy.to_dict()
        for key in ('executiveConclusion', 'adjustmentsAndCalculations', 'independentMarketEvidence', 'insurerValuationReviewed', 'lineage'):
            self.assertEqual(actual[key], legacy[key])
        self.assertFalse(actual['executiveConclusion']['pointAcvDetermined'])
        self.assertEqual(actual['identity']['title'], REPORT_LABEL)
        self.assertEqual(actual['identity']['templateVersion'], '5')
        self.assertEqual(actual['productContext']['facts_revision'], 7)
        validate_valuation_evidence_report_v1(actual, source_snapshot=self.source, final_assessment=self.assessment)
        self.assertNotIn('productContext', legacy)
        self.assertEqual(legacy['identity']['templateVersion'], '4')
    def test_new_template_renders_separate_settlement_context_and_next_steps(self):
        pdf = render_valuation_evidence_report_pdf_v1(self.report, fictional=True)
        manifest = validate_valuation_evidence_report_pdf_v1(pdf, self.report)
        self.assertEqual(manifest.to_dict()['templateVersion'], '5')
        with pymupdf.open(stream=pdf, filetype='pdf') as document:
            text = '\n'.join(page.get_text() for page in document)
            self.assertIn(REPORT_LABEL, text)
            self.assertIn('Location and settlement context', text)
            self.assertIn('No tax or fee amount has been added', text)
            self.assertIn('You control all insurer communications', ' '.join(text.split()))
            for page in document:
                for block in page.get_text('dict')['blocks']:
                    for line in block.get('lines', []):
                        for span in line['spans']:
                            self.assertLessEqual(span['bbox'][2], 559)
                            self.assertLessEqual(span['bbox'][3], 771)
        # Local visual-QA artifact; entirely fictional, with no customer data.
        output = Path('/tmp/venfour-nationwide-report.pdf')
        output.write_bytes(pdf)
    def test_frozen_context_tampering_rejected_even_after_redigest(self):
        for key, value in [('report_label','Total-Loss Appraisal'), ('case_id','11111111-1111-4111-8111-111111111111'), ('settlement_total_minor',123)]:
            report = copy.deepcopy(self.report.to_dict())
            report['productContext'][key] = value
            report['reportDigest'] = canonical_package_digest({k:v for k,v in report.items() if k != 'reportDigest'})
            with self.assertRaises(ValuationEvidenceReportError): validate_valuation_evidence_report_v1(report)
