import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import type { AdminOperationsService } from "./types";
import {
  AdminOperationsResponseError,
  assertAdminResourceScope,
  normalizeAdminListOptions,
  normalizeAdminRecordRequest,
  normalizeAdminUuid,
  parseAdminOverview,
  parseAdminPage,
  parseAdminRow,
} from "./validation";

export { AdminOperationsResponseError } from "./validation";

/** Authorization failures cannot display previously fetched protected records. */
export function isAdminAuthorizationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; status?: unknown; statusCode?: unknown };
  return value.code === "42501" || value.code === "PGRST301" || value.code === "PGRST302" || value.code === "PGRST303" || value.status === 401 || value.status === 403 || value.statusCode === 401 || value.statusCode === 403;
}

export function createAdminOperationsService(client: SupabaseClient<Database>): AdminOperationsService {
  return {
    async list(resource, options) {
      const normalized = normalizeAdminListOptions(resource, options);
      const { data, error } = await client.rpc("staff_admin_list", {
        resource,
        search: normalized.search,
        filters: { ...normalized.filters },
        sort: normalized.sort,
        page: normalized.page,
        page_size: normalized.pageSize,
      });
      if (error) throw error;
      return parseAdminPage(data, resource, normalized);
    },
    async overview() {
      const { data, error } = await client.rpc("staff_admin_overview");
      if (error) throw error;
      return parseAdminOverview(data);
    },
    async customer(id) {
      const userId = normalizeAdminUuid(id);
      const { data, error } = await client.rpc("staff_admin_customer", { requested_user_id: userId });
      if (error) throw error;
      if (data === null) return null;
      const row = parseAdminRow(data);
      assertAdminResourceScope(row, "customers");
      if (row.customerId !== userId || row.id !== userId) {
        throw new AdminOperationsResponseError("The staff service returned a customer outside the requested scope.");
      }
      return row;
    },
    async case(id) {
      const caseId = normalizeAdminUuid(id);
      const { data, error } = await client.rpc("staff_admin_case", { requested_case_id: caseId });
      if (error) throw error;
      if (data === null) return null;
      const row = parseAdminRow(data);
      assertAdminResourceScope(row, "cases");
      if (row.caseId !== caseId || row.id !== caseId) {
        throw new AdminOperationsResponseError("The staff service returned a case outside the requested scope.");
      }
      return row;
    },
    async record(resource, id) {
      const requested = normalizeAdminRecordRequest(resource, id);
      const { data, error } = await client.rpc("staff_admin_record", {
        resource: requested.resource,
        requested_record_id: requested.id,
      });
      if (error) throw error;
      if (data === null) return null;
      const row = parseAdminRow(data);
      assertAdminResourceScope(row, resource);
      if (row.id !== requested.id) {
        throw new AdminOperationsResponseError("The staff service returned a record outside the requested scope.");
      }
      return row;
    },
  };
}
