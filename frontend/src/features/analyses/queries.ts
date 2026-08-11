import { queryOptions, useQuery } from "@tanstack/react-query";

import { getAnalysis } from "@/features/analyses/api/get-analysis";
import { ApiError } from "@/lib/api/client";

export const analysisQueryKeys = {
  all: ["analyses"] as const,
  detail: (runId: string) => [...analysisQueryKeys.all, "detail", runId] as const,
};

export function analysisQueryOptions(runId: string) {
  return queryOptions({
    queryKey: analysisQueryKeys.detail(runId),
    queryFn: ({ signal }) => getAnalysis(runId, signal),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status < 500) {
        return false;
      }
      return failureCount < 1;
    },
    retryDelay: 250,
  });
}

export function useAnalysisQuery(runId: string) {
  return useQuery(analysisQueryOptions(runId));
}
