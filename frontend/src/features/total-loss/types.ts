export const TOTAL_LOSS_INTAKE_MODES = ["report", "manual"] as const;

export type TotalLossIntakeMode = (typeof TOTAL_LOSS_INTAKE_MODES)[number];

export const TOTAL_LOSS_INTAKE_STEPS = [
  "choice",
  "vehicle",
  "claim",
  "report",
  "ready",
] as const;

export type TotalLossIntakeStep = (typeof TOTAL_LOSS_INTAKE_STEPS)[number];

export const TOTAL_LOSS_PENDING_AUTH_ACTIONS = [
  "complete-manual",
  "upload-report",
] as const;

export type TotalLossPendingAuthAction =
  (typeof TOTAL_LOSS_PENDING_AUTH_ACTIONS)[number];

export interface TotalLossManualFormValues {
  readonly vin: string;
  readonly vehicleYear: string;
  readonly make: string;
  readonly model: string;
  readonly trim: string;
  readonly mileageAtLoss: string;
  readonly zipCode: string;
  readonly dateOfLoss: string;
  readonly insurerName: string;
  readonly insurerVehicleValuation: string;
}

export type TotalLossManualFormErrors = Partial<
  Record<keyof TotalLossManualFormValues, string>
>;

export const TOTAL_LOSS_MANUAL_FORM_DEFAULTS = {
  vin: "",
  vehicleYear: "",
  make: "",
  model: "",
  trim: "",
  mileageAtLoss: "",
  zipCode: "",
  dateOfLoss: "",
  insurerName: "",
  insurerVehicleValuation: "",
} as const satisfies TotalLossManualFormValues;

export function createEmptyTotalLossManualForm(): TotalLossManualFormValues {
  return { ...TOTAL_LOSS_MANUAL_FORM_DEFAULTS };
}

export const TOTAL_LOSS_DRAFT_VERSION = 1 as const;

export interface TotalLossDraft {
  readonly version: typeof TOTAL_LOSS_DRAFT_VERSION;
  readonly mode: TotalLossIntakeMode | null;
  readonly step: TotalLossIntakeStep;
  readonly manual: TotalLossManualFormValues;
  readonly confirmedCaseId: string | null;
  readonly reservedCaseId: string | null;
  readonly ownerUserId: string | null;
  readonly pendingAuthAction: TotalLossPendingAuthAction | null;
  readonly dirty: boolean;
  readonly revision: number;
  readonly dismissedResumeCaseId: string | null;
  readonly lastUpdatedAt: string;
}
