import { environment } from "@/config/env";
import { createApiClient } from "@/lib/api/client";
import type { HealthResponse } from "@/lib/api/contracts";

const apiClient = createApiClient({ baseUrl: environment.apiBaseUrl });

export function getHealth(signal?: AbortSignal) {
  return apiClient.get<HealthResponse>("/health", signal);
}
