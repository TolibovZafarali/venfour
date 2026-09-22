import { describe, expect, it } from "vitest";
import { applicationHref, publicHref, hostAudience, routeAudience } from "./site-boundary";
import { getAuthCallbackUrl, sanitizeReturnLocation } from "@/features/auth/return-location";

describe("public and application boundaries", () => {
  it.each(["/", "/methodology", "/terms", "/privacy", "/refund-policy", "/refund-policy/", "/referral-partners", "/about", "/resources/understanding-your-report", "/resources/valuation-review-checklist", "/resources/understanding-your-report/"])("keeps %s public", path => expect(routeAudience(path)).toBe("public"));
  it.each(["/app", "/appraisals", "/start", "/total-loss/cases/saved/analysis", "/admin/cases", "/partners", "/partners/invitations/code", "/auth/callback"])("assigns %s to the application", path => expect(routeAudience(path)).toBe("application"));
  it("uses distinct new entry points on production hosts", () => {
    expect(applicationHref("/app", "https://venfour.com")).toBe("https://app.venfour.com/app");
    expect(applicationHref("/start?service=total-loss&ref=example", "https://www.venfour.com")).toBe("https://app.venfour.com/start?service=total-loss&ref=example");
    expect(publicHref("/#how-it-works", "https://app.venfour.com")).toBe("https://venfour.com/#how-it-works");
    expect(publicHref("/refund-policy", "https://app.venfour.com")).toBe("https://venfour.com/refund-policy");
    expect(hostAudience("https://app.venfour.com")).toBe("application");
  });
  it.each(["https://staging.venfour.com", "http://localhost:5173", "http://127.0.0.1:5173"])("keeps staging and local flows on their existing origin: %s", origin => {
    expect(hostAudience(origin)).toBe("combined");
    expect(applicationHref("/app", origin)).toBe("/app");
    expect(publicHref("/", origin)).toBe("/");
  });
  it.each(["//evil.example", "/\\evil.example", "https://evil.example", "/app\nLocation: evil"])("rejects an unsafe entry target %s", path => {
    expect(applicationHref(path, "https://venfour.com")).toBe("https://app.venfour.com/app");
  });
  it("preserves callbacks and relative return links on the issuing origin", () => {
    expect(new URL(getAuthCallbackUrl()).origin).toBe(window.location.origin);
    expect(sanitizeReturnLocation("/total-loss/cases/saved/claim?round=2#reply")).toBe("/total-loss/cases/saved/claim?round=2#reply");
    expect(sanitizeReturnLocation("https://app.venfour.com/app")).toBe("/");
    expect(sanitizeReturnLocation("/auth/callback?code=secret")).toBe("/");
  });
});
