import { environment } from "@/config/env";
import type { AnalysisPresentation } from "@/features/analyses/analysis-presentation.generated";
import { createApiClient } from "@/lib/api/client";

const apiClient = createApiClient({ baseUrl: environment.apiBaseUrl });

export function getAnalysis(
  runId: string,
  accessToken: string,
  signal?: AbortSignal,
) {
  return apiClient.getAuthenticated<AnalysisPresentation>(
    `/api/v1/analyses/${encodeURIComponent(runId)}`,
    { accessToken, signal },
  );
}
