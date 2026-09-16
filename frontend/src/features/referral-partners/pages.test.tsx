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
  test("opens public policies from the separate partner sign-in host", async () => {
    const originalUrl = window.location.href;
    const browserEnvironment = globalThis as typeof globalThis & {
      jsdom: { reconfigure(options: { url: string }): void };
    };
    try {
      browserEnvironment.jsdom.reconfigure({ url: "https://partners.venfour.com/" });
      renderTestApp(["/partners"], { authService: authService(null) });
      const signIn = within(await screen.findByRole("region", { name: "Business sign in" }));
      for (const name of ["Terms", "Privacy", "Cookies"]) {
        expect(signIn.getByRole("link", { name })).toHaveAttribute("href", `https://venfour.com/${name.toLowerCase()}`);
      }
    } finally {
      browserEnvironment.jsdom.reconfigure({ url: originalUrl });
    }
  });

  test.each(["ready", "queued", "failed"] as const)("shows the active workspace with a %s agreement document", async (documentStatus) => {
    const user = userEvent.setup();
    const current = detail();
    current.partner.status = "active";
    current.partner.current_agreement_id = AGREEMENT;
    current.agreements[0].status = "countersigned";
    current.agreements[0].document_status = documentStatus;
    current.agreements[0].manager_signature = { typed_legal_name: "Venfour Representative", signed_at: "2026-09-16T12:30:00Z" };
    current.agreements.unshift({ ...agreement(), id: "55555555-5555-4555-8555-555555555555", status: "superseded", snapshot: { ...agreement().snapshot, title: "Previous agreement" } });
    server.use(
      http.get("*/api/v1/partners/access", () => HttpResponse.json({ is_partner: true, is_partner_manager: false })),
      http.post("*/api/v1/partners/operations", async ({ request }) => {
        const { action } = await request.json() as { action: string };
        if (action === "earnings") return HttpResponse.json({ availability: "not_enabled", currency: "USD", period: "2026-09", as_of: "2026-09-16T12:00:00Z", summary: null, items: [], total: 0, page: 1, page_size: 25 });
        if (action === "referral_summary") return HttpResponse.json({ link: null, summary: { submitted_count: 0, purchased_count: 0, refunded_count: 0, under_review_count: 0 } });
        if (action === "referral_list") return HttpResponse.json({ items: [], total: 0, page: 1, page_size: 25 });
        return HttpResponse.json(current);
      }),
    );
    renderTestApp([`/partners/${PARTNER}`], { authService: authService() });
    expect(await screen.findByRole("heading", { name: "You’re ready to refer customers." })).toBeVisible();
    expect(screen.getByText("Partnership active")).toBeVisible();
    expect(screen.queryByLabelText("Partnership setup progress")).not.toBeInTheDocument();
    const completed = screen.getByRole("region", { name: "Your agreement" });
    if (documentStatus === "ready") expect(within(completed).getByRole("button", { name: "Download signed PDF" })).toBeVisible();
    else {
      expect(within(completed).queryByRole("button", { name: "Download signed PDF" })).not.toBeInTheDocument();
      expect(within(completed).getByText(documentStatus === "failed" ? /PDF could not be prepared/ : /PDF is being prepared/)).toBeVisible();
    }
    await user.click(within(completed).getByText("Read completed agreement", { selector: "summary" }));
    expect(within(completed).getByRole("heading", { name: "Business referral agreement" })).toBeVisible();
    expect(within(completed).getByRole("heading", { name: "Previous agreement" })).not.toBeVisible();
    expect(within(completed).getByText("Agreement history", { selector: "summary" }).closest("details")).not.toHaveAttribute("open");
  });

  test("shows the saved signature receipt and opens only the current signed agreement while approval is pending", async () => {
    const user = userEvent.setup();
    const current = detail();
    current.partner.status = "awaiting_approval";
    current.partner.current_agreement_id = AGREEMENT;
    current.partner.legal_business_name = "Updated business profile";
    current.agreements[0].status = "partner_signed";
    current.agreements[0].partner_signature = { typed_legal_name: "Partner Person", typed_title: "Owner", verified_email: "partner@example.test", signed_at: "2026-09-16T12:30:00Z" };
    current.agreements.unshift({ ...agreement(), id: "55555555-5555-4555-8555-555555555555", status: "superseded", snapshot: { ...agreement().snapshot, title: "Previous agreement", legal_business_name: "Previous business name" } });
    server.use(http.post("*/api/v1/partners/operations", () => HttpResponse.json(current)));
    renderTestApp([`/partners/${PARTNER}`], { authService: authService() });
    await screen.findByRole("heading", { name: "Your agreement is with Venfour." });
    const receipt = within(screen.getByRole("region", { name: "Signature saved" }));
    expect(receipt.getByText("Example Business LLC")).toBeVisible();
    expect(receipt.getByText("Partner Person")).toBeVisible();
    expect(receipt.getByText("Owner")).toBeVisible();
    expect(receipt.getByText("partner@example.test")).toBeVisible();
    expect(receipt.getByText("Awaiting Venfour countersignature")).toBeVisible();
    expect(receipt.queryByText("Updated business profile")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Venfour approval, step 3, current")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Download signed PDF" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agree and sign" })).not.toBeInTheDocument();
    const action = screen.getByRole("button", { name: "View your signed agreement" });
    const disclosure = document.getElementById(action.getAttribute("aria-controls")!)!;
    expect(disclosure).not.toHaveAttribute("open");
    await user.click(action);
    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByRole("heading", { name: "Your signed agreement" })).toHaveFocus();
    expect(within(disclosure).getByRole("heading", { name: "Business referral agreement" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Previous agreement" })).not.toBeVisible();
    expect(within(disclosure).queryByRole("heading", { name: "Previous agreement" })).not.toBeInTheDocument();
    await user.click(screen.getByText("Agreement history", { selector: "summary" }));
    expect(screen.getByText(/^Previous agreement · Superseded/, { selector: "summary" }).closest("details")).not.toHaveAttribute("open");
  });

  test("shows sign-in fields immediately and returns to the exact invitation after email verification", async () => {
    const user = userEvent.setup();
    const service = authService(null);
    const getInvitation = vi.fn();
    server.use(http.post("*/api/v1/partners/operations", async ({ request }) => {
      const { action } = await request.json() as { action: string };
      if (action !== "invitation_get") return failure(400);
      getInvitation();
      return HttpResponse.json({ partner: detail().partner, invitation: { id: INVITATION, status: "pending", created_at: "2026-09-08T00:00:00Z", expires_at: "2099-09-15T00:00:00Z" } });
    }));
    const path = `/partners/invitations/${INVITATION}`;
    const app = renderTestApp([`${path}?from=invitation#onboarding`], { authService: service });
    const signIn = within(await screen.findByRole("region", { name: "Business sign in" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(signIn.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    expect(signIn.getByRole("button", { name: "Continue with Apple" })).toBeVisible();
    expect(getInvitation).not.toHaveBeenCalled();
    await user.type(signIn.getByRole("textbox", { name: "Email address" }), "partner@example.test");
    await user.click(signIn.getByRole("button", { name: "Continue with Email" }));
    await user.type(await screen.findByRole("textbox", { name: "Sign-in code" }), "123456");
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));
    await screen.findByRole("heading", { name: "Welcome to Venfour." });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(app.router.state.location).toMatchObject({ pathname: path, search: "?from=invitation", hash: "#onboarding" });
    expect(getInvitation).toHaveBeenCalled();
  });

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

  test("saves business details before preparing the agreement with the returned revision", async () => {
    const user = userEvent.setup();
    let preparation: Record<string, unknown> | undefined;
    const writes: string[] = [];
    let current = detail(false);
    server.use(http.post("*/api/v1/partners/operations", async ({ request }) => {
      const { action, payload } = await request.json() as { action: string; payload: Record<string, unknown> };
      if (action === "profile_save") { writes.push(action); current = { ...current, partner: { ...current.partner, revision: 4 } }; }
      if (action === "agreement_prepare") { writes.push(action); preparation = payload; current = { ...current, partner: { ...current.partner, revision: 5 }, agreements: [agreement()] }; }
      return HttpResponse.json(current);
    }));
    renderTestApp([`/partners/${PARTNER}`], { authService: authService() });
    await user.click(await screen.findByRole("button", { name: "Save and review agreement" }));
    await waitFor(() => expect(preparation).toMatchObject({ partner_id: PARTNER, expected_revision: 4 }));
    expect(writes).toEqual(["profile_save", "agreement_prepare"]);
    expect(preparation).not.toHaveProperty("template_id");
    await screen.findByRole("heading", { name: "Sign your agreement" });
    expect(screen.queryByText("The saved record changed while this form was open. Your entries are preserved.")).not.toBeInTheDocument();
  });

  test("shows required-field errors and focuses the first missing field without saving", async () => {
    const user = userEvent.setup();
    const current = detail(false);
    current.partner = { ...current.partner, contact_name: "", address_line1: "" };
    const writes = vi.fn();
    server.use(http.post("*/api/v1/partners/operations", async ({ request }) => {
      const { action } = await request.json() as { action: string };
      if (action !== "partner_get") writes(action);
      return HttpResponse.json(current);
    }));
    renderTestApp([`/partners/${PARTNER}`], { authService: authService() });
    await user.click(await screen.findByRole("button", { name: "Save and review agreement" }));
    expect(screen.getByRole("textbox", { name: "Street address *" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Full name *" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter street address.")).toBeVisible();
    expect(writes).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Agreement history" })).not.toBeInTheDocument();
  });

  test("keeps entered details after a save failure and never prepares an unsaved profile", async () => {
    const user = userEvent.setup();
    const writes: string[] = [];
    server.use(http.post("*/api/v1/partners/operations", async ({ request }) => {
      const { action } = await request.json() as { action: string };
      if (action === "partner_get") return HttpResponse.json(detail(false));
      writes.push(action);
      return failure(503);
    }));
    renderTestApp([`/partners/${PARTNER}`], { authService: authService() });
    const name = await screen.findByRole("textbox", { name: "Legal business name *" });
    await user.clear(name); await user.type(name, "Updated Business LLC");
    await user.click(screen.getByRole("button", { name: "Save and review agreement" }));
    await screen.findByRole("alert");
    expect(name).toHaveValue("Updated Business LLC");
    expect(writes).toEqual(["profile_save"]);
    expect(screen.getByRole("button", { name: "Save and review agreement" })).toBeEnabled();
  });

  test("retries failed preparation using the saved revision and the same request without saving again", async () => {
    const user = userEvent.setup();
    let current = detail(false);
    let saves = 0;
    const preparations: Record<string, unknown>[] = [];
    server.use(http.post("*/api/v1/partners/operations", async ({ request }) => {
      const { action, payload } = await request.json() as { action: string; payload: Record<string, unknown> };
      if (action === "profile_save") { saves++; current = { ...current, partner: { ...current.partner, revision: 4 } }; }
      if (action === "agreement_prepare") {
        preparations.push(payload);
        if (preparations.length === 1) return failure(503);
        current = { ...current, partner: { ...current.partner, revision: 5 }, agreements: [agreement()] };
      }
      return HttpResponse.json(current);
    }));
    renderTestApp([`/partners/${PARTNER}`], { authService: authService() });
    await user.click(await screen.findByRole("button", { name: "Save and review agreement" }));
    await screen.findByRole("alert");
    expect(screen.getByText(/Your business details are saved/)).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Legal business name *" })).toHaveValue("Example Business LLC");
    await user.click(screen.getByRole("button", { name: "Save and review agreement" }));
    await screen.findByRole("heading", { name: "Sign your agreement" });
    expect(saves).toBe(1);
    expect(preparations).toHaveLength(2);
    expect(preparations[1]).toEqual(preparations[0]);
    expect(preparations[1]).toMatchObject({ partner_id: PARTNER, expected_revision: 4 });
    expect(screen.queryByRole("textbox", { name: "Legal business name *" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit business details" }));
    expect(await screen.findByRole("textbox", { name: "Legal business name *" })).toHaveValue("Example Business LLC");
    await user.click(screen.getByRole("button", { name: "Back to agreement" }));
    await screen.findByRole("heading", { name: "Sign your agreement" });
  });

  test("requires reconciling a changed profile before continuing with the latest revision", async () => {
    const user = userEvent.setup();
    const profile = { legal_business_name: "Previous LLC", address_line1: "100 Main Street", address_line2: "", city: "Columbia", state: "MO", postal_code: "65201", country: "US", contact_name: "Partner Person", contact_title: "Owner" };
    sessionStorage.setItem(`${referralDraftPrefix}${USER}.profile.${PARTNER}`, JSON.stringify({ version: 1, value: { ...profile, legal_business_name: "Authored LLC", baseline: profile, expected_revision: 2 } }));
    let savePayload: Record<string, unknown> | undefined;
    server.use(http.post("*/api/v1/partners/operations", async ({ request }) => {
      const { action, payload } = await request.json() as { action: string; payload: Record<string, unknown> };
      if (action === "profile_save") { savePayload = payload; return failure(503); }
      return HttpResponse.json(detail(false));
    }));
    renderTestApp([`/partners/${PARTNER}`], { authService: authService() });
    expect(await screen.findByRole("button", { name: "Save and review agreement" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Keep my entries and use the latest record version" }));
    expect(screen.getByRole("textbox", { name: "Legal business name *" })).toHaveValue("Authored LLC");
    await user.click(screen.getByRole("button", { name: "Save and review agreement" }));
    await screen.findByRole("alert");
    expect(savePayload).toMatchObject({ expected_revision: 3, legal_business_name: "Authored LLC" });
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
    server.use(
      http.get("*/api/v1/partners/access", () => HttpResponse.json({ is_partner: true, is_partner_manager: false })),
      http.post("*/api/v1/partners/operations", async ({ request }) => {
        const { action } = await request.json() as { action: string };
        if (action === "earnings") return HttpResponse.json({ availability: "not_enabled", currency: "USD", period: "2026-09", as_of: "2026-09-16T12:00:00Z", summary: null, items: [], total: 0, page: 1, page_size: 25 });
        if (action === "referral_summary") return HttpResponse.json({ link: null, summary: { submitted_count: 0, purchased_count: 0, refunded_count: 0, under_review_count: 0 } });
        if (action === "referral_list") return HttpResponse.json({ items: [], total: 0, page: 1, page_size: 25 });
        return HttpResponse.json(current);
      }),
    );
    renderTestApp([`/partners/${PARTNER}`], { authService: authService() });
    await userEvent.setup().click(await screen.findByText("Read completed agreement", { selector: "summary" }));
    const summary = within(screen.getByRole("article", { name: "Agreement for review" }));
    expect(summary.getByText("$25.00")).toBeVisible();
    expect(summary.queryByText("$40.00")).not.toBeInTheDocument();
    expect(summary.getByText("partner@example.test", { exact: false })).toBeVisible();
    expect(screen.getByText("Partnership active")).toBeVisible();
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


describe("account-based partner routes", () => {
  test("opens the account's only business directly from the workspace root", async () => {
    const current = detail(); current.partner.url_slug = "example-business";
    const requests: string[] = [];
    server.use(http.post("*/api/v1/partners/operations", async ({ request }) => {
      const { action, payload } = await request.json() as { action:string; payload:Record<string, unknown> };
      requests.push(action);
      if (action === "partner_list") return HttpResponse.json({ items:[current.partner], total:1, page:1, page_size:25 });
      expect(payload.partner_id).toBe(PARTNER); return HttpResponse.json(current);
    }));
    renderTestApp(["/partners"], { authService:authService() });
    expect(await screen.findByRole("heading", {name:"Review your agreement"})).toBeVisible();
    expect(requests).toContain("partner_get");
    expect(screen.getByRole("link",{name:"Earnings"})).toHaveAttribute("href","/partners/earnings");
  });
  test("asks multi-business accounts to choose a readable business link", async () => {
    const first = { ...detail().partner, url_slug:"example-business" };
    const second = { ...first, id:INVITATION, url_slug:"second-business", business_name:"Second Business" };
    server.use(http.post("*/api/v1/partners/operations", async ({ request }) => {
      const { action } = await request.json() as { action:string };
      expect(action).toBe("partner_list");
      return HttpResponse.json({ items:[first,second],total:2,page:1,page_size:25 });
    }));
    renderTestApp(["/partners/earnings"], { authService:authService() });
    await screen.findByRole("heading",{name:"Second Business"});
    expect(screen.getAllByRole("link",{name:"View business and agreement"}).map(link=>link.getAttribute("href"))).toEqual(["/partners/businesses/example-business/earnings","/partners/businesses/second-business/earnings"]);
  });
});
