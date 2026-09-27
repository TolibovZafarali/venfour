import { Link } from "react-router";
import { publicHref } from "@/app/site-boundary";
import { fullReviewPriceLabel } from "@/config/review-price";
import { publicTextLinkClassName } from "@/pages/public-page";

export function ValuationReviewService() {
  return <>
    <p>Venfour helps you understand your insurer’s valuation, review available market evidence, and prepare a clearer conversation with your adjuster.</p>
    <div className="state-guide__service-stage">
      <p className="state-guide__eyebrow">Your starting point</p>
      <h3>Begin with a free preliminary valuation.</h3>
      <p>Upload your insurer’s report, or start with your vehicle details if you do not have the report yet. Confirm your mileage and location, then review the preliminary findings before deciding whether to continue.</p>
    </div>

    <div className="state-guide__service-stage">
      <p className="state-guide__eyebrow">If you choose to continue</p>
      <h3>Choose a full review for a one-time payment of <span className="state-guide__price">{fullReviewPriceLabel}</span>.</h3>
      <p>When the full review is available for your case, <strong>Get my full review</strong> includes examination of your insurer’s report and available vehicle comparisons, an explanation of what the evidence supports, and help preparing a message to your adjuster.</p>
      <p>A complete insurer valuation report is required for the paid review. You review the price and terms before paying.</p>
      <p>You decide what to send and remain in control of the conversation. Venfour does not negotiate directly with your insurer or act as your appointed appraiser under an appraisal clause.</p>
    </div>

    <div className="state-guide__protection">
      <h3>Your purchase includes two refund protections.</h3>
      <ul>
        <li><strong>If the completed review does not support a dispute:</strong> your fee is refunded automatically. You keep access to your completed review and report.</li>
        <li><strong>If the review supports a dispute but the final verified vehicle-value increase is under $1,000:</strong> you may request a full refund after completing the Venfour-supported reconsideration process and providing the required documentation. The request must be made within 30 days after receiving the insurer’s final written response.</li>
      </ul>
      <p>The second protection measures the change in vehicle valuation, rather than the total settlement check. Eligibility conditions apply. <Link to={publicHref("/refund-policy")} className={publicTextLinkClassName}>Read the Fair-Result Refund Policy</Link>.</p>
    </div>
  </>;
}
