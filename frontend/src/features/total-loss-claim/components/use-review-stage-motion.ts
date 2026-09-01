import { useLayoutEffect, type RefObject } from "react";

const entranceSelector = '[data-review-entrance="primary"], [data-review-entrance="secondary"], [data-review-entrance="supporting"]';
const stationarySelector = ".review-progress, .review-actions";
const entranceStagger = 90;

export function useReviewStageMotion({ root, stage, index, reportId }: {
  readonly root: RefObject<HTMLElement | null>;
  readonly stage: string;
  readonly index: number;
  readonly reportId: string;
}) {
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;

    const active = document.activeElement;
    const editing = active instanceof HTMLElement && element.contains(active) && (
      active.matches("input, textarea") || active.isContentEditable
      || Boolean(active.closest('[contenteditable]:not([contenteditable="false"])'))
    );
    // Keep a retained editor's focus and selection when the review index changes.
    if (!editing) element.focus({ preventScroll: true });
    // Reset before paint, without smooth scrolling or horizontal realignment.
    element.scrollIntoView?.({ block: "start", inline: "nearest", behavior: "instant" });

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const compact = window.matchMedia?.("(max-width: 540px)").matches;

    const candidates = Array.from(element.querySelectorAll<HTMLElement>(entranceSelector)).filter((target) => {
      if (target.matches(".review-stage-content, .request-review") || target.closest(stationarySelector) || target.querySelector(stationarySelector)) return false;
      // Reveal draft sections together without animating the whole page or individual fields.
      if (target.querySelector(".request-review") || target.closest(".request-composer")) return false;
      if (editing && target.contains(active)) return false;
      const closed = target.closest("details:not([open])");
      if (closed && closed !== target && !target.closest("summary")) return false;
      return true;
    });
    const groups = candidates.filter((target) => !candidates.some((other) => other !== target && other.contains(target)));
    const animations = groups.flatMap((target, position) => {
      const role = target.dataset.reviewEntrance!;
      const strong = role === "primary" && (stage === "result" || stage === "meaning");
      const completion = role === "primary" && (stage === "waiting" || stage === "response_received");
      const quiet = role === "supporting";
      const blur = compact ? strong ? 4 : 3 : strong ? 8 : quiet ? 4 : completion ? 5 : 6;
      const travel = compact ? strong ? 10 : 8 : strong ? 14 : quiet ? 8 : completion ? 10 : 12;
      const opacity = strong ? .55 : quiet ? .72 : completion ? .65 : .62;
      const animation = target.animate?.([
        { opacity, filter: `blur(${blur}px)`, translate: `0 ${travel}px`, offset: 0 },
        { opacity: .96, filter: "blur(0px)", translate: "0 2px", offset: .7 },
        { opacity: 1, filter: "blur(0px)", translate: "0 0", offset: 1 },
      ], {
        duration: 600,
        delay: position * entranceStagger,
        easing: "cubic-bezier(.22, .8, .24, 1)",
        fill: "backwards",
      });
      return animation ? [animation] : [];
    });

    const range = stage === "result" ? element.querySelector<HTMLElement>(".value-range-axis") : null;
    const rangeGroup = range ? groups.findIndex((target) => target.contains(range)) : -1;
    if (range && rangeGroup !== -1) {
      const animation = range.animate?.([
        { opacity: .7, translate: "0 2px" },
        { opacity: 1, translate: "0 0" },
      ], {
        duration: 320,
        delay: rangeGroup * entranceStagger + 180,
        easing: "cubic-bezier(.22, .8, .24, 1)",
        fill: "backwards",
      });
      if (animation) animations.push(animation);
    }

    return () => animations.forEach((animation) => animation.cancel());
  }, [root, stage, index, reportId]);
}
