import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminOperationsQueryKeys } from "@/features/admin/operations/queries";
import {
  ADMIN_TIME,
  CASE_ID,
  OWNER_USER_ID,
  STAFF_USER_ID,
  createAdminAuthHarness,
  createAdminRow,
  createAdminStaffSession,
  createAdminTestDependencies,
} from "@/features/admin/operations/test-fixtures";
import { renderTestApp } from "@/test/render";

const SECOND_CUSTOMER = "77777777-7777-4777-8777-777777777777";
const GUEST_CUSTOMER = "88888888-8888-4888-8888-888888888888";

function renderWorkspace(path = "/admin", dependencies = createAdminTestDependencies()) {
  const auth = createAdminAuthHarness(createAdminStaffSession());
  return { ...renderTestApp([path], { adminCaseOperationsDependencies: dependencies, authService: auth.service }), dependencies, auth };
}

beforeEach(() => {
  localStorage.removeItem("venfour.admin.sidebar.collapsed");
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("admin operations workspace", () => {
  it("opens an overview with a working destination for every sidebar link", async () => {
    const user = userEvent.setup();
    const { router, dependencies } = renderWorkspace();
    expect(await screen.findByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Overview", level: 1 })).not.toHaveClass("sr-only");
    expect(screen.queryByText("Read-only access")).not.toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText("Overview")).toHaveAttribute("aria-current", "page");
    expect(within(screen.getByRole("main")).getByRole("button", { name: "Refresh" })).toBeVisible();
    const nav = screen.getByRole("navigation", { name: "Admin navigation" });
    expect(within(nav).getAllByRole("link")).toHaveLength(8);
    for (const [label, path] of [
      ["Cases", "/admin/cases"], ["Needs attention", "/admin/cases"],
      ["Customers", "/admin/customers"], ["Reports", "/admin/reports"],
      ["Processing", "/admin/processing"], ["Payments", "/admin/payments"],
      ["Activity", "/admin/activity"], ["Overview", "/admin"],
    ]) {
      await user.click(within(nav).getByRole("link", { name: label }));
      expect(await screen.findByRole("heading", { name: label, level: 1 })).toBeVisible();
      expect(router.state.location.pathname).toBe(path);
      expect(within(nav).getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
      expect(within(screen.getByRole("main")).getByRole("button", { name: "Refresh" })).toBeVisible();
    }
    expect(dependencies.caseService.listCases).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Open Venfour" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
    expect(screen.queryByText("Diminished value")).not.toBeInTheDocument();
  });

  it("collapses from inside the sidebar and reopens from its logo without navigating", async () => {
    const user = userEvent.setup();
    const view = renderWorkspace();
    await screen.findByRole("heading", { name: "Overview", level: 1 });
    const sidebar = screen.getByRole("complementary", { name: "Staff workspace" });
    const collapse = within(sidebar).getByRole("button", { name: "Collapse sidebar" });
    expect(collapse.closest(".admin-sidebar-brand")).toContainElement(within(sidebar).getByRole("link", { name: "Venfour admin overview" }));
    await user.click(collapse);
    expect(localStorage.getItem("venfour.admin.sidebar.collapsed")).toBe("true");
    const expand = within(sidebar).getByRole("button", { name: "Expand sidebar" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(expand.querySelector("img")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collapse sidebar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Venfour admin overview" })).not.toBeInTheDocument();
    await waitFor(() => expect(expand).toHaveFocus());
    expect(screen.getByRole("link", { name: "Cases" })).toHaveAttribute("href", "/admin/cases");
    view.unmount();
    const { router } = renderWorkspace("/admin/reports");
    await screen.findByRole("heading", { name: "Reports", level: 1 });
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");
    screen.getByRole("button", { name: "Expand sidebar" }).focus();
    await user.keyboard("{Enter}");
    expect(localStorage.getItem("venfour.admin.sidebar.collapsed")).toBe("false");
    expect(router.state.location.pathname).toBe("/admin/reports");
    await waitFor(() => expect(screen.getByRole("button", { name: "Collapse sidebar" })).toHaveFocus());
  });

  it("supports the navigation drawer with Escape and restores focus to its trigger", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole("heading", { name: "Overview", level: 1 });
    const trigger = screen.getByRole("button", { name: "Open navigation" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Admin navigation" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    const secondDialog = await screen.findByRole("dialog", { name: "Admin navigation" });
    await user.click(within(secondDialog).getByRole("link", { name: "Customers" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByRole("heading", { name: "Customers", level: 1 })).toBeVisible();
    expect(trigger).toHaveFocus();
  });

  it("preserves list pagination in the URL and resets it for search and ownership filters", async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 51 }, (_, index) => createAdminRow({ id: `90000000-0000-4000-8000-${String(index).padStart(12, "0")}`, caseId: `90000000-0000-4000-8000-${String(index).padStart(12, "0")}`, title: `Customer ${index}`, subtitle: `customer${index}@example.com` }));
    rows.push(createAdminRow());
    const dependencies = createAdminTestDependencies({ rows: { cases: rows } });
    const { router } = renderWorkspace("/admin/cases?page=2&sort=created", dependencies);
    expect(await screen.findByText("Page 2 of 2")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    expect(await screen.findByText("Page 1 of 2")).toBeVisible();
    expect(new URLSearchParams(router.state.location.search).get("page")).toBe("1");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Page 2 of 2")).toBeVisible();
    await user.type(screen.getByRole("searchbox", { name: "Search cases" }), "Ada");
    expect(await screen.findByRole("link", { name: "Ada Lovelace" })).toBeVisible();
    expect(new URLSearchParams(router.state.location.search).get("page")).toBeNull();
    expect(new URLSearchParams(router.state.location.search).get("q")).toBe("Ada");
    await user.selectOptions(screen.getByRole("combobox", { name: "Case ownership" }), "guest");
    expect(await screen.findByRole("heading", { name: "No matching records" })).toBeVisible();
    await waitFor(() => expect(dependencies.operationsService.list).toHaveBeenLastCalledWith("cases", expect.objectContaining({ search: "Ada", page: 1, sort: "created", filters: { identity: "guest" } })));
    await user.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    expect(await screen.findByText("Page 1 of 2")).toBeVisible();
    expect(new URLSearchParams(router.state.location.search).has("q")).toBe(false);
  });

  it("opens compact filters without changing the selected URL state", async () => {
    const user = userEvent.setup();
    const { router } = renderWorkspace("/admin/cases?view=attention");
    await screen.findByRole("heading", { name: "Needs attention", level: 1 });
    const toggle = screen.getByRole("button", { name: "Filters (1 active)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("combobox", { name: "Attention filter" })).toHaveValue("true");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(router.state.location.search).toBe("?view=attention");
  });

  it("opens case details and returns to the same attention filter and search", async () => {
    const user = userEvent.setup();
    const dependencies = createAdminTestDependencies({ rows: { cases: [createAdminRow({ attentionReasons: ["REPORT_REVIEW_HOLD"] })] } });
    const { router } = renderWorkspace("/admin/cases?view=attention&q=Ada", dependencies);
    await user.click(await screen.findByRole("link", { name: "Open case" }));
    expect(await screen.findByRole("heading", { name: "Total-loss case #33333333" })).toBeVisible();
    expect(dependencies.operationsService.case).toHaveBeenCalledWith(CASE_ID);
    await user.click(screen.getByRole("tab", { name: "Reports" }));
    expect(new URLSearchParams(router.state.location.search).get("tab")).toBe("reports");
    await waitFor(() => expect(dependencies.operationsService.list).toHaveBeenCalledWith("reports", expect.objectContaining({ filters: { caseId: CASE_ID } })));
    await user.click(screen.getByRole("link", { name: "Back to cases" }));
    expect(await screen.findByRole("heading", { name: "Needs attention", level: 1 })).toBeVisible();
    expect(router.state.location.search).toBe("?view=attention&q=Ada");
  });

  it("includes registered accounts without cases and separates guests by identity", async () => {
    const user = userEvent.setup();
    const dependencies = createAdminTestDependencies({ rows: { customers: [
      createAdminRow({ id: SECOND_CUSTOMER, customerId: SECOND_CUSTOMER, caseId: null, title: "Registered no case", subtitle: "new@example.com", status: "unverified", kind: "account", caseCount: 0, verified: false }),
      createAdminRow({ id: GUEST_CUSTOMER, customerId: GUEST_CUSTOMER, caseId: null, title: "Guest visitor", subtitle: null, status: "unverified", kind: "guest", identity: "guest", caseCount: 1, verified: false }),
    ] } });
    const { router } = renderWorkspace("/admin/customers", dependencies);
    expect(await screen.findByRole("link", { name: "Registered no case" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Guest visitor" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Registered no case" }));
    expect(await screen.findByRole("heading", { name: "Registered no case" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`/admin/customers/${SECOND_CUSTOMER}`);
    await waitFor(() => expect(dependencies.operationsService.list).toHaveBeenCalledWith("cases", expect.objectContaining({ filters: { customerId: SECOND_CUSTOMER } })));
    await user.click(screen.getByRole("link", { name: "Back to customers" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Identity type" }), "guest");
    expect(await screen.findByRole("link", { name: "Guest visitor" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Registered no case" })).not.toBeInTheDocument();
  });

  it("distinguishes empty records, unavailable service, and missing customer details", async () => {
    const empty = renderWorkspace("/admin/reports");
    expect(await screen.findByRole("heading", { name: "No reports" })).toBeVisible();
    empty.unmount();
    const dependencies = createAdminTestDependencies();
    const unavailable = renderTestApp(["/admin/reports"], { adminCaseOperationsDependencies: { caseService: dependencies.caseService }, authService: createAdminAuthHarness(createAdminStaffSession()).service });
    expect(await screen.findByRole("heading", { name: "Operations unavailable" })).toBeVisible();
    unavailable.unmount();
    renderWorkspace(`/admin/customers/${SECOND_CUSTOMER}`, dependencies);
    expect(await screen.findByRole("heading", { name: "Customer unavailable" })).toBeVisible();
  });

  it("keeps report publication, supersession, and source metadata explicit without download actions", async () => {
    const user = userEvent.setup();
    const dependencies = createAdminTestDependencies({ rows: { reports: [createAdminRow({ id: "report:current", title: "Report version 2", kind: "generated", status: "generated", facts: [{ label: "Published at", value: null }, { label: "Current version", value: "true" }], sections: [{ title: "Version metadata", facts: [{ label: "Superseded", value: "false" }, { label: "Generated at", value: ADMIN_TIME }] }] })] } });
    renderWorkspace("/admin/reports", dependencies);
    await screen.findByRole("button", { name: "View details" });
    expect(dependencies.operationsService.record).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "View details" }));
    expect(await screen.findByText("Generated at")).toBeVisible();
    expect(dependencies.operationsService.record).toHaveBeenCalledWith("reports", "report:current");
    expect(screen.queryByRole("button", { name: /download|approve|retry/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open case #33333333" })).toHaveAttribute("href", `/admin/cases/${CASE_ID}?tab=reports`);
  });

  it("purges the new operations cache when the session signs out", async () => {
    const { queryClient, auth } = renderWorkspace("/admin/customers");
    expect(await screen.findByRole("link", { name: "Ada Lovelace" })).toBeVisible();
    const key = adminOperationsQueryKeys.list(STAFF_USER_ID, "customers", { search: "", sort: "updated", page: 1, pageSize: 50, filters: { identity: "account" } });
    expect(queryClient.getQueryData(key)).toBeDefined();
    await act(async () => auth.emit(null, "SIGNED_OUT"));
    expect(await screen.findByRole("heading", { name: "Sign in to continue." })).toBeVisible();
    expect(queryClient.getQueryData(key)).toBeUndefined();
    expect(screen.queryByText("ada@example.com")).not.toBeInTheDocument();
  });

  it("purges protected records after same-session operations authorization is revoked", async () => {
    const user = userEvent.setup();
    const { dependencies, queryClient } = renderWorkspace("/admin/customers");
    expect(await screen.findByRole("link", { name: "Ada Lovelace" })).toBeVisible();
    vi.mocked(dependencies.operationsService.list).mockRejectedValueOnce({ code: "42501", message: "Staff access required" });
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("heading", { name: "We couldn’t find this page." })).toBeVisible();
    expect(screen.queryByText("ada@example.com")).not.toBeInTheDocument();
    expect(queryClient.getQueryData(adminOperationsQueryKeys.customer(STAFF_USER_ID, OWNER_USER_ID))).toBeUndefined();
  });
});
