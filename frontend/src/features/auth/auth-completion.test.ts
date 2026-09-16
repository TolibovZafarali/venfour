import { afterEach, describe, expect, it, vi } from "vitest";

import { completedAuthReturnLocation, navigateAfterAuth } from "./auth-completion";
import { storeAuthReturnLocation } from "./return-location";
import type { CompleteTotalLossIdentityClaimResult } from "@/features/total-loss/data-types";

const originalUrl = window.location.href;
const browserEnvironment = globalThis as typeof globalThis & {
  jsdom: { reconfigure(options: { url: string }): void };
};

afterEach(() => browserEnvironment.jsdom.reconfigure({ url: originalUrl }));

describe("authentication return host boundaries", () => {
  it.each([undefined, "/", "/earnings", "/invitations/saved?source=email#agreement"])(
    "returns partner authentication to its own workspace: %s", async (returnTo) => {
      browserEnvironment.jsdom.reconfigure({ url: "https://partners.venfour.com/auth/callback" });
      if (returnTo !== undefined) storeAuthReturnLocation(returnTo);
      const isStaff = vi.fn(async () => true);
      await expect(completedAuthReturnLocation({ kind: "none" }, null, { isStaff })).resolves.toBe(returnTo ?? "/");
      expect(isStaff).not.toHaveBeenCalled();
    },
  );

  it.each(["https://app.venfour.com", "http://localhost:5173"])(
    "preserves customer workspace entry on %s", async (origin) => {
      browserEnvironment.jsdom.reconfigure({ url: `${origin}/auth/callback` });
      storeAuthReturnLocation("/");
      await expect(completedAuthReturnLocation({ kind: "none" }, null)).resolves.toBe("/app");
    },
  );
});

describe("staff sign-in destination", () => {
  it.each([undefined, "/", "/app", "/appraisals", "/start", "/start?service=total-loss", "/total-loss/start"])(
    "opens the staff workspace from generic entry %s", async (returnTo) => {
      if (returnTo !== undefined) storeAuthReturnLocation(returnTo);
      const isStaff = vi.fn(async () => true);
      await expect(completedAuthReturnLocation({ kind: "none" }, null, { isStaff })).resolves.toBe("/admin");
      expect(isStaff).toHaveBeenCalledOnce();
    },
  );

  it.each([
    "/total-loss/cases/saved/claim/review?from=resume#evidence",
    "/start?service=total-loss&caseId=saved",
    "/start?service=total-loss&newCaseId=new",
    "/start?service=diminished-value",
    "/partners/earnings",
    "/admin/cases/saved",
    "/destination?from=email#saved",
  ])("preserves explicit destination %s without a staff lookup", async (returnTo) => {
    storeAuthReturnLocation(returnTo);
    const isStaff = vi.fn(async () => true);
    await expect(completedAuthReturnLocation({ kind: "none" }, null, { isStaff })).resolves.toBe(returnTo);
    expect(isStaff).not.toHaveBeenCalled();
  });

  it.each([false, "unavailable"])("preserves customer fallback when staff access is %s", async (decision) => {
    storeAuthReturnLocation("/");
    const isStaff = vi.fn(async () => {
      if (decision === "unavailable") throw new Error("Staff access unavailable");
      return false;
    });
    await expect(completedAuthReturnLocation({ kind: "none" }, null, { isStaff })).resolves.toBe("/app");
  });

  it("keeps a completed case claim ahead of the staff default", async () => {
    storeAuthReturnLocation("/");
    const isStaff = vi.fn(async () => true);
    const claim = { caseId: "claimed-case" } as CompleteTotalLossIdentityClaimResult;
    await expect(completedAuthReturnLocation({ kind: "claim", claimId: "claim" }, claim, { isStaff })).resolves.toBe("/total-loss/cases/claimed-case");
    expect(isStaff).not.toHaveBeenCalled();
  });

  it("requests the protected admin document with replacement instead of client routing", () => {
    const navigate = vi.fn();
    const replaceDocument = vi.fn();
    navigateAfterAuth("/admin", navigate, replaceDocument);
    expect(replaceDocument).toHaveBeenCalledExactlyOnceWith("/admin");
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(["/app", "/total-loss/cases/saved?step=review#documents", "/partners/earnings"])(
    "preserves client navigation for %s", (destination) => {
      const navigate = vi.fn();
      const replaceDocument = vi.fn();
      navigateAfterAuth(destination, navigate, replaceDocument);
      expect(navigate).toHaveBeenCalledExactlyOnceWith(destination, { replace: true });
      expect(replaceDocument).not.toHaveBeenCalled();
    },
  );
});
