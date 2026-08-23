import type { SupabaseClient } from "@supabase/supabase-js";
import { createContext, useContext } from "react";

import type { Database } from "@/lib/supabase/database.types";

import {
  createStaffCaseOperationsService,
  type StaffCaseOperationsService,
} from "./service";

export interface AdminCaseOperationsDependencies {
  readonly caseService: StaffCaseOperationsService;
}

export const AdminCaseOperationsDependenciesContext =
  createContext<AdminCaseOperationsDependencies | null>(null);

export function createAdminCaseOperationsDependencies(
  client: SupabaseClient<Database>,
): AdminCaseOperationsDependencies {
  return {
    caseService: createStaffCaseOperationsService(client),
  };
}

export function useAdminCaseOperationsDependencies() {
  return useContext(AdminCaseOperationsDependenciesContext);
}
