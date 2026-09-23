"""Test administrative escalation only in an isolated disposable database.

Uses the existing local image's trust socket. Never provisions credentials or
connects to hosted PostgreSQL. Every negative grant is transactionally rolled back.
"""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
from rehearse_production_migrations import Rehearsal

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--container", required=True)
parser.add_argument("--output", required=True, type=Path)
args = parser.parse_args()
r = Rehearsal(args.container, args.output)
assert r.command(["docker", "inspect", r.container, "--format", "{{.HostConfig.NetworkMode}}"]).stdout.strip() == "none"
assert r.sql("select current_setting('cluster_name')") == "venfour-delivery-rehearsal"
assert r.sql("select count(*) from public.appraisal_cases") == "0"
assert r.sql("select count(*) from jurisdiction_private.release_role_violations()") == "0"

cases = [
    ("service role reaches database owner", "revoke authenticator,service_role from postgres cascade; grant postgres to service_role with set true;"),
    ("authenticated can administer database owner", "revoke authenticator,authenticated from postgres cascade; grant postgres to authenticated with admin true, set false, inherit false;"),
    ("Storage administrator reaches publisher", "grant jurisdiction_publisher to supabase_storage_admin with admin true, set false, inherit false;"),
    ("Auth administrator reaches attestor", "grant jurisdiction_attestor to supabase_auth_admin with set true;"),
    ("Realtime administrator reaches publisher", "do $$ begin if not exists(select 1 from pg_roles where rolname='supabase_realtime_admin') then create role supabase_realtime_admin nologin noinherit; end if; end $$; grant jurisdiction_publisher to supabase_realtime_admin with set true;"),
    ("ordinary login reaches platform superuser", "create role release_intruder login; grant supabase_admin to release_intruder with set true;"),
    ("new superuser is not implicitly trusted", "create role release_intruder login superuser;"),
    ("admin-like name is not trusted", "create role platform_release_admin login; grant jurisdiction_publisher to platform_release_admin with admin true, set false, inherit false;"),
    ("publisher must remain NOLOGIN", "alter role jurisdiction_publisher login;"),
    ("attestor must not have CREATEROLE", "alter role jurisdiction_attestor createrole;"),
    ("creator grant options must match", "grant jurisdiction_publisher to postgres with set true granted by supabase_admin;"),
]
results = []
for role in ("anon", "authenticated", "authenticator", "service_role"):
    try:
        r.sql("begin; create role release_recipient; set local role " + role + "; grant jurisdiction_publisher to release_recipient; rollback;")
    except RuntimeError as exc:
        assert 'permission denied to grant role "jurisdiction_publisher"' in str(exc), str(exc)
    else:
        raise AssertionError(role + " granted publisher membership")
    results.append({"check": role + " cannot grant restricted membership", "passed": True})
for name, mutation in cases:
    count = r.sql("begin; " + mutation + " select count(*) from jurisdiction_private.release_role_violations(); rollback;", role="supabase_admin")
    assert int(count) > 0, name
    results.append({"check": name, "passed": True})

# The hosted CLI role is an expiring administrative credential, not a runtime
# role. Reproduce its exact grantor/options and prove it cannot become a bridge.
cli = """
do $$ begin
 if not exists(select 1 from pg_roles where rolname='cli_login_postgres') then
  create role cli_login_postgres login noinherit;
 end if;
 execute format('alter role cli_login_postgres valid until %L',clock_timestamp()+interval '5 minutes');
end $$;
grant postgres to cli_login_postgres with admin false, inherit false, set true granted by supabase_admin;
"""
count = r.sql("begin; " + cli + " select count(*) from jurisdiction_private.release_role_violations(); rollback;", role="supabase_admin")
assert count == "0", count
results.append({"check": "exact expiring Supabase administrative CLI path accepted", "passed": True})
for name, mutation in [
    ("application cannot reach administrative CLI", "revoke authenticator from postgres cascade; grant cli_login_postgres to authenticator with set true;"),
    ("CLI cannot receive broader authority", "alter role cli_login_postgres createrole;"),
    ("CLI must retain bounded credential lifetime", "alter role cli_login_postgres valid until 'infinity';"),
    ("CLI cannot administer postgres", "grant postgres to cli_login_postgres with admin true granted by supabase_admin;"),
]:
    count = r.sql("begin; " + cli + mutation + " select count(*) from jurisdiction_private.release_role_violations(); rollback;", role="supabase_admin")
    assert int(count) > 0, name
    results.append({"check": name, "passed": True})
assert r.sql("select count(*) from jurisdiction_private.release_role_violations()") == "0"
(args.output / "results.json").write_text(json.dumps(results, indent=2) + "\n")
print(json.dumps({"checks": len(results), "passed": True, "network": "none", "hosted_calls": 0}))
