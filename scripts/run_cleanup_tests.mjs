/** Run the existing dependency-injected Edge cleanup suite without network access. */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export async function loadCleanupHandler() {
  const directory = await mkdtemp(join(tmpdir(), "venfour-cleanup-tests-"));
  const require = createRequire(join(root, "frontend/package.json"));
  let source = await readFile(join(root, "supabase/functions/cleanup-abandoned-anonymous-guests/index.ts"), "utf8");
  source = source.replace('"npm:@supabase/supabase-js@2.112.3"', JSON.stringify(pathToFileURL(require.resolve("@supabase/supabase-js")).href));
  await writeFile(join(directory, "index.mjs"), stripTypeScriptTypes(source, { mode: "transform" }));
  globalThis.fetch = () => { throw new Error("Cleanup verification prohibits real HTTP requests"); };
  const module = await import(pathToFileURL(join(directory, "index.mjs")).href);
  return { directory, ...module };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const { directory } = await loadCleanupHandler();
  globalThis.Deno = { test, env: { get: () => undefined } };
  const source = (await readFile(join(root, "supabase/functions/cleanup-abandoned-anonymous-guests/index_test.ts"), "utf8"))
    .replace('"./index.ts"', '"./index.mjs"');
  await writeFile(join(directory, "index_test.mjs"), stripTypeScriptTypes(source, { mode: "transform" }));
  await import(pathToFileURL(join(directory, "index_test.mjs")).href);
}
