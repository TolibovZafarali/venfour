import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppraisalCaseService } from "@/features/cases/service";
import type {
  AcquireTotalLossReportUploadLeaseInput,
  CreateTotalLossDetailsInput,
  CreateTotalLossDetailsValues,
  FinalizeTotalLossReportUploadInput,
  MarkTotalLossReportUploadReadyInput,
  SaveTotalLossDetailsInput,
  TotalLossCaseDetails,
  TotalLossDetailsChanges,
  TotalLossDetailsScope,
  TotalLossReportUploadLease,
  TotalLossReportUploadLeaseScope,
  UpdateTotalLossDetailsInput,
} from "@/features/total-loss/data-types";
import type {
  Database,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/lib/supabase/database.types";

const TOTAL_LOSS_DETAILS_COLUMNS =
  "case_id,intake_mode,vin,vehicle_year,vehicle_make,vehicle_model,vehicle_trim,mileage_at_loss,postal_code,date_of_loss,insurer_name,insurer_vehicle_valuation,report_original_filename,report_uploaded_at,intake_completed_at,created_at,updated_at" as const;

type TotalLossDetailsRow = Pick<
  Tables<"total_loss_case_details">,
  | "case_id"
  | "intake_mode"
  | "vin"
  | "vehicle_year"
  | "vehicle_make"
  | "vehicle_model"
  | "vehicle_trim"
  | "mileage_at_loss"
  | "postal_code"
  | "date_of_loss"
  | "insurer_name"
  | "insurer_vehicle_valuation"
  | "report_original_filename"
  | "report_uploaded_at"
  | "intake_completed_at"
  | "created_at"
  | "updated_at"
>;
type TotalLossDetailsInsert = TablesInsert<"total_loss_case_details">;
type TotalLossDetailsUpdate = TablesUpdate<"total_loss_case_details">;

export interface TotalLossDetailsService {
  getDetails(input: TotalLossDetailsScope): Promise<TotalLossCaseDetails | null>;
  createDetails(
    input: CreateTotalLossDetailsInput,
  ): Promise<TotalLossCaseDetails>;
  updateDetails(
    input: UpdateTotalLossDetailsInput,
  ): Promise<TotalLossCaseDetails>;
  saveDetails(input: SaveTotalLossDetailsInput): Promise<TotalLossCaseDetails>;
  acquireReportUploadLease(
    input: AcquireTotalLossReportUploadLeaseInput,
  ): Promise<TotalLossReportUploadLease>;
  renewReportUploadLease(
    input: TotalLossReportUploadLeaseScope,
  ): Promise<TotalLossReportUploadLease>;
  markReportUploadReady(
    input: MarkTotalLossReportUploadReadyInput,
  ): Promise<TotalLossReportUploadLease>;
  completeReportUploadRecovery(
    input: TotalLossReportUploadLeaseScope,
  ): Promise<TotalLossReportUploadLease>;
  finalizeReportUpload(
    input: FinalizeTotalLossReportUploadInput,
  ): Promise<TotalLossCaseDetails>;
  cancelReportUpload(
    input: TotalLossReportUploadLeaseScope,
  ): Promise<TotalLossCaseDetails>;
}

export class TotalLossDetailsResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TotalLossDetailsResponseError";
  }
}

export class TotalLossDetailsConflictError extends Error {
  readonly currentDetails: TotalLossCaseDetails | null;

  constructor(currentDetails: TotalLossCaseDetails | null) {
    super(
      "The total-loss intake changed in another session. Reload the saved version before trying again.",
    );
    this.name = "TotalLossDetailsConflictError";
    this.currentDetails = currentDetails;
  }
}

export class TotalLossReportUploadBusyError extends Error {
  constructor() {
    super(
      "This report is already being updated in another session. Try again after that upload finishes.",
    );
    this.name = "TotalLossReportUploadBusyError";
  }
}

export class TotalLossReportUploadLeaseLostError extends Error {
  constructor() {
    super(
      "The secure report-upload session expired or was replaced. Start the upload again.",
    );
    this.name = "TotalLossReportUploadLeaseLostError";
  }
}

interface TotalLossReportUploadLeaseRow {
  readonly upload_id: string;
  readonly expires_at: string;
  readonly details_updated_at: string;
  readonly report_original_filename: string | null;
  readonly report_uploaded_at: string | null;
  readonly recovery_required?: boolean;
}

function mapReportUploadLease(
  row: TotalLossReportUploadLeaseRow,
): TotalLossReportUploadLease {
  return {
    uploadId: row.upload_id,
    expiresAt: row.expires_at,
    detailsUpdatedAt: row.details_updated_at,
    reportOriginalFilename: row.report_original_filename,
    reportUploadedAt: row.report_uploaded_at,
    recoveryRequired: row.recovery_required ?? false,
  };
}

function mapTotalLossDetails(row: TotalLossDetailsRow): TotalLossCaseDetails {
  return {
    caseId: row.case_id,
    intakeMode: row.intake_mode,
    vin: row.vin,
    vehicleYear: row.vehicle_year,
    vehicleMake: row.vehicle_make,
    vehicleModel: row.vehicle_model,
    vehicleTrim: row.vehicle_trim,
    mileageAtLoss: row.mileage_at_loss,
    postalCode: row.postal_code,
    dateOfLoss: row.date_of_loss,
    insurerName: row.insurer_name,
    insurerVehicleValuation: row.insurer_vehicle_valuation,
    reportOriginalFilename: row.report_original_filename,
    reportUploadedAt: row.report_uploaded_at,
    intakeCompletedAt: row.intake_completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertRequestedCase(
  details: TotalLossCaseDetails,
  expectedCaseId: string,
) {
  if (details.caseId !== expectedCaseId) {
    throw new TotalLossDetailsResponseError(
      "Supabase returned total-loss details outside the requested case scope.",
    );
  }
}

function assignWritableValues(
  target: TotalLossDetailsInsert | TotalLossDetailsUpdate,
  values: CreateTotalLossDetailsValues | TotalLossDetailsChanges,
) {
  if (values.intakeMode !== undefined) target.intake_mode = values.intakeMode;
  if (values.vin !== undefined) target.vin = values.vin;
  if (values.vehicleYear !== undefined) target.vehicle_year = values.vehicleYear;
  if (values.vehicleMake !== undefined) target.vehicle_make = values.vehicleMake;
  if (values.vehicleModel !== undefined) target.vehicle_model = values.vehicleModel;
  if (values.vehicleTrim !== undefined) target.vehicle_trim = values.vehicleTrim;
  if (values.mileageAtLoss !== undefined) target.mileage_at_loss = values.mileageAtLoss;
  if (values.postalCode !== undefined) target.postal_code = values.postalCode;
  if (values.dateOfLoss !== undefined) target.date_of_loss = values.dateOfLoss;
  if (values.insurerName !== undefined) target.insurer_name = values.insurerName;
  if (values.insurerVehicleValuation !== undefined) {
    target.insurer_vehicle_valuation = values.insurerVehicleValuation;
  }
  if (values.intakeCompletedAt !== undefined) {
    target.intake_completed_at = values.intakeCompletedAt;
  }
}

function matchesWritableValues(
  details: TotalLossCaseDetails,
  values: CreateTotalLossDetailsValues,
) {
  return (
    details.intakeMode === values.intakeMode &&
    details.vin === (values.vin ?? null) &&
    details.vehicleYear === (values.vehicleYear ?? null) &&
    details.vehicleMake === (values.vehicleMake ?? null) &&
    details.vehicleModel === (values.vehicleModel ?? null) &&
    details.vehicleTrim === (values.vehicleTrim ?? null) &&
    details.mileageAtLoss === (values.mileageAtLoss ?? null) &&
    details.postalCode === (values.postalCode ?? null) &&
    details.dateOfLoss === (values.dateOfLoss ?? null) &&
    details.insurerName === (values.insurerName ?? null) &&
    details.insurerVehicleValuation ===
      (values.insurerVehicleValuation ?? null) &&
    details.intakeCompletedAt === (values.intakeCompletedAt ?? null)
  );
}

async function fetchDetails(
  client: SupabaseClient<Database>,
  caseId: string,
): Promise<TotalLossCaseDetails | null> {
  const { data, error } = await client
    .from("total_loss_case_details")
    .select(TOTAL_LOSS_DETAILS_COLUMNS)
    .eq("case_id", caseId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const details = mapTotalLossDetails(data);
  assertRequestedCase(details, caseId);
  return details;
}

export function createTotalLossDetailsService(
  client: SupabaseClient<Database>,
  appraisalCaseService: AppraisalCaseService,
): TotalLossDetailsService {
  const touchCase = async ({ caseId, userId }: TotalLossDetailsScope) => {
    const touchedCase = await appraisalCaseService.touchAppraisalCase({
      caseId,
      userId,
    });
    if (!touchedCase) {
      throw new TotalLossDetailsResponseError(
        "The saved total-loss case could not be marked as recently active.",
      );
    }
  };

  const throwReportUploadRpcError = async (
    error: { readonly code?: string },
    caseId: string,
  ): Promise<never> => {
    if (error.code === "40001") {
      throw new TotalLossDetailsConflictError(
        await fetchDetails(client, caseId),
      );
    }
    if (error.code === "55P03") {
      throw new TotalLossReportUploadBusyError();
    }
    if (error.code === "55000") {
      throw new TotalLossReportUploadLeaseLostError();
    }
    throw error;
  };

  const requireLease = (
    row: TotalLossReportUploadLeaseRow | null,
    message: string,
  ) => {
    if (!row) throw new TotalLossDetailsResponseError(message);
    return mapReportUploadLease(row);
  };

  const service: TotalLossDetailsService = {
    async getDetails({ caseId }) {
      return fetchDetails(client, caseId);
    },

    async createDetails({ caseId, userId, values }) {
      const insert: TotalLossDetailsInsert = {
        case_id: caseId,
        intake_mode: values.intakeMode,
      };
      assignWritableValues(insert, values);

      const { data, error } = await client
        .from("total_loss_case_details")
        .insert(insert)
        .select(TOTAL_LOSS_DETAILS_COLUMNS)
        .single();

      if (error || !data) {
        const currentDetails = await fetchDetails(client, caseId);
        if (currentDetails) {
          // If an insert committed before its response was lost, the retry's
          // stable case ID finds the same row. Treat an exact writable-value
          // match as the successful response while surfacing divergent data as
          // a real concurrent-edit conflict.
          if (matchesWritableValues(currentDetails, values)) {
            await touchCase({ caseId, userId });
            return currentDetails;
          }
          throw new TotalLossDetailsConflictError(currentDetails);
        }
        if (error) throw error;
        throw new TotalLossDetailsResponseError(
          "Supabase did not return the created total-loss details.",
        );
      }

      const details = mapTotalLossDetails(data);
      assertRequestedCase(details, caseId);
      await touchCase({ caseId, userId });
      return details;
    },

    async updateDetails({ caseId, userId, expectedUpdatedAt, changes }) {
      const update: TotalLossDetailsUpdate = {};
      assignWritableValues(update, changes);

      const { data, error } = await client
        .from("total_loss_case_details")
        .update(update)
        .eq("case_id", caseId)
        .eq("updated_at", expectedUpdatedAt)
        .select(TOTAL_LOSS_DETAILS_COLUMNS)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        throw new TotalLossDetailsConflictError(
          await fetchDetails(client, caseId),
        );
      }

      const details = mapTotalLossDetails(data);
      assertRequestedCase(details, caseId);
      await touchCase({ caseId, userId });
      return details;
    },

    saveDetails(input) {
      if (input.expectedUpdatedAt === null) {
        return service.createDetails({
          caseId: input.caseId,
          userId: input.userId,
          values: input.values,
        });
      }
      return service.updateDetails({
        caseId: input.caseId,
        userId: input.userId,
        expectedUpdatedAt: input.expectedUpdatedAt,
        changes: input.values,
      });
    },

    async acquireReportUploadLease({ caseId, expectedUpdatedAt, uploadId }) {
      const { data, error } = await client
        .rpc("acquire_total_loss_report_upload", {
          case_id: caseId,
          expected_updated_at: expectedUpdatedAt,
          upload_id: uploadId,
        })
        .single();
      if (error) await throwReportUploadRpcError(error, caseId);
      const lease = requireLease(
        data,
        "Supabase did not return the acquired report-upload lease.",
      );
      if (lease.uploadId !== uploadId) {
        throw new TotalLossDetailsResponseError(
          "Supabase returned a report-upload lease outside the requested token scope.",
        );
      }
      return lease;
    },

    async renewReportUploadLease({ caseId, uploadId }) {
      const { data, error } = await client
        .rpc("renew_total_loss_report_upload", {
          case_id: caseId,
          upload_id: uploadId,
        })
        .single();
      if (error) await throwReportUploadRpcError(error, caseId);
      return requireLease(
        data,
        "Supabase did not return the renewed report-upload lease.",
      );
    },

    async markReportUploadReady({ caseId, uploadId, hasBackup }) {
      const { data, error } = await client
        .rpc("mark_total_loss_report_upload_ready", {
          case_id: caseId,
          upload_id: uploadId,
          has_backup: hasBackup,
        })
        .single();
      if (error) await throwReportUploadRpcError(error, caseId);
      return requireLease(
        data,
        "Supabase did not confirm that the report upload is ready.",
      );
    },

    async completeReportUploadRecovery({ caseId, uploadId }) {
      const { data, error } = await client
        .rpc("complete_total_loss_report_upload_recovery", {
          case_id: caseId,
          upload_id: uploadId,
        })
        .single();
      if (error) await throwReportUploadRpcError(error, caseId);
      return requireLease(
        data,
        "Supabase did not confirm recovery of the previous report.",
      );
    },

    async finalizeReportUpload({
      caseId,
      uploadId,
      originalFilename,
      uploadedAt,
    }) {
      const { data, error } = await client
        .rpc("finalize_total_loss_report_upload", {
          case_id: caseId,
          upload_id: uploadId,
          report_original_filename: originalFilename,
          report_uploaded_at: uploadedAt,
        })
        .single();
      if (error) await throwReportUploadRpcError(error, caseId);
      if (!data) {
        throw new TotalLossDetailsResponseError(
          "Supabase did not return the finalized total-loss details.",
        );
      }
      const details = mapTotalLossDetails(data);
      assertRequestedCase(details, caseId);
      return details;
    },

    async cancelReportUpload({ caseId, uploadId }) {
      const { data, error } = await client
        .rpc("cancel_total_loss_report_upload", {
          case_id: caseId,
          upload_id: uploadId,
        })
        .single();
      if (error) await throwReportUploadRpcError(error, caseId);
      if (!data) {
        throw new TotalLossDetailsResponseError(
          "Supabase did not return the total-loss details after upload cancellation.",
        );
      }
      const details = mapTotalLossDetails(data);
      assertRequestedCase(details, caseId);
      return details;
    },
  };

  return service;
}
