import { ArrowLeft, ArrowRight, BookOpen, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useRef } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";

import type {
  TotalLossClaimSecured,
  TotalLossPublishedReport,
} from "../contracts";
import { totalLossClaimViewPath, type ReviewStage } from "../workflow-route";
import { CaseEvidence, MethodologyDisclosure } from "./case-evidence";
import { MessagePreparation } from "./message-preparation";
import { ReportFileRow } from "./published-report-actions";
import { ReviewStory } from "./review-story";
import "./guided-review.css";

interface GuidedReviewProps {
  readonly accessToken: string;
  readonly caseId: string;
  readonly claim: TotalLossClaimSecured;
  readonly onRefresh: () => Promise<unknown>;
  readonly report: TotalLossPublishedReport;
  readonly userId: string;
  readonly stage: ReviewStage;
}

const stages: ReadonlyArray<{ id: ReviewStage; label: string }> = [
  { id: "result", label: "Your result" },
  { id: "insurer", label: "Insurer valuation" },
  { id: "market", label: "Market evidence" },
  { id: "meaning", label: "The difference" },
  { id: "next", label: "Your next step" },
  { id: "request", label: "Your request" },
];

function requestIsSent(claim: TotalLossClaimSecured) {
  return (
    claim.journey?.nextState === "awaiting_insurer_response" ||
    claim.journey?.fulfillmentState === "awaiting_insurer_response" ||
    claim.workflow?.currentTask === "awaiting_insurer_response"
  );
}

function dateLabel(value: string, includeTime = false) {
  const date = new Date(includeTime ? value : `${value}T12:00:00Z`);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        ...(includeTime ? { timeStyle: "short" } : { timeZone: "UTC" }),
      }).format(date);
}

function SentReview({ claim, report, caseId }: GuidedReviewProps) {
  const sent = requestIsSent(claim);
  const sentAt = claim.education?.steps.send.completedAt;
  const supported = report.conclusion.continuingSupported;
  return (
    <>
      <section className="review-stage review-sent-stage">
        <div className="review-editorial">
          <p className="review-eyebrow">After your request</p>
          <h1 className="review-title">
            {sent
              ? "Waiting for the insurer’s response"
              : supported
                ? "Your request hasn’t been marked as sent."
                : "Your completed review is available."}
          </h1>
          <p className="review-lead">
            {sent
              ? "You’ve recorded that you sent your request with the evidence attached. Keep a copy of the email and any written reply with your claim documents."
              : supported
                ? "Your report is ready. When you send your reconsideration request from your email account, return here to record it."
                : "The completed evidence does not support a higher valuation request. You can still review and keep your report."}
          </p>
        </div>
        {sent ? (
          <details className="review-disclosure">
            <summary>What the insurer may do</summary>
            <p>
              The insurer may explain its original valuation, ask for more
              information, revise the offer, or maintain its position. A
              reconsideration request does not guarantee a change.
            </p>
            <p>
              Compare any written explanation with the evidence in your report.
              Insurer response uploads and response review are not available
              here yet.
            </p>
          </details>
        ) : null}
        <details className="review-disclosure review-records">
          <summary>Your case record</summary>
          <ol className="review-timeline" aria-label="Case timeline">
            <li>
              <h2>Evidence package completed</h2>
              <p>
                Issued{" "}
                <time dateTime={report.issueDate}>
                  {dateLabel(report.issueDate)}
                </time>{" "}
                · {report.versionLabel}
              </p>
            </li>
            {claim.messageDraft || sent ? (
              <li>
                <h2>Request prepared</h2>
                <p>
                  {claim.messageDraft
                    ? "Your saved request is available to review."
                    : "Your request was prepared before it was marked as sent."}
                </p>
              </li>
            ) : null}
            {sent ? (
              <li>
                <h2>Request marked as sent</h2>
                <p>
                  Confirmed by you with the report attached.
                  {sentAt ? (
                    <>
                      {" "}
                      <time dateTime={sentAt}>{dateLabel(sentAt, true)}</time>.
                    </>
                  ) : null}
                </p>
              </li>
            ) : null}
          </ol>
        </details>
        {sent ? (
          <p className="review-note">
            Venfour cannot verify email delivery or whether the insurer has read
            your request.
          </p>
        ) : null}
      </section>
      <footer className="review-actions">
        <Link
          className="case-button"
          data-variant="text"
          to={totalLossClaimViewPath(caseId, "review_result")}
        >
          <ArrowLeft aria-hidden />
          Review the evidence
        </Link>
        <Link
          className="case-button"
          data-variant="primary"
          to={
            sent || !supported
              ? "/appraisals"
              : totalLossClaimViewPath(caseId, "review_request")
          }
        >
          {sent || !supported ? "My appraisals" : "Prepare request"}
          <ArrowRight aria-hidden />
        </Link>
      </footer>
    </>
  );
}

export function GuidedReview(props: GuidedReviewProps) {
  const { caseId, claim, report, stage } = props;
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedDetail = searchParams.get("details");
  const detail =
    requestedDetail === "market" ||
    requestedDetail === "insurer" ||
    requestedDetail === "report"
      ? requestedDetail
      : null;
  const contentRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const utilityRef = useRef<HTMLAnchorElement>(null);
  const previousStage = useRef(stage);
  const index = stages.findIndex((item) => item.id === stage);
  const supported = report.conclusion.continuingSupported;
  const count = supported ? 6 : 5;
  const current = stages[index];

  useEffect(() => {
    if (previousStage.current !== stage) {
      previousStage.current = stage;
      const heading = contentRef.current?.querySelector("h1");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
  }, [stage]);

  const detailSearch = (next: "market" | "insurer" | "report") => {
    const params = new URLSearchParams(searchParams);
    params.set("details", next);
    return `?${params.toString()}`;
  };
  const detailState = { reviewDetailsFrom: location.pathname };
  const rememberFocus = () => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  };
  const openDetails = (next: "market" | "insurer" | "report") => {
    rememberFocus();
    navigate({ search: detailSearch(next) }, { state: detailState });
  };
  const closeDetails = () => {
    if (location.state?.reviewDetailsFrom === location.pathname) {
      navigate(-1);
    } else {
      const params = new URLSearchParams(searchParams);
      params.delete("details");
      setSearchParams(params, { replace: true });
    }
  };
  const finish = stage === "next" && !supported;
  const nextStage = stages[index + 1]?.id;

  return (
    <section
      className="guided-review"
      aria-label="Your guided valuation review"
    >
      <div className="review-container">
        <header className="review-context">
          <div className="review-vehicle">
            <p>{report.subjectVehicle.description ?? "Your vehicle"}</p>
          </div>
          <Link
            ref={utilityRef}
            className="review-library-link"
            to={{ search: detailSearch("report") }}
            state={detailState}
            onClick={rememberFocus}
          >
            <BookOpen aria-hidden />
            Evidence &amp; report
          </Link>
        </header>
        <div className="review-position" aria-label="Review progress">
          <span>{current?.label ?? "Your request status"}</span>
          {index >= 0 && index < count ? (
            <>
              <span className="review-position-count">
                {index + 1} of {count}
              </span>
            </>
          ) : null}
        </div>
        {claim.journey?.fulfillmentState === "refund_pending" ||
        claim.commerce?.entitlementStatus === "refunded_access_retained" ? (
          <p className="review-account-note">
            <strong>
              {claim.commerce?.entitlementStatus === "refunded_access_retained"
                ? "Refunded"
                : "Refund in progress"}
            </strong>{" "}
            · Your completed report remains available.
          </p>
        ) : null}
        <div ref={contentRef} className="review-stage-content" key={stage}>
          {stage === "request" ? (
            supported || requestIsSent(claim) ? (
              <MessagePreparation
                {...props}
                backTo={totalLossClaimViewPath(caseId, "review_next")}
              />
            ) : (
              <>
                <section className="review-stage">
                  <p className="review-eyebrow">Your completed review</p>
                  <h1 className="review-title">
                    A reconsideration request is not supported.
                  </h1>
                  <p className="review-lead">
                    The completed evidence does not support a higher valuation
                    request. Your report explains the conclusion and remains
                    available to you.
                  </p>
                </section>
                <footer className="review-actions">
                  <Link
                    className="case-button"
                    data-variant="text"
                    to={totalLossClaimViewPath(caseId, "review_next")}
                  >
                    Back
                  </Link>
                  <Link
                    className="case-button"
                    data-variant="primary"
                    to="/appraisals"
                  >
                    My appraisals
                    <ArrowRight aria-hidden />
                  </Link>
                </footer>
              </>
            )
          ) : stage === "sent" ? (
            <SentReview {...props} />
          ) : (
            <>
              <ReviewStory
                report={report}
                stage={stage}
                onEvidence={openDetails}
                onReport={() => openDetails("report")}
              />
              <footer className="review-actions" aria-label="Review navigation">
                {index > 0 ? (
                  <Link
                    className="case-button"
                    data-variant="text"
                    to={totalLossClaimViewPath(
                      caseId,
                      `review_${stages[index - 1].id}`,
                    )}
                  >
                    <ArrowLeft aria-hidden />
                    Back
                  </Link>
                ) : null}
                <div className="review-continue-group">
                  <Link
                    className="case-button"
                    data-variant="primary"
                    to={
                      finish
                        ? "/appraisals"
                        : totalLossClaimViewPath(
                            caseId,
                            `review_${nextStage ?? "request"}`,
                          )
                    }
                  >
                    {finish ? "My appraisals" : "Continue"}
                    <ArrowRight aria-hidden />
                  </Link>
                </div>
              </footer>
            </>
          )}
        </div>
      </div>
      <Dialog.Root
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) closeDetails();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="review-details-overlay" />
          <Dialog.Content
            className="review-details-drawer"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              (returnFocusRef.current?.isConnected
                ? returnFocusRef.current
                : utilityRef.current
              )?.focus();
            }}
          >
            <header className="review-details-header">
              <div>
                <p className="review-eyebrow">A closer look</p>
                <Dialog.Title>
                  {detail === "report"
                    ? "Your valuation report"
                    : "Your supporting evidence"}
                </Dialog.Title>
              </div>
              <Dialog.Close className="review-close" aria-label="Close details">
                <X aria-hidden />
              </Dialog.Close>
            </header>
            <Dialog.Description className="review-details-description">
              Explore the details at your own pace. Close this view to continue
              where you left off.
            </Dialog.Description>
            <div className="review-details-body">
              {detail === "report" ? (
                <>
                  <ReportFileRow {...props} />
                  <p className="review-copy">
                    The report brings together the insurer’s valuation, selected
                    market evidence, and the basis and limitations of the
                    completed review. Download this PDF to attach to your
                    reconsideration email.
                  </p>
                  <div className="review-evidence-choices">
                    <button
                      type="button"
                      className="review-detail-button"
                      onClick={() =>
                        setSearchParams(detailSearch("insurer"), {
                          replace: true,
                          state: location.state,
                        })
                      }
                    >
                      Insurer comparables
                      <ArrowRight aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="review-detail-button"
                      onClick={() =>
                        setSearchParams(detailSearch("market"), {
                          replace: true,
                          state: location.state,
                        })
                      }
                    >
                      Selected market listings
                      <ArrowRight aria-hidden />
                    </button>
                  </div>
                  <MethodologyDisclosure report={report} />
                </>
              ) : detail ? (
                <>
                  <CaseEvidence
                    report={report}
                    view={detail}
                    headingLevel={2}
                    onViewChange={(next) =>
                      setSearchParams(detailSearch(next), {
                        replace: true,
                        state: location.state,
                      })
                    }
                  />
                  <ReportFileRow {...props} />
                </>
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
