import { ArrowRight } from "lucide-react";
import { Link, useParams } from "react-router";
import { applicationHref, publicHref } from "@/app/site-boundary";
import { publicIntakeClosed } from "@/config/public-site";
import { fullReviewPriceLabel } from "@/config/review-price";
import { findState } from "@/features/states/states";
import { NotFoundPage } from "@/pages/not-found-page";
import { publicTextLinkClassName } from "@/pages/public-page";

export function StatePage() {
  const { stateSlug } = useParams();
  const state = findState(stateSlug);
  if (!state) return <NotFoundPage />;
  const locationName = state.code === "DC" ? "the District of Columbia" : state.name;

  const action = <Link className="state-page__action" to={publicIntakeClosed ? "/contact" : applicationHref("/start?service=total-loss")}>
    {publicIntakeClosed ? "Contact Venfour" : "Start my free valuation"}<ArrowRight size={16} aria-hidden />
  </Link>;

  return <article className="state-page">
    <div className="state-page__inner">
      <Link to={publicHref("/#states")} className={publicTextLinkClassName}>All states <span aria-hidden>↗</span></Link>
      <header className="state-page__header">
        <span className="states-eyebrow">Venfour in {locationName}</span>
        <h1>A clearer view of your total-loss valuation in {locationName}.</h1>
        <p>Understand your vehicle’s value, review the available market evidence, and prepare for a more informed conversation with your insurer. Venfour’s online process works in {locationName}, just as it does across the country.</p>
        {action}
        <p className="!text-sm">{publicIntakeClosed ? "Online reviews are opening soon." : "Start free. No payment required for your preliminary valuation."}</p>
      </header>
      <div className="state-page__sections">
        <section aria-labelledby="state-free-title">
          <h2 id="state-free-title">Start with a free valuation</h2>
          <ol>
            <li>Add your insurer’s valuation report, or start with your vehicle details if you do not have it yet.</li>
            <li>Confirm the details used for your estimate, including your vehicle’s mileage and location.</li>
            <li>See a preliminary valuation based on the information and market evidence available. Review the findings before deciding whether to continue.</li>
          </ol>
        </section>
        <section aria-labelledby="state-details-title">
          <h2 id="state-details-title">What to have ready</h2>
          <ul>
            <li>Your vehicle’s VIN, or its year, make, model, and trim.</li>
            <li>Mileage, vehicle ZIP code, and the date of loss, if known.</li>
            <li>Your insurer’s complete valuation report and vehicle value, if available.</li>
            <li>Your name and email so you can return to your review.</li>
          </ul>
          <p className="mt-4">You can begin without an insurer report. A complete report is required before the paid Total-Loss Valuation Report.</p>
        </section>
        <section aria-labelledby="state-continue-title">
          <h2 id="state-continue-title">If you continue with Venfour</h2>
          <p>When the full review is available for your case, you can choose <strong>Get my full review</strong> for a <strong>one-time payment of {fullReviewPriceLabel}</strong>. You review the price and terms before paying.</p>
          <p>The full review examines your insurer’s report and available vehicle comparisons, explains what the evidence supports, and helps you prepare a message to your adjuster. You decide what to send and remain in control of the conversation.</p>
          <p>Your fee is refunded automatically if the review does not support a dispute. A separate, conditional refund may apply if the insurer’s final written response leaves an eligible valuation increase under $1,000. <Link to="/refund-policy" className={publicTextLinkClassName}>Read the Fair-Result Refund Policy</Link> for the full terms.</p>
        </section>
        <section aria-labelledby="state-scope-title">
          <h2 id="state-scope-title">Evidence, clearly explained</h2>
          <p>In {locationName}, Venfour uses the same evidence-based review process offered nationwide. Vehicle details, location, and available comparisons inform the review; evidence and results vary by vehicle and case.</p>
          <p>An advertised price is not a completed sale or a guaranteed settlement. Venfour does not negotiate with your insurer, determine what you are legally owed, or act as your appraiser under an appraisal clause.</p>
          <p>This page explains the service. It does not provide {state.name}-specific legal, tax, deadline, or policy guidance.</p>
          <Link to="/methodology" className={publicTextLinkClassName}>How we review the evidence <ArrowRight size={16} aria-hidden /></Link>
        </section>
      </div>
      <div className="state-page__next">
        <p>Ready to understand your valuation in {locationName}?</p>
        {action}
      </div>
    </div>
  </article>;
}
