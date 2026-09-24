import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderTestApp } from "@/test/render";
import { applicationHref, routeAudience } from "@/app/site-boundary";

describe("paid search landing", () => {
  it("renders accurate price, report requirement, refund protections and the existing workflow", () => {
    renderTestApp(["/total-loss-review?gclid=test-only"]);
    expect(screen.getByRole("heading", { level: 1, name: /Think your insurer’s total-loss valuation/ })).toBeVisible();
    expect(screen.getByText("$199 per case")).toBeVisible();
    expect(screen.getByText(/It is required for the paid review/)).toBeVisible();
    expect(screen.getByText(/Exactly \$1,000 does not qualify/)).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Review My Valuation" })).toHaveLength(2);
    for (const link of screen.getAllByRole("link", { name: "Review My Valuation" })) expect(link).toHaveAttribute("href", "/start?service=total-loss");
    const policies = within(screen.getByRole("navigation", { name: "Review policies" }));
    expect(policies.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    expect(policies.getByRole("link", { name: "Refund Policy" })).toHaveAttribute("href", "/refund-policy");
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute("href", "https://venfour.com/total-loss-review");
    expect(document.querySelector('meta[property="og:url"]')).toHaveAttribute("content", "https://venfour.com/total-loss-review");
    expect(document.title).toContain("$199");
  });
  it("assigns the landing route to the public site and intake to the customer host", () => {
    expect(routeAudience("/total-loss-review")).toBe("public");
    expect(applicationHref("/start?service=total-loss", "https://venfour.com")).toBe("https://app.venfour.com/start?service=total-loss");
  });
});
