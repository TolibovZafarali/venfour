import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderTestApp } from "@/test/render";

vi.mock("@/config/public-site", async importOriginal => ({
  ...await importOriginal<typeof import("@/config/public-site")>(),
  publicSiteOnly: true,
}));

describe("public-only website sign-in", () => {
  it("keeps an external sign-in link available without application authentication", async () => {
    const originalUrl = window.location.href;
    const browserEnvironment = globalThis as typeof globalThis & {
      jsdom: { reconfigure(options: { url: string }): void };
    };
    browserEnvironment.jsdom.reconfigure({ url: "https://venfour.com/" });
    try {
      renderTestApp(["/"], { authService: null });
      const links = await screen.findAllByRole("link", { name: "Sign In" });
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(link).toHaveAttribute("href", "https://app.venfour.com/app");
      expect(screen.queryByRole("button", { name: "Sign In" })).not.toBeInTheDocument();
    } finally {
      browserEnvironment.jsdom.reconfigure({ url: originalUrl });
    }
  });
});
