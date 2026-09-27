import type { ComponentProps } from "react";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router";

import { applicationHref } from "@/app/site-boundary";
import { Button } from "@/components/ui/button";
import { publicIntakeClosed } from "@/config/public-site";
import { cn } from "@/lib/utils";

export function PublicButton({ className, ...props }: Omit<ComponentProps<typeof Button>, "size">) {
  return <Button {...props} size="lg" className={cn(
    "public-page-button h-auto min-h-11 max-w-full shrink whitespace-normal break-words py-2.5 text-center leading-5",
    className,
  )} />;
}

export function PublicPageActions({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("public-page-actions", className)} />;
}

export function PublicReviewAction({ className }: { className?: string }) {
  return <PublicButton asChild className={className}>
    <Link to={publicIntakeClosed ? "/contact" : applicationHref("/start?service=total-loss")}>
      <span>{publicIntakeClosed ? "Contact Venfour" : "Start my free valuation"}</span>
      <ArrowRight size={16} aria-hidden />
    </Link>
  </PublicButton>;
}
