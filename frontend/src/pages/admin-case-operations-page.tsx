import { AdminCollection } from "@/features/admin/operations/collection";
import { caseFilters } from "@/features/admin/operations/page-options";

export function AdminCaseOperationsPage() {
  return <AdminCollection resource="cases" title="Cases" description="A clear view of every total-loss case, from first intake through the ongoing customer journey." searchPlaceholder="Search customer, email, vehicle, or case ID" filters={caseFilters} />;
}
