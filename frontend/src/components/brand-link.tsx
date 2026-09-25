import { Link } from "react-router";

import { cn } from "@/lib/utils";
import venfourMark from "../../../assets/brand/venfour-mark.svg";

export function BrandLink({ to, className }: { to: string; className?: string }) {
  return (
    <Link
      to={to}
      className={cn("notranslate inline-flex min-h-11 select-none items-center gap-[0.5625rem] rounded-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60", className)}
      aria-label="Venfour home"
      translate="no"
    >
      <img src={venfourMark} className="size-7" alt="" aria-hidden data-brand-logo="venfour" />
      <span
        className="font-brand text-[1.25rem] leading-none font-semibold tracking-[-0.035em] antialiased [font-kerning:normal] [text-rendering:geometricPrecision]"
        data-brand-wordmark="venfour"
      >
        Venfour
      </span>
    </Link>
  );
}
