import { describe, expect, it, vi } from "vitest";

import {
  type Env,
  handleRequest,
  type WorkerDependencies,
} from "./index";

const STAGING_ORIGIN = "https://staging.venfour.com";
const API_ORIGIN =
  "https://venfour-api-staging-640078527158.us-east4.run.app";
const API_PROXY_SECRET = "worker-proxy-test-secret-value-1234567890";

function createEnv(
  assetFetch: (request: Request) => Promise<Response> = async () =>
    new Response("asset"),
): Env {
  return {
    API_PROXY_SECRET,
    API_ORIGIN,
    ASSETS: { fetch: assetFetch } as unknown as Fetcher,
    DEPLOYMENT_ENVIRONMENT: "staging",
    STAGING_HOSTNAME: "staging.venfour.com",
  };
}

function dependencies(fetchImplementation: WorkerDependencies["fetch"]) {
  return { fetch: fetchImplementation } satisfies WorkerDependencies;
}

describe("staging Worker boundary", () => {
  it("fails closed for invalid configuration and an unexpected host", async () => {
    const invalid = await handleRequest(
      new Request(`${STAGING_ORIGIN}/`),
      { ...createEnv(), DEPLOYMENT_ENVIRONMENT: "production" },
    );
    expect(invalid.status).toBe(503);
    expect(invalid.headers.get("cache-control")).toContain("no-store");
    expect(invalid.headers.get("x-robots-tag")).toContain("noindex");

    const assets = vi.fn(async () => new Response("asset"));
    const wrongHost = await handleRequest(
      new Request("https://preview.venfour.com/"),
      createEnv(assets),
    );
    expect(wrongHost.status).toBe(421);
    expect(assets).not.toHaveBeenCalled();
  });

  it("serves the SPA through Static Assets with security and cache policy", async () => {
    const assets = vi.fn(async (request: Request) =>
      request.url.includes("/assets/")
        ? new Response("javascript", {
            headers: { "Content-Type": "text/javascript" },
          })
        : new Response("<html>SPA</html>", {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
    );
    const env = createEnv(assets);

    const html = await handleRequest(
      new Request(`${STAGING_ORIGIN}/analysis/example?from=staging`),
      env,
    );
    expect(html.status).toBe(200);
    expect(await html.text()).toBe("<html>SPA</html>");
    expect(html.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(html.headers.get("x-robots-tag")).toBe(
      "noindex, nofollow, noarchive",
    );
    expect(html.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(assets).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${STAGING_ORIGIN}/analysis/example?from=staging` }),
    );

    const asset = await handleRequest(
      new Request(`${STAGING_ORIGIN}/assets/index-AbCd1234.js`),
      env,
    );
    expect(asset.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(asset.headers.get("x-content-type-options")).toBe("nosniff");
    expect(asset.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("proxies API requests without repurposing Bearer or Access headers", async () => {
    let capturedRequest: Request | undefined;
    let capturedInit: RequestInit | undefined;
    const upstreamFetch = vi.fn(async (request: Request, init?: RequestInit) => {
      capturedRequest = request;
      capturedInit = init;
      const headers = new Headers({
          "Access-Control-Allow-Origin": "https://unexpected.example",
          "Content-Type": "text/plain; charset=utf-8",
          Location: "/api/v1/cases/example",
          "Retry-After": "30",
          "Set-Cookie": "api_session=test-value; Secure; HttpOnly; SameSite=Lax",
          Server: "provider-server",
          "WWW-Authenticate": "Bearer",
          "X-Cloud-Trace-Context": "private-trace",
          "X-Request-ID": "request-123",
      });
      headers.append(
        "Set-Cookie",
        "oauth-state=preserved; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax",
      );
      return new Response("upstream conflict", {
        headers,
        status: 409,
        statusText: "Conflict",
      });
    });
    const request = new Request(
      `${STAGING_ORIGIN}/api/v1/cases?include=analysis`,
      {
        body: JSON.stringify({ caseId: "case-123" }),
        headers: {
          Authorization: "Bearer supabase-token",
          "Cf-Access-Authenticated-User-Email": "tester@example.test",
          "Cf-Access-Jwt-Assertion": "access-assertion",
          "Content-Type": "application/json",
          Cookie: "sb-auth-token=oauth-session",
          "X-Venfour-Staging-Proxy": "attacker-controlled-value",
        },
        method: "POST",
      },
    );

    const response = await handleRequest(
      request,
      createEnv(),
      dependencies(upstreamFetch as unknown as typeof fetch),
    );

    expect(capturedRequest).toBeDefined();
    expect(capturedRequest?.url).toBe(
      `${API_ORIGIN}/api/v1/cases?include=analysis`,
    );
    expect(capturedRequest?.method).toBe("POST");
    expect(capturedRequest?.headers.get("authorization")).toBe(
      "Bearer supabase-token",
    );
    expect(capturedRequest?.headers.get("content-type")).toBe("application/json");
    expect(capturedRequest?.headers.get("host")).toBeNull();
    expect(capturedRequest?.headers.get("x-venfour-staging-proxy")).toBe(
      API_PROXY_SECRET,
    );
    expect(capturedRequest?.headers.get("cf-access-jwt-assertion")).toBe(
      "access-assertion",
    );
    expect(
      capturedRequest?.headers.get("cf-access-authenticated-user-email"),
    ).toBe("tester@example.test");
    expect(capturedRequest?.headers.get("cookie")).toBe(
      "sb-auth-token=oauth-session",
    );
    expect(await capturedRequest?.text()).toBe('{"caseId":"case-123"}');
    expect(capturedInit).toEqual({ redirect: "manual" });

    expect(response.status).toBe(409);
    expect(response.statusText).toBe("Conflict");
    expect(await response.text()).toBe("upstream conflict");
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(response.headers.get("location")).toBe("/api/v1/cases/example");
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(response.headers.get("x-request-id")).toBe("request-123");
    expect(response.headers.getSetCookie()).toEqual([
      "api_session=test-value; Secure; HttpOnly; SameSite=Lax",
      "oauth-state=preserved; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax",
    ]);
    expect(response.headers.has("server")).toBe(false);
    expect(response.headers.has("x-cloud-trace-context")).toBe(false);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("cdn-cache-control")).toBe(
      "private, no-store, max-age=0",
    );
  });

  it("proxies health checks and does not require Access headers inside the Worker", async () => {
    const upstreamFetch = vi.fn(async () =>
      new Response('{"status":"ok"}', {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const response = await handleRequest(
      new Request(`${STAGING_ORIGIN}/health`),
      createEnv(),
      dependencies(upstreamFetch as unknown as typeof fetch),
    );

    expect(upstreamFetch).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns a neutral no-store response when the API origin is unavailable", async () => {
    const response = await handleRequest(
      new Request(`${STAGING_ORIGIN}/api/v1/cases`),
      createEnv(),
      dependencies(vi.fn(async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "STAGING_API_UNAVAILABLE",
        message: "The staging API is temporarily unavailable.",
      },
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
