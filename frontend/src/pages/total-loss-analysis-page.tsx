import {
  AlertCircle,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";

import { Button } from "@/components/ui/button";
import { useAuth, useSignInDialog } from "@/features/auth";
import {
  useCaseAnalysisQuery,
  useSubmitCaseAnalysisMutation,
} from "@/features/analyses/case-analysis-queries";
import { ApiError } from "@/lib/api/client";

const canonicalUuid4Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const replaceReportErrorCodes = new Set([
  "POSTAL_CODE_REQUIRED",
  "INVALID_POSTAL_CODE",
  "REPORT_REQUIRED",
  "REPORT_INTAKE_REQUIRED",
  "REPORT_INTAKE_NOT_READY",
]);

function processingLeaseExpired(expiresAt: string | null, currentTime: number) {
  if (!expiresAt) return false;
  const expiration = Date.parse(expiresAt);
  return Number.isFinite(expiration) && expiration <= currentTime;
}

interface StateCardProps {
  readonly description: string;
  readonly eyebrow: string;
  readonly heading: string;
  readonly kind?: "error" | "loading" | "secure";
  readonly children?: ReactNode;
}

function StateCard({
  children,
  description,
  eyebrow,
  heading,
  kind = "secure",
}: StateCardProps) {
  const Icon =
    kind === "loading"
      ? LoaderCircle
      : kind === "error"
        ? AlertCircle
        : ShieldCheck;

  return (
    <section className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center px-5 py-16 sm:px-8 sm:py-24">
      <div
        className="w-full rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8"
        role={kind === "error" ? "alert" : undefined}
        aria-live={kind === "loading" ? "polite" : undefined}
        aria-busy={kind === "loading" ? true : undefined}
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Icon
            className={
              kind === "loading"
                ? "size-6 animate-spin motion-reduce:animate-none"
                : "size-6"
            }
            aria-hidden
          />
        </span>
        <p className="mt-6 text-sm font-semibold tracking-[0.12em] text-brand uppercase">
          {eyebrow}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-4xl">
          {heading}
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-copy">
          {description}
        </p>
        {children ? (
          <div className="mt-7 flex flex-wrap gap-3">{children}</div>
        ) : null}
      </div>
    </section>
  );
}

function AuthenticatedTotalLossAnalysisPage({
  accessToken,
  caseId,
  userId,
}: {
  readonly accessToken: string;
  readonly caseId: string;
  readonly userId: string;
}) {
  const navigate = useNavigate();
  const autoSubmittedCaseRef = useRef<string | null>(null);
  const analysisQuery = useCaseAnalysisQuery({ accessToken, caseId, userId });
  const submitMutation = useSubmitCaseAnalysisMutation({
    accessToken,
    caseId,
    userId,
  });
  const analysis = analysisQuery.data;
  const processingExpiresAt =
    analysis?.status === "processing"
      ? analysis.processingExpiresAt
      : null;
  const [leaseClock, setLeaseClock] = useState(() => Date.now());

  useEffect(() => {
    if (!processingExpiresAt) return;
    const expiration = Date.parse(processingExpiresAt);
    if (!Number.isFinite(expiration)) return;

    const timeout = window.setTimeout(
      () => setLeaseClock(Date.now()),
      Math.max(0, expiration - Date.now() + 25),
    );
    return () => window.clearTimeout(timeout);
  }, [processingExpiresAt]);

  useEffect(() => {
    if (
      analysis?.status !== "not_submitted" ||
      submitMutation.isPending ||
      autoSubmittedCaseRef.current === caseId
    ) {
      return;
    }

    autoSubmittedCaseRef.current = caseId;
    submitMutation.mutate({});
  }, [analysis?.status, caseId, submitMutation]);

  useEffect(() => {
    if (analysis?.status !== "completed") return;
    if (!canonicalUuid4Pattern.test(analysis.runId)) return;
    void navigate(`/analyses/${analysis.runId}`, { replace: true });
  }, [analysis, navigate]);

  if (analysisQuery.isPending) {
    return (
      <StateCard
        kind="loading"
        eyebrow="Preparing value check"
        heading="Loading your appraisal…"
        description="Venfour is securely opening this total-loss appraisal."
      />
    );
  }

  if (analysisQuery.isError) {
    const error = analysisQuery.error;
    const unavailable = error instanceof ApiError && error.status === 404;
    const authenticationFailed =
      error instanceof ApiError && error.status === 401;

    return (
      <StateCard
        kind="error"
        eyebrow={
          authenticationFailed
            ? "Session unavailable"
            : unavailable
              ? "Appraisal unavailable"
              : "Unable to load value check"
        }
        heading={
          authenticationFailed
            ? "We couldn’t verify your sign-in."
            : unavailable
              ? "We couldn’t find this appraisal."
              : "We couldn’t load your value check."
        }
        description={
          unavailable
            ? "The appraisal may not exist, or it may belong to a different account."
            : authenticationFailed
              ? "Your session may have expired. Sign in again, then reopen this appraisal."
              : "A temporary connection problem prevented Venfour from checking the current status."
        }
      >
        {!unavailable && !authenticationFailed ? (
          <Button
            variant="outline"
            onClick={() => void analysisQuery.refetch()}
          >
            <RefreshCw className="size-4" aria-hidden />
            Try again
          </Button>
        ) : null}
        <Button asChild variant="ghost">
          <Link to="/appraisals">Return to appraisals</Link>
        </Button>
      </StateCard>
    );
  }

  if (!analysis) {
    return (
      <StateCard
        kind="loading"
        eyebrow="Preparing value check"
        heading="Loading your appraisal…"
        description="Venfour is securely opening this total-loss appraisal."
      />
    );
  }

  if (
    analysis.status === "not_submitted" ||
    analysis.status === "processing"
  ) {
    const needsResume =
      analysis.status === "processing" &&
      processingLeaseExpired(analysis.processingExpiresAt, leaseClock);
    const submissionError =
      (analysis.status === "not_submitted" || needsResume) &&
      submitMutation.isError
      ? submitMutation.error
      : null;
    const errorMessage =
      submissionError instanceof ApiError
        ? submissionError.message
        : submissionError
          ? "Venfour couldn’t start the value check."
          : null;
    const replaceReportRequired =
      submissionError instanceof ApiError &&
      Boolean(
        submissionError.code &&
          replaceReportErrorCodes.has(submissionError.code),
      );

    return (
      <StateCard
        kind={errorMessage || needsResume ? "error" : "loading"}
        eyebrow={
          errorMessage
            ? needsResume
              ? "Value check not resumed"
              : "Value check not started"
            : needsResume
              ? "Value check paused"
              : "Value check in progress"
        }
        heading={
          errorMessage
            ? needsResume
              ? "We couldn’t resume your value check."
              : "We couldn’t start your value check."
            : needsResume
              ? "This value check needs to resume."
              : "We’re preparing your market valuation."
        }
        description={
          errorMessage ??
          (needsResume
            ? "The previous processing attempt did not finish. Venfour can safely resume this saved appraisal without creating a second analysis."
            : "Venfour is reviewing the confirmed vehicle and claim facts and comparing them with relevant market evidence. You can safely leave this page and return later.")
        }
      >
        {errorMessage && replaceReportRequired ? (
          <Button asChild>
            <Link
              to={`/start?service=total-loss&caseId=${encodeURIComponent(caseId)}`}
            >
              Replace report
            </Link>
          </Button>
        ) : errorMessage ? (
          <Button onClick={() => submitMutation.mutate({})}>
            <RefreshCw className="size-4" aria-hidden />
            Try again
          </Button>
        ) : needsResume ? (
          <Button
            disabled={submitMutation.isPending}
            onClick={() => submitMutation.mutate({})}
          >
            <RefreshCw className="size-4" aria-hidden />
            Resume value check
          </Button>
        ) : null}
      </StateCard>
    );
  }

  if (analysis.status === "failed") {
    return (
      <StateCard
        kind="error"
        eyebrow="Value check needs attention"
        heading="We couldn’t complete this value check."
        description={analysis.error.message}
      >
        {analysis.retryable ? (
          <Button
            disabled={submitMutation.isPending}
            onClick={() => submitMutation.mutate({})}
          >
            {submitMutation.isPending ? (
              <LoaderCircle
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : (
              <RefreshCw className="size-4" aria-hidden />
            )}
            Retry value check
          </Button>
        ) : (
          <Button asChild>
            <Link
              to={`/start?service=total-loss&caseId=${encodeURIComponent(caseId)}`}
            >
              Review intake
            </Link>
          </Button>
        )}
      </StateCard>
    );
  }

  if (!canonicalUuid4Pattern.test(analysis.runId)) {
    return (
      <StateCard
        kind="error"
        eyebrow="Analysis unavailable"
        heading="We couldn’t open the completed analysis."
        description="The saved result did not include a valid analysis identifier. Try again later."
      >
        <Button variant="outline" onClick={() => void analysisQuery.refetch()}>
          <RefreshCw className="size-4" aria-hidden />
          Try again
        </Button>
      </StateCard>
    );
  }

  return (
    <StateCard
      kind="loading"
      eyebrow="Value check complete"
      heading="Opening your analysis…"
      description="Your total-loss analysis is ready."
    />
  );
}

export function TotalLossAnalysisPage() {
  const { caseId = "" } = useParams();
  const location = useLocation();
  const { auth } = useAuth();
  const { openSignIn } = useSignInDialog();
  const returnTo = `${location.pathname}${location.search}`;

  if (!canonicalUuid4Pattern.test(caseId)) {
    return (
      <StateCard
        kind="error"
        eyebrow="Invalid appraisal link"
        heading="This appraisal link isn’t valid."
        description="Check the complete link, or return to your total-loss appraisals."
      >
        <Button asChild>
          <Link to="/appraisals">Return to appraisals</Link>
        </Button>
      </StateCard>
    );
  }

  if (auth.status === "loading") {
    return (
      <StateCard
        kind="loading"
        eyebrow="Secure appraisal"
        heading="Checking secure access…"
        description="Venfour is confirming this browser can open the private appraisal."
      />
    );
  }

  if (auth.status === "signedOut") {
    return (
      <StateCard
        eyebrow="Secure appraisal"
        heading="Sign in to view this value check."
        description="This appraisal is private. Sign in with the account that owns it to continue."
      >
        <Button onClick={() => openSignIn({ returnTo })}>
          <ShieldCheck className="size-4" aria-hidden />
          Sign in
        </Button>
      </StateCard>
    );
  }

  if (auth.status === "unavailable") {
    return (
      <StateCard
        kind="error"
        eyebrow="Sign-in unavailable"
        heading="We can’t securely open this appraisal right now."
        description={auth.reason}
      />
    );
  }

  return (
    <AuthenticatedTotalLossAnalysisPage
      accessToken={auth.session.access_token}
      caseId={caseId}
      userId={auth.user.id}
    />
  );
}
