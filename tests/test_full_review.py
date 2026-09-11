"""Offline report readiness and preserved free-estimate boundary tests."""
import copy
import hashlib
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import Mock

from venfour.full_review import FullReviewService, FullReviewConflict, full_review_readiness
from venfour.report_ingestion import ReportIngestionResult, normalize_ccc_report
from tests.test_analysis_runs import make_report
from tests.test_report_ingestion import write_pdf

CASE = '22222222-2222-4222-8222-222222222222'
USER = '11111111-1111-4111-8111-111111111111'


def report_result():
    report = normalize_ccc_report(make_report())
    report['report'].update(provider='CCC', providerId='CCC', insurer='Example Insurance', lossDate='2026-08-03')
    report['vehicle'].update(bodyStyle='Sedan', engine='2.0L I4', fuelType='Gasoline', transmission='Automatic')
    return ReportIngestionResult(report, 'CCC', 'CCC', 'CCC', 'HIGH', False, (), (), 'a'*64)


def snapshot():
    vehicle = report_result().to_dict()['normalizedReport']['vehicle']
    return {'intake_mode':'manual','vehicle_year':vehicle['year'],'vehicle_make':vehicle['make'],
            'vehicle_model':vehicle['model'],'vehicle_trim':vehicle['trim'],'vin':vehicle['vin'],
            'mileage_at_loss':vehicle['mileage'],'postal_code':'63123','date_of_loss':'2026-08-03',
            'insurer_name':'Example Insurance','insurer_vehicle_valuation':None,
            'vehicle_facts':{'drivetrain':'FWD'}}


class ReadinessTests(unittest.TestCase):
    def test_agreement_uses_report_facts_without_changing_free_input(self):
        saved = snapshot(); original = copy.deepcopy(saved); extracted = report_result().to_dict()
        result = full_review_readiness(saved, extracted)
        self.assertTrue(result['ready'], result)
        self.assertEqual(saved, original)
        self.assertEqual(result['effectiveInput']['vehicle_facts']['engine'], '2.0L I4')
        self.assertEqual(result['effectiveInput']['intake_mode'], 'report')
        self.assertEqual(saved['intake_mode'], 'manual')

    def test_missing_report_wrong_vehicle_and_missing_pages_fail_closed(self):
        self.assertEqual(full_review_readiness(snapshot(),None)['status'],'report_required')
        for change in ('identity','comparables','value','insurer'):
            extracted = report_result().to_dict(); report=extracted['normalizedReport']
            if change=='identity':report['vehicle']['make']='Other'
            if change=='comparables':report['comparables']=[]
            if change=='value':
                report['valuation']['baseVehicleValue']=None;report['valuation']['adjustedVehicleValue']=None
            if change=='insurer':report['report']['insurer']=None
            result=full_review_readiness(snapshot(),extracted)
            self.assertFalse(result['ready']);self.assertEqual(result['status'],'report_invalid')

    def test_one_material_conflict_and_confirmation_preserve_extraction(self):
        saved=snapshot();saved['mileage_at_loss']+=1000
        extracted=report_result().to_dict(); original=copy.deepcopy(extracted)
        result=full_review_readiness(saved,extracted)
        self.assertEqual([i['field'] for i in result['issues']],['mileage'])
        resolved=full_review_readiness(saved,extracted,{'mileage':'report'})
        self.assertTrue(resolved['ready']);self.assertEqual(extracted,original)
        self.assertNotEqual(resolved['effectiveInput']['mileage_at_loss'],saved['mileage_at_loss'])
        with self.assertRaises(ValueError):full_review_readiness(saved,extracted,{'engine':'invented'})

    def test_missing_material_drive_is_targeted_without_requiring_report_reentry(self):
        saved=snapshot();saved['vehicle_facts']={}
        result=full_review_readiness(saved,report_result().to_dict())
        self.assertEqual([i['field'] for i in result['issues']],['drivetrain'])
        self.assertTrue(full_review_readiness(saved,report_result().to_dict(),{'drivetrain':'FWD'})['ready'])


class MemoryGateway:
    def __init__(self, root):
        self.root=root; self.context={'case_id':CASE,'user_id':USER,'input':snapshot(),'report':None,'locked':False,'existing_report':None}
    def get_full_review_context(self,case,user):
        return copy.deepcopy(self.context) if (case,user)==(CASE,USER) else None
    def begin_full_review_report(self,case,user,report_id,filename,digest,size):
        row={'id':report_id,'case_id':case,'original_filename':filename,'document_sha256':digest,'byte_size':size,'status':'uploading','revision':1,'readiness':None,'extraction':None}
        self.context['report']=row;return copy.deepcopy(row)
    def upload_full_review_report(self,case,row,pdf): (self.root/row['id']).write_bytes(pdf)
    @contextmanager
    def materialize_full_review_report(self,case,row): yield self.root/row['id']
    def transition_full_review_report(self,case,user,row,status,**kwargs):
        current=self.context['report']
        if current['id']!=row['id'] or current['revision']!=row['revision']:raise FullReviewConflict('stale')
        current.update(status=status,revision=current['revision']+1)
        for key in ('extraction','readiness'):
            if kwargs.get(key) is not None:current[key]=copy.deepcopy(kwargs[key])
        return copy.deepcopy(current)


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.path=self.root/'input.pdf';write_pdf(self.path,'SIMULATED complete insurer valuation report')
        self.gateway=MemoryGateway(self.root)
        extraction=report_result().to_dict();extraction['documentSha256']=hashlib.sha256(self.path.read_bytes()).hexdigest()
        self.ingestion=Mock();self.ingestion.ingest.return_value=ReportIngestionResult.from_dict(extraction)
        self.service=FullReviewService(self.gateway,ingestion_service=self.ingestion)
    def test_upload_extract_resume_and_owner_boundary(self):
        before=copy.deepcopy(self.gateway.context['input'])
        result=self.service.upload(CASE,USER,self.path,'report.pdf')
        self.assertTrue(result['ready'],result)
        self.assertEqual(self.service.status(CASE,USER),result)
        self.assertEqual(self.gateway.context['input'],before)
        self.assertNotIn('effectiveInput',str(result));self.assertNotIn('storage_object_name',str(result))
        self.service.extract(CASE,USER);self.ingestion.ingest.assert_called_once()
        with self.assertRaises(LookupError):self.service.status(CASE,'another-owner')
    def test_extraction_failure_preserves_file_and_retry(self):
        self.ingestion.ingest.side_effect=RuntimeError('mock extraction failure')
        result=self.service.upload(CASE,USER,self.path,'report.pdf')
        self.assertEqual(result['status'],'extraction_failed')
        self.assertEqual((self.root/result['report']['id']).read_bytes(),self.path.read_bytes())
        self.ingestion.ingest.side_effect=None
        self.assertTrue(self.service.extract(CASE,USER)['ready'])
    def test_revision_fencing_and_one_question_correction(self):
        self.gateway.context['input']['mileage_at_loss']+=1000
        result=self.service.upload(CASE,USER,self.path,'report.pdf');doc=result['report']
        with self.assertRaises(FullReviewConflict):self.service.confirm(CASE,USER,doc['id'],doc['revision']-1,{'mileage':'report'})
        self.assertTrue(self.service.confirm(CASE,USER,doc['id'],doc['revision'],{'mileage':'report'})['ready'])

class RetainedCalculationTests(unittest.TestCase):
    def test_legacy_evidence_without_material_proof_is_not_promoted_to_full_evidence(self):
        from tests.test_analysis_runs import TemporaryRepositoryTestCase
        from venfour.full_review_calculation import calculate_report_review
        fixture=TemporaryRepositoryTestCase();fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        _,_,_,artifact=fixture.run_saved()
        extraction=report_result().to_dict();ready=full_review_readiness(snapshot(),extraction)
        result=calculate_report_review(artifact.to_dict(),extraction,ready,report_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',created_at='2026-09-11T20:00:00Z')
        self.assertEqual(result['newProviderRequests'],0)
        self.assertEqual(result['retainedEligibleIdentities'],{'current':[],'historical':[]})
        self.assertEqual(result['presentation']['analysisScope']['inputMode'],'REPORT')

class FullReviewPackageTests(unittest.TestCase):
    def setUp(self):
        from tests.test_package_assessment import PackageAssessmentTests
        self.fixture = PackageAssessmentTests(); self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.original = self.fixture._source()[-1].to_dict()
        extraction = report_result().to_dict()
        saved = snapshot(); saved['intake_completed_at'] = '2026-08-20T10:30:00Z'
        self.ready = full_review_readiness(saved, extraction)
        self.row = {'id':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','revision':4,'status':'ready',
                    'readiness':self.ready,'extraction':extraction,'document_sha256':'a'*64,
                    'byte_size':48231,'storage_bucket':'case-files','storage_owner_id':USER,
                    'storage_object_name':f'{USER}/{CASE}/review-reports/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',
                    'original_filename':'report.pdf','created_at':'2026-08-20T10:30:00Z','extracted_at':'2026-08-20T10:31:00Z'}

    def test_report_source_and_final_preserve_original_estimate_and_replay(self):
        from venfour.full_review_package import attach_full_review
        from venfour.package_assessment import validate_total_loss_source_snapshot_v1, build_final_valuation_assessment_v1, TotalLossSourceSnapshotV1
        before = copy.deepcopy(self.original)
        source = attach_full_review(self.original, {'report':self.row,'readiness':self.ready},byte_size=48231,digest='a'*64,page_count=12)
        validate_total_loss_source_snapshot_v1(source)
        self.assertEqual(TotalLossSourceSnapshotV1.from_dict(source).to_dict(),source)
        self.assertEqual(self.original,before)
        self.assertEqual(source['analysis'],before['analysis'])
        final = build_final_valuation_assessment_v1(source).to_dict()
        self.assertEqual(final['schemaVersion'],'2')
        self.assertEqual(final['analysisArtifactDigest'],before['analysis']['artifactDigest'])
        self.assertNotEqual(final['reviewRunId'],before['lineage']['analysisRunId'])
        self.assertGreater(len(final['insurerComparables']['rows']),0)
        self.assertEqual(final['preliminaryToFinalComparison']['preliminary'],{
            'classification':before['preliminary']['classification'],'supportedRange':before['preliminary']['supportedRange']})

class FullReviewApiTests(unittest.TestCase):
    def test_authenticated_status_is_read_only_and_mutations_are_bounded(self):
        from starlette.testclient import TestClient
        from venfour.api import create_app
        from venfour.supabase_gateway import SupabaseAuthenticationError
        case_service=Mock()
        case_service.authenticate.side_effect=lambda token: USER if token=='owner' else (_ for _ in ()).throw(SupabaseAuthenticationError('invalid'))
        review=Mock(); review.status.return_value={'stage':'full_review','ready':False,'status':'report_required'}
        app=create_app(case_analysis_service=case_service,full_review_service=review,enable_legacy_api=False)
        endpoint=f'/api/v1/appraisal-cases/{CASE}/full-review'
        with TestClient(app) as client:
            self.assertEqual(client.get(endpoint).status_code,401)
            response=client.get(endpoint,headers={'Authorization':'Bearer owner'})
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.headers['cache-control'],'private, no-store')
            review.status.assert_called_once_with(CASE,USER)
            for operation,body in (('report-upload',{}),('report-upload',{'filename':'x.pdf','sha256':'a'*64,'byteSize':True})):
                self.assertEqual(client.post(endpoint+'/'+operation,json=body,headers={'Authorization':'Bearer owner'}).status_code,400)
            self.assertEqual(client.patch(endpoint+'/confirmation',json={'reportId':'x','revision':True,'resolutions':{}},headers={'Authorization':'Bearer owner'}).status_code,400)
            review.prepare_upload.assert_not_called();review.confirm.assert_not_called();review.extract.assert_not_called()
