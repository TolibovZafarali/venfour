import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { getTotalLossClaim } from "@/features/total-loss-claim/api";
import { server } from "@/test/mocks/server";
import { CASE_ID } from "./claim-fixtures";
import { responseScenarios, responseClaim, responsePayload } from "./response-fixtures";

describe("response screen fixtures", () => {
  it.each(responseScenarios)("renders %s through the customer claim contract", async phase => {
    const fixture = responseClaim(phase);
    server.use(http.get("*/api/v1/appraisal-cases/:caseId/claim", () => HttpResponse.json(responsePayload(fixture))));
    const claim = await getTotalLossClaim(CASE_ID, "preview-token");
    expect(claim.state).toBe("secured");
    if (claim.state !== "secured") throw new Error("Expected a saved claim");
    expect(claim.journey?.nextState).toBe(fixture.journey?.nextState);
    if (phase === "follow-up") {
      expect(claim.followUp?.state).toBe("available");
      expect(claim.followUp?.draft).toBeNull();
      expect(claim.insurerResponse?.decision?.choice).toBe("CONTINUE_CHALLENGING");
    }
    if (phase === "acceptance") {
      expect(claim.resolution).toBeUndefined();
      expect(claim.insurerResponse?.decision?.choice).toBe("ACCEPT_OFFER");
      expect(claim.insurerResponse?.decision?.offerId).toBe(claim.insurerResponse?.usableOffer?.offerId);
    }
    if (phase === "resolution") expect(claim.resolution?.amountSource).toBe("CUSTOMER_REPORTED");
  });
});
