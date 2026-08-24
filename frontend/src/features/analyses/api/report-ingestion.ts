import { environment } from "@/config/env";
import { createApiClient } from "@/lib/api/client";

const apiClient = createApiClient({ baseUrl: environment.apiBaseUrl });

export interface TotalLossExtractedFacts {
  readonly vin: string | null;
  readonly vehicleYear: number | null;
  readonly make: string | null;
  readonly model: string | null;
  readonly trim: string | null;
  readonly mileageAtLoss: number | null;
  readonly zipCode: string | null;
  readonly dateOfLoss: string | null;
  readonly insurerName: string | null;
  readonly insurerVehicleValuation: number | null;
  readonly vehicleCondition: string | null;
  readonly optionsPackages: string | null;
}

export interface TotalLossReportIngestion {
  readonly status: "complete" | "partial";
  readonly provider: string | null;
  readonly adapter: "ccc" | "generic";
  readonly confidence: "high" | "medium" | "low";
  readonly warnings: readonly string[];
  readonly missingFields: readonly string[];
  readonly facts: TotalLossExtractedFacts;
}

export function ingestTotalLossReport(
  caseId: string,
  accessToken: string,
  signal?: AbortSignal,
) {
  return apiClient.postAuthenticated<TotalLossReportIngestion>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/report-ingestion`,
    { accessToken, signal },
  );
}
