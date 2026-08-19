import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getCaseAnalysis,
  submitCaseAnalysis,
} from "@/features/analyses/api/case-analysis";
import { appraisalCaseQueryKeys } from "@/features/cases/queries";
import { ApiError } from "@/lib/api/client";

export const caseAnalysisQueryKeys = {
  detail: (userId: string | null, caseId: string) =>
    [
      ...appraisalCaseQueryKeys.detail(userId, caseId),
      "analysis",
    ] as const,
};

interface CaseAnalysisQueryOptions {
  readonly accessToken: string | null;
  readonly caseId: string;
  readonly userId: string | null;
}

export function useCaseAnalysisQuery({
  accessToken,
  caseId,
  userId,
}: CaseAnalysisQueryOptions) {
  return useQuery({
    queryKey: caseAnalysisQueryKeys.detail(userId, caseId),
    queryFn: ({ signal }) => {
      if (!accessToken || !userId) {
        throw new Error("An authenticated session is required.");
      }
      return getCaseAnalysis(caseId, accessToken, signal);
    },
    enabled: Boolean(accessToken && userId),
    refetchInterval: (query) =>
      query.state.data?.status === "processing" ? 1_500 : false,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status < 500) return false;
      return failureCount < 1;
    },
    retryDelay: 250,
    staleTime: 0,
  });
}

export function useSubmitCaseAnalysisMutation({
  accessToken,
  caseId,
  userId,
}: CaseAnalysisQueryOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ signal }: { readonly signal?: AbortSignal } = {}) => {
      if (!accessToken || !userId) {
        throw new Error("An authenticated session is required.");
      }
      return submitCaseAnalysis(caseId, accessToken, signal);
    },
    onMutate: () => {
      const queryKey = caseAnalysisQueryKeys.detail(userId, caseId);
      const current = queryClient.getQueryData<{
        readonly attemptCount?: number;
      }>(queryKey);
      queryClient.setQueryData(queryKey, {
        status: "processing",
        attemptCount: current?.attemptCount ?? 0,
        processingExpiresAt: null,
      });
    },
    onSuccess: (status) => {
      queryClient.setQueryData(
        caseAnalysisQueryKeys.detail(userId, caseId),
        status,
      );
    },
    onError: async () => {
      await queryClient.invalidateQueries({
        queryKey: caseAnalysisQueryKeys.detail(userId, caseId),
      });
    },
    retry: false,
  });
}
