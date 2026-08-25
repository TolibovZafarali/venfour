export const TOTAL_LOSS_INTAKE_MODES = ["report", "manual"] as const;

export type TotalLossIntakeMode = (typeof TOTAL_LOSS_INTAKE_MODES)[number];

export const TOTAL_LOSS_INTAKE_STEPS = [
  "choice",
  "report",
  "vehicle",
  "claim",
  "contact",
  "review",
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
  readonly vehicleCondition: string;
  readonly optionsPackages: string;
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
  vehicleCondition: "",
  optionsPackages: "",
} as const satisfies TotalLossManualFormValues;

export function createEmptyTotalLossManualForm(): TotalLossManualFormValues {
  return { ...TOTAL_LOSS_MANUAL_FORM_DEFAULTS };
}

export interface TotalLossContactFormValues {
  readonly fullName: string;
  readonly email: string;
  readonly termsAccepted: boolean;
  readonly privacyAccepted: boolean;
  readonly operationalFollowUpAllowed: boolean;
}

export type TotalLossContactFormErrors = Partial<
  Record<"fullName" | "email" | "legal", string>
>;

export const TOTAL_LOSS_CONTACT_FORM_DEFAULTS = {
  fullName: "",
  email: "",
  termsAccepted: false,
  privacyAccepted: false,
  operationalFollowUpAllowed: false,
} as const satisfies TotalLossContactFormValues;

export function createEmptyTotalLossContactForm(): TotalLossContactFormValues {
  return { ...TOTAL_LOSS_CONTACT_FORM_DEFAULTS };
}

export type TotalLossReportExtractionStatus =
  | "idle"
  | "processing"
  | "complete"
  | "partial"
  | "error";

export const TOTAL_LOSS_DRAFT_VERSION = 4 as const;

export interface TotalLossDraft {
  readonly version: typeof TOTAL_LOSS_DRAFT_VERSION;
  readonly mode: TotalLossIntakeMode | null;
  readonly step: TotalLossIntakeStep;
  readonly manual: TotalLossManualFormValues;
  readonly contact: TotalLossContactFormValues;
  readonly reportProvider: string | null;
  readonly reportExtractionStatus: TotalLossReportExtractionStatus;
  readonly reportExtractionWarnings: readonly string[];
  readonly identityClaimId: string | null;
  readonly identityClaimExpiresAt: string | null;
  readonly accessLinkSentAt: string | null;
  readonly confirmedCaseId: string | null;
  readonly reservedCaseId: string | null;
  readonly ownerUserId: string | null;
  readonly pendingAuthAction: TotalLossPendingAuthAction | null;
  readonly dirty: boolean;
  readonly revision: number;
  readonly dismissedResumeCaseId: string | null;
  readonly lastUpdatedAt: string;
}
