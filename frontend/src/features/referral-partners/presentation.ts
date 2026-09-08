export const formatPartnerMoney = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount / 100);
export const formatPartnerDate = (value?: string | null) => value ? new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—";
const statusLabels: Record<string, string> = { onboarding: "Onboarding", awaiting_approval: "Awaiting Venfour approval", active: "Active", pending: "Pending", accepted: "Accepted", revoked: "Revoked", expired: "Expired", superseded: "Superseded", prepared: "Ready to sign", partner_signed: "Awaiting countersignature", countersigned: "Signed by both parties", queued: "Queued", sending: "Sending", sent: "Sent", failed: "Needs attention", ready: "Ready", processing: "Preparing", published: "Published", draft: "Draft" };
export const partnerStatusLabel = (status: string) => statusLabels[status] ?? "Pending update";
export const partnerDeliveryLabel = (status: string) => ({ queued: "Queued", processing: "Sending", completed: "Sent", failed: "Retry pending", review: "Needs review", canceled: "Canceled" })[status] ?? "Pending update";

export const partnerEventLabel = (event: string) => ({
  "partner.created": "Partner record created",
  "partner.edited": "Proposed partner details updated",
  "partner.profile_saved": "Business profile saved",
  "partner.activated": "Partnership activated",
  "invitation.invite": "Invitation queued",
  "invitation.resend": "Replacement invitation queued",
  "invitation.revoke": "Invitation revoked",
  "invitation.accepted": "Invitation accepted",
  "agreement.prepared": "Agreement prepared for review",
  "agreement.partner_signed": "Partner signed agreement",
  "agreement.countersigned": "Venfour countersigned agreement",
  "agreement.superseded": "Earlier agreement superseded",
  "agreement.copy_requested": "Another PDF copy requested",
  "document.retry_requested": "PDF preparation retry requested",
  "document.ready": "Signed PDF prepared",
  "email.accepted": "Email accepted for delivery",
})[event] ?? "Partner record updated";
