import { ValuationStatus } from "@/components/valuation-status";
import { RotateCw } from "lucide-react";
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
  return <ValuationStatus kind="loading" heading="Opening your valuation" description="Retrieving your saved review." />;
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
      "Review the insurer valuation or stated offer, selected market evidence, findings, and limitations for this vehicle analysis.",
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
    ? "Check the link you received, or choose an appraisal from your account menu."
    : kind === "not-found"
      ? "The link may be incorrect, or this review may belong to a different account."
      : "We couldn’t open your saved review right now. Try again in a moment.";

  return (
    <>
      <AnalysisDocumentMetadata kind={kind} />
      <ValuationStatus kind="error" heading={heading} description={description} eyebrow={eyebrow}>
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
      </ValuationStatus>
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
        <ValuationStatus heading="Sign in to view this analysis." description="Sign in with the account that owns this appraisal to continue." eyebrow="Secure analysis">
            <Button className="mt-7" onClick={() => openSignIn({ returnTo })}>
              Sign in
            </Button>
        </ValuationStatus>
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
