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
  appraisalCase("result-ready", { caseStage: "analysis_complete" }),
  appraisalCase("ready-for-analysis", { caseStage: "ready_for_analysis" }),
  appraisalCase("report-required", { caseStage: "report_required" }),
  appraisalCase("processing", { caseStage: "analysis_processing" }),
  appraisalCase("service-update", {
    serviceType: "diminished_value",
    status: "submitted",
  }),
] as const;

describe("signed-in homepage case selection", () => {
  it.each(priorityCases.map((_, index) => [index] as const))(
    "selects priority group %i ahead of every lower group",
    (priorityIndex) => {
      const candidates = priorityCases.slice(priorityIndex).toReversed();

      expect(selectSignedInHomepageCases(candidates).featuredCase?.id).toBe(
        priorityCases[priorityIndex]?.id,
      );
    },
  );

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
      ]).featuredCase?.id,
    ).toBe(explicitNeedsAttention.id);
  });

  it("uses server recency across report and intake work", () => {
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
      ]).featuredCase?.id,
    ).toBe(newerReportUploaded.id);
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
      ]).featuredCase?.id,
    ).toBe(totalLossProcessing.id);
  });

  it("keeps submitted cases behind processing even when support is the action", () => {
    const submitted = appraisalCase("submitted", {
      caseStage: "submitted",
      status: "submitted",
    });
    const processing = appraisalCase("processing", {
      caseStage: "analysis_processing",
      status: "checking",
    });

    expect(
      selectSignedInHomepageCases([submitted, processing]).featuredCase?.id,
    ).toBe(processing.id);
  });

  it("uses server recency across submitted and service-update cases", () => {
    const newerServiceUpdate = appraisalCase("dv-service-update", {
      caseStage: "intake_in_progress",
      serviceType: "diminished_value",
      status: "draft",
    });
    const olderSubmitted = appraisalCase("submitted", {
      caseStage: "submitted",
      status: "submitted",
    });

    expect(
      selectSignedInHomepageCases([
        newerServiceUpdate,
        olderSubmitted,
      ]).featuredCase?.id,
    ).toBe(newerServiceUpdate.id);
  });

  it("does not feature closed or otherwise non-actionable cases", () => {
    const closed = appraisalCase("closed", {
      caseStage: "closed",
      needsAttention: true,
      status: "closed",
    });

    const selection = selectSignedInHomepageCases([closed]);

    expect(selection.featuredCase).toBeNull();
    expect(selection.recentCases).toEqual([closed]);
    expect(selection.allCasesClosed).toBe(true);
  });

  it("returns the first three distinct recent cases excluding the feature", () => {
    const featured = priorityCases[0];
    const recentA = appraisalCase("recent-a", { status: "closed" });
    const recentB = appraisalCase("recent-b", { status: "closed" });
    const recentC = appraisalCase("recent-c", { status: "closed" });
    const recentD = appraisalCase("recent-d", { status: "closed" });

    const selection = selectSignedInHomepageCases([
      recentA,
      featured,
      recentA,
      recentB,
      recentC,
      recentD,
      featured,
    ]);

    expect(selection.featuredCase).toBe(featured);
    expect(selection.recentCases).toEqual([recentA, recentB, recentC]);
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
      featuredCase: null,
      recentCases: [],
      hasActiveTotalLossDraft: false,
      allCasesClosed: false,
    });
  });
});
