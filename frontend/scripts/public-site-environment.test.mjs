import { describe, expect, it } from "vitest";
import { validatePublicSiteEnvironment } from "./public-site-environment.mjs";

const valid = { VITE_PUBLIC_SITE_ONLY: "true", VITE_PUBLIC_ORIGIN: "https://venfour.com", VITE_SUPPORT_EMAIL: "support@venfour.com" };
describe("public website environment", () => {
  it("accepts only the explicit public website configuration", () => {
    expect(() => validatePublicSiteEnvironment(valid)).not.toThrow();
    expect(() => validatePublicSiteEnvironment({ ...valid, VITE_PUBLIC_SITE_ONLY: "false" })).toThrow();
    expect(() => validatePublicSiteEnvironment({ ...valid, VITE_PUBLIC_ORIGIN: "https://staging.venfour.com" })).toThrow();
  });
  it.each(["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_API_BASE_URL", "VITE_STRIPE_PUBLISHABLE_KEY", "VITE_TURNSTILE_SITE_KEY"])("rejects %s rather than copying application configuration", name => {
    expect(() => validatePublicSiteEnvironment({ ...valid, [name]: "configured" })).toThrow();
  });
});
