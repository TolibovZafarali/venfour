import { queryOptions, useQuery } from "@tanstack/react-query";

import type { AppraisalCaseService } from "@/features/cases/service";

export const appraisalCaseQueryKeys = {
  all: ["appraisalCases"] as const,
  user: (userId: string | null) =>
    [...appraisalCaseQueryKeys.all, "user", userId] as const,
  list: (userId: string | null) =>
    [...appraisalCaseQueryKeys.user(userId), "list"] as const,
  detail: (userId: string | null, caseId: string) =>
    [...appraisalCaseQueryKeys.user(userId), "detail", caseId] as const,
};

interface AppraisalCasesQueryOptions {
  readonly service: AppraisalCaseService;
  readonly userId: string | null;
}

interface AppraisalCaseQueryOptions extends AppraisalCasesQueryOptions {
  readonly caseId: string;
}

export function appraisalCasesQueryOptions({
  service,
  userId,
}: AppraisalCasesQueryOptions) {
  return queryOptions({
    queryKey: appraisalCaseQueryKeys.list(userId),
    queryFn: () => {
      if (!userId) {
        throw new Error("An authenticated user is required to list cases.");
      }
      return service.listAppraisalCases(userId);
    },
    enabled: Boolean(userId),
  });
}

export function appraisalCaseQueryOptions({
  caseId,
  service,
  userId,
}: AppraisalCaseQueryOptions) {
  return queryOptions({
    queryKey: appraisalCaseQueryKeys.detail(userId, caseId),
    queryFn: () => {
      if (!userId) {
        throw new Error("An authenticated user is required to fetch a case.");
      }
      return service.getAppraisalCase({ caseId, userId });
    },
    enabled: Boolean(userId),
  });
}

export function useAppraisalCasesQuery(options: AppraisalCasesQueryOptions) {
  return useQuery(appraisalCasesQueryOptions(options));
}

export function useAppraisalCaseQuery(options: AppraisalCaseQueryOptions) {
  return useQuery(appraisalCaseQueryOptions(options));
}
