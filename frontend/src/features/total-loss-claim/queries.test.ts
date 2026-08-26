import { describe, expect, it } from "vitest";

import { totalLossClaimQueryKeys } from "@/features/total-loss-claim/queries";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "33333333-3333-4333-8333-333333333333";

describe("total-loss claim query keys", () => {
  it("nests every resolver cache below the case owner identity", () => {
    expect(totalLossClaimQueryKeys.detail(USER_ID, CASE_ID)).toEqual([
      "appraisalCases",
      "user",
      USER_ID,
      "detail",
      CASE_ID,
      "claim",
    ]);
  });
});
