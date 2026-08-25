import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppraisalCaseService } from "@/features/cases/service";
import {
  sameVehicleConfiguration,
  vehicleConfigurationIdentity,
} from "@/features/intake/vehicle-lookup-types";
import type {
  CreateDiminishedValueDetailsInput,
  CreateDiminishedValueDetailsValues,
  DiminishedValueCaseDetails,
  DiminishedValueDetailsChanges,
  DiminishedValueDetailsScope,
  DiminishedValueSubmissionResult,
  DiminishedValueSubmittedCaseStatus,
  SaveDiminishedValueDetailsInput,
  SubmitDiminishedValueCaseInput,
  UpdateDiminishedValueDetailsInput,
} from "@/features/diminished-value/data-types";
import type { Database, Json } from "@/lib/supabase/database.types";

const DIMINISHED_VALUE_DETAILS_COLUMNS =
  "case_id,draft_step,accident_state,accident_date,repair_status,vehicle_entry_method,vin,vehicle_year,vehicle_make,vehicle_model,vehicle_trim,vehicle_configuration,mileage_at_accident,current_mileage,other_party_at_fault,at_fault_insurer,repair_cost,repair_facility,structural_damage,airbag_deployment,major_repair_details,full_name,email,phone,preferred_contact_method,availability,notes,submitted_at,revision,created_at,updated_at" as const;

interface DiminishedValueDetailsRow {
  readonly case_id: string;
  readonly draft_step: string;
  readonly accident_state: string | null;
  readonly accident_date: string | null;
  readonly repair_status: string | null;
  readonly vehicle_entry_method: string;
  readonly vin: string | null;
  readonly vehicle_year: number | null;
  readonly vehicle_make: string | null;
  readonly vehicle_model: string | null;
  readonly vehicle_trim: string | null;
  readonly vehicle_configuration?: unknown;
  readonly mileage_at_accident: number | null;
  readonly current_mileage: number | null;
  readonly other_party_at_fault: string | null;
  readonly at_fault_insurer: string | null;
  readonly repair_cost: number | null;
  readonly repair_facility: string | null;
  readonly structural_damage: string | null;
  readonly airbag_deployment: string | null;
  readonly major_repair_details: string | null;
  readonly full_name: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly preferred_contact_method: string | null;
  readonly availability: string | null;
  readonly notes: string | null;
  readonly submitted_at: string | null;
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface DiminishedValueDetailsInsert {
  case_id: string;
  draft_step: DiminishedValueCaseDetails["draftStep"];
  vehicle_entry_method: DiminishedValueCaseDetails["vehicleEntryMethod"];
  accident_state?: string | null;
  accident_date?: string | null;
  repair_status?: DiminishedValueCaseDetails["repairStatus"];
  vin?: string | null;
  vehicle_year?: number | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_trim?: string | null;
  vehicle_configuration?: Json | null;
  mileage_at_accident?: number | null;
  current_mileage?: number | null;
  other_party_at_fault?: DiminishedValueCaseDetails["otherPartyAtFault"];
  at_fault_insurer?: string | null;
  repair_cost?: number | null;
  repair_facility?: string | null;
  structural_damage?: DiminishedValueCaseDetails["structuralDamage"];
  airbag_deployment?: DiminishedValueCaseDetails["airbagDeployment"];
  major_repair_details?: string | null;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  preferred_contact_method?: DiminishedValueCaseDetails["preferredContactMethod"];
  availability?: string | null;
  notes?: string | null;
}

type DiminishedValueDetailsUpdate = Partial<
  Omit<DiminishedValueDetailsInsert, "case_id">
>;

interface DiminishedValueSubmissionRow {
  readonly case_id: string | null;
  readonly status: string | null;
  readonly submitted_at: string | null;
}

export interface DiminishedValueDetailsService {
  getDetails(
    input: DiminishedValueDetailsScope,
  ): Promise<DiminishedValueCaseDetails | null>;
  createDetails(
    input: CreateDiminishedValueDetailsInput,
  ): Promise<DiminishedValueCaseDetails>;
  updateDetails(
    input: UpdateDiminishedValueDetailsInput,
  ): Promise<DiminishedValueCaseDetails>;
  saveDetails(
    input: SaveDiminishedValueDetailsInput,
  ): Promise<DiminishedValueCaseDetails>;
  submitCase(
    input: SubmitDiminishedValueCaseInput,
  ): Promise<DiminishedValueSubmissionResult>;
}

export class DiminishedValueDetailsResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiminishedValueDetailsResponseError";
  }
}

export class DiminishedValueDetailsConflictError extends Error {
  readonly currentDetails: DiminishedValueCaseDetails | null;

  constructor(currentDetails: DiminishedValueCaseDetails | null) {
    super(
      "The diminished-value intake changed in another session. Reload the saved version before trying again.",
    );
    this.name = "DiminishedValueDetailsConflictError";
    this.currentDetails = currentDetails;
  }
}

function mapDraftStep(
  value: string,
): DiminishedValueCaseDetails["draftStep"] {
  switch (value) {
    case "start":
    case "vehicle":
    case "accident-repairs":
    case "consultation":
      return value;
    default:
      throw new DiminishedValueDetailsResponseError(
        "Supabase returned an invalid diminished-value draft step.",
      );
  }
}

function mapRepairStatus(
  value: string | null,
): DiminishedValueCaseDetails["repairStatus"] {
  switch (value) {
    case null:
    case "complete":
    case "in-progress":
    case "not-started":
    case "not-sure":
      return value;
    default:
      throw new DiminishedValueDetailsResponseError(
        "Supabase returned an invalid diminished-value repair status.",
      );
  }
}

function mapVehicleEntryMethod(
  value: string,
): DiminishedValueCaseDetails["vehicleEntryMethod"] {
  switch (value) {
    case "vin":
    case "details":
      return value;
    default:
      throw new DiminishedValueDetailsResponseError(
        "Supabase returned an invalid diminished-value vehicle entry method.",
      );
  }
}

function mapAnswer(
  value: string | null,
): DiminishedValueCaseDetails["otherPartyAtFault"] {
  switch (value) {
    case null:
    case "yes":
    case "no":
    case "not-sure":
      return value;
    default:
      throw new DiminishedValueDetailsResponseError(
        "Supabase returned an invalid diminished-value answer.",
      );
  }
}

function mapPreferredContactMethod(
  value: string | null,
): DiminishedValueCaseDetails["preferredContactMethod"] {
  switch (value) {
    case null:
    case "email":
    case "phone":
      return value;
    default:
      throw new DiminishedValueDetailsResponseError(
        "Supabase returned an invalid diminished-value contact method.",
      );
  }
}

function mapDiminishedValueDetails(
  row: DiminishedValueDetailsRow,
): DiminishedValueCaseDetails {
  return {
    caseId: row.case_id,
    draftStep: mapDraftStep(row.draft_step),
    accidentState: row.accident_state,
    accidentDate: row.accident_date,
    repairStatus: mapRepairStatus(row.repair_status),
    vehicleEntryMethod: mapVehicleEntryMethod(row.vehicle_entry_method),
    vin: row.vin,
    vehicleYear: row.vehicle_year,
    vehicleMake: row.vehicle_make,
    vehicleModel: row.vehicle_model,
    vehicleTrim: row.vehicle_trim,
    vehicleConfiguration: optionalVehicleConfiguration(
      row.vehicle_configuration,
    ),
    mileageAtAccident: row.mileage_at_accident,
    currentMileage: row.current_mileage,
    otherPartyAtFault: mapAnswer(row.other_party_at_fault),
    atFaultInsurer: row.at_fault_insurer,
    repairCost: row.repair_cost,
    repairFacility: row.repair_facility,
    structuralDamage: mapAnswer(row.structural_damage),
    airbagDeployment: mapAnswer(row.airbag_deployment),
    majorRepairDetails: row.major_repair_details,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    preferredContactMethod: mapPreferredContactMethod(
      row.preferred_contact_method,
    ),
    availability: row.availability,
    notes: row.notes,
    submittedAt: row.submitted_at,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function optionalVehicleConfiguration(value: unknown) {
  if (value === undefined || value === null) return value;
  const configuration = vehicleConfigurationIdentity(value);
  if (configuration) return configuration;
  throw new DiminishedValueDetailsResponseError(
    "Supabase returned an invalid vehicle configuration.",
  );
}

function assertRequestedCase(
  details: DiminishedValueCaseDetails,
  expectedCaseId: string,
) {
  if (details.caseId !== expectedCaseId) {
    throw new DiminishedValueDetailsResponseError(
      "Supabase returned diminished-value details outside the requested case scope.",
    );
  }
}

function assignWritableValues(
  target: DiminishedValueDetailsInsert | DiminishedValueDetailsUpdate,
  values: CreateDiminishedValueDetailsValues | DiminishedValueDetailsChanges,
) {
  if (values.draftStep !== undefined) target.draft_step = values.draftStep;
  if (values.accidentState !== undefined) {
    target.accident_state = values.accidentState;
  }
  if (values.accidentDate !== undefined) target.accident_date = values.accidentDate;
  if (values.repairStatus !== undefined) target.repair_status = values.repairStatus;
  if (values.vehicleEntryMethod !== undefined) {
    target.vehicle_entry_method = values.vehicleEntryMethod;
  }
  if (values.vin !== undefined) target.vin = values.vin;
  if (values.vehicleYear !== undefined) target.vehicle_year = values.vehicleYear;
  if (values.vehicleMake !== undefined) target.vehicle_make = values.vehicleMake;
  if (values.vehicleModel !== undefined) target.vehicle_model = values.vehicleModel;
  if (values.vehicleTrim !== undefined) target.vehicle_trim = values.vehicleTrim;
  if (values.vehicleConfiguration !== undefined) {
    target.vehicle_configuration = values.vehicleConfiguration
      ? {
          source: values.vehicleConfiguration.source,
          field: values.vehicleConfiguration.field,
          values: [...values.vehicleConfiguration.values],
        }
      : null;
  }
  if (values.mileageAtAccident !== undefined) {
    target.mileage_at_accident = values.mileageAtAccident;
  }
  if (values.currentMileage !== undefined) {
    target.current_mileage = values.currentMileage;
  }
  if (values.otherPartyAtFault !== undefined) {
    target.other_party_at_fault = values.otherPartyAtFault;
  }
  if (values.atFaultInsurer !== undefined) {
    target.at_fault_insurer = values.atFaultInsurer;
  }
  if (values.repairCost !== undefined) target.repair_cost = values.repairCost;
  if (values.repairFacility !== undefined) {
    target.repair_facility = values.repairFacility;
  }
  if (values.structuralDamage !== undefined) {
    target.structural_damage = values.structuralDamage;
  }
  if (values.airbagDeployment !== undefined) {
    target.airbag_deployment = values.airbagDeployment;
  }
  if (values.majorRepairDetails !== undefined) {
    target.major_repair_details = values.majorRepairDetails;
  }
  if (values.fullName !== undefined) target.full_name = values.fullName;
  if (values.email !== undefined) target.email = values.email;
  if (values.phone !== undefined) target.phone = values.phone;
  if (values.preferredContactMethod !== undefined) {
    target.preferred_contact_method = values.preferredContactMethod;
  }
  if (values.availability !== undefined) target.availability = values.availability;
  if (values.notes !== undefined) target.notes = values.notes;
}

function matchesWritableValues(
  details: DiminishedValueCaseDetails,
  values: CreateDiminishedValueDetailsValues,
) {
  return (
    details.draftStep === values.draftStep &&
    details.accidentState === (values.accidentState ?? null) &&
    details.accidentDate === (values.accidentDate ?? null) &&
    details.repairStatus === (values.repairStatus ?? null) &&
    details.vehicleEntryMethod === values.vehicleEntryMethod &&
    details.vin === (values.vin ?? null) &&
    details.vehicleYear === (values.vehicleYear ?? null) &&
    details.vehicleMake === (values.vehicleMake ?? null) &&
    details.vehicleModel === (values.vehicleModel ?? null) &&
    details.vehicleTrim === (values.vehicleTrim ?? null) &&
    sameVehicleConfiguration(
      details.vehicleConfiguration ?? null,
      values.vehicleConfiguration ?? null,
    ) &&
    details.mileageAtAccident === (values.mileageAtAccident ?? null) &&
    details.currentMileage === (values.currentMileage ?? null) &&
    details.otherPartyAtFault === (values.otherPartyAtFault ?? null) &&
    details.atFaultInsurer === (values.atFaultInsurer ?? null) &&
    details.repairCost === (values.repairCost ?? null) &&
    details.repairFacility === (values.repairFacility ?? null) &&
    details.structuralDamage === (values.structuralDamage ?? null) &&
    details.airbagDeployment === (values.airbagDeployment ?? null) &&
    details.majorRepairDetails === (values.majorRepairDetails ?? null) &&
    details.fullName === (values.fullName ?? null) &&
    details.email === (values.email ?? null) &&
    details.phone === (values.phone ?? null) &&
    details.preferredContactMethod ===
      (values.preferredContactMethod ?? null) &&
    details.availability === (values.availability ?? null) &&
    details.notes === (values.notes ?? null)
  );
}

function mapSubmittedStatus(
  status: string | null,
): DiminishedValueSubmittedCaseStatus {
  if (status !== "submitted") {
    throw new DiminishedValueDetailsResponseError(
      "Supabase returned an invalid diminished-value submission status.",
    );
  }
  return status;
}

function mapSubmissionResult(
  row: DiminishedValueSubmissionRow,
  expectedCaseId: string,
): DiminishedValueSubmissionResult {
  if (row.case_id !== expectedCaseId) {
    throw new DiminishedValueDetailsResponseError(
      "Supabase returned a diminished-value submission outside the requested case scope.",
    );
  }
  if (!row.submitted_at) {
    throw new DiminishedValueDetailsResponseError(
      "Supabase returned a diminished-value submission without a submission time.",
    );
  }

  return {
    caseId: row.case_id,
    status: mapSubmittedStatus(row.status),
    submittedAt: row.submitted_at,
  };
}

async function fetchDetails(
  client: SupabaseClient<Database>,
  caseId: string,
): Promise<DiminishedValueCaseDetails | null> {
  const { data, error } = await client
    .from("diminished_value_case_details")
    .select(DIMINISHED_VALUE_DETAILS_COLUMNS)
    .eq("case_id", caseId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const details = mapDiminishedValueDetails(data);
  assertRequestedCase(details, caseId);
  return details;
}

export function createDiminishedValueDetailsService(
  client: SupabaseClient<Database>,
  appraisalCaseService: AppraisalCaseService,
): DiminishedValueDetailsService {
  const touchCaseAfterCommit = async ({
    caseId,
    userId,
  }: DiminishedValueDetailsScope) => {
    try {
      await appraisalCaseService.touchAppraisalCase({ caseId, userId });
    } catch {
      return;
    }
  };

  const service: DiminishedValueDetailsService = {
    async getDetails({ caseId }) {
      return fetchDetails(client, caseId);
    },

    async createDetails({ caseId, userId, values }) {
      const insert: DiminishedValueDetailsInsert = {
        case_id: caseId,
        draft_step: values.draftStep,
        vehicle_entry_method: values.vehicleEntryMethod,
      };
      assignWritableValues(insert, values);

      const { data, error } = await client
        .from("diminished_value_case_details")
        .insert(insert)
        .select(DIMINISHED_VALUE_DETAILS_COLUMNS)
        .single();

      if (error || !data) {
        const currentDetails = await fetchDetails(client, caseId);
        if (currentDetails) {
          if (matchesWritableValues(currentDetails, values)) {
            await touchCaseAfterCommit({ caseId, userId });
            return currentDetails;
          }
          throw new DiminishedValueDetailsConflictError(currentDetails);
        }
        if (error) throw error;
        throw new DiminishedValueDetailsResponseError(
          "Supabase did not return the created diminished-value details.",
        );
      }

      const details = mapDiminishedValueDetails(data);
      assertRequestedCase(details, caseId);
      await touchCaseAfterCommit({ caseId, userId });
      return details;
    },

    async updateDetails({ caseId, userId, expectedRevision, changes }) {
      const update: DiminishedValueDetailsUpdate = {};
      assignWritableValues(update, changes);

      const { data, error } = await client
        .from("diminished_value_case_details")
        .update(update)
        .eq("case_id", caseId)
        .eq("revision", expectedRevision)
        .select(DIMINISHED_VALUE_DETAILS_COLUMNS)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        throw new DiminishedValueDetailsConflictError(
          await fetchDetails(client, caseId),
        );
      }

      const details = mapDiminishedValueDetails(data);
      assertRequestedCase(details, caseId);
      await touchCaseAfterCommit({ caseId, userId });
      return details;
    },

    saveDetails(input) {
      if (input.expectedRevision === null) {
        return service.createDetails({
          caseId: input.caseId,
          userId: input.userId,
          values: input.values,
        });
      }
      return service.updateDetails({
        caseId: input.caseId,
        userId: input.userId,
        expectedRevision: input.expectedRevision,
        changes: input.values,
      });
    },

    async submitCase({ caseId }: SubmitDiminishedValueCaseInput) {
      const { data, error } = await client
        .rpc("submit_diminished_value_case", { case_id: caseId })
        .single();

      if (error) throw error;
      if (!data) {
        throw new DiminishedValueDetailsResponseError(
          "Supabase did not return the diminished-value submission receipt.",
        );
      }

      return mapSubmissionResult(data, caseId);
    },
  };

  return service;
}
