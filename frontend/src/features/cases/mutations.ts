import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { appraisalCaseQueryKeys } from "@/features/cases/queries";
import type { AppraisalCaseService } from "@/features/cases/service";
import type { AppraisalServiceType } from "@/features/cases/types";

interface AppraisalCaseMutationOptions {
  readonly service: AppraisalCaseService;
  readonly userId: string | null;
}

export interface CreateAppraisalCaseMutationInput {
  readonly serviceType: AppraisalServiceType;
}

export interface CreateOrGetAppraisalCaseMutationInput extends CreateAppraisalCaseMutationInput {
  readonly caseId: string;
}

export interface TouchAppraisalCaseMutationInput {
  readonly caseId: string;
}

export class AppraisalCaseAuthenticationError extends Error {
  constructor() {
    super("Sign in before changing an appraisal case.");
    this.name = "AppraisalCaseAuthenticationError";
  }
}

function requireUserId(userId: string | null): string {
  if (!userId) {
    throw new AppraisalCaseAuthenticationError();
  }
  return userId;
}

function useActiveMutationUserId(userId: string | null) {
  const activeUserIdRef = useRef<string | null>(userId);
  useEffect(() => {
    activeUserIdRef.current = userId;
    return () => {
      activeUserIdRef.current = null;
    };
  }, [userId]);
  return activeUserIdRef;
}

export function useCreateAppraisalCaseMutation({
  service,
  userId,
}: AppraisalCaseMutationOptions) {
  const queryClient = useQueryClient();
  const activeUserIdRef = useActiveMutationUserId(userId);

  return useMutation({
    mutationFn: ({ serviceType }: CreateAppraisalCaseMutationInput) =>
      service.createAppraisalCase({
        serviceType,
        userId: requireUserId(userId),
      }),
    onSuccess: async (appraisalCase) => {
      if (activeUserIdRef.current !== userId) return;
      queryClient.setQueryData(
        appraisalCaseQueryKeys.detail(userId, appraisalCase.id),
        appraisalCase,
      );
      await queryClient.invalidateQueries({
        queryKey: appraisalCaseQueryKeys.list(userId),
      });
    },
    retry: false,
  });
}

export function useCreateOrGetAppraisalCaseMutation({
  service,
  userId,
}: AppraisalCaseMutationOptions) {
  const queryClient = useQueryClient();
  const activeUserIdRef = useActiveMutationUserId(userId);

  return useMutation({
    mutationFn: ({
      caseId,
      serviceType,
    }: CreateOrGetAppraisalCaseMutationInput) =>
      service.createOrGetAppraisalCase({
        caseId,
        serviceType,
        userId: requireUserId(userId),
      }),
    onSuccess: async (appraisalCase) => {
      if (activeUserIdRef.current !== userId) return;
      queryClient.setQueryData(
        appraisalCaseQueryKeys.detail(userId, appraisalCase.id),
        appraisalCase,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: appraisalCaseQueryKeys.list(userId),
        }),
        queryClient.invalidateQueries({
          queryKey: appraisalCaseQueryKeys.recentDraft(
            userId,
            appraisalCase.serviceType,
          ),
        }),
      ]);
    },
    retry: false,
  });
}

export function useTouchAppraisalCaseMutation({
  service,
  userId,
}: AppraisalCaseMutationOptions) {
  const queryClient = useQueryClient();
  const activeUserIdRef = useActiveMutationUserId(userId);

  return useMutation({
    mutationFn: ({ caseId }: TouchAppraisalCaseMutationInput) =>
      service.touchAppraisalCase({
        caseId,
        userId: requireUserId(userId),
      }),
    onSuccess: async (appraisalCase, { caseId }) => {
      if (activeUserIdRef.current !== userId) return;
      if (appraisalCase) {
        queryClient.setQueryData(
          appraisalCaseQueryKeys.detail(userId, caseId),
          appraisalCase,
        );
      } else {
        await queryClient.invalidateQueries({
          queryKey: appraisalCaseQueryKeys.detail(userId, caseId),
        });
      }

      await queryClient.invalidateQueries({
        queryKey: appraisalCaseQueryKeys.list(userId),
      });
      await queryClient.invalidateQueries({
        queryKey: appraisalCaseQueryKeys.recentDrafts(userId),
      });
    },
    retry: false,
  });
}
