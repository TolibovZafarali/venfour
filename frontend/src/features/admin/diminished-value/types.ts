import type { DiminishedValueCaseDetails } from "@/features/diminished-value/data-types";

export interface StaffDiminishedValueQueueItem {
  readonly caseId: string;
  readonly ownerUserId: string;
  readonly serviceType: "diminished_value";
  readonly status: "submitted";
  readonly submittedAt: string;
  readonly fullName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly preferredContactMethod: "email" | "phone" | null;
  readonly vehicleYear: number | null;
  readonly vehicleMake: string | null;
  readonly vehicleModel: string | null;
  readonly accidentDate: string | null;
  readonly atFaultInsurer: string | null;
  readonly documentCount: number;
}

export interface StaffDiminishedValueCase extends DiminishedValueCaseDetails {
  readonly ownerUserId: string;
  readonly serviceType: "diminished_value";
  readonly status: "submitted";
  readonly submittedAt: string;
}
