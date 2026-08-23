export type CaseOperationServiceType = "total_loss" | "diminished_value";

export type CaseOperationStatus =
  | "draft"
  | "submitted"
  | "checking"
  | "check_complete"
  | "payment_pending"
  | "paid"
  | "completed"
  | "closed";

/**
 * Read-only operational stages derived by the database from authoritative case,
 * intake, report, analysis-job, and completed-run facts.
 */
export type CaseOperationStage =
  | "intake_not_started"
  | "intake_in_progress"
  | "report_uploaded"
  | "report_required"
  | "ready_for_analysis"
  | "analysis_processing"
  | "analysis_failed"
  | "analysis_complete"
  | "submitted"
  | "closed"
  | "needs_attention";

export type CaseOperationAnalysisStatus =
  | "processing"
  | "completed"
  | "failed";

export interface StaffCaseOperationListItem {
  readonly caseId: string;
  readonly ownerUserId: string;
  readonly customerFullName: string | null;
  readonly verifiedEmail: string | null;
  readonly serviceType: CaseOperationServiceType;
  readonly caseStatus: CaseOperationStatus;
  readonly caseStage: CaseOperationStage;
  readonly needsAttention: boolean;
  readonly caseCreatedAt: string;
  readonly caseUpdatedAt: string;
  readonly lastActivityAt: string;
  readonly reportUploadedAt: string | null;
  readonly analysisStatus: CaseOperationAnalysisStatus | null;
  readonly analysisAttemptCount: number | null;
  readonly analysisRetryable: boolean | null;
  readonly analysisFailureCode: string | null;
  readonly analysisProcessingExpiresAt: string | null;
}

export interface StaffTotalLossCaseOperation
  extends StaffCaseOperationListItem {
  readonly serviceType: "total_loss";
  readonly operationalFollowUpAllowed: boolean | null;
  readonly intakeMode: "report" | "manual" | null;
  readonly vin: string | null;
  readonly vehicleYear: number | null;
  readonly vehicleMake: string | null;
  readonly vehicleModel: string | null;
  readonly vehicleTrim: string | null;
  readonly mileageAtLoss: number | null;
  readonly postalCode: string | null;
  readonly dateOfLoss: string | null;
  readonly insurerName: string | null;
  readonly insurerVehicleValuation: number | null;
  readonly intakeCompletedAt: string | null;
  readonly detailsCreatedAt: string | null;
  readonly detailsUpdatedAt: string | null;
  readonly reportOriginalFilename: string | null;
  readonly analysisJobId: string | null;
  readonly analysisJobCreatedAt: string | null;
  readonly analysisJobUpdatedAt: string | null;
  readonly analysisJobFinishedAt: string | null;
  readonly analysisRunId: string | null;
  readonly analysisRunCreatedAt: string | null;
  readonly analysisRunSchemaVersion: string | null;
  readonly analysisVersion: string | null;
  readonly discrepancyAnalysisVersion: string | null;
  readonly comparableScoringVersion: string | null;
  readonly analysisClassification: string | null;
  readonly analysisEvidenceStrength: string | null;
  readonly analysisEvidenceBasis: string | null;
}
