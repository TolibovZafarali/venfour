import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@supabase/supabase-js";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, test, vi } from "vitest";

import { AuthCallbackPage } from "@/features/auth/auth-callback-page";
import { storeAuthReturnLocation } from "@/features/auth/return-location";
import { AuthProvider } from "@/features/auth/auth-provider";
import type { AuthService } from "@/features/auth/auth-service";
import { SignInDialog } from "@/features/auth/sign-in-dialog";
import {
  TotalLossDependenciesProvider,
  type TotalLossDependencies,
} from "@/features/total-loss/dependencies";
import type { TotalLossIdentityService } from "@/features/total-loss/identity-service";
import { appleSession } from "@/test/fixtures/apple-session";

const EMAIL = "owner@example.com";
const CLAIM = "88888888-8888-4888-8888-888888888888";
const session = appleSession(EMAIL);

function setup(
  options: {
    service?: Partial<AuthService>;
    claim?: TotalLossIdentityService["completeIdentityClaim"];
    returnTo?: string;
    callbackPage?: boolean;
  } = {},
) {
  const service: AuthService = {
    getSession: vi.fn(async () => null),
    onAuthStateChange: () => () => undefined,
    restoreSession: vi.fn(async (value) => value),
    signInWithGoogle: vi.fn(async () => undefined),
    signInWithApple: vi.fn(async () => undefined),
    sendMagicLink: vi.fn(async () => undefined),
    sendEmailCode: vi.fn(async () => undefined),
    verifyEmailCode: vi.fn(async () => session),
    verifyEmailOtp: vi.fn(async () => session),
    exchangeCodeForSession: vi.fn(async () => session),
    signOut: vi.fn(async () => undefined),
    ...options.service,
  };
  const close = vi.fn();
  const router = createMemoryRouter(
    [
      { path: "/auth/callback/case-claim/:id", element: <AuthCallbackPage /> },
      {
        path: "/",
        element: (
          <SignInDialog
            open
            onOpenChange={close}
            returnTo={options.returnTo ?? "/saved-case?step=review#documents"}
            callbackParameters={
              options.claim ? { case_claim: CLAIM } : undefined
            }
          />
        ),
      },
      { path: "*", element: <h1>Signed in destination</h1> },
    ],
    {
      initialEntries: options.callbackPage
        ? [`/auth/callback/case-claim/${CLAIM}`]
        : ["/"],
    },
  );
  render(
    <AuthProvider service={service}>
      <TotalLossDependenciesProvider
        dependencies={
          options.claim
            ? ({
                totalLossIdentityService: {
                  completeIdentityClaim: options.claim,
                },
              } as unknown as TotalLossDependencies)
            : null
        }
      >
        <RouterProvider router={router} />
      </TotalLossDependenciesProvider>
    </AuthProvider>,
  );
  return { service, close, router };
}

async function requestCode(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    await screen.findByRole("textbox", { name: "Email address" }),
    " Owner@Example.com ",
  );
  await user.click(screen.getByRole("button", { name: "Continue with Email" }));
  return screen.findByRole("textbox", { name: "Sign-in code" });
}

describe("email code sign-in", () => {
  test("retries a missing-token case link with a code and completes the claim only once", async () => {
    const user = userEvent.setup();
    storeAuthReturnLocation("/saved-case?step=review");
    let finish!: () => void;
    const completion = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const claim = vi.fn(async () => {
      await completion;
      return {
        claimPurpose: "intake" as const,
        caseId: "case-one",
        ownerUserId: session.user.id,
        outcome: "claimed" as const,
        contactEmail: EMAIL,
        emailVerifiedAt: "2026-09-07T00:00:00Z",
        claimedAt: "2026-09-07T00:00:00Z",
        ownershipTransferred: true,
      };
    });
    const { router } = setup({ claim, callbackPage: true });
    await user.click(
      await screen.findByRole("button", { name: "Try signing in again" }),
    );
    await requestCode(user);
    await user.paste("123456");
    await user.click(
      screen.getByRole("button", { name: "Verify and sign in" }),
    );
    expect(claim).toHaveBeenCalledExactlyOnceWith(CLAIM);
    expect(router.state.location.pathname).toBe(
      `/auth/callback/case-claim/${CLAIM}`,
    );
    await act(async () => finish());
    await screen.findByRole("heading", { name: "Signed in destination" });
    expect(router.state.location.pathname).toBe("/appraisals");
    expect(claim).toHaveBeenCalledOnce();
  });

  test("accepts digits only and edits around the code separator", async () => {
    const user = userEvent.setup();
    setup();
    const input = (await requestCode(user)) as HTMLInputElement;
    await user.paste("ab12 3-4567z");
    expect(input).toHaveValue("123-456");
    input.setSelectionRange(4, 4);
    await user.keyboard("{Backspace}");
    expect(input).toHaveValue("124-56");
    expect(input.selectionStart).toBe(2);
    await user.clear(input);
    await user.paste("123456");
    input.setSelectionRange(3, 3);
    await user.keyboard("{Delete}");
    expect(input).toHaveValue("123-56");
    expect(input.selectionStart).toBe(3);
  });

  test("verifies pasted digits inline and restores the full destination without another callback", async () => {
    const user = userEvent.setup();
    const { service, router, close } = setup();
    const input = await requestCode(user);
    expect(service.verifyEmailCode).not.toHaveBeenCalled();
    expect(service.sendMagicLink).not.toHaveBeenCalled();
    expect(service.sendEmailCode).toHaveBeenCalledWith(
      EMAIL,
      `${window.location.origin}/auth/callback`,
      expect.any(String),
    );
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    await user.paste("123-456");
    expect(input).toHaveValue("123-456");
    expect(JSON.stringify(window.localStorage)).not.toContain("123456");
    expect(JSON.stringify(window.localStorage)).not.toContain("123-456");
    await user.click(
      screen.getByRole("button", { name: "Verify and sign in" }),
    );
    await screen.findByRole("heading", { name: "Signed in destination" });
    expect(service.verifyEmailCode).toHaveBeenCalledExactlyOnceWith(
      EMAIL,
      "123456",
    );
    expect(close).toHaveBeenCalledWith(false);
    expect(router.state.location).toMatchObject({
      pathname: "/saved-case",
      search: "?step=review",
      hash: "#documents",
    });
    expect(
      window.localStorage.getItem("venfour.auth.return-location"),
    ).toBeNull();
    expect(service.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  test.each([
    [
      new Error("Token has expired or is invalid"),
      "That code is incorrect or has expired",
    ],
    [new Error("Failed to fetch"), "Check your connection"],
    [{ status: 429 }, "Too many sign-in attempts"],
  ])("recovers after verification failure: %s", async (failure, message) => {
    const user = userEvent.setup();
    const verify = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(session);
    const { router } = setup({ service: { verifyEmailCode: verify } });
    const input = await requestCode(user);
    await user.click(
      screen.getByRole("button", { name: "Verify and sign in" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter the six-digit code",
    );
    expect(verify).not.toHaveBeenCalled();
    await user.click(input);
    await user.paste("123456");
    await user.click(
      screen.getByRole("button", { name: "Verify and sign in" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(input).toBeEnabled();
    expect(screen.getByRole("button", { name: "Change email" })).toBeEnabled();
    expect(router.state.location.pathname).toBe("/");
    await user.clear(input);
    await user.type(input, "654321");
    await user.click(
      screen.getByRole("button", { name: "Verify and sign in" }),
    );
    await screen.findByRole("heading", { name: "Signed in destination" });
  });

  test("throttles resend, clears the old code after resend, and permits changing email", async () => {
    const user = userEvent.setup();
    const { service } = setup();
    const input = await requestCode(user);
    await user.paste("123456");
    expect(
      screen.getByRole("button", { name: /Resend code in/ }),
    ).toBeDisabled();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
    try {
      await waitFor(
        () =>
          expect(
            screen.getByRole("button", { name: "Resend code" }),
          ).toBeEnabled(),
        { timeout: 2000 },
      );
      await user.click(screen.getByRole("button", { name: "Resend code" }));
      expect(service.sendEmailCode).toHaveBeenCalledTimes(2);
      expect(input).toHaveValue("");
      expect(
        screen.getByRole("button", { name: /Resend code in/ }),
      ).toBeDisabled();
    } finally {
      clock.mockRestore();
    }
    await user.click(screen.getByRole("button", { name: "Change email" }));
    expect(screen.getByRole("textbox", { name: "Email address" })).toHaveValue(
      EMAIL,
    );
    expect(
      screen.getByRole("button", { name: "Continue with Apple" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("textbox", { name: "Sign-in code" }),
    ).not.toBeInTheDocument();
  });

  test("does not dismiss or verify twice while verification is pending", async () => {
    const user = userEvent.setup();
    let finish!: (value: Session) => void;
    const verification = new Promise<Session>((resolve) => {
      finish = resolve;
    });
    const verify = vi.fn(() => verification);
    const { close } = setup({ service: { verifyEmailCode: verify } });
    await requestCode(user);
    await user.paste("123456");
    await user.dblClick(
      screen.getByRole("button", { name: "Verify and sign in" }),
    );
    await user.keyboard("{Escape}");
    expect(close).not.toHaveBeenCalled();
    expect(verify).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Close sign in" }),
    ).toBeDisabled();
    await act(async () => finish(session));
    await screen.findByRole("heading", { name: "Signed in destination" });
  });

  test.each(["intake", "post_continue"] as const)(
    "reuses secure %s claim completion after code verification",
    async (claimPurpose) => {
      const user = userEvent.setup();
      const claim = vi.fn(async () => ({
        claimPurpose,
        caseId: "case-one",
        ownerUserId: session.user.id,
        outcome: "claimed" as const,
        contactEmail: EMAIL,
        emailVerifiedAt: "2026-09-07T00:00:00Z",
        claimedAt: "2026-09-07T00:00:00Z",
        ownershipTransferred: true,
      }));
      const { router } = setup({ claim });
      await requestCode(user);
      expect(claim).not.toHaveBeenCalled();
      await user.paste("123456");
      await user.click(
        screen.getByRole("button", { name: "Verify and sign in" }),
      );
      await screen.findByRole("heading", { name: "Signed in destination" });
      expect(claim).toHaveBeenCalledExactlyOnceWith(CLAIM);
      expect(router.state.location.pathname).toBe(
        claimPurpose === "post_continue"
          ? "/total-loss/cases/case-one/claim/checkout"
          : "/appraisals",
      );
    },
  );

  test("restores guest access when the secure claim rejects an email mismatch", async () => {
    const user = userEvent.setup();
    const guest = {
      ...session,
      user: { ...session.user, id: "guest", is_anonymous: true },
    };
    const claim = vi.fn(async () => {
      throw new Error("Verified email mismatch");
    });
    const { service, router } = setup({
      service: { getSession: async () => guest },
      claim,
    });
    await requestCode(user);
    await user.paste("123456");
    await user.click(
      screen.getByRole("button", { name: "Verify and sign in" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t connect this case",
    );
    expect(service.restoreSession).toHaveBeenCalledExactlyOnceWith(guest);
    expect(router.state.location.pathname).toBe("/");
    expect(window.localStorage.getItem("venfour.auth.return-location")).toBe(
      "/saved-case?step=review#documents",
    );
  });
});
