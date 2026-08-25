import {
  ArrowRight,
  CheckCircle2,
  Plus,
} from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { AppraisalCaseCard } from "@/features/cases/appraisal-case-card";
import {
  AppraisalCasesEmptyState,
  AppraisalCasesErrorState,
  AppraisalCasesLoadingState,
} from "@/features/cases/appraisal-case-list-states";
import { formatAppraisalCaseLastActivity } from "@/features/cases/format";
import {
  selectSignedInHomepageCases,
  type SignedInHomepageCaseSelection,
} from "@/features/cases/homepage-selection";
import { appraisalCasePresentation } from "@/features/cases/presentation";
import { useAppraisalCasesQuery } from "@/features/cases/queries";
import type { AppraisalCaseService } from "@/features/cases/service";
import { useAppraisalCaseService } from "@/features/cases/service-context";
import type { AppraisalCase } from "@/features/cases/types";
import { useNewTotalLossAppraisalHref } from "@/features/total-loss/new-appraisal";

interface SignedInHomePageProps {
  readonly userId: string;
}

function SignedInHomeHeader({
  newAppraisalHref,
}: {
  readonly newAppraisalHref?: string;
}) {
  return (
    <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold tracking-[0.12em] text-brand uppercase">
          Your Venfour account
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-ink sm:text-5xl">
          Welcome back.
        </h1>
        <p className="mt-4 text-base leading-7 text-copy sm:text-lg">
          Continue a saved review, follow a value check, or open a completed
          result.
        </p>
      </div>
      {newAppraisalHref ? (
        <Button
          asChild
          variant="outline"
          className="shrink-0 self-start bg-white sm:self-auto"
        >
          <Link to={newAppraisalHref}>
            <Plus className="size-4" aria-hidden />
            Start a new appraisal
          </Link>
        </Button>
      ) : null}
    </header>
  );
}

function FeaturedAppraisal({ appraisalCase }: { appraisalCase: AppraisalCase }) {
  const presentation = appraisalCasePresentation(appraisalCase);

  if (!presentation.action) return null;

  return (
    <section
      className="mt-10 overflow-hidden rounded-3xl bg-ink text-white shadow-[0_24px_70px_-42px_rgba(11,31,51,0.9)]"
      aria-labelledby="next-step-title"
    >
      <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:p-10">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs font-semibold tracking-[0.12em] text-blue-200 uppercase">
              Your next step
            </p>
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-slate-100">
              {presentation.statusLabel}
            </span>
          </div>
          <h2
            id="next-step-title"
            className="mt-5 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl"
          >
            {presentation.serviceLabel}
          </h2>
          <p className="mt-3 text-sm text-slate-300">
            {formatAppraisalCaseLastActivity(appraisalCase.lastActivityAt)}
          </p>
        </div>
        <Button
          asChild
          className="self-start bg-white text-ink hover:bg-slate-100 lg:self-auto"
        >
          <Link to={presentation.action.href}>
            {presentation.action.label}
            {presentation.action.label !== "Contact support" ? (
              <ArrowRight className="size-4" aria-hidden />
            ) : null}
          </Link>
        </Button>
      </div>
    </section>
  );
}

function AllCaughtUp({
  newAppraisalHref,
}: {
  readonly newAppraisalHref: string;
}) {
  return (
    <section
      className="mt-10 rounded-3xl border border-line bg-white p-6 sm:p-8 lg:p-10"
      aria-labelledby="caught-up-title"
    >
      <span className="flex size-12 items-center justify-center rounded-2xl bg-market-soft text-market">
        <CheckCircle2 className="size-6" aria-hidden />
      </span>
      <h2
        id="caught-up-title"
        className="mt-6 text-3xl font-semibold tracking-[-0.035em] text-ink"
      >
        You’re all caught up.
      </h2>
      <p className="mt-3 max-w-xl text-base leading-7 text-copy">
        There are no open appraisal actions right now. Your completed and
        closed appraisals remain available below.
      </p>
      <Button asChild variant="outline" className="mt-7">
        <Link to={newAppraisalHref}>
          <Plus className="size-4" aria-hidden />
          Start a new appraisal
        </Link>
      </Button>
    </section>
  );
}

function RecentAppraisals({
  selection,
}: {
  readonly selection: SignedInHomepageCaseSelection;
}) {
  if (selection.recentCases.length === 0) {
    return selection.featuredCase ? (
      <div className="mt-5 flex justify-end">
        <Button asChild variant="ghost">
          <Link to="/appraisals">
            View all appraisals
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </div>
    ) : null;
  }

  return (
    <section className="mt-12 sm:mt-14" aria-labelledby="recent-appraisals-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold tracking-[0.12em] text-brand uppercase">
            Saved vehicle reviews
          </p>
          <h2
            id="recent-appraisals-title"
            className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-ink"
          >
            Recent appraisals
          </h2>
        </div>
        <Button asChild variant="ghost" className="self-start sm:self-auto">
          <Link to="/appraisals">
            View all appraisals
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </div>
      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {selection.recentCases.map((appraisalCase) => (
          <AppraisalCaseCard
            key={appraisalCase.id}
            appraisalCase={appraisalCase}
            headingLevel={3}
          />
        ))}
      </div>
    </section>
  );
}

function SignedInHomeContent({
  newAppraisalHref,
  service,
  userId,
}: {
  readonly newAppraisalHref: string;
  readonly service: AppraisalCaseService;
  readonly userId: string;
}) {
  const appraisalsQuery = useAppraisalCasesQuery({ service, userId });
  const cases = appraisalsQuery.data ?? [];
  const responseOutsideOwnerScope = cases.some(
    (appraisalCase) => appraisalCase.userId !== userId,
  );
  const selection = selectSignedInHomepageCases(cases);
  const showHeaderNewAppraisal =
    appraisalsQuery.isSuccess &&
    cases.length > 0 &&
    !selection.allCasesClosed &&
    !selection.hasActiveTotalLossDraft;

  return (
    <section className="w-full bg-canvas">
      <div className="mx-auto w-full max-w-7xl px-5 py-12 sm:px-8 sm:py-16 lg:px-10 lg:py-20">
        <SignedInHomeHeader
          newAppraisalHref={
            showHeaderNewAppraisal ? newAppraisalHref : undefined
          }
        />

        {appraisalsQuery.isPending ? (
          <AppraisalCasesLoadingState variant="overview" />
        ) : appraisalsQuery.isError || responseOutsideOwnerScope ? (
          <AppraisalCasesErrorState
            heading="We couldn’t load your appraisal overview."
            description="Venfour could not verify the saved appraisals for this account. No appraisal information has been changed."
            headingId="home-appraisals-error-title"
            onRetry={
              responseOutsideOwnerScope
                ? undefined
                : () => void appraisalsQuery.refetch()
            }
            showContactSupport
          />
        ) : cases.length === 0 ? (
          <AppraisalCasesEmptyState
            variant="first-appraisal"
            description="Start a Total Loss review when you’re ready. Your saved progress and results will appear here."
            newAppraisalHref={newAppraisalHref}
          />
        ) : (
          <>
            {selection.featuredCase ? (
              <FeaturedAppraisal appraisalCase={selection.featuredCase} />
            ) : (
              <AllCaughtUp newAppraisalHref={newAppraisalHref} />
            )}
            <RecentAppraisals selection={selection} />
          </>
        )}
      </div>
    </section>
  );
}

export function SignedInHomePage({ userId }: SignedInHomePageProps) {
  const service = useAppraisalCaseService();
  const newAppraisalHref = useNewTotalLossAppraisalHref();

  if (!service) {
    return (
      <section className="w-full bg-canvas">
        <div className="mx-auto w-full max-w-7xl px-5 py-12 sm:px-8 sm:py-16 lg:px-10 lg:py-20">
          <SignedInHomeHeader />
          <AppraisalCasesErrorState
            heading="We couldn’t load your appraisal overview."
            description="Venfour could not verify the saved appraisals for this account. No appraisal information has been changed."
            headingId="home-appraisals-error-title"
            showContactSupport
          />
        </div>
      </section>
    );
  }

  return (
    <SignedInHomeContent
      newAppraisalHref={newAppraisalHref}
      service={service}
      userId={userId}
    />
  );
}
