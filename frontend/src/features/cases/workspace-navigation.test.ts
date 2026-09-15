import { describe, expect, it } from "vitest";
import { appraisalWorkspaceHref, appraisalWorkspaceStatus } from "./workspace-navigation";
import { workspaceDestination } from "./workspace-entry";
import type { AppraisalCase } from "./types";
const item: AppraisalCase = { id: "case-one", userId: "owner", serviceType: "total_loss", status: "draft", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", lastActivityAt: "2026-09-01T00:00:00Z" };
describe("durable workspace selection", () => {
  it.each(["intake_not_started", "intake_in_progress", "report_required", "report_uploaded"] as const)("resumes %s without creating a draft", caseStage => {
    expect(appraisalWorkspaceHref({ ...item, caseStage })).toBe("/start?service=total-loss&view=intake&caseId=case-one");
  });
  it.each(["ready_for_analysis", "analysis_processing", "analysis_failed", "analysis_complete"] as const)("opens %s through the saved analysis reader", caseStage => {
    expect(appraisalWorkspaceHref({ ...item, caseStage })).toBe("/total-loss/cases/case-one/analysis");
  });
  it.each(["uploading", "extracting", "needs_confirmation", "ready", "review_preparing", "review_prepared", "review_failed"])("keeps %s at the report/readiness resolver", workspaceStatus => {
    expect(appraisalWorkspaceHref({ ...item, hasFullReviewReport: true, workspaceStatus })).toBe("/total-loss/cases/case-one/review-report");
  });
  it.each(["checkout", "finalizing", "report_ready", "awaiting_insurer_response", "insurer_response_reviewing", "insurer_response_reviewed", "case_resolved"])("delegates %s to the claim resolver", workspaceStatus => {
    expect(appraisalWorkspaceHref({ ...item, hasTotalLossClaimWorkflow: true, hasFullReviewReport: true, workspaceStatus })).toBe("/total-loss/cases/case-one/claim");
  });
  it("uses meaningful compact statuses", () => {
    expect(appraisalWorkspaceStatus({ ...item, workspaceStatus: "awaiting_insurer_response" })).toBe("Waiting for response");
    expect(appraisalWorkspaceStatus({ ...item, workspaceStatus: "report_ready" })).toBe("Review complete");
  });
  it("rejects cross-owner summaries without using them as a destination", () => {
    expect(() => workspaceDestination([item], "other")).toThrow();
  });
});
