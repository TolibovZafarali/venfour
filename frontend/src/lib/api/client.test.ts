import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "@/lib/api/client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("API client authentication", () => {
  it("adds the bearer token to authenticated GET and POST requests", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => jsonResponse({ ok: true }));
    const client = createApiClient({
      baseUrl: "https://api.example.test",
      fetchImplementation,
    });

    await client.getAuthenticated("/secure", {
      accessToken: "access-token",
    });
    await client.postAuthenticated("/secure", {
      accessToken: "access-token",
    });

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchImplementation.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(headers.get("Accept")).toBe("application/json");
      expect(headers.get("Authorization")).toBe("Bearer access-token");
    }
    expect(fetchImplementation.mock.calls[0]?.[1]?.method).toBe("GET");
    expect(fetchImplementation.mock.calls[1]?.[1]?.method).toBe("POST");
  });

  it("keeps public requests unauthenticated and propagates abort signals", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ ok: true }));
    const client = createApiClient({
      baseUrl: "https://api.example.test",
      fetchImplementation,
    });
    const controller = new AbortController();

    await client.get("/health", controller.signal);

    const init = fetchImplementation.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    expect(init?.signal).toBe(controller.signal);
  });

  it("posts public JSON without authorization and preserves its abort signal", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ status: "accepted" }, 202));
    const client = createApiClient({
      baseUrl: "https://api.example.test",
      fetchImplementation,
    });
    const controller = new AbortController();

    await client.postJson(
      "/recovery",
      { email: "owner@example.com", turnstileToken: "turnstile-token" },
      { signal: controller.signal },
    );

    const init = fetchImplementation.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(init?.method).toBe("POST");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.has("Authorization")).toBe(false);
    expect(init?.signal).toBe(controller.signal);
    expect(init?.body).toBe(
      JSON.stringify({
        email: "owner@example.com",
        turnstileToken: "turnstile-token",
      }),
    );
  });

  it("rejects a blank token before issuing a request", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const client = createApiClient({
      baseUrl: "https://api.example.test",
      fetchImplementation,
    });

    await expect(
      client.getAuthenticated("/secure", { accessToken: "   " }),
    ).rejects.toThrow("An access token is required");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
