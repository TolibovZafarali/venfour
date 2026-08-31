import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AuthContextValue } from "@/features/auth";
import { appraisalCaseQueryKeys } from "@/features/cases/queries";
import {
  confirmTotalLossMessageSent,
  createTotalLossCheckout,
  getTotalLossClaim,
  getTotalLossCheckoutQuote,
  getTotalLossReportDownload,
  prepareTotalLossMessage,
  reconcileTotalLossCheckout,
  recordTotalLossMessageOpened,
  renewTotalLossClaimAccessLink,
  requestTotalLossClaimRecovery,
  updateTotalLossEducationProgress,
  updateTotalLossMessageDraft,
  updateTotalLossSendingDetails,
} from "@/features/total-loss-claim/api";
import type {
  TotalLossEducationProgressState,
  TotalLossEducationStep,
} from "@/features/total-loss-claim/contracts";
import { ApiError } from "@/lib/api/client";

export const totalLossClaimQueryKeys = {
  detail: (userId: string | null, caseId: string) =>
    [
      ...appraisalCaseQueryKeys.detail(userId, caseId),
      "claim",
    ] as const,
  quote: (userId: string | null, caseId: string) =>
    [...appraisalCaseQueryKeys.detail(userId, caseId), "checkoutQuote"] as const,
};

interface ClaimIdentityOptions {
  readonly accessToken: string | null;
  readonly caseId: string;
  readonly userId: string | null;
}

export function useTotalLossClaimQuery({
  accessToken,
  caseId,
  suspendRefetch = false,
  userId,
}: ClaimIdentityOptions & { readonly suspendRefetch?: boolean }) {
  return useQuery({
    queryKey: totalLossClaimQueryKeys.detail(userId, caseId),
    queryFn: ({ signal }) => {
      if (!accessToken || !userId) {
        throw new Error("An authenticated session is required.");
      }
      return getTotalLossClaim(caseId, accessToken, signal);
    },
    enabled: Boolean(accessToken && userId) && !suspendRefetch,
    refetchInterval: (query) => {
      const nextState = query.state.data?.journey?.nextState;
      const fulfillmentState =
        query.state.data?.journey?.fulfillmentState;
      return nextState === "processing" ||
        nextState === "checkout_confirmation" ||
        fulfillmentState === "refund_pending"
        ? 2_000
        : false;
    },
    refetchOnWindowFocus: !suspendRefetch,
    refetchOnReconnect: !suspendRefetch,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status < 500) return false;
      return failureCount < 1;
    },
    retryDelay: 250,
    staleTime: 0,
  });
}

export function useTotalLossCheckoutQuoteQuery({
  accessToken,
  caseId,
  userId,
}: ClaimIdentityOptions) {
  return useQuery({
    queryKey: totalLossClaimQueryKeys.quote(userId, caseId),
    queryFn: ({ signal }) => {
      if (!accessToken || !userId) {
        throw new Error("An authenticated session is required.");
      }
      return getTotalLossCheckoutQuote(caseId, accessToken, signal);
    },
    enabled: Boolean(accessToken && userId),
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 60_000,
  });
}

function useClaimMutationInvalidation({
  caseId,
  userId,
}: Pick<ClaimIdentityOptions, "caseId" | "userId">) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      queryKey: totalLossClaimQueryKeys.detail(userId, caseId),
    });
}

export function useTotalLossCheckoutMutation({
  accessToken,
  caseId,
  userId,
}: ClaimIdentityOptions) {
  const invalidate = useClaimMutationInvalidation({ caseId, userId });
  return useMutation({
    gcTime: 0,
    mutationKey: [...totalLossClaimQueryKeys.detail(userId, caseId), "checkout"],
    mutationFn: ({ clientRequestId }: { readonly clientRequestId: string }) => {
      if (!accessToken || !userId) {
        throw new Error("An authenticated session is required.");
      }
      return createTotalLossCheckout(caseId, accessToken, clientRequestId);
    },
    onSuccess: invalidate,
    retry: false,
  });
}

export function useTotalLossCheckoutReconciliationMutation({
  accessToken,
  caseId,
  userId,
}: ClaimIdentityOptions) {
  const invalidate = useClaimMutationInvalidation({ caseId, userId });
  return useMutation({
    gcTime: 0,
    mutationKey: [
      ...totalLossClaimQueryKeys.detail(userId, caseId),
      "checkoutReconciliation",
    ],
    mutationFn: ({ checkoutSessionId }: { readonly checkoutSessionId: string }) => {
      if (!accessToken || !userId) {
        throw new Error("An authenticated session is required.");
      }
      return reconcileTotalLossCheckout(
        caseId,
        accessToken,
        checkoutSessionId,
      );
    },
    onSuccess: invalidate,
    retry: false,
  });
}

export function useTotalLossEducationProgressMutation({
  accessToken,
  caseId,
  userId,
}: ClaimIdentityOptions) {
  const invalidate = useClaimMutationInvalidation({ caseId, userId });
  return useMutation({
    gcTime: 0,
    mutationKey: [...totalLossClaimQueryKeys.detail(userId, caseId), "education"],
    mutationFn: ({
      expectedWorkflowRevision,
      state,
      step,
    }: {
      readonly expectedWorkflowRevision: number;
      readonly state: TotalLossEducationProgressState;
      readonly step: TotalLossEducationStep;
    }) => {
      if (!accessToken || !userId) {
        throw new Error("An authenticated session is required.");
      }
      return updateTotalLossEducationProgress(
        caseId,
        accessToken,
        step,
        state,
        expectedWorkflowRevision,
      );
    },
    onSuccess: invalidate,
    retry: false,
  });
}

export function useTotalLossReportDownloadMutation({
  accessToken,
  caseId,
  userId,
}: ClaimIdentityOptions) {
  return useMutation({
    gcTime: 0,
    mutationKey: [...totalLossClaimQueryKeys.detail(userId, caseId), "download"],
    mutationFn: ({ reportVersionId }: { readonly reportVersionId: string }) => {
      if (!accessToken || !userId) {
        throw new Error("An authenticated session is required.");
      }
      return getTotalLossReportDownload(caseId, reportVersionId, accessToken);
    },
    retry: false,
  });
}

export function useTotalLossSendingDetailsMutation({
  accessToken,
  caseId,
  userId,
}: ClaimIdentityOptions) {
  const invalidate = useClaimMutationInvalidation({ caseId, userId });
  return useMutation({
    gcTime: 0,
    mutationKey: [
      ...totalLossClaimQueryKeys.detail(userId, caseId),
      "sendingDetails",
    ],
    mutationFn: (input: {
      readonly adjusterName: string | null;
      readonly adjusterEmail: string | null;
      readonly adjusterEmailConfirmed: boolean;
      readonly claimReference: string | null;
      readonly claimReferenceConfirmed: boolean;
      readonly expectedRevision: number;
      readonly expectedWorkflowRevision: number;
    }) => {
      if (!accessToken || !userId) {
        throw new Error("An authenticated session is required.");
      }
      return updateTotalLossSendingDetails(caseId, accessToken, input);
    },
    onSuccess: invalidate,
    retry: false,
  });
}

export function useTotalLossMessageDraftMutation({
  accessToken,
  caseId,
  userId,
}: ClaimIdentityOptions) {
  const invalidate = useClaimMutationInvalidation({ caseId, userId });
  return useMutation({
    gcTime: 0,
    mutationKey: [...totalLossClaimQueryKeys.detail(userId, caseId), "draft"],
    mutationFn: (input: {
      readonly body: string;
      readonly expectedRevision: number;
      readonly recipient: string;
      readonly subject: string;
    }) => {
      if (!accessToken || !userId) {
        throw new Error("An authenticated session is required.");
      }
      return updateTotalLossMessageDraft(caseId, accessToken, input);
    },
    onSuccess: invalidate,
    retry: false,
  });
}

export function useTotalLossPrepareMessageMutation({
  accessToken,
  caseId,
  userId,
}: ClaimIdentityOptions) {
  const invalidate = useClaimMutationInvalidation({ caseId, userId });
  return useMutation({
    gcTime: 0,
    mutationKey: [...totalLossClaimQueryKeys.detail(userId, caseId), "prepare"],
    mutationFn: ({
      clientRequestId,
      expectedWorkflowRevision,
    }: {
      readonly clientRequestId: string;
      readonly expectedWorkflowRevision: number;
    }) => {
      if (!accessToken || !userId) {
        throw new Error("An authenticated session is required.");
      }
      return prepareTotalLossMessage(
        caseId,
        accessToken,
        clientRequestId,
        expectedWorkflowRevision,
      );
    },
    onSuccess: invalidate,
    retry: false,
  });
}

export function useTotalLossMessageOpenedMutation({
  accessToken,
  caseId,
  userId,
}: ClaimIdentityOptions) {
  return useMutation({
    gcTime: 0,
    mutationKey: [...totalLossClaimQueryKeys.detail(userId, caseId), "opened"],
    mutationFn: ({
      clientRequestId,
      messageVersionId,
    }: {
      readonly clientRequestId: string;
      readonly messageVersionId: string;
    }) => {
      if (!accessToken || !userId) {
        throw new Error("An authenticated session is required.");
      }
      return recordTotalLossMessageOpened(
        caseId,
        accessToken,
        clientRequestId,
        messageVersionId,
      );
    },
    retry: false,
  });
}

export function useTotalLossMessageSentMutation({
  accessToken,
  caseId,
  userId,
}: ClaimIdentityOptions) {
  const invalidate = useClaimMutationInvalidation({ caseId, userId });
  return useMutation({
    gcTime: 0,
    mutationKey: [...totalLossClaimQueryKeys.detail(userId, caseId), "sent"],
    mutationFn: (input: {
      readonly clientRequestId: string;
      readonly expectedWorkflowRevision: number;
      readonly messageVersionId: string;
    }) => {
      if (!accessToken || !userId) {
        throw new Error("An authenticated session is required.");
      }
      return confirmTotalLossMessageSent(caseId, accessToken, input);
    },
    onSuccess: invalidate,
    retry: false,
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
