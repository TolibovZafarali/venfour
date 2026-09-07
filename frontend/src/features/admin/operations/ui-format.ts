import { formatCaseOperationDateTime } from "@/features/admin/case-operations/format";

export function safeAdminReturnTo(value: string | null | undefined) {
  if (!value || !/^\/admin\/cases(?:\?[^#]*)?$/u.test(value)) return "/admin/cases";
  return value;
}

export function adminCaseHref(caseId: string, tab: string = "overview", returnTo?: string) {
  const params = new URLSearchParams();
  if (tab !== "overview") params.set("tab", tab);
  if (returnTo) params.set("returnTo", safeAdminReturnTo(returnTo));
  const query = params.toString();
  return `/admin/cases/${encodeURIComponent(caseId)}${query ? `?${query}` : ""}`;
}

export function humanizeAdminCode(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const labels: Record<string, string> = { "message.customer_reported_sent": "Customer reported sending", "follow_up.customer_reported_sent": "Customer reported sending a follow-up", "message.email_app_opened": "Customer opened email app", waiting_ai_review: "Automated review", ai_review: "Automated review", waiting_human_review: "Staff review", human_review_required: "Staff review required", initial_analysis: "Free valuation", paid_package: "Paid review", insurer_response: "Insurer response", uploaded: "Uploaded", generated: "Generated", refunded_access_retained: "Refunded · access retained" };
  const display = /^[A-Z][A-Z0-9_]+$/u.test(value) ? value.toLowerCase() : value;
  return labels[value] ?? display.replace(/[_.-]+/gu, " ").replace(/^./u, character => character.toUpperCase());
}

export function adminActivityTitle(value: string) {
  return /^[a-z][a-z_]*\.[a-z_.]+$/u.test(value) ? humanizeAdminCode(value) : value;
}

export function adminStatusTone(value: string | null | undefined): "neutral" | "success" | "warning" | "danger" {
  if (value && ["analysis_failed", "failed", "terminal_failed", "revoked", "suspended", "disputed", "needs_attention"].includes(value)) return "danger";
  if (value && ["retryable_failed", "pending", "refund_pending", "review_required", "human_review_required", "waiting_human_review", "new_evidence_required"].includes(value)) return "warning";
  if (value && ["analysis_complete", "completed", "published", "paid", "succeeded", "active", "ready", "confirmed"].includes(value)) return "success";
  return "neutral";
}

export function adminMoney(amount: number | null | undefined, currency: string | null | undefined) {
  if (amount === null || amount === undefined || !currency) return "Not recorded";
  if (!Number.isSafeInteger(amount) || amount < 0) return "Amount unavailable";
  if (!Intl.supportedValuesOf("currency").includes(currency)) return `${currency} ${amount} minor units`;
  try {
    const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "code" });
    const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amount / 10 ** fractionDigits);
  } catch { return `${currency} ${amount} minor units`; }
}

export function formatAdminFact(label: string, value: string | null) {
  if (value === null || value === "") return "Not recorded";
  if (value === "true") return "Yes";
  if (value === "false") return "No";
  if (/^\d{4}-\d{2}-\d{2}[ T]/u.test(value) && Number.isFinite(Date.parse(value))) return formatCaseOperationDateTime(value);
  const money = /^([A-Z]{3}) (\d+) minor units$/u.exec(value);
  if (money && Number.isSafeInteger(Number(money[2]))) return adminMoney(Number(money[2]), money[1]);
  if (/status|failure|reason|kind|phase|task|resolution|policy|event|category|associated entity/iu.test(label) && /^[A-Za-z][A-Za-z_.-]+$/u.test(value)) return humanizeAdminCode(value);
  return value;
}
