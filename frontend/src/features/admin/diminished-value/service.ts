import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  DiminishedValueCaseDetails,
  DiminishedValueDraftStep,
} from "@/features/diminished-value/data-types";
import {
  vehicleConfigurationIdentity,
  type VehicleConfigurationIdentity,
} from "@/features/intake/vehicle-lookup-types";
import type { Database } from "@/lib/supabase/database.types";

import type {
  StaffDiminishedValueCase,
  StaffDiminishedValueQueueItem,
} from "./types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface StaffDiminishedValueCaseService {
  isStaff(): Promise<boolean>;
  listSubmittedCases(): Promise<StaffDiminishedValueQueueItem[]>;
  getSubmittedCase(caseId: string): Promise<StaffDiminishedValueCase | null>;
}

export class StaffDiminishedValueResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffDiminishedValueResponseError";
  }
}

export function createStaffDiminishedValueCaseService(
  client: SupabaseClient<Database>,
): StaffDiminishedValueCaseService {
  return {
    async isStaff() {
      const { data, error } = await client.rpc("is_venfour_staff");
      if (error) throw error;
      if (typeof data !== "boolean") {
        throw new StaffDiminishedValueResponseError(
          "Supabase did not return a valid staff-access decision.",
        );
      }
      return data;
    },

    async listSubmittedCases() {
      const { data, error } = await client.rpc(
        "list_submitted_diminished_value_cases",
      );
      if (error) throw error;
      if (!Array.isArray(data)) {
        throw new StaffDiminishedValueResponseError(
          "Supabase did not return the submitted diminished-value queue.",
        );
      }

      return data
        .map(mapQueueItem)
        .toSorted(
          (left, right) =>
            Date.parse(right.submittedAt) - Date.parse(left.submittedAt),
        );
    },

    async getSubmittedCase(caseId) {
      const normalizedCaseId = caseId.toLowerCase();
      assertUuid(normalizedCaseId, "Case ID");
      const { data, error } = await client.rpc(
        "get_submitted_diminished_value_case",
        { requested_case_id: normalizedCaseId },
      );
      if (error) throw error;

      const rows = Array.isArray(data) ? data : data ? [data] : [];
      if (rows.length === 0) return null;
      if (rows.length !== 1) {
        throw new StaffDiminishedValueResponseError(
          "Supabase returned more than one submitted diminished-value case.",
        );
      }

      const result = mapSubmittedCase(rows[0]);
      if (result.caseId !== normalizedCaseId) {
        throw new StaffDiminishedValueResponseError(
          "Supabase returned a submitted case outside the requested scope.",
        );
      }
      return result;
    },
  };
}

function mapQueueItem(value: unknown): StaffDiminishedValueQueueItem {
  const row = record(value);
  const serviceType = requiredString(row, "service_type");
  const status = requiredString(row, "status");
  if (serviceType !== "diminished_value" || status !== "submitted") {
    throw new StaffDiminishedValueResponseError(
      "Supabase returned a case outside the submitted diminished-value queue.",
    );
  }

  const caseId = requiredUuid(row, "case_id");
  const ownerUserId = requiredUuid(row, "owner_user_id");
  const submittedAt = requiredTimestamp(row, "submitted_at");
  const preferredContactMethod = contactMethod(row.preferred_contact_method);
  const documentCount = requiredInteger(row, "document_count");
  if (documentCount < 0) {
    throw new StaffDiminishedValueResponseError(
      "Supabase returned an invalid supporting-document count.",
    );
  }

  return {
    caseId,
    ownerUserId,
    serviceType,
    status,
    submittedAt,
    fullName: nullableString(row, "full_name"),
    email: nullableString(row, "email"),
    phone: nullableString(row, "phone"),
    preferredContactMethod,
    vehicleYear: nullableInteger(row, "vehicle_year"),
    vehicleMake: nullableString(row, "vehicle_make"),
    vehicleModel: nullableString(row, "vehicle_model"),
    accidentDate: nullableString(row, "accident_date"),
    atFaultInsurer: nullableString(row, "at_fault_insurer"),
    documentCount,
  };
}

function mapSubmittedCase(value: unknown): StaffDiminishedValueCase {
  const row = record(value);
  const serviceType = requiredString(row, "service_type");
  const status = requiredString(row, "status");
  if (serviceType !== "diminished_value" || status !== "submitted") {
    throw new StaffDiminishedValueResponseError(
      "Supabase returned a case outside the submitted diminished-value scope.",
    );
  }

  const details = mapDetails(row);
  return {
    ...details,
    ownerUserId: requiredUuid(row, "owner_user_id"),
    serviceType,
    status,
    submittedAt: requiredTimestamp(row, "submitted_at"),
  };
}

function mapDetails(row: Record<string, unknown>): DiminishedValueCaseDetails {
  return {
    caseId: requiredUuid(row, "case_id"),
    draftStep: draftStep(row.draft_step),
    accidentState: nullableString(row, "accident_state"),
    accidentDate: nullableString(row, "accident_date"),
    repairStatus: repairStatus(row.repair_status),
    vehicleEntryMethod: vehicleEntryMethod(row.vehicle_entry_method),
    vin: nullableString(row, "vin"),
    vehicleYear: nullableInteger(row, "vehicle_year"),
    vehicleMake: nullableString(row, "vehicle_make"),
    vehicleModel: nullableString(row, "vehicle_model"),
    vehicleTrim: nullableString(row, "vehicle_trim"),
    vehicleConfiguration: nullableVehicleConfiguration(
      row,
      "vehicle_configuration",
    ),
    mileageAtAccident: nullableInteger(row, "mileage_at_accident"),
    currentMileage: nullableInteger(row, "current_mileage"),
    otherPartyAtFault: answer(row.other_party_at_fault),
    atFaultInsurer: nullableString(row, "at_fault_insurer"),
    repairCost: nullableNumber(row, "repair_cost"),
    repairFacility: nullableString(row, "repair_facility"),
    structuralDamage: answer(row.structural_damage),
    airbagDeployment: answer(row.airbag_deployment),
    majorRepairDetails: nullableString(row, "major_repair_details"),
    fullName: nullableString(row, "full_name"),
    email: nullableString(row, "email"),
    phone: nullableString(row, "phone"),
    preferredContactMethod: contactMethod(row.preferred_contact_method),
    availability: nullableString(row, "availability"),
    notes: nullableString(row, "notes"),
    submittedAt: requiredTimestamp(row, "submitted_at"),
    revision: requiredInteger(row, "revision"),
    createdAt: requiredTimestamp(row, "created_at"),
    updatedAt: requiredTimestamp(row, "updated_at"),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StaffDiminishedValueResponseError(
      "Supabase returned an invalid staff-review record.",
    );
  }
  return value as Record<string, unknown>;
}

function requiredString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value !== "string" || !value) {
    throw new StaffDiminishedValueResponseError(
      `Supabase returned an invalid ${key} value.`,
    );
  }
  return value;
}

function nullableString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new StaffDiminishedValueResponseError(
      `Supabase returned an invalid ${key} value.`,
    );
  }
  return value;
}

function requiredUuid(row: Record<string, unknown>, key: string) {
  const value = requiredString(row, key);
  assertUuid(value, key);
  return value;
}

function assertUuid(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) {
    throw new StaffDiminishedValueResponseError(
      `${label} must be a valid UUID.`,
    );
  }
}

function requiredTimestamp(row: Record<string, unknown>, key: string) {
  const value = requiredString(row, key);
  if (!Number.isFinite(Date.parse(value))) {
    throw new StaffDiminishedValueResponseError(
      `Supabase returned an invalid ${key} timestamp.`,
    );
  }
  return value;
}

function requiredInteger(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new StaffDiminishedValueResponseError(
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
    throw new StaffDiminishedValueResponseError(
      `Supabase returned an invalid ${key} value.`,
    );
  }
  return value;
}

function nullableVehicleConfiguration(
  row: Record<string, unknown>,
  key: string,
): VehicleConfigurationIdentity | null {
  const value = row[key];
  if (value === null) return null;
  const configuration = vehicleConfigurationIdentity(value);
  if (!configuration) {
    throw new StaffDiminishedValueResponseError(
      `Supabase returned an invalid ${key} value.`,
    );
  }
  return configuration;
}

function draftStep(value: unknown): DiminishedValueDraftStep {
  if (
    value === "start" ||
    value === "vehicle" ||
    value === "accident-repairs" ||
    value === "consultation"
  ) {
    return value;
  }
  throw new StaffDiminishedValueResponseError(
    "Supabase returned an invalid diminished-value draft step.",
  );
}

function repairStatus(
  value: unknown,
): DiminishedValueCaseDetails["repairStatus"] {
  if (
    value === null ||
    value === "complete" ||
    value === "in-progress" ||
    value === "not-started" ||
    value === "not-sure"
  ) {
    return value;
  }
  throw new StaffDiminishedValueResponseError(
    "Supabase returned an invalid diminished-value repair status.",
  );
}

function vehicleEntryMethod(
  value: unknown,
): DiminishedValueCaseDetails["vehicleEntryMethod"] {
  if (value === "vin" || value === "details") return value;
  throw new StaffDiminishedValueResponseError(
    "Supabase returned an invalid vehicle entry method.",
  );
}

function answer(
  value: unknown,
): DiminishedValueCaseDetails["otherPartyAtFault"] {
  if (
    value === null ||
    value === "yes" ||
    value === "no" ||
    value === "not-sure"
  ) {
    return value;
  }
  throw new StaffDiminishedValueResponseError(
    "Supabase returned an invalid diminished-value answer.",
  );
}

function contactMethod(
  value: unknown,
): DiminishedValueCaseDetails["preferredContactMethod"] {
  if (value === null || value === "email" || value === "phone") return value;
  throw new StaffDiminishedValueResponseError(
    "Supabase returned an invalid preferred contact method.",
  );
}
