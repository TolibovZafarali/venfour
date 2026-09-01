import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Circle,
  Clock3,
  History,
  Landmark,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  createCaseDashboardModel,
  type CaseDashboardMilestone,
  type CaseDashboardModel,
} from "@/features/cases/case-dashboard-model";
import {
  AppraisalCasesErrorState,
  AppraisalCasesLoadingState,
} from "@/features/cases/appraisal-case-list-states";
import { formatAppraisalCaseLastActivity } from "@/features/cases/format";
import { selectSignedInHomepageCases } from "@/features/cases/homepage-selection";
import { useAppraisalCasesQuery } from "@/features/cases/queries";
import type { AppraisalCaseService } from "@/features/cases/service";
import { useAppraisalCaseService } from "@/features/cases/service-context";
import type { AppraisalCase } from "@/features/cases/types";
import { useDiminishedValueDependencies } from "@/features/diminished-value/dependencies";
import { useTotalLossClaimQuery } from "@/features/total-loss-claim/queries";
import { useTotalLossDependencies } from "@/features/total-loss/dependencies";
import { useNewTotalLossAppraisalHref } from "@/features/total-loss/new-appraisal";
import { useTotalLossDetailsQuery } from "@/features/total-loss/queries";
import { cn } from "@/lib/utils";

interface SignedInHomePageProps {
  readonly accessToken: string;
  readonly userId: string;
}

function formatCaseDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function milestoneIcon(milestone: CaseDashboardMilestone) {
  if (milestone.state === "complete") {
    return <Check className="size-3.5" aria-hidden />;
  }
  if (milestone.state === "attention") {
    return <TriangleAlert className="size-3.5" aria-hidden />;
  }
  return <Circle className="size-2.5 fill-current" aria-hidden />;
}

const milestoneStateLabels: Record<
  CaseDashboardMilestone["state"],
  string
> = {
  complete: "Completed",
  current: "Current step",
  attention: "Needs attention",
  upcoming: "Upcoming",
};

function CaseProgressRail({ model }: { readonly model: CaseDashboardModel }) {
  return (
    <aside
      className="rounded-2xl border border-line/90 bg-white/90 p-5 shadow-[0_18px_50px_-38px_rgba(15,23,42,0.5)] sm:p-6 xl:sticky xl:top-24 xl:col-start-2 xl:row-start-1 xl:row-span-2 xl:self-start"
      aria-labelledby="case-progress-title"
    >
      <p className="text-xs font-semibold tracking-[0.13em] text-copy/75 uppercase">
        Case progress
      </p>
      <h2
        id="case-progress-title"
        className="mt-2 text-xl font-semibold tracking-[-0.025em] text-ink"
      >
        Where things stand
      </h2>
      <ol className="mt-6" aria-label="Case milestones">
        {model.milestones.map((milestone, index) => {
          const isLast = index === model.milestones.length - 1;
          return (
            <li
              key={milestone.id}
              className="relative grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] gap-3 pb-6 last:pb-0"
              aria-current={
                milestone.state === "current" ||
                milestone.state === "attention"
                  ? "step"
                  : undefined
              }
            >
              {!isLast ? (
                <span
                  className={cn(
                    "absolute top-7 bottom-0 left-[0.84375rem] w-px",
                    milestone.state === "complete"
                      ? "bg-slate-300"
                      : "bg-slate-200",
                  )}
                  aria-hidden
                />
              ) : null}
              <span
                className={cn(
                  "relative z-10 flex size-7 items-center justify-center rounded-full border bg-white",
                  milestone.state === "complete" &&
                    "border-slate-300 text-slate-500",
                  milestone.state === "current" &&
                    "border-brand bg-brand text-white shadow-[0_0_0_4px_rgba(21,94,239,0.1)]",
                  milestone.state === "attention" &&
                    "border-amber-500 bg-amber-50 text-amber-700 shadow-[0_0_0_4px_rgba(245,158,11,0.1)]",
                  milestone.state === "upcoming" &&
                    "border-slate-200 text-slate-300",
                )}
              >
                {milestoneIcon(milestone)}
              </span>
              <div className="min-w-0 pt-0.5">
                <p
                  className={cn(
                    "text-sm leading-6",
                    milestone.state === "complete" &&
                      "font-medium text-copy/70",
                    milestone.state === "current" &&
                      "font-semibold text-ink",
                    milestone.state === "attention" &&
                      "font-semibold text-amber-900",
                    milestone.state === "upcoming" && "text-copy/55",
                  )}
                >
                  {milestone.label}
                </p>
                <p
                  className={cn(
                    milestone.state === "current" ||
                      milestone.state === "attention"
                      ? "mt-0.5 text-xs leading-5 text-copy/70"
                      : "sr-only",
                  )}
                >
                  {milestoneStateLabels[milestone.state]}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

function CaseSummary({ model }: { readonly model: CaseDashboardModel }) {
  return (
    <header className="min-w-0 rounded-3xl border border-line/80 bg-white px-4 py-7 shadow-[0_28px_80px_-55px_rgba(15,23,42,0.55)] min-[360px]:px-5 sm:px-8 sm:py-9 lg:px-10 lg:py-11 xl:col-start-1 xl:row-start-1">
      <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
        Your case workspace
      </p>
      <div className="mt-5 min-w-0">
        <h1 className="wrap-break-word text-[2rem] leading-[1.04] font-semibold tracking-[-0.045em] text-ink min-[360px]:text-[2.15rem] sm:text-5xl">
          {model.vehicleDisplayName}
        </h1>
        <p className="mt-2 text-base font-medium text-copy">
          {model.serviceLabel}
        </p>
      </div>

      {model.insurerName || model.dateOfLoss ? (
        <dl className="mt-6 flex flex-col gap-3 text-sm text-copy sm:flex-row sm:flex-wrap sm:gap-x-7">
          {model.insurerName ? (
            <div className="flex min-w-0 items-center gap-2.5">
              <Landmark className="size-4 shrink-0 text-copy/60" aria-hidden />
              <dt className="sr-only">Insurer</dt>
              <dd className="min-w-0 wrap-break-word">{model.insurerName}</dd>
            </div>
          ) : null}
          {model.dateOfLoss ? (
            <div className="flex min-w-0 items-center gap-2.5">
              <CalendarDays
                className="size-4 shrink-0 text-copy/60"
                aria-hidden
              />
              <dt className="sr-only">Date of loss</dt>
              <dd>Date of loss {formatCaseDate(model.dateOfLoss)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <div aria-live="polite" aria-atomic="true">
        <div
          className={cn(
            "mt-8 border-l-2 pl-4 sm:mt-9 sm:pl-5",
            model.statusTone === "attention"
              ? "border-amber-500"
              : model.statusTone === "complete"
                ? "border-emerald-600"
                : "border-brand",
          )}
        >
          <p className="text-xs font-semibold tracking-[0.13em] text-copy/70 uppercase">
            Current status
          </p>
          <h2 className="mt-2 text-2xl leading-tight font-semibold tracking-[-0.03em] text-ink sm:text-3xl">
            {model.statusLabel}
          </h2>
          <p className="mt-3 max-w-2xl text-[0.9375rem] leading-7 text-copy sm:text-base">
            {model.statusExplanation}
          </p>
        </div>

        {model.nextAction ? (
          <div className="mt-7 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <Button
              asChild
              variant={model.nextAction.required ? "default" : "outline"}
              size="lg"
              className={cn(
                "w-full sm:w-auto",
                model.nextAction.required &&
                  "shadow-[0_14px_30px_-18px_rgba(21,94,239,0.8)]",
              )}
            >
              <Link to={model.nextAction.href}>
                {model.nextAction.label}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
            {!model.nextAction.required ? (
              <span className="text-xs leading-5 text-copy/65">
                No action is required right now.
              </span>
            ) : null}
          </div>
        ) : (
          <p className="mt-7 text-sm font-medium text-copy/75">
            No action is required for this case.
          </p>
        )}
      </div>
    </header>
  );
}

function CaseDetails({
  detailsUnavailable,
  historicalCaseCount,
  model,
  newAppraisalHref,
}: {
  readonly detailsUnavailable: boolean;
  readonly historicalCaseCount: number;
  readonly model: CaseDashboardModel;
  readonly newAppraisalHref: string;
}) {
  return (
    <div className="min-w-0 xl:col-start-1 xl:row-start-2">
      <section
        className="rounded-2xl border border-line/80 bg-white/75 px-5 py-6 sm:px-7 sm:py-7"
        aria-labelledby="case-summary-title"
      >
        <div className="flex items-start gap-3">
          <Clock3 className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
          <div className="min-w-0">
            <h2
              id="case-summary-title"
              className="text-lg font-semibold tracking-[-0.02em] text-ink"
            >
              Case summary
            </h2>
            <p className="mt-2 text-sm leading-6 text-copy">
              {formatAppraisalCaseLastActivity(model.lastActivityAt)}. Venfour
              keeps the next case step here and opens the existing workflow for
              detailed review or action.
            </p>
            {detailsUnavailable ? (
              <p className="mt-3 text-xs leading-5 text-copy/65" role="status">
                Some vehicle context could not be refreshed. The case status and
                resume path are still available.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <nav
        className="mt-5 flex flex-col gap-2 border-t border-line/80 pt-5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
        aria-label="Case workspace links"
      >
        <Link
          to="/appraisals"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-brand transition-colors hover:bg-white hover:text-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          <History className="size-4" aria-hidden />
          {historicalCaseCount > 0
            ? `View all appraisals (${historicalCaseCount + 1})`
            : "View all appraisals"}
        </Link>
        <Link
          to={newAppraisalHref}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-copy transition-colors hover:bg-white hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          <Plus className="size-4" aria-hidden />
          Start a new appraisal
        </Link>
      </nav>
    </div>
  );
}

export function FirstAppraisalState({
  newAppraisalHref,
}: {
  readonly newAppraisalHref: string;
}) {
  return (
    <section className="mx-auto mt-8 max-w-3xl rounded-3xl border border-line/80 bg-white px-5 py-10 text-center shadow-[0_30px_90px_-58px_rgba(15,23,42,0.55)] sm:mt-12 sm:px-10 sm:py-14">
      <span className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-brand/15 bg-brand-soft text-brand">
        <Plus className="size-5" aria-hidden />
      </span>
      <p className="mt-6 text-xs font-semibold tracking-[0.14em] text-brand uppercase">
        Your case workspace
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">
        Start your first appraisal
      </h1>
      <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-copy">
        Begin a Total Loss review when you’re ready. Your vehicle, case status,
        and next step will stay organized here.
      </p>
      <Button asChild size="lg" className="mt-8 w-full sm:w-auto">
        <Link to={newAppraisalHref}>
          Start your first appraisal
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </Button>
    </section>
  );
}

function WorkspaceLoading() {
  return (
    <div aria-label="Loading case workspace">
      <div className="mb-8 h-7 w-52 animate-pulse rounded-full bg-ink/10 motion-reduce:animate-none" />
      <AppraisalCasesLoadingState variant="overview" />
    </div>
  );
}

function FocalCaseWorkspace({
  accessToken,
  appraisalCase,
  historicalCaseCount,
  newAppraisalHref,
  userId,
}: {
  readonly accessToken: string;
  readonly appraisalCase: AppraisalCase;
  readonly historicalCaseCount: number;
  readonly newAppraisalHref: string;
  readonly userId: string;
}) {
  const totalLossDependencies = useTotalLossDependencies();
  const diminishedValueDependencies = useDiminishedValueDependencies();
  const totalLossCaseId =
    appraisalCase.serviceType === "total_loss" ? appraisalCase.id : null;
  const diminishedValueCaseId =
    appraisalCase.serviceType === "diminished_value"
      ? appraisalCase.id
      : null;
  const totalLossDetailsQuery = useTotalLossDetailsQuery({
    service: totalLossDependencies?.totalLossDetailsService ?? null,
    userId,
    caseId: totalLossCaseId,
  });
  const diminishedValueDetailsQuery = useQuery({
    queryKey: [
      "appraisalCases",
      "user",
      userId,
      "diminishedValue",
      "details",
      diminishedValueCaseId ?? "unconfirmed",
    ],
    queryFn: () => {
      if (
        !diminishedValueDependencies?.diminishedValueDetailsService ||
        !diminishedValueCaseId
      ) {
        throw new Error("Diminished-value case details are unavailable.");
      }
      return diminishedValueDependencies.diminishedValueDetailsService.getDetails({
        caseId: diminishedValueCaseId,
        userId,
      });
    },
    enabled: Boolean(
      diminishedValueDependencies?.diminishedValueDetailsService &&
        diminishedValueCaseId,
    ),
  });
  const shouldResolveClaim =
    appraisalCase.serviceType === "total_loss" &&
    appraisalCase.hasTotalLossClaimWorkflow === true;
  const claimQuery = useTotalLossClaimQuery({
    accessToken,
    caseId: appraisalCase.id,
    userId,
    enabled: shouldResolveClaim,
  });
  const model = createCaseDashboardModel({
    appraisalCase,
    totalLossDetails: totalLossDetailsQuery.data ?? null,
    diminishedValueDetails: diminishedValueDetailsQuery.data ?? null,
    claim: claimQuery.data ?? null,
  });
  const detailsUnavailable =
    totalLossDetailsQuery.isError ||
    diminishedValueDetailsQuery.isError ||
    claimQuery.isError;

  return (
    <CaseWorkspaceView
      detailsUnavailable={detailsUnavailable}
      historicalCaseCount={historicalCaseCount}
      model={model}
      newAppraisalHref={newAppraisalHref}
    />
  );
}

export function CaseWorkspaceView({
  detailsUnavailable = false,
  historicalCaseCount,
  model,
  newAppraisalHref,
}: {
  readonly detailsUnavailable?: boolean;
  readonly historicalCaseCount: number;
  readonly model: CaseDashboardModel;
  readonly newAppraisalHref: string;
}) {
  return (
    <div className="grid min-w-0 gap-7 xl:grid-cols-[minmax(0,1fr)_19rem] xl:gap-x-8 xl:gap-y-7">
      <CaseSummary model={model} />
      <CaseProgressRail model={model} />
      <CaseDetails
        detailsUnavailable={detailsUnavailable}
        historicalCaseCount={historicalCaseCount}
        model={model}
        newAppraisalHref={newAppraisalHref}
      />
    </div>
  );
}

function SignedInHomeContent({
  accessToken,
  newAppraisalHref,
  service,
  userId,
}: {
  readonly accessToken: string;
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

  return (
    <section className="page-gradient-account-home w-full bg-canvas">
      <div className="mx-auto w-full max-w-7xl px-4 py-9 min-[360px]:px-5 sm:px-8 sm:py-14 lg:px-10 lg:py-16">
        {appraisalsQuery.isPending ? (
          <WorkspaceLoading />
        ) : appraisalsQuery.isError || responseOutsideOwnerScope ? (
          <AppraisalCasesErrorState
            heading="We couldn’t load your case workspace."
            description="Venfour could not verify the saved cases for this account. No case information has been changed."
            headingId="home-appraisals-error-title"
            onRetry={
              responseOutsideOwnerScope
                ? undefined
                : () => void appraisalsQuery.refetch()
            }
            showContactSupport
          />
        ) : !selection.focalCase ? (
          <FirstAppraisalState newAppraisalHref={newAppraisalHref} />
        ) : (
          <FocalCaseWorkspace
            key={selection.focalCase.id}
            accessToken={accessToken}
            appraisalCase={selection.focalCase}
            historicalCaseCount={selection.historicalCaseCount}
            newAppraisalHref={newAppraisalHref}
            userId={userId}
          />
        )}
      </div>
    </section>
  );
}

export function SignedInHomePage({
  accessToken,
  userId,
}: SignedInHomePageProps) {
  const service = useAppraisalCaseService();
  const newAppraisalHref = useNewTotalLossAppraisalHref();

  if (!service) {
    return (
      <section className="page-gradient-account-home w-full bg-canvas">
        <div className="mx-auto w-full max-w-7xl px-4 py-9 min-[360px]:px-5 sm:px-8 sm:py-14 lg:px-10 lg:py-16">
          <AppraisalCasesErrorState
            heading="We couldn’t load your case workspace."
            description="Venfour could not verify the saved cases for this account. No case information has been changed."
            headingId="home-appraisals-error-title"
            showContactSupport
          />
        </div>
      </section>
    );
  }

  return (
    <SignedInHomeContent
      accessToken={accessToken}
      newAppraisalHref={newAppraisalHref}
      service={service}
      userId={userId}
    />
  );
}
