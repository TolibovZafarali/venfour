import type { Enums } from "@/lib/supabase/database.types";

export type AppraisalServiceType = Enums<"appraisal_service_type">;

export type AppraisalCaseStatus = Enums<"appraisal_case_status">;

export type CaseOperationStage = Enums<"case_operation_stage">;

export type TotalLossAnalysisStatus = Enums<"total_loss_analysis_status">;

export interface AppraisalCase {
  readonly id: string;
  readonly userId: string;
  readonly serviceType: AppraisalServiceType;
  readonly status: AppraisalCaseStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastActivityAt: string;
  readonly caseStage?: CaseOperationStage;
  readonly claimResumeTask?: string | null;
  readonly needsAttention?: boolean;
  readonly reportUploadedAt?: string | null;
  readonly analysisStatus?: TotalLossAnalysisStatus | null;
  readonly analysisAttemptCount?: number | null;
  readonly analysisRetryable?: boolean | null;
  readonly analysisFailureCode?: string | null;
  readonly analysisProcessingExpiresAt?: string | null;
}

export interface CreateAppraisalCaseInput {
  readonly userId: string;
  readonly serviceType: AppraisalServiceType;
}

export interface CreateOrGetAppraisalCaseInput extends CreateAppraisalCaseInput {
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

export interface GetOrCreateTotalLossDraftInput {
  readonly userId: string;
}

export type TouchAppraisalCaseInput = GetAppraisalCaseInput;
