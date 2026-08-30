import { createHash } from "node:crypto";
import { createServer } from "node:http";

export const LISTENER_STATUS_URL = "http://127.0.0.1:54325/health";

export function listenerIdentity(plan) {
  return createHash("sha256").update(JSON.stringify([
    plan.environment.STRIPE_API_KEY, plan.webhookSecret, plan.args,
  ])).digest("hex");
}

export async function readListenerStatus(plan) {
  let response;
  try {
    response = await fetch(LISTENER_STATUS_URL, { signal: AbortSignal.timeout(2000) });
  } catch (error) {
    if (error.cause?.code === "ECONNREFUSED") return null;
    throw new Error("The local webhook listener status could not be checked.");
  }
  const status = await response.json();
  if (!response.ok || status.service !== "venfour-stripe-sandbox-listener"
      || status.identity !== listenerIdentity(plan) || typeof status.ready !== "boolean") {
    throw new Error("A different listener configuration is using local port 54325. Stop that listener before restarting.");
  }
  return status;
}

export async function startListenerStatus(plan, { port = 54325 } = {}) {
  let ready = false;
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/health"
        || request.headers.origin
        || request.headers.host !== `127.0.0.1:${server.address().port}`) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ service: "venfour-stripe-sandbox-listener", identity: listenerIdentity(plan), ready }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    port: server.address().port,
    setReady: (value) => { ready = value; },
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
