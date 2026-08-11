import { Link } from "react-router";

import { Button } from "@/components/ui/button";

export function HomePage() {
  return (
    <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-16 md:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)] md:py-24">
      <div className="max-w-3xl">
        <p className="mb-4 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Total-loss valuation guidance
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Understand the evidence behind your vehicle valuation.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
          Venfour is building a clear, self-service way to review an insurer's
          valuation and the independent market evidence that matters.
        </p>
        <div className="mt-8">
          <Button asChild size="lg">
            <Link to="/workspace">Open workspace</Link>
          </Button>
        </div>
      </div>
      <aside className="rounded-2xl border bg-card p-6 text-card-foreground shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">
          Frontend foundation
        </p>
        <h2 className="mt-2 text-xl font-semibold">Focused on the current product</h2>
        <p className="mt-3 leading-7 text-muted-foreground">
          This shell establishes navigation, data access, and reusable UI
          foundations. The report-upload and valuation-review experience will
          be designed in the next phase.
        </p>
      </aside>
    </section>
  );
}
