#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const LOCAL_WEBHOOK_TARGET = "http://127.0.0.1:8000/webhooks/stripe";
export const CHECKOUT_EVENTS = Object.freeze([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);
const safeSystemVariables = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM"];
const secretKeyPattern = /^sk_test_[A-Za-z0-9_]{8,256}$/;
const webhookSecretPattern = /^whsec_[A-Za-z0-9_]{8,256}$/;

export class LocalListenerSetupError extends Error {}

export function createListenerPlan(environment) {
  if (["K_SERVICE", "CLOUD_RUN_JOB", "VENFOUR_STAGING_PROXY_SECRET"].some((name) => environment[name])) {
    throw new LocalListenerSetupError("This listener is for localhost only; remove deployed-environment configuration before starting it.");
  }
  if (!secretKeyPattern.test(environment.STRIPE_SECRET_KEY ?? "")) {
    throw new LocalListenerSetupError("Set a valid STRIPE_SECRET_KEY beginning with sk_test_ in the ignored root .env. Live, restricted, missing, and malformed keys are not accepted.");
  }
  if (!webhookSecretPattern.test(environment.STRIPE_WEBHOOK_SECRET ?? "")) {
    throw new LocalListenerSetupError("Set the matching local listener STRIPE_WEBHOOK_SECRET in the ignored root .env before starting. Do not paste secrets into chat or logs.");
  }
  if (environment.VENFOUR_PUBLIC_APP_ORIGIN && !["http://localhost:5173", "http://127.0.0.1:5173"].includes(environment.VENFOUR_PUBLIC_APP_ORIGIN)) {
    throw new LocalListenerSetupError("VENFOUR_PUBLIC_APP_ORIGIN must identify the localhost application for this listener.");
  }
  const childEnvironment = Object.fromEntries(
    safeSystemVariables.filter((name) => typeof environment[name] === "string")
      .map((name) => [name, environment[name]]),
  );
  childEnvironment.STRIPE_API_KEY = environment.STRIPE_SECRET_KEY;
  return {
    args: ["listen", "--forward-to", LOCAL_WEBHOOK_TARGET, "--events", CHECKOUT_EVENTS.join(","), "--skip-update", "--color", "off"],
    environment: childEnvironment,
    webhookSecret: environment.STRIPE_WEBHOOK_SECRET,
  };
}

export function loadListenerPlan({
  environment = process.env,
  environmentFile = join(repositoryRoot, ".env"),
  exists = existsSync,
  loadEnvFile = process.loadEnvFile,
} = {}) {
  if (exists(environmentFile)) loadEnvFile(environmentFile);
  return createListenerPlan(environment);
}

export function verifyListenerSecret(plan, { spawnSyncImpl = spawnSync } = {}) {
  let result;
  try {
    result = spawnSyncImpl("stripe", [...plan.args, "--print-secret"], {
      cwd: repositoryRoot,
      env: plan.environment,
      encoding: "utf8",
      maxBuffer: 64 * 1024,
      timeout: 20_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new LocalListenerSetupError("The Stripe CLI could not check local webhook signing configuration. Confirm the CLI is installed and the sandbox key is usable, then retry.");
  }
  const actual = typeof result.stdout === "string" ? result.stdout.trim() : "";
  if (result.error || result.status !== 0 || !webhookSecretPattern.test(actual)) {
    throw new LocalListenerSetupError("The Stripe CLI could not verify the sandbox listener secret. Check the installed CLI, test key, and network connection; CLI output was suppressed to protect secrets.");
  }
  const expectedBytes = Buffer.from(plan.webhookSecret);
  const actualBytes = Buffer.from(actual);
  if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes)) {
    throw new LocalListenerSetupError("The listener signing secret does not match STRIPE_WEBHOOK_SECRET. Update that value securely in the ignored root .env for this same sandbox key, restart the backend, then rerun this listener. No listener was started.");
  }
}

export function summarizeCliLine(line) {
  if (line.includes("Ready!")) return "Stripe sandbox webhook listener ready.\n";
  const response = line.match(/<--\s+\[(\d{3})\]/);
  if (response) return `Local webhook response: HTTP ${response[1]}.\n`;
  const event = line.match(/-->\s+(checkout\.session\.[a-z_]+)(?:\s|\[|$)/);
  if (event && CHECKOUT_EVENTS.includes(event[1])) return `Received sandbox event: ${event[1]}.\n`;
  if (/error|fail|disconnect/i.test(line)) {
    return "Stripe listener reported a connection or delivery issue; details were suppressed to protect private data.\n";
  }
  return "";
}

export function createSafeOutputSink(write) {
  const decoder = new StringDecoder("utf8");
  let line = "";
  let oversized = false;
  const consume = (text) => {
    for (const character of text) {
      if (character === "\n" || character === "\r") {
        if (!oversized) {
          const summary = summarizeCliLine(line);
          if (summary) write(summary);
        }
        line = "";
        oversized = false;
      } else if (!oversized) {
        if (line.length >= 8192) {
          line = "";
          oversized = true;
        } else {
          line += character;
        }
      }
    }
  };
  return {
    write: (chunk) => consume(decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))),
    end: () => { consume(decoder.end()); consume("\n"); },
  };
}

export async function startListener(plan, {
  spawnImpl = spawn,
  write = (text) => process.stdout.write(text),
  signalSource = process,
} = {}) {
  let child;
  try {
    child = spawnImpl("stripe", plan.args, {
      cwd: repositoryRoot,
      env: plan.environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new LocalListenerSetupError("The Stripe sandbox listener could not start. Confirm the CLI is installed and retry.");
  }
  const stdout = createSafeOutputSink(write);
  const stderr = createSafeOutputSink(write);
  child.stdout.on("data", stdout.write);
  child.stderr.on("data", stderr.write);
  const interrupt = () => child.kill("SIGINT");
  const terminate = () => child.kill("SIGTERM");
  signalSource.once("SIGINT", interrupt);
  signalSource.once("SIGTERM", terminate);
  const result = await new Promise((complete) => {
    child.once("error", () => {
      write("The Stripe sandbox listener could not start. Check the CLI and local configuration.\n");
      complete(1);
    });
    child.once("close", (code, signalName) => {
      complete(signalName === "SIGINT" || signalName === "SIGTERM" ? 0 : (code ?? 1));
    });
  });
  stdout.end();
  stderr.end();
  signalSource.removeListener("SIGINT", interrupt);
  signalSource.removeListener("SIGTERM", terminate);
  return result;
}

export async function main() {
  try {
    if (process.argv.length > 2) {
      throw new LocalListenerSetupError("This local listener accepts no arguments; its test-mode event list and loopback destination are fixed.");
    }
    const plan = loadListenerPlan();
    verifyListenerSecret(plan);
    process.stdout.write(`Starting verified sandbox webhook forwarding to ${LOCAL_WEBHOOK_TARGET}.\n`);
    return await startListener(plan);
  } catch (error) {
    const message = error instanceof LocalListenerSetupError
      ? error.message
      : "Local Stripe setup could not be loaded. Check the ignored root .env and retry; private error details were suppressed.";
    process.stderr.write(`Local Stripe listener could not start: ${message}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
