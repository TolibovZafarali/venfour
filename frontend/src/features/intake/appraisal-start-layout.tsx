import "./appraisal-start-layout.css";

import { ArrowLeft, ArrowRight, Search } from "lucide-react";
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
                  ? "bg-brand text-white shadow-sm hover:bg-brand-strong"
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
  caseWorkspace?: boolean;
  service: AppraisalServiceSlug;
  stage: "overview" | "intake";
  onServiceChange: (service: AppraisalServiceSlug) => void;
  onContinue: () => void;
  onBack: () => void;
  continueLabel?: ReactNode;
  serviceSwitchDisabled?: boolean;
  eyebrow: ReactNode;
  title: ReactNode;
  description: ReactNode;
  priceNote?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function AppraisalStartLayout({
  caseWorkspace = false,
  service,
  stage,
  onServiceChange,
  onContinue,
  onBack,
  continueLabel = "Continue",
  serviceSwitchDisabled,
  eyebrow,
  title,
  description,
  priceNote,
  children,
  className,
}: AppraisalStartLayoutProps) {
  if (caseWorkspace) return <section className="workspace-stage" data-appraisal-start-page data-appraisal-service={service}>
    <p className="workspace-stage__eyebrow">Your saved details</p>
    <h1 className="workspace-stage__heading">Your appraisal details</h1>
    <div className="mt-7" data-appraisal-start-flow data-total-loss-flow data-mobile-stage-visible="true">{children}</div>
  </section>;
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
        <aside className="appraisal-start-visual" aria-label="Valuation review">
          <div className="appraisal-start-visual__center">
            <div className="appraisal-start-document" aria-hidden="true">
              <span className="appraisal-start-document__eyebrow">VENFOUR</span>
              <span className="appraisal-start-document__title">A clearer picture.</span>
              <div className="appraisal-start-document__rule" />
              <div className="appraisal-start-document__lines"><i /><i /><i /></div>
              <div className="appraisal-start-document__chart"><i /><i /><i /><i /><i /></div>
              <span className="appraisal-start-document__lens"><Search size={34} strokeWidth={1.25} /></span>
            </div>
            <p className="appraisal-start-visual__heading">Know where your<br />valuation stands.</p>
            <p className="appraisal-start-visual__caption">Your vehicle. The evidence. A clearer next step.</p>
          </div>
        </aside>
        <section
          id="appraisal-intake"
          tabIndex={-1}
          className="appraisal-start-flow-panel min-w-0 focus:outline-none"
          data-appraisal-start-flow
          data-total-loss-flow
        >
          <div className="mx-auto w-full max-w-[44rem] px-5 py-7 sm:px-8 sm:py-8 lg:px-10 lg:py-12 xl:px-14"
            data-appraisal-section-content="flow"
          >
            {stage === "overview" ? (
              <div data-appraisal-start-intro data-total-loss-intro>
                <p className="mb-5 text-xs font-medium tracking-[0.12em] text-copy uppercase">Choose your service</p>
                <ServiceSelector value={service} disabled={serviceSwitchDisabled} onChange={onServiceChange} />
                <p className="text-xs font-semibold tracking-[0.12em] text-copy uppercase">{eyebrow}</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] text-ink sm:text-4xl">{title}</h1>
                <p className="mt-3 text-sm leading-6 text-copy">{description}</p>
                {priceNote ? <p className="mt-3 text-xs leading-5 text-copy" data-review-price-note>{priceNote}</p> : null}
                <ExampleAnalysisPreview service={service} />
                <button
                  type="button"
                  className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none"
                  disabled={serviceSwitchDisabled}
                  onClick={onContinue}
                >
                  {continueLabel}<ArrowRight className="size-4" aria-hidden />
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-copy transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-reduce:transition-none disabled:opacity-50"
                  disabled={serviceSwitchDisabled}
                  onClick={onBack}
                >
                  <ArrowLeft className="size-4" aria-hidden />Back to services
                </button>
                {children}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
