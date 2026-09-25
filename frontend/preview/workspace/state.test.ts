import "@testing-library/jest-dom/vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderTestApp } from "@/test/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as EnvironmentModule from "@/config/env";
import { getFullReview } from "@/features/full-review/api";
import { getTotalLossClaim } from "@/features/total-loss-claim/api";
import { confirmedValues, loadProduct, saveProduct, updatedFacts } from "@/features/nationwide/product-api";
import { CASE_ID, OTHER_CASE_ID, USER_ID } from "./claim-fixtures";
import { installPreviewFetch, previewAuth, previewDetails, resetScenario, scenarios, scenarioPath, snapshot } from "./state";

vi.mock("@/config/env", async importOriginal => {
  const original = await importOriginal<typeof EnvironmentModule>();
  return { ...original, environment: { ...original.environment, nationwideProductEnabled: true } };
});

let originalFetch: typeof fetch;
beforeEach(() => {
  originalFetch = window.fetch;
  localStorage.clear();
  sessionStorage.clear();
  installPreviewFetch();
});
afterEach(() => { window.fetch = originalFetch; });

describe("customer preview contracts", () => {
  it("opens the current contact step directly in the split start layout", async () => {
    resetScenario("contact-details");
    renderTestApp([scenarioPath("contact-details")], { authService: previewAuth, totalLossDependencies: previewDetails });
    expect(await screen.findByRole("heading", { name: "Contact details" })).toBeVisible();
    const registration = await screen.findByLabelText("Vehicle registration state");
    await waitFor(() => expect(registration).toBeEnabled());
    expect(screen.getByLabelText("State where the loss occurred")).toBeVisible();
    const user = userEvent.setup();
    await user.selectOptions(registration, "US-IL");
    await user.click(screen.getByLabelText(/The vehicle’s home, loss location/));
    expect(screen.queryByLabelText("State where the loss occurred")).not.toBeInTheDocument();
    expect(screen.getByLabelText("First name")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Review & analyze" })).toBeDisabled();
    expect(document.querySelector("[data-start-split-shell]")).toBeInTheDocument();
  });
  it("persists location facts locally, rejects stale saves, and resets the example", async () => {
    resetScenario("contact-details");
    const initial = await loadProduct(CASE_ID, "preview");
    expect(initial.locations).toHaveLength(51);
    const facts = updatedFacts(initial.context.facts, { ...confirmedValues(initial.context.facts), vehicle_registration: "US-IL" }, "2026-09-25T12:00:00Z");
    await saveProduct(CASE_ID, "preview", 0, facts);
    expect((await loadProduct(CASE_ID, "preview")).context).toMatchObject({ facts_revision: 1, facts });
    await expect(saveProduct(CASE_ID, "preview", 0, facts)).rejects.toThrow();
    expect((await loadProduct(OTHER_CASE_ID, "preview")).context.facts.assertions).toEqual([]);
    resetScenario("contact-details");
    expect((await loadProduct(CASE_ID, "preview")).context.facts.assertions).toEqual([]);
  });
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
