import { createContext, useContext } from "react";

import type { AppraisalCaseService } from "@/features/cases/service";

export const AppraisalCaseServiceContext =
  createContext<AppraisalCaseService | null>(null);

export function useAppraisalCaseService() {
  return useContext(AppraisalCaseServiceContext);
}
