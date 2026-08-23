import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import type {
  CaseOperationAnalysisStatus,
  CaseOperationServiceType,
  CaseOperationStage,
  CaseOperationStatus,
  StaffCaseOperationListItem,
  StaffTotalLossCaseOperation,
} from "./types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;

const CASE_OPERATION_STAGES = new Set<CaseOperationStage>([
  "intake_not_started",
  "intake_in_progress",
  "report_uploaded",
  "report_required",
  "ready_for_analysis",
  "analysis_processing",
  "analysis_failed",
  "analysis_complete",
  "submitted",
  "closed",
  "needs_attention",
]);

const CASE_STATUSES = new Set<CaseOperationStatus>([
  "draft",
  "submitted",
  "checking",
  "check_complete",
  "payment_pending",
  "paid",
  "completed",
  "closed",
]);

const ANALYSIS_STATUSES = new Set<CaseOperationAnalysisStatus>([
  "processing",
  "completed",
  "failed",
]);

export interface StaffCaseOperationsService {
  isStaff(): Promise<boolean>;
  listCases(): Promise<StaffCaseOperationListItem[]>;
  getTotalLossCase(
    caseId: string,
  ): Promise<StaffTotalLossCaseOperation | null>;
}

export class StaffCaseOperationsResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffCaseOperationsResponseError";
  }
}

export function createStaffCaseOperationsService(
  client: SupabaseClient<Database>,
): StaffCaseOperationsService {
  return {
    async isStaff() {
      const { data, error } = await client.rpc("is_venfour_staff");
      if (error) throw error;
      if (typeof data !== "boolean") {
        throw new StaffCaseOperationsResponseError(
          "Supabase did not return a valid staff-access decision.",
        );
      }
      return data;
    },

    async listCases() {
      const { data, error } = await client.rpc("staff_list_case_operations");
      if (error) throw error;
      if (!Array.isArray(data)) {
        throw new StaffCaseOperationsResponseError(
          "Supabase did not return the staff case-operations list.",
        );
      }

      return data.map(mapListItem).toSorted(compareListItems);
    },

    async getTotalLossCase(caseId) {
      const normalizedCaseId = caseId.toLowerCase();
      assertUuid(normalizedCaseId, "Case ID");
      const { data, error } = await client.rpc(
        "staff_get_total_loss_case_operation",
        { requested_case_id: normalizedCaseId },
      );
      if (error) throw error;

      const rows = Array.isArray(data) ? data : data ? [data] : [];
      if (rows.length === 0) return null;
      if (rows.length !== 1) {
        throw new StaffCaseOperationsResponseError(
          "Supabase returned more than one total-loss case operation.",
        );
      }

      const result = mapTotalLossCase(rows[0]);
      if (result.caseId !== normalizedCaseId) {
        throw new StaffCaseOperationsResponseError(
          "Supabase returned a total-loss case outside the requested scope.",
        );
      }
      return result;
    },
  };
}

function mapListItem(value: unknown): StaffCaseOperationListItem {
  const row = record(value);
  return mapListFields(row);
}

function mapListFields(
  row: Record<string, unknown>,
): StaffCaseOperationListItem {
  const serviceType = caseServiceType(row.service_type);
  const caseStatus = caseStatusValue(row.case_status);
  const caseStage = caseStageValue(row.case_stage);
  if (
    serviceType === "diminished_value" &&
    (caseStatus !== "submitted" || caseStage !== "submitted")
  ) {
    throw new StaffCaseOperationsResponseError(
      "Supabase returned a diminished-value case outside the submitted scope.",
    );
  }

  const analysisAttemptCount = nullableInteger(row, "analysis_attempt_count");
  if (analysisAttemptCount !== null && analysisAttemptCount < 1) {
    throw new StaffCaseOperationsResponseError(
      "Supabase returned an invalid analysis attempt count.",
    );
  }
  const analysisStatus = analysisStatusValue(row.analysis_status);
  const analysisRetryable = nullableBoolean(row, "analysis_retryable");
  const analysisFailureCode = failureCode(row.analysis_failure_code);
  const analysisProcessingExpiresAt = nullableTimestamp(
    row,
    "analysis_processing_expires_at",
  );
  assertAnalysisState({
    analysisAttemptCount,
    analysisFailureCode,
    analysisProcessingExpiresAt,
    analysisRetryable,
    analysisStatus,
  });

  return {
    caseId: requiredUuid(row, "case_id"),
    ownerUserId: requiredUuid(row, "owner_user_id"),
    customerFullName: nullableString(row, "customer_full_name"),
    verifiedEmail: nullableString(row, "verified_email"),
    serviceType,
    caseStatus,
    caseStage,
    needsAttention: requiredBoolean(row, "needs_attention"),
    caseCreatedAt: requiredTimestamp(row, "case_created_at"),
    caseUpdatedAt: requiredTimestamp(row, "case_updated_at"),
    lastActivityAt: requiredTimestamp(row, "last_activity_at"),
    reportUploadedAt: nullableTimestamp(row, "report_uploaded_at"),
    analysisStatus,
    analysisAttemptCount,
    analysisRetryable,
    analysisFailureCode,
    analysisProcessingExpiresAt,
  };
}

function mapTotalLossCase(value: unknown): StaffTotalLossCaseOperation {
  const row = record(value);
  const listFields = mapListFields(row);
  if (listFields.serviceType !== "total_loss") {
    throw new StaffCaseOperationsResponseError(
      "Supabase returned a non-total-loss case from the total-loss detail RPC.",
    );
  }

  const vehicleYear = nullableInteger(row, "vehicle_year");
  if (vehicleYear !== null && (vehicleYear < 1886 || vehicleYear > 9999)) {
    throw new StaffCaseOperationsResponseError(
      "Supabase returned an invalid vehicle year.",
    );
  }
  const mileageAtLoss = nullableInteger(row, "mileage_at_loss");
  if (mileageAtLoss !== null && mileageAtLoss < 0) {
    throw new StaffCaseOperationsResponseError(
      "Supabase returned an invalid mileage at loss.",
    );
  }
  const insurerVehicleValuation = nullableNumber(
    row,
    "insurer_vehicle_valuation",
  );
  if (insurerVehicleValuation !== null && insurerVehicleValuation <= 0) {
    throw new StaffCaseOperationsResponseError(
      "Supabase returned an invalid insurer vehicle valuation.",
    );
  }

  return {
    ...listFields,
    serviceType: "total_loss",
    operationalFollowUpAllowed: nullableBoolean(
      row,
      "operational_follow_up_allowed",
    ),
    intakeMode: intakeMode(row.intake_mode),
    vin: nullableString(row, "vin"),
    vehicleYear,
    vehicleMake: nullableString(row, "vehicle_make"),
    vehicleModel: nullableString(row, "vehicle_model"),
    vehicleTrim: nullableString(row, "vehicle_trim"),
    mileageAtLoss,
    postalCode: nullableString(row, "postal_code"),
    dateOfLoss: nullableDate(row, "date_of_loss"),
    insurerName: nullableString(row, "insurer_name"),
    insurerVehicleValuation,
    intakeCompletedAt: nullableTimestamp(row, "intake_completed_at"),
    detailsCreatedAt: nullableTimestamp(row, "details_created_at"),
    detailsUpdatedAt: nullableTimestamp(row, "details_updated_at"),
    reportOriginalFilename: nullableString(row, "report_original_filename"),
    analysisJobId: nullableUuid(row, "analysis_job_id"),
    analysisJobCreatedAt: nullableTimestamp(row, "analysis_job_created_at"),
    analysisJobUpdatedAt: nullableTimestamp(row, "analysis_job_updated_at"),
    analysisJobFinishedAt: nullableTimestamp(row, "analysis_job_finished_at"),
    analysisRunId: nullableUuid(row, "analysis_run_id"),
    analysisRunCreatedAt: nullableTimestamp(row, "analysis_run_created_at"),
    analysisRunSchemaVersion: nullableString(
      row,
      "analysis_run_schema_version",
    ),
    analysisVersion: nullableString(row, "analysis_version"),
    discrepancyAnalysisVersion: nullableString(
      row,
      "discrepancy_analysis_version",
    ),
    comparableScoringVersion: nullableString(
      row,
      "comparable_scoring_version",
    ),
    analysisClassification: nullableString(row, "analysis_classification"),
    analysisEvidenceStrength: nullableString(
      row,
      "analysis_evidence_strength",
    ),
    analysisEvidenceBasis: nullableString(row, "analysis_evidence_basis"),
  };
}

function compareListItems(
  left: StaffCaseOperationListItem,
  right: StaffCaseOperationListItem,
) {
  const activityOrder =
    Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt);
  return activityOrder || left.caseId.localeCompare(right.caseId);
}

function assertAnalysisState({
  analysisAttemptCount,
  analysisFailureCode,
  analysisProcessingExpiresAt,
  analysisRetryable,
  analysisStatus,
}: Pick<
  StaffCaseOperationListItem,
  | "analysisAttemptCount"
  | "analysisFailureCode"
  | "analysisProcessingExpiresAt"
  | "analysisRetryable"
  | "analysisStatus"
>) {
  const invalid =
    analysisStatus === null
      ? analysisAttemptCount !== null ||
        analysisFailureCode !== null ||
        analysisProcessingExpiresAt !== null ||
        analysisRetryable !== null
      : analysisStatus === "processing"
        ? analysisAttemptCount === null ||
          analysisFailureCode !== null ||
          analysisProcessingExpiresAt === null ||
          analysisRetryable !== null
        : analysisStatus === "completed"
          ? analysisAttemptCount === null ||
            analysisFailureCode !== null ||
            analysisProcessingExpiresAt !== null ||
            analysisRetryable !== null
          : analysisAttemptCount === null ||
            analysisFailureCode === null ||
            analysisProcessingExpiresAt !== null ||
            analysisRetryable === null;

  if (invalid) {
    throw new StaffCaseOperationsResponseError(
      "Supabase returned an inconsistent analysis state.",
    );
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StaffCaseOperationsResponseError(
      "Supabase returned an invalid staff case-operation record.",
    );
  }
  return value as Record<string, unknown>;
}

function requiredString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value !== "string" || !value) {
    throw new StaffCaseOperationsResponseError(
      `Supabase returned an invalid ${key} value.`,
    );
  }
  return value;
}

function nullableString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new StaffCaseOperationsResponseError(
      `Supabase returned an invalid ${key} value.`,
    );
  }
  return value;
}

function requiredUuid(row: Record<string, unknown>, key: string) {
  const value = requiredString(row, key).toLowerCase();
  assertUuid(value, key);
  return value;
}

function nullableUuid(row: Record<string, unknown>, key: string) {
  const value = nullableString(row, key);
  if (value === null) return null;
  const normalizedValue = value.toLowerCase();
  assertUuid(normalizedValue, key);
  return normalizedValue;
}

function assertUuid(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) {
    throw new StaffCaseOperationsResponseError(
      `${label} must be a valid UUID.`,
    );
  }
}

function requiredTimestamp(row: Record<string, unknown>, key: string) {
  const value = requiredString(row, key);
  if (!Number.isFinite(Date.parse(value))) {
    throw new StaffCaseOperationsResponseError(
      `Supabase returned an invalid ${key} timestamp.`,
    );
  }
  return value;
}

function nullableTimestamp(row: Record<string, unknown>, key: string) {
  if (row[key] === null) return null;
  return requiredTimestamp(row, key);
}

function nullableDate(row: Record<string, unknown>, key: string) {
  const value = nullableString(row, key);
  if (value === null) return null;
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    throw new StaffCaseOperationsResponseError(
      `Supabase returned an invalid ${key} date.`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new StaffCaseOperationsResponseError(
      `Supabase returned an invalid ${key} date.`,
    );
  }
  return value;
}

function requiredBoolean(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value !== "boolean") {
    throw new StaffCaseOperationsResponseError(
      `Supabase returned an invalid ${key} value.`,
    );
  }
  return value;
}

function nullableBoolean(row: Record<string, unknown>, key: string) {
  if (row[key] === null) return null;
  return requiredBoolean(row, key);
}

function requiredInteger(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new StaffCaseOperationsResponseError(
      `Supabase returned an invalid ${key} value.`,
    );
  }
  return value;
}

function nullableInteger(row: Record<string, unknown>, key: string) {
  if (row[key] === null) return null;
  return requiredInteger(row, key);
}

function nullableNumber(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new StaffCaseOperationsResponseError(
      `Supabase returned an invalid ${key} value.`,
    );
  }
  return value;
}

function caseServiceType(value: unknown): CaseOperationServiceType {
  if (value === "total_loss" || value === "diminished_value") return value;
  throw new StaffCaseOperationsResponseError(
    "Supabase returned an invalid case service type.",
  );
}

function caseStatusValue(value: unknown): CaseOperationStatus {
  if (typeof value === "string" && CASE_STATUSES.has(value as CaseOperationStatus)) {
    return value as CaseOperationStatus;
  }
  throw new StaffCaseOperationsResponseError(
    "Supabase returned an invalid case status.",
  );
}

function caseStageValue(value: unknown): CaseOperationStage {
  if (
    typeof value === "string" &&
    CASE_OPERATION_STAGES.has(value as CaseOperationStage)
  ) {
    return value as CaseOperationStage;
  }
  throw new StaffCaseOperationsResponseError(
    "Supabase returned an invalid case-operation stage.",
  );
}

function analysisStatusValue(
  value: unknown,
): CaseOperationAnalysisStatus | null {
  if (value === null) return null;
  if (
    typeof value === "string" &&
    ANALYSIS_STATUSES.has(value as CaseOperationAnalysisStatus)
  ) {
    return value as CaseOperationAnalysisStatus;
  }
  throw new StaffCaseOperationsResponseError(
    "Supabase returned an invalid analysis status.",
  );
}

function intakeMode(value: unknown): "report" | "manual" | null {
  if (value === null || value === "report" || value === "manual") return value;
  throw new StaffCaseOperationsResponseError(
    "Supabase returned an invalid total-loss intake mode.",
  );
}

function failureCode(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string" || !FAILURE_CODE_PATTERN.test(value)) {
    throw new StaffCaseOperationsResponseError(
      "Supabase returned an invalid analysis failure code.",
    );
  }
  return value;
}
