import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportUploadDialog } from "./report-upload-dialog";
import { fullReviewKey, getFullReview, uploadFullReview, extractFullReview, confirmFullReview, type FullReviewState } from "./api";
import type * as FullReviewApi from "./api";
import { initializeTotalLossClaim } from "@/features/total-loss-claim/api";

vi.mock("@/features/total-loss-claim/api", async original => ({ ...await original<object>(), initializeTotalLossClaim: vi.fn() }));

vi.mock("./api", async importOriginal => ({
  ...await importOriginal<typeof FullReviewApi>(),
  getFullReview: vi.fn(), uploadFullReview: vi.fn(), extractFullReview: vi.fn(), confirmFullReview: vi.fn(),
}));

const base = "/total-loss/cases/saved-case";
const initial: FullReviewState = {
  caseId: "saved-case", stage: "full_review", status: "report_required", ready: false, issues: [], message: "Add your report.",
  report: null, canReuseReport: false, locked: false, analysisInputId: null, analysisInputRevision: null, checkoutAvailable: false,
  paymentReadiness: { status: "not_evaluated", eligible: false, reviewId: null, version: null, digest: null },
};
const saved: FullReviewState = { ...initial, status: "extracting", report: { id: "saved-report", revision: 2, filename: "valuation.pdf" } };
const ready: FullReviewState = { ...saved, status: "ready", ready: true, checkoutAvailable: true, analysisInputId: "current-input", analysisInputRevision: 3, paymentReadiness: { status: "eligible", eligible: true, reviewId: "review", version: "1", digest: "a".repeat(64) } };
const confirmation: FullReviewState = { ...saved, status: "needs_confirmation", issues: [{ field: "mileage", code: "REPORT_FACT_CONFLICT", message: "Which mileage should the full review use?", reportValue: 32000, savedValue: 30000 }] };
function setup(path = `${base}/analysis`, cached?: FullReviewState) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cached) client.setQueryData(fullReviewKey("owner", "saved-case"), cached);
  const router = createMemoryRouter([
    { path: `${base}/analysis`, element: <><h1>Saved free result</h1><ReportUploadDialog caseId="saved-case" userId="owner" accessToken="owner-token" /></> },
    { path: `${base}/review-report`, element: <><h1>Saved free result</h1><ReportUploadDialog caseId="saved-case" userId="owner" accessToken="owner-token" reportWorkspace /></> },
    { path: `${base}/claim/checkout`, element: <h1>Checkout</h1> },
  ], { initialEntries: [path] });
  const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { ...view, router, client, user: userEvent.setup() };
}
function selectPdf() {
  const file = new File(["%PDF-fictional"], "valuation.pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("Choose your valuation report"), { target: { files: [file] } });
  return file;
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getFullReview).mockResolvedValue(initial); });

describe("report upload modal", () => {
  it("reuses an intake report without asking for another upload", async () => {
    vi.mocked(getFullReview).mockResolvedValue({ ...initial, canReuseReport: true });
    vi.mocked(extractFullReview).mockImplementation(async () => {
      vi.mocked(getFullReview).mockResolvedValue(saved);
      return saved;
    });
    const { user } = setup();
    expect(screen.getByRole("button", { name: "Checking saved report…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Upload insurer valuation report" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Review saved report" }));
    expect(await screen.findByRole("heading", { name: "Your valuation report is saved." })).toBeVisible();
    expect(within(screen.getByRole("dialog", { name: "Insurer valuation review" })).getByText(/Continue with the report you already uploaded/)).toBeVisible();
    expect(screen.getByLabelText("Choose your valuation report")).not.toBeVisible();
    expect(extractFullReview).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Use saved report" }));
    expect(await screen.findByRole("heading", { name: "Reading your valuation report." })).toBeVisible();
    expect(extractFullReview).toHaveBeenCalledExactlyOnceWith("saved-case", "owner-token");
    expect(uploadFullReview).not.toHaveBeenCalled();
  });

  it("does not interpret a failed status lookup as a missing report", async () => {
    vi.mocked(getFullReview).mockRejectedValue(new Error("Offline"));
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Open report review" }));
    expect(await screen.findByRole("heading", { name: "We couldn’t open your report." })).toBeVisible();
    expect(screen.queryByLabelText("Choose your valuation report")).not.toBeInTheDocument();
    expect(uploadFullReview).not.toHaveBeenCalled();
  });

  it("keeps the result mounted, preserves history, restores focus, and performs no writes on open", async () => {
    const { user, router } = setup();
    const result = screen.getByRole("heading", { name: "Saved free result" });
    const trigger = await screen.findByRole("button", { name: "Upload insurer valuation report" });
    expect(getFullReview).toHaveBeenCalledOnce();
    await user.click(trigger);
    await screen.findByLabelText("Choose your valuation report");
    expect(await screen.findByRole("dialog", { name: "Insurer valuation review" })).toBeVisible();
    expect(result).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`${base}/analysis`);
    expect(router.state.location.search).toBe("?upload=report");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    await act(async () => { await router.navigate(1); });
    await screen.findByLabelText("Choose your valuation report");
    await act(async () => { await router.navigate(-1); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Saved free result" })).toBe(result);
    expect(uploadFullReview).not.toHaveBeenCalled();
    expect(extractFullReview).not.toHaveBeenCalled();
    expect(confirmFullReview).not.toHaveBeenCalled();
  });

  it("reopens from a refreshed deep link and removes only the modal parameter when closed", async () => {
    const { router, user } = setup(`${base}/analysis?source=saved&upload=report`);
    await screen.findByLabelText("Choose your valuation report");
    await user.click(screen.getByRole("button", { name: "Close report review" }));
    expect(router.state.location.pathname).toBe(`${base}/analysis`);
    expect(router.state.location.search).toBe("?source=saved");
    expect(uploadFullReview).not.toHaveBeenCalled();
  });

  it("validates the PDF before upload and leaves the modal recoverable", async () => {
    setup(`${base}/analysis?upload=report`);
    const input = await screen.findByLabelText("Choose your valuation report");
    fireEvent.change(input, { target: { files: [new File(["invalid"], "photo.png", { type: "image/png" })] } });
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(uploadFullReview).not.toHaveBeenCalled();
  });

  it("keeps the same modal mounted while saving and reading the persisted report", async () => {
    let finish!: () => void;
    vi.mocked(uploadFullReview).mockImplementation(async () => {
      await new Promise<void>(resolve => { finish = resolve; });
      vi.mocked(getFullReview).mockResolvedValue(saved);
      return saved;
    });
    const { user, router } = setup(`${base}/analysis?upload=report`);
    await screen.findByLabelText("Choose your valuation report");
    const dialog = screen.getByRole("dialog");
    const file = selectPdf();
    await waitFor(() => expect(screen.getByRole("button", { name: "Close report review" })).toBeDisabled());
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeVisible();
    await act(async () => { finish(); });
    await within(dialog).findByRole("heading", { name: "Reading your valuation report." });
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(router.state.location.pathname).toBe(`${base}/analysis`);
    expect(router.state.location.search).toBe("?upload=report");
    expect(uploadFullReview).toHaveBeenCalledExactlyOnceWith("saved-case", "owner-token", file);
    expect(extractFullReview).not.toHaveBeenCalled();
    expect(confirmFullReview).not.toHaveBeenCalled();
  });

  it("does not advance on an upload acknowledgement without a persisted report", async () => {
    vi.mocked(uploadFullReview).mockResolvedValue(saved);
    const { router } = setup(`${base}/analysis?upload=report`);
    await screen.findByLabelText("Choose your valuation report");
    selectPdf();
    await waitFor(() => expect(getFullReview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Close report review" })).toBeEnabled());
    expect(router.state.location.search).toBe("?upload=report");
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("allows reopening after browser Back during an in-flight upload", async () => {
    let finish!: () => void;
    vi.mocked(uploadFullReview).mockImplementation(async () => {
      await new Promise<void>(resolve => { finish = resolve; });
      return initial;
    });
    const { router, user } = setup();
    await user.click(await screen.findByRole("button", { name: "Upload insurer valuation report" }));
    await screen.findByLabelText("Choose your valuation report");
    selectPdf();
    await waitFor(() => expect(screen.getByRole("button", { name: "Close report review" })).toBeDisabled());
    await act(async () => { await router.navigate(-1); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Upload insurer valuation report" }));
    await screen.findByLabelText("Choose your valuation report");
    expect(screen.getByRole("dialog")).toBeVisible();
    await act(async () => { finish(); });
    expect(uploadFullReview).toHaveBeenCalledOnce();
  });

  it("recovers a lost upload response through the saved state", async () => {
    vi.mocked(uploadFullReview).mockImplementation(async () => {
      vi.mocked(getFullReview).mockResolvedValue(saved);
      throw new Error("The response was lost after persistence");
    });
    setup(`${base}/analysis?upload=report`);
    await screen.findByLabelText("Choose your valuation report");
    selectPdf();
    await within(screen.getByRole("dialog")).findByRole("heading", { name: "Reading your valuation report." });
    expect(uploadFullReview).toHaveBeenCalledOnce();
  });

  it("waits for a fresh read instead of advancing from a stale cached report", async () => {
    const { router } = setup(`${base}/analysis?upload=report`, saved);
    await screen.findByLabelText("Choose your valuation report");
    expect(router.state.location.search).toBe("?upload=report");
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("keeps invalid and failed reports available for explicit replacement or retry", async () => {
    vi.mocked(getFullReview).mockResolvedValue({ ...saved, status: "report_invalid", message: "Include all valuation pages." });
    const { router } = setup(`${base}/analysis?upload=report`);
    await screen.findByLabelText("Replace report PDF");
    expect(router.state.location.search).toBe("?upload=report");
    expect(uploadFullReview).not.toHaveBeenCalled();
  });

  it("closes after automated checks and continues to payment from the saved result", async () => {
    let state = saved;
    vi.mocked(getFullReview).mockImplementation(async () => state);
    const { client, router, user } = setup(`${base}/analysis?upload=report`);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("heading", { name: "Reading your valuation report." });
    async function refresh(next: FullReviewState) {
      state = next;
      await act(async () => { await client.invalidateQueries({ queryKey: fullReviewKey("owner", "saved-case") }); });
      expect(screen.getByRole("dialog")).toBe(dialog);
      expect(router.state.location.pathname).toBe(`${base}/analysis`);
      expect(router.state.location.search).toBe("?upload=report");
    }
    await refresh(confirmation);
    await user.click(await within(dialog).findByRole("radio", { name: /In the report/ }));
    vi.mocked(confirmFullReview).mockImplementation(async () => {
      state = { ...saved, status: "ready", ready: true, paymentReadiness: { ...initial.paymentReadiness, status: "processing" } };
      return state;
    });
    await user.click(within(dialog).getByRole("button", { name: "Confirm and continue" }));
    await within(dialog).findByRole("heading", { name: "Reviewing your report and evidence." });
    expect(confirmFullReview).toHaveBeenCalledExactlyOnceWith("saved-case", "owner-token", saved.report, { mileage: "report" });
    expect(within(dialog).queryByRole("button", { name: "Continue to payment" })).not.toBeInTheDocument();
    state = ready;
    await act(async () => { await client.invalidateQueries({ queryKey: fullReviewKey("owner", "saved-case") }); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe(`${base}/analysis`);
    expect(router.state.location.search).toBe("");
    const payment = screen.getByRole("button", { name: "Continue to payment" });
    expect(payment).toBeVisible();
    await waitFor(() => expect(payment).toHaveFocus());
    expect(initializeTotalLossClaim).not.toHaveBeenCalled();
    vi.mocked(initializeTotalLossClaim).mockResolvedValue({ state: "secure_required", caseId: "saved-case", contactEmail: "owner@example.test", commerce: null, workflow: null });
    await user.click(payment);
    expect(await screen.findByRole("heading", { name: "Checkout" })).toBeVisible();
    expect(initializeTotalLossClaim).toHaveBeenCalledExactlyOnceWith("saved-case", "owner-token", {
      expectedAnalysisInputId: "current-input", expectedAnalysisInputRevision: 3,
      expectedReportId: "saved-report", expectedReportRevision: 2,
      expectedStrictReviewId: "review", expectedStrictReviewVersion: "1", expectedStrictReviewDigest: "a".repeat(64),
    });
    expect(uploadFullReview).not.toHaveBeenCalled();
    expect(extractFullReview).not.toHaveBeenCalled();
  });

  it("restores an unsubmitted choice on close and reopen, but never transfers it to another report revision", async () => {
    vi.mocked(getFullReview).mockResolvedValue(confirmation);
    const { user } = setup(`${base}/analysis?upload=report`);
    await user.click(await screen.findByRole("radio", { name: /In the report/ }));
    await user.click(screen.getByRole("button", { name: "Close report review" }));
    await user.click(await screen.findByRole("button", { name: "Review saved report" }));
    expect(await screen.findByRole("radio", { name: /In the report/ })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Close report review" }));
    vi.mocked(getFullReview).mockResolvedValue({ ...confirmation, report: { ...confirmation.report!, revision: 3 } });
    await user.click(await screen.findByRole("button", { name: "Review saved report" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: /In the report/ })).not.toBeChecked());
    expect(screen.getByRole("button", { name: "Confirm and continue" })).toBeDisabled();
    expect(confirmFullReview).not.toHaveBeenCalled();
  });

  it.each(["extracting", "needs_confirmation"] as const)("reopens the persisted %s stage directly in the modal", async status => {
    vi.mocked(getFullReview).mockResolvedValue(status === "needs_confirmation" ? confirmation : { ...saved, status });
    setup(`${base}/analysis?upload=report`);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("valuation.pdf");
    expect(uploadFullReview).not.toHaveBeenCalled();
    expect(confirmFullReview).not.toHaveBeenCalled();
    expect(extractFullReview).not.toHaveBeenCalled();
  });

  it("closes after an immediately completed upload and preserves the free result", async () => {
    vi.mocked(uploadFullReview).mockImplementation(async () => { vi.mocked(getFullReview).mockResolvedValue(ready); return ready; });
    const { router } = setup(`${base}/analysis?source=saved&upload=report`);
    const result = screen.getByRole("heading", { name: "Saved free result", hidden: true });
    await screen.findByLabelText("Choose your valuation report");
    selectPdf();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Saved free result" })).toBe(result);
    expect(router.state.location.search).toBe("?source=saved");
    expect(screen.getByRole("button", { name: "Continue to payment" })).toBeVisible();
    expect(initializeTotalLossClaim).not.toHaveBeenCalled();
  });

  it.each(["eligible", "insufficient"] as const)("returns a refreshed completed %s report link to the free result", async status => {
    vi.mocked(getFullReview).mockResolvedValue({ ...ready, checkoutAvailable: status === "eligible", paymentReadiness: { ...ready.paymentReadiness, status, eligible: status === "eligible" } });
    const { router } = setup(`${base}/review-report`);
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/analysis`));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    if (status === "eligible") expect(screen.getByRole("button", { name: "Continue to payment" })).toBeVisible();
    else {
      expect(screen.getByText(/need more reliable evidence/)).toBeVisible();
      expect(screen.queryByRole("button", { name: "Continue to payment" })).not.toBeInTheDocument();
    }
    expect(uploadFullReview).not.toHaveBeenCalled();
    expect(confirmFullReview).not.toHaveBeenCalled();
    expect(initializeTotalLossClaim).not.toHaveBeenCalled();
  });

  it("does not close from cached readiness when a fresh read fails", async () => {
    vi.mocked(getFullReview).mockRejectedValue(new Error("unavailable"));
    const { router } = setup(`${base}/analysis?upload=report`, ready);
    await screen.findByText("We couldn’t open the report details.");
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(router.state.location.search).toBe("?upload=report");
    expect(initializeTotalLossClaim).not.toHaveBeenCalled();
  });

  it("restores payment continuation on a refreshed free result without opening a modal", async () => {
    vi.mocked(getFullReview).mockResolvedValue(ready);
    setup();
    expect(await screen.findByRole("button", { name: "Continue to payment" })).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(initializeTotalLossClaim).not.toHaveBeenCalled();
  });

});
