import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderTestApp } from "@/test/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFullReview } from "@/features/full-review/api";
import { getTotalLossClaim } from "@/features/total-loss-claim/api";
import { CASE_ID, OTHER_CASE_ID, USER_ID } from "./claim-fixtures";
import { installPreviewFetch, previewAuth, previewDetails, resetScenario, scenarios, snapshot } from "./state";

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

  it("saves intake edits locally and reads them back without losing report metadata", async () => {
    resetScenario("saved-report");
    const service = previewDetails.totalLossDetailsService;
    const scope = { caseId: CASE_ID, userId: USER_ID };
    const initial = await service.getDetails(scope);
    const saved = await service.saveDetails({ ...scope, expectedUpdatedAt: initial!.updatedAt, values: { postalCode: "90210" } });
    const updated = await service.updateDetails({ ...scope, expectedUpdatedAt: saved.updatedAt, changes: { mileageAtLoss: 42000 } });
    expect(await service.getDetails(scope)).toEqual(updated);
    expect(updated).toMatchObject({ postalCode: "90210", mileageAtLoss: 42000, reportOriginalFilename: initial!.reportOriginalFilename });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(saved.updatedAt));
    expect((await service.getDetails({ ...scope, caseId: OTHER_CASE_ID }))?.postalCode).toBe("60601");
    expect((await service.getDetails({ ...scope, userId: "another-preview-user" }))?.postalCode).toBe("60601");
    resetScenario("saved-report");
    expect((await service.getDetails(scope))?.postalCode).toBe("60601");
  });

  it("supports first-time intake autosave through the real start screen", async () => {
    resetScenario("zero");
    const saveDetails = vi.spyOn(previewDetails.totalLossDetailsService, "saveDetails");
    const user = userEvent.setup();
    renderTestApp(["/start?service=total-loss&view=intake"], { authService: previewAuth, totalLossDependencies: previewDetails });
    await user.click(await screen.findByRole("radio", { name: /I have my valuation report/i }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Upload your valuation report" })).toBeVisible();
    await waitFor(() => expect(saveDetails).toHaveBeenCalled());
    await waitFor(async () => expect(await previewDetails.totalLossDetailsService.getDetails({ caseId: CASE_ID, userId: USER_ID })).toMatchObject({ intakeMode: "report" }));
    expect(screen.queryByText(/saveDetails is not a function/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("radio", { name: /I have my valuation report/i })).toBeChecked();
  });

  it("blocks external requests", async () => {
    await expect(fetch("https://example.com/api")).rejects.toThrow("External requests are disabled");
  });
});
