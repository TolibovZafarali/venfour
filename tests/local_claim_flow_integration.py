"""Opt-in localhost checks: VENFOUR_LOCAL_POST_CONTINUE=1 python -m unittest tests.local_claim_flow_integration -v."""
import socket
import unittest
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import httpx
from starlette.testclient import TestClient

from scripts.local_claim_flow import (
    create_app, create_fixture, gateway_from_status, local_database, local_status,
    pay_fixture, require_local,
)
from scripts.local_claim_package import process_fixture, reset_fixture


class LocalInitializationIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        require_local()
        cls.status=local_status()
        cls.gateway=gateway_from_status(cls.status)
        cls.original_dns=socket.getaddrinfo
        cls.app=create_app()
        cls.client=TestClient(cls.app,base_url="http://localhost",client=("127.0.0.1",55000))

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        cls.gateway.close()
        socket.getaddrinfo=cls.original_dns

    def permanent_session(self):
        email=f"local-integration-{uuid4().hex}@example.test"
        headers=self.gateway._admin_headers(json_body=True)
        origin=self.status["API_URL"]
        result=httpx.post(origin+"/auth/v1/admin/generate_link",headers=headers,
            json={"type":"magiclink","email":email}).json()
        response=httpx.post(origin+"/auth/v1/verify",headers={"apikey":self.status["ANON_KEY"]},
            json={"type":"email","token_hash":result["hashed_token"]})
        response.raise_for_status()
        session=response.json()
        return session["user"]["id"],session["access_token"]

    def new_case(self, mode="supportable"):
        owner,token=self.permanent_session()
        case=create_fixture(owner,mode)["caseId"]
        return case,token

    def request(self,case,token,**kwargs):
        return self.client.post(f"/api/v1/appraisal-cases/{case}/post-continue",
            headers={"Authorization":f"Bearer {token}"},**kwargs)

    def test_owner_race_resume_and_reset(self):
        case,token=self.new_case()
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses=list(pool.map(lambda _: self.request(case,token),range(2)))
        self.assertEqual([r.status_code for r in responses],[200,200])
        for response in responses:
            self.assertEqual(response.json()["state"],"secured")
            self.assertEqual(response.json()["journey"]["nextState"],"checkout")
        with local_database() as db:
            before=db.execute("select artifact from public.analysis_runs where case_id=%s",(case,)).fetchone()["artifact"]
            for table in ("total_loss_preliminary_snapshots","total_loss_claim_workflows"):
                self.assertEqual(db.execute(f"select count(*) n from public.{table} where case_id=%s",(case,)).fetchone()["n"],1)
            for table in ("commerce_orders","total_loss_package_jobs"):
                self.assertEqual(db.execute(f"select count(*) n from public.{table} where case_id=%s",(case,)).fetchone()["n"],0)
        self.assertEqual(self.request(case,token).json()["journey"]["nextState"],"checkout")
        entitlement = pay_fixture(case)
        self.assertEqual(pay_fixture(case), entitlement)
        self.assertEqual(self.request(case,token).json()["journey"]["nextState"],"processing")
        process_fixture(case)
        ready=self.request(case,token)
        self.assertEqual(ready.status_code,200)
        self.assertEqual(ready.json()["journey"]["nextState"],"guide_result")
        reset_fixture(case)
        with local_database() as db:
            self.assertEqual(before,db.execute("select artifact from public.analysis_runs where case_id=%s",(case,)).fetchone()["artifact"])
            self.assertEqual(db.execute("select count(*) n from public.total_loss_preliminary_snapshots where case_id=%s",(case,)).fetchone()["n"],0)
        self.assertEqual(self.request(case,token).json()["journey"]["nextState"],"checkout")

    def test_wrong_owner_missing_auth_body_and_remote_host(self):
        case,token=self.new_case()
        _,other=self.permanent_session()
        self.assertEqual(self.request(case,other).status_code,404)
        path=f"/api/v1/appraisal-cases/{case}/post-continue"
        self.assertEqual(self.client.post(path).status_code,401)
        self.assertEqual(self.request(case,token,json={"insurerValue":1}).status_code,400)
        self.assertEqual(self.client.post(path,headers={"Host":"staging.venfour.com"}).status_code,404)
        self.assertEqual(self.client.post(path,headers={"Origin":"https://venfour.com"}).status_code,404)

    def test_exception_uses_real_quality_hold(self):
        case,token=self.new_case("exception")
        self.assertEqual(self.request(case,token).status_code,200)
        pay_fixture(case)
        process_fixture(case)
        response=self.request(case,token)
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()["journey"]["fulfillmentState"],"exception_review")
        self.assertIsNone(response.json()["report"])

    def test_sql_entry_points_deny_browser_roles(self):
        with local_database() as db:
            for role in ("anon","authenticated"):
                for function in ("local_post_continue_context(uuid,uuid)","local_initialize_post_continue(uuid,uuid,uuid,jsonb,text)"):
                    self.assertFalse(db.execute("select has_function_privilege(%s,%s,'execute') allowed",(role,"public."+function)).fetchone()["allowed"])
