import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderTestApp } from "@/test/render";

import { RecordFacts } from "./collection";
import { createAdminAuthHarness, createAdminRow, createAdminStaffSession, createAdminTestDependencies } from "./test-fixtures";
import type { AdminRow } from "./types";

const FIRST_REPORT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECOND_REPORT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function setup() {
  const first = createAdminRow({ id: FIRST_REPORT, title: "First valuation report", kind: "generated", status: "published", facts: [{ label: "Version", value: "1" }], sections: [] });
  const second = createAdminRow({ id: SECOND_REPORT, title: "Second valuation report", kind: "generated", status: "reviewing", facts: [{ label: "Version", value: "2" }], sections: [] });
  const dependencies = createAdminTestDependencies({ rows: { reports: [first, second] } });
  const auth = createAdminAuthHarness(createAdminStaffSession());
  const view = renderTestApp(["/admin/reports"], { adminCaseOperationsDependencies: dependencies, authService: auth.service });
  return { ...view, dependencies, auth, first, second };
}

describe("on-demand staff record inspection", () => {
  it("keeps financial identifiers and storage metadata collapsed while showing operational facts", async () => {
    const user = userEvent.setup();
    const transactionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const reversalId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    render(<RecordFacts item={createAdminRow({
      facts: [{ label: "Version", value: "2" }, { label: "Current published version", value: "true" }],
      sections: [{ title: "Transaction · refund_reversal", facts: [
        { label: "Amount", value: "USD 14900 minor units" },
        { label: "Status", value: "succeeded" },
        { label: "Related transaction ID", value: transactionId },
        { label: "Refund reversal transaction ID", value: reversalId },
        { label: "Storage object", value: "private/order-evidence.json" },
        { label: "Schema version", value: "ledger-v1" },
      ] }],
    })} />);
    expect(screen.getByRole("heading", { name: "Transaction · Refund reversal" })).toBeVisible();
    expect(screen.getByText("2")).toBeVisible();
    expect(screen.getByText("Yes")).toBeVisible();
    expect(screen.getByText(/USD\s149\.00/u)).toBeVisible();
    expect(screen.getByText("Succeeded")).toBeVisible();
    for (const value of [transactionId, reversalId, "private/order-evidence.json", "ledger-v1"]) expect(screen.getByText(value)).not.toBeVisible();
    const section = screen.getByRole("heading", { name: "Transaction · Refund reversal" }).closest("section");
    if (!section) throw new Error("Transaction section is missing.");
    await user.click(within(section).getByText("Technical details"));
    for (const value of [transactionId, reversalId, "private/order-evidence.json", "ledger-v1"]) expect(screen.getByText(value)).toBeVisible();
  });

  it("loads only the expanded record and replaces details when another row opens", async () => {
    const user = userEvent.setup();
    const { dependencies, first, second } = setup();
    let resolveFirst: (row: AdminRow) => void = () => undefined;
    const firstRequest = new Promise<AdminRow>(resolve => { resolveFirst = resolve; });
    vi.mocked(dependencies.operationsService.record).mockImplementation(async (_resource, id) => id === FIRST_REPORT ? firstRequest : { ...second, facts: [{ label: "Detail", value: "Second record metadata" }] });
    await screen.findByText("First valuation report");
    expect(dependencies.operationsService.record).not.toHaveBeenCalled();
    const row = screen.getByRole("row", { name: /First valuation report/u });
    const firstButton = row.querySelector("button");
    if (!firstButton) throw new Error("Record inspection control is missing.");
    await user.click(firstButton);
    expect(await screen.findByText("Loading record details…")).toBeInTheDocument();
    expect(dependencies.operationsService.record).toHaveBeenCalledExactlyOnceWith("reports", FIRST_REPORT);
    await act(async () => resolveFirst({ ...first, facts: [{ label: "Detail", value: "First record metadata" }] }));
    expect(await screen.findByText("First record metadata")).toBeVisible();
    const secondRow = screen.getByRole("row", { name: /Second valuation report/u });
    const secondButton = secondRow.querySelector("button");
    if (!secondButton) throw new Error("Record inspection control is missing.");
    await user.click(secondButton);
    expect(await screen.findByText("Second record metadata")).toBeVisible();
    expect(screen.queryByText("First record metadata")).not.toBeInTheDocument();
    expect(dependencies.operationsService.record).toHaveBeenCalledTimes(2);
    expect(dependencies.operationsService.record).toHaveBeenLastCalledWith("reports", SECOND_REPORT);
  });

  it("keeps inspected metadata after connection failure and removes it on sign-out", async () => {
    const user = userEvent.setup();
    const { dependencies, auth, first, queryClient } = setup();
    vi.mocked(dependencies.operationsService.record).mockResolvedValue({ ...first, facts: [{ label: "Detail", value: "Protected report metadata" }] });
    await screen.findByText("First valuation report");
    const firstButton = screen.getByRole("row", { name: /First valuation report/u }).querySelector("button");
    if (!firstButton) throw new Error("Record inspection control is missing.");
    await user.click(firstButton);
    expect(await screen.findByText("Protected report metadata")).toBeVisible();
    vi.mocked(dependencies.operationsService.record).mockRejectedValueOnce(new Error("Connection interrupted"));
    await user.click(screen.getByRole("button", { name: "Refresh details" }));
    expect(await screen.findByText("The latest refresh failed. These previously loaded records may be out of date.")).toBeVisible();
    expect(screen.getByText("Protected report metadata")).toBeVisible();
    await act(async () => auth.emit(null, "SIGNED_OUT"));
    expect(await screen.findByRole("heading", { name: "Sign in to continue." })).toBeVisible();
    expect(screen.queryByText("Protected report metadata")).not.toBeInTheDocument();
    await waitFor(() => expect(queryClient.getQueryCache().getAll().filter(query => query.queryKey.includes("record"))).toHaveLength(0));
  });
});
