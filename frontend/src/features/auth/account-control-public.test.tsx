import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderTestApp } from "@/test/render";
import type * as PublicSiteConfiguration from "@/config/public-site";
import { PUBLIC_SIGN_IN_MESSAGE, publicSignInAction } from "./public-sign-in";

vi.mock("@/config/public-site", async importOriginal => ({
  ...await importOriginal<typeof PublicSiteConfiguration>(),
  publicSiteOnly: true,
}));

describe("public-only website sign-in", () => {
  it.each([false, true])("opens and dismisses sign-in without leaving the public site (mobile: %s)", async mobile => {
    const originalUrl = window.location.href;
    const browserEnvironment = globalThis as typeof globalThis & {
      jsdom: { reconfigure(options: { url: string }): void };
    };
    browserEnvironment.jsdom.reconfigure({ url: "https://venfour.com/" });
    try {
      const user = userEvent.setup();
      renderTestApp(["/"], { authService: null });
      if (mobile) await user.click(screen.getByRole("button", { name: "Open navigation" }));
      const navigation = screen.getByRole("navigation", { name: mobile ? "Mobile navigation" : "Primary navigation" });
      const trigger = within(navigation).getByRole("button", { name: "Sign In" });
      await user.click(trigger);
      expect(screen.getByRole("dialog", { name: "Sign in to Venfour" })).toBeVisible();
      const frame = screen.getByTitle<HTMLIFrameElement>("Secure sign-in form");
      expect(frame).toHaveAttribute("src", "https://app.venfour.com/auth/sign-in?parentOrigin=https%3A%2F%2Fvenfour.com");
      expect(window.location.origin).toBe("https://venfour.com");
      expect(screen.getByRole("link", { name: "Open sign-in in a full page" })).toHaveAttribute("href", "https://app.venfour.com/auth/sign-in");
      act(() => window.dispatchEvent(new MessageEvent("message", {
        origin: "https://attacker.test", source: frame.contentWindow,
        data: { type: PUBLIC_SIGN_IN_MESSAGE, action: "close" },
      })));
      expect(screen.getByRole("dialog")).toBeVisible();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    } finally {
      browserEnvironment.jsdom.reconfigure({ url: originalUrl });
    }
  });

  it("accepts only fixed actions from the exact application frame", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    try {
      const message = (origin: string, source: Window | null, action: unknown) => new MessageEvent("message", {
        origin, source, data: { type: PUBLIC_SIGN_IN_MESSAGE, action },
      });
      for (const action of ["ready", "close", "complete", "google", "apple"]) {
        expect(publicSignInAction(message("https://app.venfour.com", frame.contentWindow, action), frame.contentWindow)).toBe(action);
      }
      expect(publicSignInAction(message("https://attacker.test", frame.contentWindow, "complete"), frame.contentWindow)).toBeNull();
      expect(publicSignInAction(message("https://app.venfour.com", window, "complete"), frame.contentWindow)).toBeNull();
      expect(publicSignInAction(message("https://app.venfour.com", frame.contentWindow, "https://attacker.test"), frame.contentWindow)).toBeNull();
      expect(publicSignInAction(message("https://app.venfour.com", null, "complete"), null)).toBeNull();
    } finally {
      frame.remove();
    }
  });
});
