import { useMutation, useQuery } from "@tanstack/react-query";

import type { AuthContextValue } from "@/features/auth";
import { appraisalCaseQueryKeys } from "@/features/cases/queries";
import {
  getTotalLossClaim,
  renewTotalLossClaimAccessLink,
  requestTotalLossClaimRecovery,
} from "@/features/total-loss-claim/api";
import { ApiError } from "@/lib/api/client";

export const totalLossClaimQueryKeys = {
  detail: (userId: string | null, caseId: string) =>
    [
      ...appraisalCaseQueryKeys.detail(userId, caseId),
      "claim",
    ] as const,
};

interface ClaimIdentityOptions {
  readonly accessToken: string | null;
  readonly caseId: string;
  readonly userId: string | null;
}

export function useTotalLossClaimQuery({
  accessToken,
  caseId,
  userId,
}: ClaimIdentityOptions) {
  return useQuery({
    queryKey: totalLossClaimQueryKeys.detail(userId, caseId),
    queryFn: ({ signal }) => {
      if (!accessToken || !userId) {
        throw new Error("An authenticated session is required.");
      }
      return getTotalLossClaim(caseId, accessToken, signal);
    },
    enabled: Boolean(accessToken && userId),
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status < 500) return false;
      return failureCount < 1;
    },
    retryDelay: 250,
    staleTime: 0,
  });
}

export function useRenewTotalLossClaimAccessLinkMutation({
  accessToken,
  caseId,
  userId,
}: ClaimIdentityOptions) {
  return useMutation({
    gcTime: 0,
    mutationKey: [
      ...totalLossClaimQueryKeys.detail(userId, caseId),
      "accessLink",
    ],
    mutationFn: ({ signal }: { readonly signal?: AbortSignal } = {}) => {
      if (!accessToken || !userId) {
        throw new Error("An authenticated session is required.");
      }
      return renewTotalLossClaimAccessLink(caseId, accessToken, signal);
    },
    retry: false,
  });
}

interface ClaimRecoveryMutationOptions {
  readonly caseId: string;
  readonly runTurnstileChallenge: AuthContextValue["runTurnstileChallenge"];
}

export function useTotalLossClaimRecoveryMutation({
  caseId,
  runTurnstileChallenge,
}: ClaimRecoveryMutationOptions) {
  return useMutation({
    gcTime: 0,
    mutationKey: ["totalLossClaimRecovery", caseId],
    mutationFn: ({
      email,
      signal,
    }: {
      readonly email: string;
      readonly signal?: AbortSignal;
    }) =>
      runTurnstileChallenge(
        "claim-recovery",
        (turnstileToken) =>
          requestTotalLossClaimRecovery(
            caseId,
            { email, turnstileToken },
            signal,
          ),
        signal,
      ),
    retry: false,
  });
}
