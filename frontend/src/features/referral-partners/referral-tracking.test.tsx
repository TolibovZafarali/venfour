import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AuthService } from "@/features/auth";
import { server } from "@/test/mocks/server";
import { renderTestApp } from "@/test/render";
import { referralQueryRoot } from "./hooks";
import { partnerEventLabel } from "./presentation";
import { parsePartnerReferralList, parsePartnerReferralSummary, type PartnerDetail, type PartnerReferral, type PartnerReferralList, type PartnerReferralSummary } from "./service";

const USER = "11111111-1111-4111-8111-111111111111", PARTNER = "22222222-2222-4222-8222-222222222222", LINK = "33333333-3333-4333-8333-333333333333";
const CODE = "a".repeat(48), timestamp = "2026-09-08T00:00:00Z";
const referralId = (index: number) => `${String(index + 10).padStart(8, "0")}-4444-4444-8444-444444444444`;
const session: Session = { access_token: "partner-token", refresh_token: "refresh-token", expires_in: 3600, token_type: "bearer", user: { id: USER, email: "partner@example.test", email_confirmed_at: timestamp, created_at: timestamp, aud: "authenticated", app_metadata: {}, user_metadata: {} } };
function authService(): AuthService { return { getSession: async () => session, onAuthStateChange: () => () => {}, signInWithGoogle: vi.fn(), signInWithApple: vi.fn(), sendMagicLink: vi.fn(), sendEmailCode: vi.fn(), verifyEmailCode: async () => session, exchangeCodeForSession: async () => session, verifyEmailOtp: async () => session, signOut: vi.fn() }; }
function summary(): PartnerReferralSummary { return { link: { id: LINK, code: CODE, status: "active", revision: 1, created_at: timestamp }, summary: { submitted_count: 4, purchased_count: 3, refunded_count: 1, under_review_count: 1 } }; }
function rows(): PartnerReferral[] { return (["submitted", "purchased", "refunded", "under_review"] as const).map((status, index) => ({ id: referralId(index), status, submitted_at: timestamp, purchased_at: status === "submitted" ? null : "2026-09-08T01:00:00Z" })); }
function list(): PartnerReferralList { return { items: rows(), total: 4, page: 1, page_size: 25 }; }
function detail(): PartnerDetail { return { partner: { id: PARTNER, revision: 3, user_id: USER, business_name: "Partner Business", contact_email: "partner@example.test", state: "MO", commission_amount_minor_units: 1234, currency: "USD", status: "active", created_at: timestamp, updated_at: timestamp }, invitations: [], agreements: [], events: [] }; }
const staffDependencies = { caseService: { isStaff: async () => true, listCases: async () => [], getTotalLossCase: async () => null } };
function api(options: { summary?: PartnerReferralSummary; list?: PartnerReferralList; mutationFails?: boolean } = {}) {
  let current = options.summary ?? summary(), allowed = true;
  const operations: { action: string; payload: Record<string, unknown> }[] = [];
  server.use(http.get("*/api/v1/staff/referral-partners/access", () => HttpResponse.json({ is_partner_manager: allowed, is_partner: true, email_configured: true })), http.get("*/api/v1/partners/access", () => HttpResponse.json({ is_partner_manager: false, is_partner: allowed, email_configured: true })));
  const handler = async ({ request }: { request: Request }) => {
    const body = await request.json() as { action: string; payload: Record<string, unknown> }; operations.push(body);
    if (!allowed) return HttpResponse.json({}, { status: 403 });
    if (["partner_get", "staff_get"].includes(body.action)) return HttpResponse.json(detail());
    if (body.action === "referral_summary") return HttpResponse.json(current);
    if (body.action === "referral_list") return HttpResponse.json(options.list ?? list());
    if (body.action === "link_state") {
      if (options.mutationFails) return HttpResponse.json({}, { status: 503 });
      current = { ...current, link: { ...current.link!, status: body.payload.enabled ? "active" : "paused", revision: current.link!.revision + 1 } }; return HttpResponse.json(current);
    }
    return HttpResponse.json({}, { status: 400 });
  };
  server.use(http.post("*/api/v1/staff/referral-partners/operations", handler), http.post("*/api/v1/partners/operations", handler));
  return { operations, revoke: () => { allowed = false; } };
}
beforeEach(() => sessionStorage.clear());

describe("private referral projections", () => {
  test("names database link events in the activity history", () => {
    expect(partnerEventLabel("referral_link.paused")).toBe("Referral link paused");
    expect(partnerEventLabel("referral_link.resumed")).toBe("Referral link resumed");
  });
  test("retains historical purchase totals separately from current refunds and review", () => {
    expect(parsePartnerReferralSummary(summary()).summary).toEqual({ submitted_count: 4, purchased_count: 3, refunded_count: 1, under_review_count: 1 });
    expect(parsePartnerReferralList(list()).items.map((item) => item.status)).toEqual(["submitted", "purchased", "refunded", "under_review"]);
    expect(parsePartnerReferralSummary({ ...summary(), link: null }).link).toBeNull();
  });
  test("rejects identifiers and private details outside the narrow referral response", () => {
    for (const field of ["case_id", "customer_name", "contact_email", "vehicle", "order_id", "payment_intent_id", "commission_amount_minor_units"]) expect(() => parsePartnerReferralList({ ...list(), items: [{ ...rows()[0], [field]: "private-value" }] })).toThrow();
    expect(() => parsePartnerReferralSummary({ ...summary(), partner_id: PARTNER })).toThrow();
    expect(() => parsePartnerReferralSummary({ ...summary(), summary: { ...summary().summary, balance: 1234 } })).toThrow();
  });
  test("rejects malformed links, conflicting totals, invalid statuses and duplicate references", () => {
    for (const code of ["https://bad.test", "../private", "a".repeat(47)]) expect(() => parsePartnerReferralSummary({ ...summary(), link: { ...summary().link, code } })).toThrow();
    expect(() => parsePartnerReferralSummary({ ...summary(), summary: { ...summary().summary, purchased_count: 5 } })).toThrow();
    expect(() => parsePartnerReferralList({ ...list(), items: [rows()[0], rows()[0]] })).toThrow();
    expect(() => parsePartnerReferralList({ ...list(), items: [{ ...rows()[0], status: "paid_commission" }] })).toThrow();
    expect(() => parsePartnerReferralList({ ...list(), items: [{ ...rows()[0], purchased_at: timestamp }] })).toThrow();
    expect(() => parsePartnerReferralList({ ...list(), page: 0 })).toThrow();
  });
});

describe("partner referral dashboards", () => {
  test("shows a copyable stable link and only opaque submitted referral information", async () => {
    const user = userEvent.setup(), clipboard = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    api(); renderTestApp([`/partners/${PARTNER}`], { authService: authService() });
    expect(await screen.findByRole("textbox", { name: "Your referral link" })).toHaveValue(`${window.location.origin}/r/${CODE}`);
    await user.click(screen.getByRole("button", { name: "Copy referral link" }));
    expect(clipboard).toHaveBeenCalledWith(`${window.location.origin}/r/${CODE}`);
    expect(await screen.findByRole("status")).toHaveTextContent("Referral link copied.");
    const activity = within(screen.getByRole("region", { name: "Referral activity" })), table = within(await activity.findByRole("table"));
    for (const label of ["Review submitted", "Purchased", "Refunded", "Payment under review"]) expect(table.getAllByText(label).length).toBeGreaterThan(0);
    expect(table.getByText(referralId(0))).toBeVisible();
    expect(activity.queryByText("partner@example.test")).not.toBeInTheDocument();
    expect(activity.queryByText(/earnings|payout balance|available balance/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause referral link" })).not.toBeInTheDocument();
  });
  test("allows a manager to pause and resume the same link with current revision", async () => {
    const user = userEvent.setup(), harness = api();
    renderTestApp([`/admin/referral-partners/${PARTNER}`], { authService: authService(), adminCaseOperationsDependencies: staffDependencies });
    await user.click(await screen.findByRole("button", { name: "Pause referral link" }));
    expect(await screen.findByRole("button", { name: "Resume referral link" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Copy referral link" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Your referral link" })).toHaveValue(`${window.location.origin}/r/${CODE}`);
    await user.click(screen.getByRole("button", { name: "Resume referral link" }));
    expect(await screen.findByRole("button", { name: "Pause referral link" })).toBeEnabled();
    expect(harness.operations.filter((request) => request.action === "link_state").map((request) => request.payload)).toEqual([expect.objectContaining({ partner_id: PARTNER, expected_revision: 1, enabled: false }), expect.objectContaining({ partner_id: PARTNER, expected_revision: 2, enabled: true })]);
    expect(screen.getByRole("button", { name: "Copy referral link" })).toBeEnabled();
  });
  test("keeps the saved link active and retries the same request after a failed pause", async () => {
    const user = userEvent.setup(), harness = api({ mutationFails: true });
    renderTestApp([`/admin/referral-partners/${PARTNER}`], { authService: authService(), adminCaseOperationsDependencies: staffDependencies });
    const button = await screen.findByRole("button", { name: "Pause referral link" });
    await user.click(button); await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Copy referral link" })).toBeEnabled();
    await user.click(button);
    await waitFor(() => expect(harness.operations.filter((request) => request.action === "link_state")).toHaveLength(2));
    const requests = harness.operations.filter((request) => request.action === "link_state"); expect(requests[1]).toEqual(requests[0]);
  });
  test("loads subsequent referral pages and retains historical totals", async () => {
    const user = userEvent.setup(), harness = api({ list: { ...list(), total: 26 } });
    renderTestApp([`/partners/${PARTNER}`], { authService: authService() });
    await user.click(await screen.findByRole("button", { name: "Next referrals" }));
    await waitFor(() => expect(harness.operations).toContainEqual({ action: "referral_list", payload: { partner_id: PARTNER, page: 2, page_size: 25 } }));
    expect(screen.getByRole("button", { name: "Previous referrals" })).toBeEnabled();
    expect(screen.getByText("Purchase totals include purchases later refunded or placed under review. Commission eligibility follows your partner agreement.")).toBeVisible();
  });
  test("removes referral records when manager permission is revoked", async () => {
    const harness = api(), app = renderTestApp([`/admin/referral-partners/${PARTNER}`], { authService: authService(), adminCaseOperationsDependencies: staffDependencies });
    await screen.findByRole("textbox", { name: "Your referral link" });
    harness.revoke(); await act(() => app.queryClient.invalidateQueries({ queryKey: referralQueryRoot }));
    await screen.findByRole("heading", { name: "This workspace is not available" });
    expect(screen.queryByText(referralId(0))).not.toBeInTheDocument();
    expect(app.queryClient.getQueryCache().findAll({ predicate: (query) => query.queryKey.includes("referral_list") || query.queryKey.includes("referral_summary") })).toEqual([]);
  });
  test("shows an empty list without inventing a referral or purchase", async () => {
    api({ summary: { ...summary(), summary: { submitted_count: 0, purchased_count: 0, refunded_count: 0, under_review_count: 0 } }, list: { items: [], total: 0, page: 1, page_size: 25 } });
    renderTestApp([`/partners/${PARTNER}`], { authService: authService() });
    expect(await screen.findByText("No submitted referrals yet.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Next referrals" })).toBeDisabled(); expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
