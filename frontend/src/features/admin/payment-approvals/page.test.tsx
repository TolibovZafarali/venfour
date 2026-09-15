import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPaymentApprovalsPage } from "./page";
import { parsePaymentApprovalCase } from "./service";
import { approvalFixture } from "./test-fixtures";

const service = vi.hoisted(() => ({ list: vi.fn(), decide: vi.fn() }));
vi.mock("@/features/auth", () => ({ useAuth: () => ({ auth: { status: "signedIn", user: { id: "staff-fixture" } } }) }));
vi.mock("@/features/admin/case-operations/dependencies", () => ({ useAdminCaseOperationsDependencies: () => ({ paymentApprovalService: service }) }));
function show() {
  return render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AdminPaymentApprovalsPage /></QueryClientProvider></MemoryRouter>);
}
beforeEach(() => { vi.clearAllMocks(); service.list.mockResolvedValue([parsePaymentApprovalCase(approvalFixture())]); service.decide.mockResolvedValue(undefined); });
describe("launch review queue", () => {
  it("shows the evidence and exact lineage without approving on open", async () => {
    show();
    expect(await screen.findByText("2024 Honda Accord EX")).toBeVisible();
    expect(screen.getByText("$20,000.00")).toBeVisible();
    expect(screen.getByText("3 historical · 4 current")).toBeVisible();
    expect(screen.getByText("Asking prices are not completed sales.")).toBeVisible();
    expect(service.decide).not.toHaveBeenCalled();
  });
  it.each([["Approve payment", "approved"], ["Keep on hold", "held"], ["Decline", "declined"]] as const)("records one explicit %s decision with the reviewed lineage", async (label, decision) => {
    show();
    const button = await screen.findByRole("button", { name: label });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(service.decide).toHaveBeenCalledOnce());
    expect(service.decide).toHaveBeenCalledWith(parsePaymentApprovalCase(approvalFixture()), decision, expect.stringMatching(/^[0-9a-f-]{36}$/u));
    await waitFor(() => expect(service.list).toHaveBeenCalledTimes(2));
  });
  it("removes protected cached records when a refresh denies staff access", async () => {
    show(); await screen.findByText("2024 Honda Accord EX");
    service.list.mockRejectedValue({ code: "42501" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load records");
    expect(screen.queryByRole("button", { name: "Approve payment" })).not.toBeInTheDocument();
    expect(screen.queryByText("Fictional Driver")).not.toBeInTheDocument();
  });
  it("keeps a stale decision closed and reloads the queue", async () => {
    service.decide.mockRejectedValue(new Error("PAYMENT_APPROVAL_STALE"));
    show(); fireEvent.click(await screen.findByRole("button", { name: "Approve payment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be confirmed");
    await waitFor(() => expect(service.list).toHaveBeenCalledTimes(2));
  });
  it("does not let staff approve their own case", async () => {
    service.list.mockResolvedValue([{ ...parsePaymentApprovalCase(approvalFixture()), canApprove: false }]);
    show(); expect(await screen.findByRole("button", { name: "Approve payment" })).toBeDisabled();
    expect(service.decide).not.toHaveBeenCalled();
  });
});
