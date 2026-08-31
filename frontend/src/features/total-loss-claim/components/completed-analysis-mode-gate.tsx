import type { ReactNode } from "react";

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
  if (service && detailsQuery.isPending) {
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
    details?.caseId !== caseId ||
    (details.intakeMode !== "report" && details.intakeMode !== "manual")
  ) {
    return (
      <ClaimStateCard
        kind="error"
        heading="We couldn’t load your review details"
        description="Your saved intake information is needed to open the right review. No payment, report, or message information has been changed."
      >
        <Button type="button" onClick={() => void detailsQuery.refetch()}>
          Try again
        </Button>
      </ClaimStateCard>
    );
  }
  return children(details.intakeMode);
}
