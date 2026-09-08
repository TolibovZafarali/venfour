import { AdminCollection } from "@/features/admin/operations/collection";
import { caseFilters } from "@/features/admin/operations/page-options";

export function AdminCaseOperationsPage() {
  return <AdminCollection resource="cases" title="Cases" description="Every total-loss case, its current stage, and any recorded issues." searchPlaceholder="Search customer, email, vehicle, or case ID" filters={caseFilters} />;
}
