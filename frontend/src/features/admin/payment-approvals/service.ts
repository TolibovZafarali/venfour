import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";

export interface PaymentApprovalCase {
  caseId: string; customerId: string; customerName: string | null; customerEmail: string | null;
  vehicle: string; insurerValuation: number | null; preliminaryOutcome: string | null;
  classification: string; evidenceStrength: string; eligibleComparables: { current: number; historical: number };
  limitations: { label: string; description: string }[]; reportReady: true;
  lineage: Record<string, Json>; status: "awaiting_approval" | "held" | "declined"; canApprove: boolean;
}
export type PaymentApprovalDecision = "approved" | "held" | "declined";
export interface PaymentApprovalService {
  list(): Promise<PaymentApprovalCase[]>;
  decide(item: PaymentApprovalCase, decision: PaymentApprovalDecision, requestId: string): Promise<void>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const digest = /^[a-f0-9]{64}$/u;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Payment review response is invalid.");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Payment review response is invalid.");
  return value;
}
function optionalText(value: unknown): string | null { return value === null ? null : text(value); }
function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("Payment review response is invalid.");
  return Number(value);
}
export function parsePaymentApprovalCase(value: unknown): PaymentApprovalCase {
  const r = record(value), lineage = record(r.lineage), comparables = record(r.eligibleComparables);
  for (const key of ["caseId", "ownerId", "inputId", "sourceRunId", "reportId", "assessmentId"]) {
    if (!uuid.test(text(lineage[key]))) throw new Error("Payment review lineage is invalid.");
  }
  for (const key of ["documentDigest", "assessmentDigest", "assessmentPayloadDigest", "sourceDigest", "readinessDigest", "inputDigest"]) {
    if (!digest.test(text(lineage[key]))) throw new Error("Payment review lineage is invalid.");
  }
  if (lineage.caseId !== r.caseId || lineage.ownerId !== r.customerId || count(lineage.inputRevision) < 1
      || count(lineage.reportRevision) < 1 || lineage.assessmentVersion !== "1"
      || r.reportReady !== true || typeof r.canApprove !== "boolean"
      || !["awaiting_approval", "held", "declined"].includes(text(r.status))
      || !["POTENTIAL_UNDERVALUE", "MATERIAL_UNDERVALUE_SIGNAL"].includes(text(r.classification))
      || !["MODERATE", "STRONG"].includes(text(r.evidenceStrength))
      || (r.insurerValuation !== null && (typeof r.insurerValuation !== "number" || !Number.isFinite(r.insurerValuation) || r.insurerValuation <= 0))
      || !Array.isArray(r.limitations)) throw new Error("Payment review response is invalid.");
  return { caseId: text(r.caseId), customerId: text(r.customerId), customerName: optionalText(r.customerName),
    customerEmail: optionalText(r.customerEmail), vehicle: text(r.vehicle), insurerValuation: r.insurerValuation as number | null,
    preliminaryOutcome: optionalText(r.preliminaryOutcome), classification: text(r.classification), evidenceStrength: text(r.evidenceStrength),
    eligibleComparables: { current: count(comparables.current), historical: count(comparables.historical) },
    limitations: r.limitations.map(value => { const limitation = record(value); return { label: text(limitation.label), description: text(limitation.description) }; }),
    reportReady: true, lineage: lineage as Record<string, Json>, status: r.status as PaymentApprovalCase["status"], canApprove: r.canApprove };
}
export function createPaymentApprovalService(client: SupabaseClient<Database>): PaymentApprovalService {
  return {
    async list() {
      const { data, error } = await client.rpc("staff_payment_approval_queue");
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("Payment review queue is invalid.");
      return data.map(parsePaymentApprovalCase);
    },
    async decide(item, decision, requestId) {
      if (!uuid.test(requestId) || !["approved", "held", "declined"].includes(decision)) throw new Error("Payment review decision is invalid.");
      const checked = parsePaymentApprovalCase(item);
      const { data, error } = await client.rpc("staff_payment_approval_decide", {
        requested_case_id: checked.caseId, expected_lineage: checked.lineage,
        requested_decision: decision, requested_request_id: requestId,
      });
      if (error) throw error;
      const result = record(data);
      if (!uuid.test(text(result.id)) || result.decision !== decision || !Number.isFinite(Date.parse(text(result.createdAt)))) {
        throw new Error("The decision could not be confirmed. Refresh the queue.");
      }
    },
  };
}
