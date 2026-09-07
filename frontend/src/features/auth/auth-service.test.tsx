import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { StrictMode } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, test, vi } from "vitest";

import { AuthCallbackPage } from "@/features/auth/auth-callback-page";
import { AuthProvider } from "@/features/auth/auth-provider";
import { createSupabaseAuthService } from "@/features/auth/auth-service";
import { storeAuthReturnLocation } from "@/features/auth/return-location";
import { createSupabaseClientState } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { server } from "@/test/mocks/server";
import { appleSession } from "@/test/fixtures/apple-session";

const SUPABASE_URL = "https://auth-integration.supabase.co";
const SUPABASE_STORAGE_KEY = "sb-auth-integration-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ANONYMOUS_USER_ID = "22222222-2222-4222-8222-222222222222";

const authResponse = {
  access_token: "test-access-token",
  expires_in: 3600,
  refresh_token: "test-refresh-token",
  token_type: "bearer",
  user: {
    app_metadata: { provider: "email", providers: ["email"] },
    aud: "authenticated",
    confirmed_at: "2026-08-18T18:00:00.000Z",
    created_at: "2026-08-18T17:51:46.000Z",
    email: "owner@example.com",
    email_confirmed_at: "2026-08-18T18:00:00.000Z",
    id: USER_ID,
    identities: [],
    is_anonymous: false,
    last_sign_in_at: "2026-08-18T18:00:00.000Z",
    phone: "",
    role: "authenticated",
    updated_at: "2026-08-18T18:00:00.000Z",
    user_metadata: {},
  },
};

const anonymousAuthResponse = {
  access_token: "anonymous-access-token",
  expires_in: 3600,
  refresh_token: "anonymous-refresh-token",
  token_type: "bearer",
  user: {
    app_metadata: { provider: "anonymous", providers: [] },
    aud: "authenticated",
    created_at: "2026-08-23T18:00:00.000Z",
    id: ANONYMOUS_USER_ID,
    identities: [],
    is_anonymous: true,
    last_sign_in_at: "2026-08-23T18:00:00.000Z",
    phone: "",
    role: "authenticated",
    updated_at: "2026-08-23T18:00:00.000Z",
    user_metadata: {},
  },
};

describe("Supabase auth service", () => {
  test.each(["apple", "google"] as const)(
    "starts %s through Supabase OAuth and propagates errors",
    async (provider) => {
      const failure = new Error("Provider unavailable");
      const signInWithOAuth = vi
        .fn()
        .mockResolvedValueOnce({ error: null })
        .mockResolvedValueOnce({ error: failure });
      const service = createSupabaseAuthService({
        auth: { signInWithOAuth },
      } as unknown as SupabaseClient<Database>);
      const signIn =
        provider === "apple"
          ? service.signInWithApple
          : service.signInWithGoogle;
      const redirectTo = `${window.location.origin}/auth/callback`;
      await signIn(redirectTo);
      expect(signInWithOAuth).toHaveBeenCalledWith({
        provider,
        options: { redirectTo },
      });
      await expect(signIn(redirectTo)).rejects.toBe(failure);
    },
  );

  test.each(["owner@example.com", "private-owner@privaterelay.appleid.com"])(
    "exchanges Apple PKCE, persists, signs out, and signs back into the same user for %s without name metadata",
    async (email) => {
      const response = appleSession(email);
      const tokenBodies: unknown[] = [];
      server.use(
        http.post(`${SUPABASE_URL}/auth/v1/token`, async ({ request }) => {
          expect(new URL(request.url).searchParams.get("grant_type")).toBe(
            "pkce",
          );
          tokenBodies.push(await request.json());
          return HttpResponse.json(response);
        }),
        http.post(
          `${SUPABASE_URL}/auth/v1/logout`,
          () => new HttpResponse(null, { status: 204 }),
        ),
      );
      const state = createSupabaseClientState({
        url: SUPABASE_URL,
        publishableKey: "sb_publishable_auth_integration_test",
      });
      if (state.status !== "available") throw new Error(state.reason);
      const { client } = state;
      const service = createSupabaseAuthService(client);
      const startOAuth = client.auth.signInWithOAuth.bind(client.auth);
      let authorizeUrl = "";
      vi.spyOn(client.auth, "signInWithOAuth").mockImplementation(
        async (credentials) => {
          const result = await startOAuth({
            ...credentials,
            options: { ...credentials.options, skipBrowserRedirect: true },
          });
          authorizeUrl = result.data.url ?? "";
          return result;
        },
      );
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          await service.signInWithApple(
            `${window.location.origin}/auth/callback`,
          );
          const authorize = new URL(authorizeUrl);
          expect(authorize.searchParams.get("provider")).toBe("apple");
          expect(authorize.searchParams.get("code_challenge_method")).toBe(
            "s256",
          );
          const redirect = new URL(
            authorize.searchParams.get("redirect_to") ?? "",
          );
          expect(redirect.pathname).toBe("/auth/callback");
          const session = await service.exchangeCodeForSession(
            `apple-code-${attempt}`,
            redirect.searchParams.get("sb_flow_id") ?? undefined,
          );
          expect(tokenBodies[attempt]).toEqual({
            auth_code: `apple-code-${attempt}`,
            code_verifier: expect.any(String),
          });
          expect(session.user.id).toBe(USER_ID);
          expect(session.user.email).toBe(email);
          expect(session.user.user_metadata.full_name).toBeUndefined();
          expect(session.user.identities?.[0].provider).toBe("apple");
          expect((await service.getSession())?.user.id).toBe(USER_ID);
          expect(
            JSON.parse(
              window.localStorage.getItem(SUPABASE_STORAGE_KEY) ?? "null",
            ).user.email,
          ).toBe(email);
          await service.signOut();
          expect(await service.getSession()).toBeNull();
          expect(window.localStorage.getItem(SUPABASE_STORAGE_KEY)).toBeNull();
        }
      } finally {
        await client.auth.stopAutoRefresh();
      }
    },
  );

  test("restores a captured session through Supabase setSession", async () => {
    const session = anonymousAuthResponse as Session;
    const setSession = vi.fn(async () => ({
      data: { session, user: session.user },
      error: null,
    }));
    const client = {
      auth: { setSession },
    } as unknown as SupabaseClient<Database>;
    const service = createSupabaseAuthService(client);

    if (!service.restoreSession) {
      throw new Error("Session restoration was not configured.");
    }
    await expect(service.restoreSession(session)).resolves.toBe(session);
    expect(setSession).toHaveBeenCalledWith({
      access_token: "anonymous-access-token",
      refresh_token: "anonymous-refresh-token",
    });
  });

  test("creates and persists an anonymous authenticated session", async () => {
    let signupRequestBody: unknown;
    server.use(
      http.post(`${SUPABASE_URL}/auth/v1/signup`, async ({ request }) => {
        signupRequestBody = await request.json();
        return HttpResponse.json(anonymousAuthResponse);
      }),
    );

    const clientState = createSupabaseClientState({
      url: SUPABASE_URL,
      publishableKey: "sb_publishable_auth_integration_test",
    });
    expect(clientState.status).toBe("available");
    if (clientState.status !== "available") {
      throw new Error(clientState.reason);
    }

    const { client } = clientState;
    const service = createSupabaseAuthService(client);

    try {
      if (!service.signInAnonymously) {
        throw new Error("Anonymous auth support was not configured.");
      }
      const session = await service.signInAnonymously(
        "anonymous-turnstile-token",
      );

      expect(signupRequestBody).toEqual(
        expect.objectContaining({
          data: {},
          gotrue_meta_security: {
            captcha_token: "anonymous-turnstile-token",
          },
        }),
      );
      expect(session.user.id).toBe(ANONYMOUS_USER_ID);
      expect(session.user.is_anonymous).toBe(true);
      expect(
        JSON.parse(window.localStorage.getItem(SUPABASE_STORAGE_KEY) ?? "null"),
      ).toEqual(
        expect.objectContaining({ access_token: "anonymous-access-token" }),
      );
    } finally {
      await client.auth.stopAutoRefresh();
    }
  });

  test("sends and verifies email codes for new and returning users using the existing session", async () => {
    const sendBodies: unknown[] = [];
    const verifyBodies: unknown[] = [];
    server.use(
      http.post(`${SUPABASE_URL}/auth/v1/otp`, async ({ request }) => {
        sendBodies.push(await request.json());
        expect(new URL(request.url).searchParams.get("redirect_to")).toBe(`${window.location.origin}/auth/callback`);
        return HttpResponse.json({});
      }),
      http.post(`${SUPABASE_URL}/auth/v1/verify`, async ({ request }) => {
        verifyBodies.push(await request.json());
        return HttpResponse.json(authResponse);
      }),
      http.post(`${SUPABASE_URL}/auth/v1/logout`, () => new HttpResponse(null, { status: 204 })),
    );
    const state = createSupabaseClientState({ url: SUPABASE_URL, publishableKey: "sb_publishable_auth_integration_test" });
    if (state.status !== "available") throw new Error(state.reason);
    const service = createSupabaseAuthService(state.client);
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await service.sendEmailCode("owner@example.com", `${window.location.origin}/auth/callback`, "captcha-token");
        expect(await service.getSession()).toBeNull();
        expect(sendBodies[attempt]).toMatchObject({ email: "owner@example.com", create_user: true, gotrue_meta_security: { captcha_token: "captcha-token" } });
        const session = await service.verifyEmailCode("owner@example.com", "123456");
        expect(verifyBodies[attempt]).toMatchObject({ email: "owner@example.com", token: "123456", type: "email" });
        expect(verifyBodies[attempt]).not.toHaveProperty("token_hash");
        expect(session.user.id).toBe(USER_ID);
        expect((await service.getSession())?.user.id).toBe(USER_ID);
        expect(JSON.parse(window.localStorage.getItem(SUPABASE_STORAGE_KEY) ?? "null").user.id).toBe(USER_ID);
        await service.signOut();
        expect(await service.getSession()).toBeNull();
      }
    } finally { await state.client.auth.stopAutoRefresh(); }
  });

  test("handles a token-hash email callback without a PKCE verifier and persists the session", async () => {
    let otpRequestBody: unknown;
    let otpRedirectTo: string | null = null;
    let verifyRequestBody: unknown;
    let verifyRequestCount = 0;

    server.use(
      http.post(`${SUPABASE_URL}/auth/v1/otp`, async ({ request }) => {
        otpRequestBody = await request.json();
        otpRedirectTo = new URL(request.url).searchParams.get("redirect_to");
        return HttpResponse.json({});
      }),
      http.post(`${SUPABASE_URL}/auth/v1/verify`, async ({ request }) => {
        verifyRequestCount += 1;
        verifyRequestBody = await request.json();
        return HttpResponse.json(authResponse);
      }),
    );

    const clientState = createSupabaseClientState({
      url: SUPABASE_URL,
      publishableKey: "sb_publishable_auth_integration_test",
    });
    expect(clientState.status).toBe("available");
    if (clientState.status !== "available") {
      throw new Error(clientState.reason);
    }

    const { client } = clientState;
    const service = createSupabaseAuthService(client);
    const callbackUrl = `${window.location.origin}/auth/callback`;

    try {
      await service.sendMagicLink(
        "owner@example.com",
        callbackUrl,
        "magic-link-turnstile-token",
      );

      expect(otpRedirectTo).toBe(callbackUrl);
      expect(otpRequestBody).toEqual(
        expect.objectContaining({
          code_challenge: expect.any(String),
          code_challenge_method: "s256",
          create_user: true,
          email: "owner@example.com",
          gotrue_meta_security: {
            captcha_token: "magic-link-turnstile-token",
          },
        }),
      );

      const pkceStorageKeys = Array.from(
        { length: window.localStorage.length },
        (_, index) => window.localStorage.key(index),
      ).filter((key): key is string => key?.includes("code-verifier") ?? false);
      expect(pkceStorageKeys.length).toBeGreaterThan(0);
      for (const key of pkceStorageKeys) {
        window.localStorage.removeItem(key);
      }

      storeAuthReturnLocation("/destination?from=email");
      const router = createMemoryRouter(
        [
          { path: "/auth/callback", element: <AuthCallbackPage /> },
          { path: "/destination", element: <h1>Destination</h1> },
        ],
        {
          initialEntries: [
            "/auth/callback?token_hash=secure-token-hash&type=email",
          ],
        },
      );

      render(
        <StrictMode>
          <AuthProvider service={service}>
            <RouterProvider router={router} />
          </AuthProvider>
        </StrictMode>,
      );

      expect(
        await screen.findByRole("heading", { name: "Destination" }),
      ).toBeVisible();
      expect(router.state.location.search).toBe("?from=email");
      expect(verifyRequestCount).toBe(1);
      expect(verifyRequestBody).toEqual(
        expect.objectContaining({
          token_hash: "secure-token-hash",
          type: "email",
        }),
      );

      const restoredSession = await service.getSession();
      expect(restoredSession?.user.id).toBe(USER_ID);
      expect(
        JSON.parse(window.localStorage.getItem(SUPABASE_STORAGE_KEY) ?? "null"),
      ).toEqual(expect.objectContaining({ access_token: "test-access-token" }));
    } finally {
      await client.auth.stopAutoRefresh();
    }
  });
});
