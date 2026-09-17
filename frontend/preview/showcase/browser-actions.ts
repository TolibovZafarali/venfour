export { buildTotalLossMailto, copyPreparedEmail, formatCommercePrice, openPublishedReport, reservePublishedReportPreview } from "../../src/features/total-loss-claim/browser-actions";
export function openDefaultEmailApp() { /* Customer-controlled send is recorded locally by the real confirmation form. */ }
export function openHostedCheckout() { throw new Error("External checkout is unavailable in this local case."); }
