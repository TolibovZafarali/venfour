import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import type {
  TotalLossEducationProjection,
  TotalLossEducationStep,
} from "@/features/total-loss-claim/contracts";
import {
  totalLossClaimViewPath,
  type TotalLossClaimWorkflowView,
} from "@/features/total-loss-claim/workflow-route";
import { cn } from "@/lib/utils";

const GUIDE_STEPS: ReadonlyArray<{
  readonly label: string;
  readonly progressStep: TotalLossEducationStep;
  readonly view: TotalLossClaimWorkflowView;
}> = [
  { label: "Result", progressStep: "result", view: "result" },
  {
    label: "Insurer review",
    progressStep: "insurer_review",
    view: "insurer_review",
  },
  { label: "Valuation", progressStep: "valuation", view: "valuation" },
  { label: "Report", progressStep: "report", view: "report" },
  { label: "What’s next", progressStep: "what_next", view: "what_next" },
  { label: "Prepare request", progressStep: "send", view: "send" },
];

export function ClaimWorkflowFrame({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <section className="w-full bg-transparent">
      <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14 lg:px-10 lg:py-16">
        {children}
      </div>
    </section>
  );
}

export function ClaimWorkflowCard({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[1.75rem] border border-line/80 bg-white p-6 shadow-[0_32px_90px_-56px_rgba(11,31,51,0.55)] sm:p-8 lg:p-10",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function GuidedClaimShell({
  caseId,
  children,
  description,
  education,
  eyebrow,
  heading,
  view,
}: {
  readonly caseId: string;
  readonly children: ReactNode;
  readonly description: string;
  readonly education: TotalLossEducationProjection | null;
  readonly eyebrow: string;
  readonly heading: string;
  readonly view: TotalLossClaimWorkflowView;
}) {
  const currentIndex = GUIDE_STEPS.findIndex((step) => step.view === view);

  return (
    <ClaimWorkflowFrame>
      <nav aria-label="Valuation guide" className="mb-6 overflow-x-auto pb-2">
        <ol className="flex min-w-max items-center gap-2">
          {GUIDE_STEPS.map((step, index) => {
            const progress = education?.steps[step.progressStep];
            const finished = Boolean(progress?.completedAt || progress?.skippedAt);
            const current = step.view === view;
            const available = Boolean(
              current ||
                index < currentIndex ||
                progress?.viewedAt ||
                finished,
            );
            const className = cn(
              "flex min-h-11 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand motion-reduce:transition-none",
              current
                ? "border-brand bg-brand text-white"
                : available
                  ? "border-line bg-white text-copy hover:border-brand/50 hover:text-ink"
                  : "cursor-not-allowed border-line/70 bg-surface/70 text-copy/60",
            );
            const content = (
              <>
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-[0.68rem]",
                    current
                      ? "bg-white/20 text-white"
                      : finished
                        ? "bg-brand-soft text-brand"
                        : "bg-surface text-copy",
                  )}
                  aria-hidden
                >
                  {finished ? <Check className="size-3" /> : index + 1}
                </span>
                {step.label}
              </>
            );
            return (
              <li key={step.view} className="flex items-center gap-2">
                {available ? (
                  <Link
                    aria-current={current ? "step" : undefined}
                    className={className}
                    to={totalLossClaimViewPath(caseId, step.view)}
                  >
                    {content}
                  </Link>
                ) : (
                  <span
                    aria-disabled="true"
                    className={className}
                    title="Continue or use Skip to prepare request from the current screen."
                  >
                    {content}
                  </span>
                )}
                {index < GUIDE_STEPS.length - 1 ? (
                  <span className="h-px w-3 bg-line" aria-hidden />
                ) : null}
              </li>
            );
          })}
        </ol>
      </nav>
      <ClaimWorkflowCard>
        <p className="text-sm font-semibold tracking-[0.12em] text-brand uppercase">
          {eyebrow}
        </p>
        <h1 className="mt-3 max-w-4xl text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl lg:text-5xl">
          {heading}
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-copy sm:text-lg">
          {description}
        </p>
        <div className="mt-8">{children}</div>
      </ClaimWorkflowCard>
    </ClaimWorkflowFrame>
  );
}

export function WorkflowError({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <p
      className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800"
      role="alert"
    >
      {children}
    </p>
  );
}
