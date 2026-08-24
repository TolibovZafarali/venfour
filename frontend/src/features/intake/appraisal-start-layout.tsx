import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { ExampleAnalysisPreview } from "@/features/intake/example-analysis-preview";
import type { AppraisalServiceSlug } from "@/features/intake/types";
import { cn } from "@/lib/utils";

export interface ServiceSelectorProps {
  value: AppraisalServiceSlug;
  onChange: (service: AppraisalServiceSlug) => void;
  disabled?: boolean;
  className?: string;
}

const appraisalServiceOptions = [
  { value: "total-loss", label: "Total Loss" },
  { value: "diminished-value", label: "Diminished Value" },
] as const satisfies readonly {
  value: AppraisalServiceSlug;
  label: string;
}[];

export function ServiceSelector({
  value,
  onChange,
  disabled,
  className,
}: ServiceSelectorProps) {
  return (
    <fieldset
      className={cn("mb-7", className)}
      disabled={disabled}
      data-service-selector
    >
      <legend className="sr-only">Choose an appraisal service</legend>
      <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-line bg-surface/85 p-1.5 shadow-sm">
        {appraisalServiceOptions.map((option) => {
          const selected = option.value === value;
          const inputId = `appraisal-service-${option.value}`;
          return (
            <label
              key={option.value}
              htmlFor={inputId}
              className={cn(
                "flex min-h-12 cursor-pointer items-center justify-center rounded-lg border border-transparent px-3 text-center text-sm font-semibold transition-[background-color,box-shadow,color,filter,transform] duration-300 ease-out active:scale-[0.99] motion-reduce:transition-none",
                selected
                  ? "bg-brand text-white shadow-[0_8px_22px_-18px_rgba(21,94,239,0.9)] hover:bg-brand-strong"
                  : "text-copy hover:bg-white/60 hover:text-ink",
                disabled && "cursor-not-allowed opacity-65",
              )}
              aria-current={selected ? "true" : undefined}
              data-service-option={option.value}
            >
              <input
                id={inputId}
                className="sr-only"
                type="radio"
                name="appraisal-service"
                value={option.value}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(option.value)}
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export interface AppraisalStartLayoutProps {
  service: AppraisalServiceSlug;
  mobileView: "overview" | "intake";
  onServiceChange: (service: AppraisalServiceSlug) => void;
  onMobileContinue: () => void;
  onMobileBack: () => void;
  mobileContinueLabel?: ReactNode;
  serviceSwitchDisabled?: boolean;
  eyebrow: ReactNode;
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
  className?: string;
}

export function AppraisalStartLayout({
  service,
  mobileView,
  onServiceChange,
  onMobileContinue,
  onMobileBack,
  mobileContinueLabel = "Continue",
  serviceSwitchDisabled,
  eyebrow,
  title,
  description,
  children,
  className,
}: AppraisalStartLayoutProps) {
  return (
    <div
      className={cn(
        "appraisal-start-gradient min-h-[calc(100svh-4rem)] w-full",
        className,
      )}
      data-appraisal-start-page
      data-appraisal-service={service}
    >
      <div
        className="grid min-h-[calc(100svh-4rem)] w-full lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-stretch"
        data-appraisal-start-layout
        data-total-loss-layout
      >
        <section
          className={cn(
            "appraisal-start-intro-panel min-w-0 lg:block",
            mobileView === "intake" && "hidden",
          )}
          data-appraisal-start-intro
          data-total-loss-intro
          data-mobile-stage-visible={mobileView === "overview"}
        >
          <div
            className="mx-auto w-full max-w-[44rem] px-5 py-5 sm:px-8 sm:py-8 lg:sticky lg:top-16 lg:mr-0 lg:ml-auto lg:px-10 lg:py-12 xl:px-14 xl:py-14"
            data-appraisal-section-content="intro"
          >
            <ServiceSelector
              value={service}
              disabled={serviceSwitchDisabled}
              onChange={onServiceChange}
            />
            <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
              {eyebrow}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] text-ink sm:text-4xl">
              {title}
            </h1>
            <p className="mt-3 text-base leading-7 text-copy">
              {description}
            </p>
            <ExampleAnalysisPreview service={service} />
            {mobileView === "overview" ? (
              <button
                type="button"
                className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none lg:hidden"
                aria-controls="appraisal-intake"
                data-mobile-intake-continue
                onClick={onMobileContinue}
              >
                {mobileContinueLabel}
                <ArrowRight className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>
        </section>

        <section
          id="appraisal-intake"
          className={cn(
            "appraisal-start-flow-panel min-w-0 lg:block lg:backdrop-blur-[3px]",
            mobileView === "overview" && "hidden",
          )}
          data-appraisal-start-flow
          data-total-loss-flow
          data-mobile-stage-visible={mobileView === "intake"}
        >
          <div
            className="mx-auto w-full max-w-[52rem] px-5 py-5 sm:px-8 sm:py-8 lg:mr-auto lg:ml-0 lg:px-10 lg:py-12 xl:px-14 xl:py-14"
            data-appraisal-section-content="flow"
          >
            {mobileView === "intake" ? (
              <button
                type="button"
                className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-copy transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-reduce:transition-none lg:hidden"
                onClick={onMobileBack}
              >
                <ArrowLeft className="size-4" aria-hidden />
                Back to services
              </button>
            ) : null}
            {children}
          </div>
        </section>
      </div>
    </div>
  );
}
