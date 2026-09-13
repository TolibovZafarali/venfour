import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { FreeValuationProcessingContext } from "./free-valuation-processing-context";
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
export function FreeValuationProcessingProvider({ children }: { children: ReactNode }) {
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
  const context = useMemo(() => ({ show, hide }), [show, hide]);

  return (
    <FreeValuationProcessingContext.Provider value={context}>
      <div
        inert={Boolean(presentation && !presentation.exiting)}
        aria-hidden={presentation && !presentation.exiting ? true : undefined}
        style={{ visibility: presentation && !presentation.exiting ? "hidden" : undefined }}
      >
        {children}
      </div>
      {presentation ? createPortal(
        <ProcessingEnvironment options={presentation.options} exiting={presentation.exiting} />,
        document.body,
      ) : null}
    </FreeValuationProcessingContext.Provider>
  );
}

export function FreeValuationProcessing({ reviewKey, heading, description, phase = "reviewing", vehicle, notice, error, onRetry, retryDisabled, development }: FreeValuationProcessingOptions) {
  const context = useContext(FreeValuationProcessingContext);
  const [owner] = useState(() => Symbol("valuation-processing"));
  useLayoutEffect(() => {
    context?.show(owner, { reviewKey, heading, description, phase, vehicle, notice, error, onRetry, retryDisabled, development });
  }, [context, owner, reviewKey, heading, description, phase, vehicle, notice, error, onRetry, retryDisabled, development]);
  useLayoutEffect(() => () => context?.hide(owner), [context, owner]);
  return null;
}

function ProcessingEnvironment({ options, exiting }: { options: FreeValuationProcessingOptions; exiting: boolean }) {
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
      className="free-valuation-processing page-gradient-analysis"
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
