import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalContinueAction } from "./local-continue-action";
import { initializeTotalLossClaim } from "@/features/total-loss-claim/api";

vi.mock("@/features/total-loss-claim/api", async (original) => ({
  ...await original<object>(), initializeTotalLossClaim: vi.fn(),
}));

function setup() {
  return render(<QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={["/preview"]}><Routes>
      <Route path="/preview" element={<LocalContinueAction accessToken="test-token" caseId="case-id" userId="owner-id" />} />
      <Route path="/total-loss/cases/case-id/claim/checkout" element={<h1>Combined purchase page</h1>} />
    </Routes></MemoryRouter>
  </QueryClientProvider>);
}

afterEach(() => vi.resetAllMocks());
describe("local continuation", () => {
  it("disables duplicate clicks while pending and goes directly to the combined purchase page", async () => {
    let finish!: (value: Awaited<ReturnType<typeof initializeTotalLossClaim>>) => void;
    vi.mocked(initializeTotalLossClaim).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    setup();
    const button = screen.getByRole("button", { name: "Continue my review" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(initializeTotalLossClaim).toHaveBeenCalledTimes(1);
    finish({ state: "secure_required", caseId: "case-id", contactEmail: "test@example.test", commerce: null, workflow: null });
    expect(await screen.findByRole("heading", { name: "Combined purchase page" })).toBeVisible();
  });

  it("stays on the preview, focuses failure, and retries without losing the result", async () => {
    vi.mocked(initializeTotalLossClaim).mockRejectedValueOnce(new Error("unavailable"));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Continue my review" }));
    const failure = await screen.findByRole("alert");
    await waitFor(() => expect(failure).toHaveFocus());
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    vi.mocked(initializeTotalLossClaim).mockResolvedValueOnce({ state: "secure_required", caseId: "case-id", contactEmail: "test@example.test", commerce: null, workflow: null });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading")).toHaveTextContent("Combined purchase page");
    expect(initializeTotalLossClaim).toHaveBeenCalledTimes(2);
  });
});
