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
      interaction: "link",
      details: [],
      attachment: "",
      preview: {
        html: "<h1>Fictional preview</h1>",
        text: "Fictional plain text",
        subject: "Your detailed Venfour review is ready",
        version: "v1",
      },
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
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(communicationsService, "overview").mockResolvedValue(
    structuredClone(data),
  );
  vi.spyOn(communicationsService, "operation").mockResolvedValue({});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("Communications workspace", () => {
  it("shows sandboxed previews and plain text without sending", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Communications" }),
    ).toBeVisible();
    const opener = await screen.findByRole("button", {
      name: "Preview Your detailed Venfour review is ready",
    });
    expect(
      screen.queryByRole("heading", { name: "Rollout controls" }),
    ).not.toBeInTheDocument();
    expect(communicationsService.operation).not.toHaveBeenCalled();
    await user.click(opener);
    expect(
      await screen.findByTitle(
        "Email preview: Your detailed Venfour review is ready",
      ),
    ).toHaveAttribute("sandbox", "");
    expect(
      screen.getByRole("button", { name: "Send preview to myself" }),
    ).toBeDisabled();
    const frame = screen.getByTitle(
      "Email preview: Your detailed Venfour review is ready",
    );
    expect(frame).toHaveAttribute("srcdoc", data.templates[0].preview.html);
    expect(frame).toHaveAttribute("width", "640");
    await user.click(screen.getByRole("button", { name: "Mobile" }));
    expect(frame).toHaveAttribute("width", "375");
    expect(frame).toHaveAttribute("srcdoc", data.templates[0].preview.html);
    await user.click(screen.getByRole("button", { name: "Plain text" }));
    expect(await screen.findByText("Fictional plain text")).toBeVisible();
    expect(communicationsService.operation).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(opener).toHaveFocus();
  });
  it("includes future templates automatically and filters by group and search", async () => {
    const future = {
      ...data.templates[0],
      key: "future_notice",
      subject: "A future security notice",
      identity: "auth",
      interaction: "notice" as const,
    };
    vi.mocked(communicationsService.overview).mockResolvedValue({
      ...structuredClone(data),
      templates: [...data.templates, future],
    });
    const user = userEvent.setup();
    renderPage();
    expect(
      await screen.findByRole("button", {
        name: "Preview A future security notice",
      }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Account security/ }));
    expect(
      screen.queryByRole("button", {
        name: "Preview Your detailed Venfour review is ready",
      }),
    ).not.toBeInTheDocument();
    await user.type(
      screen.getByRole("searchbox", { name: "Find an email" }),
      "nothing matches",
    );
    expect(screen.getByRole("status")).toHaveTextContent("No emails match");
    expect(communicationsService.operation).not.toHaveBeenCalled();
  });
  it("only sends a sample after the explicit test action", async () => {
    vi.mocked(communicationsService.overview).mockResolvedValue({
      ...structuredClone(data),
      configuration: { ...data.configuration, test_send_configured: true },
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(
      await screen.findByRole("button", {
        name: "Preview Your detailed Venfour review is ready",
      }),
    );
    expect(communicationsService.operation).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Send preview to myself" }),
    );
    await waitFor(() =>
      expect(communicationsService.operation).toHaveBeenCalledWith(
        expect.any(String),
        "test_send",
        {
          template_key: "paid_review_ready",
          request_id: expect.stringMatching(/^[a-f0-9-]{36}$/),
        },
      ),
    );
    expect(
      await screen.findByText("Preview accepted by the configured provider."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Send preview to myself" }),
    ).toBeDisabled();
  });
  it("sends version-fenced settings only after an explicit action", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Communications" });
    await user.click(
      await screen.findByRole("button", { name: "Delivery settings" }),
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
