"""Offline delivery tombstone, authentication, and qualification regressions."""
import copy
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from starlette.testclient import TestClient

from tests.test_package_processing import FakeDatabase, cloud_tasks_configuration, WORK_ITEM_ID, PACKAGE_JOB_ID
from tests import test_package_processing_api as package_api_tests
from tests.test_package_processing_api import _Processor, _Verifier
from venfour.package_processing import CloudTasksWorkItemDispatcher, TotalLossPackageCoordinator, PackageDispatchUnavailableError
from venfour.paid_runtime import paid_release_configuration_status
from venfour.report_review import REPORT_REVIEW_PROMPT_VERSION
from venfour.report_review_evals import report_review_eval_suite_digest


class Missing(Exception): pass
class Exists(Exception): pass


class TaskService:
    def __init__(self):
        self.active = {}
        self.tombstones = set()
        self.created = []
        self.lookup_error = None
        self.ambiguous = False

    def get_task(self, *, request, timeout, retry=None):
        if self.lookup_error: raise self.lookup_error
        if request['name'] not in self.active: raise Missing()
        return self.active[request['name']]

    def create_task(self, *, request, timeout, retry=None):
        task = copy.deepcopy(request['task'])
        if task['name'] in self.tombstones or task['name'] in self.active: raise Exists()
        self.active[task['name']] = task
        self.created.append(task)
        if self.ambiguous: raise TimeoutError()
        return task

    def exhaust(self):
        self.tombstones.update(self.active)
        self.active.clear()


class DeliveryDatabase(FakeDatabase):
    def __init__(self):
        super().__init__()
        self.generation = 0
        self.held = False
        self.reservations = [dict(work_item_id=WORK_ITEM_ID,package_job_id=PACKAGE_JOB_ID,
            work_type='total_loss_package_finalize',work_version='1',dispatch_attempt_count=1)]

    def workflow_work_item_delivery_generation(self, work_item_id, dispatch_token):
        return self.generation

    def advance_workflow_work_item_delivery(self, work_item_id, dispatch_token, generation):
        assert generation == self.generation
        if generation == 5:
            self.held = True
            self.reservations = []
            return None
        self.generation += 1
        return self.generation


def release_environment():
    return {'OPENAI_API_KEY':'synthetic-key', 'OPENAI_REPORT_REVIEW_MODEL':'gpt-5.6-sol',
        'OPENAI_REPORT_REVIEW_APPROVED_MODEL':'gpt-5.6-sol',
        'OPENAI_REPORT_REVIEW_APPROVED_PROMPT_VERSION':REPORT_REVIEW_PROMPT_VERSION,
        'OPENAI_REPORT_REVIEW_APPROVED_SCHEMA_VERSION':'1',
        'OPENAI_REPORT_REVIEW_APPROVED_EVAL_SUITE_DIGEST':report_review_eval_suite_digest(),
        'OPENAI_REPORT_RELEASE_GATE_ENABLED':'true'}


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.db = DeliveryDatabase()
        self.service = TaskService()
        self.dispatcher = CloudTasksWorkItemDispatcher(cloud_tasks_configuration(),client=self.service,
            already_exists_errors=(Exists,),not_found_errors=(Missing,))
        self.coordinator = TotalLossPackageCoordinator(self.db,self.dispatcher)

    def test_initial_duplicate_active_and_exhausted_replacement(self):
        self.assertEqual(self.coordinator.reconcile_due().dispatched,1)
        self.assertEqual(self.coordinator.reconcile_due().dispatched,1)
        self.assertEqual(len(self.service.created),1)
        self.assertEqual(self.db.generation,1)
        self.service.exhaust()
        self.assertEqual(self.coordinator.reconcile_due().dispatched,1)
        self.assertEqual(self.db.generation,2)
        self.assertEqual(len(self.service.created),2)
        a,b = self.service.created
        self.assertNotEqual(a['name'],b['name'])
        self.assertEqual(a['http_request']['url'],b['http_request']['url'])

    def test_tombstone_is_not_success(self):
        self.service.tombstones.add(self.dispatcher._task_name(WORK_ITEM_ID,1))
        self.assertEqual(self.coordinator.reconcile_due().failed,1)
        self.assertEqual(self.db.marked,[])
        self.assertEqual(len(self.service.created),0)
        self.assertEqual(self.coordinator.reconcile_due().dispatched,1)
        self.assertEqual(self.db.generation,2)

    def test_ambiguous_creation_is_reconciled_without_duplicate(self):
        self.service.ambiguous = True
        self.assertEqual(self.coordinator.reconcile_due().failed,1)
        self.assertEqual(self.db.generation,1)
        self.assertEqual(self.coordinator.reconcile_due().dispatched,1)
        self.assertEqual(len(self.service.created),1)

    def test_lookup_error_does_not_advance_or_create(self):
        self.service.lookup_error = PermissionError()
        self.assertEqual(self.coordinator.reconcile_due().failed,1)
        self.assertEqual(self.db.generation,0)
        self.assertEqual(self.service.created,[])

    def test_wrong_existing_target_fails_closed(self):
        self.coordinator.reconcile_due()
        self.service.created[0]['http_request']['url'] = 'https://staging.example.test'
        # Active transport record is distinct from the test observation.
        name = next(iter(self.service.active))
        self.service.active[name]['http_request']['url'] = 'https://staging.example.test'
        self.assertEqual(self.coordinator.reconcile_due().failed,1)
        self.assertEqual(self.db.generation,1)

    def test_generation_is_durable_even_if_worker_never_claims(self):
        for _ in range(5):
            self.assertEqual(self.coordinator.reconcile_due().dispatched,1)
            self.service.exhaust()
        self.assertEqual(self.coordinator.reconcile_due().failed,1)
        self.assertTrue(self.db.held)
        self.assertEqual(self.coordinator.reconcile_due().reserved,0)
        self.assertEqual(len(self.service.created),5)

    def test_generationless_dispatch_is_forbidden(self):
        with self.assertRaises(PackageDispatchUnavailableError): self.dispatcher.dispatch(WORK_ITEM_ID)
        self.assertEqual(self.service.created,[])


class PaidReadinessTests(unittest.TestCase):
    def test_matching_packaged_qualification(self):
        self.assertTrue(paid_release_configuration_status(release_environment())['configured'])

    def test_every_missing_or_mismatched_setting_fails_closed(self):
        env = release_environment()
        for name in env:
            with self.subTest(name=name):
                self.assertFalse(paid_release_configuration_status({k:v for k,v in env.items() if k!=name})['configured'])
                self.assertFalse(paid_release_configuration_status(dict(env,**{name:('' if name == 'OPENAI_API_KEY' else 'invalid')}))['configured'])

    def test_missing_corpus_cannot_be_hidden_by_configured_digest(self):
        env = release_environment()
        with patch('venfour.report_review_evals.report_review_eval_suite_digest',side_effect=FileNotFoundError()):
            self.assertFalse(paid_release_configuration_status(env)['configured'])

    def test_missing_attestation_fails_closed(self):
        with patch('venfour.paid_runtime.load_report_review_eval_attestation',return_value=None):
            self.assertFalse(paid_release_configuration_status(release_environment())['configured'])

    def test_recovery_requires_identity_and_fixed_empty_body(self):
        with patch.dict(os.environ,{},clear=True):
            app = package_api_tests.PackageProcessingApiTests.app(_Processor(),_Verifier())
        coordinator = Mock()
        coordinator.reconcile_due.return_value = SimpleNamespace(reserved=0,dispatched=0,failed=0,dispatcher_configured=True)
        app.state.package_coordinator = coordinator
        app.state.paid_release_status = {'configured':True}
        with TestClient(app) as client:
            self.assertEqual(client.post('/internal/v1/paid-work/reconcile').status_code,401)
            self.assertEqual(client.post('/internal/v1/paid-work/reconcile',headers={'Authorization':'Bearer invalid'}).status_code,401)
            coordinator.reconcile_due.assert_not_called()
            for _ in range(2):
                result = client.post('/internal/v1/paid-work/reconcile',headers={'Authorization':'Bearer valid-oidc-token'})
                self.assertEqual(result.status_code,200)
                self.assertEqual(result.json()['reserved'],0)
            self.assertEqual(coordinator.reconcile_due.call_count,2)
            coordinator.reconcile_due.assert_called_with(limit=1)
            self.assertEqual(client.post('/internal/v1/paid-work/reconcile',json={'limit':100},headers={'Authorization':'Bearer valid-oidc-token'}).status_code,400)
            app.state.paid_release_status = {'configured':False}
            self.assertEqual(client.post('/internal/v1/paid-work/reconcile',headers={'Authorization':'Bearer valid-oidc-token'}).status_code,503)
