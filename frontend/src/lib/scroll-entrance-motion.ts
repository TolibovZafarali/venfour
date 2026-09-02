import "./scroll-entrance-motion.css";

export function observeScrollEntrances(
  element: HTMLElement,
  targets: HTMLElement[],
  orderForTarget: (target: HTMLElement) => number,
  { revealAtPageEnd = false }: { revealAtPageEnd?: boolean } = {},
) {
  const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  if (motion?.matches || !window.IntersectionObserver) return;

  const revealed = new Set<HTMLElement>();

  const settle = (target: HTMLElement) => {
    revealed.add(target);
    delete target.dataset.scrollReveal;
    target.style.removeProperty("--scroll-entrance-delay");
    observer.unobserve(target);
  };

  const reveal = (target: HTMLElement) => {
    if (revealed.has(target)) return;
    revealed.add(target);
    // Authored local order stays the same at every scrolling speed.
    const order = orderForTarget(target);
    target.style.setProperty("--scroll-entrance-delay", `${Math.min(3, Math.max(0, order)) * 80}ms`);
    target.dataset.scrollReveal = "entering";
    observer.unobserve(target);
  };

  const onIntersect: IntersectionObserverCallback = (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) reveal(entry.target as HTMLElement);
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
    target.dataset.scrollReveal = "pending";
    observer.observe(target);
  });

  // Final controls may never reach the inset when there is no more page to scroll.
  const onPageEnd = () => {
    if (window.scrollY + window.innerHeight < document.documentElement.scrollHeight - 1) return;
    targets.filter((target) => !revealed.has(target)).forEach((target) => {
      const bounds = target.getBoundingClientRect();
      if (bounds.top < window.innerHeight && bounds.bottom > 0) reveal(target);
    });
  };
  if (revealAtPageEnd) onPageEnd();

  const onResize = () => {
    if (revealAtPageEnd) onPageEnd();
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
    const heading = focused.querySelector<HTMLElement>("[data-anchor-heading]");
    const target = targets.find((candidate) => candidate.contains(focused))
      ?? (heading ? targets.find((candidate) => candidate.contains(heading)) : undefined);
    if (target) settle(target);
  };
  const onFinish = (event: AnimationEvent) => {
    if (event.animationName === "scroll-focus-enter" && event.target instanceof HTMLElement) {
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
  if (revealAtPageEnd) window.addEventListener("scroll", onPageEnd, { passive: true });

  return () => {
    observer.disconnect();
    targets.forEach(settle);
    element.removeEventListener("focusin", onFocus);
    element.removeEventListener("animationend", onFinish);
    motion?.removeEventListener("change", onMotionChange);
    window.removeEventListener("resize", onResize);
    if (revealAtPageEnd) window.removeEventListener("scroll", onPageEnd);
  };
}
