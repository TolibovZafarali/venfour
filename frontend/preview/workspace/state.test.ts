import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFullReview } from "@/features/full-review/api";
import { getTotalLossClaim } from "@/features/total-loss-claim/api";
import { CASE_ID } from "./claim-fixtures";
import { installPreviewFetch, previewDetails, resetScenario, scenarios, snapshot } from "./state";

let originalFetch: typeof fetch;
beforeEach(() => {
  originalFetch = window.fetch;
  localStorage.clear();
  sessionStorage.clear();
  installPreviewFetch();
});
afterEach(() => { window.fetch = originalFetch; });

describe("customer preview contracts", () => {
  it.each(scenarios)("%s has a valid report state", async phase => {
    resetScenario(phase);
    const state = await getFullReview(CASE_ID, "preview");
    expect(state.caseId).toBe(CASE_ID);
    if (["saved-report", "missing-detail"].includes(phase)) {
      expect(state.canReuseReport).toBe(true);
      const details = await previewDetails.totalLossDetailsService.getDetails({ caseId: CASE_ID, userId: "22222222-2222-4222-8222-222222222222" });
      expect(details?.reportOriginalFilename).toBeTruthy();
      expect(details?.reportUploadedAt).toBeTruthy();
    }
    if (["report-invalid", "extraction-failed", "review-insufficient", "review-failed"].includes(phase)) {
      expect(state.report).not.toBeNull();
      expect(state.checkoutAvailable).toBe(false);
    }
  });

  it("retains the report for a completed no-dispute result", async () => {
    resetScenario("no-dispute");
    const claim = await getTotalLossClaim(CASE_ID, "preview");
    expect(claim.state).toBe("secured");
    if (claim.state !== "secured") throw new Error("Expected a saved claim");
    expect(claim.report?.conclusion.continuingSupported).toBe(false);
    expect(claim.commerce?.entitlementStatus).toBe("refunded_access_retained");
  });

  it("falls back from retired saved scenarios", () => {
    localStorage.setItem("venfour-workspace-visual-preview-v1", JSON.stringify({ phase: "retired" }));
    expect(snapshot().phase).toBe("free");
  });

  it("blocks external requests", async () => {
    await expect(fetch("https://example.com/api")).rejects.toThrow("External requests are disabled");
  });
});
