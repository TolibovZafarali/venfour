import type { Enums } from "@/lib/supabase/database.types";

export type AppraisalServiceType = Enums<"appraisal_service_type">;

export type AppraisalCaseStatus = Enums<"appraisal_case_status">;

export interface AppraisalCase {
  readonly id: string;
  readonly userId: string;
  readonly serviceType: AppraisalServiceType;
  readonly status: AppraisalCaseStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastActivityAt: string;
}

export interface CreateAppraisalCaseInput {
  readonly userId: string;
  readonly serviceType: AppraisalServiceType;
}

export interface CreateOrGetAppraisalCaseInput
  extends CreateAppraisalCaseInput {
  readonly caseId: string;
}

export interface GetAppraisalCaseInput {
  readonly userId: string;
  readonly caseId: string;
}

export interface GetRecentDraftAppraisalCaseInput {
  readonly userId: string;
  readonly serviceType: AppraisalServiceType;
}

export type TouchAppraisalCaseInput = GetAppraisalCaseInput;
