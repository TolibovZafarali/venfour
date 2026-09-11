import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAdminAuthHarness,
  createAdminStaffSession,
  createAdminTestDependencies,
} from "@/features/admin/operations/test-fixtures";
import { renderTestApp } from "@/test/render";
import { communicationsService, type CommunicationsOverview } from "./service";
const data: CommunicationsOverview = {
  settings: {
    mode: "disabled",
    enrolled_after: null,
    activated_at: null,
    revision: 1,
  },
  configuration: {
    provider: "disabled",
    mode: "disabled",
    error: null,
    auth_hook_enabled: false,
    webhook_configured: false,
    test_send_configured: false,
    app_origin: "https://example.test",
    identities: [
      {
        name: "customer",
        from: "Venfour <updates@example.test>",
        reply_to: "support@example.test",
      },
    ],
  },
  templates: [
    {
      key: "paid_review_ready",
      subject: "Your detailed Venfour review is ready",
      heading: "Your review is ready",
      paragraphs: ["Fictional preview"],
      action: "View review",
      category: "transactional",
      identity: "customer",
      trigger: "Current published report",
      version: "v1",
    },
  ],
  automations: [
    {
      template_key: "paid_review_ready",
      enabled: true,
      delay_seconds: 0,
      category: "transactional",
      revision: 1,
    },
  ],
  activity: [
    {
      id: "example-id",
      source: "lifecycle",
      template_key: "paid_review_ready",
      status: "accepted",
      attempts: 1,
      created_at: "2026-09-11T12:00:00Z",
      delivery_status: "email.delivered",
    },
  ],
  partner_activity: [],
  preview_activity: [],
  suppression_count: 0,
};
function renderPage() {
  const auth = createAdminAuthHarness(createAdminStaffSession());
  return renderTestApp(["/admin/communications"], {
    authService: auth.service,
    adminCaseOperationsDependencies: createAdminTestDependencies(),
  });
}
beforeEach(() => {
  vi.spyOn(communicationsService, "overview").mockResolvedValue(
    structuredClone(data),
  );
  vi.spyOn(communicationsService, "operation").mockImplementation(
    async (_token, action) => {
      if (action === "preview")
        return {
          html: "<h1>Fictional preview</h1>",
          text: "Fictional plain text",
          subject: data.templates[0].subject,
          version: "v1",
        } as never;
      return {} as never;
    },
  );
});
afterEach(() => vi.restoreAllMocks());
describe("Communications workspace", () => {
  it("shows sandboxed previews and plain text without sending", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Communications" }),
    ).toBeVisible();
    expect(
      await screen.findByTitle(
        "Email preview: Your detailed Venfour review is ready",
      ),
    ).toHaveAttribute("sandbox", "");
    expect(
      screen.getByRole("button", { name: "Send preview to myself" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Show plain text" }));
    expect(await screen.findByText("Fictional plain text")).toBeVisible();
    expect(
      vi
        .mocked(communicationsService.operation)
        .mock.calls.every((call) => call[1] === "preview"),
    ).toBe(true);
  });
  it("sends version-fenced settings only after an explicit action", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Communications" });
    await user.click(
      await screen.findByRole("button", { name: "Automations" }),
    );
    await user.click(screen.getByRole("button", { name: "Use dry run" }));
    await waitFor(() =>
      expect(communicationsService.operation).toHaveBeenCalledWith(
        expect.any(String),
        "settings",
        { mode: "dry_run", revision: 1 },
      ),
    );
  });
  it("shows actual delivery status and omits customer identities", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Communications" });
    await user.click(
      await screen.findByRole("button", { name: "Delivery activity" }),
    );
    expect(screen.getByRole("cell", { name: "delivered" })).toBeVisible();
    expect(screen.queryByText("current@example.test")).not.toBeInTheDocument();
  });
  it("hides protected state on authorization failure", async () => {
    vi.mocked(communicationsService.overview).mockRejectedValue(
      new Error("Access denied"),
    );
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "staff access has changed",
    );
    expect(
      screen.queryByText("Venfour <updates@example.test>"),
    ).not.toBeInTheDocument();
  });
});
