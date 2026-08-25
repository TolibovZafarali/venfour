import type { VehicleConfigurationIdentity } from "@/features/intake/vehicle-lookup-types";
import type {
  DiminishedValueAnswer,
  DiminishedValueContactMethod,
  DiminishedValueRepairStatus,
  DiminishedValueStep,
  DiminishedValueVehicleEntryMethod,
} from "./types";

export type DiminishedValueDraftStep = Exclude<
  DiminishedValueStep,
  "complete"
>;

export interface DiminishedValueCaseDetailsValues {
  readonly draftStep: DiminishedValueDraftStep;
  readonly accidentState: string | null;
  readonly accidentDate: string | null;
  readonly repairStatus: DiminishedValueRepairStatus | null;
  readonly vehicleEntryMethod: DiminishedValueVehicleEntryMethod;
  readonly vin: string | null;
  readonly vehicleYear: number | null;
  readonly vehicleMake: string | null;
  readonly vehicleModel: string | null;
  readonly vehicleTrim: string | null;
  readonly vehicleConfiguration?: VehicleConfigurationIdentity | null;
  readonly mileageAtAccident: number | null;
  readonly currentMileage: number | null;
  readonly otherPartyAtFault: DiminishedValueAnswer | null;
  readonly atFaultInsurer: string | null;
  readonly repairCost: number | null;
  readonly repairFacility: string | null;
  readonly structuralDamage: DiminishedValueAnswer | null;
  readonly airbagDeployment: DiminishedValueAnswer | null;
  readonly majorRepairDetails: string | null;
  readonly fullName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly preferredContactMethod: DiminishedValueContactMethod | null;
  readonly availability: string | null;
  readonly notes: string | null;
}

export interface DiminishedValueCaseDetails
  extends DiminishedValueCaseDetailsValues {
  readonly caseId: string;
  readonly revision: number;
  readonly submittedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CreateDiminishedValueDetailsValues = Pick<
  DiminishedValueCaseDetailsValues,
  "draftStep" | "vehicleEntryMethod"
> &
  Partial<
    Omit<
      DiminishedValueCaseDetailsValues,
      "draftStep" | "vehicleEntryMethod"
    >
  >;

export type DiminishedValueDetailsChanges = Partial<
  DiminishedValueCaseDetailsValues
>;

export interface DiminishedValueDetailsScope {
  readonly caseId: string;
  readonly userId: string;
}

export interface CreateDiminishedValueDetailsInput
  extends DiminishedValueDetailsScope {
  readonly values: CreateDiminishedValueDetailsValues;
}

export interface UpdateDiminishedValueDetailsInput
  extends DiminishedValueDetailsScope {
  readonly expectedRevision: number;
  readonly changes: DiminishedValueDetailsChanges;
}

export type SaveDiminishedValueDetailsInput =
  | (DiminishedValueDetailsScope & {
      readonly expectedRevision: null;
      readonly values: CreateDiminishedValueDetailsValues;
    })
  | (DiminishedValueDetailsScope & {
      readonly expectedRevision: number;
      readonly values: DiminishedValueDetailsChanges;
    });

export type SubmitDiminishedValueCaseInput = DiminishedValueDetailsScope;

export type DiminishedValueSubmittedCaseStatus = "submitted";

export interface DiminishedValueSubmissionResult {
  readonly caseId: string;
  readonly status: DiminishedValueSubmittedCaseStatus;
  readonly submittedAt: string;
}
