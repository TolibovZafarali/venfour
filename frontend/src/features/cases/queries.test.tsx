import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  AppraisalCaseAuthenticationError,
  useCreateOrGetAppraisalCaseMutation,
  useCreateAppraisalCaseMutation,
} from "@/features/cases/mutations";
import {
  appraisalCaseQueryKeys,
  useAppraisalCasesQuery,
  useRecentDraftAppraisalCaseQuery,
} from "@/features/cases/queries";
import type { AppraisalCaseService } from "@/features/cases/service";
import type { AppraisalCase } from "@/features/cases/types";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";

const appraisalCase: AppraisalCase = {
  id: CASE_ID,
  userId: USER_ID,
  serviceType: "total_loss",
  status: "draft",
  createdAt: "2026-08-18T14:00:00.000Z",
  updatedAt: "2026-08-18T14:00:00.000Z",
  lastActivityAt: "2026-08-18T14:00:00.000Z",
};

function createService(
  overrides: Partial<AppraisalCaseService> = {},
): AppraisalCaseService {
  return {
    createAppraisalCase: async () => appraisalCase,
    createOrGetAppraisalCase: async () => appraisalCase,
    listAppraisalCases: async () => [],
    getRecentDraftAppraisalCase: async () => null,
    getAppraisalCase: async () => null,
    touchAppraisalCase: async () => null,
    ...overrides,
  };
}

function createQueryHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  }

  return { queryClient, wrapper: Wrapper };
}

describe("appraisal case query hooks", () => {
  it("includes the authenticated identity in every customer cache key", () => {
    expect(appraisalCaseQueryKeys.list(USER_ID)).toEqual([
      "appraisalCases",
      "user",
      USER_ID,
      "list",
    ]);
    expect(appraisalCaseQueryKeys.detail(USER_ID, CASE_ID)).toEqual([
      "appraisalCases",
      "user",
      USER_ID,
      "detail",
      CASE_ID,
    ]);
    expect(
      appraisalCaseQueryKeys.recentDraft(USER_ID, "total_loss"),
    ).toEqual([
      "appraisalCases",
      "user",
      USER_ID,
      "recentDraft",
      "total_loss",
    ]);
  });

  it("lists cases with the active user ID", async () => {
    const listAppraisalCases = vi.fn(async () => [appraisalCase]);
    const service = createService({ listAppraisalCases });
    const { wrapper } = createQueryHarness();
    const { result } = renderHook(
      () => useAppraisalCasesQuery({ service, userId: USER_ID }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(listAppraisalCases).toHaveBeenCalledWith(USER_ID);
    expect(result.current.data).toEqual([appraisalCase]);
  });

  it("does not query customer data while signed out", () => {
    const listAppraisalCases = vi.fn(async () => [appraisalCase]);
    const service = createService({ listAppraisalCases });
    const { wrapper } = createQueryHarness();
    const { result } = renderHook(
      () => useAppraisalCasesQuery({ service, userId: null }),
      { wrapper },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(listAppraisalCases).not.toHaveBeenCalled();
  });

  it("derives case ownership from the mutation's authenticated user", async () => {
    const createAppraisalCase = vi.fn(async () => appraisalCase);
    const service = createService({ createAppraisalCase });
    const { queryClient, wrapper } = createQueryHarness();
    const { result } = renderHook(
      () => useCreateAppraisalCaseMutation({ service, userId: USER_ID }),
      { wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({ serviceType: "total_loss" });
    });

    expect(createAppraisalCase).toHaveBeenCalledWith({
      serviceType: "total_loss",
      userId: USER_ID,
    });
    expect(
      queryClient.getQueryData(
        appraisalCaseQueryKeys.detail(USER_ID, CASE_ID),
      ),
    ).toEqual(appraisalCase);
  });

  it("uses the browser-reserved ID for an idempotent create-or-get mutation", async () => {
    const createOrGetAppraisalCase = vi.fn(async () => appraisalCase);
    const service = createService({ createOrGetAppraisalCase });
    const { wrapper } = createQueryHarness();
    const { result } = renderHook(
      () => useCreateOrGetAppraisalCaseMutation({ service, userId: USER_ID }),
      { wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({
        caseId: CASE_ID,
        serviceType: "total_loss",
      });
    });

    expect(createOrGetAppraisalCase).toHaveBeenCalledWith({
      caseId: CASE_ID,
      serviceType: "total_loss",
      userId: USER_ID,
    });
  });

  it("fetches the recent draft for only the authenticated workflow", async () => {
    const getRecentDraftAppraisalCase = vi.fn(async () => appraisalCase);
    const service = createService({ getRecentDraftAppraisalCase });
    const { wrapper } = createQueryHarness();
    const { result } = renderHook(
      () =>
        useRecentDraftAppraisalCaseQuery({
          service,
          serviceType: "total_loss",
          userId: USER_ID,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getRecentDraftAppraisalCase).toHaveBeenCalledWith({
      serviceType: "total_loss",
      userId: USER_ID,
    });
  });

  it("rejects case mutations without an authenticated user", async () => {
    const createAppraisalCase = vi.fn(async () => appraisalCase);
    const service = createService({ createAppraisalCase });
    const { wrapper } = createQueryHarness();
    const { result } = renderHook(
      () => useCreateAppraisalCaseMutation({ service, userId: null }),
      { wrapper },
    );

    await expect(
      result.current.mutateAsync({ serviceType: "total_loss" }),
    ).rejects.toBeInstanceOf(AppraisalCaseAuthenticationError);
    expect(createAppraisalCase).not.toHaveBeenCalled();
  });
});
