import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ProductionEnvironmentValidationError, validateProductionEnvironment } from "./production-environment.mjs";

const environment = {
  VITE_API_BASE_URL: "",
  VITE_PUBLIC_ORIGIN: "https://venfour.com",
  VITE_APPLICATION_ORIGIN: "https://app.venfour.com",
  VITE_SUPABASE_URL: "https://reviewed-project.supabase.co",
  VENFOUR_PRODUCTION_SUPABASE_ORIGIN: "https://reviewed-project.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnopqrstuvwxyz0123456789",
  VITE_SUPPORT_EMAIL: "support@example.test",
  VITE_TURNSTILE_SITE_KEY: "0x4AAAAAAA0000000000000000000000",
};

describe("production browser configuration", () => {
  it("requires an explicit reviewed project and the public/application host split", () => {
    expect(validateProductionEnvironment(environment)).toMatchObject({
      apiBaseUrl: "", publicOrigin: "https://venfour.com", applicationOrigin: "https://app.venfour.com",
      supabaseUrl: "https://reviewed-project.supabase.co",
    });
  });

  it("allows explicitly disabled public-site mode", () => {
    expect(validateProductionEnvironment({ ...environment, VITE_PUBLIC_SITE_ONLY: "false" })).toEqual(
      validateProductionEnvironment(environment),
    );
  });

  it("keeps application, public website, and staging deployments on separate hosts", () => {
    const { env } = JSON.parse(readFileSync(resolve(import.meta.dirname, "../wrangler.jsonc"), "utf8"));
    expect(env.production.routes).toEqual([{ pattern: "app.venfour.com", custom_domain: true }, { pattern: "partners.venfour.com", custom_domain: true }]);
    expect(env["public-site"].routes).toEqual([
      { pattern: "venfour.com", custom_domain: true },
      { pattern: "www.venfour.com", custom_domain: true },
    ]);
    expect(env.staging.routes).toEqual([{ pattern: "staging.venfour.com", custom_domain: true }]);
    for (const deployment of [env.production, env["public-site"], env.staging]) {
      expect(deployment.workers_dev).toBe(false);
      expect(deployment.preview_urls).toBe(false);
    }
  });

  it.each([
    ["VITE_PUBLIC_SITE_ONLY", "true"],
    ["VITE_PUBLIC_ORIGIN", "https://staging.venfour.com"],
    ["VITE_PUBLIC_ORIGIN", "https://www.venfour.com"],
    ["VITE_APPLICATION_ORIGIN", "https://venfour.com"],
    ["VITE_APPLICATION_ORIGIN", "https://app.venfour.com/"],
    ["VITE_STAGING_ORIGIN", "https://staging.venfour.com"],
    ["VITE_API_BASE_URL", "https://api.example.test"],
    ["VITE_API_BASE_URL", " "],
    ["VENFOUR_PRODUCTION_SUPABASE_ORIGIN", ""],
    ["VENFOUR_PRODUCTION_SUPABASE_ORIGIN", "https://other-project.supabase.co"],
    ["VENFOUR_PRODUCTION_SUPABASE_ORIGIN", "https://reviewed-project.supabase.co/path"],
    ["VENFOUR_PRODUCTION_SUPABASE_ORIGIN", "https://reviewed-project.supabase.co:8443"],
    ["VITE_SUPABASE_URL", "https://unreviewed-project.supabase.co"],
    ["VITE_SUPABASE_PUBLISHABLE_KEY", "sb_secret_private_key_00000000000"],
    ["VITE_SUPPORT_EMAIL", "support-at-example.test"],
    ["VITE_TURNSTILE_SITE_KEY", "1x00000000000000000000AA"],
    ["VITE_TURNSTILE_SITE_KEY", ""],
  ])("rejects invalid %s without printing its value", (name, value) => {
    expect(() => validateProductionEnvironment({ ...environment, [name]: value })).toThrow(ProductionEnvironmentValidationError);
    try { validateProductionEnvironment({ ...environment, [name]: value }); }
    catch (error) { expect(error.issues.join(" ")).toContain(name); }
  });
});
