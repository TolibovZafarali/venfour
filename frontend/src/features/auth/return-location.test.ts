import { beforeEach, describe, expect, test } from "vitest";

import {
  AUTH_RETURN_LOCATION_STORAGE_KEY,
  consumeAuthReturnLocation,
  getAuthCallbackUrl,
  getCurrentReturnLocation,
  readAuthCallbackParameters,
  sanitizeReturnLocation,
  storeAuthReturnLocation,
} from "@/features/auth/return-location";

describe("auth return locations", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  test("keeps same-origin relative paths and rejects redirect attacks", () => {
    expect(sanitizeReturnLocation("/cases/123?tab=files#latest")).toBe(
      "/cases/123?tab=files#latest",
    );
    expect(sanitizeReturnLocation("https://attacker.example/steal")).toBe("/");
    expect(sanitizeReturnLocation("//attacker.example/steal")).toBe("/");
    expect(sanitizeReturnLocation("/\\attacker.example/steal")).toBe("/");
    expect(sanitizeReturnLocation("/auth/callback?code=again")).toBe("/");
  });

  test("stores and consumes a validated return location exactly once", () => {
    storeAuthReturnLocation("/start?service=total-loss&step=upload");

    expect(
      window.localStorage.getItem(AUTH_RETURN_LOCATION_STORAGE_KEY),
    ).toBe("/start?service=total-loss&step=upload");
    expect(consumeAuthReturnLocation()).toBe(
      "/start?service=total-loss&step=upload",
    );
    expect(consumeAuthReturnLocation()).toBe("/");
  });

  test("revalidates storage before navigating", () => {
    window.localStorage.setItem(
      AUTH_RETURN_LOCATION_STORAGE_KEY,
      "//attacker.example/steal",
    );

    expect(consumeAuthReturnLocation()).toBe("/");
  });

  test("uses the current page by default and builds an exact callback URL", () => {
    window.history.replaceState({}, "", "/analyses/run-1?view=market#top");

    expect(getCurrentReturnLocation()).toBe(
      "/analyses/run-1?view=market#top",
    );
    expect(getAuthCallbackUrl()).toBe(
      `${window.location.origin}/auth/callback`,
    );
  });

  test("reads success and provider error callback parameters", () => {
    expect(
      readAuthCallbackParameters({
        search:
          "?code=secure-code&sb_flow_id=0123456789abcdef0123456789abcdef",
        hash: "",
      }),
    ).toEqual({
      kind: "code",
      code: "secure-code",
      flowId: "0123456789abcdef0123456789abcdef",
    });
    expect(
      readAuthCallbackParameters({
        search: "?token_hash=secure-token-hash&type=email",
        hash: "",
      }),
    ).toEqual({ kind: "email", tokenHash: "secure-token-hash" });
    expect(
      readAuthCallbackParameters({
        search: "?error=access_denied&error_description=User+cancelled",
        hash: "",
      }),
    ).toEqual({ kind: "error", message: "User cancelled" });
    expect(
      readAuthCallbackParameters({
        search: "?token_hash=secure-token-hash&type=recovery",
        hash: "",
      }),
    ).toEqual({ kind: "invalid" });
  });
});
