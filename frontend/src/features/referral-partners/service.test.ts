import { describe, expect, test, vi } from "vitest";

import { createReferralPartnerService, parsePartnerDetail, parseReferralAccess } from "./service";

describe("referral partner transport", () => {
  test("requires explicit live authorization before sending any request", async () => {
    const request = vi.fn<typeof fetch>();
    const service = createReferralPartnerService("https://api.example.test", request);
    await expect(service.operation("staff", "", "staff_list")).rejects.toMatchObject({ status: 401 });
    await expect(service.download("partner", " ", "document")).rejects.toMatchObject({ status: 401 });
    expect(request).not.toHaveBeenCalled();
  });

  test("keeps staff operation, payload, and bearer token in the intended transport", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const service = createReferralPartnerService("https://api.example.test", request);
    await service.operation("staff", "verified-token", "invite", { partner_id: "partner", expected_revision: 2, request_id: "request" });
    expect(request).toHaveBeenCalledWith("https://api.example.test/api/v1/staff/referral-partners/operations", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer verified-token" }), body: JSON.stringify({ action: "invite", payload: { partner_id: "partner", expected_revision: 2, request_id: "request" } }) }));
  });

  test("fails closed on malformed permission decisions", () => {
    for (const value of [null, {}, { is_partner_manager: "true", is_partner: false, email_configured: true }, { is_partner_manager: true, is_partner: false }]) {
      expect(() => parseReferralAccess(value)).toThrow();
    }
    expect(parseReferralAccess({ is_partner_manager: false, is_partner: true, email_configured: true })).toEqual({ is_partner_manager: false, is_partner: true, email_configured: true });
  });

  test("does not treat an HTML error or an empty body as a signed PDF", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("<html>Sign in</html>", { status: 200, headers: { "Content-Type": "text/html" } }))
      .mockResolvedValueOnce(new Response("", { status: 200, headers: { "Content-Type": "application/pdf" } }));
    const service = createReferralPartnerService("https://api.example.test", request);
    await expect(service.download("partner", "token", "id")).rejects.toMatchObject({ status: 502 });
    await expect(service.download("partner", "token", "id")).rejects.toMatchObject({ status: 502 });
  });

  test("rejects an agreement belonging to a different partner", () => {
    expect(() => parsePartnerDetail({ partner: { id: "11111111-1111-4111-8111-111111111111", revision: 1, business_name: "Business", contact_email: "partner@example.test", commission_amount_minor_units: 1000, currency: "USD", status: "onboarding" }, invitations: [], events: [], agreements: [{ id: "22222222-2222-4222-8222-222222222222", partner_id: "33333333-3333-4333-8333-333333333333", revision: 1, agreement_digest: "a".repeat(64), status: "prepared", snapshot: { title: "Agreement", sections: [{ heading: "Terms", body: "Approved wording" }], currency: "USD", commission_amount_minor_units: 1000 } }] })).toThrow("outside this partner");
  });
});
