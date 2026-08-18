import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import {
  COOKIE_CONSENT_STORAGE_KEY,
  hasAnalyticsConsent,
} from "@/features/privacy/consent";
import type { CookieConsentPreferences } from "@/features/privacy/consent";
import { renderTestApp } from "@/test/render";

describe("cookie consent", () => {
  test("keeps rejection inside preferences and persists the choice", async () => {
    const user = userEvent.setup();
    const { unmount } = renderTestApp();

    const banner = screen.getByRole("region", {
      name: "Your privacy, your choice",
    });
    expect(banner.parentElement).toHaveClass("width-before-scroll-bar");
    expect(
      within(banner).getByText(/we don’t currently use analytics/i),
    ).toBeVisible();
    expect(
      within(banner).getByRole("button", { name: "Accept All" }),
    ).toBeVisible();
    expect(
      within(banner).queryByRole("button", {
        name: "Reject Non-Essential",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(banner).getByRole("button", { name: "Manage Preferences" }),
    ).toBeVisible();
    expect(
      within(banner).getByRole("link", { name: "Privacy Policy" }),
    ).toHaveAttribute("href", "/privacy");
    expect(
      within(banner).getByRole("link", { name: "Cookie Policy" }),
    ).toHaveAttribute("href", "/cookies");
    expect(hasAnalyticsConsent()).toBe(false);

    await user.click(
      within(banner).getByRole("button", { name: "Manage Preferences" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Cookie preferences",
    });
    await user.click(
      within(dialog).getByRole("button", {
        name: "Reject Non-Essential",
      }),
    );

    expect(
      screen.queryByRole("region", { name: "Your privacy, your choice" }),
    ).not.toBeInTheDocument();
    expect(readStoredConsent()).toMatchObject({
      essential: true,
      analytics: false,
      source: "reject-non-essential",
    });

    unmount();
    renderTestApp();

    expect(
      screen.queryByRole("region", { name: "Your privacy, your choice" }),
    ).not.toBeInTheDocument();
  });

  test("keeps essential storage enabled while allowing preferences to change", async () => {
    const user = userEvent.setup();
    renderTestApp();

    await user.click(
      screen.getByRole("button", { name: "Manage Preferences" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Cookie preferences",
    });
    const essential = within(dialog).getByRole("switch", {
      name: "Essential cookies, always enabled",
    });
    const analytics = within(dialog).getByRole("switch", {
      name: "Allow analytics",
    });

    expect(essential).toBeChecked();
    expect(essential).toBeDisabled();
    expect(analytics).not.toBeChecked();
    expect(
      within(dialog).getByText(/no analytics are active on Venfour today/i),
    ).toBeVisible();

    await user.click(analytics);
    expect(analytics).toBeChecked();
    await user.click(
      within(dialog).getByRole("button", { name: "Save Preferences" }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(readStoredConsent()).toMatchObject({
      essential: true,
      analytics: true,
      source: "preferences",
    });
    expect(hasAnalyticsConsent()).toBe(true);

    await user.click(
      screen.getByRole("button", { name: "Cookie preferences" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Cookie preferences" }),
    ).toBeVisible();
    expect(
      screen.getByRole("switch", { name: "Allow analytics" }),
    ).toBeChecked();
  });

  test("accepts all optional purposes from the banner", async () => {
    const user = userEvent.setup();
    renderTestApp();

    await user.click(screen.getByRole("button", { name: "Accept All" }));

    expect(readStoredConsent()).toMatchObject({
      essential: true,
      analytics: true,
      source: "accept-all",
    });
    expect(hasAnalyticsConsent()).toBe(true);
  });

  test("supports keyboard navigation and restores focus after preferences", async () => {
    const user = userEvent.setup();
    renderTestApp();

    const acceptAll = screen.getByRole("button", { name: "Accept All" });
    const manage = screen.getByRole("button", {
      name: "Manage Preferences",
    });

    acceptAll.focus();
    await user.tab();
    expect(manage).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("dialog", { name: "Cookie preferences" }),
    ).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(manage).toHaveFocus());
  });

  test("honors Global Privacy Control without prompting for analytics", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "globalPrivacyControl",
    );
    Object.defineProperty(navigator, "globalPrivacyControl", {
      configurable: true,
      value: true,
    });

    try {
      const user = userEvent.setup();
      renderTestApp();

      expect(
        screen.queryByRole("region", { name: "Your privacy, your choice" }),
      ).not.toBeInTheDocument();
      await waitFor(() =>
        expect(readStoredConsent()).toMatchObject({
          analytics: false,
          source: "global-privacy-control",
        }),
      );
      expect(hasAnalyticsConsent()).toBe(false);

      await user.click(
        screen.getByRole("button", { name: "Cookie preferences" }),
      );
      const dialog = screen.getByRole("dialog", {
        name: "Cookie preferences",
      });
      expect(
        within(dialog).getByText(/Global Privacy Control is active/i),
      ).toBeVisible();
      expect(
        within(dialog).getByRole("switch", { name: "Allow analytics" }),
      ).toBeDisabled();
    } finally {
      if (descriptor) {
        Object.defineProperty(navigator, "globalPrivacyControl", descriptor);
      } else {
        Reflect.deleteProperty(navigator, "globalPrivacyControl");
      }
    }
  });
});

function readStoredConsent() {
  const rawConsent = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
  return rawConsent
    ? (JSON.parse(rawConsent) as CookieConsentPreferences)
    : null;
}
