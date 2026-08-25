import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppraisalCaseService } from "@/features/cases/service";
import type {
  AcquireTotalLossReportUploadLeaseInput,
  ConfirmTotalLossIntakeInput,
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
  CompositeTypes,
  Database,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/lib/supabase/database.types";

const TOTAL_LOSS_DETAILS_COLUMNS =
  "case_id,intake_mode,vin,vehicle_year,vehicle_make,vehicle_model,vehicle_trim,mileage_at_loss,postal_code,date_of_loss,insurer_name,insurer_vehicle_valuation,vehicle_condition,vehicle_options_packages,report_provider_name,report_extraction_status,report_extraction_confidence,report_extracted_at,report_facts_confirmed_at,analysis_input_revision,analysis_input_id,report_storage_owner_id,report_upload_recovery_required,report_original_filename,report_uploaded_at,intake_completed_at,created_at,updated_at" as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TotalLossLegacyDetailsTableRow = Pick<
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
interface TotalLossAdditionalDetailsRow {
  readonly vehicle_condition?: string | null;
  readonly vehicle_options_packages?: string | null;
  readonly report_provider_name?: string | null;
  readonly report_extraction_status?: string | null;
  readonly report_extraction_confidence?: number | null;
  readonly report_extracted_at?: string | null;
  readonly report_facts_confirmed_at?: string | null;
  readonly analysis_input_revision?: number | null;
  readonly analysis_input_id?: string | null;
  readonly report_storage_owner_id?: string | null;
  readonly report_upload_recovery_required?: boolean;
}
type TotalLossDetailsRow = (
  | TotalLossLegacyDetailsTableRow
  | CompositeTypes<"total_loss_case_details_public">
) &
  TotalLossAdditionalDetailsRow;
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
  confirmIntake?(
    input: ConfirmTotalLossIntakeInput,
  ): Promise<TotalLossCaseDetails>;
  acquireReportUploadLease(
    input: AcquireTotalLossReportUploadLeaseInput,
  ): Promise<TotalLossReportUploadLease>;
  reclaimReportUploadLease(
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

type TotalLossReportUploadLeaseRow =
  CompositeTypes<"total_loss_report_upload_lease">;

function mapReportUploadLease(
  row: TotalLossReportUploadLeaseRow,
): TotalLossReportUploadLease {
  if (
    typeof row.upload_id !== "string" ||
    typeof row.expires_at !== "string" ||
    typeof row.details_updated_at !== "string" ||
    !isNullableString(row.report_original_filename) ||
    !isNullableString(row.report_uploaded_at) ||
    (row.recovery_required != null &&
      typeof row.recovery_required !== "boolean")
  ) {
    throw new TotalLossDetailsResponseError(
      "Supabase returned an incomplete report-upload lease.",
    );
  }

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
  if (
    typeof row.case_id !== "string" ||
    (row.intake_mode !== "manual" && row.intake_mode !== "report") ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string"
  ) {
    throw new TotalLossDetailsResponseError(
      "Supabase returned incomplete total-loss details.",
    );
  }

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
    vehicleCondition: optionalNullableString(row.vehicle_condition),
    optionsPackages: optionalNullableString(row.vehicle_options_packages),
    reportProvider: optionalNullableString(row.report_provider_name),
    reportExtractionStatus: optionalExtractionStatus(
      row.report_extraction_status,
    ),
    reportExtractionConfidence: optionalConfidence(
      row.report_extraction_confidence,
    ),
    reportExtractedAt: optionalNullableString(row.report_extracted_at),
    reportFactsConfirmedAt: optionalNullableString(
      row.report_facts_confirmed_at,
    ),
    analysisInputRevision: optionalPositiveInteger(
      row.analysis_input_revision,
    ),
    analysisInputId: optionalNullableUuid(row.analysis_input_id),
    reportStorageOwnerId: optionalNullableUuid(
      row.report_storage_owner_id,
    ),
    reportUploadRecoveryRequired:
      optionalBoolean(row.report_upload_recovery_required) ?? false,
    reportOriginalFilename: row.report_original_filename,
    reportUploadedAt: row.report_uploaded_at,
    intakeCompletedAt: row.intake_completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function optionalNullableString(value: unknown) {
  if (value === undefined || value === null || typeof value === "string") {
    return value;
  }
  throw new TotalLossDetailsResponseError(
    "Supabase returned an invalid Total-Loss text field.",
  );
}

function optionalBoolean(value: unknown) {
  if (value === undefined || typeof value === "boolean") return value;
  throw new TotalLossDetailsResponseError(
    "Supabase returned an invalid Total-Loss boolean field.",
  );
}

function optionalExtractionStatus(value: unknown) {
  if (value === undefined || value === null) return value;
  if (
    value === "not_requested" ||
    value === "pending" ||
    value === "needs_confirmation" ||
    value === "confirmed" ||
    value === "failed"
  ) {
    return value;
  }
  throw new TotalLossDetailsResponseError(
    "Supabase returned an invalid report-extraction status.",
  );
}

function optionalConfidence(value: unknown) {
  if (value === undefined || value === null) return value;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) {
    return value;
  }
  throw new TotalLossDetailsResponseError(
    "Supabase returned an invalid report-extraction confidence.",
  );
}

function optionalPositiveInteger(value: unknown) {
  if (value === undefined || value === null) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1) {
    return value;
  }
  throw new TotalLossDetailsResponseError(
    "Supabase returned an invalid analysis-input revision.",
  );
}

function optionalNullableUuid(value: unknown) {
  const candidate = optionalNullableString(value);
  if (candidate === undefined || candidate === null) return candidate;
  if (UUID_PATTERN.test(candidate)) return candidate;
  throw new TotalLossDetailsResponseError(
    "Supabase returned an invalid Total-Loss identifier.",
  );
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
  const providerNeutralTarget = target as Record<string, unknown>;
  if (values.vehicleCondition !== undefined) {
    providerNeutralTarget.vehicle_condition = values.vehicleCondition;
  }
  if (values.optionsPackages !== undefined) {
    providerNeutralTarget.vehicle_options_packages = values.optionsPackages;
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
    details.vehicleCondition === (values.vehicleCondition ?? null) &&
    details.optionsPackages === (values.optionsPackages ?? null)
  );
}

type UntypedRpcClient = {
  rpc: (
    name: string,
    parameters: Record<string, unknown>,
  ) => Promise<{
    data: unknown;
    error: ({ readonly code?: string } & Error) | null;
  }>;
};

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

  const details = mapTotalLossDetails(data as unknown as TotalLossDetailsRow);
  assertRequestedCase(details, caseId);
  return details;
}

export function createTotalLossDetailsService(
  client: SupabaseClient<Database>,
  appraisalCaseService: AppraisalCaseService,
): TotalLossDetailsService {
  const untypedRpcClient = client as unknown as UntypedRpcClient;
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

  const storageOwnerCache = new Map<string, string>();
  const attachStorageOwner = async (
    caseId: string,
    lease: TotalLossReportUploadLease,
  ): Promise<TotalLossReportUploadLease> => {
    let storageOwnerUserId = storageOwnerCache.get(caseId);
    if (!storageOwnerUserId) {
      const { data, error } = await untypedRpcClient.rpc(
        "get_owned_total_loss_report_storage_locator",
        { case_id: caseId },
      );
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || typeof row !== "object") {
        throw new TotalLossDetailsResponseError(
          "Supabase did not return the owned private report location.",
        );
      }
      const locator = row as Record<string, unknown>;
      storageOwnerUserId =
        typeof locator.storage_owner_id === "string"
          ? locator.storage_owner_id
          : undefined;
      const canonicalPath = `${storageOwnerUserId}/${caseId}/valuation-report.pdf`;
      const backupPath = `${storageOwnerUserId}/${caseId}/valuation-report-backup.pdf`;
      if (
        locator.case_id !== caseId ||
        locator.bucket_id !== "case-files" ||
        !storageOwnerUserId ||
        !UUID_PATTERN.test(storageOwnerUserId) ||
        locator.canonical_object_path !== canonicalPath ||
        locator.backup_object_path !== backupPath
      ) {
        throw new TotalLossDetailsResponseError(
          "Supabase returned an invalid private report location.",
        );
      }
      storageOwnerCache.set(caseId, storageOwnerUserId);
    }
    return { ...lease, storageOwnerUserId };
  };

  const service: TotalLossDetailsService = {
    async getDetails({ caseId }) {
      return fetchDetails(client, caseId);
    },

    async createDetails({ caseId, userId, values }) {
      const insert: TotalLossDetailsInsert = {
        case_id: caseId,
        intake_mode: values.intakeMode,
        report_storage_owner_id: userId,
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

      const details = mapTotalLossDetails(data as unknown as TotalLossDetailsRow);
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

      const details = mapTotalLossDetails(data as unknown as TotalLossDetailsRow);
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

    async confirmIntake({ caseId, expectedUpdatedAt }) {
      const { data, error } = await untypedRpcClient.rpc(
        "confirm_total_loss_intake",
        {
          case_id: caseId,
          expected_details_updated_at: expectedUpdatedAt,
        },
      );
      if (error) {
        const currentDetails = await fetchDetails(client, caseId);
        if (currentDetails?.intakeCompletedAt) return currentDetails;
        if (error.code === "40001") {
          throw new TotalLossDetailsConflictError(currentDetails);
        }
        throw error;
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (
        !row ||
        typeof row !== "object" ||
        (row as { readonly case_id?: unknown }).case_id !== caseId
      ) {
        throw new TotalLossDetailsResponseError(
          "Supabase did not confirm the requested Total-Loss intake.",
        );
      }
      const details = await fetchDetails(client, caseId);
      if (!details?.intakeCompletedAt) {
        throw new TotalLossDetailsResponseError(
          "Supabase did not return the confirmed Total-Loss intake.",
        );
      }
      return details;
    },

    async acquireReportUploadLease({ caseId, expectedUpdatedAt, uploadId }) {
      const { data, error } = await client
        .rpc("acquire_total_loss_report_upload", {
          case_id: caseId,
          // The SQL function intentionally accepts NULL to compare against an
          // absent details row, which generated RPC argument types cannot
          // express.
          expected_updated_at: expectedUpdatedAt as string,
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
      return attachStorageOwner(caseId, lease);
    },

    async reclaimReportUploadLease({ caseId, expectedUpdatedAt, uploadId }) {
      const { data, error } = await untypedRpcClient.rpc(
        "reclaim_total_loss_report_upload",
        {
          case_id: caseId,
          expected_updated_at: expectedUpdatedAt,
          upload_id: uploadId,
        },
      );
      if (error) await throwReportUploadRpcError(error, caseId);
      const row = Array.isArray(data) ? data[0] : data;
      const lease = requireLease(
        row as TotalLossReportUploadLeaseRow | null,
        "Supabase did not return the reclaimed report-upload lease.",
      );
      if (lease.uploadId !== uploadId) {
        throw new TotalLossDetailsResponseError(
          "Supabase returned a reclaimed report-upload lease outside the requested token scope.",
        );
      }
      return attachStorageOwner(caseId, lease);
    },

    async renewReportUploadLease({ caseId, uploadId }) {
      const { data, error } = await client
        .rpc("renew_total_loss_report_upload", {
          case_id: caseId,
          upload_id: uploadId,
        })
        .single();
      if (error) await throwReportUploadRpcError(error, caseId);
      return attachStorageOwner(
        caseId,
        requireLease(
          data,
          "Supabase did not return the renewed report-upload lease.",
        ),
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
      return attachStorageOwner(
        caseId,
        requireLease(
          data,
          "Supabase did not confirm that the report upload is ready.",
        ),
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
      return attachStorageOwner(
        caseId,
        requireLease(
          data,
          "Supabase did not confirm recovery of the previous report.",
        ),
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
      const details = mapTotalLossDetails(data as unknown as TotalLossDetailsRow);
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
      const details = mapTotalLossDetails(data as unknown as TotalLossDetailsRow);
      assertRequestedCase(details, caseId);
      return details;
    },
  };

  return service;
}
