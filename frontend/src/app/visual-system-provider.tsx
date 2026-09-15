import { useLayoutEffect } from "react";
import type { RouterProviderProps } from "react-router";

import { applyVisualSystem } from "@/app/visual-system";

export function VisualSystemProvider({ router }: Pick<RouterProviderProps, "router">) {
  useLayoutEffect(() => {
    const previous = document.documentElement.getAttribute("data-visual-system");
    applyVisualSystem(router.state.location.pathname);
    const unsubscribe = router.subscribe((state) => applyVisualSystem(state.location.pathname));
    return () => {
      unsubscribe();
      if (previous === null) document.documentElement.removeAttribute("data-visual-system");
      else document.documentElement.setAttribute("data-visual-system", previous);
    };
  }, [router]);
  return null;
}
