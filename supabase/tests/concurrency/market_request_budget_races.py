"""Verify request accounting through independent sessions in an isolated database.

Run with --container naming a disposable PostgreSQL container whose network mode
is none and which has the repository migrations. No provider code is imported.
Only fixture rows are created and removed, using PostgreSQL Unix sockets.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import subprocess
import sys
from uuid import uuid4


def reject_network(event, arguments):
    if event in {"socket.connect", "socket.sendto", "socket.getaddrinfo"}:
        raise AssertionError("Database verification prohibits network requests")


class BudgetRaces:
    def __init__(self, container):
        self.container = container
        self.owner = str(uuid4())
        self.accounts = []
        self.cases = []
        self.psql("select 1")

    def psql(self, statement):
        result = subprocess.run(
            ["docker", "exec", "-i", self.container, "psql", "-U", "supabase_admin",
             "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt", "-f", "-"],
            input=statement, text=True, capture_output=True, check=True,
        )
        return result.stdout.strip()

    def fixture(self, account, *, monthly=10000, prior=0, rate=10000):
        case, job, token, input_id = (str(uuid4()) for _ in range(4))
        self.cases.append(case)
        self.psql(f"""begin;
            insert into auth.users(id,email,email_confirmed_at,is_anonymous)
            values('{self.owner}','budget-fixture-{self.owner}@example.test',clock_timestamp(),false)
            on conflict (id) do nothing;
            insert into public.appraisal_cases(id,user_id,service_type,status)
            values('{case}','{self.owner}','total_loss','checking');
            insert into public.total_loss_case_details(case_id,intake_mode,vehicle_year,vehicle_make,
              vehicle_model,vehicle_trim,mileage_at_loss,postal_code,date_of_loss,insurer_name,
              insurer_vehicle_valuation,intake_completed_at,analysis_input_revision,analysis_input_id)
            values('{case}','manual',2022,'Honda','Accord','EX-L',32000,'60601',current_date-10,
              'Fixture Insurance',18000,clock_timestamp(),1,'{input_id}');
            insert into public.total_loss_analysis_jobs(id,case_id,source_details_updated_at,status,
              processing_token,processing_expires_at,source_intake_mode,source_analysis_input_revision,
              source_analysis_input_id)
            values('{job}','{case}',clock_timestamp(),'processing','{token}',
              clock_timestamp()+interval '1 hour','manual',1,'{input_id}');
            commit;
        """)
        now = datetime.now(timezone.utc)
        return {
            "accountKey": account, "caseId": case,
            "executionFence": {"jobId": job, "processingToken": token},
            "policy": {
                "totalAttempts": 60, "supportingAttempts": 5, "supportingDiscoveryAttempts": 2,
                "operationLimits": {"active_discovery": 8, "historical_discovery": 8,
                                    "vin_history": 40, "enrichment": 9, "vehicle_terms": 2},
                "perVinHistoryAttempts": 3, "monthlyReserveBasisPoints": 2000,
                "optimizationTarget": [20, 30],
            },
            "accountLimits": {
                "monthlyAllowance": monthly, "metered": False, "requestsPerWindow": rate,
                "rateWindowSeconds": 60, "periodStart": (now - timedelta(days=1)).isoformat(),
                "periodEnd": (now + timedelta(days=29)).isoformat(),
                "priorMonthlyAttempts": prior, "reserveBasisPoints": 2000,
            },
        }

    def account(self):
        account = hashlib.sha256(uuid4().bytes).hexdigest()
        self.accounts.append(account)
        return account

    def reserve(self, identity, endpoint="active_inventory", phase="baseline", vin=None):
        request = {**identity, "reservationId": str(uuid4()), "endpoint": endpoint,
                   "phase": phase, "vinKey": vin, "estimatedCostMicros": None}
        # JSON originates entirely from UUIDs and explicit fixture values above.
        payload = json.dumps(request).replace("'", "''")
        return json.loads(self.psql(
            f"set statement_timeout='30s'; select public.reserve_market_request_attempt('{payload}'::jsonb);"
        ))

    def sixty_attempt_case(self):
        identity = self.fixture(self.account())
        operations = []
        for index in range(60):
            if index < 8:
                operations.append(("active_inventory", "supporting" if index == 0 else "baseline", None))
            elif index < 16:
                operations.append(("historical_inventory", "supporting" if index == 8 else "baseline", None))
            elif index < 56:
                vin = hashlib.sha256(f"fixture-history-{(index-16)//3}".encode()).hexdigest()
                operations.append(("vin_history", "supporting" if index < 19 else "baseline", vin))
            else:
                operations.append(("active_inventory", "enrichment", hashlib.sha256(uuid4().bytes).hexdigest()))
        first = [self.reserve(identity, *operation) for operation in operations[:30]]
        assert all(row["allowed"] for row in first), "Initial fixture reservations failed"
        old_identity = {**identity, "executionFence": dict(identity["executionFence"])}
        new_token = str(uuid4())
        self.psql(f"update public.total_loss_analysis_jobs set processing_token='{new_token}' "
                  f"where id='{identity['executionFence']['jobId']}';")
        identity["executionFence"]["processingToken"] = new_token
        assert self.reserve(old_identity)["reasonCode"] == "MARKET_SEARCH_EXECUTION_LEASE_UNAVAILABLE"
        excess = [("active_inventory", "enrichment", hashlib.sha256(uuid4().bytes).hexdigest()) for _ in range(20)]
        with ThreadPoolExecutor(max_workers=12) as executor:
            replies = list(executor.map(lambda item: self.reserve(identity, *item), operations[30:] + excess))
        assert sum(row["allowed"] for row in replies) == 30, "Concurrent resumed execution exceeded or lost case headroom"
        assert self.reserve(identity)["reasonCode"] == "MARKET_CASE_BUDGET_EXHAUSTED"
        case = identity["caseId"]
        summary = json.loads(self.psql(f"""select jsonb_build_object('total',count(*),
            'supporting',count(*) filter(where phase='supporting'),
            'active',count(*) filter(where operation='active_discovery'),
            'historical',count(*) filter(where operation='historical_discovery'),
            'history',count(*) filter(where operation='vin_history'),
            'enrichment',count(*) filter(where operation='enrichment'))
            from public.market_request_attempts where case_id='{case}';"""))
        assert summary["total"] == 60 and summary["supporting"] == 5
        assert summary["active"] == summary["historical"] == 8
        assert summary["history"] > 0 and summary["enrichment"] > 0
        print("PASS 60-attempt cumulative ceiling: 30 prior + 50 concurrent resumed attempts; exactly 60 saved; stale lease denied", flush=True)
        print("Endpoint/phase accounting:", json.dumps(summary, sort_keys=True), flush=True)

    def shared_limit(self, *, monthly, prior, rate, accepted, reason):
        account = self.account()
        identities = [self.fixture(account, monthly=monthly, prior=prior, rate=rate) for _ in range(24)]
        # Every worker receives the same confirmed billing-period configuration.
        for identity in identities:
            identity["accountLimits"] = identities[0]["accountLimits"]
        with ThreadPoolExecutor(max_workers=12) as executor:
            replies = list(executor.map(self.reserve, identities))
        assert sum(row["allowed"] for row in replies) == accepted
        assert all(row["allowed"] or row["reasonCode"] == reason for row in replies)
        assert int(self.psql(f"select count(*) from public.market_request_attempts where account_key='{account}';")) == accepted
        print(f"PASS shared {reason}: 24 concurrent cases; exactly {accepted} physical reservations", flush=True)

    def cleanup(self):
        accounts = ",".join(f"'{value}'" for value in self.accounts)
        if accounts:
            self.psql(f"""begin; set local session_replication_role='replica';
                delete from public.market_request_attempts where account_key in ({accounts});
                delete from public.market_request_cases where account_key in ({accounts});
                delete from public.market_request_accounts where account_key in ({accounts});
                delete from public.total_loss_analysis_jobs where case_id in
                  (select id from public.appraisal_cases where user_id='{self.owner}');
                delete from public.total_loss_case_details where case_id in
                  (select id from public.appraisal_cases where user_id='{self.owner}');
                delete from public.appraisal_cases where user_id='{self.owner}';
                delete from public.profiles where id='{self.owner}';
                delete from auth.users where id='{self.owner}'; commit;""")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", required=True)
    args = parser.parse_args()
    os.environ.clear()
    os.environ["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    sys.addaudithook(reject_network)
    container = json.loads(subprocess.check_output(["docker", "inspect", args.container], text=True))[0]
    assert container["HostConfig"]["NetworkMode"] == "none", "Only a network-isolated disposable container is permitted"
    assert not any("MARKETCHECK" in item.split("=", 1)[0].upper() for item in container["Config"]["Env"]), "Provider credentials must be unavailable"
    races = BudgetRaces(args.container)
    try:
        races.sixty_attempt_case()
        races.shared_limit(monthly=10, prior=3, rate=10000, accepted=5, reason="MARKET_MONTHLY_RESERVE_REACHED")
        races.shared_limit(monthly=10000, prior=0, rate=2, accepted=2, reason="MARKET_ACCOUNT_RATE_LIMIT_REACHED")
    finally:
        races.cleanup()
    print("PASS fixture cleanup; zero provider imports or requests; database network mode none", flush=True)


if __name__ == "__main__":
    main()
