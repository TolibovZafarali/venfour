import { describe, expect, test } from "vitest";

import {
  appRouteGradientClassName,
  publicPageGradientClassNames,
} from "@/pages/page-gradients";

describe("page gradient routing", () => {
  test("keeps every editorial page on its own visual tone", () => {
    expect(new Set(Object.values(publicPageGradientClassNames)).size).toBe(5);
    expect(publicPageGradientClassNames).toEqual({
      contact: "page-gradient-contact",
      cookies: "page-gradient-cookies",
      methodology: "page-gradient-methodology",
      privacy: "page-gradient-privacy",
      terms: "page-gradient-terms",
    });
  });

  test.each([
    ["/appraisals", "page-gradient-appraisals"],
    ["/analyses/analysis-id", "page-gradient-analysis"],
    [
      "/total-loss/cases/case-id/analysis",
      "page-gradient-analysis",
    ],
    [
      "/total-loss/cases/case-id/claim",
      "page-gradient-analysis",
    ],
    ["/admin/cases", "page-gradient-case-operations"],
    ["/admin/cases/case-id", "page-gradient-case-operations"],
    ["/admin/diminished-value", "page-gradient-dv-operations"],
    ["/admin/diminished-value/case-id", "page-gradient-dv-operations"],
    ["/auth/callback", "page-gradient-auth"],
    ["/missing-page", "page-gradient-not-found"],
  ])("maps %s to %s", (pathname, className) => {
    expect(appRouteGradientClassName(pathname)).toBe(className);
  });

  test.each([
    "/",
    "/start",
    "/methodology",
    "/terms/",
    "/privacy",
    "/cookies",
    "/contact",
  ])("leaves the self-styled route %s unchanged", (pathname) => {
    expect(appRouteGradientClassName(pathname)).toBeUndefined();
  });
});
