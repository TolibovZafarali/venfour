import { useLayoutEffect, useRef, type RefObject } from "react";
import { useViewTransitionState } from "react-router";

export function supportsReviewTransition() {
  return typeof document.startViewTransition === "function"
    && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function useReviewStageMotion({ root, stage, index, locationKey, pathname, reportId }: {
  readonly root: RefObject<HTMLElement | null>;
  readonly stage: string;
  readonly index: number;
  readonly locationKey: string;
  readonly pathname: string;
  readonly reportId: string;
}) {
  const previous = useRef<{ stage: string; index: number; locationKey: string; reportId: string } | null>(null);
  const nativeTransition = useViewTransitionState(pathname);

  useLayoutEffect(() => {
    const element = root.current;
    const before = previous.current;
    if (before?.stage === stage && before.index === index && before.locationKey === locationKey && before.reportId === reportId) return;
    previous.current = { stage, index, locationKey, reportId };
    if (!element) return;

    const direction = before && index < before.index ? "backward" : "forward";
    element.setAttribute("data-direction", direction);
    element.focus({ preventScroll: true });
    element.scrollIntoView?.({ block: "start", behavior: "instant" });

    const changed = before && before.reportId === reportId && (before.stage !== stage || before.index !== index);
    if (!changed || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (nativeTransition) return;

    const content = element.querySelector<HTMLElement>(".review-stage-content");
    const animation = content?.animate?.([
      { opacity: .35, transform: `translateX(${direction === "backward" ? -12 : 12}px)` },
      { opacity: 1, transform: "translateX(0)" },
    ], { duration: 240, easing: "cubic-bezier(.22, .68, 0, 1)" });
    return () => animation?.cancel();
  }, [root, stage, index, locationKey, reportId, nativeTransition]);
}
