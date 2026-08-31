import { TOTAL_LOSS_EDUCATION_STEPS, type TotalLossClaimSecured, type TotalLossEducationStep, type TotalLossPublishedReport } from '@/features/total-loss-claim/contracts';
export const CASE_ID = "33333333-3333-4333-8333-333333333333";
export const REPORT_ID = "44444444-4444-4444-8444-444444444444";
export const USER_ID = "22222222-2222-4222-8222-222222222222";
export const NOW = "2026-08-31T18:00:00.000Z";
export const BASE = `/total-loss/cases/${CASE_ID}/claim`;
function money(amountMinorUnits: number, formatted: string) {
  return { amountMinorUnits, currency: "USD", formatted };
}

function publishedReport(): TotalLossPublishedReport {
  return {
    conclusion: {
      classificationLabel: "Potential undervaluation",
      continuingSupported: true,
      indicatedDifference: money(144400, "$1,444"),
      insurerValuation: money(1904600, "$19,046"),
      limitations: [
        "Advertised prices are not completed-sale prices.",
        "No independent condition adjustment was calculated.",
        "The full package records additional provider coverage limitations.",
      ],
      preliminaryComparison: { status: "CONFIRMED", summary: "The completed review confirmed the saved result." },
      summary: "The completed evidence supports a written reconsideration request.",
      supportedRange: {
        low: money(1980000, "$19,800"),
        median: money(2049000, "$20,490"),
        high: money(2226300, "$22,263"),
        evidenceBasis: "Current advertised-price evidence",
      },
    },
    insurerEvidence: {
      adjustmentContext: "Only adjustments disclosed in the insurer report are shown.",
      comparableCount: 1,
      comparables: [{
        vehicle: "2022 Insurer Example Sedan",
        mileage: 32000,
        advertisedPrice: "$19,800",
        adjustedValue: "$19,500",
        netAdjustment: "-$300",
        adjustments: { condition: "-$500", mileage: "$200", options: null, package: null },
        adjustmentDisclosure: "Partially disclosed",
        contributionPercent: null,
      }],
      insurerName: "Example Insurance",
      methodologyStatement: "Every insurer comparable is shown descriptively.",
      summary: {
        totalCount: 1,
        adjustedValueMissingCount: 0,
        adjustedValues: { count: 1, low: money(1950000, "$19,500"), high: money(1950000, "$19,500"), median: money(1950000, "$19,500") },
        advertisedPriceMissingCount: 0,
        advertisedPrices: { count: 1, low: money(1980000, "$19,800"), high: money(1980000, "$19,800"), median: money(1980000, "$19,800") },
        fullyDisclosedAdjustmentCount: 0,
        partiallyDisclosedAdjustmentCount: 1,
        unavailableAdjustmentCount: 0,
        undisclosedAdjustmentCount: 0,
      },
    },
    marketEvidence: {
      comparables: [{
        vehicle: "2022 Market Example Sedan",
        advertisedPrice: "$20,490",
        dealer: "Example Motors",
        location: "Chicago, IL",
        distanceMiles: 12.5,
        mileage: 31500,
        role: "PRIMARY",
        evidenceDate: "2026-08-28",
        temporalBasis: "CURRENT_MARKET",
      }],
      evidenceDateContext: {
        currentObservedDate: "2026-08-28",
        historicalEvidenceDate: null,
        lossDate: "2026-08-01",
      },
      methodologyStatement: "Only selected advertised-price evidence is shown.",
      primary: {
        label: "Current market evidence",
        description: "Selected current advertised listings.",
        evidenceDate: "2026-08-28",
        selectedCount: 1,
        prices: null,
      },
      secondary: null,
    },
    issueDate: "2026-08-29",
    reportId: REPORT_ID,
    status: "published",
    subjectVehicle: { description: "2022 Example Sedan" },
    suggestedFilename: "Venfour_Valuation_Evidence_Synthetic_v1.pdf",
    versionLabel: "v1",
    versionNumber: 1,
  };
}

function claimProjection(completed: readonly TotalLossEducationStep[] = []): TotalLossClaimSecured {
  return {
    caseId: CASE_ID,
    state: "secured",
    contactEmail: "owner@example.com",
    commerce: {
      checkoutAvailable: false,
      entitlementStatus: "active",
      nextTask: "report_ready",
      orderStatus: "paid",
      paymentStatus: "succeeded",
    },
    education: {
      reportVersionId: REPORT_ID,
      steps: Object.fromEntries(TOTAL_LOSS_EDUCATION_STEPS.map((step) => [step, {
        completedAt: completed.includes(step) ? NOW : null,
        viewedAt: completed.includes(step) ? NOW : null,
        skippedAt: null,
      }])) as NonNullable<TotalLossClaimSecured["education"]>["steps"],
    },
    journey: { fulfillmentState: "report_ready", nextState: "guide_result", retryable: false },
    messageDraft: {
      draftId: "55555555-5555-4555-8555-555555555555",
      purpose: "initial_reconsideration",
      recipient: "adjuster@example.com",
      reportVersionId: REPORT_ID,
      revision: 1,
      subject: "Claim CLM-42 valuation reconsideration",
      body: "Legacy saved draft that must not be normalized by an evidence visit.",
      updatedAt: NOW,
    },
    report: publishedReport(),
    sendingDetails: null,
    workflow: { currentTask: "report_ready", phase: "initial_request", revision: 7 },
  };
}


export { claimProjection };
