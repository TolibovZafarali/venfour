import { cn } from "@/lib/utils";
import venfourWordmark from "../../../assets/brand/venfour-wordmark.svg";

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <img
      src={venfourWordmark}
      width={324}
      height={64}
      className={cn("block h-5 w-auto shrink-0", className)}
      alt=""
      aria-hidden="true"
      data-brand-wordmark="venfour"
    />
  );
}
