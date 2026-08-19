import type { ReactNode } from "react";

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
                "flex min-h-12 cursor-pointer items-center justify-center rounded-lg border px-3 text-center text-sm font-semibold transition-[background-color,border-color,box-shadow,color,transform] duration-300 ease-out focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-1 active:scale-[0.99] motion-reduce:transition-none",
                selected
                  ? "border-brand bg-brand text-white shadow-[0_8px_22px_-18px_rgba(21,94,239,0.9)] hover:bg-brand-strong"
                  : "border-transparent text-copy hover:border-line hover:bg-white/60 hover:text-ink",
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
  onServiceChange: (service: AppraisalServiceSlug) => void;
  serviceSwitchDisabled?: boolean;
  eyebrow: ReactNode;
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
  className?: string;
}

export function AppraisalStartLayout({
  service,
  onServiceChange,
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
        "w-full bg-[radial-gradient(circle_at_top_left,rgba(231,239,255,0.82),transparent_38%),linear-gradient(180deg,#fbfcff_0%,#f7f9fc_100%)]",
        className,
      )}
      data-appraisal-start-page
      data-appraisal-service={service}
    >
      <div
        className="mx-auto grid w-full max-w-7xl gap-7 px-5 py-5 sm:px-8 sm:py-8 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] lg:items-start lg:gap-14 lg:py-12 xl:gap-20"
        data-appraisal-start-layout
        data-total-loss-layout
      >
        <header
          className="max-w-xl lg:sticky lg:top-28 lg:pt-5"
          data-appraisal-start-intro
          data-total-loss-intro
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
        </header>

        <div
          className="min-w-0 w-full max-w-3xl lg:justify-self-end"
          data-appraisal-start-flow
          data-total-loss-flow
        >
          {children}
        </div>
      </div>
    </div>
  );
}
