import { describe, expect, it } from "vitest";

import {
  EXPECTED_STAGING_ORIGIN,
  EXPECTED_STAGING_SUPABASE_ORIGIN,
  StagingEnvironmentValidationError,
  validateStagingEnvironment,
} from "./staging-environment.mjs";

const VALID_ENVIRONMENT = Object.freeze({
  VITE_API_BASE_URL: "",
  VITE_STAGING_ORIGIN: EXPECTED_STAGING_ORIGIN,
  VITE_SUPPORT_EMAIL: "support@example.test",
  VITE_SUPABASE_PUBLISHABLE_KEY:
    "sb_publishable_abcdefghijklmnopqrstuvwxyz0123456789",
  VITE_SUPABASE_URL: EXPECTED_STAGING_SUPABASE_ORIGIN,
  VITE_TURNSTILE_SITE_KEY: "0x4AAAAAAA0000000000000000000000",
});

function validate(overrides = {}) {
  return validateStagingEnvironment({
    ...VALID_ENVIRONMENT,
    ...overrides,
  });
}

function issuesFor(overrides) {
  try {
    validate(overrides);
  } catch (error) {
    expect(error).toBeInstanceOf(StagingEnvironmentValidationError);
    return error.issues;
  }
  throw new Error("Expected staging environment validation to fail.");
}

function jwtWithRole(role) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  return `${header}.${payload}.signature`;
}

describe("validateStagingEnvironment", () => {
  it("accepts the exact HTTPS staging boundary and same-origin API mode", () => {
    expect(validate()).toEqual({
      apiBaseUrl: "",
      stagingOrigin: EXPECTED_STAGING_ORIGIN,
      supabaseUrl: EXPECTED_STAGING_SUPABASE_ORIGIN,
      supportEmail: "support@example.test",
      turnstileSiteKey: "0x4AAAAAAA0000000000000000000000",
    });
  });

  it.each([
    "VITE_STAGING_ORIGIN",
    "VITE_SUPPORT_EMAIL",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "VITE_TURNSTILE_SITE_KEY",
  ])("rejects a missing %s", (name) => {
    expect(issuesFor({ [name]: "" }).some((issue) => issue.includes(name))).toBe(
      true,
    );
  });

  it("rejects a cross-origin staging API base", () => {
    expect(
      issuesFor({ VITE_API_BASE_URL: "https://api.example.test" }),
    ).toContain(
      "VITE_API_BASE_URL must be empty so staging API requests remain same-origin.",
    );
  });

  it.each([
    "http://example.supabase.co",
    "https://example.supabase.co/rest/v1",
    "https://user:password@example.supabase.co",
  ])("rejects a malformed Supabase origin: %s", (value) => {
    expect(
      issuesFor({ VITE_SUPABASE_URL: value }).some((issue) =>
        issue.startsWith("VITE_SUPABASE_URL"),
      ),
    ).toBe(true);
  });

  it("rejects another valid Supabase HTTPS project origin", () => {
    expect(
      issuesFor({
        VITE_SUPABASE_URL: "https://another-project.supabase.co",
      }),
    ).toContain(
      `VITE_SUPABASE_URL must be ${EXPECTED_STAGING_SUPABASE_ORIGIN} for this deployment.`,
    );
  });

  it.each([
    "http://staging.venfour.com",
    "https://staging.venfour.com/path",
    "https://preview.venfour.com",
    "https://venfour.com",
    "https://www.venfour.com",
  ])("rejects a non-exact or production staging origin: %s", (value) => {
    expect(
      issuesFor({ VITE_STAGING_ORIGIN: value }).some((issue) =>
        issue.startsWith("VITE_STAGING_ORIGIN"),
      ),
    ).toBe(true);
  });

  it("accepts a legacy anon key while rejecting privileged and malformed keys", () => {
    expect(
      validate({ VITE_SUPABASE_PUBLISHABLE_KEY: jwtWithRole("anon") }),
    ).toMatchObject({ stagingOrigin: EXPECTED_STAGING_ORIGIN });

    for (const key of [jwtWithRole("service_role"), "not-a-publishable-key"]) {
      expect(
        issuesFor({ VITE_SUPABASE_PUBLISHABLE_KEY: key }).some((issue) =>
          issue.startsWith("VITE_SUPABASE_PUBLISHABLE_KEY"),
        ),
      ).toBe(true);
    }
  });

  it("rejects a malformed support email", () => {
    expect(
      issuesFor({ VITE_SUPPORT_EMAIL: "support-at-example.test" }),
    ).toContain("VITE_SUPPORT_EMAIL must be a valid email address.");
  });

  it.each([
    "1x00000000000000000000AA",
    "2x00000000000000000000AB",
    "1x00000000000000000000BB",
    "2x00000000000000000000BB",
    "3x00000000000000000000FF",
  ])("rejects an official Turnstile test key in staging: %s", (siteKey) => {
    expect(issuesFor({ VITE_TURNSTILE_SITE_KEY: siteKey })).toContain(
      "VITE_TURNSTILE_SITE_KEY must not use an official Turnstile test key in staging.",
    );
  });

  it("rejects a malformed Turnstile site key", () => {
    expect(issuesFor({ VITE_TURNSTILE_SITE_KEY: "not a site key" })).toContain(
      "VITE_TURNSTILE_SITE_KEY must be a valid public site key.",
    );
  });

  it("rejects a secret-shaped value that is too long to be a site key", () => {
    expect(
      issuesFor({
        VITE_TURNSTILE_SITE_KEY: "1x0000000000000000000000000000000AA",
      }),
    ).toContain("VITE_TURNSTILE_SITE_KEY must be a valid public site key.");
  });
});
