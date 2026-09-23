import { environment } from "@/config/env";
import { createApiClient } from "@/lib/api/client";

export const factFields = ["vehicle_registration", "garaging_at_loss", "loss_location", "claim_type", "policy_use", "policy_issued"] as const;
export type FactField = typeof factFields[number];
export interface Assertion { field: string; value: string | null; provenance: string; reference: string; recorded_at: string }
export interface Facts { schema_version: "1"; assertions: Assertion[] }
export interface ProductResponse {
  context: {
    case_id: string; product_version: string; facts_revision: number; facts: Facts;
    candidates: string[]; conflicts: string[]; missing_facts: string[]; review_reasons: string[];
    status: string; report_label: string; method: string; authority: string;
    settlement_components: { component: string; status: string; note: string | null }[];
  };
  delivery: { state: string; reasons: string[]; authority_revision?: number; valid_until?: string } | null;
  locations: { code: string; name: string }[];
}
const client = createApiClient({ baseUrl: environment.apiBaseUrl });
const path = (caseId: string, staff = false) => `/api/v1/${staff ? "staff/" : ""}appraisal-cases/${encodeURIComponent(caseId)}/product`;
function validate(value: ProductResponse, caseId: string) {
  if (value?.context?.case_id !== caseId || value.context.facts?.schema_version !== "1" || !Array.isArray(value.context.facts.assertions) || !Array.isArray(value.locations)) throw new Error("Case details could not be verified. Reload before continuing.");
  return value;
}
export async function loadProduct(caseId: string, accessToken: string, staff = false) {
  return validate(await client.getAuthenticated<ProductResponse>(path(caseId, staff), { accessToken }), caseId);
}
export async function saveProduct(caseId: string, accessToken: string, revision: number, facts: Facts) {
  return validate(await client.postJson<ProductResponse>(path(caseId), { expected_revision: revision, facts }, { accessToken }), caseId);
}
export function confirmedValues(facts: Facts): Record<FactField, string> {
  return Object.fromEntries(factFields.map(field => {
    const values = [...new Set(facts.assertions.filter(a => a.field === field && a.value !== null).map(a => a.value))];
    return [field, values.length === 1 ? values[0] : ""];
  })) as Record<FactField, string>;
}
export function updatedFacts(facts: Facts, values: Record<FactField, string>, now: string): Facts {
  // Keep document assertions and unrelated facts. Conflicting evidence stays visible.
  return { schema_version: "1", assertions: [
    ...facts.assertions.filter(a => a.provenance !== "customer" || !factFields.includes(a.field as FactField)),
    ...factFields.map(field => ({ field, value: values[field] || null, provenance: "customer", reference: "customer-confirmed-product-intake", recorded_at: now })),
  ] };
}
