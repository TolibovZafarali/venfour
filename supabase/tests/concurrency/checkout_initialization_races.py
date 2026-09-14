"""Verify exact report initialization and checkout deduplication with real locks."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from uuid import uuid4

from market_request_budget_races import reject_network
from submission_input_fence_races import Session, SubmissionRaces


class CheckoutRaces(SubmissionRaces):
    def fixture(self):
        case = str(uuid4())
        self.cases.append(case)
        source = (Path(__file__).parents[1] / "database/048_total_loss_checkout_initialization.test.sql").read_text()
        helper = re.search(r"create function pg_temp\.checkout_initialization_fixture\([\s\S]+?\n\$\$;", source)
        assert helper is not None
        return json.loads(self.psql(helper.group() + f"\nselect pg_temp.checkout_initialization_fixture('{case}','{self.owner}');"))

    def initialize(self, f):
        presentation = json.dumps(f["presentation"]).replace("'", "''")
        return f"""select public.initialize_total_loss_post_continue('{f['case']}','{f['owner']}',
          '{f['run']}','{f['input']}',{f['revision']},'{f['report']}',{f['reportRevision']},
          '{presentation}'::jsonb,'{f['digest']}');"""

    def reserve(self, f, request):
        return f"""select row_to_json(r) from public.reserve_total_loss_checkout('{f['case']}','{f['owner']}',
          '{request}','total-loss-package','1','price_test_race_initialization',19900,'USD','terms-1','refund-1',false) r;"""

    def race(self, scenario):
        f = self.fixture()
        name = "checkout_race_" + uuid4().hex
        first, second = Session(self.container, name + "_first"), Session(self.container, name)
        try:
            if scenario == "duplicate_orders":
                assert self.psql(self.initialize(f)) == "created"
            first.execute("begin;")
            competing = self.initialize(f)
            if scenario == "identity_lock_order":
                first.execute(f"select pg_advisory_xact_lock(hashtext('total_loss_case_identity_transition'),hashtext('{f['case']}')); ")
            elif scenario == "report_revision_wins":
                first.execute(f"select id from public.appraisal_cases where id='{f['case']}' for update;"
                    f"select case_id from public.total_loss_case_details where case_id='{f['case']}' for update;"
                    f"update public.total_loss_full_review_reports set readiness=readiness where id='{f['report']}';")
            elif scenario == "report_replacement_wins":
                first.execute(f"select public.begin_total_loss_full_review_report('{f['case']}','{f['owner']}',"
                              f"'{uuid4()}','replacement.pdf',repeat('c',64),123);")
            elif scenario == "ownership_wins":
                first.execute(f"insert into auth.users(id,email,is_anonymous) values('{self.other_owner}',"
                              f"'checkout-other-{self.other_owner}@example.test',false) on conflict(id) do nothing;"
                              f"update public.appraisal_cases set user_id='{self.other_owner}' where id='{f['case']}';")
            elif scenario == "duplicate_orders":
                winner = json.loads(first.execute(self.reserve(f, str(uuid4()))))
                assert winner["state"] == "reserved"
                competing = self.reserve(f, str(uuid4()))
            else:
                assert first.execute(self.initialize(f)) == "created"
            with ThreadPoolExecutor(max_workers=1) as pool:
                pending = pool.submit(second.execute, competing)
                try:
                    event = self.wait(name)
                    assert not pending.done()
                    if scenario == "identity_lock_order":
                        assert event == "advisory"
                        first.execute(f"select id from public.appraisal_cases where id='{f['case']}' for update;")
                finally:
                    first.execute("commit;")
                reply = pending.result(timeout=20)
            counts = json.loads(self.psql(f"""select jsonb_build_object(
              'snapshots',(select count(*) from public.total_loss_preliminary_snapshots where case_id='{f['case']}'),
              'workflows',(select count(*) from public.total_loss_claim_workflows where case_id='{f['case']}'),
              'orders',(select count(*) from public.commerce_orders where case_id='{f['case']}'),
              'attempts',(select count(*) from public.checkout_attempts where case_id='{f['case']}'),
              'reportBindings',(select count(*) from public.total_loss_checkout_review_reports where case_id='{f['case']}'));"""))
            if scenario in ("report_revision_wins", "report_replacement_wins", "ownership_wins"):
                assert reply == ("not_found" if scenario == "ownership_wins" else "stale")
                assert not any(counts.values())
            elif scenario == "duplicate_orders":
                reply = json.loads(reply)
                assert reply["order_id"] == winner["order_id"]
                assert reply["checkout_attempt_id"] == winner["checkout_attempt_id"]
                assert counts == {"snapshots": 1, "workflows": 1, "orders": 1, "attempts": 1, "reportBindings": 1}
                reply = reply["state"]
            else:
                assert reply == ("created" if scenario == "identity_lock_order" else "existing")
                assert counts["snapshots"] == counts["workflows"] == 1
                assert counts["orders"] == 0
            return {"lockWait": event, "outcome": reply, **counts}
        finally:
            first.close()
            second.close()

    def cleanup(self):
        if self.cases:
            cases = ",".join("'" + case + "'" for case in self.cases)
            self.psql(f"""begin; set local session_replication_role=replica;
              set local storage.allow_delete_query='true';
              delete from storage.objects where bucket_id='case-files' and split_part(name,'/',2) in ({cases});
              commit;""")
        super().cleanup()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", required=True)
    args = parser.parse_args()
    assert re.fullmatch(r"venfour-migration-rehearsal[-a-z0-9]*", args.container)
    os.environ.clear()
    os.environ["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    sys.addaudithook(reject_network)
    info = json.loads(subprocess.check_output(["docker", "inspect", args.container], text=True))[0]
    assert info["HostConfig"]["NetworkMode"] == "none" and not info["HostConfig"]["PortBindings"]
    races = CheckoutRaces(args.container)
    results = {}
    try:
        for scenario in ("duplicate_initialization", "identity_lock_order", "report_revision_wins", "report_replacement_wins", "ownership_wins", "duplicate_orders"):
            results[scenario] = races.race(scenario)
    finally:
        races.cleanup()
    print(json.dumps({"scenarios": results, "fixturesRemoved": True, "liveProviderRequests": 0, "paymentRequests": 0}, indent=2))


if __name__ == "__main__":
    main()
