import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
  ClaimWorkflowCard,
  ClaimWorkflowFrame,
  GuidedClaimShell,
  WorkflowError,
} from "@/features/total-loss-claim/components/claim-workflow-shell";
import { PublishedReportActions } from "@/features/total-loss-claim/components/published-report-actions";
import type {
  TotalLossClaimSecured,
  TotalLossEducationProgressState,
  TotalLossEducationStep,
  TotalLossMoney,
  TotalLossPublishedReport,
} from "@/features/total-loss-claim/contracts";
import { useTotalLossEducationProgressMutation } from "@/features/total-loss-claim/queries";
import {
  totalLossClaimViewPath,
  type TotalLossClaimWorkflowView,
} from "@/features/total-loss-claim/workflow-route";

function MoneyValue({ money }: { readonly money: TotalLossMoney | null }) {
  return <>{money?.formatted ?? "Not stated"}</>;
}

function EvidenceCard({
  label,
  value,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-surface/60 p-5">
      <p className="text-xs font-semibold tracking-[0.1em] text-copy uppercase">
        {label}
      </p>
      <div className="mt-2 break-words text-xl font-semibold tracking-[-0.02em] text-ink sm:text-2xl">
        {value}
      </div>
    </div>
  );
}

function ProgressError({ error }: { readonly error: string | null }) {
  return error ? <WorkflowError>{error}</WorkflowError> : null;
}

function useRecordGuideView({
  caseId,
  claim,
  progressStep,
  accessToken,
  userId,
}: {
  readonly accessToken: string;
  readonly caseId: string;
  readonly claim: TotalLossClaimSecured;
  readonly progressStep: TotalLossEducationStep;
  readonly userId: string;
}) {
  const progress = useTotalLossEducationProgressMutation({
    accessToken,
    backgroundInvalidation: true,
    caseId,
    userId,
  });
  const recorded = useRef(false);

  useEffect(() => {
    if (
      recorded.current ||
      claim.education?.steps[progressStep].viewedAt ||
      !claim.workflow
    ) {
      return;
    }
    recorded.current = true;
    void progress
      .mutateAsync({
        expectedWorkflowRevision: claim.workflow.revision,
        state: "viewed",
        step: progressStep,
      })
      .catch(() => undefined);
  }, [claim.education, claim.workflow, progress, progressStep]);

}

function GuideActions({
  accessToken,
  back,
  caseId,
  claim,
  next,
  primaryLabel,
  progressStep,
  showSkip = true,
  userId,
}: {
  readonly accessToken: string;
  readonly back?: TotalLossClaimWorkflowView;
  readonly caseId: string;
  readonly claim: TotalLossClaimSecured;
  readonly next: TotalLossClaimWorkflowView;
  readonly primaryLabel: string;
  readonly progressStep: TotalLossEducationStep;
  readonly showSkip?: boolean;
  readonly userId: string;
}) {
  const navigate = useNavigate();
  useRecordGuideView({
    accessToken,
    caseId,
    claim,
    progressStep,
    userId,
  });
  const progress = useTotalLossEducationProgressMutation({
    accessToken,
    caseId,
    userId,
  });
  const [error, setError] = useState<string | null>(null);

  const move = async (
    state: TotalLossEducationProgressState,
    destination: TotalLossClaimWorkflowView,
  ) => {
    if (!claim.workflow || progress.isPending) return;
    setError(null);
    try {
      await progress.mutateAsync({
        expectedWorkflowRevision: claim.workflow.revision,
        state,
        step: progressStep,
      });
      void navigate(totalLossClaimViewPath(caseId, destination));
    } catch {
      setError(
        "Your case changed in another tab or the progress update could not be saved. Refresh the current case state and try again.",
      );
    }
  };

  return (
    <div className="mt-8 border-t border-line pt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button
          className="min-h-12"
          disabled={!claim.workflow || progress.isPending}
          onClick={() => void move("completed", next)}
          type="button"
        >
          {primaryLabel}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
        {back ? (
          <Button
            className="min-h-12"
            onClick={() => void navigate(totalLossClaimViewPath(caseId, back))}
            type="button"
            variant="outline"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back
          </Button>
        ) : null}
        {showSkip ? (
          <Button
            className="min-h-12"
            disabled={!claim.workflow || progress.isPending}
            onClick={() => void move("skipped", "send")}
            type="button"
            variant="ghost"
          >
            Skip to prepare request
          </Button>
        ) : null}
      </div>
      <ProgressError error={error} />
    </div>
  );
}

function ResultScreen({
  accessToken,
  caseId,
  claim,
  report,
  userId,
}: GuidedScreenProps) {
  const range = report.conclusion.supportedRange;
  const preliminary = report.conclusion.preliminaryComparison;
  return (
    <GuidedClaimShell
      caseId={caseId}
      description="The final quality-reviewed package below is the authoritative result for this case. It distinguishes the evidence from what that evidence can support."
      education={claim.education ?? null}
      eyebrow="Step 1 of 6 · Required"
      heading="Here’s what the completed evidence supports"
      view="result"
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <EvidenceCard
          label="Insurer valuation reviewed"
          value={<MoneyValue money={report.conclusion.insurerValuation} />}
        />
        <EvidenceCard
          label="Venfour supported range"
          value={
            range
              ? `${range.low.formatted}–${range.high.formatted}`
              : "No defensible range"
          }
        />
        <EvidenceCard
          label="Indicated difference"
          value={<MoneyValue money={report.conclusion.indicatedDifference} />}
        />
        <EvidenceCard
          label="Continuing"
          value={
            report.conclusion.continuingSupported
              ? "Supported by the final review"
              : "Not supported"
          }
        />
      </div>
      {preliminary ? (
        <div className="mt-6 rounded-2xl border border-brand/20 bg-brand-soft/45 p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-ink">
            {preliminary.status === "CONFIRMED"
              ? "The final review confirmed your preliminary result"
              : "The final review updated the preliminary result"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-copy">
            {preliminary.summary}
          </p>
        </div>
      ) : null}
      <div className="mt-6 rounded-2xl border border-line bg-white p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-ink">Completed conclusion</h2>
        <p className="mt-3 text-sm leading-6 text-copy">
          {report.conclusion.summary}
        </p>
        {report.conclusion.limitations.length ? (
          <>
            <h3 className="mt-5 text-sm font-semibold text-ink">
              Important limitations
            </h3>
            <ul className="mt-2 space-y-2 text-sm leading-6 text-copy">
              {report.conclusion.limitations.map((limitation) => (
                <li key={limitation} className="flex gap-3">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                  {limitation}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
      <GuideActions
        accessToken={accessToken}
        caseId={caseId}
        claim={claim}
        next="insurer_review"
        primaryLabel="See how we reached it"
        progressStep="result"
        showSkip={false}
        userId={userId}
      />
    </GuidedClaimShell>
  );
}

function InsurerReviewScreen(props: GuidedScreenProps) {
  const { accessToken, caseId, claim, report, userId } = props;
  const insurer = report.insurerEvidence;
  const selectedMarketCount =
    (report.marketEvidence.primary?.selectedCount ?? 0) +
    (report.marketEvidence.secondary?.selectedCount ?? 0);
  const disclosedCount = insurer.summary.fullyDisclosedAdjustmentCount;
  return (
    <GuidedClaimShell
      caseId={caseId}
      description="Venfour reviewed the insurer valuation as part of the evidence. The completed assessment does not assume that a higher asking price is automatically a better comparable."
      education={claim.education ?? null}
      eyebrow="Step 2 of 6 · Optional"
      heading="We reviewed the insurer’s evidence too"
      view="insurer_review"
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <EvidenceCard
          label="Insurer valuation"
          value={<MoneyValue money={report.conclusion.insurerValuation} />}
        />
        <EvidenceCard
          label="Insurer comparables"
          value={`${insurer.comparableCount} reviewed`}
        />
        <EvidenceCard
          label="Fully disclosed adjustments"
          value={
            `${disclosedCount} of ${insurer.comparableCount}`
          }
        />
        <EvidenceCard
          label="Additional market evidence"
          value={`${selectedMarketCount} selected`}
        />
      </div>
      <div className="mt-6 flex gap-3 rounded-2xl border border-line bg-surface/60 p-5">
        <Scale className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
        <div className="text-sm leading-6 text-copy">
          <p>
            {insurer.methodologyStatement ??
              "The insurer comparables were reviewed descriptively using the completed report methodology."}
          </p>
          <p className="mt-2">
            Insurer comparables are not labeled bad, rejected, or incorrect unless
            the completed deterministic assessment supports that conclusion.
          </p>
          {insurer.summary.partiallyDisclosedAdjustmentCount ||
          insurer.summary.undisclosedAdjustmentCount ||
          insurer.summary.unavailableAdjustmentCount ? (
            <p className="mt-2">
              Adjustment detail requiring context: {insurer.summary.partiallyDisclosedAdjustmentCount} partially disclosed, {insurer.summary.undisclosedAdjustmentCount} undisclosed, and {insurer.summary.unavailableAdjustmentCount} unavailable.
            </p>
          ) : null}
          {insurer.adjustmentContext ? (
            <p className="mt-2">{insurer.adjustmentContext}</p>
          ) : null}
        </div>
      </div>
      {insurer.comparables.length ? (
        <div className="mt-6">
          <h2 className="text-lg font-semibold text-ink">
            Comparable facts reviewed
          </h2>
          <ul className="mt-3 grid gap-3 lg:grid-cols-2">
            {insurer.comparables.slice(0, 4).map((comparable, index) => (
              <li
                className="min-w-0 rounded-2xl border border-line bg-white p-4"
                key={`${comparable.vehicle ?? "Insurer comparable"}:${index}`}
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <p className="break-words font-semibold text-ink">
                    {comparable.vehicle ?? `Insurer comparable ${index + 1}`}
                  </p>
                  <p className="shrink-0 font-semibold text-ink">
                    {comparable.adjustedValue ??
                      comparable.advertisedPrice ??
                      "Value not stated"}
                  </p>
                </div>
                <p className="mt-2 text-sm leading-6 text-copy">
                  {[
                    comparable.mileage === null
                      ? null
                      : `${comparable.mileage.toLocaleString()} miles`,
                    comparable.advertisedPrice
                      ? `Advertised ${comparable.advertisedPrice}`
                      : null,
                    comparable.netAdjustment
                      ? `Net adjustment ${comparable.netAdjustment}`
                      : null,
                    comparable.adjustmentDisclosure,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
          {insurer.comparables.length > 4 ? (
            <p className="mt-3 text-sm leading-6 text-copy">
              The published report contains the complete insurer-comparable set.
            </p>
          ) : null}
        </div>
      ) : null}
      <GuideActions
        accessToken={accessToken}
        caseId={caseId}
        claim={claim}
        next="valuation"
        primaryLabel="See the market evidence"
        progressStep="insurer_review"
        userId={userId}
      />
    </GuidedClaimShell>
  );
}

function ValuationScreen(props: GuidedScreenProps) {
  const { accessToken, caseId, claim, report, userId } = props;
  const range = report.conclusion.supportedRange;
  const market = report.marketEvidence;
  const comparables = market.comparables.slice(0, 6);
  const observedDate =
    market.evidenceDateContext.historicalEvidenceDate ??
    market.evidenceDateContext.currentObservedDate ??
    market.primary?.evidenceDate ??
    market.secondary?.evidenceDate ??
    report.issueDate;
  return (
    <GuidedClaimShell
      caseId={caseId}
      description="The supported range reflects the selected evidence, relevant calculations, and the market context documented in your package. It is not a guaranteed transaction or settlement amount."
      education={claim.education ?? null}
      eyebrow="Step 3 of 6 · Optional"
      heading="How the evidence supports your range"
      view="valuation"
    >
      {range ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <EvidenceCard label="Range low" value={range.low.formatted} />
          <EvidenceCard label="Range midpoint" value={range.median.formatted} />
          <EvidenceCard label="Range high" value={range.high.formatted} />
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-surface/60 p-5 text-sm leading-6 text-copy">
          The completed evidence did not support a defensible valuation range.
          The report explains the evidence and limitation behind that result.
        </div>
      )}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <EvidenceCard label="Evidence date" value={observedDate} />
        <EvidenceCard
          label="Evidence basis"
          value={range?.evidenceBasis ?? "See the published evidence package"}
        />
      </div>
      <div className="mt-6 rounded-2xl border border-line bg-white p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-ink">Completed comparison</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="font-medium text-copy">Insurer valuation</dt>
            <dd className="mt-1 text-base font-semibold text-ink">
              {report.conclusion.insurerValuation.formatted}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-copy">Supported midpoint</dt>
            <dd className="mt-1 text-base font-semibold text-ink">
              {range?.median.formatted ?? "Not supportable"}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-copy">Indicated difference</dt>
            <dd className="mt-1 text-base font-semibold text-ink">
              {report.conclusion.indicatedDifference?.formatted ?? "Not stated"}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-sm leading-6 text-copy">
          These are server-completed report values; Venfour does not infer a
          guaranteed settlement from advertised prices.
        </p>
      </div>
      <div className="mt-6">
        <h2 className="text-lg font-semibold text-ink">Selected market evidence</h2>
        {[market.primary, market.secondary].some(Boolean) ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {[market.primary, market.secondary].map((summary) =>
              summary ? (
                <div
                  className="rounded-2xl border border-line bg-surface/60 p-4 text-sm leading-6"
                  key={`${summary.label ?? "Evidence"}:${summary.evidenceDate ?? "undated"}`}
                >
                  <p className="font-semibold text-ink">
                    {summary.label ?? "Market evidence"} · {summary.selectedCount} selected
                  </p>
                  <p className="mt-1 text-copy">
                    {summary.description ?? "Documented in the published evidence package."}
                  </p>
                </div>
              ) : null,
            )}
          </div>
        ) : null}
        {comparables.length ? (
          <ul className="mt-4 grid gap-3 lg:grid-cols-2">
            {comparables.map((comparable, index) => (
              <li
                className="min-w-0 rounded-2xl border border-line bg-white p-4"
                key={`${comparable.vehicle ?? "Comparable"}:${comparable.evidenceDate ?? index}:${index}`}
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <p className="break-words font-semibold text-ink">
                    {comparable.vehicle ?? `Selected comparable ${index + 1}`}
                  </p>
                  <p className="shrink-0 font-semibold text-ink">
                    {comparable.advertisedPrice ?? "Price not stated"}
                  </p>
                </div>
                <p className="mt-2 text-sm leading-6 text-copy">
                  {[
                    comparable.mileage === null
                      ? null
                      : `${comparable.mileage.toLocaleString()} miles`,
                    comparable.location,
                    comparable.distanceMiles === null
                      ? null
                      : `${comparable.distanceMiles.toLocaleString()} miles away`,
                    comparable.evidenceDate,
                    comparable.temporalBasis,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm leading-6 text-copy">
            No individual market comparable could be safely displayed. The
            published package explains the available evidence.
          </p>
        )}
        {market.comparables.length > comparables.length ? (
          <p className="mt-3 text-sm leading-6 text-copy">
            The published report contains the complete selected-comparable set.
          </p>
        ) : null}
      </div>
      <div className="mt-6 rounded-2xl border border-line bg-surface/60 p-5 text-sm leading-6 text-copy">
        <p>
          {market.methodologyStatement ??
            "The completed report documents how the selected evidence was evaluated."}
        </p>
        <p className="mt-2">
          Advertised prices are evidence, not guaranteed sale prices. Location,
          listing date, equipment, condition, mileage, and available historical
          evidence can all affect relevance.
        </p>
        {report.conclusion.limitations.length ? (
          <ul className="mt-3 list-disc space-y-1 pl-5">
            {report.conclusion.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <GuideActions
        accessToken={accessToken}
        back="insurer_review"
        caseId={caseId}
        claim={claim}
        next="report"
        primaryLabel="See your report"
        progressStep="valuation"
        userId={userId}
      />
    </GuidedClaimShell>
  );
}

function ReportScreen(props: GuidedScreenProps) {
  const { accessToken, caseId, claim, report, userId } = props;
  return (
    <GuidedClaimShell
      caseId={caseId}
      description="This published package organizes the valuation, selected evidence, methodology, conclusion, and limitations for your records and insurer review."
      education={claim.education ?? null}
      eyebrow="Step 4 of 6 · Optional"
      heading="Your valuation evidence package is ready"
      view="report"
    >
      <div className="rounded-2xl border border-line bg-surface/60 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <span className="flex size-11 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <FileCheck2 className="size-5" aria-hidden />
            </span>
            <h2 className="mt-4 text-xl font-semibold text-ink">
              Venfour Total-Loss Valuation Evidence Package
            </h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium text-copy">Version</dt>
                <dd className="mt-1 text-ink">{report.versionLabel}</dd>
              </div>
              <div>
                <dt className="font-medium text-copy">Issue date</dt>
                <dd className="mt-1 text-ink">{report.issueDate}</dd>
              </div>
            </dl>
            <p className="mt-4 break-all text-xs leading-5 text-copy">
              {report.suggestedFilename}
            </p>
          </div>
          <PublishedReportActions
            accessToken={accessToken}
            caseId={caseId}
            report={report}
            userId={userId}
          />
        </div>
      </div>
      <p className="mt-5 text-sm leading-6 text-copy">
        This is a valuation evidence package. It is not described as a certified
        appraisal and does not guarantee a particular settlement.
      </p>
      <GuideActions
        accessToken={accessToken}
        back="valuation"
        caseId={caseId}
        claim={claim}
        next="what_next"
        primaryLabel="What happens after I send it?"
        progressStep="report"
        userId={userId}
      />
    </GuidedClaimShell>
  );
}

function WhatNextScreen(props: GuidedScreenProps) {
  const { accessToken, caseId, claim, userId } = props;
  const outcomes = [
    "The adjuster reconsiders the valuation or offers an increase.",
    "The adjuster asks questions about evidence or requests documents.",
    "The adjuster disputes a comparable, adjustment, or factual point.",
    "The adjuster offers a partial increase or maintains the existing value.",
    "There is no immediate response and a follow-up is needed later.",
  ];
  return (
    <GuidedClaimShell
      caseId={caseId}
      description="An evidence package can support a clearer conversation, but it cannot guarantee how an insurer will respond. Keep every written response and supporting document."
      education={claim.education ?? null}
      eyebrow="Step 5 of 6 · Optional"
      heading="What may happen next"
      view="what_next"
    >
      <ul className="grid gap-3 sm:grid-cols-2">
        {outcomes.map((outcome) => (
          <li
            className="flex gap-3 rounded-2xl border border-line bg-surface/60 p-4 text-sm leading-6 text-copy"
            key={outcome}
          >
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
            {outcome}
          </li>
        ))}
      </ul>
      <div className="mt-6 flex gap-3 rounded-2xl border border-line bg-white p-5">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
        <p className="text-sm leading-6 text-copy">
          Venfour will later help you understand an insurer response. Response
          intake is not available in this milestone, so save the response for
          the next stage.
        </p>
      </div>
      <GuideActions
        accessToken={accessToken}
        back="report"
        caseId={caseId}
        claim={claim}
        next="send"
        primaryLabel="Prepare my request"
        progressStep="what_next"
        showSkip={false}
        userId={userId}
      />
    </GuidedClaimShell>
  );
}

interface GuidedScreenProps {
  readonly accessToken: string;
  readonly caseId: string;
  readonly claim: TotalLossClaimSecured;
  readonly report: TotalLossPublishedReport;
  readonly userId: string;
}

export function GuidedExperience({
  view,
  ...props
}: GuidedScreenProps & {
  readonly view: Exclude<TotalLossClaimWorkflowView, "checkout" | "checkout_return" | "processing" | "send">;
}) {
  switch (view) {
    case "result":
      return <ResultScreen {...props} />;
    case "insurer_review":
      return <InsurerReviewScreen {...props} />;
    case "valuation":
      return <ValuationScreen {...props} />;
    case "report":
      return <ReportScreen {...props} />;
    case "what_next":
      return <WhatNextScreen {...props} />;
  }
}

export function NoDisputeExperience({
  accessToken,
  caseId,
  claim,
  report,
  userId,
}: GuidedScreenProps) {
  const refundComplete =
    claim.commerce?.entitlementStatus === "refunded_access_retained";
  const selectedMarketCount =
    (report.marketEvidence.primary?.selectedCount ?? 0) +
    (report.marketEvidence.secondary?.selectedCount ?? 0);
  return (
    <ClaimWorkflowFrame>
      <ClaimWorkflowCard>
        <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
          <FileCheck2 className="size-6" aria-hidden />
        </span>
        <p className="mt-6 text-sm font-semibold tracking-[0.12em] text-brand uppercase">
          Review complete
        </p>
        <h1 className="mt-3 max-w-4xl text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl lg:text-5xl">
          The completed review does not support asking for a higher valuation
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-copy sm:text-lg">
          Venfour did not find sufficient support for a valuation dispute. The
          evidence package remains available for your records, but no dispute
          email has been created.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <EvidenceCard
            label="Insurer valuation"
            value={<MoneyValue money={report.conclusion.insurerValuation} />}
          />
          <EvidenceCard
            label="Supported conclusion"
            value="Existing valuation reasonably supported"
          />
          <EvidenceCard
            label="Market evidence reviewed"
            value={
              selectedMarketCount
                ? `${selectedMarketCount} selected`
                : "No supportable market set"
            }
          />
          <EvidenceCard
            label="Refund status"
            value={refundComplete ? "Refunded" : "Refund in progress"}
          />
        </div>
        <div className="mt-6 rounded-2xl border border-line bg-surface/60 p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-ink">What final QA established</h2>
          <p className="mt-3 text-sm leading-6 text-copy">
            {report.conclusion.summary}
          </p>
          {report.conclusion.preliminaryComparison ? (
            <p className="mt-3 text-sm leading-6 text-copy">
              {report.conclusion.preliminaryComparison.summary}
            </p>
          ) : null}
          {report.conclusion.supportedRange ? (
            <p className="mt-3 text-sm leading-6 text-copy">
              Supported evidence range: {report.conclusion.supportedRange.low.formatted}–
              {report.conclusion.supportedRange.high.formatted}.
            </p>
          ) : null}
        </div>
        <div className="mt-6">
          <PublishedReportActions
            accessToken={accessToken}
            caseId={caseId}
            report={report}
            userId={userId}
          />
        </div>
        <p className="mt-6 flex gap-3 text-sm leading-6 text-copy">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
          The fair-result refund does not remove access to this published report.
        </p>
      </ClaimWorkflowCard>
    </ClaimWorkflowFrame>
  );
}
