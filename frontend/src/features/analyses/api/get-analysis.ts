import { environment } from "@/config/env";
import type { AnalysisPresentation } from "@/features/analyses/analysis-presentation.generated";
import { createApiClient } from "@/lib/api/client";

const apiClient = createApiClient({ baseUrl: environment.apiBaseUrl });

export function getAnalysis(runId: string, signal?: AbortSignal) {
  return apiClient.get<AnalysisPresentation>(
    `/api/v1/analyses/${encodeURIComponent(runId)}`,
    signal,
  );
}
