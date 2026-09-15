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
