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
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearTimers = useCallback(() => {
    clearTimeout(releaseTimer.current);
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
    // A route handoff registers its next phase before this release runs.
    releaseTimer.current = setTimeout(() => {
      if (ownerRef.current !== owner) return;
      setPresentation((current) => current ? { ...current, exiting: true } : null);
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      exitTimer.current = setTimeout(() => {
        ownerRef.current = null;
        setPresentation(null);
      }, reduced ? 0 : 460);
    }, 0);
  }, [clearTimers]);
  useEffect(() => clearTimers, [clearTimers]);
  const context = useMemo(() => ({ show, hide }), [show, hide]);

  return (
    <FreeValuationProcessingContext.Provider value={context}>
      <div
        inert={Boolean(presentation)}
        aria-hidden={presentation ? true : undefined}
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

export function FreeValuationProcessing({ reviewKey, phase = "reviewing", vehicle, notice, error, onRetry, retryDisabled, development }: FreeValuationProcessingOptions) {
  const context = useContext(FreeValuationProcessingContext);
  const [owner] = useState(() => Symbol("valuation-processing"));
  useLayoutEffect(() => {
    context?.show(owner, { reviewKey, phase, vehicle, notice, error, onRetry, retryDisabled, development });
  }, [context, owner, reviewKey, phase, vehicle, notice, error, onRetry, retryDisabled, development]);
  useLayoutEffect(() => () => context?.hide(owner), [context, owner]);
  return null;
}

function ProcessingEnvironment({ options, exiting }: { options: FreeValuationProcessingOptions; exiting: boolean }) {
  const { phase = "reviewing", notice, error, onRetry, retryDisabled, development } = options;
  const [activity, setActivity] = useState(0);
  const [gatheringReplay, setGatheringReplay] = useState(0);
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const priorFocus = document.activeElement;
    surfaceRef.current?.focus({ preventScroll: true });
    return () => {
      const target = priorFocus instanceof HTMLElement && priorFocus !== document.body && priorFocus.isConnected
        ? priorFocus
        : document.getElementById("main-content");
      target?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (phase !== "reviewing" || error) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setActivity((current) => (current + 1) % reviewActivities.length);
    }, 6800);
    return () => window.clearInterval(timer);
  }, [phase, error]);

  const message = error ? "Let’s try again" : phase === "preparing"
    ? "Preparing your details"
    : phase === "connecting" ? "Connecting to your review"
    : phase === "opening" ? "Opening your valuation"
    : reviewActivities[activity];

  return (
    <div
      ref={surfaceRef}
      className="free-valuation-processing"
      data-free-valuation-processing
      data-phase={phase}
      data-needs-action={Boolean(error || notice) || undefined}
      data-exiting={exiting || undefined}
      tabIndex={-1}
    >
      <ValuationSignalField key={gatheringReplay} />
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
        <h1 className="sr-only">Preparing your valuation</h1>
        <div className="free-valuation-processing__message-space" aria-hidden="true">
          <p key={message} className="free-valuation-processing__message">{message}</p>
        </div>
        {error ? <p className="free-valuation-processing__error" role="alert">{error}</p> : null}
        {phase === "reviewing" && !error ? <span className="sr-only" role="status">Venfour is reviewing your vehicle and market evidence. The displayed activities describe the checks included in your review. Your result will appear when it is ready.</span> : null}
        {error && onRetry ? <button className="free-valuation-processing__retry" type="button" onClick={onRetry} disabled={retryDisabled}>Try again</button> : null}
        {notice ? <p className="free-valuation-processing__notice" role="status">{notice}</p> : null}
      </main>
    </div>
  );
}
