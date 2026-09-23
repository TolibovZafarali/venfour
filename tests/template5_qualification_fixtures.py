"""Fictional, offline inputs for the existing report-review qualification."""
from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import pymupdf

from tests import test_analysis_runs as analysis_fixtures
from tests import test_valuation_evidence_report as report_fixtures
from venfour.jurisdiction import Assertion, CaseFacts
from venfour.nationwide_product import PRODUCT_FIELDS, product_context
from venfour.package_assessment import (
    validate_total_loss_source_snapshot_v1,
    validate_final_valuation_assessment_v1,
)
from venfour.report_ingestion import normalize_ccc_report
from venfour.valuation_evidence_report import (
    build_valuation_evidence_report_v1, validate_valuation_evidence_report_v1,
)

MANIFEST_PATH = Path(__file__).parent / 'fixtures/report_review/template5_manifest.json'


def load_manifest():
    payload = json.loads(MANIFEST_PATH.read_text())
    from venfour.report_review_evals import load_report_review_eval_suite
    suite = load_report_review_eval_suite()
    if [c['scenarioId'] for c in payload['cases']] != [c['scenarioId'] for c in suite.cases]:
        raise ValueError('Manifest must cover the exact ordered review suite')
    if payload['templateVersion'] != '5' or payload['fictional'] is not True:
        raise ValueError('Only fictional template-5 qualification is permitted')
    if any(c['maxModelRequests'] != 3 or c['maxMarketRequests'] != 0 for c in payload['cases']):
        raise ValueError('Qualification request limits changed')
    return payload


def insurer_fixture(profile, instruction=None):
    raw = analysis_fixtures.make_report()
    raw['vehicle'].update({k: profile[k] for k in ('year', 'make', 'model', 'trim', 'mileage', 'bodyStyle')})
    raw['vehicle']['location'] = f"Fictional City, {profile['state']} {profile['zip']}"
    for item in raw['comparables']:
        item.update({k: profile[k] for k in ('year', 'make', 'model', 'trim')})
        item['mileage'] = profile['mileage'] + item['number'] * 500
        item['location'] = raw['vehicle']['location']
    if instruction:
        raw['valuationNotes'].append(instruction)
    # A text PDF containing a fictional provider-shaped payload. Parsing this is
    # local fixture verification, not qualification of document extraction.
    lines = json.dumps(raw, indent=2).splitlines()
    with pymupdf.open() as doc:
        for start in range(0, len(lines), 70):
            page = doc.new_page()
            page.insert_text((30, 30), '\n'.join(lines[start:start+70]), fontsize=7)
        pdf = doc.tobytes(no_new_id=True)
    with pymupdf.open(stream=pdf, filetype='pdf') as doc:
        parsed = json.loads('\n'.join(page.get_text() for page in doc))
        page_count = len(doc)
    if parsed != raw:
        raise ValueError('Fictional insurer PDF did not parse identically')
    normalize_ccc_report(parsed)
    return parsed, pdf, page_count


def build_base(helper, prices, profile, context_kind='known', instruction=None):
    raw, insurer_pdf, page_count = insurer_fixture(profile, instruction)
    original_request = report_fixtures.make_run_request
    original_listing = analysis_fixtures.make_listing
    original_source = report_fixtures.build_total_loss_source_snapshot_v1
    def listing(provider, index, price):
        item = original_listing(provider, index, price)
        return replace(item, year=profile['year'], make=profile['make'], model=profile['model'],
            trim=profile['trim'], mileage=profile['mileage']+(index-1)*500,
            dealer=replace(item.dealer, state=profile['state'], postal_code=profile['zip']))
    def source_builder(**kwargs):
        digest = hashlib.sha256(insurer_pdf).hexdigest()
        kwargs['source_document'].update(sha256=digest, byteSize=len(insurer_pdf), pageCount=page_count)
        kwargs['extraction']['documentSha256'] = digest
        kwargs['confirmed_facts']['vehicleConfiguration']['values'] = [profile['trim']]
        return original_source(**kwargs)
    with patch.object(report_fixtures, 'make_report', lambda: copy.deepcopy(raw)), \
         patch.object(report_fixtures, 'make_run_request', lambda: replace(original_request(), postal_code=profile['zip'])), \
         patch.object(analysis_fixtures, 'make_listing', listing), \
         patch.object(report_fixtures, 'build_total_loss_source_snapshot_v1', source_builder):
        source, assessment, legacy = helper._report(prices=prices)
    assertions = tuple(Assertion(field,
        ('third_party' if context_kind == 'third_party' else 'first_party') if field == 'claim_type'
        else 'personal' if field == 'policy_use' else 'US-'+profile['state'],
        'customer', 'fictional-confirmation', '2026-09-22T00:00:00Z') for field in PRODUCT_FIELDS)
    if context_kind == 'unknown':
        assertions = ()
    if context_kind == 'conflicting':
        assertions += (Assertion('vehicle_registration', 'US-IL', 'document', 'fictional-conflict', '2026-09-22T00:00:00Z'),)
    identity = legacy.to_dict()['identity']
    context = product_context({'case_id': identity['caseId'], 'revision': 7,
        'facts': CaseFacts(assertions).to_dict(), 'date_of_loss': '2026-05-19'}, as_of='2026-09-22')
    report = build_valuation_evidence_report_v1(source_snapshot=source, final_assessment=assessment,
        report_series_id=identity['reportSeriesId'], report_version_id=identity['reportVersionId'],
        final_assessment_id=identity['finalAssessmentId'], version_number=identity['versionNumber'],
        generated_at='2026-09-23T00:00:00Z', product_context=context)
    validate_total_loss_source_snapshot_v1(source)
    validate_final_valuation_assessment_v1(assessment, source_snapshot=source)
    validate_valuation_evidence_report_v1(report, source_snapshot=source, final_assessment=assessment)
    for key in ('subjectVehicle', 'insurerValuationReviewed', 'insurerComparableReview',
                'independentMarketEvidence', 'adjustmentsAndCalculations', 'executiveConclusion', 'lineage'):
        if report.to_dict()[key] != legacy.to_dict()[key]:
            raise ValueError('Template-5 projection changed frozen evidence')
    return source, assessment, report, insurer_pdf
