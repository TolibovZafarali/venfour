"""Outcome review authorization, trusted facts, and fail-closed eligibility."""
import unittest
from unittest.mock import Mock

from venfour.partner_service import PartnerError, PartnerService
from venfour.partner_outcomes import CONFIRMATIONS, validate_request

PID='22222222-2222-4222-8222-222222222222'
AID='33333333-3333-4333-8333-333333333333'
DOC='44444444-4444-4444-8444-444444444444'
USER='11111111-1111-4111-8111-111111111111'


def request():
    return dict(partner_id=PID, attribution_id=AID, request_id='55555555-5555-4555-8555-555555555555', source_digest='a'*64,
        decision='approved', notes='Retained evidence supports the documented outcome and policy review.', facts={
            'baseline_document_id': DOC, 'final_document_id': DOC, 'acceptance_document_id': DOC, 'review_document_id': DOC,
            'baseline_communicated_at':'2026-09-01T12:00:00Z', 'service_started_at':'2026-09-03T12:00:00Z', 'accepted_at':'2026-09-15T12:00:00Z',
            'baseline_vehicle_value_minor':2000000, 'final_vehicle_value_minor':2150000, **{k:True for k in CONFIRMATIONS}})


def context():
    return dict(reviewer_id=USER, verified_at='2026-09-16T12:00:00Z', source=dict(case_id=AID, agreement_digest='b'*64,
        attributed_at='2026-09-02T12:00:00Z', paid_at='2026-09-03T12:00:00Z', program_enabled=True, payment_held=False, documents=[{'id':DOC}]))


class OutcomeReviewTests(unittest.TestCase):
    def setUp(self):
        self.gateway=Mock(); self.service=PartnerService(self.gateway)
        self.gateway.operation.return_value=context()
        self.gateway.commission_worker.return_value={'enabled':True,'entries':[]}
        self.gateway.outcome_worker.return_value={'decision':'approved','revision':1,'award_id':DOC}

    def test_staff_approval_uses_server_identity_time_sources_and_rules(self):
        payload=request()
        result=self.service.operation('outcome_decide',payload,'manager-token',staff=True)
        self.assertEqual(result['decision'],'approved')
        self.gateway.operation.assert_called_once_with('outcome_prepare',payload,'manager-token')
        work=self.gateway.outcome_worker.call_args.args[0]
        self.assertEqual(work['award']['amount_minor'],5000)
        self.assertEqual(work['award']['outcome']['reviewer_id'],USER)
        self.assertEqual(work['award']['outcome']['verified_at'],'2026-09-16T12:00:00+00:00')
        self.assertEqual(work['award']['outcome']['agreement_digest'],'b'*64)
        self.gateway.commission_worker.assert_called_once_with('context',{'partner_id':PID})

    def test_partner_and_internal_operations_are_not_http_actions(self):
        for staff, action in ((False,'outcome_decide'),(False,'outcome_get'),(False,'outcome_queue'),(True,'outcome_prepare'),(True,'outcome_document'),(True,'outcome_worker')):
            with self.subTest(action=action,staff=staff), self.assertRaises(PartnerError): self.service.operation(action,request(),'token',staff=staff)
        self.gateway.operation.assert_not_called()

    def test_caller_cannot_supply_identity_rate_or_skip_confirmations(self):
        for key,value in [('reviewer_id',USER),('verified_at','2026-09-01T00:00:00Z'),('amount_minor',7500)]:
            p=request();p[key]=value
            with self.assertRaises(PartnerError): validate_request('outcome_decide',p)
        for key in CONFIRMATIONS:
            p=request();p['facts'][key]=False
            with self.subTest(key=key), self.assertRaises(PartnerError): self.service.operation('outcome_decide',p,'token',staff=True)
        p=request();p['facts']['final_vehicle_value_minor']=True
        with self.assertRaises(PartnerError): validate_request('outcome_decide',p)
        self.gateway.outcome_worker.assert_not_called()

    def test_nonqualifying_threshold_time_and_documents_fail_before_posting(self):
        for facts in ({'final_vehicle_value_minor':2100000},{'accepted_at':'2026-09-02T12:00:00Z'},{'baseline_communicated_at':'2026-09-04T12:00:00Z'},{'review_document_id':PID}):
            p=request();p['facts'].update(facts)
            with self.subTest(facts=facts), self.assertRaises(PartnerError): self.service.operation('outcome_decide',p,'token',staff=True)
        self.gateway.outcome_worker.assert_not_called()

    def test_payment_hold_disabled_policy_and_revoked_access_fail_closed(self):
        for changed in ({'program_enabled':False},{'payment_held':True}):
            c=context();c['source'].update(changed);self.gateway.operation.return_value=c
            with self.assertRaises(PartnerError): self.service.operation('outcome_decide',request(),'token',staff=True)
        self.gateway.operation.side_effect=PartnerError(403,'DENIED','Denied')
        with self.assertRaises(PartnerError): self.service.operation('outcome_decide',request(),'token',staff=True)
        self.gateway.outcome_worker.assert_not_called()

    def test_saved_response_replay_does_not_recalculate_a_commission(self):
        saved={'decision':'approved','revision':1,'award_id':DOC}
        self.gateway.operation.return_value={'result':saved}
        self.assertEqual(self.service.operation('outcome_decide',request(),'token',staff=True),saved)
        self.gateway.commission_worker.assert_not_called();self.gateway.outcome_worker.assert_not_called()

    def test_missing_evidence_and_denial_keep_history_without_earnings(self):
        for decision in ('needs_evidence','ineligible'):
            p=request();p.update(decision=decision,facts={})
            self.service.operation('outcome_decide',p,'token',staff=True)
            self.assertIsNone(self.gateway.outcome_worker.call_args.args[0]['award'])
        self.gateway.commission_worker.assert_not_called()

    def test_evidence_download_resolves_locator_with_current_manager_token(self):
        locator={'media_type':'application/pdf','bucket':'case-files','path':'private.pdf','size':5,'digest':'a'*64}
        self.gateway.operation.return_value=locator; self.gateway.download_outcome_evidence.return_value=b'%PDF-'
        payload=dict(partner_id=PID,attribution_id=AID,document_id=DOC)
        self.assertEqual(self.service.outcome_document(payload,'token'),(b'%PDF-','application/pdf'))
        self.gateway.operation.assert_called_with('outcome_document',payload,'token')
        self.gateway.operation.side_effect=PartnerError(403,'DENIED','Denied')
        with self.assertRaises(PartnerError):self.service.outcome_document(payload,'other-token')
        self.assertEqual(self.gateway.download_outcome_evidence.call_count,1)

class OutcomeEvidenceGatewayTests(unittest.TestCase):
    def gateway(self, handler):
        import httpx
        from venfour.partner_service import PartnerGateway
        from venfour.supabase_gateway import SupabaseServerConfiguration
        client=httpx.Client(transport=httpx.MockTransport(handler));self.addCleanup(client.close)
        return PartnerGateway(SupabaseServerConfiguration(url='http://127.0.0.1:54321',publishable_key='public',service_role_key='private'),client=client)

    def test_download_verifies_digest_and_size(self):
        import hashlib
        import httpx
        content=b'%PDF-1.4\nfictional evidence'
        def handler(req):
            self.assertEqual(req.headers['authorization'],'Bearer private')
            return httpx.Response(200,content=content)
        gateway=self.gateway(handler)
        locator=dict(bucket='case-files',path='case/document.pdf',digest=hashlib.sha256(content).hexdigest(),size=len(content))
        self.assertEqual(gateway.download_outcome_evidence(locator),content)
        for change in ({'digest':'0'*64},{'size':1},{'path':'../other.pdf'}):
            with self.assertRaises(PartnerError):gateway.download_outcome_evidence(locator|change)

    def test_worker_maps_stale_and_revoked_access_to_actionable_errors(self):
        import httpx
        for code,status in [('40001',409),('42501',403),('22023',400)]:
            gateway=self.gateway(lambda req:httpx.Response(400,json={'code':code}))
            with self.assertRaises(PartnerError) as error:gateway.outcome_worker({})
            self.assertEqual(error.exception.status,status)

class OutcomeHttpTests(unittest.TestCase):
    def setUp(self):
        from starlette.applications import Starlette
        from starlette.testclient import TestClient
        from venfour.partner_api import partner_routes
        self.gateway=Mock();app=Starlette(routes=partner_routes())
        app.state.partner_service=PartnerService(self.gateway);app.state.partner_delivery_service=None
        self.client=TestClient(app);self.addCleanup(self.client.close)

    def test_evidence_download_requires_auth_and_is_private(self):
        path=f'/api/v1/staff/referral-partners/outcomes/{PID}/{AID}/documents/{DOC}'
        self.assertEqual(self.client.get(path).status_code,401)
        self.gateway.operation.assert_not_called()
        self.gateway.operation.return_value={'media_type':'application/pdf'}
        self.gateway.download_outcome_evidence.return_value=b'%PDF-1.4'
        response=self.client.get(path,headers={'Authorization':'Bearer reviewer'})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.headers['cache-control'],'private, no-store')
        self.assertEqual(response.headers['x-content-type-options'],'nosniff')
        self.assertTrue(response.headers['content-disposition'].startswith('attachment'))

    def test_partner_http_cannot_submit_review(self):
        response=self.client.post('/api/v1/partners/operations',headers={'Authorization':'Bearer partner'},json={'action':'outcome_decide','payload':request()})
        self.assertEqual(response.status_code,400);self.gateway.operation.assert_not_called()

    def test_staff_decision_passes_authenticated_context_and_returns_private_response(self):
        self.gateway.operation.return_value=context();self.gateway.commission_worker.return_value={'enabled':True,'entries':[]}
        self.gateway.outcome_worker.return_value={'decision':'approved','revision':1,'award_id':DOC}
        response=self.client.post('/api/v1/staff/referral-partners/operations',headers={'Authorization':'Bearer reviewer'},json={'action':'outcome_decide','payload':request()})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.headers['cache-control'],'private, no-store')
        self.assertEqual(response.json()['decision'],'approved')
