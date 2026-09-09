/** Exercise the real cleanup handler against the migrated isolated database.
 * Storage bytes and Auth transport are local adapters; all cleanup RPCs and
 * database constraints/triggers are real. No HTTP/provider requests are used.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadCleanupHandler } from "./run_cleanup_tests.mjs";

const [container, outputArg] = process.argv.slice(2);
assert.match(container ?? "", /^venfour-migration-rehearsal[-a-z0-9]*$/);
const output = resolve(outputArg);
assert.equal(execFileSync("docker", ["inspect", container, "--format", "{{.HostConfig.NetworkMode}}"], { encoding: "utf8" }).trim(), "none");
const literal = (value) => value === null ? "null" : typeof value === "boolean" || typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
function sql(statement) {
  return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt", "-f", "-"], { input: statement, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
const query = (statement) => JSON.parse(sql(statement));
const trace = [];
const objects = () => query("select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket_id,'name',name,'metadata',metadata)),'[]') from storage.objects;");
const filePath = (bucket, name) => {
  assert.ok(!name.split("/").includes(".."));
  return join(output, "storage", bucket, name);
};
const before = new Map();
const migrationFileHashes = JSON.parse(await readFile(join(output, "before-file-hashes.json"), "utf8"));
for (const row of objects()) {
  const path = filePath(row.bucket, row.name);
  const bytes = await readFile(path);
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.equal(digest, migrationFileHashes[`${row.bucket}/${row.name}`]);
  before.set(`${row.bucket}/${row.name}`, digest);
}
const protectedPrefix = "e9100000-0000-4000-8000-000000000002/";
const ordinary = ["e9100000-0000-4000-8000-000000000001", "e9100000-0000-4000-8000-000000000003"];
const client = {
  async rpc(name, args) {
    assert.match(name, /^[a-z_]+$/);
    trace.push({ action: "rpc", name });
    try {
      const parameters = Object.entries(args).map(([key, value]) => {
        assert.match(key, /^[a-z_]+$/);
        return `${key} => ${literal(value)}`;
      }).join(",");
      return { data: query(`set role service_role; select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.${name}(${parameters}) r;`), error: null };
    } catch (error) {
      return { data: null, error: { message: String(error.stderr), code: "DATABASE_REJECTED" } };
    }
  },
  auth: { admin: {
    async getUserById(id) {
      const user = query(`select (select jsonb_build_object('id',id,'is_anonymous',is_anonymous) from auth.users where id=${literal(id)});`);
      return user ? { data: { user }, error: null } : { data: null, error: { status: 404 } };
    },
    async deleteUser(id, soft) {
      assert.equal(soft, false);
      trace.push({ action: "delete_user", id });
      sql(`delete from auth.users where id=${literal(id)};`);
      return { data: null, error: null };
    },
  } },
  storage: { from(bucket) {
    assert.equal(bucket, "case-files");
    return {
      async list(prefix, options) {
        const entries = new Map();
        for (const row of objects().filter((row) => row.bucket === bucket && row.name.startsWith(prefix + "/"))) {
          const remainder = row.name.slice(prefix.length + 1);
          const [name] = remainder.split("/");
          entries.set(name, { name, id: remainder.includes("/") ? null : row.name });
        }
        return { data: [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 100)), error: null };
      },
      async remove(paths) {
        trace.push({ action: "remove_files", paths });
        assert.ok(paths.every((path) => !path.startsWith(protectedPrefix)));
        sql(`begin; set local storage.allow_delete_query='true'; delete from storage.objects where bucket_id=${literal(bucket)} and name in (${paths.map(literal).join(",")}); commit;`);
        for (const path of paths) {
          try { await unlink(filePath(bucket, path)); } catch (error) { if (error.code !== "ENOENT") throw error; }
        }
        return { data: [], error: null };
      },
    };
  } },
};
const { createCleanupHandler } = await loadCleanupHandler();
const secret = "isolated-cleanup-schedule-fixture-0000";
const handler = createCleanupHandler({
  getEnv: (key) => ({ VENFOUR_ANONYMOUS_CLEANUP_SCHEDULE_SECRET: secret, SUPABASE_URL: "http://127.0.0.1", SUPABASE_SERVICE_ROLE_KEY: "local-injected-client" })[key],
  createCleanupClient: () => client,
  randomUUID,
});
const response = await handler(new Request("http://127.0.0.1/cleanup", {
  method: "POST", headers: { "x-venfour-cleanup-secret": secret, "content-type": "application/json" }, body: '{"batchSize":25}',
}));
const body = await response.json();
assert.equal(response.status, 200, JSON.stringify(body));
assert.deepEqual(trace.filter((entry) => entry.action === "delete_user").map((entry) => entry.id).sort(), ordinary);
assert.equal(query(`select to_jsonb(count(*)) from public.appraisal_cases where id in ('e9200000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000003');`), 0);
assert.equal(query(`select to_jsonb(count(*)) from public.referral_case_attributions where case_id='e9200000-0000-4000-8000-000000000003';`), 0);
assert.equal(query(`select to_jsonb(count(*)) from public.referral_case_attributions where case_id='e9200000-0000-4000-8000-000000000002' and submitted_at is not null;`), 1);
let retainedFiles = 0;
for (const row of objects()) {
  const key = `${row.bucket}/${row.name}`;
  assert.equal(createHash("sha256").update(await readFile(filePath(row.bucket, row.name))).digest("hex"), before.get(key));
  retainedFiles++;
}
assert.ok(objects().some((row) => row.name.startsWith(protectedPrefix)));
const summary = { success: true, container, ordinaryGuestsCleaned: 2, submittedReferralPreserved: true,
  retainedFilesWithUnchangedBytes: retainedFiles, deletedFiles: before.size - retainedFiles,
  providerRequests: 0, hostedWrites: 0, storageTransport: "local file adapter", authTransport: "local SQL adapter", handlerResponse: body, trace };
await writeFile(join(output, "cleanup-workflow-results.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ ...summary, trace: undefined }, null, 2));
