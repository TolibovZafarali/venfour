import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { useCallback, useLayoutEffect, useRef } from "react";

export function useHomeSmoothScroll(enabled: boolean) {
  const scroller = useRef<Lenis | null>(null);

  useLayoutEffect(() => {
    if (!enabled || !window.matchMedia || !window.ResizeObserver) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const destroy = () => {
      scroller.current?.stop();
      scroller.current?.destroy();
      scroller.current = null;
    };
    const sync = () => {
      if (motion.matches || document.body.hasAttribute("data-scroll-locked")) {
        destroy();
      } else if (!scroller.current) {
        scroller.current = new Lenis({
          autoRaf: true,
          lerp: 0.09,
          smoothWheel: true,
          syncTouch: false,
          stopInertiaOnNavigate: true,
          prevent: (node) => node.matches("[role='dialog'], [role='alertdialog'], textarea, select, [contenteditable='true']"),
        });
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
        scroller.current?.scrollTo(window.scrollY, { immediate: true });
      }
    };

    sync();
    const scrollLock = new MutationObserver(sync);
    scrollLock.observe(document.body, { attributes: true, attributeFilter: ["data-scroll-locked"] });
    motion.addEventListener("change", sync);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      scrollLock.disconnect();
      motion.removeEventListener("change", sync);
      window.removeEventListener("keydown", onKeyDown);
      destroy();
    };
  }, [enabled]);

  return useCallback((target: HTMLElement) => {
    if (!scroller.current) {
      target.scrollIntoView?.({ block: "start" });
      return;
    }

    scroller.current.scrollTo(target, { duration: 1.1 });
  }, []);
}
