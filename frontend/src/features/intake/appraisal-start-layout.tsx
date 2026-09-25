import "./appraisal-start-layout.css";

import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { publicHref } from "@/app/site-boundary";
import { BrandLink } from "@/components/brand-link";
import { supportEmail } from "@/config/support";
import { ExampleAnalysisPreview } from "@/features/intake/example-analysis-preview";
import type { AppraisalServiceSlug } from "@/features/intake/types";
import { useCookieConsent } from "@/features/privacy/cookie-consent-context";
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
      data-active-service={value}
    >
      <legend className="sr-only">Choose an appraisal service</legend>
      <div className="appraisal-service-track grid grid-cols-2 gap-1.5 rounded-xl border border-line bg-surface/85 p-1">
        {appraisalServiceOptions.map((option) => {
          const selected = option.value === value;
          const inputId = `appraisal-service-${option.value}`;
          return (
            <label
              key={option.value}
              htmlFor={inputId}
              className={cn(
                "flex min-h-12 cursor-pointer items-center justify-center rounded-lg px-3 text-center text-sm font-semibold relative z-10 transition-colors duration-300 ease-out motion-reduce:transition-none",
                selected
                  ? "text-white"
                  : "text-copy hover:text-ink",
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
  continueLabel?: ReactNode;
  continueAvailable?: boolean;
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
  continueLabel = "Continue",
  continueAvailable = true,
  serviceSwitchDisabled,
  eyebrow,
  title,
  description,
  priceNote,
  children,
  className,
}: AppraisalStartLayoutProps) {
  const { openPreferences } = useCookieConsent();

  if (caseWorkspace) return <section className="workspace-stage" data-appraisal-start-page data-appraisal-service={service}>
    <p className="workspace-stage__eyebrow">Your saved details</p>
    <h1 className="workspace-stage__heading">Your appraisal details</h1>
    <div className="mt-7" data-appraisal-start-flow data-total-loss-flow data-mobile-stage-visible="true">{children}</div>
  </section>;
  return (
    <div
      className={cn(
        "appraisal-start-gradient min-h-svh w-full",
        className,
      )}
      data-appraisal-start-page
      data-appraisal-service={service}
    >
      <div
        className="grid min-h-svh w-full lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-stretch"
        data-appraisal-start-layout
        data-total-loss-layout
      >
        <aside className="appraisal-start-visual" aria-label="Valuation review">
          <div className="appraisal-start-visual__frame">
            <BrandLink to={publicHref()} className="appraisal-start-visual__brand" />
            <div className="appraisal-start-visual__copy">
              <p className="appraisal-start-visual__eyebrow">A fresh perspective</p>
              <p className="appraisal-start-visual__heading"><span>A clearer picture.</span><span>A confident next step.</span></p>
              <p className="appraisal-start-visual__caption">Understand your vehicle’s value,<br />with evidence you can use.</p>
            </div>
            <div className="appraisal-start-visual__footer">
              <span>Your vehicle. Your next chapter.</span>
              <span aria-hidden="true">↗</span>
            </div>
          </div>
        </aside>
        <section
          id="appraisal-intake"
          tabIndex={-1}
          className="appraisal-start-flow-panel min-w-0 focus:outline-none"
          data-appraisal-start-flow
          data-total-loss-flow
        >
          <div className="appraisal-start-content"
            data-appraisal-section-content="flow"
          >
            {stage === "overview" ? (
              <div className="appraisal-start-overview" data-appraisal-start-intro data-total-loss-intro>
                <p className="appraisal-start-kicker">Choose your service</p>
                <ServiceSelector value={service} disabled={serviceSwitchDisabled} onChange={onServiceChange} />
                <p className="appraisal-start-eyebrow">{eyebrow}</p>
                <h1 className="appraisal-start-heading">{title}</h1>
                <p className="appraisal-start-description">{description}</p>
                {priceNote ? <p className="appraisal-start-price" data-review-price-note>{priceNote}</p> : null}
                <ExampleAnalysisPreview service={service} />
                {continueAvailable ? <button
                  type="button"
                  className="appraisal-start-continue mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none"
                  disabled={serviceSwitchDisabled}
                  onClick={onContinue}
                >
                  {continueLabel}<ArrowRight className="size-4" aria-hidden />
                </button> : null}
              </div>
            ) : (
              children
            )}
            <div className="appraisal-start-preferences">
              <span className="appraisal-start-help">
                Need help? {supportEmail ? <a href={`mailto:${supportEmail}`}>{supportEmail}</a> : <a href={publicHref("/contact")}>Contact us</a>}
              </span>
              <span aria-hidden="true">·</span>
              <button type="button" onClick={openPreferences}>
                Your Privacy Choices
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
