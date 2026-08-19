import { queryOptions, useQuery } from "@tanstack/react-query";

import { getAnalysis } from "@/features/analyses/api/get-analysis";
import { appraisalCaseQueryKeys } from "@/features/cases/queries";
import { ApiError } from "@/lib/api/client";

export const analysisQueryKeys = {
  user: (userId: string | null) =>
    [...appraisalCaseQueryKeys.user(userId), "analyses"] as const,
  detail: (userId: string | null, runId: string) =>
    [...analysisQueryKeys.user(userId), "detail", runId] as const,
};

interface AnalysisQueryOptions {
  readonly accessToken: string;
  readonly runId: string;
  readonly userId: string;
}

export function analysisQueryOptions({
  accessToken,
  runId,
  userId,
}: AnalysisQueryOptions) {
  return queryOptions({
    queryKey: analysisQueryKeys.detail(userId, runId),
    queryFn: ({ signal }) => getAnalysis(runId, accessToken, signal),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status < 500) {
        return false;
      }
      return failureCount < 1;
    },
    retryDelay: 250,
  });
}

export function useAnalysisQuery(options: AnalysisQueryOptions) {
  return useQuery(analysisQueryOptions(options));
}
