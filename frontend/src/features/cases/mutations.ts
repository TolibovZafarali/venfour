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
    },
    retry: false,
  });
}
