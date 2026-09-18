import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CASE_ID,
  createAdminAuthHarness,
  createAdminStaffSession,
  createAdminTestDependencies,
} from "@/features/admin/operations/test-fixtures";
import { renderTestApp } from "@/test/render";

import { communicationsService } from "./service";

afterEach(() => vi.restoreAllMocks());

describe("staff email history", () => {
  it("shows delivery metadata without loading email bodies or template designs", async () => {
    const history = vi.spyOn(communicationsService, "history").mockResolvedValue({
      items: [{
        id: "11111111-1111-4111-8111-111111111111",
        source: "lifecycle",
        templateKey: "report_delivery",
        recipient: "customer@example.com",
        subject: "Your Venfour report is ready",
        status: "accepted",
        attempts: 1,
        createdAt: "2026-09-17T18:13:00.000Z",
        acceptedAt: "2026-09-17T18:13:02.000Z",
        deliveryStatus: "delivered",
        caseId: CASE_ID,
      }],
    });

    renderTestApp(["/admin/emails"], {
      adminCaseOperationsDependencies: createAdminTestDependencies(),
      authService: createAdminAuthHarness(createAdminStaffSession()).service,
    });

    expect(await screen.findByRole("heading", { name: "Email history" })).toBeVisible();
    expect(await screen.findByText("customer@example.com")).toBeVisible();
    expect(screen.getByText("Delivered")).toBeVisible();
    expect(screen.getByRole("link", { name: "#33333333" })).toHaveAttribute(
      "href",
      `/admin/cases/${CASE_ID}?tab=reports`,
    );
    expect(screen.getByText(/Message bodies and template designs are not shown here/u)).toBeVisible();
    await waitFor(() => expect(history).toHaveBeenCalledWith("staff-access-token", expect.any(AbortSignal)));
  });

  it("does not show queued email as accepted or sent", async () => {
    vi.spyOn(communicationsService, "history").mockResolvedValue({ items: [{
      id: "queued", source: "lifecycle", templateKey: "intake_reminder",
      recipient: "customer@example.com", subject: null, status: "queued", attempts: 0,
      createdAt: "2026-09-17T18:13:00.000Z", acceptedAt: null, deliveryStatus: null, caseId: null,
    }] });
    renderTestApp(["/admin/emails"], {
      adminCaseOperationsDependencies: createAdminTestDependencies(),
      authService: createAdminAuthHarness(createAdminStaffSession()).service,
    });
    expect(await screen.findByText("Queued")).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Provider accepted" })).toBeVisible();
    expect(screen.getByText("Not recorded")).toBeVisible();
    expect(screen.getByText(/Sign-in emails sent directly/u)).toBeVisible();
  });
});
