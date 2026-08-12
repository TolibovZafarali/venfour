import { environment } from "@/config/env";
import { ApiError, createApiClient } from "@/lib/api/client";
import type { CreateAnalysisResponse } from "@/lib/api/contracts";

export interface CreateAnalysisInput {
  report: File;
  postalCode: string;
}

const apiClient = createApiClient({ baseUrl: environment.apiBaseUrl });

export async function createAnalysis({
  report,
  postalCode,
}: CreateAnalysisInput) {
  const formData = new FormData();
  formData.append("report", report, report.name);
  formData.append("postalCode", postalCode.trim());

  const response = await apiClient.postForm<CreateAnalysisResponse>(
    "/api/v1/analyses",
    formData,
  );

  if (!response.runId || typeof response.runId !== "string") {
    throw new ApiError("The API returned an invalid analysis ID.", 502);
  }

  return response;
}
