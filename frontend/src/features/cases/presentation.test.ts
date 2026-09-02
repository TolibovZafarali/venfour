import { describe, expect, it } from "vitest";

import { appraisalCasePresentation } from "@/features/cases/presentation";
import type { AppraisalCase } from "@/features/cases/types";

const CASE_ID = "22222222-2222-4222-8222-222222222222";

function appraisalCase(
  serviceType: string,
  status: string,
  overrides: Partial<AppraisalCase> = {},
): AppraisalCase {
  return {
    id: CASE_ID,
    userId: "11111111-1111-4111-8111-111111111111",
    serviceType,
    status,
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-08-20T12:00:00.000Z",
    lastActivityAt: "2026-08-20T12:00:00.000Z",
    ...overrides,
  } as AppraisalCase;
}

describe("appraisal case presentation", () => {
  it.each([
    [
      "draft",
      "Draft",
      "Continue review",
      `/start?service=total-loss&view=intake&caseId=${CASE_ID}`,
    ],
    [
      "checking",
      "Value check in progress",
      "View progress",
      `/total-loss/cases/${CASE_ID}/analysis`,
    ],
    [
      "check_complete",
      "Result ready",
      "View result",
      `/total-loss/cases/${CASE_ID}/analysis`,
    ],
    [
      "completed",
      "Result ready",
      "View result",
      `/total-loss/cases/${CASE_ID}/analysis`,
    ],
  ])(
    "maps the supported total-loss %s state",
    (status, statusLabel, actionLabel, href) => {
      expect(
        appraisalCasePresentation(appraisalCase("total_loss", status)),
      ).toEqual({
        action: { href, label: actionLabel },
        serviceLabel: "Total-loss review",
        statusLabel,
      });
    },
  );

  it("uses a resolver-free post-Continue history action", () => {
    expect(
      appraisalCasePresentation(
        appraisalCase("total_loss", "paid", {
          hasTotalLossClaimWorkflow: true,
        }),
      ),
    ).toEqual({
      action: {
        href: `/total-loss/cases/${CASE_ID}/claim`,
        label: "Open case",
      },
      serviceLabel: "Total-loss review",
      statusLabel: "Claim in progress",
    });
  });

  it("opens a closed Total Loss workflow in its historical workspace", () => {
    expect(
      appraisalCasePresentation(
        appraisalCase("total_loss", "closed", {
          caseStage: "closed",
          hasTotalLossClaimWorkflow: true,
        }),
      ),
    ).toEqual({
      action: {
        href: `/total-loss/cases/${CASE_ID}/claim`,
        label: "View case history",
      },
      serviceLabel: "Total-loss review",
      statusLabel: "Closed",
    });
  });

  it("leaves a pre-Continue case unchanged when no claim resume task exists", () => {
    expect(
      appraisalCasePresentation(
        appraisalCase("total_loss", "check_complete", {
          hasTotalLossClaimWorkflow: false,
        }),
      ),
    ).toMatchObject({
      action: { href: `/total-loss/cases/${CASE_ID}/analysis`, label: "View result" },
      statusLabel: "Result ready",
    });
  });

  it.each(["submitted", "payment_pending", "paid", "unexpected"])(
    "keeps the unsupported total-loss %s state on a safe support path",
    (status) => {
      expect(
        appraisalCasePresentation(appraisalCase("total_loss", status)),
      ).toEqual({
        action: { href: "/contact", label: "Contact support" },
        serviceLabel: "Total-loss review",
        statusLabel: "Status needs review",
      });
    },
  );

  it.each([
    [
      "draft",
      "Draft",
      "View service update",
      "/start?service=diminished-value",
    ],
    [
      "submitted",
      "Submitted",
      "View service update",
      "/start?service=diminished-value",
    ],
  ])(
    "maps the supported diminished-value %s state",
    (status, statusLabel, actionLabel, href) => {
      expect(
        appraisalCasePresentation(appraisalCase("diminished_value", status)),
      ).toEqual({
        action: { href, label: actionLabel },
        serviceLabel: "Diminished-value request",
        statusLabel,
      });
    },
  );

  it.each([
    "checking",
    "check_complete",
    "payment_pending",
    "paid",
    "completed",
    "unexpected",
  ])(
    "keeps the unsupported diminished-value %s state on a safe support path",
    (status) => {
      expect(
        appraisalCasePresentation(appraisalCase("diminished_value", status)),
      ).toEqual({
        action: { href: "/contact", label: "Contact support" },
        serviceLabel: "Diminished-value request",
        statusLabel: "Status needs review",
      });
    },
  );

  it.each(["total_loss", "diminished_value"])(
    "shows a closed %s case without an action",
    (serviceType) => {
      const presentation = appraisalCasePresentation(
        appraisalCase(serviceType, "closed"),
      );

      expect(presentation.statusLabel).toBe("Closed");
      expect(presentation.action).toBeNull();
    },
  );

  it.each([
    ["intake_not_started", "Draft", "Continue review", "/start"],
    ["intake_in_progress", "Intake in progress", "Continue review", "/start"],
    ["report_uploaded", "Report uploaded", "Continue review", "/start"],
    ["report_required", "Report needed", "Continue review", "/start"],
    [
      "ready_for_analysis",
      "Ready for value check",
      "Start value check",
      "/analysis",
    ],
    [
      "analysis_processing",
      "Value check in progress",
      "View progress",
      "/analysis",
    ],
    [
      "analysis_failed",
      "Value check needs attention",
      "Review value check",
      "/analysis",
    ],
    ["analysis_complete", "Result ready", "View result", "/analysis"],
  ] as const)(
    "uses computed stage %s instead of the parent status placeholder",
    (caseStage, statusLabel, actionLabel, destination) => {
      const presentation = appraisalCasePresentation(
        appraisalCase("total_loss", "payment_pending", {
          caseStage,
          needsAttention: caseStage === "analysis_failed",
        }),
      );

      expect(presentation.statusLabel).toBe(statusLabel);
      expect(presentation.action?.label).toBe(actionLabel);
      expect(presentation.action?.href).toContain(destination);
    },
  );

  it("routes draft upload attention back to intake recovery", () => {
    expect(
      appraisalCasePresentation(
        appraisalCase("total_loss", "draft", {
          caseStage: "needs_attention",
          needsAttention: true,
        }),
      ),
    ).toMatchObject({
      action: {
        href: `/start?service=total-loss&view=intake&caseId=${CASE_ID}`,
        label: "Review intake",
      },
      statusLabel: "Needs attention",
    });
  });

  it("routes expired processing attention back to analysis recovery", () => {
    expect(
      appraisalCasePresentation(
        appraisalCase("total_loss", "checking", {
          caseStage: "needs_attention",
          needsAttention: true,
          analysisStatus: "processing",
        }),
      ),
    ).toMatchObject({
      action: {
        href: `/total-loss/cases/${CASE_ID}/analysis`,
        label: "Review value check",
      },
      statusLabel: "Value check needs attention",
    });
  });

  it("surfaces unknown stages safely", () => {
    expect(
      appraisalCasePresentation(
        appraisalCase("total_loss", "completed", {
          caseStage: "unexpected" as AppraisalCase["caseStage"],
        }),
      ),
    ).toMatchObject({
      action: { href: "/contact", label: "Contact support" },
      statusLabel: "Status needs review",
    });
  });

  it("keeps an unexpected workflow visible on the safe support path", () => {
    expect(
      appraisalCasePresentation(
        appraisalCase("unexpected_workflow", "unexpected_status"),
      ),
    ).toEqual({
      action: { href: "/contact", label: "Contact support" },
      serviceLabel: "Vehicle review",
      statusLabel: "Status needs review",
    });
  });

  it("does not treat a closed status as trusted when the workflow is unknown", () => {
    expect(
      appraisalCasePresentation(appraisalCase("unexpected_workflow", "closed")),
    ).toEqual({
      action: { href: "/contact", label: "Contact support" },
      serviceLabel: "Vehicle review",
      statusLabel: "Status needs review",
    });
  });
});
