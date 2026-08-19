import { AlertCircle, FileQuestion, RotateCw } from "lucide-react";
import { Link, useLocation, useParams } from "react-router";

import {
  type PageMetadata,
  useDocumentMetadata,
} from "@/app/document-metadata";
import { Button } from "@/components/ui/button";
import { useAuth, useSignInDialog } from "@/features/auth";
import { AnalysisResults } from "@/features/analyses/components/analysis-results";
import { useAnalysisQuery } from "@/features/analyses/queries";
import { ApiError } from "@/lib/api/client";

function AnalysisLoadingState() {
  return (
    <section
      className="mx-auto w-full max-w-[90rem] animate-pulse px-5 py-8 motion-reduce:animate-none sm:px-8 sm:py-10 lg:px-10 lg:py-12"
      aria-label="Loading analysis"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading your valuation analysis…</span>
      <div className="h-4 w-48 rounded-full bg-muted" />
      <div className="mt-4 h-10 w-full max-w-2xl rounded-lg bg-muted" />
      <div className="mt-3 h-5 w-72 max-w-full rounded-full bg-muted" />
      <div className="mt-8 rounded-2xl border bg-card p-6 sm:p-8 lg:p-10">
        <div className="h-5 w-36 rounded-full bg-muted" />
        <div className="mt-5 h-9 w-full max-w-3xl rounded-lg bg-muted" />
        <div className="mt-4 h-5 w-full max-w-2xl rounded-full bg-muted" />
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-24 rounded-xl bg-muted" />
          ))}
        </div>
      </div>
      <div className="mt-8 h-72 rounded-2xl border bg-card" />
    </section>
  );
}

interface AnalysisErrorStateProps {
  kind: "invalid" | "not-found" | "temporary";
  onRetry?: () => void;
}

const analysisMetadata: Record<
  "success" | AnalysisErrorStateProps["kind"],
  PageMetadata
> = {
  success: {
    title: "Vehicle Valuation Analysis | Venfour",
    description:
      "Review the CCC valuation, selected market evidence, findings, and limitations for this vehicle analysis.",
  },
  invalid: {
    title: "Invalid Analysis Link | Venfour",
    description: "This Venfour analysis link is not valid.",
  },
  "not-found": {
    title: "Analysis Not Found | Venfour",
    description: "The requested Venfour analysis could not be found.",
  },
  temporary: {
    title: "Analysis Temporarily Unavailable | Venfour",
    description: "Venfour could not retrieve this analysis right now.",
  },
};

function AnalysisDocumentMetadata({
  kind,
}: {
  kind: keyof typeof analysisMetadata;
}) {
  useDocumentMetadata(analysisMetadata[kind]);
  return null;
}

function AnalysisErrorState({ kind, onRetry }: AnalysisErrorStateProps) {
  const permanent = kind !== "temporary";
  const invalid = kind === "invalid";
  const Icon = permanent ? FileQuestion : AlertCircle;
  const eyebrow = invalid
    ? "Invalid analysis link"
    : kind === "not-found"
      ? "Analysis unavailable"
      : "Unable to load analysis";
  const heading = invalid
    ? "This analysis link isn’t valid."
    : kind === "not-found"
      ? "We couldn’t find this analysis."
      : "We couldn’t load your analysis.";
  const description = invalid
    ? "Analysis links include a complete identifier. Check the address you received, or start a new appraisal."
    : kind === "not-found"
      ? "The analysis may no longer be available, or the link may be incorrect. Retrying will not restore a missing analysis."
      : "A network or service interruption prevented Venfour from retrieving the analysis. The saved analysis has not been changed.";

  return (
    <>
      <AnalysisDocumentMetadata kind={kind} />
      <section
        className="mx-auto flex w-full max-w-[90rem] items-center px-5 py-20 sm:px-8 sm:py-28 lg:px-10"
        role="alert"
      >
        <div className="max-w-xl">
          <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Icon className="size-5" aria-hidden="true" />
          </div>
          <p className="mt-6 text-sm font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {eyebrow}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {heading}
          </h1>
          <p className="mt-4 max-w-lg leading-7 text-muted-foreground">
            {description}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            {kind === "temporary" && onRetry ? (
              <Button variant="outline" onClick={onRetry}>
                <RotateCw className="size-4" aria-hidden="true" />
                Try again
              </Button>
            ) : null}
            <Button asChild variant={permanent ? "default" : "ghost"}>
              <Link to={permanent ? "/start?service=total-loss" : "/"}>
                {permanent ? "Start a new appraisal" : "Return home"}
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

const canonicalRunIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function ValidAnalysisPage({
  accessToken,
  runId,
  userId,
}: {
  accessToken: string;
  runId: string;
  userId: string;
}) {
  const analysisQuery = useAnalysisQuery({ accessToken, runId, userId });

  if (analysisQuery.isPending) {
    return (
      <>
        <AnalysisDocumentMetadata kind="success" />
        <AnalysisLoadingState />
      </>
    );
  }

  if (analysisQuery.isError) {
    const apiError =
      analysisQuery.error instanceof ApiError ? analysisQuery.error : null;
    const invalid =
      apiError?.status === 400 || apiError?.code === "INVALID_RUN_ID";
    const notFound =
      apiError?.status === 404 || apiError?.code === "ANALYSIS_NOT_FOUND";

    return (
      <AnalysisErrorState
        kind={invalid ? "invalid" : notFound ? "not-found" : "temporary"}
        onRetry={() => void analysisQuery.refetch()}
      />
    );
  }

  return (
    <>
      <AnalysisDocumentMetadata kind="success" />
      <p className="sr-only" role="status">
        Valuation analysis loaded.
      </p>
      <AnalysisResults analysis={analysisQuery.data} />
    </>
  );
}

export function AnalysisPage() {
  const { runId = "" } = useParams();
  const location = useLocation();
  const { auth } = useAuth();
  const { openSignIn } = useSignInDialog();

  if (!canonicalRunIdPattern.test(runId)) {
    return <AnalysisErrorState kind="invalid" />;
  }

  if (auth.status === "loading") {
    return (
      <>
        <AnalysisDocumentMetadata kind="success" />
        <AnalysisLoadingState />
      </>
    );
  }

  if (auth.status === "signedOut") {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <>
        <AnalysisDocumentMetadata kind="success" />
        <section className="mx-auto flex min-h-[60vh] w-full max-w-[90rem] items-center px-5 py-20 sm:px-8 sm:py-28 lg:px-10">
          <div className="max-w-xl">
            <p className="text-sm font-semibold tracking-[0.12em] text-brand uppercase">
              Secure analysis
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Sign in to view this analysis.
            </h1>
            <p className="mt-4 max-w-lg leading-7 text-muted-foreground">
              Vehicle valuation analyses are private. Sign in with the account
              that owns this appraisal to continue.
            </p>
            <Button className="mt-7" onClick={() => openSignIn({ returnTo })}>
              Sign in
            </Button>
          </div>
        </section>
      </>
    );
  }

  if (auth.status === "unavailable") {
    return <AnalysisErrorState kind="temporary" />;
  }

  return (
    <ValidAnalysisPage
      accessToken={auth.session.access_token}
      runId={runId}
      userId={auth.user.id}
    />
  );
}
