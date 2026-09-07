import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useAdminCaseOperationsDependencies } from "@/features/admin/case-operations/dependencies-context";
import {
  adminCaseOperationsQueryKeys,
  staffCaseOperationsAccessQueryOptions,
} from "@/features/admin/case-operations/queries";
import { useAuth } from "@/features/auth";

import { isAdminAuthorizationError } from "./service";
import type { AdminListOptions, AdminOperationsService, AdminResource } from "./types";
import { normalizeAdminListOptions } from "./validation";

export const adminOperationsQueryKeys = {
  all: adminCaseOperationsQueryKeys.all,
  user: (userId: string | null) => [...adminCaseOperationsQueryKeys.user(userId), "operations"] as const,
  list: (userId: string | null, resource: AdminResource, options: AdminListOptions = {}) => [...adminOperationsQueryKeys.user(userId), "list", resource, normalizeAdminListOptions(resource, options)] as const,
  overview: (userId: string | null) => [...adminOperationsQueryKeys.user(userId), "overview"] as const,
  customer: (userId: string | null, id: string) => [...adminOperationsQueryKeys.user(userId), "customer", id.toLowerCase()] as const,
  case: (userId: string | null, id: string) => [...adminOperationsQueryKeys.user(userId), "case", id.toLowerCase()] as const,
  record: (userId: string | null, resource: AdminResource, id: string) => [...adminOperationsQueryKeys.user(userId), "record", resource, id] as const,
};

interface AdminQueryContext {
  readonly userId: string | null;
  readonly service: AdminOperationsService | null;
  readonly authorized: boolean;
}

const operationalQueryDefaults = {
  gcTime: 0,
  staleTime: 0,
  refetchOnWindowFocus: true,
  retry: false,
} as const;

function requireService(context: AdminQueryContext) {
  if (!context.service || !context.userId || !context.authorized) throw new Error("An authorized staff operations service is required.");
  return context.service;
}

export function adminListQueryOptions(context: AdminQueryContext, resource: AdminResource, options: AdminListOptions = {}) {
  return queryOptions({
    ...operationalQueryDefaults,
    queryKey: adminOperationsQueryKeys.list(context.userId, resource, options),
    queryFn: () => requireService(context).list(resource, options),
    enabled: Boolean(context.service && context.userId && context.authorized),
  });
}

export function adminOverviewQueryOptions(context: AdminQueryContext) {
  return queryOptions({
    ...operationalQueryDefaults,
    queryKey: adminOperationsQueryKeys.overview(context.userId),
    queryFn: () => requireService(context).overview(),
    enabled: Boolean(context.service && context.userId && context.authorized),
  });
}

export function adminCustomerQueryOptions(context: AdminQueryContext, id: string) {
  return queryOptions({
    ...operationalQueryDefaults,
    queryKey: adminOperationsQueryKeys.customer(context.userId, id),
    queryFn: () => requireService(context).customer(id),
    enabled: Boolean(context.service && context.userId && context.authorized && id),
  });
}

export function adminCaseQueryOptions(context: AdminQueryContext, id: string) {
  return queryOptions({
    ...operationalQueryDefaults,
    queryKey: adminOperationsQueryKeys.case(context.userId, id),
    queryFn: () => requireService(context).case(id),
    enabled: Boolean(context.service && context.userId && context.authorized && id),
  });
}

export function adminRecordQueryOptions(context: AdminQueryContext, resource: AdminResource, id: string) {
  return queryOptions({
    ...operationalQueryDefaults,
    queryKey: adminOperationsQueryKeys.record(context.userId, resource, id),
    queryFn: () => requireService(context).record(resource, id),
    enabled: Boolean(context.service && context.userId && context.authorized && id),
  });
}

function useAdminQueryContext(): AdminQueryContext {
  const { auth } = useAuth();
  const dependencies = useAdminCaseOperationsDependencies();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  // Observe the gate's decision without performing another authorization request.
  const access = useQuery({
    ...staffCaseOperationsAccessQueryOptions({ service: dependencies?.caseService ?? null, userId }),
    enabled: false,
  });
  return { userId, service: dependencies?.operationsService ?? null, authorized: access.data === true && !access.isError };
}

export function useAdminList(resource: AdminResource, options: AdminListOptions = {}) {
  return useQuery(adminListQueryOptions(useAdminQueryContext(), resource, options));
}

export function useAdminOverview() {
  return useQuery(adminOverviewQueryOptions(useAdminQueryContext()));
}

export function useAdminCustomer(id: string) {
  return useQuery(adminCustomerQueryOptions(useAdminQueryContext(), id));
}

export function useAdminCase(id: string) {
  return useQuery(adminCaseQueryOptions(useAdminQueryContext(), id));
}

export function useAdminRecord(resource: AdminResource, id: string) {
  return useQuery(adminRecordQueryOptions(useAdminQueryContext(), resource, id));
}

/** Mount once in the staff gate so access failures purge every protected resource. */
export function useAdminAuthorizationPurge() {
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  useEffect(() => {
    if (!userId) return;
    const protectedQuery = (key: readonly unknown[]) => key[0] === "adminCaseOperations" && key[1] === "user" && key[2] === userId && key[3] !== "access";
    const purge = () => {
      void queryClient.cancelQueries({ predicate: (query) => protectedQuery(query.queryKey) });
      queryClient.removeQueries({ predicate: (query) => protectedQuery(query.queryKey) });
    };
    const accessKey = adminCaseOperationsQueryKeys.access(userId);
    const access = queryClient.getQueryState(accessKey);
    if (access?.data === false || access?.status === "error") purge();
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated") return;
      const { query } = event;
      const key = query.queryKey;
      if (key[0] !== "adminCaseOperations" || key[1] !== "user" || key[2] !== userId) return;
      if (key[3] === "access") {
        if (query.state.data === false || query.state.status === "error") purge();
      } else if (query.state.status === "error" && isAdminAuthorizationError(query.state.error)) {
        queryClient.setQueryData(accessKey, false);
        purge();
      }
    });
  }, [queryClient, userId]);
}
