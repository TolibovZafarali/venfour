import { describe, expect, it } from "vitest";

import {
  EXPECTED_STAGING_ORIGIN,
  StagingEnvironmentValidationError,
  validateStagingEnvironment,
} from "./staging-environment.mjs";

const VALID_ENVIRONMENT = Object.freeze({
  VITE_API_BASE_URL: "",
  VITE_STAGING_ORIGIN: EXPECTED_STAGING_ORIGIN,
  VITE_SUPPORT_EMAIL: "support@example.test",
  VITE_SUPABASE_PUBLISHABLE_KEY:
    "sb_publishable_abcdefghijklmnopqrstuvwxyz0123456789",
  VITE_SUPABASE_URL: "https://example.supabase.co",
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
      supabaseUrl: "https://example.supabase.co",
      supportEmail: "support@example.test",
    });
  });

  it.each([
    "VITE_STAGING_ORIGIN",
    "VITE_SUPPORT_EMAIL",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
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
});
