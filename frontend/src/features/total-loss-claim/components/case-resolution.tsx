import { ArrowRight, Check, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Dialog } from "radix-ui";

import { ApiError } from "@/lib/api/client";
import type { TotalLossCaseResolution, TotalLossCaseResolutionInput, TotalLossClaimSecured } from "../contracts";
import { useTotalLossCaseResolutionMutation } from "../queries";
import {
  canCloseCase,
  currentAcceptedOffer,
  insurerOfferProvenanceLabel,
  resolutionAmount,
  resolutionOutcome,
} from "../resolution";
import { totalLossClaimViewPath } from "../workflow-route";
import { RecordedTime } from "./completed-analysis-visuals";
import { MessageStepHeading } from "./message-step-heading";
import "./case-resolution.css";

interface ResolutionIdentity {
  readonly accessToken: string;
  readonly caseId: string;
  readonly claim: TotalLossClaimSecured;
  readonly userId: string;
  readonly onRefresh: () => Promise<unknown>;
  readonly onClosed: () => void;
}

export function CaseResolutionBanner({ resolution }: { readonly resolution: TotalLossCaseResolution }) {
  const accepted = resolution.code === "ACCEPTED_VERIFIED_OFFER";
  const hasAmount = (accepted || resolution.code === "RESOLVED_WITH_INSURER") && resolution.amountMinorUnits !== null && Boolean(resolution.currency);
  const source = resolution.amountSource === "CUSTOMER_RECORDED"
    ? "Offer amount entered by you"
    : resolution.amountSource === "RESPONSE_TEXT" ? "Offer shown in your insurer’s reply" : null;
  const confirmation = resolution.customerConfirmed ? accepted ? "Acceptance confirmed by you" : "Outcome confirmed by you" : null;
  const detail = accepted ? [source, confirmation].filter(Boolean).join(" · ")
    : resolution.code === "RESOLVED_WITH_INSURER" && hasAmount ? "Final amount reported by you" : confirmation;
  return <section className="case-resolution-banner" aria-label="Recorded case outcome">
    <div className="case-resolution-heading">
      <h2><Check aria-hidden="true" />Case closed</h2>
      <RecordedTime value={resolution.resolvedAt} dateOnly />
    </div>
    {hasAmount ? <p className="case-resolution-amount">
      {resolutionAmount(resolution.amountMinorUnits!, resolution.currency!)} <span>{resolution.currency}</span>
    </p> : null}
    <p className="case-resolution-outcome" data-with-amount={hasAmount}>{accepted ? "Offer you accepted" : resolutionOutcome(resolution.code)}</p>
    {detail ? <p className="case-resolution-source">{detail}</p> : null}
    <p className="case-resolution-availability">Your documents and case history remain available.</p>
  </section>;
}

function storedAttempt(key: string): TotalLossCaseResolutionInput | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const item = value as Record<string, unknown>;
    if (Object.keys(item).sort().join(",") !== "amountMinorUnits,clientRequestId,currency,decisionId,offerId,resolutionCode,workflowRevision" ||
      !["ACCEPTED_VERIFIED_OFFER", "RESOLVED_WITH_INSURER", "CUSTOMER_STOPPED_PURSUING"].includes(String(item.resolutionCode)) ||
      typeof item.clientRequestId !== "string" || !/^[a-f0-9-]{36}$/iu.test(item.clientRequestId) ||
      !Number.isSafeInteger(item.workflowRevision)) return null;
    return item as unknown as TotalLossCaseResolutionInput;
  } catch { return null; }
}

function ClosureConfirmation({ accepted = false, onBack, ...props }: ResolutionIdentity & { readonly accepted?: boolean; readonly onBack?: () => void }) {
  const { claim, caseId, userId } = props;
  const acceptedOffer = currentAcceptedOffer(claim);
  const key = `venfour:case-resolution:v1:${userId}:${caseId}:${claim.workflow?.revision}:${accepted ? "accept" : "manual"}`;
  const [attempt, setAttempt] = useState(() => storedAttempt(key));
  const attemptRef = useRef(attempt);
  const [outcome, setOutcome] = useState<"RESOLVED_WITH_INSURER" | "CUSTOMER_STOPPED_PURSUING">(attempt?.resolutionCode === "CUSTOMER_STOPPED_PURSUING" ? "CUSTOMER_STOPPED_PURSUING" : "RESOLVED_WITH_INSURER");
  const [amount, setAmount] = useState(attempt?.amountMinorUnits != null ? (attempt.amountMinorUnits / 100).toFixed(2) : "");
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const locked = useRef(false);
  const mutation = useTotalLossCaseResolutionMutation(props);
  const currency = claim.report?.conclusion.insurerValuation.currency ?? "USD";
  const pending = mutation.isPending || confirmed;

  const confirm = async () => {
    if (locked.current || stale || confirmed || !canCloseCase(claim) || !claim.workflow || (accepted && !acceptedOffer)) return;
    const cents = amount.trim() ? Math.round(Number(amount) * 100) : null;
    if (!accepted && outcome === "RESOLVED_WITH_INSURER" && amount.trim() &&
      (!/^\d+(?:\.\d{1,2})?$/u.test(amount.trim()) || !Number.isSafeInteger(cents) || cents! <= 0)) {
      setError("Enter a valid amount with up to two decimal places, or leave the amount blank.");
      return;
    }
    const input: TotalLossCaseResolutionInput = attemptRef.current ?? {
      clientRequestId: crypto.randomUUID(), workflowRevision: claim.workflow.revision,
      resolutionCode: accepted ? "ACCEPTED_VERIFIED_OFFER" : outcome,
      decisionId: accepted ? acceptedOffer!.decision.decisionId : null,
      offerId: accepted ? acceptedOffer!.offer.offerId : null,
      amountMinorUnits: !accepted && outcome === "RESOLVED_WITH_INSURER" ? cents : null,
      currency: !accepted && outcome === "RESOLVED_WITH_INSURER" && cents !== null ? currency : null,
    };
    attemptRef.current = input;
    setAttempt(input);
    try { sessionStorage.setItem(key, JSON.stringify(input)); } catch { /* Retries retain the same request while this page is open. */ }
    locked.current = true;
    setError(null);
    try {
      await mutation.mutateAsync(input);
      setConfirmed(true);
      try { sessionStorage.removeItem(key); } catch { /* The recorded server outcome remains authoritative. */ }
      props.onClosed();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 400) {
        attemptRef.current = null;
        setAttempt(null);
        try { sessionStorage.removeItem(key); } catch { /* A corrected input will replace the stored attempt. */ }
        setError("Check the amount and selected outcome, then confirm again.");
      } else if (failure instanceof ApiError && failure.status === 409) {
        setStale(true);
        setError("Your case changed or another step is still being saved. Refresh the case and review its current outcome before confirming again.");
      } else {
        setError("We couldn’t confirm closure. Retry this same confirmation; Venfour will preserve a closure that was already recorded.");
      }
      await props.onRefresh().catch(() => undefined);
    } finally { locked.current = false; }
  };

  return <form className={`case-closure-confirmation${accepted ? " acceptance-confirmation" : ""}`} aria-label={accepted ? "Confirm accepted offer" : "Choose case outcome"} onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
    {accepted && acceptedOffer ? <>
      <p>You’re confirming that you accepted <strong>{resolutionAmount(acceptedOffer.offer.amountMinorUnits, acceptedOffer.offer.currency)} {acceptedOffer.offer.currency}</strong> with your insurer.</p>
    </> : <>
      <fieldset disabled={pending || Boolean(attempt)}>
        <legend>How did your case end?</legend>
        <label className="case-closure-choice" data-selected={outcome === "RESOLVED_WITH_INSURER"}><input type="radio" name="resolution-outcome" aria-label="Resolved with insurer" checked={outcome === "RESOLVED_WITH_INSURER"} onChange={() => setOutcome("RESOLVED_WITH_INSURER")} /><span>Resolved with insurer<small>We agreed on an outcome outside Venfour.</small></span></label>
        <label className="case-closure-choice" data-selected={outcome === "CUSTOMER_STOPPED_PURSUING"}><input type="radio" name="resolution-outcome" aria-label="I’m no longer pursuing this" checked={outcome === "CUSTOMER_STOPPED_PURSUING"} onChange={() => setOutcome("CUSTOMER_STOPPED_PURSUING")} /><span>I’m no longer pursuing this<small>Close my case without recording a settlement.</small></span></label>
        {outcome === "RESOLVED_WITH_INSURER" ? <label className="case-closure-amount">Final amount ({currency}, optional)
          <input inputMode="decimal" type="text" value={amount} onChange={(event) => setAmount(event.target.value)} aria-describedby="case-closure-amount-note" />
          <span id="case-closure-amount-note">Saved as an amount reported by you. Your original valuation stays unchanged.</span>
        </label> : <p>This closes your Venfour case without recording a settlement with your insurer.</p>}
      </fieldset>
    </>}
    <p>{accepted ? "Closing your Venfour case saves this outcome. Your documents and history stay available to read. Nothing is sent to your insurer." : "Your documents and history stay available. Closing your case won’t send anything to your insurer."}</p>
    {error ? <p className="request-error" role="alert">{error}</p> : null}
    <div className="acceptance-confirmation-actions">
    {accepted && onBack ? <button className="request-button request-button-text" type="button" disabled={pending || Boolean(attempt)} onClick={onBack}>Not yet</button> : null}
    <button className="request-button request-button-primary" disabled={pending || stale} type="submit">{pending ? "Confirming outcome…" : attempt ? "Retry closure confirmation" : accepted ? "Close my Venfour case" : "Confirm and close case"}{accepted ? <Check aria-hidden="true" /> : null}</button>
    {stale ? <button className="request-button request-button-secondary" type="button" onClick={() => void props.onRefresh()}>Refresh case</button> : null}
    </div>
  </form>;
}

export function AcceptedOfferFinalization(props: ResolutionIdentity) {
  const [differentOutcome, setDifferentOutcome] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(() => storedAttempt(`venfour:case-resolution:v1:${props.userId}:${props.caseId}:${props.claim.workflow?.revision}:accept`) ? 3 : 1);
  const acceptedOffer = currentAcceptedOffer(props.claim);
  const resolution = props.claim.resolution?.code === "ACCEPTED_VERIFIED_OFFER" ? props.claim.resolution : null;
  const closed = Boolean(resolution);
  const activeHeading = useRef<HTMLHeadingElement>(null);
  const recordLink = useRef<HTMLAnchorElement>(null);
  useLayoutEffect(() => {
    if (closed) recordLink.current?.focus({ preventScroll: true });
    else if (step > 1) {
      activeHeading.current?.focus({ preventScroll: true });
      activeHeading.current?.scrollIntoView?.({ block: "nearest", behavior: "instant" });
    }
  }, [step, closed]);
  if (!acceptedOffer && !resolution) return null;
  const amount = resolution ? resolution.amountMinorUnits : acceptedOffer!.offer.amountMinorUnits;
  const currency = resolution ? resolution.currency : acceptedOffer!.offer.currency;
  const source = resolution ? resolution.amountSource : acceptedOffer!.offer.source;
  const amountLabel = amount !== null && currency ? `${resolutionAmount(amount, currency)} ${currency}` : "Amount not recorded";
  const provenance = source === "CUSTOMER_RECORDED" || source === "RESPONSE_TEXT" ? insurerOfferProvenanceLabel(source) : "Saved insurer offer";
  return <section className="case-finalization acceptance-flow" aria-label="Confirm acceptance">
    <header className="request-heading" data-review-entrance="primary">
      <h1>Confirm acceptance</h1>
      <p>{closed ? "Your acceptance is recorded. Your documents and case history are still here." : "Complete acceptance with your insurer, then confirm it here to close your Venfour case."}</p>
    </header>
    <div className="message-flow" role="list" aria-label="Acceptance steps">
      <section className="message-flow-step" role="listitem" data-state={closed || step > 1 ? "complete" : "active"} aria-current={!closed && step === 1 ? "step" : undefined}>
        <MessageStepHeading number={1} title="Review your offer" state={closed || step > 1 ? "complete" : "active"} description={closed || step > 1 ? amountLabel : undefined} />
        <div className="message-flow-content">
          {!closed && step === 1 ? <dl className="acceptance-offer"><dt>{provenance}</dt><dd>{amountLabel}</dd></dl> : <p className="acceptance-source">{provenance}{closed ? " · acceptance confirmed by you" : ""}</p>}
          {!closed && step === 1 ? <>
            <p className="message-send-instructions">This is the offer you chose to accept. Your case remains open until you explicitly confirm acceptance below.</p>
            <Link className="acceptance-review-link" to={totalLossClaimViewPath(props.caseId, "review_response_reviewed")}>Revisit your response review</Link>
            <ManualCaseClosure {...props} embedded triggerLabel="Record a different outcome" onOpenChange={setDifferentOutcome} />
            {!differentOutcome ? <div className="message-local-actions"><button className="request-button request-button-secondary" type="button" onClick={() => setStep(2)}>Review acceptance steps <ArrowRight aria-hidden="true" /></button></div> : null}
          </> : null}
        </div>
      </section>
      <section className="message-flow-step" role="listitem" data-state={closed || step > 2 ? "complete" : step === 2 ? "active" : "upcoming"} aria-current={!closed && step === 2 ? "step" : undefined}>
        <MessageStepHeading number={2} title="Accept with your insurer" state={closed || step > 2 ? "complete" : step === 2 ? "active" : "upcoming"} headingRef={step === 2 ? activeHeading : undefined} description={closed || step > 2 ? "You confirmed completing acceptance with your insurer." : step === 1 ? "Contact your insurer to complete acceptance." : undefined} />
        {!closed && step === 2 ? <div className="message-flow-content">
          <p className="message-send-instructions">Contact your insurer to complete acceptance of this offer. Choosing to accept in Venfour doesn’t notify them.</p>
          <p className="message-send-instructions">Follow the steps your insurer provides and keep their written confirmation. Come back here once you’ve completed acceptance.</p>
          <div className="message-local-actions"><button className="request-button request-button-secondary" type="button" disabled={!canCloseCase(props.claim)} onClick={() => setStep(3)}>I accepted this offer with my insurer <Check aria-hidden="true" /></button></div>
        </div> : null}
      </section>
      <section className="message-flow-step" role="listitem" data-state={closed ? "complete" : step === 3 ? "active" : "upcoming"} aria-current={!closed && step === 3 ? "step" : undefined}>
        <MessageStepHeading number={3} title={closed ? "Case closed" : "Confirm and close your case"} state={closed ? "complete" : step === 3 ? "active" : "upcoming"} headingRef={step === 3 ? activeHeading : undefined} description={!closed && step < 3 ? "Save the outcome and keep your records." : undefined} />
        {resolution ? <div className="message-flow-content">
          <p className="message-send-instructions" role="status">You confirmed accepting {amountLabel} with your insurer. Your Venfour case is now closed.</p>
          <p className="acceptance-source">Recorded <RecordedTime value={resolution.resolvedAt} /></p>
          <p className="message-send-instructions">Your documents and history stay available to read. Closing your case did not contact your insurer.</p>
        </div> : step === 3 ? <div className="message-flow-content"><ClosureConfirmation {...props} accepted onBack={() => setStep(2)} /></div> : null}
      </section>
    </div>
    {closed ? <div className="acceptance-record-action"><Link className="review-primary" ref={recordLink} to={`${totalLossClaimViewPath(props.caseId, "review_resolution")}?view=record`}>View my case record <ArrowRight aria-hidden="true" /></Link></div> : null}
  </section>;
}

export function ManualCaseClosure({ triggerLabel = "Close case", embedded = false, onOpenChange, ...props }: ResolutionIdentity & {
  readonly triggerLabel?: string;
  readonly embedded?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!canCloseCase(props.claim)) return null;
  return <section className={`case-manual-closure${embedded ? " case-manual-closure-embedded" : ""}`} aria-label="Close your case">
    <button className="case-close-trigger" type="button" aria-expanded={open} onClick={() => { setOpen(!open); onOpenChange?.(!open); }}>{open ? embedded ? "Back to this offer" : "Keep case open" : triggerLabel}</button>
    {open ? <ClosureConfirmation {...props} /> : null}
  </section>;
}

export function CaseClosureDialog({ onDismiss, ...props }: ResolutionIdentity & { readonly onDismiss: () => void }) {
  return <Dialog.Root open={canCloseCase(props.claim)} onOpenChange={(open) => { if (!open) onDismiss(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="case-history-overlay" />
      <Dialog.Content className="case-closure-dialog" onCloseAutoFocus={(event) => {
        event.preventDefault();
        document.querySelector<HTMLButtonElement>('header button[aria-label^="Account for "]')?.focus();
      }}>
        <div className="case-closure-dialog-heading"><Dialog.Title>Close your Venfour case</Dialog.Title><Dialog.Close className="case-history-close" aria-label="Keep case open"><X aria-hidden="true" /></Dialog.Close></div>
        <Dialog.Description>Only close your case when you’re finished. Your documents and history will remain available.</Dialog.Description>
        <ClosureConfirmation {...props} />
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
