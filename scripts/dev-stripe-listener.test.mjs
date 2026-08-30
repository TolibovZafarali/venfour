import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";

import {
  CHECKOUT_EVENTS,
  LOCAL_WEBHOOK_TARGET,
  createListenerPlan,
  createSafeOutputSink,
  loadListenerPlan,
  startListener,
  summarizeCliLine,
  verifyListenerSecret,
} from "./dev-stripe-listener.mjs";

const secret = "sk" + "_test_" + "localFixtureSecretOnly";
const signingSecret = "whsec" + "_" + "localFixtureSigningOnly";
const validEnvironment = {
  PATH: "/usr/local/bin:/usr/bin:/bin",
  HOME: "/local/fixture-user",
  LANG: "en_US.UTF-8",
  STRIPE_SECRET_KEY: secret,
  STRIPE_WEBHOOK_SECRET: signingSecret,
  VENFOUR_PUBLIC_APP_ORIGIN: "http://localhost:5173",
};

describe("local Stripe listener configuration", () => {
  it("uses the same explicit backend test key in a minimal child environment", () => {
    const plan = createListenerPlan({
      ...validEnvironment,
      STRIPE_API_KEY: "sk" + "_live_" + "unrelatedShellValue",
      STRIPE_PROJECT_NAME: "unrelated-profile",
      HTTPS_PROXY: "http://unrelated-proxy.example.test",
      SUPABASE_SERVICE_ROLE_KEY: "fixture-database-secret",
      OTHER_PROVIDER_API_KEY: "fixture-provider-secret",
    });
    assert.deepEqual(plan.environment, {
      PATH: validEnvironment.PATH,
      HOME: validEnvironment.HOME,
      LANG: validEnvironment.LANG,
      STRIPE_API_KEY: secret,
    });
    assert.deepEqual(plan.args, ["listen", "--forward-to", LOCAL_WEBHOOK_TARGET,
      "--events", CHECKOUT_EVENTS.join(","), "--skip-update", "--color", "off"]);
    assert.equal(plan.args.some((value) => value.includes(secret)), false);
    assert.equal(plan.args.includes("--live"), false);
    assert.equal(plan.environment.STRIPE_WEBHOOK_SECRET, undefined);
  });

  it("loads only the repository-selected environment file using the existing loader convention", () => {
    const environment = {};
    const calls = [];
    const plan = loadListenerPlan({ environment, environmentFile: "/fixture/.env",
      exists: (path) => path === "/fixture/.env",
      loadEnvFile: (path) => { calls.push(path); Object.assign(environment, validEnvironment); },
    });
    assert.deepEqual(calls, ["/fixture/.env"]);
    assert.equal(plan.environment.STRIPE_API_KEY, secret);
  });

  for (const badKey of [undefined, "", "sk" + "_live_" + "fixtureOnlyValue", "rk" + "_test_" + "fixtureOnlyValue", `${secret}\n`, `${secret} `, "sk_test_bad\u0000value"]) {
    it("rejects missing, live, restricted, or malformed server keys without echoing values", () => {
      assert.throws(() => createListenerPlan({ ...validEnvironment, STRIPE_SECRET_KEY: badKey }), (error) => {
        assert.match(error.message, /valid STRIPE_SECRET_KEY/);
        if (badKey) assert.equal(error.message.includes(badKey), false);
        return true;
      });
    });
  }

  it("rejects missing signing configuration and nonlocal execution", () => {
    for (const override of [
      { STRIPE_WEBHOOK_SECRET: undefined },
      { STRIPE_WEBHOOK_SECRET: `${signingSecret}\n` },
      { K_SERVICE: "deployed-service" },
      { CLOUD_RUN_JOB: "deployed-job" },
      { VENFOUR_STAGING_PROXY_SECRET: "fixture-proxy-secret" },
      { VENFOUR_PUBLIC_APP_ORIGIN: "https://unrelated.example.test" },
    ]) assert.throws(() => createListenerPlan({ ...validEnvironment, ...override }));
  });
});

describe("private signing-secret preflight", () => {
  it("compares the captured secret privately using exactly the listener key and options", () => {
    const plan = createListenerPlan(validEnvironment);
    let calls = 0;
    verifyListenerSecret(plan, { spawnSyncImpl: (command, args, options) => {
      calls += 1;
      assert.equal(command, "stripe");
      assert.deepEqual(args, [...plan.args, "--print-secret"]);
      assert.equal(options.env, plan.environment);
      assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
      assert.equal(options.timeout, 20_000);
      return { status: 0, stdout: `${signingSecret}\n`, stderr: "" };
    } });
    assert.equal(calls, 1);
  });

  it("fails closed on mismatch without exposing either secret", () => {
    const other = "whsec" + "_" + "differentFixtureSigning";
    assert.throws(() => verifyListenerSecret(createListenerPlan(validEnvironment), {
      spawnSyncImpl: () => ({ status: 0, stdout: other, stderr: "" }),
    }), (error) => {
      assert.match(error.message, /does not match STRIPE_WEBHOOK_SECRET/);
      assert.match(error.message, /restart the backend/);
      assert.equal(error.message.includes(signingSecret), false);
      assert.equal(error.message.includes(other), false);
      return true;
    });
  });

  it("suppresses failed, malformed, timed-out, and thrown CLI output", () => {
    for (const result of [
      { status: 1, stdout: secret, stderr: signingSecret },
      { status: 0, stdout: `unexpected ${signingSecret}`, stderr: secret },
      { status: null, error: new Error(secret), stdout: signingSecret },
    ]) {
      assert.throws(() => verifyListenerSecret(createListenerPlan(validEnvironment), {
        spawnSyncImpl: () => result,
      }), (error) => !error.message.includes(secret) && !error.message.includes(signingSecret));
    }
    assert.throws(() => verifyListenerSecret(createListenerPlan(validEnvironment), {
      spawnSyncImpl: () => { throw new Error(secret); },
    }), (error) => !error.message.includes(secret));
  });
});

describe("redacted listener output and lifecycle", () => {
  it("emits only fixed summaries, including when secrets cross chunk boundaries", () => {
    let output = "";
    const sink = createSafeOutputSink((text) => { output += text; });
    const message = `> Ready! Your webhook signing secret is ${signingSecret}\n`;
    sink.write(message.slice(0, 17));
    sink.write(message.slice(17));
    sink.write(`--> checkout.session.completed [evt_fixture]\n<-- [200] POST ${LOCAL_WEBHOOK_TARGET}\n`);
    sink.write(`error ${secret} ${signingSecret}\n`);
    sink.write('{"private":"body data"}\n');
    sink.write("x".repeat(8200) + secret + "\n");
    sink.end();
    assert.equal(output, "Stripe sandbox webhook listener ready.\nReceived sandbox event: checkout.session.completed.\nLocal webhook response: HTTP 200.\nStripe listener reported a connection or delivery issue; details were suppressed to protect private data.\n");
    for (const value of [secret, signingSecret, "evt_fixture", "body data"])
      assert.equal(output.includes(value), false);
    assert.equal(summarizeCliLine("--> customer.created [evt_fixture]"), "");
  });

  it("starts the same fixed listener, filters both streams, and forwards termination", async () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const signals = [];
    child.kill = (signalName) => { signals.push(signalName); return true; };
    const signalSource = new EventEmitter();
    let output = "";
    const plan = createListenerPlan(validEnvironment);
    const result = startListener(plan, { signalSource, write: (text) => { output += text; },
      spawnImpl: (command, args, options) => {
        assert.equal(command, "stripe");
        assert.equal(args, plan.args);
        assert.equal(options.env, plan.environment);
        assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
        return child;
      },
    });
    child.stdout.write(`Ready! ${signingSecret}\n`);
    child.stderr.write(`error ${secret}\n`);
    signalSource.emit("SIGINT");
    assert.deepEqual(signals, ["SIGINT"]);
    child.emit("close", null, "SIGINT");
    assert.equal(await result, 0);
    assert.equal(signalSource.listenerCount("SIGINT"), 0);
    assert.equal(signalSource.listenerCount("SIGTERM"), 0);
    assert.equal(output.includes(secret), false);
    assert.equal(output.includes(signingSecret), false);
  });
});
