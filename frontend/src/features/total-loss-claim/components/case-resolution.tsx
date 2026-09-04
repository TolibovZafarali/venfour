import { useRef, useState } from "react";
import { Link } from "react-router";

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
  const acceptedOfferSource = resolution.amountSource === "CUSTOMER_RECORDED" || resolution.amountSource === "RESPONSE_TEXT"
    ? resolution.amountSource
    : null;
  return <section className="case-resolution-banner" aria-label="Recorded case outcome">
    <h2>{resolution.code === "CUSTOMER_STOPPED_PURSUING" || resolution.code === "NO_DISPUTE_SUPPORTED" ? "Case closed" : "Case resolved"}</h2>
    <p><strong>{resolutionOutcome(resolution.code)}</strong> · <RecordedTime value={resolution.resolvedAt} /></p>
    {resolution.amountMinorUnits !== null && resolution.currency ? <p className="case-resolution-amount">
      {resolutionAmount(resolution.amountMinorUnits, resolution.currency)} {resolution.currency}
      <span>{acceptedOfferSource
        ? `${insurerOfferProvenanceLabel(acceptedOfferSource)} · exact saved offer · acceptance confirmed by you`
        : "Final amount reported by you"}</span>
    </p> : null}
    <p>{resolution.code === "CUSTOMER_STOPPED_PURSUING" ? "You confirmed that you are no longer pursuing this case. This does not record a settlement with your insurer." : resolution.customerConfirmed ? "You confirmed this outcome. Closing the Venfour case did not contact your insurer." : "The completed review did not support a valuation dispute."} Your report and saved case history remain available to review.</p>
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

function ClosureConfirmation({ accepted = false, ...props }: ResolutionIdentity & { readonly accepted?: boolean }) {
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

  return <form className="case-closure-confirmation" aria-label={accepted ? "Confirm accepted offer" : "Choose case outcome"} onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
    {accepted && acceptedOffer ? <>
      <h2>Confirm that you accepted this offer</h2>
      <p>You accepted <strong>{resolutionAmount(acceptedOffer.offer.amountMinorUnits, acceptedOffer.offer.currency)} {acceptedOffer.offer.currency}</strong> with your insurer. This confirmation will resolve your Venfour case and keep its records available to review.</p>
    </> : <>
      <fieldset disabled={pending || Boolean(attempt)}>
        <legend>How would you like to close this case?</legend>
        <label className="case-closure-choice"><input type="radio" name="resolution-outcome" checked={outcome === "RESOLVED_WITH_INSURER"} onChange={() => setOutcome("RESOLVED_WITH_INSURER")} />Resolved with insurer</label>
        <label className="case-closure-choice"><input type="radio" name="resolution-outcome" checked={outcome === "CUSTOMER_STOPPED_PURSUING"} onChange={() => setOutcome("CUSTOMER_STOPPED_PURSUING")} />I’m no longer pursuing this</label>
        {outcome === "RESOLVED_WITH_INSURER" ? <label className="case-closure-amount">Final amount ({currency}, optional)
          <input inputMode="decimal" type="text" value={amount} onChange={(event) => setAmount(event.target.value)} aria-describedby="case-closure-amount-note" />
          <span id="case-closure-amount-note">This amount is your report of the outcome. It does not replace saved insurer material or change the valuation.</span>
        </label> : <p>This closes your Venfour case without recording a settlement with your insurer.</p>}
      </fieldset>
    </>}
    <p>Your case will become read-only. Your documents and history stay available. This does not send anything to your insurer.</p>
    {error ? <p className="request-error" role="alert">{error}</p> : null}
    <button className="request-button request-button-primary" disabled={pending || stale} type="submit">{pending ? "Confirming outcome…" : attempt ? "Retry closure confirmation" : accepted ? "Confirm accepted and resolve case" : "Confirm and close case"}</button>
    {stale ? <button className="request-button request-button-secondary" type="button" onClick={() => void props.onRefresh()}>Refresh case</button> : null}
  </form>;
}

export function AcceptedOfferFinalization(props: ResolutionIdentity) {
  const [confirming, setConfirming] = useState(false);
  const acceptedOffer = currentAcceptedOffer(props.claim);
  if (!acceptedOffer) return null;
  return <section className="case-finalization" aria-label="Complete acceptance with your insurer">
    <h1>Complete acceptance with your insurer</h1>
    <p className="review-lead">Your decision to accept is saved. Complete the acceptance with your insurer first, then confirm the outcome here.</p>
    <dl className="case-finalization-offer"><dt>{insurerOfferProvenanceLabel(acceptedOffer.offer.source)}</dt><dd>{resolutionAmount(acceptedOffer.offer.amountMinorUnits, acceptedOffer.offer.currency)} {acceptedOffer.offer.currency}</dd></dl>
    <p>Your saved decision applies to this exact offer. Your case remains open until you explicitly confirm. Venfour does not communicate acceptance to your insurer.</p>
    <Link to={totalLossClaimViewPath(props.caseId, "review_response_reviewed")}>Review the offer, recommendation, and your decision</Link>
    {confirming ? <ClosureConfirmation {...props} accepted /> : <button className="request-button request-button-primary" type="button" disabled={!canCloseCase(props.claim)} onClick={() => setConfirming(true)}>I accepted this offer with my insurer</button>}
    {confirming ? <button className="case-close-trigger" type="button" onClick={() => setConfirming(false)}>Back to acceptance instructions</button> : null}
  </section>;
}

export function ManualCaseClosure(props: ResolutionIdentity) {
  const [open, setOpen] = useState(false);
  if (!canCloseCase(props.claim)) return null;
  return <section className="case-manual-closure" aria-label="Close your case">
    <button className="case-close-trigger" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Cancel closing case" : "Close case"}</button>
    {open ? <ClosureConfirmation {...props} /> : null}
  </section>;
}
