"""Exercise bounded lock waits and retry identities in a network-isolated database."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import copy
import hashlib
import json
import os
import subprocess
import sys
import time
from uuid import uuid4

from market_request_budget_races import BudgetRaces, reject_network


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', required=True)
    args = parser.parse_args()
    os.environ.clear()
    os.environ['PATH']='/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
    sys.addaudithook(reject_network)
    info=json.loads(subprocess.check_output(['docker','inspect',args.container],text=True))[0]
    assert info['HostConfig']['NetworkMode']=='none' and not info['HostConfig']['PortBindings']
    races=BudgetRaces(args.container)
    results={}
    try:
        identity=races.fixture(races.account())
        identity['policy'].update(totalAttempts=20,supportingAttempts=2,supportingDiscoveryAttempts=1,optimizationTarget=[20,20])
        identity['policy']['operationLimits'].update(active_discovery=3,historical_discovery=3,vin_history=12,enrichment=1,vehicle_terms=1)
        operations=[('active_inventory','baseline',None)]*3+[('historical_inventory','baseline',None)]*3
        operations += [('vin_history','baseline',hashlib.sha256(str(i//3).encode()).hexdigest()) for i in range(12)]
        operations += [('active_inventory','enrichment',None),('vehicle_terms','baseline',None)]
        operations += operations[:]*2
        with ThreadPoolExecutor(max_workers=12) as pool:
            replies=list(pool.map(lambda op:races.reserve(identity,*op),operations))
        assert sum(r['allowed'] for r in replies)==20
        assert races.reserve(identity)['reasonCode']=='MARKET_CASE_BUDGET_EXHAUSTED'
        results['canary']={'concurrentAttempts':len(replies),'reserved':20,'overspent':False}

        identity=races.fixture(races.account())
        payload={**identity,'reservationId':str(uuid4()),'endpoint':'active_inventory','phase':'baseline','vinKey':None,'estimatedCostMicros':None}
        def same_request(_):
            return json.loads(races.psql("select public.reserve_market_request_attempt('"+json.dumps(payload)+"'::jsonb);"))
        with ThreadPoolExecutor(max_workers=12) as pool: replies=list(pool.map(same_request,range(24)))
        assert sum(r['allowed'] for r in replies)==1
        assert all(r['allowed'] or r['reasonCode']=='MARKET_ATTEMPT_ALREADY_RESERVED' for r in replies)
        results['duplicateReservation']={'messages':24,'reserved':1}

        identity=races.fixture(races.account(),monthly=500,prior=499)
        identity['policy']['monthlyReserveBasisPoints']=0
        identity['accountLimits']['reserveBasisPoints']=0
        assert races.reserve(identity)['allowed']
        denied=races.reserve(identity)
        assert not denied['allowed'] and denied['usage']['monthlyAttempts']==500
        results['monthlyAllowance']={'monthlyAttempts':500,'nextDenied':True}

        identity=races.fixture(races.account(),rate=1)
        identity['accountLimits']['rateWindowSeconds']=1
        assert races.reserve(identity)['allowed']
        cooldown=races.reserve(identity)
        assert cooldown['reasonCode']=='MARKET_ACCOUNT_RATE_LIMIT_REACHED'
        time.sleep(cooldown['retryAfterSeconds']+0.05)
        assert races.reserve(identity)['allowed']
        results['rateCooldown']={'deniedWithinWindow':True,'allowedAfterWindow':True}

        busy=races.fixture(races.account()); other=races.fixture(races.account())
        assert races.reserve(busy)['allowed']
        holder=subprocess.Popen(['docker','exec','-i',args.container,'psql','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        holder.stdin.write("begin; select account_key from public.market_request_accounts where account_key='"+busy['accountKey']+"' for update;\n\\echo locked\nselect pg_sleep(2); commit;\n")
        holder.stdin.close()
        while holder.stdout.readline().strip()!='locked':
            assert holder.poll() is None,'holder exited unexpectedly'
        started=time.monotonic()
        try:
            races.reserve(busy)
        except subprocess.CalledProcessError as error:
            assert 'lock timeout' in error.stderr
        else: raise AssertionError('Busy account did not time out')
        elapsed=time.monotonic()-started
        assert 0.45<=elapsed<1.4
        unrelated=time.monotonic();assert races.reserve(other)['allowed'];unrelated=time.monotonic()-unrelated
        assert unrelated<0.5
        assert holder.wait(timeout=5)==0
        assert races.reserve(busy)['allowed']
        count=int(races.psql("select count(*) from public.market_request_attempts where case_id='"+busy['caseId']+"';"))
        assert count==2,'Timed-out reservation must roll back'
        results['contention']={'boundedWaitSeconds':round(elapsed,3),'unrelatedAccountSeconds':round(unrelated,3),'timedOutReservationRolledBack':True,'afterReleaseAllowed':True}
        print(json.dumps(results,indent=2))
    finally:races.cleanup()
    print('PASS no overspending or deadlocks; no network; zero provider requests')

if __name__=='__main__':main()
