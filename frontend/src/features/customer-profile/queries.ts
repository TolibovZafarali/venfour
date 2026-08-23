import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type { CustomerProfileService } from "./service";
import type { ConfirmCustomerProfileInput } from "./types";

export const customerProfileQueryKeys = {
  all: ["customerProfile"] as const,
  user: (userId: string | null) =>
    [...customerProfileQueryKeys.all, "user", userId] as const,
};

interface CustomerProfileQueryOptions {
  readonly service: CustomerProfileService | null;
  readonly userId: string | null;
}

export function customerProfileQueryOptions({
  service,
  userId,
}: CustomerProfileQueryOptions) {
  return queryOptions({
    queryKey: customerProfileQueryKeys.user(userId),
    queryFn: () => {
      if (!service || !userId) {
        throw new Error(
          "An authenticated user and profile service are required.",
        );
      }
      return service.getProfile(userId);
    },
    enabled: Boolean(service && userId),
  });
}

export function useCustomerProfileQuery(options: CustomerProfileQueryOptions) {
  return useQuery(customerProfileQueryOptions(options));
}

export function useConfirmCustomerProfileMutation({
  service,
  userId,
}: CustomerProfileQueryOptions) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ConfirmCustomerProfileInput, "userId">) => {
      if (!service || !userId) {
        throw new Error(
          "An authenticated user and profile service are required.",
        );
      }
      return service.confirmProfile({ ...input, userId });
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(customerProfileQueryKeys.user(userId), profile);
    },
    retry: false,
  });
}
