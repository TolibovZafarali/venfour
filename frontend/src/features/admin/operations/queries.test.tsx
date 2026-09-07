import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminCaseOperationsDependenciesContext } from "@/features/admin/case-operations/dependencies-context";
import { adminCaseOperationsQueryKeys } from "@/features/admin/case-operations/queries";

import {
  adminOperationsQueryKeys,
  useAdminAuthorizationPurge,
  useAdminList,
  useAdminOverview,
} from "./queries";
import type { AdminOperationsService } from "./types";

const harness = vi.hoisted(() => ({
  auth: { status: "signedIn", user: { id: "11111111-1111-4111-8111-111111111111" } },
}));
vi.mock("@/features/auth", () => ({ useAuth: () => ({ auth: harness.auth }) }));

const STAFF_ID = harness.auth.user.id;
const OTHER_STAFF_ID = "22222222-2222-4222-8222-222222222222";
const PAGE = { items: [], total: 0, page: 1, pageSize: 50, asOf: "2026-09-07T12:00:00Z" };
const OVERVIEW = { asOf: PAGE.asOf, activeCases: 0, attentionCases: 0, processingJobs: 0, registeredAccounts: 8, attention: [], activity: [] };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const operationsService: AdminOperationsService = {
    list: vi.fn(async () => PAGE),
    overview: vi.fn(async () => OVERVIEW),
    customer: vi.fn(async () => null),
    case: vi.fn(async () => null),
    record: vi.fn(async () => null),
  };
  const caseService = { isStaff: vi.fn(async () => true), listCases: vi.fn(async () => []), getTotalLossCase: vi.fn(async () => null) };
  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>
      <AdminCaseOperationsDependenciesContext.Provider value={{ operationsService, caseService }}>
        {children}
      </AdminCaseOperationsDependenciesContext.Provider>
    </QueryClientProvider>;
  }
  return { client, operationsService, caseService, wrapper: Wrapper };
}

beforeEach(() => { harness.auth.user.id = STAFF_ID; });

describe("staff operations authorization and cache boundaries", () => {
  it("does not fetch overview or sidebar data before the gate has authorized the account", async () => {
    const { client, operationsService, caseService, wrapper } = setup();
    const { result } = renderHook(() => useAdminOverview(), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(operationsService.overview).not.toHaveBeenCalled();
    expect(caseService.isStaff).not.toHaveBeenCalled();
    act(() => { client.setQueryData(adminCaseOperationsQueryKeys.access(STAFF_ID), true); });
    await waitFor(() => expect(result.current.data?.registeredAccounts).toBe(8));
    expect(operationsService.overview).toHaveBeenCalledTimes(1);
    expect(caseService.isStaff).not.toHaveBeenCalled();
  });

  it("includes staff identity and normalized filters in keys without sharing data across accounts", () => {
    expect(adminOperationsQueryKeys.list(STAFF_ID, "cases", { search: " Ada " })).toEqual(adminOperationsQueryKeys.list(STAFF_ID, "cases", { search: "Ada", page: 1, pageSize: 50, sort: "updated", filters: {} }));
    expect(adminOperationsQueryKeys.list(STAFF_ID, "cases")).not.toEqual(adminOperationsQueryKeys.list(OTHER_STAFF_ID, "cases"));
    expect(adminOperationsQueryKeys.list(STAFF_ID, "cases", { page: 2 })).not.toEqual(adminOperationsQueryKeys.list(STAFF_ID, "cases"));
  });

  it("removes cached lists, details, overview, and legacy data when staff membership is revoked", () => {
    const { client, wrapper } = setup();
    client.setQueryData(adminCaseOperationsQueryKeys.access(STAFF_ID), true);
    const protectedKeys = [
      adminOperationsQueryKeys.list(STAFF_ID, "cases"),
      adminOperationsQueryKeys.list(STAFF_ID, "customers"),
      adminOperationsQueryKeys.list(STAFF_ID, "payments"),
      adminOperationsQueryKeys.overview(STAFF_ID),
      adminOperationsQueryKeys.customer(STAFF_ID, OTHER_STAFF_ID),
      adminOperationsQueryKeys.case(STAFF_ID, OTHER_STAFF_ID),
      adminOperationsQueryKeys.record(STAFF_ID, "reports", OTHER_STAFF_ID),
      adminCaseOperationsQueryKeys.cases(STAFF_ID),
    ];
    for (const key of protectedKeys) client.setQueryData(key, { protected: true });
    renderHook(() => useAdminAuthorizationPurge(), { wrapper });
    act(() => { client.setQueryData(adminCaseOperationsQueryKeys.access(STAFF_ID), false); });
    for (const key of protectedKeys) expect(client.getQueryData(key)).toBeUndefined();
    expect(client.getQueryData(adminCaseOperationsQueryKeys.access(STAFF_ID))).toBe(false);
  });

  it("purges protected data immediately when a refresh receives a database authorization failure", async () => {
    const { client, wrapper } = setup();
    const key = adminOperationsQueryKeys.list(STAFF_ID, "payments");
    client.setQueryData(adminCaseOperationsQueryKeys.access(STAFF_ID), true);
    client.setQueryData(key, { protected: true });
    renderHook(() => useAdminAuthorizationPurge(), { wrapper });
    await act(async () => {
      await expect(client.fetchQuery({ queryKey: key, queryFn: async () => { throw { code: "42501" }; } })).rejects.toMatchObject({ code: "42501" });
    });
    expect(client.getQueryData(key)).toBeUndefined();
    expect(client.getQueryData(adminCaseOperationsQueryKeys.access(STAFF_ID))).toBe(false);
  });

  it("retains previously loaded data after a connection failure so the view can show a stale-data notice", async () => {
    const { client, wrapper } = setup();
    const key = adminOperationsQueryKeys.list(STAFF_ID, "payments");
    client.setQueryData(adminCaseOperationsQueryKeys.access(STAFF_ID), true);
    client.setQueryData(key, PAGE);
    renderHook(() => useAdminAuthorizationPurge(), { wrapper });
    await act(async () => {
      await expect(client.fetchQuery({ queryKey: key, queryFn: async () => { throw new Error("Connection failed"); } })).rejects.toThrow("Connection failed");
    });
    expect(client.getQueryData(key)).toEqual(PAGE);
    expect(client.getQueryData(adminCaseOperationsQueryKeys.access(STAFF_ID))).toBe(true);
  });

  it("stops queries and releases previous staff data when the account identity changes", async () => {
    const { client, operationsService, wrapper } = setup();
    client.setQueryData(adminCaseOperationsQueryKeys.access(STAFF_ID), true);
    const { result, rerender } = renderHook(() => useAdminList("cases"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(PAGE));
    harness.auth.user.id = OTHER_STAFF_ID;
    rerender();
    expect(result.current.data).toBeUndefined();
    expect(result.current.fetchStatus).toBe("idle");
    expect(operationsService.list).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(client.getQueryData(adminOperationsQueryKeys.list(STAFF_ID, "cases"))).toBeUndefined());
  });
});
