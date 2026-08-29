import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import {
  getTotalLossCheckoutQuote,
  getTotalLossClaim,
  renewTotalLossClaimAccessLink,
  requestTotalLossClaimRecovery,
} from "@/features/total-loss-claim/api";
import { server } from "@/test/mocks/server";

const CASE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_CASE_ID = "55555555-5555-4555-8555-555555555555";
const CLAIM_ID = "44444444-4444-4444-8444-444444444444";

describe("total-loss claim API", () => {
  it("loads an authenticated read-only checkout quote without creating a session", async () => {
    let authorization: string | null = null;
    let checkoutCreationCalls = 0;
    server.use(
      http.get(
        "*/api/v1/appraisal-cases/:caseId/checkout-quote",
        ({ request }) => {
          authorization = request.headers.get("Authorization");
          return HttpResponse.json({
            amountMinorUnits: 12900,
            availability: "available",
            currency: "USD",
          });
        },
      ),
      http.post("*/api/v1/appraisal-cases/:caseId/checkout-sessions", () => {
        checkoutCreationCalls += 1;
        return HttpResponse.json({}, { status: 500 });
      }),
    );

    await expect(
      getTotalLossCheckoutQuote(CASE_ID, "access-token"),
    ).resolves.toEqual({
      amountMinorUnits: 12900,
      availability: "available",
      currency: "USD",
    });
    expect(authorization).toBe("Bearer access-token");
    expect(checkoutCreationCalls).toBe(0);
  });

  it("maps an owner-authorized resolver and sends its bearer token", async () => {
    let authorization: string | null = null;
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", ({ request }) => {
        authorization = request.headers.get("Authorization");
        return HttpResponse.json({
          state: "secure_required",
          caseId: CASE_ID,
          commerce: null,
          contactEmail: "owner@example.com",
          workflow: {
            phase: "review",
            currentTask: "secure_claim",
            revision: 2,
          },
        });
      }),
    );

    await expect(getTotalLossClaim(CASE_ID, "access-token")).resolves.toEqual({
      state: "secure_required",
      caseId: CASE_ID,
      commerce: null,
      contactEmail: "owner@example.com",
      workflow: {
        phase: "review",
        currentTask: "secure_claim",
        revision: 2,
      },
    });
    expect(authorization).toBe("Bearer access-token");
  });

  it("maps only the customer-safe secured commerce projection", async () => {
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json({
          state: "secured",
          caseId: CASE_ID,
          commerce: {
            checkoutAvailable: false,
            orderStatus: "paid",
            paymentStatus: "succeeded",
            entitlementStatus: "active",
            nextTask: "purchase_complete",
          },
          contactEmail: "owner@example.com",
          workflow: {
            phase: "review",
            currentTask: "purchase_complete",
            revision: 3,
          },
        }),
      ),
    );

    await expect(getTotalLossClaim(CASE_ID, "access-token")).resolves.toEqual({
      state: "secured",
      caseId: CASE_ID,
      commerce: {
        checkoutAvailable: false,
        orderStatus: "paid",
        paymentStatus: "succeeded",
        entitlementStatus: "active",
        nextTask: "purchase_complete",
      },
      contactEmail: "owner@example.com",
      workflow: {
        phase: "review",
        currentTask: "purchase_complete",
        revision: 3,
      },
    });
  });

  it("maps the allowlisted published-report evidence without provider identifiers", async () => {
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json({
          caseId: CASE_ID,
          commerce: {
            checkoutAvailable: false,
            entitlementStatus: "active",
            nextTask: "report_ready",
            orderStatus: "paid",
            paymentStatus: "succeeded",
          },
          contactEmail: "owner@example.com",
          report: {
            conclusion: {
              classificationLabel: "Material undervalue signal",
              continuingSupported: true,
              indicatedDifference: {
                amountMinorUnits: 300000,
                currency: "USD",
                formatted: "$3,000.00",
              },
              insurerValuation: {
                amountMinorUnits: 1800000,
                currency: "USD",
                formatted: "$18,000.00",
              },
              limitations: ["Advertised prices are not transaction prices."],
              preliminaryComparison: {
                materialChange: false,
                status: "CONFIRMED",
                summary: "The final review confirmed the preliminary range.",
              },
              summary: "The evidence supports a written reconsideration request.",
              supportedRange: {
                evidenceBasis: "Current advertised-price evidence",
                high: {
                  amountMinorUnits: 2200000,
                  currency: "USD",
                  formatted: "$22,000.00",
                },
                low: {
                  amountMinorUnits: 2000000,
                  currency: "USD",
                  formatted: "$20,000.00",
                },
                median: {
                  amountMinorUnits: 2100000,
                  currency: "USD",
                  formatted: "$21,000.00",
                },
              },
            },
            insurerEvidence: {
              adjustmentContext:
                "Insurer adjustments are shown as disclosed; missing details are not invented.",
              comparableCount: 3,
              comparables: [
                {
                  adjustedValue: "$20,000.00",
                  adjustmentDisclosure: "Fully disclosed",
                  adjustments: {
                    condition: "$0.00",
                    mileage: "$200.00",
                    options: "$0.00",
                    package: "$0.00",
                  },
                  advertisedPrice: "$19,800.00",
                  contributionPercent: 33.33,
                  mileage: 32000,
                  netAdjustment: "$200.00",
                  vehicle: "2022 Example Sedan",
                },
              ],
              insurerName: "Example Insurance",
              methodologyStatement: "Insurer comparables are shown descriptively.",
              summary: {
                adjustedValueMissingCount: 0,
                adjustedValues: null,
                advertisedPriceMissingCount: 0,
                advertisedPrices: null,
                fullyDisclosedAdjustmentCount: 2,
                partiallyDisclosedAdjustmentCount: 1,
                totalCount: 3,
                undisclosedAdjustmentCount: 0,
                unavailableAdjustmentCount: 0,
              },
            },
            issueDate: "2026-08-29",
            marketEvidence: {
              comparables: [
                {
                  advertisedPrice: "$21,000.00",
                  dealer: "Example Motors",
                  distanceMiles: 12.5,
                  evidenceDate: "2026-08-28",
                  location: "Chicago, IL",
                  mileage: 31500,
                  provider: "must-not-pass-through",
                  role: "PRIMARY",
                  sourceListingId: "must-not-pass-through",
                  temporalBasis: "Current listing",
                  vehicle: "2022 Example Sedan",
                  vin: "must-not-pass-through",
                },
              ],
              evidenceDateContext: {
                currentObservedDate: "2026-08-28",
                historicalEvidenceDate: null,
                lossDate: "2026-08-01",
              },
              methodologyStatement: "Only frozen selected evidence is shown.",
              primary: {
                description: "Selected current advertised listings.",
                evidenceDate: "2026-08-28",
                label: "Current market evidence",
                prices: null,
                selectedCount: 1,
              },
              secondary: null,
            },
            reportId: CLAIM_ID,
            status: "published",
            subjectVehicle: { description: "2022 Example Sedan" },
            suggestedFilename: "Venfour_Valuation_Evidence_CASE_v1.pdf",
            versionLabel: "v1",
            versionNumber: 1,
          },
          state: "secured",
          workflow: {
            currentTask: "report_ready",
            phase: "review",
            revision: 4,
          },
        }),
      ),
    );

    const result = await getTotalLossClaim(CASE_ID, "access-token");

    expect(result.state).toBe("secured");
    expect(result.report).toMatchObject({
      conclusion: {
        classificationLabel: "Material undervalue signal",
        preliminaryComparison: {
          status: "CONFIRMED",
          summary: "The final review confirmed the preliminary range.",
        },
      },
      insurerEvidence: {
        comparableCount: 3,
        summary: { fullyDisclosedAdjustmentCount: 2 },
      },
      marketEvidence: {
        comparables: [
          {
            advertisedPrice: "$21,000.00",
            location: "Chicago, IL",
            vehicle: "2022 Example Sedan",
          },
        ],
      },
    });
    expect(result.report?.marketEvidence.comparables[0]).not.toHaveProperty(
      "vin",
    );
    expect(result.report?.marketEvidence.comparables[0]).not.toHaveProperty(
      "provider",
    );
    expect(result.report?.marketEvidence.comparables[0]).not.toHaveProperty(
      "sourceListingId",
    );
  });

  it("rejects unsupported commerce statuses and commerce disclosure before permanent ownership", async () => {
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json({
          state: "secured",
          caseId: CASE_ID,
          commerce: {
            checkoutAvailable: false,
            orderStatus: "paid",
            paymentStatus: "requires_action",
            entitlementStatus: "active",
            nextTask: "purchase_complete",
          },
          contactEmail: null,
          workflow: null,
        }),
      ),
    );

    await expect(getTotalLossClaim(CASE_ID, "access-token")).rejects.toThrow(
      /invalid payment status/u,
    );

    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json({
          state: "account_switch_required",
          caseId: CASE_ID,
          commerce: {
            checkoutAvailable: false,
            orderStatus: "paid",
            paymentStatus: "succeeded",
            entitlementStatus: "active",
            nextTask: "purchase_complete",
          },
          contactEmail: null,
          workflow: null,
        }),
      ),
    );

    await expect(getTotalLossClaim(CASE_ID, "access-token")).rejects.toThrow(
      /invalid commerce state/u,
    );
  });

  it("rejects case identity drift and contact disclosure in mismatch state", async () => {
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json({
          state: "account_switch_required",
          caseId: OTHER_CASE_ID,
          commerce: null,
          contactEmail: "must-not-be-returned@example.com",
          workflow: null,
        }),
      ),
    );

    await expect(getTotalLossClaim(CASE_ID, "access-token")).rejects.toThrow(
      /exposed contact details|different case/u,
    );
  });

  it("validates a renewed access link before returning it", async () => {
    server.use(
      http.post(
        "*/api/v1/appraisal-cases/:caseId/claim/access-link",
        () =>
          HttpResponse.json(
            {
              state: "secure_required",
              caseId: CASE_ID,
              contactEmail: "owner@example.com",
              claimId: CLAIM_ID,
              expiresAt: "2026-08-26T13:00:00.000Z",
            },
            { status: 202 },
          ),
      ),
    );

    await expect(
      renewTotalLossClaimAccessLink(CASE_ID, "access-token"),
    ).resolves.toMatchObject({ caseId: CASE_ID, claimId: CLAIM_ID });
  });

  it("allows an access-link request to report a concurrent secured state without exposing link details", async () => {
    server.use(
      http.post(
        "*/api/v1/appraisal-cases/:caseId/claim/access-link",
        () =>
          HttpResponse.json({
            state: "secured",
            caseId: CASE_ID,
            contactEmail: null,
            claimId: null,
            expiresAt: null,
          }),
      ),
    );

    await expect(
      renewTotalLossClaimAccessLink(CASE_ID, "access-token"),
    ).resolves.toEqual({
      state: "secured",
      caseId: CASE_ID,
      contactEmail: null,
      claimId: null,
      expiresAt: null,
    });
  });

  it("sends the public recovery body without returning match details", async () => {
    let body: unknown;
    let authorization: string | null = "unexpected";
    server.use(
      http.post(
        "*/api/v1/appraisal-cases/:caseId/claim/access-recovery",
        async ({ request }) => {
          authorization = request.headers.get("Authorization");
          body = await request.json();
          return HttpResponse.json({ status: "accepted" }, { status: 202 });
        },
      ),
    );

    await expect(
      requestTotalLossClaimRecovery(CASE_ID, {
        email: "owner@example.com",
        turnstileToken: "fresh-token",
      }),
    ).resolves.toEqual({ status: "accepted" });
    expect(body).toEqual({
      email: "owner@example.com",
      turnstileToken: "fresh-token",
    });
    expect(authorization).toBeNull();
  });
});
