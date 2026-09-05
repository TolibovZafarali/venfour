import { environment } from "@/config/env";
import { createApiClient } from "@/lib/api/client";

const apiClient = createApiClient({ baseUrl: environment.apiBaseUrl });

interface CaseAnalysisBase {
  readonly status: "not_submitted" | "processing" | "completed" | "failed";
}

export interface NotSubmittedCaseAnalysis extends CaseAnalysisBase {
  readonly status: "not_submitted";
}

export interface ProcessingCaseAnalysis extends CaseAnalysisBase {
  readonly status: "processing";
  readonly attemptCount: number;
  readonly processingExpiresAt: string | null;
}

export interface CompletedCaseAnalysis extends CaseAnalysisBase {
  readonly status: "completed";
  readonly attemptCount: number;
  readonly intakeCorrectionAllowed: boolean;
  readonly runId: string;
}

export interface FailedCaseAnalysis extends CaseAnalysisBase {
  readonly status: "failed";
  readonly attemptCount: number;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
  readonly retryable: boolean;
}

export type CaseAnalysisStatus =
  | NotSubmittedCaseAnalysis
  | ProcessingCaseAnalysis
  | CompletedCaseAnalysis
  | FailedCaseAnalysis;

function caseAnalysisPath(caseId: string) {
  return `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/analysis`;
}

export function getCaseAnalysis(
  caseId: string,
  accessToken: string,
  signal?: AbortSignal,
) {
  return apiClient.getAuthenticated<CaseAnalysisStatus>(
    caseAnalysisPath(caseId),
    { accessToken, signal },
  );
}

export function submitCaseAnalysis(
  caseId: string,
  accessToken: string,
  signal?: AbortSignal,
) {
  return apiClient.postAuthenticated<CaseAnalysisStatus>(
    caseAnalysisPath(caseId),
    { accessToken, signal },
  );
}
