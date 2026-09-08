import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { AdminTable } from "./page-ui";
import { adminRecordColumns } from "./record-columns";
import { createAdminRow } from "./test-fixtures";
import type { AdminRow } from "./types";
import type { AdminCollectionResource } from "./collection";

function renderRecords(resource: AdminCollectionResource, items: readonly AdminRow[]) {
  render(<MemoryRouter><AdminTable label={resource} columns={adminRecordColumns({ resource, origin: `/admin/${resource}`, sort: "updated", expandedId: null, onToggle: () => {} })} items={items} itemKey={item => item.id} /></MemoryRouter>);
}

describe("operational table summaries", () => {
  it("distinguishes an unpublished current report from a previously published superseded report", () => {
    renderRecords("reports", [
      createAdminRow({ id: "current", title: "Current draft", kind: "generated", status: "generated", facts: [{ label: "Published at", value: null }, { label: "Current version", value: "true" }] }),
      createAdminRow({ id: "old", title: "Earlier report", kind: "generated", status: "superseded", facts: [{ label: "Published at", value: "2026-09-01T12:00:00Z" }, { label: "Current version", value: "false" }, { label: "Superseded", value: "true" }] }),
    ]);
    const current = screen.getByRole("row", { name: /Current draft/u });
    expect(within(current).getByText("Not published")).toBeVisible();
    expect(within(current).getByText("Current version")).toBeVisible();
    const old = screen.getByRole("row", { name: /Earlier report/u });
    expect(within(old).getByText("Published")).toBeVisible();
    expect(within(old).getByText("Superseded version")).toBeVisible();
  });

  it("shows recorded access independently from a refunded order, with currency and mode", () => {
    renderRecords("payments", [createAdminRow({ status: "refunded", facts: [
      { label: "Amount", value: "USD 14900 minor units" }, { label: "Mode", value: "Test" },
      { label: "Access status", value: "active" }, { label: "Access reason", value: "REFUND_ACCESS_RETAINED" },
    ] })]);
    expect(screen.getByText("USD 149.00")).toBeVisible();
    expect(screen.getByText("Test")).toBeVisible();
    expect(screen.getByText("Refunded")).toBeVisible();
    expect(screen.getByText("Active")).toBeVisible();
    expect(screen.getByText("Refund access retained")).toBeVisible();
  });

  it("keeps a historical failure separate from the current job and displays its recorded retry facts", () => {
    renderRecords("processing", [createAdminRow({ kind: "initial_analysis", status: "failed", facts: [
      { label: "Current", value: "false" }, { label: "Attempts", value: "3" },
      { label: "Retryable", value: "false" }, { label: "Failure", value: "PROVIDER_TIMEOUT" },
    ] })]);
    expect(screen.getByText("Historical job")).toBeVisible();
    expect(screen.queryByText("Current job")).not.toBeInTheDocument();
    expect(screen.getByText("Provider timeout")).toBeVisible();
    expect(screen.getByText("No")).toBeVisible();
  });

  it("does not infer missing publication facts", () => {
    renderRecords("reports", [createAdminRow({ kind: "generated", status: "generated", facts: [] })]);
    expect(screen.getByText("Publication not recorded")).toBeVisible();
    expect(screen.queryByText("Not published")).not.toBeInTheDocument();
  });
});
