import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FullReviewReport } from "@/features/full-review/report-review";
import { getFullReview, uploadFullReview, extractFullReview, confirmFullReview, type FullReviewState } from "@/features/full-review/api";
import { VehicleFactFields } from "@/features/total-loss/vehicle-fact-fields";
import { createEmptyTotalLossManualForm } from "@/features/total-loss/types";
import type * as FullReviewApi from "@/features/full-review/api";
const continuation = vi.hoisted(() => vi.fn());

vi.mock("@/features/full-review/api", async importOriginal => ({
  ...await importOriginal<typeof FullReviewApi>(),
  getFullReview: vi.fn(), uploadFullReview: vi.fn(), extractFullReview: vi.fn(), confirmFullReview: vi.fn(),
}));
vi.mock("@/features/total-loss-claim/components/continue-review-action", () => ({ ContinueReviewAction: (props: { label: string }) => { continuation(props); return <button>{props.label}</button>; } }));
const initial: FullReviewState = { caseId: "case", stage: "full_review", status: "report_required", ready: false, issues: [], message: "Upload your complete report. Your estimate is saved.", report: null, canReuseReport: false, locked: false,
  analysisInputId: "22222222-2222-4222-8222-222222222222", analysisInputRevision: 3, checkoutAvailable: false, paymentReadiness: { status: "not_evaluated", eligible: false, reviewId: null, version: null, digest: null } };
const ready: FullReviewState = { ...initial, checkoutAvailable: true, paymentReadiness: { status: "eligible", eligible: true, reviewId: "55555555-5555-4555-8555-555555555555", version: "1", digest: "a".repeat(64) }, status: "ready", ready: true, message: "Your report is ready.", report: { id: "report", filename: "insurer.pdf", revision: 4 } };
function persist(value: FullReviewState) { return async () => { vi.mocked(getFullReview).mockResolvedValue(value); return value; }; }
function show(value = initial) {
  vi.mocked(getFullReview).mockResolvedValue(value);
  return render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><FullReviewReport caseId="case" userId="owner" accessToken="mock-token" /></QueryClientProvider></MemoryRouter>);
}
beforeEach(() => { vi.clearAllMocks(); });
describe("report before payment", () => {
  it.each(["insufficient", "processing", "failed", "not_evaluated", "awaiting_approval"] as const)("keeps facts-ready %s evidence out of checkout", async status => {
    show({ ...ready, checkoutAvailable: false, paymentReadiness: { ...initial.paymentReadiness, status } });
    expect(await screen.findByText("insurer.pdf")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Get my full review" })).not.toBeInTheDocument();
    expect(screen.queryByText(/GOOD|WEAK|LOW|INSUFFICIENT_EVIDENCE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/before payment|no payment has been taken|final Venfour check|final review/i)).not.toBeInTheDocument();
    if (status === "insufficient") expect(screen.getByText(/need more reliable market evidence/)).toBeVisible();
    expect(continuation).not.toHaveBeenCalled();
  });
  it("recovers a lost upload response from persisted state without a reload", async () => {
    show();
    vi.mocked(uploadFullReview).mockImplementation(async () => {
      vi.mocked(getFullReview).mockResolvedValue(ready);
      throw new Error("lost browser response after persistence");
    });
    fireEvent.change(await screen.findByLabelText("Choose your valuation report"), { target: { files: [new File(["%PDF-simulated"], "insurer.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByRole("button", { name: "Get my full review" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(uploadFullReview).toHaveBeenCalledOnce();
  });
  it("ignores an older acknowledgement and reads the newer completed revision", async () => {
    show();
    vi.mocked(uploadFullReview).mockImplementation(async () => {
      vi.mocked(getFullReview).mockResolvedValue({ ...ready, report: { ...ready.report!, revision: 8 } });
      return { ...ready, report: { ...ready.report!, revision: 2 }, ready: false, status: "uploaded" };
    });
    fireEvent.change(await screen.findByLabelText("Choose your valuation report"), { target: { files: [new File(["%PDF-simulated"], "insurer.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByRole("button", { name: "Get my full review" })).toBeVisible();
    expect(continuation).toHaveBeenLastCalledWith(expect.objectContaining({ input: expect.objectContaining({ expectedReportRevision: 8 }) }));
  });
  it.each(["uploading", "uploaded"] as const)("reopens the saved %s state before work is queued and follows completion", async status => {
    show({ ...ready, checkoutAvailable: false, ready: false, status, paymentReadiness: initial.paymentReadiness });
    expect(await screen.findByText("insurer.pdf")).toBeVisible();
    vi.mocked(getFullReview).mockResolvedValue(ready);
    expect(await screen.findByRole("button", { name: "Get my full review" }, { timeout: 4500 })).toBeVisible();
    expect(uploadFullReview).not.toHaveBeenCalled();
    expect(extractFullReview).not.toHaveBeenCalled();
  });
  it("follows an upload that persists its row before the lost response and finishes later", async () => {
    show();
    vi.mocked(uploadFullReview).mockImplementation(async () => {
      vi.mocked(getFullReview).mockResolvedValue({ ...ready, checkoutAvailable: false, ready: false, status: "uploading", paymentReadiness: initial.paymentReadiness });
      throw new Error("Response lost while the accepted file is saving");
    });
    fireEvent.change(await screen.findByLabelText("Choose your valuation report"), { target: { files: [new File(["%PDF-simulated"], "insurer.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByText("insurer.pdf")).toBeVisible();
    vi.mocked(getFullReview).mockResolvedValue(ready);
    expect(await screen.findByRole("button", { name: "Get my full review" }, { timeout: 4500 })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(uploadFullReview).toHaveBeenCalledOnce();
    expect(extractFullReview).not.toHaveBeenCalled();
  });
  it("reopens persisted extraction and polls through completion without another upload", async () => {
    show({ ...ready, checkoutAvailable: false, ready: false, status: "extracting", paymentReadiness: { ...initial.paymentReadiness, status: "processing" } });
    expect(await screen.findByText(/We’re checking your report against the saved market evidence/)).toBeVisible();
    vi.mocked(getFullReview).mockResolvedValue(ready);
    expect(await screen.findByRole("button", { name: "Get my full review" }, { timeout: 4500 })).toBeVisible();
    expect(uploadFullReview).not.toHaveBeenCalled();
    expect(extractFullReview).not.toHaveBeenCalled();
  });
  it("keeps a ready report saved without offering an unavailable production checkout", async () => {
    show({ ...ready, checkoutAvailable: false });
    expect(await screen.findByText(/The full review is not available right now/)).toBeVisible();
    expect(screen.getByText("insurer.pdf")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Get my full review" })).not.toBeInTheDocument();
    expect(continuation).not.toHaveBeenCalled();
  });
  it("passes the current input and report versions to production continuation only when ready", async () => {
    show(ready);
    expect(await screen.findByRole("button", { name: "Get my full review" })).toBeVisible();
    expect(continuation).toHaveBeenLastCalledWith(expect.objectContaining({
      accessToken: "mock-token", caseId: "case", userId: "owner",
      input: { expectedAnalysisInputId: initial.analysisInputId, expectedAnalysisInputRevision: 3,
        expectedReportId: "report", expectedReportRevision: 4, expectedStrictReviewId: ready.paymentReadiness.reviewId,
        expectedStrictReviewVersion: "1", expectedStrictReviewDigest: "a".repeat(64) },
    }));
  });
  it.each([{ analysisInputId: null }, { analysisInputRevision: null }])("preserves a ready legacy report without offering unfenced continuation %o", async missing => {
    show({ ...ready, ...missing });
    expect(await screen.findByText(/The full review is not available right now/)).toBeVisible();
    expect(screen.getByText("insurer.pdf")).toBeVisible();
    expect(continuation).not.toHaveBeenCalled();
  });
  it("preserves the free result and offers leave/resume without payment", async () => {
    show();
    expect(await screen.findByLabelText("Choose your valuation report")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Back to/ })).not.toBeInTheDocument();
    expect(screen.getByText("Need a copy of your report?")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Get my full review" })).not.toBeInTheDocument();
    expect(uploadFullReview).not.toHaveBeenCalled(); expect(extractFullReview).not.toHaveBeenCalled();
  });
  it("uploads once and opens payment only after authoritative readiness", async () => {
    show();vi.mocked(uploadFullReview).mockImplementation(persist(ready));
    const file = new File(["%PDF-simulated"], "insurer.pdf", { type: "application/pdf" });
    fireEvent.change(await screen.findByLabelText("Choose your valuation report"), { target: { files: [file] } });
    expect(await screen.findByRole("button", { name: "Get my full review" })).toBeInTheDocument();
    expect(uploadFullReview).toHaveBeenCalledExactlyOnceWith("case", "mock-token", file);
  });
  it("does not unlock payment just because a report was uploaded", async () => {
    show();
    vi.mocked(uploadFullReview).mockImplementation(persist({ ...ready, checkoutAvailable: false, paymentReadiness: initial.paymentReadiness, status: "uploaded", ready: false, message: "Your report is saved and still needs to be checked." }));
    const file = new File(["%PDF-simulated"], "insurer.pdf", { type: "application/pdf" });
    fireEvent.change(await screen.findByLabelText("Choose your valuation report"), { target: { files: [file] } });
    expect(await screen.findByRole("button", { name: "Read report again" })).toBeVisible();
    expect(screen.getByText("insurer.pdf")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Get my full review" })).not.toBeInTheDocument();
    expect(extractFullReview).not.toHaveBeenCalled();
    expect(confirmFullReview).not.toHaveBeenCalled();
  });
  it("keeps an incomplete report with a clear replacement action", async () => {
    show({ ...ready, ready: false, status: "report_invalid", message: "Upload the complete report, including comparable vehicles." });
    expect(await screen.findByLabelText("Replace report PDF")).toBeInTheDocument();
    expect(screen.getByText("insurer.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Get my full review" })).not.toBeInTheDocument();
  });
  it("resumes the saved report and extraction failure without starting another case", async () => {
    show({ ...ready, ready: false, status: "extraction_failed", message: "Your file is saved." });
    vi.mocked(extractFullReview).mockImplementation(persist(ready));
    fireEvent.click(await screen.findByRole("button", { name: "Read report again" }));
    expect(await screen.findByRole("button", { name: "Get my full review" })).toBeInTheDocument();
    expect(uploadFullReview).not.toHaveBeenCalled();
  });
  it("asks only the conflicting fact, preserves the answer on error, then confirms", async () => {
    show({ ...ready, ready: false, status: "needs_confirmation", issues: [{ field: "mileage", code: "REPORT_FACT_CONFLICT", message: "Which mileage should the full review use?", savedValue: 30000, reportValue: 32000 }] });
    vi.mocked(confirmFullReview).mockRejectedValueOnce(new Error("temporary failure")).mockImplementationOnce(persist(ready));
    fireEvent.click(await screen.findByRole("radio", { name: /In the report/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and continue" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /In the report/ })).toBeChecked();
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm and continue" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Confirm and continue" }));
    expect(await screen.findByRole("button", { name: "Get my full review" })).toBeInTheDocument();
    expect(confirmFullReview).toHaveBeenLastCalledWith("case", "mock-token", ready.report, { mileage: "report" });
  });
  it("reuses an earlier uploaded report on explicit continue", async () => {
    show({ ...initial, canReuseReport: true });vi.mocked(extractFullReview).mockImplementation(persist(ready));
    fireEvent.click(await screen.findByRole("button", { name: "Use saved report" }));
    expect(await screen.findByRole("button", { name: "Get my full review" })).toBeInTheDocument();
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
