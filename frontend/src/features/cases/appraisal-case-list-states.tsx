import { AlertCircle, ClipboardList, RefreshCw } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

export function AppraisalCasesLoadingState() {
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

export interface AppraisalCasesEmptyStateProps {
  readonly description: string;
}

export function AppraisalCasesEmptyState(
  props: AppraisalCasesEmptyStateProps,
) {
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
