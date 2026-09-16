export const PUBLIC_ORIGIN = "https://venfour.com";
export const PARTNER_ORIGIN = "https://partners.venfour.com";
export const APPLICATION_ORIGIN = "https://app.venfour.com";

const publicPaths = new Set(["/", "/contact", "/cookies", "/methodology", "/privacy", "/terms", "/refund-policy", "/referral-partners"]);

export function routeAudience(pathname: string): "public" | "application" {
  return publicPaths.has(pathname.replace(/\/+$/, "") || "/") ? "public" : "application";
}

function currentOrigin() {
  return typeof window === "undefined" ? "http://localhost" : window.location.origin;
}

export function hostAudience(origin = currentOrigin()): "public" | "application" | "combined" {
  if (origin === PUBLIC_ORIGIN || origin === "https://www.venfour.com") return "public";
  return [APPLICATION_ORIGIN, PARTNER_ORIGIN].includes(origin) ? "application" : "combined";
}

// Only new entry points cross hosts. Existing case links and callbacks stay on
// their issuing origin so guest ownership and PKCE state are not discarded.
export function applicationHref(path = "/app", origin = currentOrigin()) {
  const safe = path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") && !/[\r\n]/.test(path) ? path : "/app";
  return hostAudience(origin) === "public" ? `${APPLICATION_ORIGIN}${safe}` : safe;
}

export function publicHref(path = "/", origin = currentOrigin()) {
  const safe = path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") && !/[\r\n]/.test(path) ? path : "/";
  return hostAudience(origin) === "application" ? `${PUBLIC_ORIGIN}${safe}` : safe;
}

export function partnerSignInHref(origin = currentOrigin()) {
  return hostAudience(origin) === "combined" ? "/partners/sign-in" : `${PARTNER_ORIGIN}/sign-in`;
}
