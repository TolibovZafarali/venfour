import { Link } from "react-router";

import { cn } from "@/lib/utils";
import { BrandWordmark } from "@/components/brand-wordmark";
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
      <BrandWordmark />
    </Link>
  );
}
