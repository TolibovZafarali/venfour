"""Run with `.venv/bin/python supabase/tests/concurrency/referral_attribution_races.py`.

Uses the existing local test runtime and only the loopback Docker database. The
briefly committed, random fixtures allow independent sessions to observe real
lock waits. Cleanup disables triggers in its own administrative transaction and
deletes exact fixture identities; it never resets customer data or publications.
The commerce preparation helper is the same bounded fixture used by suite 038.
"""

from __future__ import annotations

import json
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.rows import dict_row


CONTAINER = "supabase_db_venfour"


def local_configuration():
    ports = json.loads(subprocess.check_output([
        "docker", "inspect", "--format", "{{json .NetworkSettings.Ports}}", CONTAINER,
    ], text=True))
    binding = ports["5432/tcp"][0]
    password = subprocess.check_output(["docker", "exec", CONTAINER, "printenv", "POSTGRES_PASSWORD"], text=True).rstrip("\n")
    return dict(host="127.0.0.1", port=int(binding["HostPort"]), dbname="postgres",
                user="supabase_admin", password=password, connect_timeout=5)


class ReferralRaces:
    def __init__(self):
        self.configuration = local_configuration()
        self.run_id = uuid4().hex
        self.manager = uuid4()
        self.owners = [uuid4(), uuid4()]
        self.customers = [uuid4(), uuid4(), uuid4()]
        self.users = [self.manager, *self.owners, *self.customers]
        self.partners = [uuid4(), uuid4()]
        self.agreements = [uuid4(), uuid4()]
        self.template = uuid4()
        self.events = [f"evt_referral_race_{self.run_id}_{index}" for index in range(2)]
        self.cases = []
        self.seed_committed = False
        self.observer = self.connect("observer", autocommit=True)

    def connect(self, label, *, autocommit=False):
        connection = psycopg.connect(**self.configuration, autocommit=autocommit,
                                    row_factory=dict_row, application_name=f"referral_race_{self.run_id[:12]}_{label}")
        connection.execute("set statement_timeout = '15s'")
        if not autocommit:
            connection.commit()
        return connection

    def identity(self, connection, user_id):
        connection.execute("set local role authenticated")
        connection.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(user_id),))

    def seed(self):
        with self.connect("seed") as connection:
            for user_id in self.users:
                connection.execute("insert into auth.users(id,email,email_confirmed_at,is_anonymous) values(%s,%s,statement_timestamp(),false)",
                                   (user_id, f"referral-race-{user_id.hex}@example.test"))
            connection.execute("insert into public.staff_members(user_id) values(%s)", (self.manager,))
            connection.execute("insert into public.referral_partner_managers(user_id) values(%s)", (self.manager,))
            connection.execute("""insert into public.referral_partner_templates(id,title,sections,created_by_user_id)
                values(%s,'Disposable concurrency fixture','[{"heading":"Fixture only","body":"No legal effect or outgoing email."}]',%s)""", (self.template, self.manager))
            for partner_id, owner, agreement in zip(self.partners, self.owners, self.agreements, strict=True):
                connection.execute("""insert into public.referral_partners(id,business_name,contact_email,user_id,commission_amount_minor_units,created_by_user_id)
                    values(%s,'Disposable concurrency business',%s,%s,1234,%s)""",
                                   (partner_id, f"referral-race-{owner.hex}@example.test", owner, self.manager))
                connection.execute("""insert into public.referral_partner_agreements
                    (id,partner_id,template_id,snapshot,agreement_digest,status,partner_signature,manager_signature,storage_object_path)
                    values(%s,%s,%s,'{"commission_amount_minor_units":1234,"currency":"USD"}',%s,'countersigned',
                    '{"typed_legal_name":"Fictional contact"}','{"typed_legal_name":"Fictional manager"}',%s)""",
                                   (agreement, partner_id, self.template, "a" * 64, f"partners/{partner_id}/agreements/{agreement}/signed.pdf"))
                connection.execute("update public.referral_partners set status='active',current_agreement_id=%s,activated_at=statement_timestamp() where id=%s", (agreement, partner_id))
        self.seed_committed = True
        rows = self.observer.execute("select partner_id,code from public.referral_partner_links where partner_id=any(%s)", (self.partners,)).fetchall()
        self.codes = {row["partner_id"]: row["code"] for row in rows}
        assert len(self.codes) == 2, "Fixture activation did not create both links"

    def wait_for_lock(self, application_name):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            waiting = self.observer.execute("""select wait_event from pg_stat_activity
                where application_name=%s and wait_event_type='Lock'""", (application_name,)).fetchone()
            if waiting:
                return waiting["wait_event"]
            time.sleep(0.02)
        raise AssertionError("Competing request did not reach a real PostgreSQL lock wait")

    def draft(self, connection, code):
        if code is None:
            return connection.execute("select (public.get_or_create_total_loss_draft()).id as id").fetchone()["id"]
        return connection.execute("select (public.get_or_create_referred_total_loss_draft(%s)).id as id", (code,)).fetchone()["id"]

    def draft_race(self, index, first_code, second_code, expected_partner):
        owner = self.customers[index]
        first = self.connect(f"draft_{index}_first")
        second = self.connect(f"draft_{index}_second")
        second_name = second.info.parameter_status("application_name")
        try:
            self.identity(first, owner)
            self.identity(second, owner)
            case_id = self.draft(first, first_code)
            self.cases.append(case_id)
            with ThreadPoolExecutor(max_workers=1) as executor:
                pending = executor.submit(self.draft, second, second_code)
                try:
                    wait = self.wait_for_lock(second_name)
                    assert not pending.done(), "Competing bootstrap unexpectedly bypassed the held owner lock"
                finally:
                    first.commit()
                resumed = pending.result(timeout=10)
                second.commit()
            assert resumed == case_id, "The competing request created another draft"
            assert self.observer.execute("select count(*) as count from public.appraisal_cases where user_id=%s", (owner,)).fetchone()["count"] == 1
            rows = self.observer.execute("select partner_id from public.referral_case_attributions where case_id=%s", (case_id,)).fetchall()
            assert [row["partner_id"] for row in rows] == ([] if expected_partner is None else [expected_partner]), "First-created case attribution changed"
            print(f"PASS draft race {index + 1}: observed {wait} wait; one case; first attribution retained", flush=True)
            return case_id
        finally:
            first.close()
            second.close()

    def prepare_order(self, case_id, owner):
        suite = Path(__file__).parents[1] / "database" / "038_referral_partner_attribution.test.sql"
        helper = re.search(r"create function pg_temp\.prepare_referral_commerce_case\([\s\S]+?\nend;\n\$\$;", suite.read_text())
        assert helper is not None, "The shared commerce fixture helper is unavailable"
        now = datetime.now(timezone.utc)
        self.session_id = f"cs_test_referral_race_{self.run_id}"
        self.payment_id = f"pi_referral_race_{self.run_id}"
        self.webhook_tokens = [uuid4(), uuid4()]
        self.purchase_time = now - timedelta(seconds=2)
        with self.connect("commerce_seed") as connection:
            connection.execute(helper.group())
            connection.execute("select pg_temp.prepare_referral_commerce_case(%s,%s,%s)", (case_id, owner, f"referral-race-{owner.hex}@example.test"))
            connection.execute("set local role service_role")
            order = connection.execute("""select * from public.reserve_total_loss_checkout(%s,%s,%s,
                'total-loss-package','1','price_test_referral_race',9900,'USD','terms-1','refund-1',false)""", (case_id, owner, uuid4())).fetchone()
            connection.execute("select * from public.attach_total_loss_checkout_session(%s,%s,%s,null,%s,false)",
                               (order["checkout_attempt_id"], self.session_id, self.payment_id, now + timedelta(hours=1)))
            for event, token in zip(self.events, self.webhook_tokens, strict=True):
                row = connection.execute("""select * from public.claim_stripe_webhook_event(%s,'checkout.session.completed',false,
                    '2025-08-27.basil',%s,1024,%s,%s)""", (event, "b" * 64, self.purchase_time, token)).fetchone()
                assert row["state"] == "claimed", "The service boundary did not claim the fixture webhook"
        return order

    def fulfill(self, connection, case_id, order, index):
        return connection.execute("""select * from public.fulfill_total_loss_checkout_payment(%s,%s,%s,%s,%s,%s,%s,
            'price_test_referral_race',1,9900,'USD',false,%s)""",
                                  (case_id, order["order_id"], order["checkout_attempt_id"], self.session_id, self.payment_id,
                                   self.events[index], self.webhook_tokens[index], self.purchase_time)).fetchone()

    def payment_race(self, case_id):
        order = self.prepare_order(case_id, self.customers[0])
        first = self.connect("payment_first")
        second = self.connect("payment_second")
        try:
            first.execute("set local role service_role")
            second.execute("set local role service_role")
            winner = self.fulfill(first, case_id, order, 0)
            assert winner["outcome"] == "fulfilled"
            with ThreadPoolExecutor(max_workers=1) as executor:
                pending = executor.submit(self.fulfill, second, case_id, order, 1)
                try:
                    wait = self.wait_for_lock(second.info.parameter_status("application_name"))
                    assert not pending.done(), "Duplicate fulfillment bypassed the held purchase lock"
                finally:
                    first.commit()
                replay = pending.result(timeout=10)
                second.commit()
            assert replay["outcome"] == "already_fulfilled"
            assert replay["payment_transaction_id"] == winner["payment_transaction_id"]
            for table in ("referral_order_attributions", "referral_purchase_conversions", "payment_transactions", "case_entitlements"):
                count = self.observer.execute(sql.SQL("select count(*) as count from public.{} where order_id=%s").format(sql.Identifier(table)), (order["order_id"],)).fetchone()["count"]
                assert count == 1, f"Parallel fulfillment duplicated {table}"
            print(f"PASS fulfillment race: observed {wait} wait; valid distinct claimed events; one payment and conversion", flush=True)
        finally:
            first.close()
            second.close()

    def cleanup(self):
        if not self.seed_committed:
            return
        with self.connect("cleanup") as connection:
            # This affects only this transaction, never other sessions' trigger behavior.
            connection.execute("set local session_replication_role=replica")
            cases = [row["id"] for row in connection.execute("select id from public.appraisal_cases where user_id=any(%s)", (self.users,)).fetchall()]
            tables = connection.execute("""select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
                where n.nspname='public' and c.relkind in ('r','p') and exists(select 1 from pg_attribute a
                where a.attrelid=c.oid and a.attname='case_id' and not a.attisdropped)""").fetchall()
            for table in tables:
                connection.execute(sql.SQL("delete from public.{} where case_id=any(%s)").format(sql.Identifier(table["relname"])), (cases,))
            connection.execute("delete from public.stripe_webhook_events where external_event_id=any(%s)", (self.events,))
            connection.execute("delete from public.appraisal_cases where id=any(%s)", (cases,))
            connection.execute("delete from public.referral_partner_signatures where agreement_id=any(%s)", (self.agreements,))
            for table in ("referral_partner_jobs", "referral_partner_events", "referral_partner_invitations", "referral_partner_links", "referral_partner_agreements"):
                connection.execute(sql.SQL("delete from public.{} where partner_id=any(%s)").format(sql.Identifier(table)), (self.partners,))
            connection.execute("delete from public.referral_partner_requests where actor_user_id=any(%s)", (self.users,))
            connection.execute("delete from public.referral_partners where id=any(%s)", (self.partners,))
            connection.execute("delete from public.referral_partner_templates where id=%s", (self.template,))
            for table in ("referral_partner_managers", "staff_members"):
                connection.execute(sql.SQL("delete from public.{} where user_id=any(%s)").format(sql.Identifier(table)), (self.users,))
            connection.execute("delete from public.profiles where id=any(%s)", (self.users,))
            connection.execute("delete from auth.users where id=any(%s)", (self.users,))
        assert self.observer.execute("select count(*) as count from auth.users where id=any(%s)", (self.users,)).fetchone()["count"] == 0
        assert self.observer.execute("select count(*) as count from public.referral_partners where id=any(%s)", (self.partners,)).fetchone()["count"] == 0
        assert self.observer.execute("select count(*) as count from public.appraisal_cases where id=any(%s)", (self.cases,)).fetchone()["count"] == 0
        print("PASS cleanup: exact disposable users, cases, partner records, and payment fixtures removed", flush=True)

    def run(self):
        try:
            self.seed()
            first = self.draft_race(0, self.codes[self.partners[0]], self.codes[self.partners[1]], self.partners[0])
            self.draft_race(1, None, self.codes[self.partners[0]], None)
            self.draft_race(2, self.codes[self.partners[0]], None, self.partners[0])
            self.payment_race(first)
        finally:
            try:
                self.cleanup()
            finally:
                self.observer.close()


if __name__ == "__main__":
    ReferralRaces().run()
