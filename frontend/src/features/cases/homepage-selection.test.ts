import { describe, expect, it } from "vitest";

import { selectSignedInHomepageCases } from "@/features/cases/homepage-selection";
import type { AppraisalCase } from "@/features/cases/types";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function appraisalCase(
  id: string,
  overrides: Partial<AppraisalCase> = {},
): AppraisalCase {
  return {
    id,
    userId: USER_ID,
    serviceType: "total_loss",
    status: "payment_pending",
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-08-22T15:00:00.000Z",
    lastActivityAt: "2026-08-22T15:00:00.000Z",
    ...overrides,
  };
}

const priorityCases = [
  appraisalCase("needs-attention", {
    caseStage: "needs_attention",
    needsAttention: true,
    status: "draft",
  }),
  appraisalCase("post-continue", {
    caseStage: "analysis_complete",
    hasTotalLossClaimWorkflow: true,
  }),
  appraisalCase("result-ready", { caseStage: "analysis_complete" }),
  appraisalCase("ready-for-analysis", { caseStage: "ready_for_analysis" }),
  appraisalCase("report-required", { caseStage: "report_required" }),
  appraisalCase("processing", { caseStage: "analysis_processing" }),
  appraisalCase("submitted", {
    caseStage: "submitted",
    serviceType: "diminished_value",
    status: "submitted",
  }),
] as const;

describe("signed-in homepage case selection", () => {
  it.each(priorityCases.map((_, index) => [index] as const))(
    "selects priority group %i ahead of every lower group",
    (priorityIndex) => {
      const candidates = priorityCases.slice(priorityIndex).toReversed();

      expect(selectSignedInHomepageCases(candidates).focalCase?.id).toBe(
        priorityCases[priorityIndex]?.id,
      );
    },
  );

  it("keeps a post-Continue workflow behind attention and ahead of preliminary work", () => {
    const attention = priorityCases[0];
    const postContinue = priorityCases[1];
    const preliminaryResult = priorityCases[2];

    expect(
      selectSignedInHomepageCases([preliminaryResult, postContinue]).focalCase,
    ).toBe(postContinue);
    expect(
      selectSignedInHomepageCases([preliminaryResult, postContinue, attention])
        .focalCase,
    ).toBe(attention);
  });

  it("prioritizes an older post-Continue attention case over a newer waiting case", () => {
    const newerWaiting = appraisalCase("newer-waiting", {
      caseStage: "analysis_complete",
      hasTotalLossClaimWorkflow: true,
      needsAttention: false,
    });
    const olderAttention = appraisalCase("older-attention", {
      caseStage: "analysis_complete",
      hasTotalLossClaimWorkflow: true,
      needsAttention: true,
    });

    expect(
      selectSignedInHomepageCases([newerWaiting, olderAttention]).focalCase,
    ).toBe(olderAttention);
  });

  it("preserves server order for cases in the same priority group", () => {
    const explicitNeedsAttention = appraisalCase("explicit-needs-attention", {
      caseStage: "needs_attention",
    });
    const analysisFailed = appraisalCase("analysis-failed", {
      caseStage: "analysis_failed",
    });
    const flagged = appraisalCase("flagged", {
      caseStage: "report_uploaded",
      needsAttention: true,
    });

    expect(
      selectSignedInHomepageCases([
        explicitNeedsAttention,
        analysisFailed,
        flagged,
      ]).focalCase,
    ).toBe(explicitNeedsAttention);
  });

  it("uses server recency across intake work in the same priority group", () => {
    const newerReportUploaded = appraisalCase("report-uploaded", {
      caseStage: "report_uploaded",
    });
    const olderReportRequired = appraisalCase("report-required", {
      caseStage: "report_required",
    });
    const intakeNotStarted = appraisalCase("intake-not-started", {
      caseStage: "intake_not_started",
    });

    expect(
      selectSignedInHomepageCases([
        newerReportUploaded,
        olderReportRequired,
        intakeNotStarted,
      ]).focalCase,
    ).toBe(newerReportUploaded);
  });

  it("keeps a Diminished Value service update behind Total-Loss processing", () => {
    const diminishedValueUpdate = appraisalCase("dv-service-update", {
      caseStage: "intake_in_progress",
      serviceType: "diminished_value",
      status: "draft",
    });
    const totalLossProcessing = appraisalCase("tl-processing", {
      caseStage: "analysis_processing",
      status: "checking",
    });

    expect(
      selectSignedInHomepageCases([
        diminishedValueUpdate,
        totalLossProcessing,
      ]).focalCase,
    ).toBe(totalLossProcessing);
  });

  it("keeps submitted cases behind processing", () => {
    const submitted = appraisalCase("submitted", {
      caseStage: "submitted",
      status: "submitted",
    });
    const processing = appraisalCase("processing", {
      caseStage: "analysis_processing",
      status: "checking",
    });

    expect(selectSignedInHomepageCases([submitted, processing]).focalCase).toBe(
      processing,
    );
  });

  it("uses a closed case as the historical focal case when nothing is active", () => {
    const closed = appraisalCase("closed", {
      caseStage: "closed",
      needsAttention: true,
      status: "closed",
    });

    const selection = selectSignedInHomepageCases([closed]);

    expect(selection.focalCase).toBe(closed);
    expect(selection.allCasesClosed).toBe(true);
    expect(selection.historicalCaseCount).toBe(0);
  });

  it("counts distinct historical cases and excludes every copy of the focal case", () => {
    const focal = priorityCases[0];
    const historicalA = appraisalCase("historical-a", { status: "closed" });
    const historicalB = appraisalCase("historical-b", { status: "closed" });

    const selection = selectSignedInHomepageCases([
      historicalA,
      focal,
      historicalA,
      historicalB,
      focal,
    ]);

    expect(selection.focalCase).toBe(focal);
    expect(selection.historicalCaseCount).toBe(2);
  });

  it("detects only Total-Loss cases with an active draft status", () => {
    const diminishedValueDraft = appraisalCase("dv-draft", {
      serviceType: "diminished_value",
      status: "draft",
    });
    const totalLossSubmitted = appraisalCase("tl-submitted", {
      status: "submitted",
    });
    const totalLossDraft = appraisalCase("tl-draft", { status: "draft" });

    expect(
      selectSignedInHomepageCases([
        diminishedValueDraft,
        totalLossSubmitted,
      ]).hasActiveTotalLossDraft,
    ).toBe(false);
    expect(
      selectSignedInHomepageCases([diminishedValueDraft, totalLossDraft])
        .hasActiveTotalLossDraft,
    ).toBe(true);
  });

  it("does not report an empty account as all closed", () => {
    expect(selectSignedInHomepageCases([])).toEqual({
      focalCase: null,
      hasActiveTotalLossDraft: false,
      allCasesClosed: false,
      historicalCaseCount: 0,
    });
  });
});
