"""Rehearse holds using only a disposable, network-isolated PostgreSQL server.

Run after all migrations with cluster_name=venfour-delivery-rehearsal. Uses the
existing customer-delivery seed and real SQL functions; no payment/provider HTTP.
The dedicated target retains synthetic evidence and must be removed afterwards.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
import argparse
import json
import re
import subprocess
import sys
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT), str(ROOT / "scripts"), str(ROOT / "tests")]
from rehearse_production_migrations import Rehearsal
from local_authority_login import enable_fixture_logins
from venfour.jurisdiction import Registry, CaseFacts, Assertion, digest
from venfour.jurisdiction_adapter import decide
from jurisdiction_authority_fixtures import source, manifest, install_sql, publish_sql, PUBLISHER, stamp
from venfour.jurisdiction_authority import compile_authority, attested_snapshot

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--container", required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
r = Rehearsal(args.container, args.output)
assert r.command(["docker", "inspect", r.container, "--format", "{{.HostConfig.NetworkMode}}"]).stdout.strip() == "none"
assert r.sql("select current_setting('cluster_name')") == "venfour-delivery-rehearsal"
assert r.sql("select count(*) from public.appraisal_cases") == "0", "Use a fresh disposable database"

CASE = "f2000000-0000-4000-8000-000000000001"
OWNER = "f1000000-0000-4000-8000-000000000001"
ORDER = "f7000000-0000-4000-8000-000000000001"
PAYMENT = "f7100000-0000-4000-8000-000000000001"
PACKAGE = "f9000000-0000-4000-8000-000000000001"
REPORT = "fe000000-0000-4000-8000-000000000001"
WORK = str(uuid4())
checks = []


def sqltext(value):
    return "'" + str(value).replace("'", "''") + "'"


def check(name, condition):
    assert condition, name
    checks.append(name)
    print(json.dumps({"check": name, "passed": True}), flush=True)


def query(statement):
    return json.loads(r.sql(statement))


def refused(statement, code):
    try:
        r.sql("\\set VERBOSITY verbose\n" + statement)
    except RuntimeError as exc:
        return code in str(exc)
    return False


def resolve(snapshot=None, request=None, action="release"):
    return f"select public.resolve_paid_delivery('{CASE}','{OWNER}','{action}','{request or uuid4()}',{sqltext(snapshot) if snapshot else 'null'},clock_timestamp()+interval '4 minutes');"


def snapshot(allowed=True):
    review_context = query(f"select public.get_paid_delivery_review_context('{CASE}')")
    context = review_context["context"]
    facts = CaseFacts.from_dict(context["facts"])
    if context["date_of_loss"]:
        facts = CaseFacts(facts.assertions + (Assertion("loss_date", context["date_of_loss"], "legacy_intake", "total_loss_case_details.date_of_loss", context["intake_updated_at"]),))
    current = datetime.now(timezone.utc)
    payload = attested_snapshot(case_id=CASE, facts=facts, facts_revision=context["revision"],
        bundle=review_context["authority_bundle"], now=current).to_dict()
    if not allowed:
        payload["proposed_allowed"] = False
    payload["delivery_context"] = context
    payload["delivery_authority_revision"] = review_context["authority_revision"]
    r.sql(f"select public.record_jurisdiction_decision({sqltext(json.dumps(payload))}::jsonb,'{digest(payload)}');")
    return payload["id"]


synthetic_registry = None
fixture_now = datetime.now(timezone.utc)
fixture_config = manifest(fixture_now)

def publish_next(revoke=False):
    global synthetic_registry
    epoch = synthetic_registry.payload["revision"] if synthetic_registry else 0
    raw = source(fixture_now, epoch=epoch,
        previous_digest=synthetic_registry.digest if synthetic_registry else None,
        config=fixture_config, all_capabilities=True)
    for rule in raw["rules"]:
        rule["version"] = epoch + 1
        if revoke:
            rule["revocation"] = dict(at=stamp(fixture_now), by="review-a", reference="synthetic-revocation")
    raw["operation"] = "revoke" if revoke else "publish"
    synthetic_registry = compile_authority(raw, fixture_config, now=datetime.now(timezone.utc))
    return publish_sql(synthetic_registry)

# Existing financial suite runs with holds installed at sandbox-order creation,
# proving that reconciliation, duplicate events and refund accounting ignore holds.
commerce = (ROOT / "supabase/tests/database/015_total_loss_stripe_commerce.test.sql").read_text()
fixture = """
create function pg_temp.enroll_paid_fixture() returns trigger language plpgsql as $$ begin
  if new.provider_livemode=false then insert into public.jurisdiction_delivery_cases(case_id,order_id)
    values(new.case_id,new.id) on conflict do nothing; end if;
  return new;
end $$;
create trigger fixture_delivery_hold after insert on public.commerce_orders for each row execute function pg_temp.enroll_paid_fixture();
"""
commerce = commerce.replace("select plan(152);", "select plan(152);\n" + fixture)
assert fixture in commerce
out = r.sql(commerce, name="commerce-with-holds")
check("all 152 commerce assertions pass with sandbox orders held", "not ok " not in out and len(re.findall(r"^ok \d+", out, re.M)) == 152)
seed = (ROOT / "supabase/tests/database/018_total_loss_customer_delivery.test.sql").read_text().split("\nselect ok(", 1)[0]
seed = re.sub(r"select plan\(\d+\);", "", seed).replace("9900", "19900")
# Rehearse pre-delivery states in their own fresh transaction. Do not rewrite
# a terminal historical package merely to manufacture a test precondition.
package_values = "'ready', 1, gen_random_uuid(), statement_timestamp(), statement_timestamp()"
assert seed.count(package_values) == 1
enrollment = f"insert into public.jurisdiction_delivery_cases(case_id,order_id) values('{CASE}','{ORDER}');"
pre_delivery = seed.replace(package_values, "'assessment_ready', 1, gen_random_uuid(), statement_timestamp(), statement_timestamp()")
enqueued = r.sql(pre_delivery + enrollment + f"select outcome from public.enqueue_total_loss_report_generation('{PACKAGE}'); rollback;")
check("hold between package completion and enqueue keeps durable next work", enqueued == "created")
refund_pending = seed.replace(package_values, "'refund_pending', 1, gen_random_uuid(), statement_timestamp(), null")
review_work = str(uuid4())
financial = r.sql(refund_pending + enrollment + f"insert into public.workflow_work_items(id,case_id,package_job_id,report_version_id,work_type,work_version,status,attempt_count,processing_token,completed_at) values('{review_work}','{CASE}','{PACKAGE}','{REPORT}','total_loss_report_review','1','completed',1,gen_random_uuid(),clock_timestamp()); select public.check_paid_delivery('{review_work}','work_item'); select outcome from public.claim_total_loss_report_review_work_item('{review_work}',gen_random_uuid()); rollback;")
check("completed no-support refund recovery remains outside new-work hold", financial.splitlines() == ["financial_recovery", "completed"])
r.sql(seed + "\ncommit;", name="synthetic-seed")
r.sql(f"insert into public.workflow_work_items(id,case_id,package_job_id,work_type,work_version) values('{WORK}','{CASE}','{PACKAGE}','total_loss_package_finalize','1');")
# Ordinary staff has no recovery authority.
r.sql(f"insert into public.staff_members(user_id) values('{OWNER}');")
check("ordinary staff cannot inspect holds", refused(f"set role authenticated; set request.jwt.claim.sub='{OWNER}'; select public.inspect_paid_delivery();", "42501"))
r.sql(f"insert into public.jurisdiction_delivery_operators(user_id) values('{OWNER}');")
r.sql(f"insert into public.jurisdiction_delivery_cases(case_id,order_id) values('{CASE}','{ORDER}');")
check("hold survives an independent connection / process", r.sql(f"select public.check_paid_delivery('{CASE}')") == "held")
check("hold has durable creation history", r.sql(f"select count(*) from public.jurisdiction_delivery_events where case_id='{CASE}' and action='held'") == "1")
check("customer cannot read internal hold table", refused("set role authenticated; select * from public.jurisdiction_delivery_cases", "42501"))
check("service cannot enroll even on rehearsal server", refused(f"set role service_role; insert into public.jurisdiction_delivery_cases(case_id,order_id) values('{CASE}','{ORDER}')", "42501"))
check("staff cannot install jurisdiction authority", refused("set role authenticated; insert into public.jurisdiction_delivery_authority values(1,repeat('a',64),now())", "42501"))
check("unauthorized user cannot resolve", refused(f"select public.resolve_paid_delivery('{CASE}','f1000000-0000-4000-8000-000000000002','release','{uuid4()}')", "42501"))
for rpc in ("claim_total_loss_package_work_item", "claim_total_loss_report_generation_work_item", "claim_total_loss_report_review_work_item"):
    check(rpc + " blocks direct and duplicate claims", all(refused(f"set role service_role; select * from public.{rpc}('{WORK}','{uuid4()}')", "PJD01") for _ in range(2)))
check("held queue does not dispatch or consume retry attempts", r.sql(f"select count(*) from public.reserve_due_workflow_work_items('{uuid4()}',100)") == "0" and r.sql(f"select attempt_count from public.workflow_work_items where id='{WORK}'") == "0")
check("held work is not marked completed", r.sql(f"select status from public.workflow_work_items where id='{WORK}'") == "queued")
check("direct work status write cannot bypass claim fence", refused(f"update public.workflow_work_items set status='processing',attempt_count=1,processing_token=gen_random_uuid(),processing_expires_at=clock_timestamp()+interval '1 minute' where id='{WORK}'", "PJD01"))
check("coaching claim is fenced before model work", refused(f"select * from public.claim_current_total_loss_insurer_response_analysis('{CASE}','{uuid4()}','fixture','fixture','1','1','1')", "PJD01"))
check("initial draft generation is fenced", refused(f"set role authenticated; set request.jwt.claim.sub='{OWNER}'; select public.prepare_total_loss_customer_message('{CASE}','{uuid4()}',1)", "PJD01"))
check("follow-up draft mutation is fenced", refused(f"select public.store_total_loss_follow_up_draft('{CASE}','{OWNER}','{uuid4()}',repeat('a',64),'{{}}')", "PJD01"))
check("new report release is fenced independently of worker", refused(f"select * from public.resolve_total_loss_report_release('{WORK}','{uuid4()}','{uuid4()}')", "PJD01"))
check("new report insert is fenced even for direct database writes", refused(f"insert into public.total_loss_report_versions select (jsonb_populate_record(null::public.total_loss_report_versions,to_jsonb(r)||jsonb_build_object('id','{uuid4()}'))).* from public.total_loss_report_versions r where id='{REPORT}'", "PJD01"))
check("historical report remains customer-accessible", r.sql(f"set role service_role; select report_version_id from public.authorize_total_loss_customer_report_download('{CASE}','{REPORT}','{OWNER}')") == REPORT)
check("payment remains paid and recorded", r.sql(f"select status from public.commerce_orders where id='{ORDER}'") == "paid" and r.sql(f"select count(*) from public.payment_transactions where id='{PAYMENT}'") == "1")
check("199 dollar order unchanged", r.sql(f"select amount_minor_units from public.commerce_orders where id='{ORDER}'") == "19900")
# Append facts through the owner RPC, then use the real Phase 1 evaluator.
facts = {"schema_version": "1", "assertions": [{"field": k, "value": v, "provenance": "customer", "reference": "synthetic", "recorded_at": datetime.now(timezone.utc).isoformat()} for k,v in {"customer_residence":"US-MO","claim_type":"first_party","policy_use":"personal","provider_role":"valuation_service"}.items()]}
r.sql(f"set role authenticated; set request.jwt.claim.sub='{OWNER}'; select public.append_case_jurisdiction_facts('{CASE}',0,{sqltext(json.dumps(facts))}::jsonb);")
r.sql(install_sql(fixture_now))
enable_fixture_logins(r)
r.sql(publish_next(),role=PUBLISHER)
unresolved = snapshot(False)
check("unresolved current rule refuses release", query(resolve(unresolved))["state"] == "held")
approved = snapshot()
request = str(uuid4())
with ThreadPoolExecutor(max_workers=2) as executor:
    futures = [executor.submit(query, resolve(approved, request)), executor.submit(query, resolve(approved, str(uuid4())))]
    results = [f.result() for f in futures]
check("concurrent current approvals release exactly once", all(v["state"] == "released" for v in results) and r.sql(f"select count(*) from public.jurisdiction_delivery_events where case_id='{CASE}' and action='release'") == "1")
check("same recovery action is idempotent", query(resolve(approved, request)) == results[0])
check("release resumes original durable queue identity", r.sql(f"select work_item_id from public.reserve_due_workflow_work_items('{uuid4()}',100)") == WORK)
# Revocation commits first while a release mutation is waiting on the same lock.
r.sql(f"select public.jurisdiction_delivery_hold_internal('{CASE}',array['REVIEW_REQUIRED'])")
stale = snapshot()

def block_then(mutation,role="postgres"):
    command = ["docker","exec","-i",r.container,"psql","-X","-U",role,"-d","postgres","-v","ON_ERROR_STOP=1","-qAt"]
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write("begin; select pg_advisory_xact_lock(726104,1); select 'LOCKED';\n")
    process.stdin.flush()
    while process.stdout.readline().strip() != "LOCKED":
        if process.poll() is not None: raise AssertionError("Lock setup failed")
    with ThreadPoolExecutor(max_workers=1) as executor:
        waiting = executor.submit(query, resolve(stale))
        process.stdin.write(mutation + "; commit;\n\\q\n")
        process.stdin.flush()
        process.wait(timeout=10)
        assert process.returncode == 0, process.stderr.read()
        return waiting.result()

check("rule revocation between observation and mutation refuses release", block_then(publish_next(True),role=PUBLISHER)["state"] == "held")
r.sql(publish_next(),role=PUBLISHER)
check("a newly reviewed successor does not revive an old authority epoch", query(resolve(stale))["state"] == "held")
stale = snapshot()
changed = json.loads(json.dumps(facts))
changed["assertions"][0]["value"] = "US-IL"
mutation = f"set local role authenticated; set local request.jwt.claim.sub='{OWNER}'; select public.append_case_jurisdiction_facts('{CASE}',1,{sqltext(json.dumps(changed))}::jsonb)"
check("fact revision between observation and mutation refuses release", block_then(mutation)["state"] == "held")
check("stale approved snapshot cannot resume claim", refused(f"select * from public.claim_total_loss_package_work_item('{WORK}','{uuid4()}')", "PJD01"))
# Restore explicit facts for one fresh, short-lived release, then expire it.
r.sql(f"set role authenticated; set request.jwt.claim.sub='{OWNER}'; select public.append_case_jurisdiction_facts('{CASE}',2,{sqltext(json.dumps(facts))}::jsonb)")
check("fresh evaluation after facts recovery can release", query(resolve(snapshot()))["state"] == "released")
r.sql(f"update public.jurisdiction_delivery_cases set valid_until=clock_timestamp()-interval '1 second' where case_id='{CASE}'")
check("expired approval creates durable hold", r.sql(f"select public.check_paid_delivery('{CASE}')") == "held")
check("stale snapshot history remains immutable", refused(f"update public.jurisdiction_decision_snapshots set content_digest=repeat('f',64) where id='{approved}'", "55000"))
check("hold audit history remains immutable", refused(f"delete from public.jurisdiction_delivery_events where case_id='{CASE}'", "55000"))
request = str(uuid4())
cancel = query(resolve(request=request, action="cancel_refund"))
check("operator cancellation durably reserves canonical refund", cancel["state"] == "cancelled" and r.sql(f"select count(*) from public.commerce_refund_requests where case_id='{CASE}'") == "1")
check("duplicate cancellation reuses exact reservation", query(resolve(request=request, action="cancel_refund")) == cancel)
check("new cancellation key also reuses refund identity", query(resolve(action="cancel_refund"))["refund_request_key"] == request)
check("cancelled fulfillment cannot be released", query(resolve(snapshot()))["state"] == "cancelled")
check("cancelled queue remains suppressed", r.sql(f"select count(*) from public.reserve_due_workflow_work_items('{uuid4()}',100)") == "0")
check("cancelled claim cannot restart", refused(f"select * from public.claim_total_loss_package_work_item('{WORK}','{uuid4()}')", "PJD01"))
packet = query(f"set role authenticated; set request.jwt.claim.sub='{OWNER}'; select public.inspect_paid_delivery('{CASE}')")
check("operator sees order work reasons snapshots dates and resolution history", packet[0]["state"] == "cancelled" and packet[0]["work_items"][0]["id"] == WORK and packet[0]["history"][-1]["resolver_id"] == OWNER)
check("cancellation preserves released report and immutable financial history", r.sql(f"select status from public.total_loss_report_versions where id='{REPORT}'") == "published" and r.sql(f"select count(*) from public.payment_transactions where id='{PAYMENT}'") == "1")
refund_id = r.sql(f"select id from public.commerce_refund_requests where case_id='{CASE}'")
refund_sql = f"select refund_status from public.record_total_loss_refund_result('{refund_id}','re_held_fixture',null,'txn_held_fixture',null,'succeeded',clock_timestamp(),null)"
# The provider result is synthetic; the canonical accounting RPC is real.
for _ in range(2):
    r.sql(refund_sql)
check("canonical refund result and duplicate reconcile after cancellation", r.sql(f"select status from public.commerce_orders where id='{ORDER}'") == "refunded" and r.sql(f"select status from public.case_entitlements where order_id='{ORDER}'") == "refunded_access_retained")
check("historical download survives refund with retained access", r.sql(f"set role service_role; select report_version_id from public.authorize_total_loss_customer_report_download('{CASE}','{REPORT}','{OWNER}')") == REPORT)
r.sql(f"insert into public.payment_transactions(id,case_id,order_id,payment_provider,transaction_kind,external_object_id,amount_minor_units,currency,provider_occurred_at) values('{uuid4()}','{CASE}','{ORDER}','stripe','payment','pi_duplicate_hold_fixture',19900,'USD',clock_timestamp())")
check("ambiguous duplicate payment routes to support without another refund", query(resolve(action="cancel_refund"))["refund_status"] == "support_required" and r.sql(f"select count(*) from public.commerce_refund_requests where case_id='{CASE}'") == "1")
(args.output / "hold-results.json").write_text(json.dumps({"checks": checks, "count": len(checks), "network": "none"}, indent=2)+"\n")
print(json.dumps({"passed": len(checks), "network": "none", "provider_calls": 0}), flush=True)
