import type { TotalLossClaimFulfillmentState, TotalLossClaimJourneyState, TotalLossEducationStep } from "@/features/total-loss-claim/contracts";
export const USER_ID = "22222222-2222-4222-8222-222222222222";
export const CASE_ID = "33333333-3333-4333-8333-333333333333";
export const OTHER_CASE_ID = "77777777-7777-4777-8777-777777777777";
export const REPORT_ID = "44444444-4444-4444-8444-444444444444";
export const RUN_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "55555555-5555-4555-8555-555555555555";
export const NOW = "2026-09-15T12:00:00.000Z";

// Fictional values used only by the isolated local workspace preview.
export function educationSteps(
  resultCompleted = false,
): Record<
  TotalLossEducationStep,
  {
    completedAt: string | null;
    skippedAt: string | null;
    viewedAt: string | null;
  }
> {
  return {
    result: {
      completedAt: resultCompleted ? NOW : null,
      skippedAt: null,
      viewedAt: resultCompleted ? NOW : null,
    },
    insurer_review: { completedAt: null, skippedAt: null, viewedAt: null },
    valuation: { completedAt: null, skippedAt: null, viewedAt: null },
    report: { completedAt: null, skippedAt: null, viewedAt: null },
    what_next: { completedAt: null, skippedAt: null, viewedAt: null },
    send: { completedAt: null, skippedAt: null, viewedAt: null },
  };
}

export function completedEducationSteps() {
  const progress = educationSteps(true);
  for (const step of ["insurer_review", "valuation", "report", "what_next"] as const) {
    progress[step] = { viewedAt: NOW, completedAt: NOW, skippedAt: null };
  }
  return progress;
}

const money = (amountMinorUnits: number, formatted: string) => ({
  amountMinorUnits,
  currency: "USD",
  formatted,
});

function report(continuingSupported = true) {
  return {
    conclusion: {
      classificationLabel: continuingSupported
        ? "Material undervalue signal"
        : "Existing valuation reasonably supported",
      continuingSupported,
      indicatedDifference: continuingSupported ? money(300000, "$3,000") : null,
      insurerValuation: money(1800000, "$18,000"),
      limitations: ["Advertised prices are not guaranteed transaction prices."],
      preliminaryComparison: {
        status: "CONFIRMED",
        summary:
          "The final review confirmed the preliminary classification and supported range.",
      },
      summary: continuingSupported
        ? "The completed review supports a written reconsideration request."
        : "Final QA did not find sufficient evidence for a higher valuation request.",
      supportedRange: continuingSupported
        ? {
            evidenceBasis: "Selected current-market evidence",
            high: money(2200000, "$22,000"),
            low: money(2000000, "$20,000"),
            median: money(2100000, "$21,000"),
          }
        : null,
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
          mileage: 32_000,
          netAdjustment: "$200.00",
          vehicle: "2026 Hyundai Kona SE",
        },
      ],
      insurerName: "Example Insurance",
      methodologyStatement:
        "Every insurer comparable was shown descriptively; V1 did not assign professional weights.",
      summary: {
        adjustedValueMissingCount: 0,
        adjustedValues: null,
        advertisedPriceMissingCount: 0,
        advertisedPrices: null,
        fullyDisclosedAdjustmentCount: 2,
        partiallyDisclosedAdjustmentCount: 1,
        totalCount: 3,
        unavailableAdjustmentCount: 0,
        undisclosedAdjustmentCount: 0,
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
          mileage: 31_500,
          role: "PRIMARY",
          temporalBasis: "Current listing",
          vehicle: "2026 Hyundai Kona SE",
        },
      ],
      evidenceDateContext: {
        currentObservedDate: "2026-08-28",
        historicalEvidenceDate: null,
        lossDate: "2026-08-01",
      },
      methodologyStatement:
        "Only selected frozen evidence from the completed deterministic review is shown.",
      primary: {
        description: "Selected current advertised listings.",
        evidenceDate: "2026-08-28",
        label: "Current market evidence",
        prices: null,
        selectedCount: 1,
      },
      secondary: null,
    },
    reportId: REPORT_ID,
    status: "published",
    subjectVehicle: { description: "2026 Hyundai Kona SE" },
    suggestedFilename: "Venfour_Valuation_Evidence_Synthetic_v1.pdf",
    versionLabel: "v1",
    versionNumber: 1,
  };
}

function draft() {
  return {
    body: "Please review the attached valuation evidence package and respond in writing.",
    draftId: DRAFT_ID,
    purpose: "initial_reconsideration",
    recipient: "adjuster@example.com",
    reportVersionId: REPORT_ID,
    revision: 1,
    subject: "Claim CLM-42 valuation reconsideration",
    updatedAt: NOW,
  };
}

export function claimProjection({
  continuingSupported = true,
  entitlementStatus = "active",
  fulfillmentState,
  journey = "guide_result",
  progress = educationSteps(false),
  withDraft = false,
}: {
  readonly continuingSupported?: boolean;
  readonly entitlementStatus?:
    "active" | "refunded_access_retained" | "revoked" | "suspended";
  readonly fulfillmentState?: TotalLossClaimFulfillmentState;
  readonly journey?: TotalLossClaimJourneyState;
  readonly progress?: ReturnType<typeof educationSteps>;
  readonly withDraft?: boolean;
} = {}) {
  const noDispute = !continuingSupported;
  return {
    caseId: CASE_ID,
    commerce: {
      checkoutAvailable: journey === "checkout",
      entitlementStatus: journey === "checkout" ? null : entitlementStatus,
      nextTask: journey,
      orderStatus:
        journey === "checkout" ? null : noDispute ? "refunded" : "paid",
      paymentStatus:
        journey === "checkout" ? null : noDispute ? "refunded" : "succeeded",
    },
    contactEmail: "preview@example.com",
    education:
      journey === "checkout"
        ? null
        : { reportVersionId: REPORT_ID, steps: progress },
    journey: {
      fulfillmentState:
        fulfillmentState ??
        (journey === "checkout"
          ? "not_started"
          : journey === "awaiting_insurer_response"
            ? "awaiting_insurer_response"
            : noDispute
              ? "no_dispute"
              : "report_ready"),
      nextState: journey,
      retryable: false,
    },
    responseIntake: journey === "awaiting_insurer_response" ? { negotiationRoundId: "12121212-1212-4212-8212-121212121212", outboundCommunicationId: "13131313-1313-4313-8313-131313131313" } : null,
    negotiationHistory: progress.send.completedAt ? [{
      negotiationRoundId: "12121212-1212-4212-8212-121212121212", roundNumber: 1,
      outbound: { ...draft(), state: "sent", messageVersionId: "66666666-6666-4666-8666-666666666666",
        versionNumber: 1, createdAt: NOW, customerReportedSentAt: progress.send.completedAt,
        communicationId: "13131313-1313-4313-8313-131313131313", negotiationRoundId: "12121212-1212-4212-8212-121212121212" },
      responses: [], followUp: null, supersededFollowUpDrafts: [],
    }] : [],
    messageDraft: withDraft ? draft() : null,
    report: journey === "checkout" ? null : report(continuingSupported),
    sendingDetails:
      journey === "checkout"
        ? null
        : {
            adjusterEmail: "adjuster@example.com",
            adjusterEmailConfirmed: true,
            adjusterName: "A. Adjuster",
            claimReference: "CLM-42",
            claimReferenceConfirmed: true,
            customerName: "Case Owner",
            insurerName: "Example Insurance",
            revision: 1,
            vehicleDescription: "2026 Hyundai Kona SE",
          },
    state: "secured",
    workflow: {
      currentTask: journey,
      phase: "initial_request",
      revision: 7,
    },
  };
}

