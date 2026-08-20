import { queryOptions, useQuery } from "@tanstack/react-query";

import type {
  DiminishedValueDocumentReadService,
  DiminishedValueStoredDocument,
} from "@/features/diminished-value/storage-service";

import type { StaffDiminishedValueCaseService } from "./service";

export const adminDiminishedValueQueryKeys = {
  all: ["adminDiminishedValue"] as const,
  user: (userId: string | null) =>
    [...adminDiminishedValueQueryKeys.all, "user", userId] as const,
  access: (userId: string | null) =>
    [...adminDiminishedValueQueryKeys.user(userId), "access"] as const,
  queue: (userId: string | null) =>
    [...adminDiminishedValueQueryKeys.user(userId), "queue"] as const,
  case: (userId: string | null, caseId: string) =>
    [...adminDiminishedValueQueryKeys.user(userId), "case", caseId] as const,
  documents: (userId: string | null, caseId: string) =>
    [
      ...adminDiminishedValueQueryKeys.user(userId),
      "documents",
      caseId,
    ] as const,
};

interface StaffQueryOptions {
  readonly service: StaffDiminishedValueCaseService | null;
  readonly userId: string | null;
}

interface StaffCaseQueryOptions extends StaffQueryOptions {
  readonly caseId: string;
}

interface StaffDocumentsQueryOptions {
  readonly service: DiminishedValueDocumentReadService | null;
  readonly userId: string | null;
  readonly ownerUserId: string | null;
  readonly caseId: string;
}

export function staffAccessQueryOptions({
  service,
  userId,
}: StaffQueryOptions) {
  return queryOptions({
    queryKey: adminDiminishedValueQueryKeys.access(userId),
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

export function staffQueueQueryOptions({ service, userId }: StaffQueryOptions) {
  return queryOptions({
    queryKey: adminDiminishedValueQueryKeys.queue(userId),
    queryFn: () => {
      if (!service || !userId) {
        throw new Error("An authenticated staff-review service is required.");
      }
      return service.listSubmittedCases();
    },
    enabled: Boolean(service && userId),
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function staffCaseQueryOptions({
  caseId,
  service,
  userId,
}: StaffCaseQueryOptions) {
  return queryOptions({
    queryKey: adminDiminishedValueQueryKeys.case(userId, caseId),
    queryFn: () => {
      if (!service || !userId) {
        throw new Error("An authenticated staff-review service is required.");
      }
      return service.getSubmittedCase(caseId);
    },
    enabled: Boolean(service && userId && caseId),
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function staffDocumentsQueryOptions({
  caseId,
  ownerUserId,
  service,
  userId,
}: StaffDocumentsQueryOptions) {
  return queryOptions({
    queryKey: adminDiminishedValueQueryKeys.documents(userId, caseId),
    queryFn: (): Promise<DiminishedValueStoredDocument[]> => {
      if (!service || !userId || !ownerUserId) {
        throw new Error("An authenticated staff document service is required.");
      }
      return service.listDocuments({ caseId, userId: ownerUserId });
    },
    enabled: Boolean(service && userId && ownerUserId && caseId),
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function useStaffAccessQuery(options: StaffQueryOptions) {
  return useQuery(staffAccessQueryOptions(options));
}

export function useStaffQueueQuery(options: StaffQueryOptions) {
  return useQuery(staffQueueQueryOptions(options));
}

export function useStaffCaseQuery(options: StaffCaseQueryOptions) {
  return useQuery(staffCaseQueryOptions(options));
}

export function useStaffDocumentsQuery(options: StaffDocumentsQueryOptions) {
  return useQuery(staffDocumentsQueryOptions(options));
}
