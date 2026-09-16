export { buildTotalLossMailto, copyPreparedEmail, formatCommercePrice, openHostedCheckout, openPublishedReport, reservePublishedReportPreview } from "../../src/features/total-loss-claim/browser-actions";

export function openDefaultEmailApp() {
  window.dispatchEvent(new CustomEvent("workspace-email-simulated"));
}
