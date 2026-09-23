"""Synthetic authority publication races on a fresh network-none rehearsal."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
import argparse
import copy
import hmac
import hashlib
import json
import re
import subprocess
import sys
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT),str(ROOT/'scripts'),str(ROOT/'tests')]
from rehearse_production_migrations import Rehearsal
from local_authority_login import enable_fixture_logins
from jurisdiction_authority_fixtures import (manifest,source,credential,document,install_sql,publish_sql,literal,signatures,KEYS,PUBLISHER,WRITER,stamp)
from venfour.jurisdiction import CaseFacts,digest
from venfour.jurisdiction_authority import canonical,compile_authority,attested_snapshot,content_digest

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--container',required=True);parser.add_argument('--output',required=True,type=Path)
args=parser.parse_args(); r=Rehearsal(args.container,args.output)
assert r.command(['docker','inspect',r.container,'--format','{{.HostConfig.NetworkMode}}']).stdout.strip()=='none'
assert r.sql("select current_setting('cluster_name')")=='venfour-delivery-rehearsal'
assert r.sql('select count(*) from public.appraisal_cases')=='0'
CASE='f2000000-0000-4000-8000-000000000001';OWNER='f1000000-0000-4000-8000-000000000001';ORDER='f7000000-0000-4000-8000-000000000001'
now=datetime.now(timezone.utc);cfg=manifest(now);checks=[]

def check(name,condition):
 assert condition,name
 checks.append(name);print(json.dumps(dict(check=name,passed=True)),flush=True)

def execute(statement):
 if isinstance(statement,tuple):
  role,sql=statement
  if role in (PUBLISHER,WRITER):return r.sql(sql,role=role)
  assert role in ('service_role','authenticated')
  return r.sql(f'set role {role}; '+sql)
 return r.sql(statement)

def query(sql):return json.loads(execute(sql))
def rejected(sql,contains=None):
 try:execute(sql)
 except RuntimeError as exc:return contains is None or contains in str(exc)
 return False

def as_role(role,sql):return role,sql

def publish(artifact):return query(as_role(PUBLISHER,publish_sql(artifact)))

def next_source(current):
 data=copy.deepcopy(current.payload)
 data.update(revision=data['revision']+1,previous_epoch=data['revision'],previous_digest=current.digest,request_id=str(uuid4()))
 return data

def compile(data):return compile_authority(data,cfg,now=datetime.now(timezone.utc))

def raw_publish(data,sigs=None,expected=None):
 content=canonical(data)
 return as_role(PUBLISHER,f"select public.publish_jurisdiction_authority({literal(content)},{literal(expected or content_digest(content))},{literal(canonical(sigs or []))}::jsonb);")

def attest(data):
 content=canonical(data); signature=hmac.new(KEYS['attestation-writer'],('venfour-attestation-v1\n'+content).encode(),hashlib.sha256).hexdigest()
 return execute(as_role(WRITER,f"select public.publish_jurisdiction_attestation({literal(content)},'{signature}');"))

def snapshot():
 review=query(f"select public.get_paid_delivery_review_context('{CASE}')")
 context=review['context']; facts=CaseFacts.from_dict(context['facts'])
 payload=attested_snapshot(case_id=CASE,facts=facts,facts_revision=context['revision'],bundle=review['authority_bundle'],now=datetime.now(timezone.utc)).to_dict()
 payload['delivery_context']=context;payload['delivery_authority_revision']=review['authority_revision']
 r.sql(f"select public.record_jurisdiction_decision({literal(canonical(payload))},'{digest(payload)}');")
 return payload

def resolve(snapshot):return query(f"select public.resolve_paid_delivery('{CASE}','{OWNER}','release','{uuid4()}','{snapshot['id']}',clock_timestamp()+interval '4 minutes');")
def fence():return r.sql(f"select public.check_paid_delivery('{CASE}')")
def accepts(sequence,doc,request=None):
 claims=canonical(dict(sub=OWNER,role='authenticated',session_id=str(uuid4())))
 return f"set local role authenticated; select set_config('request.jwt.claims',{literal(claims)},true); select public.accept_jurisdiction_document('{CASE}','{ORDER}',{sequence},'{doc['digest']}','{request or uuid4()}');"

check('no approved artifacts after migration',r.sql('select count(*) from public.jurisdiction_authority_publications')=='0')
check('no credentials or exact acceptances after migration',r.sql('select count(*) from public.jurisdiction_attestations')=='0' and r.sql('select count(*) from public.jurisdiction_document_acceptances')=='0')
r.sql(install_sql(now))
enable_fixture_logins(r)
first_source=source(now,config=cfg,all_capabilities=True)
for rule in first_source['rules']:rule['sources'][0]['locator']='Section 1(a), §1'
first=compile(first_source)
check('service role cannot publish',rejected(as_role('service_role',publish_sql(first)),'permission denied'))
check('ordinary authenticated staff cannot publish',rejected(as_role('authenticated',publish_sql(first)),'permission denied'))
for role in ('service_role','authenticated',PUBLISHER):
 check(role+' cannot grant review authority',rejected(as_role(role,"insert into public.jurisdiction_authority_config(revision,canonical_json) values(2,'{}')"),'permission denied'))
check('service cannot read signing keys',rejected(as_role('service_role','select * from jurisdiction_private.review_keys'),'permission denied'))
check('one signature cannot publish',rejected(raw_publish(first.payload,signatures(first)[:1])))
check('two forged signatures cannot publish',rejected(raw_publish(first.payload,[dict(reviewer=k,signature='a'*64) for k in ('review-a','review-b')]),'signature'))
check('tampered artifact cannot publish with old digest',rejected(raw_publish({**first.payload,'release':'tampered'},signatures(first),first.digest),'digest'))
check('research-only JSON cannot publish',rejected(raw_publish(json.loads((ROOT/'venfour/data/jurisdiction_research_seed.json').read_text()))))
pretty=json.dumps(first.payload,ensure_ascii=False,indent=2)
pretty_signatures=[dict(reviewer=k,signature=hmac.new(KEYS[k],('venfour-authority-v1\n'+pretty).encode(),hashlib.sha256).hexdigest()) for k in ('review-a','review-b')]
check('noncanonical content is rejected even when independently signed',rejected(as_role(PUBLISHER,f"select public.publish_jurisdiction_authority({literal(pretty)},'{content_digest(pretty)}',{literal(canonical(pretty_signatures))});"),'schema'))
check('valid signed publication advances epoch',publish(first)['epoch']==1)
check('duplicate request has exact idempotent result',publish(first)==publish(first) and r.sql('select count(*) from public.jurisdiction_delivery_authority')=='1')
conflict={**first.payload,'release':'different'}
check('conflicting request is rejected',rejected(raw_publish(conflict,signatures(first)),'conflict'))
left,right=compile(next_source(first)),compile(next_source(first))
with ThreadPoolExecutor(max_workers=2) as pool:
 futures=[pool.submit(publish,a) for a in (left,right)]
 outcomes=[]
 for future in futures:
  try:outcomes.append(future.result())
  except RuntimeError as exc:outcomes.append(str(exc))
check('competing publications commit exactly one successor',sum(isinstance(v,dict) for v in outcomes)==1 and r.sql('select count(*) from public.jurisdiction_delivery_authority')=='2')
current=left if isinstance(outcomes[0],dict) else right
check('stale compile cannot overwrite authority',rejected(as_role(PUBLISHER,publish_sql(right if current==left else left)),'Stale'))
# Seed ordinary published report/payment history before enrolling the synthetic case.
seed=(ROOT/'supabase/tests/database/018_total_loss_customer_delivery.test.sql').read_text().split('\nselect ok(',1)[0]
seed=re.sub(r'select plan\(\d+\);','',seed).replace('9900','19900')
r.sql(seed+'\ncommit;')
r.sql(f"insert into public.staff_members(user_id) values('{OWNER}'); insert into public.jurisdiction_delivery_operators(user_id) values('{OWNER}'); insert into public.jurisdiction_delivery_cases(case_id,order_id) values('{CASE}','{ORDER}');")
values=dict(customer_residence='US-MO',claim_type='first_party',policy_use='personal',provider_role='valuation_service',assigned_credential_ref='credential-fixture')
facts=dict(schema_version='1',assertions=[dict(field=k,value=v,provenance='customer',reference='synthetic',recorded_at=stamp(now)) for k,v in values.items()])
r.sql(f"set role authenticated; set request.jwt.claim.sub='{OWNER}'; select public.append_case_jurisdiction_facts('{CASE}',0,{literal(canonical(facts))});")
check('current two-review authority can release synthetic held delivery',resolve(snapshot())['state']=='released')
original=current
revoked=next_source(current);revoked['operation']='revoke'
for rule in revoked['rules']:
 rule['version']+=1;rule['revocation']=dict(at=stamp(now),by='review-a',reference='synthetic-revocation')
current=compile(revoked);publish(current)
check('revocation advances epoch and invalidates existing release',current.payload['revision']==3 and fence()=='held')
check('original approval and revocation history retained',r.sql('select count(*) from public.jurisdiction_authority_publications')=='3' and query(f"select canonical_json::jsonb from public.jurisdiction_authority_publications where epoch=2")==original.payload)
check('revocation cannot release new fulfillment',resolve(snapshot())['state']=='held')
# Restore through a new two-review version and require both attestation contracts.
cred=credential(now);doc=document(now);cred['capabilities']=[v['capability'] for v in current.payload['rules']]
data=next_source(current);data['operation']='publish'
for rule in data['rules']:
 rule['version']+=1;rule['revocation']=None;rule['credential_policy']='required';rule['terms_policy']='required'
 rule['credentials']=[{k:cred[k] for k in ('id','type','jurisdiction','holder','provider')}]
 rule['documents']=[{k:doc[k] for k in ('type','version','digest')}]
current=compile(data);publish(current)
check('missing credential and exact terms hold',resolve(snapshot())['state']=='held')
cred_seq=attest(cred);doc_seq=attest(doc)
check('current credential without acceptance still holds',resolve(snapshot())['state']=='held')
request=str(uuid4());r.sql('begin;'+accepts(doc_seq,doc,request)+'commit;')
r.sql('begin;'+accepts(doc_seq,doc,request)+'commit;')
check('exact document acceptance retries once',r.sql('select count(*) from public.jurisdiction_document_acceptances')=='1')
check('accepted exact terms and credential allow only scoped case',resolve(snapshot())['state']=='released')
check('wrong digest cannot be accepted',rejected('begin;'+accepts(doc_seq,{**doc,'digest':'f'*64})+'commit;'))
check('service cannot invent acceptance',rejected(as_role('service_role',f"select public.accept_jurisdiction_document('{CASE}','{ORDER}',{doc_seq},'{doc['digest']}','{uuid4()}')"),'permission denied'))
# Every change is an append-only attestation revision, never a fixture UPDATE.
for field,bad in [('jurisdiction','IL'),('holder','wrong-entity'),('provider','wrong-provider'),('status','revoked'),('status','suspended'),('capabilities',['case_specific_preview'])]:
 stale=snapshot();cred.update(revision=cred['revision']+1,request_id=str(uuid4()));old=cred[field];cred[field]=bad;attest(cred)
 check('credential '+field+' change invalidates observed release',resolve(stale)['state']=='held' and fence()=='held')
 cred.update(revision=cred['revision']+1,request_id=str(uuid4()));cred[field]=old;attest(cred)
 check('fresh scoped credential '+field+' recovery re-evaluates',resolve(snapshot())['state']=='released')
# Expiration crosses a real transaction wait, without manipulating a verified row.
cred.update(revision=cred['revision']+1,request_id=str(uuid4()),expires_at=stamp(datetime.now(timezone.utc)+timedelta(seconds=2)))
attest(cred);stale=snapshot();r.sql('select pg_sleep(2.1);')
check('credential expiration between observation and mutation holds',resolve(stale)['state']=='held')
cred.update(revision=cred['revision']+1,request_id=str(uuid4()),expires_at=stamp(now+timedelta(days=1)));attest(cred)
check('fresh credential after expiry requires reevaluation',resolve(snapshot())['state']=='released')
stale=snapshot();doc.update(revision=2,request_id=str(uuid4()),version='synthetic-2',digest='f'*64);attest(doc)
check('new document version invalidates old release and snapshot',fence()=='held' and resolve(stale)['state']=='held')
check('old acceptance remains immutable and exact',r.sql("select d.canonical_json::jsonb->>'version' from public.jurisdiction_document_acceptances a join public.jurisdiction_attestations d on d.sequence=a.document_sequence")=='synthetic-1')
check('old acceptance cannot be rewritten',rejected("update public.jurisdiction_document_acceptances set accepted_at=clock_timestamp()",'append-only'))
check('authority history cannot be rewritten',rejected("delete from public.jurisdiction_authority_publications",'append-only'))
# Restore exact document through a new writer revision; original acceptance still
# proves the identical bytes, not the unaccepted intervening version.
doc.update(revision=3,request_id=str(uuid4()),version='synthetic-1',digest='e'*64);attest(doc)
check('same exact retained document can reuse original acceptance',resolve(snapshot())['state']=='released')
stale=snapshot();facts['assertions'][0]['value']='US-IL'
r.sql(f"set role authenticated; set request.jwt.claim.sub='{OWNER}'; select public.append_case_jurisdiction_facts('{CASE}',1,{literal(canonical(facts))});")
check('fact revision invalidates release observation',resolve(stale)['state']=='held')
facts['assertions'][0]['value']='US-MO';r.sql(f"set role authenticated; set request.jwt.claim.sub='{OWNER}'; select public.append_case_jurisdiction_facts('{CASE}',2,{literal(canonical(facts))});")
check('fresh fact restoration can release',resolve(snapshot())['state']=='released')
# Recheck an already released case at recovery entry after its credential expires.
cred.update(revision=cred['revision']+1,request_id=str(uuid4()),expires_at=stamp(datetime.now(timezone.utc)+timedelta(seconds=2)))
attest(cred);early=snapshot();check('short-lived credential can release while current',resolve(early)['state']=='released')
r.sql('select pg_sleep(2.1);')
check('recovery cannot return stale released state after credential expiry',resolve(early)['state']=='held')
cred.update(revision=cred['revision']+1,request_id=str(uuid4()),expires_at=stamp(now+timedelta(days=1)));attest(cred)
check('credential renewal reevaluates after stale release',resolve(snapshot())['state']=='released')
# Review expiry is verified at database commit, even when the compiler was earlier.
expiry=next_source(current)
for rule in expiry['rules']:rule['version']+=1;rule['review_due_at']=stamp(datetime.now(timezone.utc)+timedelta(seconds=2))
expiring=compile(expiry);r.sql('select pg_sleep(2.1);')
check('review expiry after compile is rejected at commit',rejected(as_role(PUBLISHER,publish_sql(expiring)),'dates'))
# A valid new publication is blocked after removing an authorized reviewer.
stale_artifact=compile(next_source(current));cfg2=copy.deepcopy(cfg);cfg2['revision']=2;cfg2['authorized_reviewers'].pop()
r.sql(f"insert into public.jurisdiction_authority_config(revision,canonical_json) values(2,{literal(canonical(cfg2))});")
check('removed reviewer invalidates released delivery',fence()=='held')
check('reviewer removed after compile prevents commit',rejected(as_role(PUBLISHER,publish_sql(stale_artifact)),'Stale'))
check('reviewer removal preserves old approval evidence',query("select canonical_json::jsonb from public.jurisdiction_authority_config where revision=1")==cfg)
check('no cancellation or automatic refund follows revocation',r.sql(f"select count(*) from public.commerce_refund_requests where case_id='{CASE}'")=='0' and r.sql(f"select status from public.commerce_orders where id='{ORDER}'")=='paid')
check('199 price unchanged',r.sql(f"select amount_minor_units from public.commerce_orders where id='{ORDER}'")=='19900')
(args.output/'authority-results.json').write_text(json.dumps(dict(count=len(checks),checks=checks,network='none'),indent=2)+'\n')
print(json.dumps(dict(passed=len(checks),network='none',provider_calls=0)),flush=True)
