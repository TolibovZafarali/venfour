import {
  ArrowDown,
  ArrowRight,
  CarFront,
  Check,
  FileSearch,
  FileText,
  History,
  MapPin,
  Search,
  Upload,
  Wrench,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { homepageExampleAppraisal } from "@/pages/home-example";

export function TotalLossServiceVisual() {
  return (
    <figure className="grid min-h-72 gap-3 rounded-xl border border-slate-200 bg-slate-100 p-4 sm:grid-cols-[minmax(0,0.9fr)_2.75rem_minmax(0,1.1fr)] sm:items-center sm:gap-4 sm:p-6">
      <p data-home-entrance="supporting" className="text-[0.625rem] font-semibold tracking-[0.1em] text-copy uppercase sm:col-span-3">
        Synthetic example
      </p>
      <div data-home-entrance="visual" className="rounded-lg border border-slate-300 bg-white p-3 shadow-[0_12px_30px_-24px_rgba(11,31,51,0.45)] sm:p-4">
        <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
          <FileText className="size-4 text-brand" aria-hidden />
          <p className="text-[0.6875rem] font-semibold text-ink">
            Insurance value report
          </p>
        </div>
        <div className="mt-4 space-y-2" aria-hidden>
          <span className="block h-1.5 w-2/3 rounded bg-slate-200" />
          <span className="block h-1.5 w-full rounded bg-slate-100" />
          <span className="block h-1.5 w-4/5 rounded bg-slate-100" />
        </div>
        <div className="mt-5 border-l-2 border-amber pl-3">
          <p className="text-[0.625rem] font-medium text-copy">
            Vehicle value
          </p>
          <p className="mt-1 text-lg font-semibold text-ink tabular-nums">
            $19,046
          </p>
        </div>
      </div>

      <div data-home-entrance="supporting" data-home-order="1" className="flex items-center justify-center">
        <ArrowDown className="size-5 text-brand sm:hidden" aria-hidden />
        <ArrowRight className="hidden size-5 text-brand sm:block" aria-hidden />
      </div>

      <div data-home-entrance="visual" data-home-order="2" className="rounded-lg border border-brand/25 bg-white p-3 shadow-[0_12px_30px_-24px_rgba(11,31,51,0.45)] sm:p-4">
        <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
          <Search className="size-4 text-brand" aria-hidden />
          <p className="text-[0.6875rem] font-semibold text-ink">
            Venfour market check
          </p>
        </div>
        <div className="mt-4">
          <p className="text-[0.625rem] font-medium text-copy">
            Similar vehicles
          </p>
          <p className="mt-1 text-base font-semibold text-ink tabular-nums sm:text-lg">
            $20.8k–$21.6k
          </p>
          <div className="mt-3 h-2 rounded-full bg-slate-200">
            <span className="block h-full w-3/4 rounded-full bg-market" />
          </div>
          <p className="mt-3 text-[0.625rem] font-medium text-market-strong">
            May be worth a closer look
          </p>
        </div>
      </div>
      <figcaption className="sr-only">
        A synthetic insurance report value moves into a Venfour market comparison of similar vehicles.
      </figcaption>
    </figure>
  );
}

export function RepairedVehicleServiceVisual() {
  const stages = [
    { label: "Before", icon: CarFront },
    { label: "Repaired", icon: Wrench },
    { label: "History", icon: History },
  ] as const;

  return (
    <figure data-home-entrance="visual" className="rounded-xl border border-slate-300 bg-ink p-5 text-white sm:p-7">
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-start gap-2">
        {stages.map((stage, index) => {
          const Icon = stage.icon;
          return (
            <div key={stage.label} className="contents">
              <div className="flex min-w-0 flex-col items-center text-center">
                <span className="flex size-11 items-center justify-center rounded-lg border border-white/20 bg-white/8">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="mt-2 text-[0.6875rem] font-semibold">
                  {stage.label}
                </span>
              </div>
              {index < stages.length - 1 ? (
                <ArrowRight className="mt-3.5 size-4 text-slate-400" aria-hidden />
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-7 border-t border-white/15 pt-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[0.6875rem] font-medium text-slate-300">
              Resale value after repairs
            </p>
            <p className="mt-1 text-xl font-semibold tracking-[-0.025em]">
              May be lower
            </p>
          </div>
          <div className="flex h-14 items-end gap-1.5" aria-hidden>
            <span className="block h-full w-5 rounded-t bg-white/75" />
            <span className="block h-10 w-5 rounded-t bg-amber" />
          </div>
        </div>
      </div>
      <figcaption className="mt-4 text-xs leading-5 text-slate-300">
        Repairs restore the vehicle, while the accident remains in its history.
      </figcaption>
    </figure>
  );
}

type ProcessIllustrationProps = {
  step: "upload" | "market" | "result";
  entranceOrder?: number;
};

const processIllustrationClassName =
  "flex h-64 items-center justify-center border-b border-slate-200 bg-slate-100 p-6";

const processCardClassName =
  "h-44 w-full max-w-72 rounded-lg border bg-white p-4 shadow-[0_14px_36px_-28px_rgba(11,31,51,0.5)]";

export function ProcessIllustration({ step, entranceOrder = 0 }: ProcessIllustrationProps) {
  if (step === "upload") {
    return (
      <figure data-home-entrance="visual" data-home-order={entranceOrder} className={processIllustrationClassName}>
        <div className={`${processCardClassName} border-slate-300`}>
          <FileText className="size-5 text-brand" aria-hidden />
          <div className="mt-4 space-y-2" aria-hidden>
            <span className="block h-1.5 w-3/4 rounded bg-slate-200" />
            <span className="block h-1.5 w-full rounded bg-slate-100" />
            <span className="block h-1.5 w-5/6 rounded bg-slate-100" />
          </div>
          <div className="mt-5 flex items-center gap-2 rounded-md border border-brand/25 bg-brand-soft px-3 py-2">
            <Upload className="size-4 text-brand" aria-hidden />
            <span className="text-[0.6875rem] font-semibold text-brand-strong">
              Report selected
            </span>
          </div>
        </div>
        <figcaption className="sr-only">
          An insurance value report selected for upload.
        </figcaption>
      </figure>
    );
  }

  if (step === "market") {
    return (
      <figure data-home-entrance="visual" data-home-order={entranceOrder} className={processIllustrationClassName}>
        <div className={`${processCardClassName} border-slate-300`}>
          <div className="flex items-center justify-between">
            <span className="text-[0.6875rem] font-semibold text-ink">
              Similar vehicles
            </span>
            <span className="inline-flex items-center gap-1 text-[0.625rem] text-copy">
              <MapPin className="size-3" aria-hidden /> Local
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {homepageExampleAppraisal.vehicles.map((vehicle) => (
              <div
                key={`${vehicle.price}-${vehicle.distance}`}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-2 border-t border-slate-100 pt-2"
              >
                <span className="flex size-6 items-center justify-center rounded bg-brand-soft text-brand">
                  <CarFront
                    className="size-3.5"
                    aria-hidden
                    data-comparable-vehicle-icon
                  />
                </span>
                <span className="text-[0.625rem] text-copy">
                  {vehicle.distance}
                </span>
                <span className="text-[0.6875rem] font-semibold text-ink tabular-nums">
                  {vehicle.price}
                </span>
              </div>
            ))}
          </div>
        </div>
        <figcaption className="sr-only">
          Three similar local vehicles reviewed against the insurance report.
        </figcaption>
      </figure>
    );
  }

  return (
    <figure data-home-entrance="visual" data-home-order={entranceOrder} className={processIllustrationClassName}>
      <div className={`${processCardClassName} border-market/30`}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.6875rem] font-semibold text-ink">
            Evidence review result
          </span>
          <Check className="size-4 text-market-strong" aria-hidden />
        </div>
        <p className="mt-4 text-[0.625rem] font-medium text-copy">
          Example market range
        </p>
        <p className="mt-1 text-lg font-semibold text-ink tabular-nums">
          $20,800–$21,600
        </p>
        <div className="mt-4 h-2 rounded-full bg-slate-200">
          <span className="block h-full w-4/5 rounded-full bg-market" />
        </div>
        <p className="mt-4 text-[0.625rem] leading-4 text-copy">
          Clear finding, supporting vehicles, and limitations.
        </p>
      </div>
      <figcaption className="sr-only">
        A clear on-screen evidence review showing an example market range.
      </figcaption>
    </figure>
  );
}

export function AnnotatedInsuranceReportVisual() {
  const notes = [
    "Mileage may differ",
    "Equipment can be missing",
    "Adjustments may be large",
    "Vehicles can be far away",
  ] as const;

  return (
    <figure className="grid gap-5 rounded-2xl border border-slate-300 bg-slate-100 p-5 sm:p-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(15rem,0.85fr)] lg:items-center">
      <div data-home-entrance="visual" className="rounded-xl border border-slate-300 bg-white p-4 shadow-[0_20px_45px_-34px_rgba(11,31,51,0.55)] sm:p-6">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-2">
            <FileSearch className="size-4 text-brand" aria-hidden />
            <p className="text-xs font-semibold text-ink">
              Illustrative insurance report
            </p>
          </div>
          <span className="text-[0.625rem] font-medium text-copy">
            Synthetic document
          </span>
        </div>
        <div className="mt-5 grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-3 text-[0.6875rem]">
          <span className="font-semibold text-copy">Similar vehicle</span>
          <span className="font-semibold text-copy">Miles</span>
          <span className="font-semibold text-copy">Adjustment</span>
          {[
            ["Vehicle 01", "42,100", "−$1,480"],
            ["Vehicle 02", "35,800", "+$240"],
            ["Vehicle 03", "51,300", "−$1,120"],
          ].map((row, index) => (
            <div key={row[0]} className="contents">
              {row.map((item, itemIndex) => (
                <span
                  key={item}
                  className={cn(
                    "border-t border-slate-100 pt-3 text-ink tabular-nums",
                    (index === 0 && itemIndex === 1) ||
                      (index === 2 && itemIndex === 2)
                      ? "font-semibold text-amber-strong"
                      : "",
                  )}
                >
                  {item}
                </span>
              ))}
            </div>
          ))}
        </div>
        <div className="mt-5 border-l-2 border-amber bg-amber-soft px-3 py-2.5">
          <p className="text-[0.6875rem] font-semibold text-ink">
            Equipment package not listed
          </p>
        </div>
      </div>

      <ol className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
        {notes.map((note, index) => (
          <li
            key={note}
            data-home-entrance="supporting"
            data-home-order={index}
            className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs font-medium text-ink"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded bg-amber-soft text-[0.625rem] font-semibold text-amber-strong tabular-nums">
              {index + 1}
            </span>
            {note}
          </li>
        ))}
      </ol>
      <figcaption className="sr-only">
        A synthetic insurance report annotated with details that may deserve a closer look: mileage, equipment, adjustments, and distance.
      </figcaption>
    </figure>
  );
}

export function DiminishedValueExplainerVisual() {
  return (
    <figure className="rounded-2xl border border-slate-300 bg-white p-5 shadow-[0_24px_55px_-42px_rgba(11,31,51,0.5)] sm:p-7 lg:p-8">
      <div className="grid items-center gap-5 sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <div data-home-entrance="visual" className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
          <CarFront className="mx-auto size-7 text-brand" aria-hidden />
          <p className="mt-3 text-sm font-semibold text-ink">Before accident</p>
          <p className="mt-1 text-xs text-copy">Normal market history</p>
        </div>
        <ArrowDown className="mx-auto size-5 text-slate-400 sm:hidden" aria-hidden />
        <ArrowRight className="mx-auto hidden size-5 text-slate-400 sm:block" aria-hidden />
        <div data-home-entrance="visual" data-home-order="1" className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
          <Wrench className="mx-auto size-7 text-brand" aria-hidden />
          <p className="mt-3 text-sm font-semibold text-ink">After repairs</p>
          <p className="mt-1 text-xs text-copy">Vehicle restored</p>
        </div>
        <ArrowDown className="mx-auto size-5 text-slate-400 sm:hidden" aria-hidden />
        <ArrowRight className="mx-auto hidden size-5 text-slate-400 sm:block" aria-hidden />
        <div data-home-entrance="visual" data-home-order="2" className="rounded-xl border border-amber/35 bg-amber-soft p-4 text-center">
          <History className="mx-auto size-7 text-amber-strong" aria-hidden />
          <p className="mt-3 text-sm font-semibold text-ink">
            Accident history
          </p>
          <p className="mt-1 text-xs text-copy">Still visible to buyers</p>
        </div>
      </div>

      <div data-home-entrance="visual" className="mt-7 grid gap-5 border-t border-slate-200 pt-6 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
        <div>
          <div className="flex items-center justify-between gap-3 text-xs font-medium text-copy">
            <span>Before accident</span>
            <span>Market value</span>
          </div>
          <div className="mt-2 h-5 rounded bg-brand/80" aria-hidden />
        </div>
        <span className="hidden pb-0.5 text-xs font-semibold text-amber-strong sm:block">
          Value may fall
        </span>
        <div>
          <div className="flex items-center justify-between gap-3 text-xs font-medium text-copy">
            <span>After repairs</span>
            <span>Resale value</span>
          </div>
          <div className="mt-2 h-5 rounded bg-slate-300" aria-hidden>
            <span className="block h-full w-4/5 rounded bg-amber/75" />
          </div>
        </div>
      </div>
      <figcaption data-home-entrance="copy" data-home-order="1" className="mt-5 text-xs leading-5 text-copy">
        A manual reviewer may examine how accident history and repairs relate to
        a possible change in resale value. This illustration is not an
        automated appraisal.
      </figcaption>
    </figure>
  );
}

export function AppraisalReportVisual() {
  const outputs = [
    "Vehicle and insurance value",
    "Market range",
    "Similar vehicles",
    "Explanation and limitations",
  ] as const;

  return (
    <figure className="grid gap-5 rounded-2xl border border-slate-300 bg-slate-100 p-5 sm:p-7 lg:grid-cols-[minmax(0,1.1fr)_minmax(14rem,0.7fr)] lg:items-center lg:p-8">
      <div className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-[0_24px_55px_-40px_rgba(11,31,51,0.55)]">
        <div data-home-entrance="supporting" className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-market" aria-hidden />
            <p className="text-xs font-semibold text-ink">Analysis overview</p>
          </div>
          <span className="text-[0.625rem] text-copy">Example only</span>
        </div>
        <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <div data-home-entrance="visual" className="rounded-lg border border-slate-200 p-3">
            <p className="text-[0.625rem] font-medium text-copy">
              Insurance report value
            </p>
            <p className="mt-1 text-lg font-semibold text-ink tabular-nums">
              $19,046
            </p>
          </div>
          <div data-home-entrance="visual" data-home-order="1" className="rounded-lg border border-market/25 bg-market-soft p-3">
            <p className="text-[0.625rem] font-medium text-copy">
              Example market range
            </p>
            <p className="mt-1 text-lg font-semibold text-ink tabular-nums">
              $20.8k–$21.6k
            </p>
          </div>
          <div data-home-entrance="visual" data-home-order="2" className="rounded-lg border border-slate-200 p-3 sm:col-span-2">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[0.625rem] font-medium text-copy">
                Similar vehicles
              </p>
              <span className="text-[0.625rem] font-semibold text-brand">
                8 reviewed
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2" aria-hidden>
              {["$20.9k", "$21.2k", "$21.5k"].map((price) => (
                <span
                  key={price}
                  className="flex items-center justify-center gap-1.5 rounded bg-slate-100 px-2 py-2 text-center text-[0.6875rem] font-semibold text-ink"
                >
                  <CarFront
                    className="size-3.5 text-brand"
                    aria-hidden
                    data-comparable-vehicle-icon
                  />
                  {price}
                </span>
              ))}
            </div>
          </div>
          <div data-home-entrance="supporting" data-home-order="3" className="flex items-start gap-2 border-t border-slate-200 pt-3 sm:col-span-2">
            <Check className="mt-0.5 size-4 shrink-0 text-market-strong" aria-hidden />
            <p className="text-[0.6875rem] leading-5 text-copy">
              Clear finding with the important limits shown beside it.
            </p>
          </div>
        </div>
      </div>

      <ol data-home-entrance="copy" data-home-order="1" className="space-y-2.5">
        {outputs.map((output, index) => (
          <li
            key={output}
            className="flex items-center gap-3 border-b border-slate-300 pb-2.5 text-sm font-semibold text-ink last:border-b-0 last:pb-0"
          >
            <span className="text-[0.6875rem] font-semibold text-brand tabular-nums">
              0{index + 1}
            </span>
            {output}
          </li>
        ))}
      </ol>
      <figcaption className="sr-only">
        A synthetic Venfour on-screen analysis with four areas: vehicle and insurance value, market range, similar vehicles, and a clear explanation with limitations.
      </figcaption>
    </figure>
  );
}
