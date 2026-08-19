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
  "reportOriginalFilename" | "reportUploadedAt"
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
