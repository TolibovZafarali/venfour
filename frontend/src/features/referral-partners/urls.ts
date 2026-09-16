import { APPLICATION_ORIGIN, PARTNER_ORIGIN, PUBLIC_ORIGIN } from "@/app/site-boundary";
import type { ReferralPartner } from "./service";

export function isPartnerHost(origin = window.location.origin) { return origin === PARTNER_ORIGIN; }
export function partnerWorkspacePath(path = "", origin = window.location.origin) {
  return `${isPartnerHost(origin) ? "" : "/partners"}${path ? `/${path}` : ""}` || "/";
}
export function referralHref(slug: string, origin = window.location.origin) {
  const publicHost = [PUBLIC_ORIGIN, APPLICATION_ORIGIN, PARTNER_ORIGIN, "https://www.venfour.com"].includes(origin);
  return new URL(`/r/${encodeURIComponent(slug)}`, publicHost ? PUBLIC_ORIGIN : origin).href;
}
export function adminPartnerPath(partner: Pick<ReferralPartner, "id" | "url_slug">) {
  return partner.url_slug ? `/admin/partners/${partner.url_slug}` : `/admin/referral-partners/${partner.id}`;
}
export function validPartnerSlug(value: unknown): value is string {
  return typeof value === "string" && value.length >= 3 && value.length <= 63 && /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(value)
    && !/^[a-f0-9]{48}$/.test(value) && !["admin", "api", "auth", "businesses", "earnings", "help", "invitations", "partners", "sign-in", "start", "support", "venfour", "www"].includes(value);
}
