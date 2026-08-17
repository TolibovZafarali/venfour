import { StartAnalysisForm } from "@/features/analyses/components/start-analysis-form";

export function HomePage() {
  return (
    <div className="flex w-full bg-neutral-50/70">
      <section className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,0.78fr)] lg:grid-rows-[auto_auto] lg:gap-x-20 lg:gap-y-10 lg:py-20">
        <div className="max-w-2xl">
          <p className="flex items-center gap-3 text-xs font-semibold tracking-[0.14em] text-neutral-500 uppercase">
            <span className="h-px w-8 bg-neutral-400" aria-hidden />
            Total-loss valuation review
          </p>
          <h1 className="mt-6 text-4xl leading-[1.05] font-semibold tracking-[-0.05em] text-balance text-neutral-950 sm:text-5xl lg:text-[3.75rem]">
            Know how your vehicle valuation compares.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-neutral-600 sm:text-lg sm:leading-8">
            Upload your insurer’s CCC report. Venfour reviews how the value was
            built and compares it with relevant market evidence.
          </p>
        </div>

        <div className="w-full lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center lg:justify-self-end">
          <StartAnalysisForm />
        </div>

        <ol
          className="grid gap-5 sm:grid-cols-3 sm:gap-6 lg:col-start-1 lg:row-start-2"
          aria-label="How Venfour works"
        >
          <li className="border-t border-neutral-300 pt-4">
            <span className="text-xs font-medium text-neutral-400">01</span>
            <p className="mt-1 text-sm font-medium text-neutral-900">
              Upload your report
            </p>
            <p className="mt-1 text-xs leading-5 text-neutral-500">
              The original CCC valuation PDF
            </p>
          </li>
          <li className="border-t border-neutral-300 pt-4">
            <span className="text-xs font-medium text-neutral-400">02</span>
            <p className="mt-1 text-sm font-medium text-neutral-900">
              Add your ZIP code
            </p>
            <p className="mt-1 text-xs leading-5 text-neutral-500">
              For relevant nearby vehicles
            </p>
          </li>
          <li className="border-t border-neutral-300 pt-4">
            <span className="text-xs font-medium text-neutral-400">03</span>
            <p className="mt-1 text-sm font-medium text-neutral-900">
              Review the evidence
            </p>
            <p className="mt-1 text-xs leading-5 text-neutral-500">
              Clear findings and limitations
            </p>
          </li>
        </ol>
      </section>
    </div>
  );
}
