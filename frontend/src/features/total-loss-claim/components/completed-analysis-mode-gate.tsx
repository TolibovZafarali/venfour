import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/features/auth";
import { fullReviewKey, getFullReview } from "@/features/full-review/api";

import { Button } from "@/components/ui/button";
import { useTotalLossDependencies } from "@/features/total-loss/dependencies";
import { useTotalLossDetailsQuery } from "@/features/total-loss/queries";
import type { TotalLossIntakeMode } from "@/features/total-loss/types";
import { ClaimStateCard } from "./claim-state-card";

export function CompletedAnalysisModeGate({
  caseId,
  userId,
  children,
}: {
  readonly caseId: string;
  readonly userId: string;
  readonly children: (intakeMode: TotalLossIntakeMode) => ReactNode;
}) {
  const dependencies = useTotalLossDependencies();
  const service = dependencies?.totalLossDetailsService ?? null;
  const detailsQuery = useTotalLossDetailsQuery({ service, userId, caseId });
  const { auth } = useAuth();
  const token = auth.status === "signedIn" ? auth.session.access_token : null;
  const reportQuery = useQuery({ queryKey: fullReviewKey(userId, caseId),
    queryFn: () => getFullReview(caseId, token!), enabled: Boolean(token && detailsQuery.data?.intakeMode === "manual"), retry: false });
  const checkingReport = Boolean(token && detailsQuery.data?.intakeMode === "manual");
  if (service && (detailsQuery.isPending || (checkingReport && reportQuery.isPending))) {
    return (
      <ClaimStateCard
        kind="loading"
        heading="Opening your completed review…"
        description="Loading the saved information for this case."
      />
    );
  }
  const details = detailsQuery.data;
  if (
    !service ||
    detailsQuery.isError ||
    (checkingReport && reportQuery.isError) ||
    details?.caseId !== caseId ||
    (details.intakeMode !== "report" && details.intakeMode !== "manual")
  ) {
    return (
      <ClaimStateCard
        kind="error"
        heading="We couldn’t load your review details"
        description="Your saved intake information is needed to open the right review. No payment, report, or message information has been changed."
      >
        <Button type="button" onClick={() => { void detailsQuery.refetch(); if (checkingReport) void reportQuery.refetch(); }}>
          Try again
        </Button>
      </ClaimStateCard>
    );
  }
  return children(reportQuery.data?.ready && reportQuery.data.locked ? "report" : details.intakeMode);
}
