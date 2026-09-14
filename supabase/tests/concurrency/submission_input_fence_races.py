"""Exercise actual submission lock waits in a network-isolated rehearsal database.

Only random, explicitly scoped fixtures are committed. They are removed afterward;
no provider modules, host database credentials, or network connections are used.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
import re
import subprocess
import sys
import time
from uuid import uuid4

from market_request_budget_races import reject_network


class Session:
    def __init__(self, container, name):
        self.process = subprocess.Popen(
            ["docker", "exec", "-i", container, "psql", "-X", "-U", "supabase_admin",
             "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        self.execute(f"set application_name='{name}'; set statement_timeout='15s';")

    def execute(self, statement):
        marker = uuid4().hex
        self.process.stdin.write(statement + "\n\\echo " + marker + "\n")
        self.process.stdin.flush()
        output = []
        while True:
            line = self.process.stdout.readline()
            if not line:
                raise AssertionError(self.process.stderr.read())
            if line.strip() == marker:
                return "\n".join(output)
            if line.strip():
                output.append(line.strip())

    def close(self):
        if self.process.poll() is None:
            self.process.stdin.close()
            self.process.wait(timeout=20)


class SubmissionRaces:
    def __init__(self, container):
        self.container = container
        self.owner, self.other_owner = str(uuid4()), str(uuid4())
        self.cases = []

    def psql(self, statement):
        return subprocess.check_output(
            ["docker", "exec", "-i", self.container, "psql", "-X", "-U", "supabase_admin",
             "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"],
            input=statement, text=True,
        ).strip()

    def fixture(self):
        case = str(uuid4())
        self.cases.append(case)
        self.psql(f"""begin;
          insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
            ('{self.owner}','submission-{self.owner}@example.test',now(),true),
            ('{self.other_owner}','submission-{self.other_owner}@example.test',now(),false)
            on conflict(id) do nothing;
          insert into public.appraisal_cases(id,user_id,service_type,status)
            values('{case}','{self.owner}','total_loss','draft');
          insert into public.total_loss_case_details(case_id,intake_mode,vehicle_year,vehicle_make,
            vehicle_model,vehicle_trim,mileage_at_loss,postal_code,date_of_loss)
            values('{case}','manual',2024,'Honda','Accord','EX',32000,'60601',current_date-10);
          select set_config('request.jwt.claims',
            '{{"sub":"{self.owner}","role":"authenticated","is_anonymous":true}}',true);
          set local role authenticated;
          select public.save_total_loss_contact_details_and_begin_claim('{case}','Fixture','Driver',
            'submission-{self.owner}@example.test',null,'2026-08-23','2026-08-23',false);
          select public.confirm_total_loss_intake('{case}',
            (select updated_at from public.total_loss_case_details where case_id='{case}'));
          commit;""")
        identity = json.loads(self.psql(f"""select jsonb_build_object('id',analysis_input_id,
          'revision',analysis_input_revision) from public.total_loss_case_details where case_id='{case}';"""))
        return case, identity

    def claim(self, case, identity, token):
        return f"""select row_to_json(r) from public.claim_total_loss_analysis_input(
          '{case}','{self.owner}','{token}','{identity['id']}',{identity['revision']}) r;"""

    def wait(self, name):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            event = self.psql(f"select wait_event from pg_stat_activity where application_name='{name}' and wait_event_type='Lock';")
            if event:
                return event
            time.sleep(.02)
        raise AssertionError("Competing connection did not reach a PostgreSQL lock wait")

    def race(self, scenario):
        case, identity = self.fixture()
        token = str(uuid4())
        name = "submission_race_" + uuid4().hex
        first, second = Session(self.container, name + "_first"), Session(self.container, name)
        try:
            first.execute("begin;")
            if scenario == "edit_wins":
                first.execute(f"select id from public.appraisal_cases where id='{case}' for update;"
                              f"update public.total_loss_case_details set mileage_at_loss=33000 where case_id='{case}';")
            elif scenario == "ownership_wins":
                first.execute(f"update public.appraisal_cases set user_id='{self.other_owner}' where id='{case}';")
            else:
                winner = json.loads(first.execute(self.claim(case, identity, token)))
                assert winner["outcome"] == "claimed"
            competing_token = token if scenario == "same_token" else str(uuid4())
            with ThreadPoolExecutor(max_workers=1) as pool:
                pending = pool.submit(second.execute, self.claim(case, identity, competing_token))
                try:
                    event = self.wait(name)
                    assert not pending.done()
                finally:
                    first.execute("commit;")
                reply = json.loads(pending.result(timeout=20))
            jobs = json.loads(self.psql(f"select coalesce(jsonb_agg(to_jsonb(j)),'[]') from public.total_loss_analysis_jobs j where case_id='{case}';"))
            if scenario in ("edit_wins", "ownership_wins"):
                assert reply["outcome"] == ("case_not_ready" if scenario == "edit_wins" else "not_found")
                assert jobs == []
                assert self.psql(f"select status from public.appraisal_cases where id='{case}';") == "draft"
            else:
                assert reply["outcome"] == ("claimed" if scenario == "same_token" else "processing")
                assert len(jobs) == 1 and jobs[0]["attempt_count"] == 1
                assert reply["job_id"] == winner["job_id"] == jobs[0]["id"]
                assert jobs[0]["source_analysis_input_id"] == identity["id"]
                assert jobs[0]["source_analysis_input_revision"] == identity["revision"]
            return {"lockWait": event, "outcome": reply["outcome"], "jobs": len(jobs),
                    "attempts": sum(j["attempt_count"] for j in jobs)}
        finally:
            first.close()
            second.close()

    def cleanup(self):
        cases = ",".join("'" + case + "'::uuid" for case in self.cases)
        if not cases:
            return
        self.psql(f"""begin; set local session_replication_role=replica;
          do $$declare t record; begin
            for t in select c.relname as table_name from pg_class c
              join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='public' and c.relkind in ('r','p')
                and exists(select 1 from pg_attribute a where a.attrelid=c.oid
                  and a.attname='case_id' and not a.attisdropped) loop
              execute format('delete from public.%I where case_id=any($1)',t.table_name)
                using array[{cases}];
            end loop;
          end $$;
          delete from public.appraisal_cases where id in ({cases});
          delete from public.profiles where id in ('{self.owner}','{self.other_owner}');
          delete from auth.users where id in ('{self.owner}','{self.other_owner}');
          commit;""")
        assert self.psql(f"select count(*) from public.appraisal_cases where id in ({cases});") == "0"
        assert self.psql(f"select count(*) from public.profiles where id in ('{self.owner}','{self.other_owner}');") == "0"


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
    races = SubmissionRaces(args.container)
    results = {}
    try:
        for scenario in ("edit_wins", "distinct_tokens", "same_token", "ownership_wins"):
            results[scenario] = races.race(scenario)
    finally:
        races.cleanup()
    print(json.dumps({"scenarios": results, "fixturesRemoved": True, "liveProviderRequests": 0}, indent=2))


if __name__ == "__main__":
    main()
