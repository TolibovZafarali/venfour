import { useLayoutEffect, type RefObject } from "react";

import "./home-entrance-motion.css";

const entranceSelector = "[data-home-entrance]";

export function useHomeEntranceMotion(root: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const element = root.current;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!element || motion?.matches || !window.IntersectionObserver) return;

    const targets = Array.from(element.querySelectorAll<HTMLElement>(entranceSelector))
      .filter((target) => !target.parentElement?.closest(entranceSelector));
    const revealed = new Set<HTMLElement>();

    const settle = (target: HTMLElement) => {
      revealed.add(target);
      delete target.dataset.homeReveal;
      target.style.removeProperty("--home-entrance-delay");
      observer.unobserve(target);
    };

    const onIntersect: IntersectionObserverCallback = (entries) => {
      entries.forEach((entry) => {
        const target = entry.target as HTMLElement;
        if (!entry.isIntersecting || revealed.has(target)) return;
        revealed.add(target);
        // Authored local order stays the same at every scrolling speed.
        const order = Number(target.dataset.homeOrder ?? 0);
        target.style.setProperty("--home-entrance-delay", `${Math.min(3, Math.max(0, order)) * 80}ms`);
        target.dataset.homeReveal = "entering";
        observer.unobserve(target);
      });
    };

    // Use viewport-height pixels: percentage root margins are based on width.
    const bottomInset = () => Math.round(window.innerHeight * 0.16);
    let inset = bottomInset();
    const createObserver = () => new IntersectionObserver(onIntersect, {
      threshold: 0,
      rootMargin: `0px 0px -${inset}px 0px`,
    });
    let observer = createObserver();

    targets.forEach((target) => {
      // Scroll restoration can still move the page after this layout effect.
      if (target.contains(document.activeElement)) {
        revealed.add(target);
        return;
      }
      target.dataset.homeReveal = "pending";
      observer.observe(target);
    });

    const onResize = () => {
      const nextInset = bottomInset();
      if (nextInset === inset) return;
      inset = nextInset;
      observer.disconnect();
      observer = createObserver();
      targets.filter((target) => !revealed.has(target)).forEach((target) => observer.observe(target));
    };

    const onFocus = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return;
      const focused = event.target;
      // Focus clarifies its own content, never the offscreen rest of a section.
      const target = focused.closest<HTMLElement>(entranceSelector)
        ?? focused.querySelector<HTMLElement>("[data-anchor-heading]")?.closest<HTMLElement>(entranceSelector);
      if (target && targets.includes(target)) settle(target);
    };
    const onFinish = (event: AnimationEvent) => {
      if (event.animationName === "home-focus-enter" && event.target instanceof HTMLElement) {
        settle(event.target);
      }
    };
    const onMotionChange = () => {
      if (motion?.matches) {
        observer.disconnect();
        targets.forEach(settle);
      }
    };

    element.addEventListener("focusin", onFocus);
    element.addEventListener("animationend", onFinish);
    motion?.addEventListener("change", onMotionChange);
    window.addEventListener("resize", onResize);

    return () => {
      observer.disconnect();
      targets.forEach(settle);
      element.removeEventListener("focusin", onFocus);
      element.removeEventListener("animationend", onFinish);
      motion?.removeEventListener("change", onMotionChange);
      window.removeEventListener("resize", onResize);
    };
  }, [root]);
}
