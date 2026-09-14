import { screen, waitFor } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "@/features/auth";
import { environment } from "@/config/env";
import { renderTestApp } from "@/test/render";

vi.mock("@/config/public-site", () => ({ publicSiteOnly: true }));

const session: Session = {
  access_token: "synthetic-token", refresh_token: "synthetic-refresh", expires_in: 3600, token_type: "bearer",
  user: { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", created_at: "2026-09-14T00:00:00Z", app_metadata: {}, user_metadata: {} },
};
function authService(value: Session | null): AuthService {
  const unexpected = async (): Promise<never> => { throw new Error("Public website must not initiate authentication."); };
  return { getSession: vi.fn(async () => value), onAuthStateChange: () => () => {},
    exchangeCodeForSession: unexpected, sendEmailCode: unexpected, verifyEmailCode: unexpected,
    sendMagicLink: unexpected, signInWithGoogle: unexpected, signInWithApple: unexpected, verifyEmailOtp: unexpected, signOut: unexpected };
}

describe("public-only launch", () => {
  it("keeps the same public content and safe header for signed-out and signed-in visitors", async () => {
    const bodies: Array<string | null> = [];
    for (const value of [null, session]) {
      const service = authService(value);
      const view = renderTestApp(["/"], { authService: service });
      await waitFor(() => expect(service.getSession).toHaveBeenCalled());
      expect(screen.getByRole("heading", { name: "Your Vehicle’s Value, Made Clear." })).toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: /Contact Venfour/ }).every(link => link.getAttribute("href") === "/contact")).toBe(true);
      expect(screen.queryByRole("link", { name: /Sign In|Open app|Admin|Account|Start Total Loss review/ })).not.toBeInTheDocument();
      expect(view.container.querySelector('a[href*="app.venfour.com"]')).toBeNull();
      expect(screen.queryByText("Available now")).not.toBeInTheDocument();
      bodies.push(view.container.querySelector("main")?.textContent ?? null);
      view.unmount();
    }
    expect(bodies[0]).toBeTruthy();
    expect(bodies[0]).toBe(bodies[1]);
    expect(environment.supabaseUrl).toBe("");
    expect(environment.supabasePublishableKey).toBe("");
    expect(environment.turnstileSiteKey).toBe("");
  });

  it.each(["/app", "/admin/cases", "/partners", "/start", "/auth/callback", "/total-loss/cases/example/analysis"])("does not mount the application route %s", path => {
    renderTestApp([path], { authService: null });
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });

  it.each(["/terms", "/privacy", "/contact", "/methodology", "/referral-partners"])("keeps %s public without a broken app link", path => {
    const { container } = renderTestApp([path], { authService: null });
    expect(screen.queryByRole("heading", { name: "Page not found" })).not.toBeInTheDocument();
    expect(container.querySelector('a[href*="app.venfour.com"],a[href^="/start"],a[href^="/partners"]')).toBeNull();
  });
});
