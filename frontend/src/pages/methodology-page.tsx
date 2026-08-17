import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { PublicPage, PublicPageSection } from "@/pages/public-page";

const methodologySteps = [
  {
    title: "Read the CCC report",
    description:
      "Venfour uses model-assisted document reading to identify the facts in the uploaded report, including the loss vehicle, CCC value, listed comparables, and disclosed adjustments.",
  },
  {
    title: "Structure and check the report facts",
    description:
      "The extracted information must fit a defined report structure before it can enter the analysis. Document reading assists with extraction; it does not independently decide the final assessment.",
  },
  {
    title: "Search for external market evidence",
    description:
      "Venfour searches external vehicle-market data using the loss vehicle and the ZIP code supplied for the review.",
  },
  {
    title: "Evaluate comparable vehicles",
    description:
      "Candidates are checked for vehicle identity and evaluated consistently for factors such as model, year, trim, mileage, and distance. The comparison rules are deterministic rather than a free-form model opinion.",
  },
  {
    title: "Prefer reliable loss-date evidence",
    description:
      "When available and verifiable, evidence tied to the date of loss is preferred because it is closer to the valuation date. Venfour checks available listing history before treating a past listing as loss-date evidence.",
  },
  {
    title: "Use current evidence carefully",
    description:
      "If reliable loss-date evidence is not sufficient, current advertised listings can provide market context. Current inventory is identified clearly and is not presented as though it existed on the loss date.",
  },
  {
    title: "Compare selected evidence with CCC",
    description:
      "Venfour compares the selected external advertised-price evidence with the CCC adjusted vehicle value and summarizes the observed range and central value.",
  },
  {
    title: "Classify the result conservatively",
    description:
      "The result follows defined analysis rules that account for evidence quantity, consistency, timing, and the size of any observed difference. When evidence is sparse or conflicting, the result says so.",
  },
] as const;

export function MethodologyPage() {
  return (
    <PublicPage
      eyebrow="Methodology"
      title="A structured review of report facts and market evidence"
      introduction="Venfour separates document reading from the evidence rules that produce the assessment. The goal is a reproducible, understandable review—not an automated opinion about what an insurer legally owes."
    >
      <ol aria-label="How a Venfour analysis works">
        {methodologySteps.map((step, index) => (
          <li
            key={step.title}
            className="grid gap-3 border-t border-neutral-200 py-7 first:border-t-0 first:pt-0 sm:grid-cols-[3rem_minmax(0,1fr)] sm:gap-5 sm:py-8"
          >
            <span className="text-sm font-medium tabular-nums text-neutral-400">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.015em] text-neutral-950">
                {step.title}
              </h2>
              <p className="mt-2 leading-7 text-neutral-600">
                {step.description}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <PublicPageSection title="Important limitations" className="mt-3">
        <p>
          External listings are evidence of advertised prices, not proof of
          completed sale prices. Venfour does not independently inspect the
          vehicles, verify every seller statement, or reproduce all condition,
          equipment, mileage, and negotiation adjustments that might affect a
          final value.
        </p>
        <p>
          Historical market data may be unavailable or incomplete. Current
          listings can help provide context, but they are not interchangeable
          with evidence verified for the loss date. These limitations are shown
          in each analysis where they matter.
        </p>
      </PublicPageSection>

      <PublicPageSection title="What the assessment is for">
        <p>
          Venfour is designed to help a vehicle owner understand a CCC valuation
          and discuss relevant evidence more knowledgeably. It does not
          guarantee a settlement change, determine legal rights, or replace
          advice from a qualified appraiser or attorney when one is needed.
        </p>
        <Button asChild className="mt-2" size="lg">
          <Link to="/">Start a valuation review</Link>
        </Button>
      </PublicPageSection>
    </PublicPage>
  );
}
