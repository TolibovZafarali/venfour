import { describe, expect, it } from "vitest";
import { hostAudience } from "@/app/site-boundary";
import { adminPartnerPath, partnerWorkspacePath, referralHref, validPartnerSlug } from "./urls";

describe("readable partner URLs", () => {
  it("separates public sharing from the private portal and keeps local links local", () => {
    for (const origin of ["https://app.venfour.com", "https://partners.venfour.com", "https://venfour.com"]) expect(referralHref("ozark-auto", origin)).toBe("https://venfour.com/r/ozark-auto");
    expect(referralHref("ozark-auto", "http://127.0.0.1:4186")).toBe("http://127.0.0.1:4186/r/ozark-auto");
    expect(partnerWorkspacePath("", "https://partners.venfour.com")).toBe("/");
    expect(partnerWorkspacePath("earnings", "https://partners.venfour.com")).toBe("/earnings");
    expect(partnerWorkspacePath("earnings", "http://localhost:5173")).toBe("/partners/earnings");
    expect(hostAudience("https://partners.venfour.com")).toBe("application");
    expect(adminPartnerPath({ id: "legacy", url_slug: "ozark-auto" })).toBe("/admin/partners/ozark-auto");
    expect(adminPartnerPath({ id: "legacy" })).toBe("/admin/referral-partners/legacy");
  });
  it.each(["admin", "sign-in", "ab", "Ozark", "foo--bar", "../foo", "foo/other", "a".repeat(48), "a".repeat(64), "-foo", "foo-", "123"])("rejects ambiguous or reserved alias %s", value => expect(validPartnerSlug(value)).toBe(false));
});
