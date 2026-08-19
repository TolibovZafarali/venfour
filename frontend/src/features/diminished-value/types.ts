export const DIMINISHED_VALUE_STEPS = [
  "start",
  "vehicle",
  "accident-repairs",
  "consultation",
  "complete",
] as const;

export type DiminishedValueStep = (typeof DIMINISHED_VALUE_STEPS)[number];

export const DIMINISHED_VALUE_REPAIR_STATUSES = [
  "complete",
  "in-progress",
  "not-started",
  "not-sure",
] as const;

export type DiminishedValueRepairStatus =
  (typeof DIMINISHED_VALUE_REPAIR_STATUSES)[number];

export const DIMINISHED_VALUE_ANSWER_OPTIONS = [
  "yes",
  "no",
  "not-sure",
] as const;

export type DiminishedValueAnswer =
  (typeof DIMINISHED_VALUE_ANSWER_OPTIONS)[number];

export const DIMINISHED_VALUE_CONTACT_METHODS = ["email", "phone"] as const;

export type DiminishedValueContactMethod =
  (typeof DIMINISHED_VALUE_CONTACT_METHODS)[number];

export type DiminishedValueVehicleEntryMethod = "vin" | "details";

export interface DiminishedValueDraft {
  readonly step: DiminishedValueStep;
  readonly returnAfterStartEdit: boolean;
  readonly accidentState: string;
  readonly accidentDate: string;
  readonly repairStatus: DiminishedValueRepairStatus | "";
  readonly vehicleEntryMethod: DiminishedValueVehicleEntryMethod;
  readonly vin: string;
  readonly vehicleYear: string;
  readonly make: string;
  readonly model: string;
  readonly trim: string;
  readonly mileageAtAccident: string;
  readonly currentMileage: string;
  readonly otherPartyAtFault: DiminishedValueAnswer | "";
  readonly atFaultInsurer: string;
  readonly repairCost: string;
  readonly repairFacility: string;
  readonly structuralDamage: DiminishedValueAnswer | "";
  readonly airbagDeployment: DiminishedValueAnswer | "";
  readonly majorRepairDetails: string;
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
  readonly preferredContactMethod: DiminishedValueContactMethod | "";
  readonly availability: string;
  readonly notes: string;
}

export type DiminishedValueFormField = Exclude<
  keyof DiminishedValueDraft,
  "step" | "returnAfterStartEdit" | "vehicleEntryMethod"
>;

export type DiminishedValueFormErrors = Partial<
  Record<DiminishedValueFormField, string>
>;

export const DIMINISHED_VALUE_DRAFT_DEFAULTS = {
  step: "start",
  returnAfterStartEdit: false,
  accidentState: "",
  accidentDate: "",
  repairStatus: "",
  vehicleEntryMethod: "vin",
  vin: "",
  vehicleYear: "",
  make: "",
  model: "",
  trim: "",
  mileageAtAccident: "",
  currentMileage: "",
  otherPartyAtFault: "",
  atFaultInsurer: "",
  repairCost: "",
  repairFacility: "",
  structuralDamage: "",
  airbagDeployment: "",
  majorRepairDetails: "",
  fullName: "",
  email: "",
  phone: "",
  preferredContactMethod: "",
  availability: "",
  notes: "",
} as const satisfies DiminishedValueDraft;

export function createEmptyDiminishedValueDraft(): DiminishedValueDraft {
  return { ...DIMINISHED_VALUE_DRAFT_DEFAULTS };
}
