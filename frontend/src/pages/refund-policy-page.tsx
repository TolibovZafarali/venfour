import { publicHref } from "@/app/site-boundary";

const policyLinkClassName = "font-medium text-neutral-900 underline decoration-neutral-400 underline-offset-4 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-4";

export function RefundPolicyPage() {
  return (
    <article className="w-full bg-white text-neutral-900">
      <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
        <header>
          <p className="text-sm text-neutral-600">Total-Loss Review Package</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">Fair-Result Refund Policy</h1>
          <p className="mt-5 text-base leading-7 text-neutral-600">
            Your purchase has two separate refund protections. The final-outcome
            guarantee is an additional right; it does not replace the automatic
            refund when our review does not support a dispute. You only need to
            satisfy the path that applies to your case.
          </p>
          <p className="mt-5 text-sm text-neutral-600">Effective September 15, 2026</p>
        </header>

        <div className="mt-9 space-y-9 text-base leading-7 text-neutral-600 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:leading-snug [&_h2]:tracking-tight [&_h2]:text-neutral-900 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-neutral-900 [&_p]:mt-3 [&_section]:border-t [&_section]:border-neutral-200 [&_section]:pt-8">
          <section aria-labelledby="automatic-refund-heading">
            <h2 id="automatic-refund-heading">1. No supported dispute — automatic refund</h2>
            <p>
              If Venfour’s completed review determines that the evidence does not
              reasonably support challenging your insurer’s valuation, you receive
              a full refund automatically. You retain access to your completed
              review and report while the refund is processed and after it is completed.
            </p>
            <p>
              You do not need to submit a reconsideration request, obtain a final
              insurer response, or request this refund. The requirements and
              30-day deadline for manual requests below do not apply to this path.
            </p>
          </section>

          <section aria-labelledby="manual-refund-heading">
            <h2 id="manual-refund-heading">2. Supported dispute, final increase under $1,000 — manual refund</h2>
            <p>
              If Venfour’s completed review supports continuing with a valuation
              dispute, you may request a full refund after following the
              Venfour-supported reconsideration process if your insurer’s final
              verified vehicle valuation increase is less than $1,000.
            </p>
            <p>
              You must have submitted the Venfour-supported reconsideration
              request and supporting evidence to your insurer and provide
              sufficient documentation of its final outcome. Request the refund
              within 30 days after receiving the insurer’s final written response.
            </p>

            <div className="mt-7">
              <h3>How the $1,000 threshold is calculated</h3>
              <p>
                We compare the insurer’s final verified vehicle valuation, or
                actual cash value (ACV), with the insurer valuation associated
                with your case at the time of purchase. We measure only the
                vehicle valuation relevant to Venfour’s review, not your final
                settlement check or Venfour’s initial estimate of a possible increase.
              </p>
              <table className="mt-4 w-full text-left text-sm leading-6">
                <caption className="sr-only">Final verified increase and eligibility under the manual refund path</caption>
                <thead className="border-b border-neutral-200 text-neutral-900">
                  <tr><th scope="col" className="w-2/5 py-3 pr-4 font-medium">Verified increase</th><th scope="col" className="py-3 font-medium">Threshold result</th></tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  <tr><th scope="row" className="py-3 pr-4 font-medium text-neutral-900">$0–$999.99</th><td className="py-3">Qualifies if the other manual requirements are met</td></tr>
                  <tr><th scope="row" className="py-3 pr-4 font-medium text-neutral-900">$1,000 or more</th><td className="py-3">Does not qualify under this path</td></tr>
                </tbody>
              </table>
              <p>
                A $0 increase qualifies. An increase of exactly $1,000 does not.
                Deductibles, loan payoff, injury payments, rental reimbursement,
                storage charges, unrelated coverage, and other unrelated
                settlement amounts are excluded from the comparison.
              </p>
            </div>

            <div className="mt-7">
              <h3>How to request a manual refund</h3>
              <ol className="mt-3 list-decimal space-y-3 pl-5 marker:text-neutral-900">
                <li><a href={publicHref("/contact?topic=fair-result-refund")} className={policyLinkClassName}>Contact Venfour</a> through the published support channel within the 30-day deadline. Identify your case and the date you received the insurer’s final written response.</li>
                <li>Provide the final written response or revised valuation and documentation showing that you submitted the supported reconsideration request and evidence.</li>
                <li>Venfour manually verifies the original valuation, final valuation, and whether the required reconsideration process was followed. We may request additional documentation reasonably necessary to verify eligibility.</li>
                <li>If eligible, Venfour approves and processes a full refund of the applicable Venfour purchase through the original payment method.</li>
              </ol>
            </div>

            <div className="mt-7">
              <h3>Documentation and eligibility limits</h3>
              <p>
                Supporting documents may include the insurer valuation in effect
                when you purchased, a copy or confirmation of the request and
                evidence you sent, and a revised valuation report, written
                decision, revised offer, or other verifiable insurer documentation
                establishing the final valuation and response date.
              </p>
              <p>
                An initial estimate or an interim insurer response does not
                establish the final outcome. Customers who abandon the
                reconsideration process before receiving an outcome are not
                eligible under this manual path. Fraudulent, altered, misleading,
                or materially incomplete documentation can make a request ineligible.
              </p>
            </div>
          </section>

          <section aria-labelledby="refund-limitations-heading">
            <h2 id="refund-limitations-heading">Important limitations</h2>
            <p>
              A higher insurer valuation or settlement is not guaranteed.
              Venfour does not negotiate directly with your insurer. You remain
              responsible for reviewing and sending the reconsideration request
              and evidence and for communicating with your insurer.
            </p>
            <p>
              For questions about either protection, use the{" "}
              <a href={publicHref("/contact?topic=fair-result-refund")} className={policyLinkClassName}>refund support contact</a>.
              The <a href={publicHref("/terms")} className={policyLinkClassName}>Terms of Use</a> also describe the service and its limits.
            </p>
          </section>
        </div>
      </div>
    </article>
  );
}
