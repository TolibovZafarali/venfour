import assert from "node:assert/strict";
import { test } from "node:test";
import { listenerIdentity, startListenerStatus } from "./local-listener-status.mjs";

const plan = { environment: { STRIPE_API_KEY: "local-key-fixture" }, webhookSecret: "local-signing-fixture", args: ["listen"] };

test("listener status prevents duplicate instances without disclosing credentials", async () => {
  const monitor = await startListenerStatus(plan, { port: 0 });
  const url = `http://127.0.0.1:${monitor.port}/health`;
  try {
    const first = await (await fetch(url)).json();
    assert.equal(first.ready, false);
    monitor.setReady(true);
    const status = await (await fetch(url)).json();
    assert.equal(status.ready, true);
    assert.equal(status.identity, listenerIdentity(plan));
    assert.notEqual(status.identity, listenerIdentity({ ...plan, webhookSecret: "other-signing-fixture" }));
    const text = JSON.stringify(status);
    assert.equal(text.includes(plan.environment.STRIPE_API_KEY), false);
    assert.equal(text.includes(plan.webhookSecret), false);
    assert.equal((await fetch(url, { headers: { Origin: "https://untrusted.example.test" } })).status, 404);
    assert.equal((await fetch(url, { method: "POST" })).status, 404);
    await assert.rejects(startListenerStatus(plan, { port: monitor.port }), { code: "EADDRINUSE" });
  } finally {
    await monitor.close();
  }
});
