import { useRef, useState } from "react";

import type { TotalLossIntakeMode } from "@/features/total-loss/types";
import type { TotalLossCaseJourneyStage } from "./case-journey";
import type { TotalLossClaimSecured, TotalLossEducationStep } from "./contracts";
import { useTotalLossEducationProgressMutation } from "./queries";
import { caseIsClosed } from "./resolution";

type ReadingStage = "result" | "insurer" | "market" | "meaning";

export function reviewPrerequisite(
  claim: TotalLossClaimSecured,
  reportId: string,
  intakeMode: TotalLossIntakeMode,
  stage: TotalLossCaseJourneyStage,
): ReadingStage | null {
  if (caseIsClosed(claim)) return null;
  if (stage === "result" || stage === "waiting") return null;
  const steps = claim.education?.reportVersionId === reportId
    ? claim.education.steps
    : null;
  if (!steps?.result.completedAt) return "result";
  const optional = ["insurer_review", "valuation", "report", "what_next"] as const;
  // Preserve access for customers who used the former explicit skip action.
  if (optional.some((step) => steps[step].skippedAt)) return null;
  if (stage === "insurer") return null;
  if (intakeMode === "report" && !steps.insurer_review.completedAt) return "insurer";
  if (stage === "market") return null;
  if (!steps.valuation.completedAt || !steps.insurer_review.completedAt) return "market";
  if (stage === "meaning") return null;
  if (!steps.report.completedAt || !steps.what_next.completedAt) return "meaning";
  return null;
}

export function useReviewProgression({
  accessToken,
  caseId,
  claim,
  intakeMode,
  onRefresh,
  reportId,
  userId,
}: {
  readonly accessToken: string;
  readonly caseId: string;
  readonly claim: TotalLossClaimSecured;
  readonly intakeMode: TotalLossIntakeMode;
  readonly onRefresh: () => Promise<unknown>;
  readonly reportId: string;
  readonly userId: string;
}) {
  const { mutateAsync: record } = useTotalLossEducationProgressMutation({ accessToken, caseId, userId });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const checkpoint = useRef({ reportId, revision: 0, completed: new Set<TotalLossEducationStep>() });

  const complete = async (stage: ReadingStage) => {
    if (caseIsClosed(claim)) return false;
    if (inFlight.current) return false;
    if (!claim.workflow || claim.education?.reportVersionId !== reportId) {
      setError("We couldn’t verify your saved review. Refresh and try again.");
      return false;
    }
    if (reviewPrerequisite(claim, reportId, intakeMode, stage)) return false;
    inFlight.current = true;
    setPending(true);
    setError(null);
    if (checkpoint.current.reportId !== reportId) {
      checkpoint.current = { reportId, revision: 0, completed: new Set() };
    }
    const saved = checkpoint.current;
    saved.revision = Math.max(saved.revision, claim.workflow.revision);
    const markers: readonly TotalLossEducationStep[] = stage === "result"
      ? ["result"]
      : stage === "insurer"
        ? ["insurer_review"]
        : stage === "market"
          ? intakeMode === "manual" ? ["insurer_review", "valuation"] : ["valuation"]
          : ["report", "what_next"];
    try {
      for (const step of markers) {
        const progress = claim.education.steps[step];
        if (progress.completedAt || progress.skippedAt || saved.completed.has(step)) continue;
        const response = await record({ step, state: "completed", expectedWorkflowRevision: saved.revision });
        if (response.education?.reportVersionId !== reportId) {
          throw new Error("The published report changed.");
        }
        saved.revision = response.workflowRevision;
        saved.completed.add(step);
      }
      return true;
    } catch {
      await onRefresh().catch(() => undefined);
      setError("We couldn’t save your progress. Your completed steps are saved; try Continue again.");
      return false;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return { complete, error, pending };
}
