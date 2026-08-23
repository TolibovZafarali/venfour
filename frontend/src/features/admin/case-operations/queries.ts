import { queryOptions, useQuery } from "@tanstack/react-query";

import type { StaffCaseOperationsService } from "./service";

export const adminCaseOperationsQueryKeys = {
  all: ["adminCaseOperations"] as const,
  user: (userId: string | null) =>
    [...adminCaseOperationsQueryKeys.all, "user", userId] as const,
  access: (userId: string | null) =>
    [...adminCaseOperationsQueryKeys.user(userId), "access"] as const,
  cases: (userId: string | null) =>
    [...adminCaseOperationsQueryKeys.user(userId), "cases"] as const,
  totalLossCase: (userId: string | null, caseId: string) =>
    [
      ...adminCaseOperationsQueryKeys.user(userId),
      "totalLossCase",
      caseId,
    ] as const,
};

interface StaffQueryOptions {
  readonly service: StaffCaseOperationsService | null;
  readonly userId: string | null;
}

interface StaffCaseQueryOptions extends StaffQueryOptions {
  readonly caseId: string;
}

export function staffCaseOperationsAccessQueryOptions({
  service,
  userId,
}: StaffQueryOptions) {
  return queryOptions({
    queryKey: adminCaseOperationsQueryKeys.access(userId),
    queryFn: () => {
      if (!service || !userId) {
        throw new Error("An authenticated staff-access service is required.");
      }
      return service.isStaff();
    },
    enabled: Boolean(service && userId),
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function staffCaseOperationsListQueryOptions({
  service,
  userId,
}: StaffQueryOptions) {
  return queryOptions({
    queryKey: adminCaseOperationsQueryKeys.cases(userId),
    queryFn: () => {
      if (!service || !userId) {
        throw new Error(
          "An authenticated staff case-operations service is required.",
        );
      }
      return service.listCases();
    },
    enabled: Boolean(service && userId),
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function staffTotalLossCaseOperationQueryOptions({
  caseId,
  service,
  userId,
}: StaffCaseQueryOptions) {
  return queryOptions({
    queryKey: adminCaseOperationsQueryKeys.totalLossCase(userId, caseId),
    queryFn: () => {
      if (!service || !userId) {
        throw new Error(
          "An authenticated staff case-operations service is required.",
        );
      }
      return service.getTotalLossCase(caseId);
    },
    enabled: Boolean(service && userId && caseId),
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function useStaffCaseOperationsAccessQuery(options: StaffQueryOptions) {
  return useQuery(staffCaseOperationsAccessQueryOptions(options));
}

export function useStaffCaseOperationsListQuery(options: StaffQueryOptions) {
  return useQuery(staffCaseOperationsListQueryOptions(options));
}

export function useStaffTotalLossCaseOperationQuery(
  options: StaffCaseQueryOptions,
) {
  return useQuery(staffTotalLossCaseOperationQueryOptions(options));
}
