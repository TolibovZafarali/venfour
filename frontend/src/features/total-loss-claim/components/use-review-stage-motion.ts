import { useLayoutEffect, useRef, type RefObject } from "react";

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const ease = "cubic-bezier(.2, .75, .25, 1)";

export function useReviewStageMotion({ root, stage, index, reportId }: {
  readonly root: RefObject<HTMLElement | null>;
  readonly stage: string;
  readonly index: number;
  readonly reportId: string;
}) {
  const previous = useRef<{ stage: string; index: number; reportId: string } | null>(null);
  const entrances = useRef<Animation[]>([]);
  const outgoing = useRef<Animation | null>(null);
  const navigation = useRef(0);
  const exiting = useRef(false);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const before = previous.current;
    previous.current = { stage, index, reportId };
    const backward = Boolean(before && before.reportId === reportId && index < before.index);
    element.setAttribute("data-direction", backward ? "backward" : "forward");
    // Position the reading surface while the old content is faded, before paint.
    // Explicit inline alignment prevents scrolling from moving the page sideways.
    element.focus({ preventScroll: true });
    element.scrollIntoView?.({ block: "start", inline: "nearest", behavior: "instant" });

    if (!reducedMotion()) {
      const reveals = element.querySelectorAll<HTMLElement>("[data-review-reveal], [data-review-count]");
      reveals.forEach((target) => {
        const closed = target.closest("details:not([open])");
        if (closed && closed !== target && !target.closest("summary")) return;
        const style = getComputedStyle(target);
        const role = target.dataset.reviewReveal;
        const travel = Number.parseFloat(style.getPropertyValue("--review-travel")) || 0;
        const duration = Number.parseFloat(style.getPropertyValue("--review-duration")) || 300;
        const delay = Number.parseFloat(style.getPropertyValue("--review-delay")) || 0;
        const frames: Keyframe[] = [
          { opacity: 0, translate: `0 ${backward ? -travel * .65 : travel}px` },
          { opacity: 1, translate: "0 0" },
        ];
        // Individual transforms preserve the range markers' precise positions.
        if (role === "range") {
          frames[0].scale = ".96 1";
          frames[1].scale = "1 1";
        } else if (role === "completion") {
          frames[0].scale = ".94";
          frames[1].scale = "1";
        }
        const animation = target.animate?.(frames, { duration, delay: backward ? delay * .7 : delay, easing: ease, fill: "backwards" });
        if (animation) entrances.current.push(animation);
      });
    }

    return () => {
      navigation.current += 1;
      exiting.current = false;
      outgoing.current?.cancel();
      outgoing.current = null;
      entrances.current.forEach((animation) => animation.cancel());
      entrances.current = [];
    };
  }, [root, stage, index, reportId]);

  const transitionTo = (commit: () => void) => {
    if (exiting.current) return;
    const content = root.current?.querySelector<HTMLElement>(".review-stage-content");
    if (!content?.animate || reducedMotion()) {
      commit();
      return;
    }
    exiting.current = true;
    const epoch = ++navigation.current;
    const animation = content.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 110, easing: "cubic-bezier(.4, 0, 1, 1)", fill: "forwards",
    });
    outgoing.current = animation;
    void animation.finished.then(() => {
      if (epoch !== navigation.current) return;
      try {
        commit();
      } finally {
        // A guarded destination may no-op after a same-stage URL change.
        // Always release its fade and interaction lock, even without a new stage.
        if (outgoing.current === animation) {
          outgoing.current = null;
          exiting.current = false;
          animation.cancel();
        }
      }
    }, () => { /* A superseding navigation or unmount cancels the old destination. */ });
  };

  return { transitionTo, isExiting: () => exiting.current };
}
