import { useLayoutEffect, type RefObject } from "react";

import { observeScrollEntrances } from "@/lib/scroll-entrance-motion";

const entranceSelector = '[data-review-entrance="primary"], [data-review-entrance="secondary"], [data-review-entrance="supporting"]';
const stationarySelector = ".review-progress";

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
    return observeScrollEntrances(element, groups, (target) =>
      Number(target.dataset.reviewOrder ?? groups.indexOf(target)), { revealAtPageEnd: true });
  }, [root, stage, index, reportId]);
}
