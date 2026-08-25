import type { TotalLossIntakeMode } from "@/features/total-loss/types";

export interface TotalLossCaseDetailsValues {
  readonly intakeMode: TotalLossIntakeMode;
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
  readonly priorTitleStatus?: string | null;
  readonly vehicleCondition?: string | null;
  readonly existingDamageDescription?: string | null;
  readonly optionsPackages?: string | null;
  readonly reportProvider?: string | null;
  readonly reportExtractionStatus?:
    | "not_requested"
    | "pending"
    | "needs_confirmation"
    | "confirmed"
    | "failed"
    | null;
  readonly reportExtractionConfidence?: number | null;
  readonly reportExtractedAt?: string | null;
  readonly reportFactsConfirmedAt?: string | null;
  readonly analysisInputRevision?: number | null;
  readonly analysisInputId?: string | null;
  readonly reportStorageOwnerId?: string | null;
  readonly reportOriginalFilename: string | null;
  readonly reportUploadedAt: string | null;
  readonly intakeCompletedAt: string | null;
}

export interface TotalLossCaseDetails extends TotalLossCaseDetailsValues {
  readonly caseId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type TotalLossDirectlyWritableValues = Omit<
  TotalLossCaseDetailsValues,
  | "reportOriginalFilename"
  | "reportUploadedAt"
  | "reportProvider"
  | "reportExtractionStatus"
  | "reportExtractionConfidence"
  | "reportExtractedAt"
  | "reportFactsConfirmedAt"
  | "analysisInputRevision"
  | "analysisInputId"
  | "reportStorageOwnerId"
  | "intakeCompletedAt"
>;

export type CreateTotalLossDetailsValues = Pick<
  TotalLossDirectlyWritableValues,
  "intakeMode"
> &
  Partial<Omit<TotalLossDirectlyWritableValues, "intakeMode">>;

export type TotalLossDetailsChanges = Partial<TotalLossDirectlyWritableValues>;

export interface TotalLossDetailsScope {
  readonly caseId: string;
  readonly userId: string;
}

export interface CreateTotalLossDetailsInput extends TotalLossDetailsScope {
  readonly values: CreateTotalLossDetailsValues;
}

export interface UpdateTotalLossDetailsInput extends TotalLossDetailsScope {
  readonly expectedUpdatedAt: string;
  readonly changes: TotalLossDetailsChanges;
}

export type SaveTotalLossDetailsInput =
  | (TotalLossDetailsScope & {
      readonly expectedUpdatedAt: null;
      readonly values: CreateTotalLossDetailsValues;
    })
  | (TotalLossDetailsScope & {
      readonly expectedUpdatedAt: string;
      readonly values: TotalLossDetailsChanges;
    });

export interface AcquireTotalLossReportUploadLeaseInput
  extends TotalLossDetailsScope {
  readonly expectedUpdatedAt: string | null;
  readonly uploadId: string;
}

export interface TotalLossReportUploadLease {
  readonly uploadId: string;
  readonly expiresAt: string;
  readonly detailsUpdatedAt: string;
  readonly reportOriginalFilename: string | null;
  readonly reportUploadedAt: string | null;
  readonly recoveryRequired: boolean;
  readonly storageOwnerUserId?: string;
}

export interface TotalLossContact {
  readonly caseId: string;
  readonly fullName: string;
  readonly email: string;
  readonly emailVerifiedAt: string | null;
  readonly serviceTermsVersion: string;
  readonly serviceTermsAcknowledgedAt: string;
  readonly privacyNoticeVersion: string;
  readonly privacyNoticeAcknowledgedAt: string;
  readonly operationalFollowUpAllowed: boolean;
  readonly operationalFollowUpUpdatedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SaveTotalLossContactInput extends TotalLossDetailsScope {
  readonly fullName: string;
  readonly email: string;
  readonly serviceTermsVersion: string;
  readonly privacyNoticeVersion: string;
  readonly operationalFollowUpAllowed: boolean;
}

export interface TotalLossIdentityClaim {
  readonly claimId: string | null;
  readonly expiresAt: string | null;
  readonly contact: TotalLossContact;
}

export interface CompleteTotalLossIdentityClaimResult {
  readonly outcome: "claimed" | "already_claimed";
  readonly caseId: string;
  readonly ownerUserId: string;
  readonly contactEmail: string;
  readonly emailVerifiedAt: string;
  readonly claimedAt: string;
  readonly ownershipTransferred: boolean;
}

export interface ConfirmTotalLossIntakeInput extends TotalLossDetailsScope {
  readonly expectedUpdatedAt: string;
}

export interface TotalLossReportUploadLeaseScope
  extends TotalLossDetailsScope {
  readonly uploadId: string;
}

export interface FinalizeTotalLossReportUploadInput
  extends TotalLossReportUploadLeaseScope {
  readonly originalFilename: string;
  readonly uploadedAt: string;
}

export interface MarkTotalLossReportUploadReadyInput
  extends TotalLossReportUploadLeaseScope {
  readonly hasBackup: boolean;
}
