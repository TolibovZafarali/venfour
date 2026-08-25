import { AlertCircle, ArrowRight, ClipboardList, RefreshCw } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

export interface AppraisalCasesLoadingStateProps {
  readonly variant: "list" | "overview";
}

export function AppraisalCasesLoadingState({
  variant,
}: AppraisalCasesLoadingStateProps) {
  if (variant === "overview") {
    return (
      <div
        className="mt-10 space-y-6"
        aria-label="Loading appraisal overview"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="sr-only">Loading your appraisal overview…</span>
        <div
          className="h-72 animate-pulse rounded-3xl bg-white motion-reduce:animate-none"
          aria-hidden
        />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="h-64 animate-pulse rounded-2xl bg-white motion-reduce:animate-none"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-3"
      aria-label="Loading appraisals"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading your appraisals…</span>
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="h-64 animate-pulse rounded-2xl border border-line bg-white motion-reduce:animate-none"
          aria-hidden
        />
      ))}
    </div>
  );
}

export interface AppraisalCasesErrorStateProps {
  readonly description: string;
  readonly heading: string;
  readonly headingId?: string;
  readonly onRetry?: () => void;
  readonly showContactSupport?: boolean;
}

export function AppraisalCasesErrorState({
  description,
  heading,
  headingId = "appraisal-cases-error-title",
  onRetry,
  showContactSupport = false,
}: AppraisalCasesErrorStateProps) {
  return (
    <section
      className="mt-10 rounded-2xl border border-red-200 bg-white p-6 sm:p-8"
      role="alert"
      aria-labelledby={headingId}
    >
      <AlertCircle className="size-7 text-red-700" aria-hidden />
      <h2
        id={headingId}
        className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-ink"
      >
        {heading}
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-copy">
        {description}
      </p>
      {onRetry || showContactSupport ? (
        <div className="mt-6 flex flex-wrap gap-3">
          {onRetry ? (
            <Button variant="outline" onClick={onRetry}>
              <RefreshCw className="size-4" aria-hidden />
              Try again
            </Button>
          ) : null}
          {showContactSupport ? (
            <Button asChild variant="ghost">
              <Link to="/contact">Contact support</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

interface CompactEmptyStateProps {
  readonly description: string;
  readonly variant: "compact";
}

interface FirstAppraisalEmptyStateProps {
  readonly description: string;
  readonly newAppraisalHref: string;
  readonly variant: "first-appraisal";
}

export type AppraisalCasesEmptyStateProps =
  | CompactEmptyStateProps
  | FirstAppraisalEmptyStateProps;

export function AppraisalCasesEmptyState(
  props: AppraisalCasesEmptyStateProps,
) {
  if (props.variant === "first-appraisal") {
    return (
      <section
        className="mt-10 overflow-hidden rounded-3xl border border-line bg-white"
        aria-labelledby="empty-appraisals-title"
      >
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.46fr)]">
          <div className="p-6 sm:p-8 lg:p-10">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
              <ClipboardList className="size-6" aria-hidden />
            </span>
            <h2
              id="empty-appraisals-title"
              className="mt-6 text-3xl font-semibold tracking-[-0.035em] text-ink"
            >
              No appraisals yet
            </h2>
            <p className="mt-3 max-w-xl text-base leading-7 text-copy">
              {props.description}
            </p>
            <Button asChild className="mt-7">
              <Link to={props.newAppraisalHref}>
                Start your first appraisal
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </div>
          <div
            className="relative min-h-48 overflow-hidden border-t border-line bg-brand-soft lg:border-t-0 lg:border-l"
            aria-hidden
          >
            <div className="absolute -right-16 -bottom-24 size-72 rounded-full border-[2rem] border-white/55" />
            <div className="absolute top-10 left-10 size-20 rounded-2xl border border-brand/15 bg-white/75 shadow-sm" />
            <div className="absolute top-20 left-20 h-24 w-52 rounded-2xl border border-brand/15 bg-white shadow-sm" />
            <div className="absolute top-28 left-28 h-2.5 w-24 rounded-full bg-brand/25" />
            <div className="absolute top-36 left-28 h-2.5 w-16 rounded-full bg-market/25" />
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="mt-10 rounded-2xl border border-line bg-white p-6 sm:p-8">
      <ClipboardList className="size-8 text-brand" aria-hidden />
      <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-ink">
        No appraisals yet
      </h2>
      <p className="mt-3 max-w-xl text-sm leading-6 text-copy">
        {props.description}
      </p>
    </div>
  );
}
