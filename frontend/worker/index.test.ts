import { describe, expect, it, vi } from "vitest";

import { type Env, handleRequest, type WorkerDependencies } from "./index";

const STAGING_ORIGIN = "https://staging.venfour.com";
const API_ORIGIN = "https://venfour-api-staging-640078527158.us-east4.run.app";
const API_PROXY_SECRET = "worker-proxy-test-secret-value-1234567890";
const COMPRESSED_RESPONSE_FIXTURES = [
  {
    body: [
      31, 139, 8, 0, 0, 0, 0, 0, 0, 19, 171, 86, 42, 46, 73, 44, 41, 45, 86,
      178, 82, 74, 206, 207, 45, 40, 74, 45, 46, 78, 77, 81, 170, 5, 0, 191,
      226, 77, 98, 23, 0, 0, 0,
    ],
    encoding: "gzip",
  },
  {
    body: [
      11, 11, 128, 123, 34, 115, 116, 97, 116, 117, 115, 34, 58, 34, 99, 111,
      109, 112, 114, 101, 115, 115, 101, 100, 34, 125, 3,
    ],
    encoding: "br",
  },
] as const;

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

describe("public website boundary", () => {
  const publicEnv = (fetch: Fetcher["fetch"]): Env => ({
    DEPLOYMENT_ENVIRONMENT: "public-site", ASSETS: { fetch } as Fetcher,
  });

  it.each(["/", "/terms", "/privacy", "/refund-policy", "/refund-policy/", "/contact", "/methodology", "/cookies", "/referral-partners", "/about", "/resources/understanding-your-report", "/resources/valuation-review-checklist", "/resources/understanding-your-report/"])("serves %s without backend configuration or transport", async path => {
    const assets = vi.fn(async () => new Response("Venfour", { headers: { "Content-Type": "text/html" } }));
    const transport = vi.fn();
    const response = await handleRequest(new Request(`https://venfour.com${path}`), publicEnv(assets), dependencies(transport));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBeNull();
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'self';");
    expect(response.headers.get("content-security-policy")).toContain("frame-src https://app.venfour.com/auth/sign-in;");
    expect(response.headers.get("content-security-policy")).not.toContain("stripe.com");
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(["/api/cases", "/app", "/admin/cases", "/partners", "/start", "/auth/callback", "/total-loss/cases/example/analysis", "/webhooks/stripe", "/internal/execute"])("does not expose %s", async path => {
    const assets = vi.fn();
    const transport = vi.fn();
    const response = await handleRequest(new Request(`https://venfour.com${path}`), publicEnv(assets), dependencies(transport));
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(assets).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("permanently redirects www once and rejects the app host and mutations", async () => {
    const assets = vi.fn();
    const env = publicEnv(assets);
    const redirected = await handleRequest(new Request("https://www.venfour.com/terms?source=footer"), env);
    expect(redirected.status).toBe(308);
    expect(redirected.headers.get("location")).toBe("https://venfour.com/terms?source=footer");
    expect((await handleRequest(new Request("https://app.venfour.com/"), env)).status).toBe(421);
    expect((await handleRequest(new Request("https://venfour.com/webhooks/stripe", { method: "POST", body: "{}" }), env)).status).toBe(405);
    expect(assets).not.toHaveBeenCalled();
  });

  it.each(["http://venfour.com", "http://www.venfour.com"])("redirects %s directly to the HTTPS canonical page", async origin => {
    const assets = vi.fn();
    const transport = vi.fn();
    const response = await handleRequest(new Request(`${origin}/terms?source=footer`), publicEnv(assets), dependencies(transport));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://venfour.com/terms?source=footer");
    expect(assets).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("staging Worker boundary", () => {
  it("allows reviewed Stripe payment sources without broadening script or frame access", async () => {
    const response = await handleRequest(new Request(`${STAGING_ORIGIN}/total-loss/cases/example/claim/checkout`), createEnv());
    const directives = Object.fromEntries(response.headers.get("content-security-policy")!.split(";").map(item => {
      const [name, ...sources] = item.trim().split(/\s+/u);
      return [name, sources];
    }));
    expect(directives["script-src"]).toEqual(["'self'", "https://challenges.cloudflare.com", "https://js.stripe.com", "https://*.js.stripe.com"]);
    expect(directives["frame-src"]).toEqual(["'self'", "https://challenges.cloudflare.com", "https://js.stripe.com", "https://*.js.stripe.com", "https://hooks.stripe.com"]);
    expect(directives["form-action"]).toEqual(["'self'"]);
    expect(directives["frame-ancestors"]).toEqual(["'none'"]);
    expect(directives["object-src"]).toEqual(["'none'"]);
  });

  it("fails closed for invalid configuration and an unexpected host", async () => {
    const invalid = await handleRequest(new Request(`${STAGING_ORIGIN}/`), {
      ...createEnv(),
      DEPLOYMENT_ENVIRONMENT: "production",
    });
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
    expect(html.headers.get("content-security-policy")).toContain(
      "frame-src 'self' https://challenges.cloudflare.com",
    );
    expect(html.headers.get("content-security-policy")).toContain(
      "script-src 'self' https://challenges.cloudflare.com",
    );
    expect(assets).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `${STAGING_ORIGIN}/analysis/example?from=staging`,
      }),
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
    const upstreamFetch = vi.fn(
      async (request: Request, init?: RequestInit) => {
        capturedRequest = request;
        capturedInit = init;
        const headers = new Headers({
          "Access-Control-Allow-Origin": "https://unexpected.example",
          "Content-Length": "999",
          "Content-Type": "text/plain; charset=utf-8",
          Location: "/api/v1/cases/example",
          "Retry-After": "30",
          "Set-Cookie":
            "api_session=test-value; Secure; HttpOnly; SameSite=Lax",
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
      },
    );
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
    expect(capturedRequest?.headers.get("content-type")).toBe(
      "application/json",
    );
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
    expect(response.headers.has("content-length")).toBe(false);
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

  it("proxies only the exact Stripe webhook POST with its raw body and signature", async () => {
    const rawBody = new Uint8Array([
      123, 34, 105, 100, 34, 58, 34, 101, 118, 116, 95, 49, 34, 44, 34, 120,
      34, 58, 34, 92, 117, 48, 48, 101, 57, 34, 125, 10,
    ]);
    const signature = "t=1787750400,v1=0123456789abcdef";
    let capturedRequest: Request | undefined;
    const upstreamFetch = vi.fn(async (request: Request) => {
      capturedRequest = request;
      return Response.json({ received: true });
    });

    const response = await handleRequest(
      new Request(`${STAGING_ORIGIN}/webhooks/stripe?source=stripe`, {
        body: rawBody,
        headers: {
          "Content-Type": "application/json",
          "Stripe-Signature": signature,
          "X-Venfour-Staging-Proxy": "attacker-controlled-value",
        },
        method: "POST",
      }),
      createEnv(),
      dependencies(upstreamFetch as unknown as typeof fetch),
    );

    expect(response.status).toBe(200);
    expect(capturedRequest?.url).toBe(
      `${API_ORIGIN}/webhooks/stripe?source=stripe`,
    );
    expect(capturedRequest?.method).toBe("POST");
    expect(capturedRequest?.headers.get("stripe-signature")).toBe(signature);
    expect(capturedRequest?.headers.get("content-type")).toBe(
      "application/json",
    );
    expect(capturedRequest?.headers.get("content-length")).toBeNull();
    expect(capturedRequest?.headers.get("x-venfour-staging-proxy")).toBe(
      API_PROXY_SECRET,
    );
    expect(
      Array.from(new Uint8Array(await capturedRequest!.arrayBuffer())),
    ).toEqual(Array.from(rawBody));
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
  });

  it("fails closed before assets for a non-POST exact Stripe webhook path", async () => {
    const assets = vi.fn(async () => new Response("asset"));
    const upstreamFetch = vi.fn(async () => new Response("upstream"));

    const response = await handleRequest(
      new Request(`${STAGING_ORIGIN}/webhooks/stripe`),
      createEnv(assets),
      dependencies(upstreamFetch as unknown as typeof fetch),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(assets).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("preserves a rejected webhook signature response and never turns it into SPA success", async () => {
    const assets = vi.fn(async () => new Response("asset"));
    let capturedRequest: Request | undefined;
    const upstreamFetch = vi.fn(async (request: Request) => {
      capturedRequest = request;
      return new Response(JSON.stringify({ error: { code: "INVALID_STRIPE_WEBHOOK" } }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    });
    const response = await handleRequest(new Request(`${STAGING_ORIGIN}/webhooks/stripe`, {
      method: "POST", body: "{}", headers: { "Content-Type": "application/json", "Stripe-Signature": "invalid-signature" },
    }), createEnv(assets), dependencies(upstreamFetch as unknown as typeof fetch));
    expect(capturedRequest?.headers.get("stripe-signature")).toBe("invalid-signature");
    expect(capturedRequest?.headers.get("x-venfour-staging-proxy")).toBe(API_PROXY_SECRET);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "INVALID_STRIPE_WEBHOOK" } });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(assets).not.toHaveBeenCalled();
  });

  it.each([
    ["POST", "/webhooks/stripe/"],
    ["POST", "/webhooks/stripe-events"],
    ["POST", "/webhooks/other"],
  ])("does not proxy the non-matching webhook route %s %s", async (method, path) => {
    const assets = vi.fn(async () => new Response("asset"));
    const upstreamFetch = vi.fn(async () => new Response("upstream"));

    const response = await handleRequest(
      new Request(`${STAGING_ORIGIN}${path}`, { method }),
      createEnv(assets),
      dependencies(upstreamFetch as unknown as typeof fetch),
    );

    expect(await response.text()).toBe("asset");
    expect(assets).toHaveBeenCalledOnce();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each(COMPRESSED_RESPONSE_FIXTURES)(
    "preserves an unread $encoding representation without stale transport length",
    async ({ body, encoding }) => {
      const encodedBody = new Uint8Array(body);
      const upstreamFetch = vi.fn(
        async () =>
          new Response(encodedBody, {
            headers: {
              "Cache-Control": "public, max-age=600",
              "Content-Encoding": encoding,
              "Content-Length": String(encodedBody.byteLength),
              "Content-Type": "application/json",
              Vary: "Accept-Encoding",
            },
          }),
      );

      const response = await handleRequest(
        new Request(`${STAGING_ORIGIN}/api/v1/compressed`),
        createEnv(),
        dependencies(upstreamFetch as unknown as typeof fetch),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-encoding")).toBe(encoding);
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(response.headers.get("vary")).toBe("Accept-Encoding");
      expect(response.headers.has("content-length")).toBe(false);
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0",
      );
      expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(
        Array.from(encodedBody),
      );
    },
  );

  it("preserves JSON error statuses and forces every API response to no-store", async () => {
    for (const status of [401, 403, 500]) {
      const upstreamFetch = vi.fn(async () =>
        Response.json(
          { error: { code: `UPSTREAM_${status}` } },
          {
            headers: { "Cache-Control": "public, max-age=600" },
            status,
          },
        ),
      );

      const response = await handleRequest(
        new Request(`${STAGING_ORIGIN}/api/v1/status/${status}`),
        createEnv(),
        dependencies(upstreamFetch as unknown as typeof fetch),
      );

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: { code: `UPSTREAM_${status}` },
      });
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0",
      );
    }
  });

  it("preserves an empty 204 response without copying an upstream length", async () => {
    const upstreamFetch = vi.fn(
      async () =>
        new Response(null, {
          headers: {
            "Content-Length": "97",
            ETag: '"empty-response"',
          },
          status: 204,
        }),
    );

    const response = await handleRequest(
      new Request(`${STAGING_ORIGIN}/api/v1/empty`),
      createEnv(),
      dependencies(upstreamFetch as unknown as typeof fetch),
    );

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(response.headers.get("etag")).toBe('"empty-response"');
    expect(response.headers.has("content-length")).toBe(false);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
  });

  it("proxies health checks and does not require Access headers inside the Worker", async () => {
    const upstreamFetch = vi.fn(
      async () =>
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
      dependencies(
        vi.fn(async () =>
          Promise.reject(new Error("offline")),
        ) as unknown as typeof fetch,
      ),
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

function productionEnv(assetFetch?: (request: Request) => Promise<Response>): Env {
  const env = createEnv(assetFetch);
  delete env.STAGING_HOSTNAME;
  return { ...env, API_ORIGIN: "https://production-api.example.test", DEPLOYMENT_ENVIRONMENT: "production" };
}

describe("production Worker boundary", () => {
  it("allows only the dedicated sign-in document to be framed by public hosts", async () => {
    const assets = async () => new Response("sign in", { headers: { "Content-Type": "text/html" } });
    const response = await handleRequest(new Request("https://app.venfour.com/auth/sign-in?parentOrigin=https%3A%2F%2Fvenfour.com"), productionEnv(assets));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors https://venfour.com https://www.venfour.com;");
    expect(response.headers.has("x-frame-options")).toBe(false);
    expect(response.headers.get("cache-control")).toContain("no-store");
    for (const path of ["/app", "/auth/callback", "/auth/sign-in/", "/auth/sign-in/other", "/total-loss/cases/example"]) {
      const protectedResponse = await handleRequest(new Request(`https://app.venfour.com${path}`), productionEnv(assets));
      expect(protectedResponse.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(protectedResponse.headers.get("x-frame-options")).toBe("DENY");
    }
    const partner = await handleRequest(new Request("https://partners.venfour.com/auth/sign-in"), productionEnv(assets));
    expect(partner.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
  it.each(["https://venfour.com", "https://www.venfour.com", "https://preview.venfour.com", "https://staging.venfour.com", "https://app.venfour.com:8443", "http://app.venfour.com", "http://venfour.com", "https://app.venfour.com.attacker.test"])("rejects the unconfigured origin %s before assets or transport", async (origin) => {
    const assets = vi.fn(async () => new Response("asset"));
    const upstreamFetch = vi.fn(async () => Response.json({ ok: true }));
    for (const [path, method] of [["/", "GET"], ["/assets/index-AbCd1234.js", "GET"], ["/auth/callback?code=proof", "GET"], ["/health", "GET"], ["/api/v1/cases", "POST"], ["/webhooks/stripe", "POST"]]) {
      const response = await handleRequest(new Request(`${origin}${path}`, { method }), productionEnv(assets), dependencies(upstreamFetch as unknown as typeof fetch));
      expect(response.status).toBe(421);
      expect(response.headers.has("location")).toBe(false);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("x-robots-tag")).toContain("noindex");
    }
    expect(assets).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each(["", API_ORIGIN, "https://app.venfour.com", "https://venfour.com", "https://www.venfour.com"])("fails closed for a missing, staging, or recursive production API origin", async (apiOrigin) => {
    const response = await handleRequest(new Request("https://app.venfour.com/"), { ...productionEnv(), API_ORIGIN: apiOrigin });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it.each(["/contact", "/cookies", "/methodology", "/privacy", "/terms/", "/refund-policy", "/refund-policy/", "/referral-partners"])("directs public page %s to the canonical public website", async (path) => {
    const assets = vi.fn(async () => new Response("asset"));
    const response = await handleRequest(new Request(`https://app.venfour.com${path}?from=app`), productionEnv(assets));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(`https://venfour.com${path}?from=app`);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(assets).not.toHaveBeenCalled();
  });

  it.each(["/", "/app", "/history", "/admin", "/partners", "/start?service=total-loss", "/total-loss/cases/case-id/claim/checkout?checkout=success&session_id=session-id"])("retains application path %s for private workspace routing", async (path) => {
    const assets = vi.fn(async () => new Response("app", { headers: { "Content-Type": "text/html" } }));
    const response = await handleRequest(new Request(`https://app.venfour.com${path}`), productionEnv(assets));
    expect(response.status).toBe(200);
    expect(response.headers.has("location")).toBe(false);
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(assets).toHaveBeenCalledWith(expect.objectContaining({ url: `https://app.venfour.com${path}` }));
  });

  it("keeps the application PKCE callback on its issuing host", async () => {
    const assets = vi.fn(async () => new Response("callback", { headers: { "Content-Type": "text/html" } }));
    const response = await handleRequest(new Request("https://app.venfour.com/auth/callback?code=proof&next=%2Fapp"), productionEnv(assets));
    expect(response.status).toBe(200);
    expect(response.headers.has("location")).toBe(false);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(assets).toHaveBeenCalledOnce();
  });

  it("preserves same-origin authenticated application API requests", async () => {
    let captured: Request | undefined;
    const upstreamFetch = vi.fn(async (request: Request) => { captured = request; return Response.json({ ok: true }); });
    const request = new Request("https://app.venfour.com/api/v1/cases?limit=1", { method: "POST", body: "{}", headers: { "Content-Type": "application/json", Origin: "https://app.venfour.com", Authorization: "Bearer owner", "X-Venfour-Staging-Proxy": "untrusted" } });
    const response = await handleRequest(request, productionEnv(), dependencies(upstreamFetch as unknown as typeof fetch));
    expect(response.status).toBe(200);
    expect(captured?.url).toBe("https://production-api.example.test/api/v1/cases?limit=1");
    expect(Object.fromEntries(captured!.headers)).toMatchObject({ authorization: "Bearer owner" });
    expect(captured?.headers.get("x-venfour-staging-proxy")).toBe(API_PROXY_SECRET);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
  });

  it.each([["Origin", "https://attacker.test"], ["Origin", "https://venfour.com"], ["Origin", "null"], ["Sec-Fetch-Site", "cross-site"]])("rejects cross-origin API access before transport: %s %s", async (header, value) => {
    const upstreamFetch = vi.fn(async () => Response.json({ ok: true }));
    const response = await handleRequest(new Request("https://app.venfour.com/api/v1/cases", { method: "POST", body: "{}", headers: { [header]: value } }), productionEnv(), dependencies(upstreamFetch as unknown as typeof fetch));
    expect(response.status).toBe(403);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("exempts only the exact application Stripe webhook from browser-origin checks", async () => {
    let captured: Request | undefined;
    const upstreamFetch = vi.fn(async (request: Request) => { captured = request; return Response.json({ error: { code: "INVALID_STRIPE_WEBHOOK" } }, { status: 400 }); });
    const response = await handleRequest(new Request("https://app.venfour.com/webhooks/stripe", { method: "POST", body: '{"id":"evt_fixture"}\n', headers: { "Content-Type": "application/json", Origin: "https://stripe.com", "Stripe-Signature": "invalid" } }), productionEnv(), dependencies(upstreamFetch as unknown as typeof fetch));
    expect(response.status).toBe(400);
    expect(await captured?.text()).toBe('{"id":"evt_fixture"}\n');
    expect(captured?.headers.get("stripe-signature")).toBe("invalid");
    for (const url of ["https://app.venfour.com/webhooks/stripe/", "https://app.venfour.com/webhooks/stripe/child", "https://app.venfour.com/webhooks/stripe-extra", "https://app.venfour.com/internal/v1/work-items/id/execute"]) {
      const blocked = await handleRequest(new Request(url, { method: "POST" }), productionEnv(), dependencies(upstreamFetch as unknown as typeof fetch));
      expect(blocked.status).toBe(404);
    }
    expect(upstreamFetch).toHaveBeenCalledOnce();
    expect((await handleRequest(new Request("https://app.venfour.com/webhooks/stripe"), productionEnv())).status).toBe(405);
  });

  it("serves application assets and keeps app robots private", async () => {
    const assets = vi.fn(async () => new Response("asset", { headers: { "Content-Type": "text/javascript" } }));
    const asset = await handleRequest(new Request("https://app.venfour.com/assets/index-AbCd1234.js"), productionEnv(assets));
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");
    const robots = await handleRequest(new Request("https://app.venfour.com/robots.txt"), productionEnv());
    expect(await robots.text()).toContain("Disallow: /");
    const invalidMethod = await handleRequest(new Request("https://app.venfour.com/start", { method: "POST" }), productionEnv());
    expect(invalidMethod.status).toBe(405);
  });
});


describe("partner domain and readable referral redirects", () => {
  const production = () => ({ ...createEnv(), STAGING_HOSTNAME: undefined, API_ORIGIN: "https://api.production.example", DEPLOYMENT_ENVIRONMENT: "production" } as Env);
  it.each(["/", "/sign-in", "/earnings", "/invitations/saved"])("serves private partner page %s", async path => {
    const response = await handleRequest(new Request(`https://partners.venfour.com${path}`), production());
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });
  it("keeps partner callbacks on their issuing origin and rejects cross-origin API calls", async () => {
    const callback = await handleRequest(new Request("https://partners.venfour.com/auth/callback?code=example"), production());
    expect(callback.status).toBe(200); expect(callback.headers.get("location")).toBeNull();
    expect(callback.headers.get("referrer-policy")).toBe("no-referrer");
    const fetch = vi.fn(async () => new Response('{}'));
    const response = await handleRequest(new Request("https://partners.venfour.com/api/v1/partners/operations", { method: "POST", headers: { Origin: "https://app.venfour.com" } }), production(), dependencies(fetch));
    expect(response.status).toBe(403); expect(fetch).not.toHaveBeenCalled();
    const sameOrigin = await handleRequest(new Request("https://partners.venfour.com/api/v1/partners/operations", { method: "POST", headers: { Origin: "https://partners.venfour.com" } }), production(), dependencies(fetch));
    expect(sameOrigin.status).toBe(200); expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(["/api/v1/staff/referral-partners/access", "/api/v1/appraisal-cases", "/api/v1/partners/../staff/referral-partners/access", "/api/v1/partners/%2e%2e%2fstaff/referral-partners/access", "/api/v1/partners/operations/extra", "/webhooks/stripe", "/admin", "/admin/referral-partners"])("does not expose application-only path %s through the partner host", async path => {
    const fetch = vi.fn();
    const response = await handleRequest(new Request(`https://partners.venfour.com${path}`, { method: "POST" }), production(), dependencies(fetch));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["/health", "/api/v1/partners/access", "/api/v1/partners/agreements/11111111-1111-4111-8111-111111111111/document"])("retains shared backend connectivity for %s", async path => {
    const fetch = vi.fn(async () => new Response('{}'));
    const response = await handleRequest(new Request(`https://partners.venfour.com${path}`), production(), dependencies(fetch));
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(["/r/ozark-auto", `/r/${"a".repeat(48)}`, "/admin/partners/ozark-auto"])("routes public %s into the authenticated application without exposing data", async path => {
    const fetch = vi.fn();
    const response = await handleRequest(new Request(`https://venfour.com${path}?source=print`), { DEPLOYMENT_ENVIRONMENT: "public-site", ASSETS: { fetch } as unknown as Fetcher });
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(`https://app.venfour.com${path}?source=print`);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("search destination and optional advertising boundary", () => {
  const env = (enabled = false): Env => ({
    DEPLOYMENT_ENVIRONMENT: "public-site", GOOGLE_ADS_MEASUREMENT: String(enabled),
    ASSETS: { fetch: vi.fn(async () => new Response("landing", { headers: { "Content-Type": "text/html" } })) } as unknown as Fetcher,
  });
  it("serves the dedicated landing HTML and allows indexing", async () => {
    const config = env();
    const response = await handleRequest(new Request("https://venfour.com/total-loss-review?gclid=unit_test"), config);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Robots-Tag")).toBeNull();
    expect(new URL(vi.mocked(config.ASSETS.fetch).mock.calls[0][0] instanceof Request ? (vi.mocked(config.ASSETS.fetch).mock.calls[0][0] as Request).url : "https://invalid.test").pathname).toBe("/total-loss-review.html");
    expect(response.headers.get("Content-Security-Policy")).not.toContain("googletagmanager");
  });
  it("publishes the landing in a public sitemap", async () => {
    const response = await handleRequest(new Request("https://venfour.com/sitemap.xml"), env());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<loc>https://venfour.com/total-loss-review</loc>");
    const robots = await handleRequest(new Request("https://venfour.com/robots.txt"), env());
    expect(await robots.text()).toContain("Sitemap: https://venfour.com/sitemap.xml");
  });
  it("adds exact Google origins only when explicitly configured without permitting unsafe scripts", async () => {
    const response = await handleRequest(new Request("https://venfour.com/total-loss-review"), env(true));
    const csp = response.headers.get("Content-Security-Policy")!;
    expect(csp).toContain("https://www.googletagmanager.com");
    expect(csp).toContain("script-src 'self' https://www.googletagmanager.com https://www.googleadservices.com https://www.google.com;");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
  it("redirects the customer-host landing to its canonical public route", async () => {
    const config = { ...createEnv(), DEPLOYMENT_ENVIRONMENT: "production", API_ORIGIN: "https://venfour-api-production-usmgwdpgqq-uk.a.run.app", STAGING_HOSTNAME: undefined };
    const response = await handleRequest(new Request("https://app.venfour.com/total-loss-review"), config);
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe("https://venfour.com/total-loss-review");
  });
});
