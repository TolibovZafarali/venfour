const exampleComparables = [
  { label: "Comparable 1", mileage: "50,000 mi", distance: "6 mi", price: "$21,800" },
  { label: "Comparable 2", mileage: "50,500 mi", distance: "7 mi", price: "$22,000" },
  { label: "Comparable 3", mileage: "51,000 mi", distance: "8 mi", price: "$22,200" },
] as const;

export function ExampleAnalysisPreview() {
  return (
    <section
      className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_28px_80px_-52px_rgba(16,24,40,0.55)]"
      aria-labelledby="example-analysis-title"
    >
      <header className="flex items-start justify-between gap-5 border-b border-line px-5 py-4 sm:px-6 sm:py-5">
        <div>
          <p className="text-[0.6875rem] font-semibold tracking-[0.14em] text-brand uppercase">
            Example analysis
          </p>
          <h2
            id="example-analysis-title"
            className="mt-1.5 text-base font-semibold tracking-[-0.02em] text-ink sm:text-lg"
          >
            Anonymized sample vehicle
          </h2>
        </div>
        <p className="text-right text-xs leading-5 text-copy">
          5 verified listings
        </p>
      </header>

      <div className="grid grid-cols-2 border-b border-line lg:grid-cols-3">
        <div className="border-r border-line px-5 py-4 sm:px-6">
          <p className="text-xs text-copy">Insurer valuation</p>
          <p className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink tabular-nums sm:text-2xl">
            $20,000
          </p>
        </div>
        <div className="px-5 py-4 sm:px-6 lg:order-3 lg:border-l lg:border-line">
          <p className="text-xs text-copy">Median advertised</p>
          <p className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink tabular-nums sm:text-2xl">
            $22,200
          </p>
        </div>
        <div className="col-span-2 border-t border-line px-5 py-4 sm:px-6 lg:order-2 lg:col-span-1 lg:border-t-0">
          <p className="text-xs text-copy">Selected market range</p>
          <p className="mt-1 text-lg font-semibold tracking-[-0.025em] whitespace-nowrap text-ink tabular-nums sm:text-xl">
            $21,800–$22,600
          </p>
        </div>
      </div>

      <figure
        className="bg-ink px-5 py-5 text-white sm:px-6 sm:py-6"
        aria-label="Insurer valuation $20,000; selected advertised-price range $21,800 to $22,600; median advertised price $22,200."
      >
        <figcaption className="flex items-center justify-between gap-4 text-xs">
          <span className="font-semibold">Price position</span>
          <span className="text-white/60">One dollar scale</span>
        </figcaption>
        <div className="relative mt-7 h-12" aria-hidden="true">
          <div className="absolute inset-x-0 top-5 h-px bg-white/20" />
          <div className="absolute top-[0.8rem] left-[51%] h-4 w-[40%] rounded-sm bg-brand ring-1 ring-white/25" />
          <div className="absolute top-0 left-[21%] h-10 w-px bg-white">
            <span className="absolute -top-1 left-2 text-[0.6875rem] font-semibold whitespace-nowrap">
              Insurer
            </span>
          </div>
          <div className="absolute top-[0.6rem] left-[71%] size-4 -translate-x-1/2 rotate-45 border-2 border-ink bg-white" />
          <span className="absolute top-8 left-[71%] -translate-x-1/2 text-[0.6875rem] font-semibold whitespace-nowrap">
            Median
          </span>
        </div>
      </figure>

      <div className="px-5 py-4 sm:px-6 sm:py-5">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-sm font-semibold text-ink">Selected comparables</h3>
          <span className="text-xs text-copy">Strong matches</span>
        </div>
        <div className="mt-3 divide-y divide-line border-y border-line">
          {exampleComparables.map((comparable, index) => (
            <div
              key={comparable.label}
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-2.5 text-xs sm:grid-cols-[minmax(0,1fr)_auto_auto] ${
                index === 2 ? "hidden sm:grid" : ""
              }`}
            >
              <div className="min-w-0">
                <p className="font-medium text-ink">{comparable.label}</p>
                <p className="mt-0.5 text-copy sm:hidden">
                  {comparable.mileage} · {comparable.distance} away
                </p>
              </div>
              <p className="hidden text-copy sm:block">
                {comparable.mileage} · {comparable.distance} away
              </p>
              <p className="font-semibold text-ink tabular-nums">
                {comparable.price}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[0.6875rem] leading-5 text-copy">
          Illustrative example · advertised prices, not completed sales.
        </p>
      </div>
    </section>
  );
}
