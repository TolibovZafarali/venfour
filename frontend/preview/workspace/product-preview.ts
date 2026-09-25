import configuration from "../../../venfour/data/nationwide_product_v1.json";
import type { Facts, ProductResponse } from "@/features/nationwide/product-api";

const storageKey = "venfour-workspace-product-facts";
type SavedFacts = { revision: number; facts: Facts };

export function resetProductPreview() {
  localStorage.removeItem(storageKey);
}

export function productPreview(caseId: string, method: string, body?: { expected_revision: number; facts: Facts }) {
  const cases = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Record<string, SavedFacts>;
  const saved = cases[caseId] ?? { revision: 0, facts: { schema_version: "1", assertions: [] } };
  if (method === "POST") {
    if (!body || body.expected_revision !== saved.revision) {
      return Response.json({ message: "Reload the latest location details." }, { status: 409 });
    }
    saved.facts = body.facts;
    saved.revision += 1;
    cases[caseId] = saved;
    localStorage.setItem(storageKey, JSON.stringify(cases));
  }
  const response: ProductResponse = {
    context: {
      case_id: caseId, product_version: configuration.version,
      facts_revision: saved.revision, facts: saved.facts,
      candidates: [], conflicts: [], missing_facts: [], review_reasons: [],
      status: "PRODUCT_REVIEW_REQUIRED", report_label: "Total-Loss Valuation Report",
      method: "generic_product_method", authority: "not_determined_by_product_configuration",
      settlement_components: [],
    },
    delivery: null,
    locations: configuration.jurisdictions.map(({ code, name }) => ({ code, name })),
  };
  return Response.json(response);
}
