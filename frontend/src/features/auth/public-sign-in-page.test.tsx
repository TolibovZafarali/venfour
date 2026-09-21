import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderTestApp } from "@/test/render";
import { appleSession } from "@/test/fixtures/apple-session";
import type { AuthService } from "./auth-service";
import { PUBLIC_SIGN_IN_MESSAGE } from "./public-sign-in";

const email = "owner@example.com";
function setup(embedded = true, provider = "") {
  const postMessage = vi.fn();
  if (embedded) vi.stubGlobal("parent", { postMessage });
  const session = appleSession(email);
  const service: AuthService = {
    getSession: vi.fn(async () => null),
    onAuthStateChange: () => () => {},
    signInWithGoogle: vi.fn(async () => {}),
    signInWithApple: vi.fn(async () => {}),
    sendMagicLink: vi.fn(async () => {}),
    sendEmailCode: vi.fn(async () => {}),
    verifyEmailCode: vi.fn(async () => session),
    verifyEmailOtp: vi.fn(async () => session),
    exchangeCodeForSession: vi.fn(async () => session),
    signOut: vi.fn(async () => {}),
  };
  renderTestApp([`/auth/sign-in?parentOrigin=https%3A%2F%2Fvenfour.com&provider=${provider}`], {
    authService: service,
    authTurnstileController: { runWithToken: (_action, operation) => operation("test-token") },
    strictMode: true,
  });
  return { postMessage, service };
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

  it.each(["google", "apple"])("starts the selected %s flow once on the top-level application page", async provider => {
    const { service } = setup(false, provider);
    await waitFor(() => expect(provider === "google" ? service.signInWithGoogle : service.signInWithApple).toHaveBeenCalledOnce());
    expect(provider === "google" ? service.signInWithApple : service.signInWithGoogle).not.toHaveBeenCalled();
  });
});
