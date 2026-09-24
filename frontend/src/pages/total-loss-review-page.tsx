import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { applicationHref } from "@/app/site-boundary";
import { publicIntakeClosed } from "@/config/public-site";
import { supportEmail } from "@/config/support";
import { captureAttribution } from "@/features/measurement/attribution";
import "./total-loss-review-page.css";

export function TotalLossReviewPage() {
  const start = publicIntakeClosed ? "/contact" : applicationHref("/start?service=total-loss");
  const cta = <Link className="review-landing__cta" to={start} onClick={() => captureAttribution()}>
    {publicIntakeClosed ? "Contact Venfour" : "Review My Valuation"}<ArrowRight size={18} aria-hidden />
  </Link>;
  return <article className="review-landing">
    <header className="review-landing__hero">
      <p className="review-landing__eyebrow">Total-loss valuation review</p>
      <h1>Think your insurer’s total-loss valuation may be too low?</h1>
      <p className="review-landing__intro">Venfour reviews your insurer’s valuation report, vehicle details, and relevant market evidence to help you understand whether there is support for asking your insurer to reconsider the valuation.</p>
      <div className="review-landing__action">{cta}<p><strong>$199 per case</strong><span>One-time payment for the full review. Check eligibility first.</span></p></div>
      <p className="review-landing__note">{publicIntakeClosed ? "Online reviews are opening soon. Contact us for the current service status." : "Have your insurer’s complete valuation report ready. It is required for the paid review."}</p>
    </header>
    <section className="review-landing__section" aria-labelledby="review-scope">
      <div><p className="review-landing__eyebrow">A clearer view of the evidence</p><h2 id="review-scope">Understand what supports the valuation.</h2></div>
      <div className="review-landing__items">
        <div><h3>Your insurer’s report</h3><p>Vehicle specifications, comparable vehicles, condition information, and the adjustments shown in the report.</p></div>
        <div><h3>Your vehicle details</h3><p>The information you provide about mileage, equipment, and condition, together with the report’s description.</p></div>
        <div><h3>Relevant market evidence</h3><p>Comparable advertised vehicles and the differences that affect their usefulness. Asking prices are evidence, not completed sale prices.</p></div>
      </div>
    </section>
    <section className="review-landing__section" aria-labelledby="review-delivery">
      <div><p className="review-landing__eyebrow">What you receive</p><h2 id="review-delivery">Findings you can understand and use.</h2></div>
      <div><p>A completed valuation review and downloadable Total-Loss Valuation Report explaining the findings, supporting market evidence, and limitations.</p><p>When the evidence supports reconsideration, Venfour helps you prepare a request and supporting materials for your insurer. You review and send the message yourself. You can return with the insurer’s response for help understanding the next step.</p><p>A higher valuation, payment, or insurer acceptance is not guaranteed. Outcomes depend on the evidence and the insurer’s response.</p></div>
    </section>
    <section className="review-landing__process" aria-labelledby="review-process">
      <p className="review-landing__eyebrow">The process</p><h2 id="review-process">Start with your report.</h2>
      <ol><li><span>01</span><h3>Share your valuation details</h3><p>Use the existing secure intake to add your vehicle information and insurer valuation report.</p></li><li><span>02</span><h3>Confirm eligibility</h3><p>Venfour checks the report and available evidence. If your case is eligible, you can purchase the full review for $199.</p></li><li><span>03</span><h3>Review your findings</h3><p>Read the completed report and decide what to discuss with your insurer. You remain in control of your claim.</p></li></ol>
    </section>
    <section className="review-landing__section" aria-labelledby="review-refund">
      <div><p className="review-landing__eyebrow">Fair-Result Refund Policy</p><h2 id="review-refund">Two separate refund protections.</h2></div>
      <div><p><strong>No supported dispute:</strong> if the completed review does not reasonably support challenging the insurer’s valuation, Venfour refunds the full purchase automatically. You keep access to your completed review and report.</p><p><strong>Supported dispute, final increase under $1,000:</strong> after following the Venfour-supported reconsideration process, you may request a full refund if the final verified vehicle-value increase is below $1,000. Submit the required documentation within 30 days of the insurer’s final written response. Exactly $1,000 does not qualify.</p><p>These are refund protections, not a promise of a higher payout. <Link to="/refund-policy">Read the full refund policy and requirements.</Link></p></div>
    </section>
    <section className="review-landing__close" aria-labelledby="review-next"><h2 id="review-next">Make your next step an informed one.</h2>{cta}<p>Venfour LLC provides an independent evidence review. We are not your insurer, a law firm, or a government agency. We do not represent you or negotiate directly with your insurer. The service is not a legal opinion or a formal appraisal-clause appraisal.</p><p>Questions? {supportEmail ? <a href={`mailto:${supportEmail}`}>{supportEmail}</a> : <Link to="/contact">Contact Venfour</Link>}.</p><nav aria-label="Review policies"><Link to="/privacy">Privacy Policy</Link><Link to="/terms">Terms of Use</Link><Link to="/refund-policy">Refund Policy</Link><Link to="/contact">Contact &amp; support</Link></nav></section>
  </article>;
}
