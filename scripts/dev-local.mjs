#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const frontendDirectory = join(repositoryRoot, "frontend");
const pythonExecutable = join(repositoryRoot, ".venv", "bin", "python");
const supabaseExecutable = join(
  frontendDirectory,
  "node_modules",
  ".bin",
  "supabase",
);
const localEnvironmentFile = join(repositoryRoot, ".env");
const turnstileTestSiteKey = "1x00000000000000000000BB";
const turnstileTestSecret = "1x0000000000000000000000000000000AA";
const claimRecoveryRateLimitTestSecret =
  "local-claim-recovery-rate-limit-secret-not-for-production";

function fail(message) {
  console.error(`\nLocal development could not start: ${message}`);
  process.exit(1);
}

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function executableExists(path) {
  return existsSync(path);
}

function commandAvailable(command, args = ["--version"]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
  });
  return result.status === 0;
}

function runSupabase(args, environment) {
  return spawnSync(supabaseExecutable, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: environment,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function parseStatus(output) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    return null;
  }
}

function localCredentials(status) {
  if (!status || typeof status !== "object") return null;
  const apiUrl = status.API_URL;
  const publishableKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  const serviceRoleKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
  const emailInboxUrl =
    status.MAILPIT_URL ?? status.INBUCKET_URL ?? "http://127.0.0.1:54324";

  if (
    !nonempty(apiUrl) ||
    !nonempty(publishableKey) ||
    !nonempty(serviceRoleKey)
  ) {
    return null;
  }

  return { apiUrl, emailInboxUrl, publishableKey, serviceRoleKey };
}

function readLocalCredentials(environment) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const result = runSupabase(["status", "--output", "json"], environment);
    const credentials = localCredentials(
      parseStatus(`${result.stdout ?? ""}\n${result.stderr ?? ""}`),
    );
    if (result.status === 0 && credentials) return credentials;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
  }
  return null;
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // The process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} did not become ready within ${timeoutMs / 1000}s.`);
}

if (existsSync(localEnvironmentFile)) {
  process.loadEnvFile(localEnvironmentFile);
}
const localClaimTesting = process.env.VENFOUR_LOCAL_POST_CONTINUE === "1";

if (!executableExists(pythonExecutable)) {
  fail("create .venv and install requirements-dev.txt first.");
}
if (!executableExists(supabaseExecutable)) {
  fail("run `npm install` in frontend first.");
}
if (!commandAvailable("docker", ["info"])) {
  fail(
    "a Docker-compatible container runtime is required for the isolated local Supabase stack. Start Docker Desktop, OrbStack, Rancher Desktop, or Podman, then retry.",
  );
}
if (!localClaimTesting && !nonempty(process.env.OPENAI_API_KEY)) {
  fail("OPENAI_API_KEY is missing from the ignored root .env file.");
}
if (!localClaimTesting && !nonempty(process.env.MARKETCHECK_API_KEY)) {
  fail("MARKETCHECK_API_KEY is missing from the ignored root .env file.");
}
if (!nonempty(process.env.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)) {
  fail(
    "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID is missing from the ignored root .env file.",
  );
}
if (!nonempty(process.env.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)) {
  fail(
    "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET is missing from the ignored root .env file.",
  );
}
if (nonempty(process.env.VENFOUR_STAGING_PROXY_SECRET)) {
  fail("VENFOUR_STAGING_PROXY_SECRET must not be present in local development.");
}
if (
  nonempty(process.env.VENFOUR_ENABLE_LEGACY_ANALYSIS_API) &&
  process.env.VENFOUR_ENABLE_LEGACY_ANALYSIS_API !== "0"
) {
  fail("VENFOUR_ENABLE_LEGACY_ANALYSIS_API must remain disabled.");
}

const supabaseEnvironment = {
  ...process.env,
  SUPABASE_AUTH_CAPTCHA_SECRET: turnstileTestSecret,
};

let credentials = readLocalCredentials(supabaseEnvironment);
if (!credentials) {
  console.log(
    "Starting the isolated local data services. The first run may download container images…",
  );
  const startResult = runSupabase(["start"], supabaseEnvironment);
  if (startResult.status !== 0) {
    fail(
      "the local data services did not start. Confirm the container runtime is running and ports 54320–54324 are available.",
    );
  }
  credentials = readLocalCredentials(supabaseEnvironment);
}
if (!credentials) {
  fail("the local data services started but did not publish usable API credentials.");
}

const backendEnvironment = {
  ...process.env,
  SUPABASE_PUBLISHABLE_KEY: credentials.publishableKey,
  SUPABASE_SERVICE_ROLE_KEY: credentials.serviceRoleKey,
  SUPABASE_URL: credentials.apiUrl,
  VENFOUR_ENABLE_LEGACY_ANALYSIS_API: "0",
  VENFOUR_CLAIM_RECOVERY_RATE_LIMIT_SECRET:
    claimRecoveryRateLimitTestSecret,
  VENFOUR_PROVIDER_DIAGNOSTICS: "1",
  VENFOUR_PUBLIC_APP_ORIGIN: "http://localhost:5173",
  VENFOUR_PREVIEW_EMAIL_DISPATCH_SECRET:
    "local-preview-email-dispatch-secret-not-for-production",
  VENFOUR_TURNSTILE_SECRET: turnstileTestSecret,
};
delete backendEnvironment.VENFOUR_STAGING_PROXY_SECRET;
if (localClaimTesting) {
  for (const name of Object.keys(backendEnvironment)) {
    if (name.startsWith("OPENAI_") || name === "MARKETCHECK_API_KEY") {
      delete backendEnvironment[name];
    }
  }
}

const frontendEnvironment = {
  ...process.env,
  VITE_API_BASE_URL: "",
  VITE_SUPABASE_PUBLISHABLE_KEY: credentials.publishableKey,
  VITE_SUPABASE_URL: credentials.apiUrl,
  VITE_TURNSTILE_SITE_KEY: turnstileTestSiteKey,
  VENFOUR_API_PROXY_TARGET: "http://127.0.0.1:8000",
  VITE_ENABLE_POST_CONTINUE_FLOW: localClaimTesting ? "true" : "false",
};
for (const secretName of [
  "API_PROXY_SECRET",
  "MARKETCHECK_API_KEY",
  "OPENAI_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET",
  "SUPABASE_AUTH_CAPTCHA_SECRET",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
  "VENFOUR_STAGING_PROXY_SECRET",
  "VENFOUR_PROVIDER_DIAGNOSTICS",
  "VENFOUR_CLAIM_RECOVERY_RATE_LIMIT_SECRET",
  "VENFOUR_PUBLIC_APP_ORIGIN",
  "VENFOUR_PREVIEW_EMAIL_DISPATCH_SECRET",
  "VENFOUR_TURNSTILE_SECRET",
  "VENFOUR_TOTAL_LOSS_STRIPE_PRICE_ID",
  "VENFOUR_TOTAL_LOSS_PRODUCT_IDENTIFIER",
  "VENFOUR_TOTAL_LOSS_PRODUCT_VERSION",
  "VENFOUR_TOTAL_LOSS_TERMS_VERSION",
  "VENFOUR_TOTAL_LOSS_REFUND_POLICY_VERSION",
  "VENFOUR_PACKAGE_TASKS_PROJECT",
  "VENFOUR_PACKAGE_TASKS_LOCATION",
  "VENFOUR_PACKAGE_TASKS_QUEUE",
  "VENFOUR_PACKAGE_WORKER_ORIGIN",
  "VENFOUR_PACKAGE_TASKS_OIDC_SERVICE_ACCOUNT",
  "VENFOUR_PACKAGE_TASKS_OIDC_AUDIENCE",
]) {
  delete frontendEnvironment[secretName];
}

const children = [];
let shuttingDown = false;

function stopChildren(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(exitCode), 1_500).unref();
}

process.on("SIGINT", () => stopChildren(0));
process.on("SIGTERM", () => stopChildren(0));

const backend = spawn(
  pythonExecutable,
  [
    "-m",
    "uvicorn",
    localClaimTesting ? "scripts.local_claim_flow:create_app" : "venfour.api:create_app",
    "--factory",
    "--host",
    "127.0.0.1",
    "--port",
    "8000",
    "--reload",
    "--reload-dir",
    "venfour",
    ...(localClaimTesting ? ["--reload-dir", "scripts"] : []),
  ],
  {
    cwd: repositoryRoot,
    env: backendEnvironment,
    stdio: "inherit",
  },
);
children.push(backend);

const frontend = spawn(
  "npm",
  ["run", "dev", "--", "--host", "127.0.0.1", "--strictPort"],
  {
    cwd: frontendDirectory,
    env: frontendEnvironment,
    stdio: "inherit",
  },
);
children.push(frontend);

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const detail = signal ? `signal ${signal}` : `exit code ${code ?? 1}`;
    console.error(`\nA local development process stopped (${detail}).`);
    stopChildren(code ?? 1);
  });
}

try {
  await Promise.all([
    waitForUrl(localClaimTesting ? "http://127.0.0.1:8000/health" : "http://127.0.0.1:8000/ready", 45_000),
    waitForUrl("http://127.0.0.1:5173/", 45_000),
  ]);
  console.log("\nVenfour is ready: http://localhost:5173");
  if (localClaimTesting) {
    console.log("Local claim testing: http://localhost:5173/_local/claims (external providers disabled)");
  }
  console.log(`Local email inbox: ${credentials.emailInboxUrl}`);
  console.log("Press Ctrl+C to stop Vite and Uvicorn.");
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  stopChildren(1);
}
