import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { FreeValuationProcessingContext, InlineValuationProcessingContext } from "./free-valuation-processing-context";
import type { FreeValuationProcessingOptions } from "./free-valuation-processing-context";
import { ValuationSignalField } from "./valuation-signal-field";
import venfourMark from "../../../../../assets/brand/venfour-mark.svg";
import "./free-valuation-processing.css";

const reviewActivities = [
  "Finding comparables",
  "Checking vehicle details",
  "Comparing mileage & trim",
  "Reviewing market evidence",
  "Preparing your valuation",
];

interface Presentation {
  owner: symbol;
  options: FreeValuationProcessingOptions;
  exiting: boolean;
}

// The shell owns this surface so intake and analysis can hand it off without remounting.
export function FreeValuationProcessingProvider({ children, accountControl, inline = false }: { children: ReactNode; accountControl?: ReactNode; inline?: boolean }) {
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const ownerRef = useRef<symbol | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearTimers = useCallback(() => {
    clearTimeout(exitTimer.current);
  }, []);
  const show = useCallback((owner: symbol, options: FreeValuationProcessingOptions) => {
    clearTimers();
    ownerRef.current = owner;
    setPresentation((current) => ({
      owner,
      options: {
        ...options,
        vehicle: options.vehicle ?? (options.reviewKey && options.reviewKey === current?.options.reviewKey ? current.options.vehicle : undefined),
      },
      exiting: false,
    }));
  }, [clearTimers]);
  const hide = useCallback((owner: symbol) => {
    if (ownerRef.current !== owner) return;
    clearTimers();
    // Layout-phase handoffs replace this state in the same commit. A settled
    // page becomes accessible immediately while the decorative exit continues.
    setPresentation((current) => current?.owner === owner ? { ...current, exiting: true } : current);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    exitTimer.current = setTimeout(() => {
      if (ownerRef.current !== owner) return;
      ownerRef.current = null;
      setPresentation(null);
    }, reduced ? 0 : 1800);
  }, [clearTimers]);
  useEffect(() => clearTimers, [clearTimers]);
  const context = useMemo(() => ({ show, hide, inline }), [show, hide, inline]);
  const displayInline = inline && !presentation?.options.fullScreen;

  return (
    <FreeValuationProcessingContext.Provider value={context}>
      <InlineValuationProcessingContext.Provider value={displayInline && presentation && !presentation.exiting ? presentation.options : null}>
      <div
        inert={Boolean(!displayInline && presentation && !presentation.exiting)}
        aria-hidden={!displayInline && presentation && !presentation.exiting ? true : undefined}
        style={{ visibility: !displayInline && presentation && !presentation.exiting ? "hidden" : undefined }}
      >
        {children}
      </div>
      {!displayInline && presentation ? createPortal(
        <ProcessingEnvironment options={presentation.options} exiting={presentation.exiting} accountControl={accountControl} />,
        document.body,
      ) : null}
      </InlineValuationProcessingContext.Provider>
    </FreeValuationProcessingContext.Provider>
  );
}

export function FreeValuationProcessing({ reviewKey, heading, description, phase = "reviewing", vehicle, notice, error, onRetry, retryDisabled, development, fullScreen }: FreeValuationProcessingOptions) {
  const context = useContext(FreeValuationProcessingContext);
  const [owner] = useState(() => Symbol("valuation-processing"));
  useLayoutEffect(() => {
    context?.show(owner, { reviewKey, heading, description, phase, vehicle, notice, error, onRetry, retryDisabled, development, fullScreen });
  }, [context, owner, reviewKey, heading, description, phase, vehicle, notice, error, onRetry, retryDisabled, development, fullScreen]);
  useLayoutEffect(() => () => context?.hide(owner), [context, owner]);
  return null;
}

export function InlineValuationProcessingBoundary({ children }: { children: ReactNode }) {
  const options = useContext(InlineValuationProcessingContext);
  return <>
    <div hidden={Boolean(options)} inert={Boolean(options)}>{children}</div>
    {options ? <WorkspaceProcessing options={options} /> : null}
  </>;
}

function WorkspaceProcessing({ options }: { options: FreeValuationProcessingOptions }) {
  const { heading, description, phase, error, onRetry, retryDisabled, notice } = options;
  return <section className="workspace-stage workspace-processing" aria-busy={!error || undefined}>
    <p className="workspace-stage__eyebrow">{error ? "Your appraisal is saved" : "Your valuation review"}</p>
    <h1 className="workspace-stage__heading">{error ? "Let’s try again" : heading ?? (phase === "reviewing" ? "Reviewing your vehicle." : phase === "preparing" ? "Preparing your details." : "Opening your saved review.")}</h1>
    <p className="workspace-stage__description" role={error ? "alert" : "status"}>{error || description || "Your progress is saved. You can safely leave and pick up here later."}</p>
    {!error ? <div className="workspace-processing__line" aria-hidden /> : onRetry ? <button className="free-valuation-processing__retry" type="button" onClick={onRetry} disabled={retryDisabled}>Try again</button> : null}
    {notice ? <p className="workspace-report-status" role="status">{notice}</p> : null}
  </section>;
}

function ProcessingEnvironment({ options, exiting, accountControl }: { options: FreeValuationProcessingOptions; exiting: boolean; accountControl?: ReactNode }) {
  const { heading, description, phase = "reviewing", notice, error, onRetry, retryDisabled, development } = options;
  const [particlesSettled, setParticlesSettled] = useState(Boolean(error));
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setParticlesSettled(Boolean(error)), error && !reduced ? 1800 : 0);
    return () => window.clearTimeout(timer);
  }, [error]);
  const [activity, setActivity] = useState(0);
  const [gatheringReplay, setGatheringReplay] = useState(0);
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const priorFocus = document.activeElement;
    const surface = surfaceRef.current;
    surface?.focus({ preventScroll: true });
    return () => {
      if (document.activeElement !== document.body && !surface?.contains(document.activeElement)) return;
      const target = priorFocus instanceof HTMLElement && priorFocus !== document.body && priorFocus.isConnected
        ? priorFocus
        : document.getElementById("main-content");
      target?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (exiting && (document.activeElement === document.body || surfaceRef.current?.contains(document.activeElement))) {
      document.getElementById("main-content")?.focus({ preventScroll: true });
    }
  }, [exiting]);

  useEffect(() => {
    if (phase !== "reviewing" || error || exiting) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setActivity((current) => (current + 1) % reviewActivities.length);
    }, 6800);
    return () => window.clearInterval(timer);
  }, [phase, error, exiting]);

  const message = error ? "Let’s try again" : heading ?? (phase === "preparing"
    ? "Preparing your details"
    : phase === "connecting" ? "Connecting to your review"
    : phase === "opening" ? "Opening your valuation"
    : reviewActivities[activity]);

  return (
    <div
      ref={surfaceRef}
      className="free-valuation-processing"
      data-free-valuation-processing
      data-phase={phase}
      data-needs-action={Boolean(error || notice) || undefined}
      data-exiting={exiting || undefined}
      aria-hidden={exiting || undefined}
      tabIndex={-1}
    >
      {!error || !particlesSettled ? <ValuationSignalField key={gatheringReplay} exiting={exiting || Boolean(error)} /> : null}
      <div className="free-valuation-processing__masthead">
        <a className="free-valuation-processing__brand notranslate" href="/" aria-label="Venfour home" translate="no">
          <img src={venfourMark} alt="" aria-hidden />
          <span className="font-brand">Venfour</span>
        </a>
        {development ? <div className="free-valuation-processing__development">
          <span>Synthetic preview</span>
          <button type="button" onClick={() => setGatheringReplay((current) => current + 1)}>Replay gathering</button>
        </div> : null}
        {!exiting ? accountControl : null}
      </div>
      <main className="free-valuation-processing__center">
        <h1 className="sr-only">{error ? "Let’s try again" : heading ?? "Preparing your valuation"}</h1>
        <div className="free-valuation-processing__message-space" aria-hidden="true">
          <p key={message} className="free-valuation-processing__message">{message}</p>
        </div>
        {description && !error ? <p className="free-valuation-processing__error">{description}</p> : null}
        {error ? <p className="free-valuation-processing__error" role="alert">{error}</p> : null}
        {phase === "reviewing" && !error ? <span className="sr-only" role="status">Venfour is reviewing your vehicle and market evidence. The displayed activities describe the checks included in your review. Your result will appear when it is ready.</span> : null}
        {error && onRetry ? <button className="free-valuation-processing__retry" type="button" onClick={onRetry} disabled={retryDisabled}>Try again</button> : null}
        {notice ? <p className="free-valuation-processing__notice" role="status">{notice}</p> : null}
      </main>
    </div>
  );
}
