import { Navigate, Link } from "react-router";

import { Button } from "@/components/ui/button";
import { ValuationStatus } from "@/components/valuation-status";
import { isPermanentAuthState, useAuth, useSignInDialog } from "@/features/auth";
import { workspaceDestination } from "@/features/cases/workspace-entry";
import { useAppraisalCasesQuery } from "@/features/cases/queries";
import type { AppraisalCaseService } from "@/features/cases/service";
import { useAppraisalCaseService } from "@/features/cases/service-context";

function ResolvedWorkspaceEntry({
  service,
  userId,
}: {
  readonly service: AppraisalCaseService;
  readonly userId: string;
}) {
  const appraisalsQuery = useAppraisalCasesQuery({ service, userId });

  if (appraisalsQuery.isPending) {
    return (
      <ValuationStatus
        kind="loading"
        heading="Opening your review…"
        description="Venfour is securely checking the current case step for this account."
      />
    );
  }

  const cases = appraisalsQuery.data ?? [];
  const responseOutsideOwnerScope = cases.some(
    (appraisalCase) => appraisalCase.userId !== userId,
  );
  if (appraisalsQuery.isError || responseOutsideOwnerScope) {
    return (
      <ValuationStatus
        kind="error"
        heading="We couldn’t open your guided valuation review"
        description="We couldn’t open your saved reviews right now."
      ><Button onClick={() => void appraisalsQuery.refetch()}>Try again</Button><Button asChild variant="outline"><Link to="/appraisals">View appraisal history</Link></Button></ValuationStatus>
    );
  }

  return <Navigate replace to={workspaceDestination(cases, userId)} />;
}

export function WorkspaceEntry({
  userId,
}: {
  readonly userId: string;
}) {
  const service = useAppraisalCaseService();

  if (!service) {
    return (
      <ValuationStatus
        kind="error"
        heading="Your guided valuation review is temporarily unavailable"
        description="We couldn’t open your saved reviews right now."
      ><Button asChild><Link to="/appraisals">View appraisal history</Link></Button><Button asChild variant="outline"><Link to="/contact">Contact support</Link></Button></ValuationStatus>
    );
  }

  return (
    <ResolvedWorkspaceEntry
      service={service}
      userId={userId}
    />
  );
}

export function AppEntryPage() {
  const { auth } = useAuth();
  const { openSignIn } = useSignInDialog();
  if (auth.status === "loading") return <ValuationStatus kind="loading" heading="Opening your workspace" description="Finding your saved reviews." />;
  if (!isPermanentAuthState(auth)) return <ValuationStatus heading="Your reviews, in one place." description="Sign in to return to your saved reviews and case history."><Button onClick={() => openSignIn({ returnTo: "/app" })}>Sign in</Button><Button asChild variant="outline"><Link to="/start?service=total-loss">Start a review</Link></Button></ValuationStatus>;
  return <WorkspaceEntry userId={auth.user.id} />;
}
