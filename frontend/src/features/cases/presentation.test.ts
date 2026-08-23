import { describe, expect, it } from "vitest";

import { appraisalCasePresentation } from "@/features/cases/presentation";
import type { AppraisalCase } from "@/features/cases/types";

const CASE_ID = "22222222-2222-4222-8222-222222222222";

function appraisalCase(
  serviceType: string,
  status: string,
): AppraisalCase {
  return {
    id: CASE_ID,
    userId: "11111111-1111-4111-8111-111111111111",
    serviceType,
    status,
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-08-20T12:00:00.000Z",
    lastActivityAt: "2026-08-20T12:00:00.000Z",
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
      "Continue request",
      `/start?service=diminished-value&view=intake&caseId=${CASE_ID}`,
    ],
    [
      "submitted",
      "Submitted",
      "View submitted request",
      `/start?service=diminished-value&view=intake&caseId=${CASE_ID}`,
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
      appraisalCasePresentation(
        appraisalCase("unexpected_workflow", "closed"),
      ),
    ).toEqual({
      action: { href: "/contact", label: "Contact support" },
      serviceLabel: "Vehicle review",
      statusLabel: "Status needs review",
    });
  });
});
