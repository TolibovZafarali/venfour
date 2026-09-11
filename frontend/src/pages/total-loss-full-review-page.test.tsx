import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FullReviewReport } from "./total-loss-full-review-page";
import { getFullReview, uploadFullReview, extractFullReview, confirmFullReview, type FullReviewState } from "@/features/full-review/api";
import { VehicleFactFields } from "@/features/total-loss/vehicle-fact-fields";
import { createEmptyTotalLossManualForm } from "@/features/total-loss/types";

vi.mock("@/features/full-review/api", async importOriginal => ({
  ...await importOriginal<typeof import("@/features/full-review/api")>(),
  getFullReview: vi.fn(), uploadFullReview: vi.fn(), extractFullReview: vi.fn(), confirmFullReview: vi.fn(),
}));
vi.mock("@/features/total-loss-claim/components/local-continue-action", () => ({ LocalContinueAction: ({ label }: { label: string }) => <button>{label}</button> }));
const initial: FullReviewState = { caseId: "case", stage: "full_review", status: "report_required", ready: false, issues: [], message: "Upload your complete report. Your estimate is saved.", report: null, canReuseReport: false, locked: false };
const ready: FullReviewState = { ...initial, status: "ready", ready: true, message: "Your report is ready.", report: { id: "report", filename: "insurer.pdf", revision: 4 } };
function show(value = initial) {
  vi.mocked(getFullReview).mockResolvedValue(value);
  return render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><FullReviewReport caseId="case" userId="owner" accessToken="mock-token" /></QueryClientProvider></MemoryRouter>);
}
beforeEach(() => vi.clearAllMocks());
describe("report before payment", () => {
  it("preserves the free result and offers leave/resume without payment", async () => {
    show();
    expect(await screen.findByLabelText("Choose the complete valuation PDF")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to your free estimate" })).toHaveAttribute("href", "/total-loss/cases/case/analysis");
    expect(screen.queryByRole("button", { name: "Continue to secure checkout" })).not.toBeInTheDocument();
    expect(uploadFullReview).not.toHaveBeenCalled(); expect(extractFullReview).not.toHaveBeenCalled();
  });
  it("uploads once and opens payment only after authoritative readiness", async () => {
    show();vi.mocked(uploadFullReview).mockResolvedValue(ready);
    const file = new File(["%PDF-simulated"], "insurer.pdf", { type: "application/pdf" });
    fireEvent.change(await screen.findByLabelText("Choose the complete valuation PDF"), { target: { files: [file] } });
    expect(await screen.findByRole("button", { name: "Continue to secure checkout" })).toBeInTheDocument();
    expect(uploadFullReview).toHaveBeenCalledExactlyOnceWith("case", "mock-token", file);
  });
  it("keeps an incomplete report with a clear replacement action", async () => {
    show({ ...ready, ready: false, status: "report_invalid", message: "Upload the complete report, including comparable vehicles." });
    expect(await screen.findByLabelText("Upload a replacement PDF")).toBeInTheDocument();
    expect(screen.getByText("insurer.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue to secure checkout" })).not.toBeInTheDocument();
  });
  it("resumes the saved report and extraction failure without starting another case", async () => {
    show({ ...ready, ready: false, status: "extraction_failed", message: "Your file is saved." });
    vi.mocked(extractFullReview).mockResolvedValue(ready);
    fireEvent.click(await screen.findByRole("button", { name: "Try reading the saved report again" }));
    expect(await screen.findByRole("button", { name: "Continue to secure checkout" })).toBeInTheDocument();
    expect(uploadFullReview).not.toHaveBeenCalled();
  });
  it("asks only the conflicting fact, preserves the answer on error, then confirms", async () => {
    show({ ...ready, ready: false, status: "needs_confirmation", issues: [{ field: "mileage", code: "REPORT_FACT_CONFLICT", message: "Which mileage should the full review use?", savedValue: 30000, reportValue: 32000 }] });
    vi.mocked(confirmFullReview).mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValueOnce(ready);
    fireEvent.click(await screen.findByRole("radio", { name: /In the report/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and continue" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /In the report/ })).toBeChecked();
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm and continue" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Confirm and continue" }));
    expect(await screen.findByRole("button", { name: "Continue to secure checkout" })).toBeInTheDocument();
    expect(confirmFullReview).toHaveBeenLastCalledWith("case", "mock-token", ready.report, { mileage: "report" });
  });
  it("reuses an earlier uploaded report on explicit continue", async () => {
    show({ ...initial, canReuseReport: true });vi.mocked(extractFullReview).mockResolvedValue(ready);
    fireEvent.click(await screen.findByRole("button", { name: "Use my saved valuation report" }));
    expect(await screen.findByRole("button", { name: "Continue to secure checkout" })).toBeInTheDocument();
    expect(uploadFullReview).not.toHaveBeenCalled();
  });
});
describe("lightweight technical details", () => {
  it("does not show a technical questionnaire for normal manual or decoded values", () => {
    const values = { ...createEmptyTotalLossManualForm(), bodyType: "Sedan", drivetrain: "FWD", engine: "2.0L I4" };
    render(<MemoryRouter><VehicleFactFields values={values} errors={{}} onChange={vi.fn()} /></MemoryRouter>);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
  it("shows only a specifically requested fact on resumed correction", () => {
    render(<MemoryRouter initialEntries={["/start?vehicleFact=drivetrain"]}><VehicleFactFields values={createEmptyTotalLossManualForm()} errors={{}} onChange={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole("combobox", { name: "Drive type" })).toBeInTheDocument();expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
