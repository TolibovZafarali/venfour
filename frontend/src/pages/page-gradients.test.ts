import { describe, expect, test } from "vitest";

import {
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

});
