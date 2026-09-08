import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { AuthService } from "@/features/auth";
import { server } from "@/test/mocks/server";
import { renderTestApp } from "@/test/render";

import { referralDraftPrefix } from "./hooks";
import type { PartnerAgreement, PartnerDetail } from "./service";

const USER = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";
const AGREEMENT = "33333333-3333-4333-8333-333333333333";
const INVITATION = "44444444-4444-4444-8444-444444444444";
const session: Session = { access_token: "partner-token", refresh_token: "refresh-token", expires_in: 3600, token_type: "bearer", user: { id: USER, email: "partner@example.test", email_confirmed_at: "2026-09-01T00:00:00Z", created_at: "2026-09-01T00:00:00Z", aud: "authenticated", app_metadata: { provider: "email" }, user_metadata: {} } };
function authService(value: Session | null = session): AuthService {
  return { getSession: async () => value, onAuthStateChange: () => () => {}, signInWithGoogle: vi.fn(), signInWithApple: vi.fn(), sendMagicLink: vi.fn(), sendEmailCode: vi.fn(), verifyEmailCode: async () => session, exchangeCodeForSession: async () => session, verifyEmailOtp: async () => session, signOut: vi.fn() };
}
function agreement(): PartnerAgreement {
  return { id: AGREEMENT, revision: 1, status: "prepared", agreement_digest: "a".repeat(64), created_at: "2026-09-08T00:00:00Z", document_status: "not_requested", snapshot: { title: "Business referral agreement", sections: [{ heading: "Commission terms", body: "Commission applies only to qualifying purchases." }], contact_title: "Owner", contact_name: "Partner Person", contact_email: "partner@example.test", legal_business_name: "Example Business LLC", commission_amount_minor_units: 2500, currency: "USD" } };
}
function detail(withAgreement = true): PartnerDetail {
  return { partner: { id: PARTNER, revision: 3, user_id: USER, business_name: "Example Business", contact_email: "partner@example.test", state: "MO", commission_amount_minor_units: 2500, currency: "USD", status: "onboarding", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-08T00:00:00Z", legal_business_name: "Example Business LLC", address_line1: "100 Main Street", address_line2: "", city: "Columbia", postal_code: "65201", country: "US", contact_name: "Partner Person", contact_title: "Owner" }, invitations: [], agreements: withAgreement ? [agreement()] : [], events: [] };
}
const staffDependencies = { caseService: { isStaff: async () => true, listCases: async () => [], getTotalLossCase: async () => null } };
const failure = (status: number) => HttpResponse.json({ error: { code: "REFERRAL_UNAVAILABLE", message: "Unavailable" } }, { status });

beforeEach(() => sessionStorage.clear());

describe("referral onboarding", () => {
  test("requires explicit independent consents and preserves signing entries and request id after failure", async () => {
    const user = userEvent.setup();
    const current = detail();
    const signatures: Record<string, unknown>[] = [];
    server.use(http.post("*/api/v1/partners/operations", async ({ request }) => {
      const { action, payload } = await request.json() as { action: string; payload: Record<string, unknown> };
      if (action === "partner_get") return HttpResponse.json(current);
      if (action === "sign") { signatures.push(payload); return failure(503); }
      return failure(400);
    }));
    const app = renderTestApp([`/partners/${PARTNER}`], { authService: authService() });
    const heading = await screen.findByRole("heading", { name: "Sign your agreement" });
    const form = within(heading.closest("form")!);
    const checkboxes = form.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    checkboxes.forEach((checkbox) => expect(checkbox).not.toBeChecked());
    await user.type(form.getByRole("textbox", { name: "Full legal name *" }), "Partner Person");
    await user.type(form.getByRole("textbox", { name: "Title / capacity *" }), "Owner");
    await user.click(checkboxes[0]); await user.click(checkboxes[1]);
    expect(form.getByRole("button", { name: "Agree and sign" })).toBeDisabled();
    await user.click(checkboxes[2]);
    await user.click(form.getByRole("button", { name: "Agree and sign" }));
    await form.findByRole("alert");
    expect(form.getByRole("textbox", { name: "Full legal name *" })).toHaveValue("Partner Person");
    await user.click(form.getByRole("button", { name: "Agree and sign" }));
    await waitFor(() => expect(signatures).toHaveLength(2));
    expect(signatures[0]).toEqual(signatures[1]);
    expect(signatures[0]).toMatchObject({ agreement_id: AGREEMENT, expected_revision: 1, agreement_digest: "a".repeat(64), typed_legal_name: "Partner Person", electronic_consent: true, pdf_email_consent: true, authority_confirmed: true });
    expect(signatures[0]).not.toHaveProperty("partner_id");
    app.unmount();
    renderTestApp([`/partners/${PARTNER}`], { authService: authService() });
    const refreshedHeading = await screen.findByRole("heading", { name: "Sign your agreement" });
    const refreshedForm = within(refreshedHeading.closest("form")!);
    expect(refreshedForm.getByRole("textbox", { name: "Full legal name *" })).toHaveValue("Partner Person");
    for (const checkbox of refreshedForm.getAllByRole("checkbox")) { expect(checkbox).not.toBeChecked(); await user.click(checkbox); }
    await user.click(refreshedForm.getByRole("button", { name: "Agree and sign" }));
    await waitFor(() => expect(signatures).toHaveLength(3));
    expect(signatures[2]).toEqual(signatures[0]);
  });

  test("preserves authored profile values across refresh and removes them for another identity", async () => {
    const user = userEvent.setup();
    server.use(http.post("*/api/v1/partners/operations", () => HttpResponse.json(detail(false))));
    const first = renderTestApp([`/partners/${PARTNER}`], { authService: authService() });
    const name = await screen.findByRole("textbox", { name: "Legal business name *" });
    await user.clear(name); await user.type(name, "Authored legal business name");
    first.unmount();
    const second = renderTestApp([`/partners/${PARTNER}`], { authService: authService() });
    expect(await screen.findByRole("textbox", { name: "Legal business name *" })).toHaveValue("Authored legal business name");
    second.unmount();
    server.use(http.post("*/api/v1/partners/operations", () => failure(403)));
    renderTestApp([`/partners/${PARTNER}`], { authService: authService({ ...session, user: { ...session.user, id: "55555555-5555-4555-8555-555555555555" } }) });
    await screen.findByRole("heading", { name: "This partner record is unavailable" });
    expect(screen.queryByDisplayValue("Authored legal business name")).not.toBeInTheDocument();
    expect(sessionStorage.getItem(`${referralDraftPrefix}${USER}.profile.${PARTNER}`)).toBeNull();
  });

  test("prepares the latest published agreement using the partner operation contract", async () => {
    const user = userEvent.setup();
    let preparation: Record<string, unknown> | undefined;
    let current = detail(false);
    server.use(http.post("*/api/v1/partners/operations", async ({ request }) => {
      const { action, payload } = await request.json() as { action: string; payload: Record<string, unknown> };
      if (action === "agreement_prepare") { preparation = payload; current = { ...current, partner: { ...current.partner, revision: 4 }, agreements: [agreement()] }; }
      return HttpResponse.json(current);
    }));
    renderTestApp([`/partners/${PARTNER}`], { authService: authService() });
    await user.click(await screen.findByRole("button", { name: "Review agreement" }));
    await waitFor(() => expect(preparation).toMatchObject({ partner_id: PARTNER, expected_revision: 3 }));
    expect(preparation).not.toHaveProperty("template_id");
    await screen.findByRole("heading", { name: "Sign your agreement" });
    expect(screen.queryByText("The saved record changed while this form was open. Your entries are preserved.")).not.toBeInTheDocument();
  });

  test("does not reveal invitation details to a mismatched verified account", async () => {
    server.use(http.post("*/api/v1/partners/operations", () => failure(403)));
    renderTestApp([`/partners/invitations/${INVITATION}`], { authService: authService() });
    await screen.findByRole("heading", { name: "This invitation is not available" });
    expect(screen.queryByText("Example Business")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept invitation and continue" })).not.toBeInTheDocument();
  });

  test("shows active partnership details from the signed agreement snapshot", async () => {
    const current = detail();
    current.partner = { ...current.partner, status: "active", current_agreement_id: AGREEMENT, commission_amount_minor_units: 4000 };
    current.agreements[0] = { ...agreement(), status: "countersigned", document_status: "queued", partner_signature: { typed_legal_name: "Partner Person", signed_at: "2026-09-08T00:00:00Z" }, manager_signature: { typed_legal_name: "Manager Person", signed_at: "2026-09-08T00:01:00Z" } };
    server.use(http.post("*/api/v1/partners/operations", () => HttpResponse.json(current)));
    renderTestApp([`/partners/${PARTNER}`], { authService: authService() });
    const summary = within(await screen.findByRole("region", { name: "Agreed business details" }));
    expect(summary.getByText("$25.00")).toBeVisible();
    expect(summary.queryByText("$40.00")).not.toBeInTheDocument();
    expect(summary.getByText("partner@example.test")).toBeVisible();
    expect(screen.getByText(/Your partner onboarding is complete/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Agree and sign" })).not.toBeInTheDocument();
  });

  test("ordinary staff cannot see the manager navigation or partner records", async () => {
    const operations = vi.fn();
    server.use(http.post("*/api/v1/staff/referral-partners/operations", () => { operations(); return failure(403); }));
    renderTestApp(["/admin/referral-partners"], { authService: authService(), adminCaseOperationsDependencies: staffDependencies });
    await screen.findByRole("heading", { name: "This workspace is not available" });
    expect(screen.queryByRole("link", { name: "Referral partners" })).not.toBeInTheDocument();
    expect(operations).not.toHaveBeenCalled();
  });

  test("designated managers can create a business with exact USD minor units", async () => {
    const user = userEvent.setup();
    let creation: Record<string, unknown> | undefined;
    server.use(http.get("*/api/v1/staff/referral-partners/access", () => HttpResponse.json({ is_partner_manager: true, is_partner: false, email_configured: true })), http.post("*/api/v1/staff/referral-partners/operations", async ({ request }) => {
      const { action, payload } = await request.json() as { action: string; payload: Record<string, unknown> };
      if (action === "staff_list") return HttpResponse.json({ items: [], page: 1, page_size: 25, total: 0 });
      if (action === "staff_create") creation = payload;
      return HttpResponse.json(detail(false));
    }));
    renderTestApp(["/admin/referral-partners"], { authService: authService(), adminCaseOperationsDependencies: staffDependencies });
    await user.click(await screen.findByText("Add a referral partner"));
    await user.type(screen.getByRole("textbox", { name: "Business name *" }), "Example Business");
    await user.type(screen.getByRole("textbox", { name: "Contact email *" }), "partner@example.test");
    await user.type(screen.getByRole("textbox", { name: "Commission per qualifying purchase (USD) *" }), "12.34");
    await user.click(screen.getByRole("button", { name: "Create partner record" }));
    await waitFor(() => expect(creation).toMatchObject({ business_name: "Example Business", contact_email: "partner@example.test", state: "MO", commission_amount_minor_units: 1234 }));
  });
});
