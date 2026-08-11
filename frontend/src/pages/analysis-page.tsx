import { AlertCircle, FileQuestion, RotateCw } from "lucide-react";
import { useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { AnalysisResults } from "@/features/analyses/components/analysis-results";
import { useAnalysisQuery } from "@/features/analyses/queries";
import { ApiError } from "@/lib/api/client";

function AnalysisLoadingState() {
  return (
    <section
      className="mx-auto w-full max-w-6xl animate-pulse px-4 py-10 sm:px-6 sm:py-14"
      aria-label="Loading analysis"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading your valuation analysis…</span>
      <div className="h-4 w-48 rounded-full bg-muted" />
      <div className="mt-4 h-10 w-full max-w-2xl rounded-lg bg-muted" />
      <div className="mt-3 h-5 w-72 max-w-full rounded-full bg-muted" />
      <div className="mt-10 rounded-2xl border bg-card p-6 sm:p-8">
        <div className="h-5 w-36 rounded-full bg-muted" />
        <div className="mt-5 h-9 w-full max-w-3xl rounded-lg bg-muted" />
        <div className="mt-4 h-5 w-full max-w-2xl rounded-full bg-muted" />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-24 rounded-xl bg-muted" />
          ))}
        </div>
      </div>
      <div className="mt-8 h-72 rounded-2xl border bg-card" />
    </section>
  );
}

interface AnalysisErrorStateProps {
  notFound: boolean;
  onRetry: () => void;
}

function AnalysisErrorState({ notFound, onRetry }: AnalysisErrorStateProps) {
  const Icon = notFound ? FileQuestion : AlertCircle;

  return (
    <section
      className="mx-auto flex w-full max-w-6xl items-center px-4 py-20 sm:px-6 sm:py-28"
      role="alert"
    >
      <div className="max-w-xl">
        <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <p className="mt-6 text-sm font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          {notFound ? "Analysis unavailable" : "Unable to load analysis"}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {notFound
            ? "We couldn’t find this analysis."
            : "We couldn’t load your analysis."}
        </h1>
        <p className="mt-4 max-w-lg leading-7 text-muted-foreground">
          {notFound
            ? "The analysis may no longer be available, or the link may be incorrect."
            : "A network or service error interrupted the request. Your analysis has not been changed."}
        </p>
        {!notFound ? (
          <Button className="mt-7" variant="outline" onClick={onRetry}>
            <RotateCw className="size-4" aria-hidden="true" />
            Try again
          </Button>
        ) : null}
      </div>
    </section>
  );
}

export function AnalysisPage() {
  const { runId = "" } = useParams();
  const analysisQuery = useAnalysisQuery(runId);

  if (analysisQuery.isPending) {
    return <AnalysisLoadingState />;
  }

  if (analysisQuery.isError) {
    const notFound =
      analysisQuery.error instanceof ApiError &&
      (analysisQuery.error.status === 404 ||
        analysisQuery.error.code === "ANALYSIS_NOT_FOUND");

    return (
      <AnalysisErrorState
        notFound={notFound}
        onRetry={() => void analysisQuery.refetch()}
      />
    );
  }

  return (
    <>
      <p className="sr-only" role="status">
        Valuation analysis loaded.
      </p>
      <AnalysisResults analysis={analysisQuery.data} />
    </>
  );
}
