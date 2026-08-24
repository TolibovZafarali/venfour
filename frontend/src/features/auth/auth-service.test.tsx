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
      const session = await service.signInAnonymously();

      expect(signupRequestBody).toEqual(
        expect.objectContaining({ data: {} }),
      );
      expect(session.user.id).toBe(ANONYMOUS_USER_ID);
      expect(session.user.is_anonymous).toBe(true);
      expect(
        JSON.parse(
          window.localStorage.getItem(SUPABASE_STORAGE_KEY) ?? "null",
        ),
      ).toEqual(
        expect.objectContaining({ access_token: "anonymous-access-token" }),
      );
    } finally {
      await client.auth.stopAutoRefresh();
    }
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
      await service.sendMagicLink("owner@example.com", callbackUrl);

      expect(otpRedirectTo).toBe(callbackUrl);
      expect(otpRequestBody).toEqual(
        expect.objectContaining({
          code_challenge: expect.any(String),
          code_challenge_method: "s256",
          create_user: true,
          email: "owner@example.com",
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
        JSON.parse(
          window.localStorage.getItem(SUPABASE_STORAGE_KEY) ?? "null",
        ),
      ).toEqual(expect.objectContaining({ access_token: "test-access-token" }));
    } finally {
      await client.auth.stopAutoRefresh();
    }
  });
});
