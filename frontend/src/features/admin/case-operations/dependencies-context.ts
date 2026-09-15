import type { SupabaseClient } from "@supabase/supabase-js";
import { createContext, useContext } from "react";

import type { Database } from "@/lib/supabase/database.types";
import { createAdminOperationsService } from "@/features/admin/operations/service";
import type { AdminOperationsService } from "@/features/admin/operations/types";
import { createPaymentApprovalService, type PaymentApprovalService } from "@/features/admin/payment-approvals/service";

import {
  createStaffCaseOperationsService,
  type StaffCaseOperationsService,
} from "./service";

export interface AdminCaseOperationsDependencies {
  readonly caseService: StaffCaseOperationsService;
  readonly operationsService?: AdminOperationsService;
  readonly paymentApprovalService?: PaymentApprovalService;
}

export const AdminCaseOperationsDependenciesContext =
  createContext<AdminCaseOperationsDependencies | null>(null);

export function createAdminCaseOperationsDependencies(
  client: SupabaseClient<Database>,
): AdminCaseOperationsDependencies {
  return {
    caseService: createStaffCaseOperationsService(client),
    operationsService: createAdminOperationsService(client),
    paymentApprovalService: createPaymentApprovalService(client),
  };
}

export function useAdminCaseOperationsDependencies() {
  return useContext(AdminCaseOperationsDependenciesContext);
}
