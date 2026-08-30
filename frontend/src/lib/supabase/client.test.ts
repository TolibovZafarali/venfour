import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

const fixtures = vi.hoisted(() => ({
  environment: { localPostContinueEnabled: false, supabaseUrl: "", supabasePublishableKey: "" },
  createClient: vi.fn<(url: string, key: string, options: unknown) => unknown>(
    () => ({ auth: { setSession: vi.fn() } }),
  ),
  navigatorLock: vi.fn(),
}));

vi.mock("@/config/env", () => ({ environment: fixtures.environment }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: fixtures.createClient,
  navigatorLock: fixtures.navigatorLock,
}));

import { canInstallSessionForAnonymousOwner, createSupabaseClientState, installSessionForAnonymousOwner } from "@/lib/supabase/client";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fixtures.environment.localPostContinueEnabled = false;
  fixtures.createClient.mockClear();
});

const configuration = { url: "http://127.0.0.1:54321", publishableKey: "test-publishable-key" };

describe("local session installation configuration", () => {
  it("configures the official shared Auth lock and guarded storage only for the local flow", () => {
    fixtures.environment.localPostContinueEnabled = true;
    const request = vi.fn(async (_name, _options, action) => action());
    vi.stubGlobal("navigator", { locks: { request } });
    const state = createSupabaseClientState(configuration);
    expect(state.status).toBe("available");
    expect(fixtures.createClient).toHaveBeenCalledWith(configuration.url, configuration.publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
        persistSession: true,
        storage: expect.objectContaining({ setItem: expect.any(Function), removeItem: expect.any(Function) }),
        lock: fixtures.navigatorLock,
        lockAcquireTimeout: -1,
      },
    });
    if (state.status === "available") expect(canInstallSessionForAnonymousOwner(state.client)).toBe(true);
  });

  it("locks every actual local session storage mutation under one per-key same-origin lock", async () => {
    fixtures.environment.localPostContinueEnabled = true;
    const request = vi.fn(async (_name, _options, action) => action());
    vi.stubGlobal("navigator", { locks: { request } });
    createSupabaseClientState(configuration);
    const options = fixtures.createClient.mock.calls[0]?.[2] as unknown as {
      auth: { storage: { setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> } };
    };
    await options.auth.storage.setItem("local-auth-key", "session-value");
    await options.auth.storage.removeItem("local-auth-key");
    expect(request).toHaveBeenNthCalledWith(1, "venfour.session-write:local-auth-key", { mode: "exclusive" }, expect.any(Function));
    expect(request).toHaveBeenNthCalledWith(2, "venfour.session-write:local-auth-key", { mode: "exclusive" }, expect.any(Function));
  });

  it("preserves hosted Auth configuration unchanged", () => {
    fixtures.environment.localPostContinueEnabled = false;
    vi.stubGlobal("navigator", { locks: { request: vi.fn() } });
    const state = createSupabaseClientState(configuration);
    expect(fixtures.createClient).toHaveBeenCalledWith(configuration.url, configuration.publishableKey, {
      auth: { autoRefreshToken: true, detectSessionInUrl: false, flowType: "pkce", persistSession: true },
    });
    if (state.status === "available") expect(canInstallSessionForAnonymousOwner(state.client)).toBe(false);
  });

  it("keeps normal local Auth available but refuses OTP session installation without Web Locks", () => {
    fixtures.environment.localPostContinueEnabled = true;
    vi.stubGlobal("navigator", {});
    const state = createSupabaseClientState(configuration);
    expect(state.status).toBe("available");
    expect(fixtures.createClient).toHaveBeenCalledWith(configuration.url, configuration.publishableKey, {
      auth: { autoRefreshToken: true, detectSessionInUrl: false, flowType: "pkce", persistSession: true },
    });
    if (state.status === "available") {
      expect(canInstallSessionForAnonymousOwner(state.client)).toBe(false);
      expect(() => installSessionForAnonymousOwner(state.client, {} as Session, "guest", vi.fn()))
        .toThrow("active identity changed");
    }
  });
});
