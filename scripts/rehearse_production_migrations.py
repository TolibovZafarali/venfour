"""Rehearse the reviewed backlog using only isolated local PostgreSQL.

Requires the existing local Supabase database for a schema-only Auth/Storage
foundation and its cached PostgreSQL image. No application data, secrets, linked
CLI commands or network-enabled target are used. The target is retained for
workflow tests and inspection. All fixture identities are synthetic.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
IMAGE = "public.ecr.aws/supabase/postgres:17.6.1.155"
CUTOFF = "20260829000000"


class Rehearsal:
    def __init__(self, container: str, output: Path):
        if not re.fullmatch(r"venfour-migration-rehearsal[-a-z0-9]*", container):
            raise ValueError("Use a dedicated venfour-migration-rehearsal container name")
        self.container = container
        self.output = output.resolve()
        self.output.mkdir(parents=True, exist_ok=True)
        self.results = []

    def command(self, args, *, text=True, input=None):
        result = subprocess.run(args, input=input, text=text, capture_output=True)
        if result.returncode:
            raise RuntimeError(f"Local command failed: {args[:4]}\n{result.stderr[-5000:]}")
        return result

    def sql(self, statement, *, name=None, role="postgres"):
        r = subprocess.run(["docker", "exec", "-i", self.container, "psql", "-X", "-U", role,
                            "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt", "-f", "-"],
                           input=statement, text=True, capture_output=True)
        if name:
            (self.output / (name + ".log")).write_text(r.stdout + r.stderr)
        if r.returncode:
            raise RuntimeError(f"{name or 'SQL'} failed:\n{r.stderr[-5000:]}")
        return r.stdout.strip()

    def query(self, statement):
        return json.loads(self.sql(statement, role="supabase_admin"))

    def bootstrap(self):
        self.command(["docker", "image", "inspect", IMAGE])
        self.command(["docker", "run", "--detach", "--pull=never", "--name", self.container,
                      "--label", "venfour.migration-rehearsal=true", "--network", "none",
                      "--env", "POSTGRES_PASSWORD=rehearsal-local-only",
                      "--env", "POSTGRES_HOST_AUTH_METHOD=trust", IMAGE,
                      "postgres", "-D", "/etc/postgresql", "-c", "listen_addresses=",
                      "-c", "cron.launch_active_jobs=off"])
        deadline = time.monotonic() + 60
        while True:
            result = subprocess.run(["docker", "exec", self.container, "pg_isready", "-U", "supabase_admin"],
                                    capture_output=True)
            process = subprocess.run(["docker", "exec", self.container, "cat", "/proc/1/comm"],
                                     capture_output=True, text=True)
            if result.returncode == 0 and process.stdout.strip() in {"postgres", ".postgres-wrapp"}:
                break
            if time.monotonic() > deadline:
                raise RuntimeError("Isolated database did not start")
            time.sleep(0.25)
        mode = self.command(["docker", "inspect", self.container, "--format", "{{.HostConfig.NetworkMode}}"]).stdout.strip()
        assert mode == "none"
        # Copy only platform schemas, never any records, Vault, environment or
        # migration history. Exclude application-owned hooks/policies so the
        # repository migrations install those themselves in chronological order.
        dump = self.command(["docker", "exec", "supabase_db_venfour", "pg_dump", "-U", "supabase_admin",
                             "-d", "postgres", "--schema-only", "--schema=auth", "--schema=storage",
                             "--format=custom"], text=False).stdout
        path = self.output / "managed-foundation.dump"
        path.write_bytes(dump)
        self.command(["docker", "cp", str(path), self.container + ":/tmp/foundation.dump"])
        toc = self.command(["docker", "exec", self.container, "pg_restore", "--list", "/tmp/foundation.dump"]).stdout
        application_hooks = {"on_auth_user_created", "auth_users_guard_anonymous_guest_cleanup",
                             "total_loss_deliverable_objects_protect_sealed",
                             "total_loss_insurer_response_objects_protect_sealed", "referral_partner_document_history"}
        keep = [line for line in toc.splitlines() if " POLICY " not in line
                and not (" TRIGGER " in line and any(name in line for name in application_hooks))]
        listing = self.output / "foundation.list"
        listing.write_text("\n".join(keep) + "\n")
        self.command(["docker", "cp", str(listing), self.container + ":/tmp/foundation.list"])
        # The image's empty bootstrap schemas precede the locally installed
        # platform versions. Restore their complete existing managed definitions;
        # do not hand-edit or normalize any Storage internals.
        self.sql("drop schema auth cascade; drop schema storage cascade;", role="supabase_admin")
        self.command(["docker", "exec", self.container, "pg_restore", "-U", "supabase_admin", "-d", "postgres",
                      "--exit-on-error", "--use-list=/tmp/foundation.list", "/tmp/foundation.dump"])
        self.sql("create schema supabase_migrations; create table supabase_migrations.schema_migrations"
                 "(version text primary key, statements text[], name text);")
        print("Isolated target ready: network=none, no published ports, schedulers disabled.", flush=True)

    def apply(self, path):
        started = time.monotonic()
        body = path.read_text()
        version, name = path.stem.split("_", 1)
        literal = body.replace("'", "''")
        self.sql("begin;\n" + body + f"\ninsert into supabase_migrations.schema_migrations values "
                 f"('{version}',array['{literal}'],'{name}');\ncommit;", name=path.stem)
        self.results.append({"filename": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                             "seconds": round(time.monotonic() - started, 3)})
        (self.output / "migration-results.json").write_text(json.dumps(self.results, indent=2) + "\n")
        print("Applied", path.name, flush=True)

    def fixture(self, name):
        self.sql("begin;\n" + (ROOT / "supabase/tests/rehearsal" / name).read_text() + "\ncommit;", name=name)

    def seed_cutoff(self):
        # Reuse the repository's baseline paid/report fixture with disjoint UUIDs.
        source = (ROOT / "supabase/tests/database/018_total_loss_customer_delivery.test.sql").read_text()
        assert "\nselect ok(" in source and "select plan(53);" in source
        source = source.split("\nselect ok(", 1)[0].replace("begin;", "", 1).replace("select plan(53);", "")
        identities = sorted(set(re.findall(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", source)))
        mapping = {old: str(uuid.uuid5(uuid.NAMESPACE_URL, "venfour-production-rehearsal:" + old)) for old in identities}
        for old, new in mapping.items():
            source = source.replace(old, new)
        source = source.replace("@example.test", "@rehearsal.example.test")
        source = source.replace("pi_delivery_fixture", "pi_rehearsal_delivery_fixture")
        source += "\ncreate schema rehearsal; create table rehearsal.identities(name text primary key,id uuid not null);\n"
        for name, key in [("paid_case", "f2000000-0000-4000-8000-000000000001"),
                          ("paid_owner", "f1000000-0000-4000-8000-000000000001"),
                          ("free_case", "d2000000-0000-4000-8000-000000000001")]:
            source += f"insert into rehearsal.identities values('{name}','{mapping[key]}');\n"
        source += (ROOT / "supabase/tests/rehearsal/production_cutoff_additions.sql").read_text()
        source += (ROOT / "supabase/tests/rehearsal/legacy_response.sql").read_text()
        source += "\ncreate table rehearsal.baseline_workflows as select case_id,revision from public.total_loss_claim_workflows;\n"
        (self.output / "cutoff-seed.sql").write_text(source)
        self.sql("begin;\n" + source + "\ncommit;", name="cutoff-seed")
        self.before = self.snapshot("before")
        self.file_hashes = {}
        for table in self.before:
            if (table["schema"], table["name"]) != ("storage", "objects"):
                continue
            for row in table["rows"]:
                relative = Path(row["bucket_id"]) / row["name"]
                assert not relative.is_absolute() and ".." not in relative.parts
                path = self.output / "storage" / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                payload = b"%PDF-1.7\nFixture\n%%EOF\n"
                size = (row["metadata"] or {}).get("size", 24)
                payload = payload.ljust(size, b" ")
                path.write_bytes(payload)
                self.file_hashes[str(relative)] = hashlib.sha256(payload).hexdigest()
        (self.output / "before-file-hashes.json").write_text(json.dumps(self.file_hashes, indent=2) + "\n")
        assert self.query("select jsonb_build_object('count',count(*),'latest',max(version)) from supabase_migrations.schema_migrations;") == {"count": 29, "latest": CUTOFF}
        print("Seeded the exact 29-migration cutoff before the backlog.", flush=True)

    def snapshot(self, name):
        tables = self.query("""select jsonb_agg(jsonb_build_object('schema',table_schema,'name',table_name,'columns',columns))
          from (select table_schema,table_name,jsonb_agg(column_name order by ordinal_position) columns
          from information_schema.columns where table_schema='public'
            or (table_schema='auth' and table_name in ('users','identities'))
            or (table_schema='storage' and table_name in ('objects','buckets'))
          group by table_schema,table_name) s;""")
        for table in tables:
            columns = ",".join('"' + c + '"' for c in table["columns"])
            table["rows"] = self.query(f"""select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb)
              from (select {columns} from "{table['schema']}"."{table['name']}") r;""")
        (self.output / (name + "-data.json")).write_text(json.dumps(tables, indent=2) + "\n")
        return tables

    def verify_preservation(self):
        final = {(t["schema"], t["name"]): t for t in self.snapshot("after")}
        changes = []
        for old in self.before:
            # The read model gains new fields and is tested behaviorally instead.
            if old["name"] == "total_loss_case_operations_internal":
                continue
            new = final[(old["schema"], old["name"])]
            allowed = set()
            for row in old["rows"]:
                ignored = set()
                if ((old["name"] == "total_loss_analysis_jobs" and row["id"] == "e9400000-0000-4000-8000-000000000005")
                    or (old["name"] == "total_loss_claim_documents" and row["id"] == "e9700000-0000-4000-8000-000000000008")):
                    ignored.add("updated_at")
                if old["name"] == "total_loss_claim_workflows" and row["current_task"] == "insurer_response_received":
                    ignored.update({"revision", "updated_at"})
                allowed.update(ignored)
                fields = set(old["columns"]) - ignored
                comparable = [{k: value[k] for k in fields} for value in new["rows"]]
                assert {k: row[k] for k in fields} in comparable, f"Unexpected data change: {old['name']}"
            changes.append({"table": old["schema"] + "." + old["name"], "preserved_rows": len(old["rows"]),
                            "allowed_backfill_columns": sorted(allowed)})
        for relative, expected in self.file_hashes.items():
            assert hashlib.sha256((self.output / "storage" / relative).read_bytes()).hexdigest() == expected
        (self.output / "file-preservation.json").write_text(json.dumps({"files": len(self.file_hashes), "all_bytes_unchanged": True}) + "\n")
        assert self.query("select jsonb_agg(to_jsonb(a) order by a.id) from public.referral_case_attributions a;") == self.referral_before
        self.sql((ROOT / "supabase/tests/rehearsal/verify_backfills.sql").read_text(), name="verify-backfills")
        (self.output / "preservation-results.json").write_text(json.dumps(changes, indent=2) + "\n")
        print("Baseline records preserved; explicit backfill assertions passed.", flush=True)

    def run(self):
        self.bootstrap()
        paths = sorted((ROOT / "supabase/migrations").glob("*.sql"))
        baseline = [p for p in paths if p.name[:14] <= CUTOFF]
        pending = [p for p in paths if p.name[:14] > CUTOFF]
        assert len(baseline) == 29 and len(pending) == 34
        for path in baseline:
            self.apply(path)
        self.seed_cutoff()
        for path in pending:
            self.apply(path)
            if path.name.startswith("20260908000000_"):
                self.fixture("referral_onboarding_fixture.sql")
            if path.name.startswith("20260908000100_"):
                self.fixture("referral_attribution_fixture.sql")
                self.referral_before = self.query("select jsonb_agg(to_jsonb(a) order by a.id) from public.referral_case_attributions a;")
                (self.output / "before-protection-attributions.json").write_text(json.dumps(self.referral_before, indent=2) + "\n")
        self.verify_preservation()
        summary = {"container": self.container, "network": "none", "baseline_count": len(baseline),
                   "pending_count": len(pending), "latest": paths[-1].name, "success": True,
                   "hosted_calls": 0, "provider_calls": 0}
        (self.output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
        print(json.dumps(summary), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    Rehearsal(args.container, args.output).run()
