import { useMutation, useQueryClient } from "@tanstack/react-query";

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

export interface CreateOrGetAppraisalCaseMutationInput
  extends CreateAppraisalCaseMutationInput {
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

export function useCreateAppraisalCaseMutation({
  service,
  userId,
}: AppraisalCaseMutationOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ serviceType }: CreateAppraisalCaseMutationInput) =>
      service.createAppraisalCase({
        serviceType,
        userId: requireUserId(userId),
      }),
    onSuccess: async (appraisalCase) => {
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

  return useMutation({
    mutationFn: ({ caseId }: TouchAppraisalCaseMutationInput) =>
      service.touchAppraisalCase({
        caseId,
        userId: requireUserId(userId),
      }),
    onSuccess: async (appraisalCase, { caseId }) => {
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
