import { useLayoutEffect, type RefObject } from "react";

import { observeScrollEntrances } from "@/lib/scroll-entrance-motion";

const entranceSelector = "[data-home-entrance]";

export function useHomeEntranceMotion(root: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const targets = Array.from(element.querySelectorAll<HTMLElement>(entranceSelector))
      .filter((target) => !target.parentElement?.closest(entranceSelector));
    return observeScrollEntrances(element, targets, (target) => Number(target.dataset.homeOrder ?? 0));
  }, [root]);
}
