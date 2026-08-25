import { ArrowRight, ClipboardList } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { formatAppraisalCaseLastActivity } from "@/features/cases/format";
import { appraisalCasePresentation } from "@/features/cases/presentation";
import type { AppraisalCase } from "@/features/cases/types";
import { cn } from "@/lib/utils";

export interface AppraisalCaseCardProps {
  readonly appraisalCase: AppraisalCase;
  readonly className?: string;
  readonly headingLevel?: 2 | 3;
}

export function AppraisalCaseCard({
  appraisalCase,
  className,
  headingLevel = 2,
}: AppraisalCaseCardProps) {
  const presentation = appraisalCasePresentation(appraisalCase);
  const headingId = `appraisal-${appraisalCase.id}-title`;
  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <article
      className={cn(
        "flex h-full flex-col rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6",
        className,
      )}
      aria-labelledby={headingId}
    >
      <div className="flex items-start justify-between gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <ClipboardList className="size-5" aria-hidden />
        </span>
        <span className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-copy">
          {presentation.statusLabel}
        </span>
      </div>
      <Heading
        id={headingId}
        className="mt-5 text-xl font-semibold tracking-[-0.025em] text-ink"
      >
        {presentation.serviceLabel}
      </Heading>
      <p className="mt-2 text-sm text-copy">
        {formatAppraisalCaseLastActivity(appraisalCase.lastActivityAt)}
      </p>
      {presentation.action ? (
        <Button
          asChild
          className="mt-6 self-start"
          variant={
            presentation.action.label === "Contact support"
              ? "outline"
              : "default"
          }
        >
          <Link to={presentation.action.href}>
            {presentation.action.label}
            {presentation.action.label !== "Contact support" ? (
              <ArrowRight className="size-4" aria-hidden />
            ) : null}
          </Link>
        </Button>
      ) : (
        <p className="mt-6 text-sm leading-6 text-copy">
          No further action is available for this appraisal.
        </p>
      )}
    </article>
  );
}
