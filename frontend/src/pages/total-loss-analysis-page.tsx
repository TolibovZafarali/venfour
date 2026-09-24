import { environment } from "@/config/env";
import { ProductFactsForm } from "@/features/nationwide/product-panel";
import { ValuationStatus as StateCard } from "@/components/valuation-status";
import {
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { supportEmail } from "@/config/support";
import { useAuth, useSignInDialog } from "@/features/auth";
import {
  useCaseAnalysisQuery,
  useSubmitCaseAnalysisMutation,
  hasAttemptedAutomaticSubmission,
  markAutomaticSubmission,
  automaticSubmissionRequested,
} from "@/features/analyses/case-analysis-queries";
import { caseAnalysisInput } from "@/features/analyses/api/case-analysis";
import {
  TotalLossAnalysisResult,
} from "@/features/analyses/components/total-loss-analysis-experience";
import { FreeValuationProcessing } from "@/features/analyses/components/free-valuation-processing";
import { useAnalysisQuery } from "@/features/analyses/queries";
import { ApiError } from "@/lib/api/client";
import { totalLossIntakeCorrectionPath } from "@/features/total-loss/intake-correction";
import { ReportUploadDialog } from "@/features/full-review/report-upload-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { caseAnalysisQueryKeys, requestAutomaticSubmission } from "@/features/analyses/case-analysis-queries";
import { useTotalLossDependencies } from "@/features/total-loss/dependencies";
import { confirmVehicleDetail } from "@/features/total-loss/confirm-vehicle-detail";
import { VEHICLE_FACT_LABELS, type VehicleFactField } from "@/features/total-loss/vehicle-facts";

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

function CompletedTotalLossAnalysis({
  accessToken,
  intakeCorrectionAllowed,
  runId,
  userId,
  reportUploadAction,
  analysisInputId,
}: {
  readonly accessToken: string;
  readonly intakeCorrectionAllowed: boolean;
  readonly runId: string;
  readonly userId: string;
  readonly reportUploadAction: ReactNode;
  readonly analysisInputId?: string | null;
}) {
  const dependencies = useTotalLossDependencies();
  const queryClient = useQueryClient();
  const resultQuery = useAnalysisQuery({ accessToken, runId, userId });
  const { caseId } = useParams();
  const reviewIntakePath =
    intakeCorrectionAllowed === true && caseId
      ? totalLossIntakeCorrectionPath(caseId)
      : undefined;

  if (resultQuery.isPending) {
    return <FreeValuationProcessing reviewKey={caseId} phase="opening" />;
  }

  if (resultQuery.isError) {
    const unavailable =
      resultQuery.error instanceof ApiError && resultQuery.error.status === 404;

    return (
      <StateCard
        kind="error"
        eyebrow={unavailable ? "Analysis unavailable" : "Unable to load result"}
        heading={
          unavailable
            ? "We couldn’t find the completed analysis."
            : "We couldn’t load your completed result."
        }
        description={
          unavailable
            ? "The appraisal completed, but its saved analysis is not available from this account."
            : "A temporary connection problem prevented Venfour from opening the saved result."
        }
      >
        {!unavailable ? (
          <Button variant="outline" onClick={() => void resultQuery.refetch()}>
            <RefreshCw className="size-4" aria-hidden />
            Try again
          </Button>
        ) : null}
        <Button asChild variant="ghost">
          <Link to="/contact">Contact support</Link>
        </Button>
      </StateCard>
    );
  }

  return (
    <TotalLossAnalysisResult
      analysis={resultQuery.data}
      addInsurerOfferPath={
        reviewIntakePath && caseId
          ? totalLossIntakeCorrectionPath(caseId, "insurer-offer")
          : undefined
      }
      continueAction={reportUploadAction}
      reportUploadAction={reportUploadAction}
      reviewIntakePath={reviewIntakePath}
      insurerReportPath={caseId ? `/total-loss/cases/${caseId}/review-report` : undefined}
      onConfirmVehicleFact={intakeCorrectionAllowed && caseId && analysisInputId && dependencies?.totalLossDetailsService.confirmIntake ? async (field: VehicleFactField, value: string) => {
        const updated = await confirmVehicleDetail({ service: dependencies.totalLossDetailsService, accessToken, userId, caseId, analysisInputId, field, value });
        if (!updated.analysisInputId || !updated.analysisInputRevision) throw new Error("The updated review is unavailable.");
        requestAutomaticSubmission(userId, caseId, { expectedAnalysisInputId: updated.analysisInputId, expectedAnalysisInputRevision: updated.analysisInputRevision });
        await queryClient.invalidateQueries({ queryKey: caseAnalysisQueryKeys.detail(userId, caseId) });
      } : undefined}
    />
  );
}

function AuthenticatedTotalLossAnalysisPage({
  accessToken,
  caseId,
  userId,
  reportUploadAction,
}: {
  readonly accessToken: string;
  readonly caseId: string;
  readonly userId: string;
  readonly reportUploadAction: ReactNode;
}) {
  const autoSubmittedCaseRef = useRef<string | null>(null);
  const analysisQuery = useCaseAnalysisQuery({ accessToken, caseId, userId });
  const submitMutation = useSubmitCaseAnalysisMutation({
    accessToken,
    caseId,
    userId,
  });
  const analysis = analysisQuery.data;
  const input = analysis ? caseAnalysisInput(analysis) : null;
  const submitCurrentInput = () => {
    if (input) submitMutation.mutate({ input });
    else void analysisQuery.refetch();
  };
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
      analysis.submissionAvailability?.available === false ||
      !input ||
      !automaticSubmissionRequested(userId, caseId, input) ||
      submitMutation.isPending ||
      autoSubmittedCaseRef.current === input.expectedAnalysisInputId ||
      hasAttemptedAutomaticSubmission(userId, caseId, input)
    ) {
      return;
    }

    autoSubmittedCaseRef.current = input.expectedAnalysisInputId;
    markAutomaticSubmission(userId, caseId, input);
    submitMutation.mutate({ input });
  }, [analysis, caseId, input, submitMutation, userId]);

  if (analysisQuery.isPending) {
    return <FreeValuationProcessing reviewKey={caseId} phase="connecting" />;
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
        {unavailable || authenticationFailed ? (
          <Button asChild variant="outline">
            <Link to={`/total-loss/cases/${caseId}/return`}>Email me a return link</Link>
          </Button>
        ) : null}
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
          <Link to="/contact">Contact support</Link>
        </Button>
      </StateCard>
    );
  }

  if (!analysis) {
    return <FreeValuationProcessing reviewKey={caseId} phase="connecting" />;
  }

  if (analysis.status === "not_submitted" && analysis.submissionAvailability?.available === false) {
    return <StateCard kind="error" eyebrow="Your information is saved"
      heading="The value check is temporarily unavailable."
      description="Your vehicle details are safe. You can continue to the report review or return to this case later.">
      {reportUploadAction}
      <Button variant="outline" onClick={() => void analysisQuery.refetch()}>Check availability</Button>
    </StateCard>;
  }

  if (
    analysis.status === "not_submitted" ||
    analysis.status === "processing"
  ) {
    const needsResume =
      (analysis.status === "processing" &&
        processingLeaseExpired(analysis.processingExpiresAt, leaseClock)) ||
      (analysis.status === "not_submitted" && !submitMutation.isPending &&
        (!input || !automaticSubmissionRequested(userId, caseId, input) || hasAttemptedAutomaticSubmission(userId, caseId, input)));
    const submissionError =
      (analysis.status === "not_submitted" || needsResume) &&
      submitMutation.isError
      ? submitMutation.error
      : null;
    const errorMessage =
      submissionError instanceof ApiError
        ? "We couldn’t start the check right now. Your information is saved."
        : submissionError
          ? "Venfour couldn’t start the value check."
          : null;
    const replaceReportRequired =
      submissionError instanceof ApiError &&
      Boolean(
        submissionError.code &&
          replaceReportErrorCodes.has(submissionError.code),
      );

    if (!errorMessage && !needsResume) {
      return <FreeValuationProcessing reviewKey={caseId} phase={analysis.status === "processing" ? "reviewing" : "connecting"} />;
    }

    return (
      <StateCard
        kind="error"
        eyebrow={
          errorMessage
            ? needsResume
              ? "Value check not resumed"
              : "Value check not started"
            : "Value check paused"
        }
        heading={
          errorMessage
            ? needsResume
              ? "We couldn’t resume your value check."
              : "We couldn’t start your value check."
            : "This value check needs to resume."
        }
        description={
          errorMessage ??
          "Your review is saved. Resume it when you’re ready."
        }
      >
        {errorMessage && replaceReportRequired ? (
          <Button asChild>
            <Link
              to={totalLossIntakeCorrectionPath(caseId)}
            >
              Replace report
            </Link>
          </Button>
        ) : errorMessage ? (
          <Button disabled={submitMutation.isPending} onClick={submitCurrentInput}>
            <RefreshCw className="size-4" aria-hidden />
            Try again
          </Button>
        ) : needsResume ? (
          <Button
            disabled={submitMutation.isPending}
            onClick={submitCurrentInput}
          >
            <RefreshCw className="size-4" aria-hidden />
            Resume value check
          </Button>
        ) : null}
      </StateCard>
    );
  }

  if (analysis.status === "failed") {
    const recoveryRequired = analysis.error.code === "ANALYSIS_RECOVERY_REQUIRED";
    const processingInterrupted = analysis.error.code === "ANALYSIS_PROCESSING_INTERRUPTED";
    const ordinaryFields: Record<string, string> = { ...VEHICLE_FACT_LABELS, postalCode: "ZIP code", mileage: "mileage", lossDate: "date of loss", year: "vehicle year", make: "make", model: "model", insurerOffer: "insurer offer" };
    const issue = analysis.subjectReadiness?.issues.find(item => ordinaryFields[item.field]);
    const reportNeeded = Boolean(analysis.subjectReadiness && !issue) || analysis.error.code === "REPORT_NOT_ANALYZABLE";
    const correctionPath = issue ? (analysis.subjectReadiness?.correctionMode === "resume"
      ? `/start?service=total-loss&caseId=${encodeURIComponent(caseId)}&focus=${issue.correctionStep}`
      : totalLossIntakeCorrectionPath(caseId, issue.correctionStep)) + `&vehicleFact=${encodeURIComponent(issue.field)}` : null;
    return <StateCard kind="error" eyebrow={reportNeeded ? "Your review is saved" : "Value check paused"}
      heading={recoveryRequired || processingInterrupted ? "Your value check was interrupted." : issue ? "Check your review details." : reportNeeded ? "Your insurer’s report can help." : "We couldn’t complete this value check."}
      description={recoveryRequired ? "Your case information is saved. We need to recover the interrupted check before continuing. Please contact support for help." : processingInterrupted ? "A temporary processing problem interrupted the check. Your case information is saved. You can try to continue from the saved progress." : issue ? `Confirm the ${ordinaryFields[issue.field].toLowerCase()} shown in your documents so we can continue.` : reportNeeded ? "Review the insurer report and its highlighted details to continue. Your saved information is still here." : "We couldn’t finish the check right now. Your information is saved."}>
      {correctionPath ? <Button asChild><Link to={correctionPath}>Review your details</Link></Button>
        : reportNeeded ? reportUploadAction
        : recoveryRequired ? (supportEmail ? <Button asChild><a href={`mailto:${supportEmail}?subject=Interrupted%20value%20check`}>Email support</a></Button> : null)
        : analysis.retryable ? <Button disabled={submitMutation.isPending} onClick={submitCurrentInput}><RefreshCw className="size-4" aria-hidden />{processingInterrupted ? "Continue value check" : "Retry value check"}</Button>
        : <Button onClick={() => void analysisQuery.refetch()}>Try again</Button>}
      {!issue && !reportNeeded ? <Button asChild variant="outline"><Link to="/contact">Contact support</Link></Button> : null}
    </StateCard>;
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
    <CompletedTotalLossAnalysis
      accessToken={accessToken}
      intakeCorrectionAllowed={analysis.intakeCorrectionAllowed === true}
      runId={analysis.runId}
      analysisInputId={analysis.analysisInputId}
      userId={userId}
      reportUploadAction={reportUploadAction}
    />
  );
}

function SavedReportBackground({ accessToken, caseId, userId, reportUploadAction }: {
  accessToken: string; caseId: string; userId: string; reportUploadAction: ReactNode;
}) {
  const query = useCaseAnalysisQuery({ accessToken, caseId, userId });
  const analysis = query.data;
  return analysis?.status === "completed" && canonicalUuid4Pattern.test(analysis.runId)
    ? <CompletedTotalLossAnalysis accessToken={accessToken} runId={analysis.runId} analysisInputId={analysis.analysisInputId} userId={userId} intakeCorrectionAllowed={analysis.intakeCorrectionAllowed === true} reportUploadAction={reportUploadAction} />
    : <StateCard heading="Your valuation review" description="Review your insurer’s report in this workspace." />;
}

export function TotalLossAnalysisPage({ reportWorkspace = false }: { reportWorkspace?: boolean } = {}) {
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
        description="Check the complete link, or choose an appraisal from your account menu."
      >
        <Button asChild>
          <Link to="/contact">Contact support</Link>
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
        <Button asChild variant="outline">
          <Link to={`/total-loss/cases/${caseId}/return`}>Email me a return link</Link>
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
    <>
    <ReportUploadDialog key={`${auth.user.id}:${caseId}`} accessToken={auth.session.access_token} caseId={caseId} userId={auth.user.id} reportWorkspace={reportWorkspace}>
      {reportUploadAction => reportWorkspace
        ? <SavedReportBackground accessToken={auth.session.access_token} caseId={caseId} userId={auth.user.id} reportUploadAction={reportUploadAction} />
        : <AuthenticatedTotalLossAnalysisPage accessToken={auth.session.access_token} caseId={caseId} userId={auth.user.id} reportUploadAction={reportUploadAction} />}
    </ReportUploadDialog>
    {environment.nationwideProductEnabled ? <details className="mx-auto my-6 w-full max-w-3xl px-5"><summary className="cursor-pointer text-sm font-medium">Review location and claim details</summary><ProductFactsForm caseId={caseId} accessToken={auth.session.access_token} /></details> : null}
    </>
  );
}
