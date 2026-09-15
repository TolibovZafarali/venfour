import { useContext, useId } from "react";
import type { HTMLAttributes, ReactNode } from "react";

import { FreeValuationProcessing } from "@/features/analyses/components/free-valuation-processing";
import { FreeValuationProcessingContext } from "@/features/analyses/components/free-valuation-processing-context";
import { cn } from "@/lib/utils";
import "./valuation-status.css";

export function ValuationSurface({ children, className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section {...props} className={cn("valuation-surface", className)}>
    <div className="valuation-surface__background page-gradient-analysis" aria-hidden="true" />
    {children}
  </section>;
}

export interface ValuationStatusProps {
  heading: string;
  description: ReactNode;
  eyebrow?: string;
  kind?: "error" | "loading" | "secure";
  children?: ReactNode;
  headingLevel?: "h1" | "h2";
  compact?: boolean;
}

// State-specific copy and actions stay with the workflow that owns them.
export function ValuationStatus({ heading, description, eyebrow, kind = "secure", children, headingLevel: Heading = "h1", compact = false }: ValuationStatusProps) {
  const id = useId();
  const processing = useContext(FreeValuationProcessingContext);
  return <>
    {kind === "loading" && processing && !processing.inline && !compact ? <FreeValuationProcessing phase="connecting" heading={heading} description={typeof description === "string" ? description : undefined} /> : null}
    <ValuationSurface className={cn("valuation-status", compact && "valuation-status--compact")} data-valuation-status={kind} aria-labelledby={id} role={kind === "error" ? "alert" : undefined} aria-live={kind === "loading" ? "polite" : undefined} aria-busy={kind === "loading" || undefined}>
      <div className="valuation-status__content">
        {eyebrow ? <p className="valuation-status__eyebrow">{eyebrow}</p> : null}
        <Heading id={id} className="valuation-status__heading">{heading}</Heading>
        <div className="valuation-status__description">{description}</div>
        {children ? <div className="valuation-status__actions">{children}</div> : null}
      </div>
    </ValuationSurface>
  </>;
}
