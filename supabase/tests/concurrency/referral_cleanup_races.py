"""Verify submission/cleanup serialization in a network-isolated local database."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
import subprocess
import sys
import time
from uuid import uuid4

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--container',required=True)
args=parser.parse_args()
assert re.fullmatch(r'venfour-migration-rehearsal[-a-z0-9]*',args.container)
assert subprocess.check_output(['docker','inspect',args.container,'--format','{{.HostConfig.NetworkMode}}'],text=True).strip()=='none'
command=['docker','exec','-i',args.container,'psql','-X','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-f','-']
def sql(body,check=True):
    r=subprocess.run(command,input="set statement_timeout='15s';\n"+body,text=True,capture_output=True)
    if check and r.returncode: raise AssertionError(r.stderr)
    return r

def hold(body):
    p=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    p.stdin.write("set statement_timeout='15s'; begin;\n"+body+"\nselect 'BARRIER';\n")
    p.stdin.flush()
    while True:
        line=p.stdout.readline()
        if line.strip()=='BARRIER': return p
        if not line: raise AssertionError(p.stderr.read())

def release(p):
    p.stdin.write('commit;\n');p.stdin.close();p.wait(timeout=20)
    if p.returncode: raise AssertionError(p.stderr.read())

def wait_for_lock(name):
    deadline=time.monotonic()+10
    while time.monotonic()<deadline:
        count=sql(f"select count(*) from pg_stat_activity where application_name='{name}' and wait_event_type='Lock';").stdout.strip()
        if count=='1': return
        time.sleep(0.02)
    raise AssertionError('Independent session did not reach the expected lock wait')

def fixture():
    user,case,run,token=(str(uuid4()) for _ in range(4))
    sql(f"""begin;
      insert into auth.users(id,is_anonymous,created_at,updated_at,last_sign_in_at)
      values('{user}',true,now()-interval '50 days',now()-interval '50 days',now()-interval '50 days');
      alter table public.profiles disable trigger profiles_set_updated_at;
      update public.profiles set created_at=now()-interval '50 days',updated_at=now()-interval '50 days' where id='{user}';
      alter table public.profiles enable trigger profiles_set_updated_at;
      insert into public.appraisal_cases(id,user_id,service_type,status,created_at,updated_at,last_activity_at)
      values('{case}','{user}','total_loss','draft',now()-interval '50 days',now()-interval '50 days',now()-interval '50 days');
      insert into public.total_loss_case_details(case_id,intake_mode,report_storage_owner_id,created_at,updated_at)
      values('{case}','report','{user}',now()-interval '50 days',now()-interval '50 days');
      insert into public.referral_case_attributions(case_id,partner_id,link_id,agreement_id,agreement_digest,commission_amount_minor_units,currency)
      select '{case}',partner_id,id,'e9600000-0000-4000-8000-000000000003',repeat('e',64),4500,'USD'
      from public.referral_partner_links where partner_id='e9600000-0000-4000-8000-000000000002';
      insert into public.anonymous_guest_cleanup_candidates(user_id,state,first_marked_at,delete_after,eligibility_checked_at)
      values('{user}','grace',now()-interval '2 days',now()-interval '1 day',now());
      insert into public.anonymous_guest_cleanup_runs(id,dry_run,requested_batch_size,status) values('{run}',false,25,'running');
      commit;""")
    return user,case,run,token

# Use committed state as production does: each side owns an independent session.
user,case,run,token=fixture()
p=hold(f"update public.referral_case_attributions set submitted_at=clock_timestamp() where case_id='{case}';")
with ThreadPoolExecutor(max_workers=1) as pool:
    future=pool.submit(sql,f"set application_name='rehearsal-{token}'; select count(*) from public.claim_abandoned_anonymous_guest_cleanup_candidate('{run}','{token}');")
    # The open transaction holds the shared advisory lock until explicitly released.
    wait_for_lock('rehearsal-'+token)
    release(p)
    assert future.result().stdout.strip()=='0'
assert sql(f"select state from public.anonymous_guest_cleanup_candidates where user_id='{user}';").stdout.strip()=='cancelled'
print('PASS committed submission before cleanup excludes the candidate across sessions',flush=True)
sql(f"select public.finish_abandoned_anonymous_guest_cleanup_run('{run}',false);")
user,case,run,token=fixture()
p=hold(f"select user_id from public.claim_abandoned_anonymous_guest_cleanup_candidate('{run}','{token}');")
with ThreadPoolExecutor(max_workers=1) as pool:
    future=pool.submit(sql,f"set application_name='rehearsal-{token}'; update public.referral_case_attributions set submitted_at=clock_timestamp() where case_id='{case}';",False)
    wait_for_lock('rehearsal-'+token)
    release(p)
    response=future.result()
    assert response.returncode!=0 and 'being retired' in response.stderr,response.stderr
assert sql(f"select submitted_at is null from public.referral_case_attributions where case_id='{case}';").stdout.strip()=='t'
sql(f"select public.start_abandoned_anonymous_guest_storage_deletion('{user}','{token}');")
print('PASS cleanup lease before submission fences the writer; no late protected history can appear before file deletion',flush=True)
sql(f"select public.block_abandoned_anonymous_guest_cleanup_candidate('{user}','{token}','REHEARSAL_COMPLETE'); select public.finish_abandoned_anonymous_guest_cleanup_run('{run}',false);")
print('ZERO hosted writes; ZERO provider requests; all connections use container Unix sockets.',flush=True)
