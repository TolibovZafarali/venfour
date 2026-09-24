import { ChevronRight, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { publicHref } from "@/app/site-boundary";
import { fullReviewPriceLabel } from "@/config/review-price";
import "./review-offer.css";

export function RefundProtectionDetails() {
  return <>
    <p>If our completed review does not support a valuation dispute, your review fee is refunded automatically. Your report stays available.</p>
    <p>If our review supports a dispute and you follow our recommended process, you may request a full refund of your review fee when your insurer’s final verified vehicle valuation increases by less than <strong>$1,000</strong>.</p>
    <p>For this requested refund, provide documentation of the final outcome and apply within 30 days of the insurer’s final written response.</p>
    <a href={publicHref("/refund-policy")} target="_blank" rel="noopener noreferrer">See eligibility and refund terms<span className="sr-only"> (opens in a new tab)</span></a>
  </>;
}

export function ReviewPrice() {
  return <p className="review-offer-price"><span>Full review & report</span><span><strong>{fullReviewPriceLabel}</strong> <span>one-time</span></span></p>;
}

export function ReviewRefundProtection() {
  return <Dialog.Root>
    <Dialog.Trigger asChild>
      <button type="button" className="review-refund-trigger">
        <span><strong>Your review fee, protected.</strong><span>Final increase under $1,000? See eligibility.</span></span>
        <ChevronRight aria-hidden />
      </button>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="review-refund-overlay" />
      <Dialog.Content className="review-refund-dialog">
        <Dialog.Title>Your review fee, protected.</Dialog.Title>
        <Dialog.Description>Two refund protections for your full review.</Dialog.Description>
        <div className="review-refund-terms"><RefundProtectionDetails /></div>
        <Dialog.Close asChild><button type="button" className="review-refund-close" aria-label="Close refund protection"><X aria-hidden /></button></Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
