import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { environment } from "@/config/env";
import { renderTestApp } from "@/test/render";

vi.mock("@/config/public-site", () => ({ publicSiteOnly: true, publicIntakeClosed: false }));

describe("public intake entry point", () => {
  it("offers customer intake while keeping the public site independent of application credentials", () => {
    renderTestApp(["/"], { authService: null });
    expect(screen.getAllByRole("link", { name: /Start Total Loss review/ }).length).toBeGreaterThan(0);
    expect(screen.getByText("Available now")).toBeVisible();
    expect(screen.queryByText("Online reviews are opening soon.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Admin|Payment approvals/ })).not.toBeInTheDocument();
    expect(environment.supabaseUrl).toBe("");
    expect(environment.supabasePublishableKey).toBe("");
    expect(environment.turnstileSiteKey).toBe("");
  });

  it.each(["/admin/payment-approvals", "/app", "/start", "/auth/callback"])("does not mount application route %s on the public site", path => {
    renderTestApp([path], { authService: null });
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });
});
