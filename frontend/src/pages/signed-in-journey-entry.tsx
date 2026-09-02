import { AlertCircle, LoaderCircle } from "lucide-react";
import { Navigate, Link } from "react-router";

import { Button } from "@/components/ui/button";
import { selectSignedInHomepageCases } from "@/features/cases/homepage-selection";
import { appraisalCasePresentation } from "@/features/cases/presentation";
import { useAppraisalCasesQuery } from "@/features/cases/queries";
import type { AppraisalCaseService } from "@/features/cases/service";
import { useAppraisalCaseService } from "@/features/cases/service-context";

function JourneyEntryState({
  description,
  error = false,
  heading,
}: {
  readonly description: string;
  readonly error?: boolean;
  readonly heading: string;
}) {
  const Icon = error ? AlertCircle : LoaderCircle;

  return (
    <section className="flex min-h-[60vh] w-full items-center justify-center px-5 py-16 sm:px-8 sm:py-24">
      <div
        className="w-full max-w-2xl rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8"
        role={error ? "alert" : "status"}
        aria-busy={error ? undefined : true}
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Icon
            className={
              error
                ? "size-6"
                : "size-6 animate-spin motion-reduce:animate-none"
            }
            aria-hidden
          />
        </span>
        <h1 className="mt-6 text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-4xl">
          {heading}
        </h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-copy">
          {description}
        </p>
        {error ? (
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild variant="outline">
              <Link to="/appraisals">View appraisal history</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/contact">Contact support</Link>
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ResolvedSignedInJourneyEntry({
  service,
  userId,
}: {
  readonly service: AppraisalCaseService;
  readonly userId: string;
}) {
  const appraisalsQuery = useAppraisalCasesQuery({ service, userId });

  if (appraisalsQuery.isPending) {
    return (
      <JourneyEntryState
        heading="Opening your guided valuation review…"
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
      <JourneyEntryState
        error
        heading="We couldn’t open your guided valuation review"
        description="Venfour could not verify an owner-scoped active case for this account. No case information has been changed."
      />
    );
  }

  const activeTotalLossCases = cases.filter(
    (appraisalCase) => {
      if (
        appraisalCase.serviceType !== "total_loss" ||
        appraisalCase.status === "closed" ||
        appraisalCase.caseStage === "closed"
      ) {
        return false;
      }
      const destination = appraisalCasePresentation(appraisalCase).action?.href;
      return (
        destination?.startsWith("/total-loss/cases/") ||
        destination?.startsWith("/start?service=total-loss")
      );
    },
  );
  const selection = selectSignedInHomepageCases(activeTotalLossCases);
  if (!selection.focalCase) {
    return <Navigate replace to="/appraisals" />;
  }

  const destination = appraisalCasePresentation(selection.focalCase).action?.href;
  return <Navigate replace to={destination ?? "/appraisals"} />;
}

export function SignedInJourneyEntry({
  userId,
}: {
  readonly userId: string;
}) {
  const service = useAppraisalCaseService();

  if (!service) {
    return (
      <JourneyEntryState
        error
        heading="Your guided valuation review is temporarily unavailable"
        description="Venfour could not securely check your saved cases in this environment. No case information has been changed."
      />
    );
  }

  return (
    <ResolvedSignedInJourneyEntry
      service={service}
      userId={userId}
    />
  );
}
