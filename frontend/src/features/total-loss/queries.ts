import { queryOptions, useQuery } from "@tanstack/react-query";

import { appraisalCaseQueryKeys } from "@/features/cases/queries";
import type { TotalLossDetailsService } from "@/features/total-loss/service";

export const totalLossQueryKeys = {
  all: [...appraisalCaseQueryKeys.all, "totalLoss"] as const,
  user: (userId: string | null) =>
    [...appraisalCaseQueryKeys.user(userId), "totalLoss"] as const,
  details: (userId: string | null, caseId: string) =>
    [...totalLossQueryKeys.user(userId), "details", caseId] as const,
};

interface TotalLossDetailsQueryOptions {
  readonly service: TotalLossDetailsService | null;
  readonly userId: string | null;
  readonly caseId: string | null;
}

export function totalLossDetailsQueryOptions({
  service,
  userId,
  caseId,
}: TotalLossDetailsQueryOptions) {
  return queryOptions({
    queryKey: totalLossQueryKeys.details(userId, caseId ?? "unconfirmed"),
    queryFn: () => {
      if (!service || !userId || !caseId) {
        throw new Error(
          "Authenticated total-loss data access is not available.",
        );
      }
      return service.getDetails({ caseId, userId });
    },
    enabled: Boolean(service && userId && caseId),
    refetchInterval: (query) =>
      query.state.data?.reportUploadRecoveryRequired ? 1_000 : false,
  });
}

export function useTotalLossDetailsQuery(
  options: TotalLossDetailsQueryOptions,
) {
  return useQuery(totalLossDetailsQueryOptions(options));
}
