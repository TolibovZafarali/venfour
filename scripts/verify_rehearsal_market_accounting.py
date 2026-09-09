"""Use the production provider adapters with mocked transport and the real local ledger."""
import argparse
from datetime import UTC, datetime, timedelta
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'tests')]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--container',required=True)
args=parser.parse_args()
os.environ.clear()
os.environ['PATH']='/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
def reject_network(event,arguments):
    if event in {'socket.connect','socket.sendto','socket.getaddrinfo'}:
        raise AssertionError('Live networking is prohibited')
sys.addaudithook(reject_network)
assert subprocess.check_output(['docker','inspect',args.container,'--format','{{.HostConfig.NetworkMode}}'],text=True).strip()=='none'
spec=importlib.util.spec_from_file_location('ledger_fixture',ROOT/'supabase/tests/concurrency/market_request_budget_races.py')
fixture_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture_module)
fixture=fixture_module.BudgetRaces(args.container)
from venfour.market_request_budget import MarketAccountLimits, MarketRequestBudget
import tests.test_marketcheck_paged as workflow

class DatabaseGateway:
    def call(self,name,request):
        payload=json.dumps(request).replace("'","''")
        return json.loads(fixture.psql(f"set role service_role; select public.{name}('{payload}'::jsonb);"))
    def reserve_market_request_attempt(self,request): return self.call('reserve_market_request_attempt',request)
    def get_market_request_usage(self,request): return self.call('get_market_request_usage',request)
    def record_market_request_account_state(self,request): return self.call('record_market_request_account_state',request)

try:
    identity=fixture.fixture(fixture.account())
    now=datetime.now(UTC)
    limits=MarketAccountLimits(monthly_allowance=10000,max_requests_per_window=10000,rate_window_seconds=60,
      monthly_period_start=(now-timedelta(days=1)).isoformat(),monthly_period_end=(now+timedelta(days=29)).isoformat(),
      monthly_usage_before_tracking=0)
    gateway=DatabaseGateway()
    def budget(*_args,**_kwargs):
        return MarketRequestBudget(gateway,identity['accountKey'],identity['caseId'],account_limits=limits,
          job_id=identity['executionFence']['jobId'],processing_token=identity['executionFence']['processingToken'])
    case=workflow.MarketCheckAttemptBudgetTests('test_sixty_physical_attempts_include_pages_retries_enrichment_supporting_and_resume')
    case.budget=budget
    original=workflow.MarketRequestBudget
    workflow.MarketRequestBudget=budget
    try:
        case.test_sixty_physical_attempts_include_pages_retries_enrichment_supporting_and_resume()
    finally:
        workflow.MarketRequestBudget=original
    result=budget().snapshot()
    assert result['totalAttempts']==60
    print(json.dumps({'passed':True,'mockedTransportAttempts':60,'liveProviderRequests':0,'persistedUsage':result},indent=2))
finally:
    fixture.cleanup()
