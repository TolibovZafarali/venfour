import { describe, expect, it } from "vitest";

import { createCaseDashboardModel } from "@/features/cases/case-dashboard-model";
import type { AppraisalCase } from "@/features/cases/types";
import type { DiminishedValueCaseDetails } from "@/features/diminished-value/data-types";
import type {
  TotalLossClaimFulfillmentState,
  TotalLossClaimJourneyState,
  TotalLossClaimSecured,
  TotalLossMessageDraft,
  TotalLossPublishedReport,
} from "@/features/total-loss-claim/contracts";
import type { TotalLossCaseDetails } from "@/features/total-loss/data-types";

const CASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CLAIM_BASE = `/total-loss/cases/${CASE_ID}/claim`;
const ANALYSIS_PATH = `/total-loss/cases/${CASE_ID}/analysis`;

function appraisalCase(
  overrides: Partial<AppraisalCase> = {},
): AppraisalCase {
  return {
    id: CASE_ID,
    userId: USER_ID,
    serviceType: "total_loss",
    status: "draft",
    caseStage: "intake_in_progress",
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-08-22T15:00:00.000Z",
    lastActivityAt: "2026-08-22T15:00:00.000Z",
    ...overrides,
  };
}

function totalLossDetails(
  overrides: Partial<TotalLossCaseDetails> = {},
): TotalLossCaseDetails {
  return {
    caseId: CASE_ID,
    intakeMode: "report",
    vin: null,
    vehicleYear: null,
    vehicleMake: null,
    vehicleModel: null,
    vehicleTrim: null,
    mileageAtLoss: null,
    postalCode: null,
    dateOfLoss: null,
    insurerName: null,
    insurerVehicleValuation: null,
    reportUploadRecoveryRequired: false,
    reportOriginalFilename: null,
    reportUploadedAt: null,
    intakeCompletedAt: null,
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-08-22T15:00:00.000Z",
    ...overrides,
  };
}

function diminishedValueDetails(
  overrides: Partial<DiminishedValueCaseDetails> = {},
): DiminishedValueCaseDetails {
  return {
    caseId: CASE_ID,
    revision: 2,
    draftStep: "vehicle",
    accidentState: null,
    accidentDate: null,
    repairStatus: null,
    vehicleEntryMethod: "details",
    vin: null,
    vehicleYear: null,
    vehicleMake: null,
    vehicleModel: null,
    vehicleTrim: null,
    mileageAtAccident: null,
    currentMileage: null,
    otherPartyAtFault: null,
    atFaultInsurer: null,
    repairCost: null,
    repairFacility: null,
    structuralDamage: null,
    airbagDeployment: null,
    majorRepairDetails: null,
    fullName: null,
    email: null,
    phone: null,
    preferredContactMethod: null,
    availability: null,
    notes: null,
    submittedAt: null,
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-08-22T15:00:00.000Z",
    ...overrides,
  };
}

function fulfillmentState(
  nextState: TotalLossClaimJourneyState,
): TotalLossClaimFulfillmentState {
  switch (nextState) {
    case "secure_claim":
      return "not_started";
    case "checkout":
      return "payment_pending";
    case "checkout_confirmation":
    case "processing":
      return "finalizing";
    case "awaiting_insurer_response":
      return "awaiting_insurer_response";
    case "insurer_response_received":
      return "insurer_response_received";
    case "no_dispute":
      return "no_dispute";
    case "needs_attention":
      return "needs_attention";
    default:
      return "report_ready";
  }
}

function claim(
  nextState: TotalLossClaimJourneyState,
  overrides: Partial<TotalLossClaimSecured> = {},
): TotalLossClaimSecured {
  return {
    caseId: CASE_ID,
    state: "secured",
    contactEmail: null,
    workflow: {
      currentTask: nextState,
      phase: "review",
      revision: 4,
    },
    commerce: {
      checkoutAvailable: nextState === "checkout",
      entitlementStatus: "active",
      nextTask: nextState,
      orderStatus: "paid",
      paymentStatus: "succeeded",
    },
    journey: {
      fulfillmentState: fulfillmentState(nextState),
      nextState,
      retryable: false,
    },
    ...overrides,
  };
}

function publishedReport(
  overrides: Partial<TotalLossPublishedReport> = {},
): TotalLossPublishedReport {
  return {
    status: "published",
    issueDate: "2026-08-24T16:30:00.000Z",
    subjectVehicle: { description: "2021 Honda Accord EX" },
    insurerEvidence: { insurerName: "Report Insurance" },
    ...overrides,
  } as TotalLossPublishedReport;
}

function messageDraft(
  overrides: Partial<TotalLossMessageDraft> = {},
): TotalLossMessageDraft {
  return {
    body: "Please reconsider this valuation.",
    draftId: "draft-1",
    purpose: "initial_reconsideration",
    recipient: "adjuster@example.test",
    reportVersionId: "report-version-1",
    revision: 1,
    subject: "Valuation reconsideration request",
    updatedAt: "2026-08-25T10:00:00.000Z",
    ...overrides,
  };
}

function milestoneStates(
  model: ReturnType<typeof createCaseDashboardModel>,
) {
  return Object.fromEntries(
    model.milestones.map(({ id, state }) => [id, state]),
  );
}

describe("case dashboard model", () => {
  it("maps an intake case without inventing downstream progress", () => {
    const model = createCaseDashboardModel({
      appraisalCase: appraisalCase({ caseStage: "report_required" }),
    });

    expect(model.statusCode).toBe("intake");
    expect(model.statusLabel).toBe("Your valuation report is needed");
    expect(milestoneStates(model)).toEqual({
      vehicle: "current",
      analysis: "upcoming",
    });
    expect(model.nextAction).toEqual({
      href: `/start?service=total-loss&view=intake&caseId=${CASE_ID}`,
      label: "Continue review",
      required: true,
    });
  });

  it.each([
    [
      "ready_for_analysis",
      "analysis_ready",
      "current",
      "Start value check",
      true,
    ],
    [
      "analysis_processing",
      "analysis_processing",
      "current",
      "View progress",
      false,
    ],
    [
      "analysis_failed",
      "analysis_attention",
      "attention",
      "Review value check",
      true,
    ],
    [
      "analysis_complete",
      "preliminary_result",
      "current",
      "View result",
      true,
    ],
  ] as const)(
    "maps %s to its preliminary analysis state",
    (caseStage, statusCode, analysisMilestone, actionLabel, required) => {
      const model = createCaseDashboardModel({
        appraisalCase: appraisalCase({ caseStage }),
      });

      expect(model.statusCode).toBe(statusCode);
      expect(milestoneStates(model)).toEqual({
        vehicle: "complete",
        analysis: analysisMilestone,
      });
      expect(model.nextAction).toEqual({
        href: ANALYSIS_PATH,
        label: actionLabel,
        required,
      });
    },
  );

  it("maps checkout to payment and keeps the valuation report upcoming", () => {
    const model = createCaseDashboardModel({
      appraisalCase: appraisalCase({ caseStage: "analysis_complete" }),
      totalLossDetails: totalLossDetails(),
      claim: claim("checkout"),
    });

    expect(model.statusCode).toBe("payment");
    expect(model.nextAction).toEqual({
      href: `${CLAIM_BASE}/checkout`,
      label: "Continue to payment",
      required: true,
    });
    expect(milestoneStates(model)).toMatchObject({
      continuation: "current",
      report: "upcoming",
    });
  });

  it("maps report processing without claiming a required customer action", () => {
    const model = createCaseDashboardModel({
      appraisalCase: appraisalCase({ caseStage: "analysis_complete" }),
      totalLossDetails: totalLossDetails(),
      claim: claim("processing"),
    });

    expect(model.statusCode).toBe("report_processing");
    expect(model.nextAction).toEqual({
      href: `${CLAIM_BASE}/processing`,
      label: "View progress",
      required: false,
    });
    expect(milestoneStates(model).report).toBe("current");
  });

  it("maps a published report to review with the issue timestamp", () => {
    const model = createCaseDashboardModel({
      appraisalCase: appraisalCase({ caseStage: "analysis_complete" }),
      totalLossDetails: totalLossDetails(),
      claim: claim("guide_result", { report: publishedReport() }),
    });

    expect(model.statusCode).toBe("report_review");
    expect(model.statusTone).toBe("complete");
    expect(model.reportIssuedAt).toBe("2026-08-24T16:30:00.000Z");
    expect(model.nextAction).toEqual({
      href: `${CLAIM_BASE}/review/result`,
      label: "Review valuation",
      required: true,
    });
    expect(milestoneStates(model)).toMatchObject({
      report: "current",
      request: "upcoming",
    });
  });

  it("distinguishes request preparation from a saved request ready to send", () => {
    const preparing = createCaseDashboardModel({
      appraisalCase: appraisalCase({ caseStage: "analysis_complete" }),
      totalLossDetails: totalLossDetails(),
      claim: claim("prepare_request"),
    });
    const ready = createCaseDashboardModel({
      appraisalCase: appraisalCase({ caseStage: "analysis_complete" }),
      totalLossDetails: totalLossDetails(),
      claim: claim("prepare_request", { messageDraft: messageDraft() }),
    });

    expect(preparing.statusCode).toBe("request_preparation");
    expect(preparing.nextAction?.label).toBe("Prepare request");
    expect(ready.statusCode).toBe("request_ready");
    expect(ready.nextAction).toEqual({
      href: `${CLAIM_BASE}/review/request`,
      label: "Review and send request",
      required: true,
    });
    expect(milestoneStates(ready)).toMatchObject({
      report: "complete",
      request: "current",
      waiting: "upcoming",
    });
  });

  it("describes awaiting-insurer state as customer-reported, not verified delivery", () => {
    const model = createCaseDashboardModel({
      appraisalCase: appraisalCase({ caseStage: "analysis_complete" }),
      totalLossDetails: totalLossDetails({ insurerName: "Acme Insurance" }),
      claim: claim("awaiting_insurer_response"),
    });

    expect(model.statusCode).toBe("waiting_for_insurer");
    expect(model.statusLabel).toBe("Waiting for Acme Insurance");
    expect(model.statusExplanation).toContain("You confirmed the request was sent");
    expect(model.statusExplanation).toContain("case remains active");
    expect(model.statusExplanation).toContain(
      "cannot monitor email or detect the insurer’s response automatically",
    );
    expect(model.statusExplanation).not.toMatch(/delivered|received by/i);
    expect(model.nextAction).toEqual({
      href: `${CLAIM_BASE}/review/waiting`,
      label: "Return to case",
      required: false,
    });
    expect(milestoneStates(model)).toMatchObject({
      request: "complete",
      waiting: "current",
    });
  });

  it("keeps a received response active without implying analysis or advice", () => {
    const model = createCaseDashboardModel({
      appraisalCase: appraisalCase({ caseStage: "analysis_complete" }),
      totalLossDetails: totalLossDetails({ insurerName: "Acme Insurance" }),
      claim: claim("insurer_response_received"),
    });

    expect(model.statusCode).toBe("response_received");
    expect(model.statusLabel).toBe("Insurer response received");
    expect(model.statusExplanation).toContain("saved with this case");
    expect(model.statusExplanation).toContain("has not analyzed it");
    expect(model.nextAction).toEqual({
      href: `${CLAIM_BASE}/review/response-received`,
      label: "Review saved response",
      required: false,
    });
    expect(milestoneStates(model)).toMatchObject({
      request: "complete",
      waiting: "complete",
      response: "current",
    });
  });

  it("maps no-dispute outcomes conservatively", () => {
    const model = createCaseDashboardModel({
      appraisalCase: appraisalCase({ caseStage: "analysis_complete" }),
      totalLossDetails: totalLossDetails(),
      claim: claim("no_dispute"),
    });

    expect(model.statusCode).toBe("no_dispute");
    expect(model.statusExplanation).toContain(
      "did not support continuing to an insurer request",
    );
    expect(model.nextAction).toEqual({
      href: `${CLAIM_BASE}/review/result`,
      label: "Review result",
      required: false,
    });
    expect(milestoneStates(model).report).toBe("current");
  });

  it("lets refund-pending fulfillment override the journey presentation", () => {
    const refundClaim = claim("no_dispute");
    const model = createCaseDashboardModel({
      appraisalCase: appraisalCase({ caseStage: "analysis_complete" }),
      totalLossDetails: totalLossDetails(),
      claim: {
        ...refundClaim,
        journey: {
          ...refundClaim.journey!,
          fulfillmentState: "refund_pending",
        },
      },
    });

    expect(model.statusCode).toBe("refund_pending");
    expect(model.statusTone).toBe("attention");
    expect(model.nextAction).toEqual({
      href: `${CLAIM_BASE}/review/result`,
      label: "Review status",
      required: false,
    });
    expect(milestoneStates(model).report).toBe("attention");
  });

  it("maps claim workflow exceptions to an attention state", () => {
    const model = createCaseDashboardModel({
      appraisalCase: appraisalCase({ caseStage: "analysis_complete" }),
      totalLossDetails: totalLossDetails(),
      claim: claim("needs_attention"),
    });

    expect(model.statusCode).toBe("needs_attention");
    expect(model.statusTone).toBe("attention");
    expect(model.nextAction).toEqual({
      href: `${CLAIM_BASE}/processing`,
      label: "Review status",
      required: true,
    });
    expect(milestoneStates(model).report).toBe("attention");
  });

  it("keeps a closed case closed even when a claim resolver is present", () => {
    const model = createCaseDashboardModel({
      appraisalCase: appraisalCase({ status: "closed", caseStage: "closed" }),
      claim: claim("guide_result"),
    });

    expect(model.statusCode).toBe("closed");
    expect(model.nextAction).toBeNull();
    expect(milestoneStates(model)).toMatchObject({ closed: "current" });
  });

  it("marks a generic pre-Continue attention case at the vehicle step", () => {
    const model = createCaseDashboardModel({
      appraisalCase: appraisalCase({
        caseStage: "needs_attention",
        needsAttention: true,
      }),
    });

    expect(model.statusCode).toBe("needs_attention");
    expect(milestoneStates(model)).toEqual({
      vehicle: "attention",
      analysis: "upcoming",
    });
  });

  it("places coarse post-Continue attention at claim continuation until resolution", () => {
    const model = createCaseDashboardModel({
      appraisalCase: appraisalCase({
        caseStage: "analysis_complete",
        analysisStatus: "completed",
        hasTotalLossClaimWorkflow: true,
        needsAttention: true,
      }),
    });

    expect(model.statusCode).toBe("needs_attention");
    expect(model.nextAction).toEqual({
      href: CLAIM_BASE,
      label: "Open case",
      required: true,
    });
    expect(milestoneStates(model)).toEqual({
      vehicle: "complete",
      analysis: "complete",
      continuation: "attention",
      report: "upcoming",
    });
  });

  it("gives a closed Diminished Value case a terminal milestone", () => {
    const model = createCaseDashboardModel({
      appraisalCase: appraisalCase({
        serviceType: "diminished_value",
        status: "closed",
        caseStage: "closed",
      }),
      diminishedValueDetails: diminishedValueDetails(),
    });

    expect(model.statusCode).toBe("closed");
    expect(milestoneStates(model)).toEqual({
      vehicle: "complete",
      closed: "current",
    });
  });

  it("maps Diminished Value details without implying an active workflow", () => {
    const model = createCaseDashboardModel({
      appraisalCase: appraisalCase({
        serviceType: "diminished_value",
        status: "submitted",
        caseStage: "submitted",
      }),
      diminishedValueDetails: diminishedValueDetails({
        vehicleYear: 2020,
        vehicleMake: "Toyota",
        vehicleModel: "Camry",
        vehicleTrim: "SE",
        accidentDate: "2026-08-05",
        atFaultInsurer: "Other Driver Insurance",
        submittedAt: "2026-08-22T15:00:00.000Z",
      }),
    });

    expect(model.serviceLabel).toBe("Diminished Value");
    expect(model.vehicleDisplayName).toBe("2020 Toyota Camry SE");
    expect(model.insurerName).toBe("Other Driver Insurance");
    expect(model.dateOfLoss).toBe("2026-08-05");
    expect(model.statusCode).toBe("service_update");
    expect(model.nextAction).toEqual({
      href: "/start?service=diminished-value",
      label: "View service update",
      required: false,
    });
    expect(milestoneStates(model)).toEqual({
      vehicle: "complete",
      service: "current",
    });
  });

  it("uses the claim resolver for the canonical destination, including manual intake routing", () => {
    const model = createCaseDashboardModel({
      appraisalCase: appraisalCase({ caseStage: "report_required" }),
      totalLossDetails: totalLossDetails({ intakeMode: "manual" }),
      claim: claim("guide_insurer_review"),
    });

    expect(model.canonicalResumeDestination).toBe(
      `${CLAIM_BASE}/review/market`,
    );
    expect(model.nextAction?.href).toBe(model.canonicalResumeDestination);
  });

  it("uses the neutral claim route until the intake mode is available", () => {
    const model = createCaseDashboardModel({
      appraisalCase: appraisalCase({
        caseStage: "report_required",
        hasTotalLossClaimWorkflow: true,
      }),
      claim: claim("guide_insurer_review"),
    });

    expect(model.canonicalResumeDestination).toBe(CLAIM_BASE);
    expect(model.nextAction?.href).toBe(CLAIM_BASE);
  });

  it("prefers structured details, then report facts, then a neutral fallback", () => {
    const structured = createCaseDashboardModel({
      appraisalCase: appraisalCase(),
      totalLossDetails: totalLossDetails({
        vehicleYear: 2022,
        vehicleMake: "  Subaru ",
        vehicleModel: " Outback ",
        vehicleTrim: " Touring ",
        insurerName: " Details Insurance ",
      }),
      claim: claim("guide_result", { report: publishedReport() }),
    });
    const reportFallback = createCaseDashboardModel({
      appraisalCase: appraisalCase({ caseStage: "analysis_complete" }),
      totalLossDetails: totalLossDetails(),
      claim: claim("guide_result", { report: publishedReport() }),
    });
    const neutralFallback = createCaseDashboardModel({
      appraisalCase: appraisalCase(),
    });

    expect(structured.vehicleDisplayName).toBe("2022 Subaru Outback Touring");
    expect(structured.insurerName).toBe("Details Insurance");
    expect(reportFallback.vehicleDisplayName).toBe("2021 Honda Accord EX");
    expect(reportFallback.insurerName).toBe("Report Insurance");
    expect(neutralFallback.vehicleDisplayName).toBe("Your total-loss case");
    expect(neutralFallback.insurerName).toBeNull();
  });

  it("contains no duplicate milestone identifiers across meaningful branches", () => {
    const models = [
      createCaseDashboardModel({ appraisalCase: appraisalCase() }),
      createCaseDashboardModel({
        appraisalCase: appraisalCase({ caseStage: "analysis_processing" }),
      }),
      ...([
        "checkout",
        "processing",
        "guide_result",
        "prepare_request",
        "awaiting_insurer_response",
        "no_dispute",
        "needs_attention",
      ] as const).map((nextState) =>
        createCaseDashboardModel({
          appraisalCase: appraisalCase({ caseStage: "analysis_complete" }),
          claim: claim(nextState),
        }),
      ),
    ];

    for (const model of models) {
      const ids = model.milestones.map(({ id }) => id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("exposes only the explicit safe case context", () => {
    const privateEmail = "owner-private@example.test";
    const privateVin = "1HGCM82633A004352";
    const privateClaimReference = "CLAIM-PRIVATE-42";
    const privateMessage = "PRIVATE MESSAGE BODY";
    const model = createCaseDashboardModel({
      appraisalCase: appraisalCase({ caseStage: "analysis_complete" }),
      totalLossDetails: totalLossDetails({
        vin: privateVin,
        vehicleYear: 2021,
        vehicleMake: "Honda",
        vehicleModel: "Accord",
        dateOfLoss: "2026-08-01",
        insurerName: "Example Insurance",
      }),
      claim: claim("prepare_request", {
        contactEmail: privateEmail,
        messageDraft: messageDraft({ body: privateMessage }),
        sendingDetails: {
          adjusterEmail: "private-adjuster@example.test",
          adjusterEmailConfirmed: true,
          adjusterName: "Private Adjuster",
          claimReference: privateClaimReference,
          claimReferenceConfirmed: true,
          customerName: "Private Customer",
          insurerName: "Example Insurance",
          revision: 2,
          vehicleDescription: "Private vehicle description",
        },
      }),
    });

    expect(model.safeContext).toEqual({
      caseId: CASE_ID,
      serviceType: "total_loss",
      vehicleDisplayName: "2021 Honda Accord",
      insurerName: "Example Insurance",
      dateOfLoss: "2026-08-01",
      statusCode: "request_ready",
    });
    expect(Object.keys(model.safeContext).sort()).toEqual(
      [
        "caseId",
        "dateOfLoss",
        "insurerName",
        "serviceType",
        "statusCode",
        "vehicleDisplayName",
      ].sort(),
    );

    const serialized = JSON.stringify(model.safeContext);
    for (const privateValue of [
      privateEmail,
      privateVin,
      privateClaimReference,
      privateMessage,
      "private-adjuster@example.test",
      "Private Customer",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });
});
