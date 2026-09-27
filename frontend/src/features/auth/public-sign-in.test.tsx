import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderTestApp } from "@/test/render";
import { appleSession } from "@/test/fixtures/apple-session";
import type { AuthService } from "./auth-service";
import { PUBLIC_SIGN_IN_MESSAGE } from "./public-sign-in";

const email = "owner@example.com";
function setup({
  embedded = true,
  path = "/auth/embed?parentOrigin=https%3A%2F%2Fvenfour.com",
  signedIn = false,
  oauthError = false,
  unavailable = false,
} = {}) {
  const postMessage = vi.fn();
  if (embedded) vi.stubGlobal("parent", { postMessage });
  const session = appleSession(email);
  const service: AuthService = {
    getSession: vi.fn(async () => signedIn ? session : null),
    onAuthStateChange: () => () => {},
    signInWithGoogle: vi.fn(async () => { if (oauthError) throw new Error("Sign-in failed"); }),
    signInWithApple: vi.fn(async () => { if (oauthError) throw new Error("Sign-in failed"); }),
    sendMagicLink: vi.fn(async () => {}),
    sendEmailCode: vi.fn(async () => {}),
    verifyEmailCode: vi.fn(async () => session),
    verifyEmailOtp: vi.fn(async () => session),
    exchangeCodeForSession: vi.fn(async () => session),
    signOut: vi.fn(async () => {}),
  };
  const { router } = renderTestApp([path], {
    authService: unavailable ? null : service,
    authTurnstileController: { runWithToken: (_action, operation) => operation("test-token") },
    strictMode: true,
  });
  return { postMessage, service, router };
}

afterEach(() => vi.unstubAllGlobals());

describe("public sign-in application form", () => {
  it("verifies email inside the application and sends no credentials to its parent", async () => {
    const user = userEvent.setup();
    const { postMessage, service } = setup();
    await user.type(await screen.findByRole("textbox", { name: "Email address" }), email);
    await user.click(screen.getByRole("button", { name: "Continue with Email" }));
    await waitFor(() => expect(service.sendEmailCode).toHaveBeenCalledWith(email, expect.stringContaining("/auth/callback"), "test-token"));
    await user.type(await screen.findByRole("textbox", { name: "Sign-in code" }), "12345678");
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: PUBLIC_SIGN_IN_MESSAGE, action: "complete" }, "https://venfour.com"));
    expect(service.verifyEmailCode).toHaveBeenCalledWith(email, "12345678");
    for (const [message, origin] of postMessage.mock.calls) {
      expect(Object.keys(message).sort()).toEqual(["action", "type"]);
      expect(origin).toBe("https://venfour.com");
    }
  });

  it.each(["Google", "Apple"])("hands %s off before starting OAuth outside the frame", async provider => {
    const user = userEvent.setup();
    const { postMessage, service } = setup();
    await user.click(await screen.findByRole("button", { name: `Continue with ${provider}` }));
    expect(postMessage).toHaveBeenCalledWith({ type: PUBLIC_SIGN_IN_MESSAGE, action: provider.toLowerCase() }, "https://venfour.com");
    expect(service.signInWithGoogle).not.toHaveBeenCalled();
    expect(service.signInWithApple).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(postMessage).toHaveBeenCalledWith({ type: PUBLIC_SIGN_IN_MESSAGE, action: "close" }, "https://venfour.com");
  });

  it("notifies the public modal when an existing session is found", async () => {
    const { postMessage } = setup({ signedIn: true });
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: PUBLIC_SIGN_IN_MESSAGE, action: "complete" }, "https://venfour.com"));
  });

  it.each([
    { embedded: false, path: "/auth/embed?parentOrigin=https%3A%2F%2Fvenfour.com" },
    { embedded: true, path: "/auth/embed" },
    { embedded: true, path: "/auth/embed?parentOrigin=https%3A%2F%2Fattacker.test" },
  ])("does not display the embedded form outside a trusted public modal ($path, embedded: $embedded)", async options => {
    const { postMessage, router } = setup(options);
    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
    expect(screen.queryByRole("textbox", { name: "Email address" })).not.toBeInTheDocument();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it.each(["/auth/sign-in", "/auth/sign-in?provider=google"])("removes the standalone login route %s", async path => {
    const { service } = setup({ embedded: false, path });
    expect(await screen.findByRole("heading", { name: /page not found/i })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Email address" })).not.toBeInTheDocument();
    expect(service.signInWithGoogle).not.toHaveBeenCalled();
  });
});

describe("public OAuth handoff", () => {
  it.each(["google", "apple"])("starts %s once without displaying a login page", async provider => {
    const { service } = setup({ embedded: false, path: `/auth/oauth?provider=${provider}` });
    await waitFor(() => expect(provider === "google" ? service.signInWithGoogle : service.signInWithApple).toHaveBeenCalledOnce());
    expect(provider === "google" ? service.signInWithApple : service.signInWithGoogle).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Email address" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /continue with/i })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Connecting to");
  });

  it.each([
    { embedded: true, path: "/auth/oauth?provider=google" },
    { embedded: false, path: "/auth/oauth?provider=unknown" },
    { embedded: false, path: "/auth/oauth" },
    { embedded: false, path: "/auth/oauth?provider=google", signedIn: true },
  ])("skips OAuth when it cannot be started ($path, embedded: $embedded, signedIn: $signedIn)", async options => {
    const { service, router } = setup(options);
    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
    expect(service.signInWithGoogle).not.toHaveBeenCalled();
    expect(service.signInWithApple).not.toHaveBeenCalled();
  });

  it.each(["google", "apple"])("keeps modal recovery available if %s cannot start", async provider => {
    const user = userEvent.setup();
    const { service, router } = setup({ embedded: false, path: `/auth/oauth?provider=${provider}`, oauthError: true });
    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/callback"));
    expect(await screen.findByRole("heading", { name: "We couldn’t sign you in" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try signing in again" }));
    expect(screen.getByRole("dialog", { name: "Sign in to Venfour" })).toBeVisible();
    expect(provider === "google" ? service.signInWithGoogle : service.signInWithApple).toHaveBeenCalledOnce();
  });

  it("shows existing recovery when authentication is unavailable", async () => {
    const { router, service } = setup({ embedded: false, path: "/auth/oauth?provider=google", unavailable: true });
    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/callback"));
    expect(await screen.findByRole("heading", { name: "We couldn’t sign you in" })).toBeVisible();
    expect(service.signInWithGoogle).not.toHaveBeenCalled();
  });
});
