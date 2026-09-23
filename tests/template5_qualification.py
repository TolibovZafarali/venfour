"""Single-use local qualification controls around the existing review executor."""
from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
from uuid import UUID

import pymupdf

from venfour.package_assessment import canonical_package_digest
from venfour.report_review import (
    MAX_REVIEW_OUTPUT_TOKENS, OpenAIReportReviewer, ReportReviewConfiguration,
    ReportReviewError, REPORT_REVIEW_PROMPT_VERSION, REPORT_REVIEW_SCHEMA_VERSION,
)
from venfour.report_review_evals import (
    load_report_review_eval_suite, evaluate_report_review_eval_case,
    report_review_prompt_template_digest, run_provider_backed_report_review_eval,
)

ROOT = Path(__file__).resolve().parents[1]
MAX_ATTEMPTS = 3
MAX_AUTH_HOURS = 6


def write_json(path, payload):
    path.write_text(json.dumps(payload, sort_keys=True, indent=2, allow_nan=False)+'\n')


def source_bundle_digest():
    # Includes uncommitted candidate content, unlike a declared Git revision.
    paths = sorted(p for directory in ('venfour', 'tests', 'schemas', 'config')
        for p in (ROOT / directory).rglob('*')
        if p.is_file() and p.suffix in {'.py', '.json'} and '__pycache__' not in p.parts)
    paths += [ROOT/p for p in ('requirements.txt', 'Dockerfile', '.dockerignore', 'scripts/run_offline_tests.py')]
    return canonical_package_digest({str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths})


def configuration(model):
    return ReportReviewConfiguration(model_identifier=model, approved_model_identifier=model,
        approved_prompt_version=REPORT_REVIEW_PROMPT_VERSION,
        approved_schema_version=REPORT_REVIEW_SCHEMA_VERSION,
        approved_eval_suite_digest=load_report_review_eval_suite().suite_digest, release_gate_enabled=True)


def wire_payload(request, model):
    captured = {}
    def capture(**kwargs):
        captured.update(kwargs)
        raise RuntimeError('Provider-disabled payload capture')
    reviewer = OpenAIReportReviewer(configuration(model), client=SimpleNamespace(responses=SimpleNamespace(create=capture)))
    try:
        reviewer.review(request)
    except ReportReviewError:
        if not captured:
            raise
    return captured


def input_token_ceiling(wire):
    # Byte-level tokenizers cannot produce more tokens than input bytes.
    # Include schema/instructions plus 8192 tokens for message framing. This is
    # deliberately a conservative reservation, not a predicted token charge.
    return len(json.dumps(wire, ensure_ascii=True, separators=(',', ':')).encode()) + 8192


def decimal_positive(value):
    amount = Decimal(str(value))
    if not amount.is_finite() or amount <= 0:
        raise ValueError('A finite positive tariff/spend ceiling is required')
    return amount


def budget_plan(prepared, input_rate=None, output_rate=None):
    count = len(prepared)
    normal_input = sum(p['inputTokenCeiling'] for p in prepared.values())
    plan = dict(expectedModelRequests=count, normalMaximum=count,
        retryAdditionalMaximum=count*(MAX_ATTEMPTS-1), absoluteHardCeiling=count*MAX_ATTEMPTS,
        perCaseHardCeiling=MAX_ATTEMPTS, marketRequests=0,
        marketStages={key: 0 for key in ('activeDiscovery', 'historicalDiscovery', 'pagination',
            'expansionCenters', 'enrichment', 'terms', 'supporting', 'retries')},
        normalInputTokenCeiling=normal_input, absoluteInputTokenCeiling=normal_input*MAX_ATTEMPTS,
        normalOutputTokenCeiling=count*MAX_REVIEW_OUTPUT_TOKENS,
        absoluteOutputTokenCeiling=count*MAX_ATTEMPTS*MAX_REVIEW_OUTPUT_TOKENS)
    if input_rate is not None and output_rate is not None:
        value = (Decimal(plan['absoluteInputTokenCeiling'])*decimal_positive(input_rate)
            + Decimal(plan['absoluteOutputTokenCeiling'])*decimal_positive(output_rate))/1_000_000
        plan['reservedCostUsd'] = str(value)
    return plan


def prepare(output, model, revision):
    from tests.report_review_provider_eval import SyntheticReportReviewEvalMaterializer
    from tests.test_report_review_evals import ReportReviewEvalSuiteTests
    from tests import test_report_review as review_fixtures
    from venfour.report_review import CompletedReportReview, ReportQualityReviewV1
    bundle_at_start = source_bundle_digest()
    suite = load_report_review_eval_suite()
    materializer = SyntheticReportReviewEvalMaterializer()
    prepared = {}
    try:
        for case in suite.cases:
            case_id = case['scenarioId']
            print('preparing '+case_id, file=sys.stderr, flush=True)
            request, continuation = materializer.materialize(case)
            base = materializer.base_for_case(case)
            entry = next(c for c in materializer.manifest['cases'] if c['scenarioId'] == case_id)
            profile = next(p for p in materializer.manifest['profiles'] if p['id'] == entry['profileId'])
            facts = base['source']['input']['confirmedFacts']
            if any(facts[key] != profile[key] for key in ('year','make','model','trim','mileage')) or facts['postalCode'] != profile['zip'] or facts['lossDate'] != entry['lossDate'] or facts['insurerVehicleValuationMinorUnits'] != entry['insurerValuationMinor']:
                raise ValueError('Fixture facts differ from qualification manifest')
            case_path = output / case_id
            case_path.mkdir()
            (case_path/'report.pdf').write_bytes(materializer.candidate_pdfs[case_id])
            (case_path/'base-report.pdf').write_bytes(base['pdf'])
            (case_path/'insurer-fixture.pdf').write_bytes(base['insurerPdf'])
            write_json(case_path/'request.json', request.to_dict())
            write_json(case_path/'base-report.json', base['report'])
            write_json(case_path/'pdf-validation.json', base['pdfManifest'])
            # Rendering quality applies to genuine base bytes; adversarial
            # candidates intentionally retain stale validation/digest bindings.
            with pymupdf.open(stream=base['pdf'], filetype='pdf') as document:
                for page in document:
                    if not page.get_fonts() or '\ufffd' in page.get_text():
                        raise ValueError('PDF font/text validation failed')
                    for block in page.get_text('dict')['blocks']:
                        for line in block.get('lines', []):
                            for span in line['spans']:
                                x0,y0,x1,y1=span['bbox']
                                if x0 < 0 or y0 < 0 or x1 > 559 or y1 > 771:
                                    raise ValueError('PDF content outside validated page bounds')
            # Exercise the unchanged strict comparator with explicitly synthetic
            # outputs; this never calls or creates a genuine attestation.
            expected = case['expected']
            if expected['recommendation'] == 'PASS':
                payload = review_fixtures.pass_review_payload(request)
            else:
                payload = review_fixtures.held_review_payload(request,
                    failed_check=expected['failedMandatoryChecks'][0], category=expected['findingCategories'][0])
                payload['untrustedInstructionDetected'] = bool(expected['untrustedInstructionDetected'])
            completed = CompletedReportReview(provider_identifier='openai', configured_model_identifier=model,
                returned_model_identifier=model, prompt_version=REPORT_REVIEW_PROMPT_VERSION,
                schema_version=REPORT_REVIEW_SCHEMA_VERSION, input_digest=request.input_digest,
                output_digest=canonical_package_digest(payload),
                review=ReportQualityReviewV1.from_dict(payload, request=request), usage_metadata={})
            result = evaluate_report_review_eval_case(case, completed_review=completed,
                gate_decision=ReportReviewEvalSuiteTests._decision(expected['gateDisposition']))
            if not result.passed:
                raise ValueError('Dry-run rubric mechanics failed: '+case_id)
            wire = wire_payload(request, model)
            prepared[case_id] = dict(inputDigest=request.input_digest,
                wireDigest=canonical_package_digest(wire), inputTokenCeiling=input_token_ceiling(wire),
                pdfDigest=request.digests['pdfDigest'], reportDigest=request.digests['reportDigest'],
                insurerPdfDigest=hashlib.sha256(base['insurerPdf']).hexdigest(),
                continuation=continuation, dryRubricResult=asdict(result),
                syntheticSearch={stream: [a['result']['request']['radiusMiles'] for a in diagnostics['attempts']]
                    for stream, diagnostics in base['source']['analysis']['artifact']['result']['searchDiagnostics'].items()
                    if isinstance(diagnostics, dict) and 'attempts' in diagnostics})
        manifest = materializer.manifest
    finally:
        materializer.close()
    if source_bundle_digest() != bundle_at_start:
        raise ValueError('Source bundle changed during preparation')
    from importlib.metadata import version
    runtime = {name: version(name) for name in ('openai','httpx','PyMuPDF','jsonschema','reportlab')}
    runtime['python'] = sys.version
    plan = dict(schemaVersion='1', mode='template5-qualification', genuinelyQualified=False,
        templateVersion='5', rendererVersion='5', promptVersion=REPORT_REVIEW_PROMPT_VERSION,
        schema=REPORT_REVIEW_SCHEMA_VERSION, suiteDigest=suite.suite_digest,
        rubricDigest=report_review_prompt_template_digest(), manifestDigest=canonical_package_digest(manifest),
        sourceBundleDigest=bundle_at_start, declaredRevision=revision, model=model,
        runtime=runtime, cases=prepared, budget=budget_plan(prepared))
    plan['planDigest'] = canonical_package_digest(plan)
    write_json(output/'manifest.json', manifest)
    write_json(output/'plan.json', plan)
    from uuid import uuid4
    write_json(output/'authorization.example.json', dict(schemaVersion='1', mode='template5-qualification',
        runId=str(uuid4()), owner='', issuedAt='', expiresAt='', planDigest=plan['planDigest'],
        model=model, allowedCaseIds=sorted(prepared), maxRequests=plan['budget']['absoluteHardCeiling'],
        inputUsdPerMillion=None, outputUsdPerMillion=None, maxCostUsd=None,
        tariffSource='', tariffVerifiedAt='', tokenBoundConfirmed=False,
        visualReviewConfirmed=False, labelsReviewed=False, providerBudgetConfirmed=False))
    return plan


def validate_authorization(auth, plan, now=None):
    now = now or datetime.now(UTC)
    if plan.get('planDigest') != canonical_package_digest({k:v for k,v in plan.items() if k != 'planDigest'}):
        raise ValueError('Plan digest changed')
    if plan['budget'] != budget_plan(plan['cases']):
        raise ValueError('Plan budget changed')
    required = {'schemaVersion','mode','runId','owner','issuedAt','expiresAt','planDigest',
        'model','allowedCaseIds','maxRequests','inputUsdPerMillion','outputUsdPerMillion',
        'maxCostUsd','tariffSource','tariffVerifiedAt','tokenBoundConfirmed','visualReviewConfirmed',
        'labelsReviewed','providerBudgetConfirmed'}
    if set(auth) != required or auth['schemaVersion'] != '1' or auth['mode'] != 'template5-qualification':
        raise ValueError('Authorization shape/mode invalid')
    if str(UUID(auth['runId'])) != auth['runId'] or not str(auth['owner']).strip():
        raise ValueError('Authorization identity invalid')
    issued = datetime.fromisoformat(auth['issuedAt'].replace('Z','+00:00'))
    expires = datetime.fromisoformat(auth['expiresAt'].replace('Z','+00:00'))
    if not issued.tzinfo or not expires.tzinfo or not issued <= now < expires or expires-issued > timedelta(hours=MAX_AUTH_HOURS):
        raise ValueError('Authorization expired, future or longer than six hours')
    for key in ('tokenBoundConfirmed','visualReviewConfirmed','labelsReviewed','providerBudgetConfirmed'):
        if auth[key] is not True:
            raise ValueError('Owner confirmation missing: '+key)
    if auth['planDigest'] != plan['planDigest'] or auth['model'] != plan['model']:
        raise ValueError('Authorization does not bind this plan/model')
    if auth['allowedCaseIds'] != sorted(plan['cases']) or type(auth['maxRequests']) is not int or auth['maxRequests'] != plan['budget']['absoluteHardCeiling']:
        raise ValueError('Authorization case/request bounds differ')
    verified = datetime.fromisoformat(auth['tariffVerifiedAt'].replace('Z','+00:00'))
    if not verified.tzinfo or not timedelta(0) <= now-verified <= timedelta(days=1) or not auth['tariffSource'].strip():
        raise ValueError('Fresh tariff evidence required')
    cost = budget_plan(plan['cases'], auth['inputUsdPerMillion'], auth['outputUsdPerMillion'])
    if Decimal(cost['reservedCostUsd']) > decimal_positive(auth['maxCostUsd']):
        raise ValueError('Whole-run worst-case reservation exceeds approved dollar ceiling')
    return cost


class BoundedResponses:
    """Reserve and persist every attempt before the only allowed transport."""
    def __init__(self, delegate, auth, plan, output, clock=lambda: datetime.now(UTC)):
        self.delegate, self.auth, self.plan, self.output, self.clock = delegate, auth, plan, output, clock
        self.case_id = None
        self.counts = {key: 0 for key in plan['cases']}
        self.total = 0
        self.reserved = Decimal(0)
        self.stopped = False
        self.responses = self

    def begin_case(self, case, request):
        case_id = case['scenarioId']
        if case_id not in self.plan['cases'] or request.input_digest != self.plan['cases'][case_id]['inputDigest']:
            raise ValueError('Unapproved case or changed fixture')
        self.case_id = case_id

    def log(self, payload):
        with (self.output/'provider-ledger.jsonl').open('a') as stream:
            stream.write(json.dumps(payload, sort_keys=True, allow_nan=False)+'\n')
            stream.flush()
            os.fsync(stream.fileno())

    def create(self, **kwargs):
        if self.stopped:
            raise ValueError('Qualification stopped after a safety failure')
        self.stopped = True
        validate_authorization(self.auth, self.plan, self.clock())
        entry = self.plan['cases'].get(self.case_id)
        if entry is None or canonical_package_digest(kwargs) != entry['wireDigest']:
            raise ValueError('Unapproved transport payload')
        if self.total >= self.auth['maxRequests'] or self.counts[self.case_id] >= MAX_ATTEMPTS:
            raise ValueError('Qualification hard request ceiling reached')
        reserve = (Decimal(entry['inputTokenCeiling'])*decimal_positive(self.auth['inputUsdPerMillion'])
            + MAX_REVIEW_OUTPUT_TOKENS*decimal_positive(self.auth['outputUsdPerMillion']))/1_000_000
        if self.reserved+reserve > decimal_positive(self.auth['maxCostUsd']):
            raise ValueError('Qualification dollar ceiling reached')
        self.total += 1
        self.counts[self.case_id] += 1
        self.reserved += reserve
        identity = dict(sequence=self.total, scenarioId=self.case_id, attempt=self.counts[self.case_id],
            timestamp=self.clock().isoformat(), reservedCostUsd=str(self.reserved), inputDigest=entry['inputDigest'])
        self.log(dict(identity, status='RESERVED_BEFORE_TRANSPORT'))
        try:
            response = self.delegate(**kwargs)
        except Exception as exc:
            self.log(dict(identity, status='TRANSPORT_ERROR_OR_UNKNOWN', errorType=type(exc).__name__))
            self.stopped = False
            raise
        usage = getattr(response, 'usage', None)
        usage_data = usage.model_dump() if hasattr(usage, 'model_dump') else usage
        self.log(dict(identity, status='RETURNED', usage=usage_data, model=getattr(response,'model',None)))
        write_json(self.output/f'response-{self.total:03d}.json', response.model_dump())
        if not usage or getattr(usage, 'input_tokens', entry['inputTokenCeiling']+1) > entry['inputTokenCeiling'] or getattr(usage, 'output_tokens', MAX_REVIEW_OUTPUT_TOKENS+1) > MAX_REVIEW_OUTPUT_TOKENS:
            # Retain the entire reservation on timeout/failure or uncertain usage.
            raise ValueError('Provider usage missing or exceeds approved token bound')
        self.stopped = False
        return response


def run_live(output, plan, auth_path, api_key):
    import httpx
    from openai import OpenAI
    from tests.report_review_provider_eval import SyntheticReportReviewEvalMaterializer, LiveProviderEvalExecutor
    auth = json.loads(auth_path.read_text())
    validate_authorization(auth, plan)
    if plan['sourceBundleDigest'] != source_bundle_digest():
        raise ValueError('Source bundle changed after preparation')
    if not api_key:
        raise ValueError('Dedicated qualification credential required')
    # Single use even after a crash/timeout; no resume/reset/top-up switch.
    registry = Path.home()/'.venfour'/'qualification-runs'
    registry.mkdir(parents=True, exist_ok=True, mode=0o700)
    used = registry/(auth['runId']+'.used')
    with used.open('x') as stream:
        stream.write(json.dumps({'runId':auth['runId'], 'planDigest':plan['planDigest']}))
        stream.flush(); os.fsync(stream.fileno())
    def restrict(request):
        if str(request.url) != 'https://api.openai.com/v1/responses' or request.method != 'POST':
            raise ValueError('Qualification transport destination rejected')
    with httpx.Client(trust_env=False, follow_redirects=False, event_hooks={'request':[restrict]}) as http_client:
        with OpenAI(api_key=api_key, base_url='https://api.openai.com/v1', max_retries=0,
                    timeout=90.0, http_client=http_client) as client:
            guarded = BoundedResponses(client.responses.create, auth, plan, output)
            materializer = SyntheticReportReviewEvalMaterializer()
            outcomes = []
            def archive(case, request, completed, decision):
                result = evaluate_report_review_eval_case(case, completed_review=completed, gate_decision=decision)
                row = dict(scenarioId=case['scenarioId'], result=asdict(result),
                    completed=completed.to_record(), gate=asdict(decision))
                outcomes.append(row)
                write_json(output/'case-results.json', outcomes)
                if not result.passed:
                    raise ValueError('Critical qualification mismatch: '+case['scenarioId'])
            try:
                executor = LiveProviderEvalExecutor(materializer=materializer,
                    reviewer=OpenAIReportReviewer(configuration(plan['model']), client=guarded),
                    configuration=configuration(plan['model']), before_case=guarded.begin_case, after_case=archive)
                attestation, results = run_provider_backed_report_review_eval(executor,
                    evaluated_at=datetime.now(UTC).isoformat().replace('+00:00','Z'))
                if not all(r.passed for r in results):
                    raise ValueError('Incomplete qualification')
                if source_bundle_digest() != plan['sourceBundleDigest']:
                    raise ValueError('Source bundle changed during evaluation')
                candidate = dict(status='CANDIDATE_REQUIRES_OWNER_ACCEPTANCE', templateVersion='5',
                    rendererVersion='5', planDigest=plan['planDigest'], sourceBundleDigest=plan['sourceBundleDigest'],
                    declaredRevision=plan['declaredRevision'], authorization=auth,
                    providerLedgerDigest=hashlib.sha256((output/'provider-ledger.jsonl').read_bytes()).hexdigest(),
                    providerRequests=guarded.total, reservedCostUsd=str(guarded.reserved),
                    caseResults=outcomes, releaseAttestation=attestation.to_dict())
                candidate['candidateDigest'] = canonical_package_digest(candidate)
                write_json(output/'candidate.json', candidate)
            finally:
                materializer.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['dry-run','execute'], default='dry-run')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--model', required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--authorization', type=Path)
    args = parser.parse_args(argv)
    if args.mode == 'execute' and not args.authorization:
        parser.error('execute requires an owner authorization file')
    key = os.environ.get('VENFOUR_QUALIFICATION_MODEL_KEY')
    # Nothing else can bind this process to customer infrastructure.
    os.environ.clear()
    os.environ['PATH'] = '/usr/bin:/bin'
    if args.mode == 'dry-run':
        from scripts.run_offline_tests import OfflineNetworkGuard
        guard = OfflineNetworkGuard()
        guard.install()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    os.chmod(output, 0o700)
    try:
        plan = prepare(output, args.model, args.revision)
        if args.mode == 'execute':
            run_live(output, plan, args.authorization.resolve(), key)
        else:
            write_json(output/'dry-run.json', dict(status='LOCAL_ONLY', providerRequests=0,
                networkAttempts=len(guard.violations), genuinelyQualified=False, budget=plan['budget']))
            if guard.violations:
                raise ValueError('Dry run attempted transport')
        print(json.dumps({'mode':args.mode, 'output':str(output), 'planDigest':plan['planDigest'], 'budget':plan['budget']}, indent=2))
        return 0
    except Exception as exc:
        write_json(output/'stopped.json', dict(status='STOPPED_NOT_QUALIFIED', errorType=type(exc).__name__))
        print('Qualification stopped: '+str(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
