export type PublicPageTone =
  | "contact"
  | "cookies"
  | "methodology"
  | "privacy"
  | "terms";

export const publicPageGradientClassNames: Record<PublicPageTone, string> = {
  contact: "page-gradient-contact",
  cookies: "page-gradient-cookies",
  methodology: "page-gradient-methodology",
  privacy: "page-gradient-privacy",
  terms: "page-gradient-terms",
};

const editorialPaths = new Set([
  "/contact",
  "/cookies",
  "/methodology",
  "/privacy",
  "/terms",
]);

const selfStyledPaths = new Set([
  "/",
  "/start",
  "/total-loss-review",
  "/total-loss/start",
]);

export function appRouteGradientClassName(pathname: string) {
  const normalizedPathname =
    pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  if (
    selfStyledPaths.has(normalizedPathname) ||
    editorialPaths.has(normalizedPathname)
  ) {
    return undefined;
  }

  if (normalizedPathname === "/appraisals") {
    return "page-gradient-appraisals";
  }

  if (
    normalizedPathname.startsWith("/analyses/") ||
    (normalizedPathname.startsWith("/total-loss/cases/") &&
      (normalizedPathname.endsWith("/analysis") ||
        normalizedPathname.endsWith("/claim")))
  ) {
    return "page-gradient-analysis";
  }

  if (normalizedPathname.startsWith("/admin/cases")) {
    return "page-gradient-case-operations";
  }

  if (normalizedPathname.startsWith("/admin/diminished-value")) {
    return "page-gradient-dv-operations";
  }

  if (normalizedPathname.startsWith("/auth/callback")) {
    return "page-gradient-auth";
  }

  return "page-gradient-not-found";
}
