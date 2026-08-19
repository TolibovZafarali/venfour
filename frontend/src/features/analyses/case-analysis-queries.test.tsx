import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getCaseAnalysis } from "@/features/analyses/api/case-analysis";
import {
  caseAnalysisQueryKeys,
  caseAnalysisPollingInterval,
  useCaseAnalysisQuery,
} from "@/features/analyses/case-analysis-queries";

vi.mock("@/features/analyses/api/case-analysis", () => ({
  getCaseAnalysis: vi.fn(),
  submitCaseAnalysis: vi.fn(),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";

function wrapperFor(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

function processingStatus(attemptCount = 1) {
  return {
    status: "processing" as const,
    attemptCount,
    processingExpiresAt: null,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(getCaseAnalysis).mockReset();
});

describe("case-analysis polling", () => {
  it("polls responsively for the first minute, then progressively backs off", () => {
    expect(caseAnalysisPollingInterval(0)).toBe(1_500);
    expect(caseAnalysisPollingInterval(59_999)).toBe(1_500);
    expect(caseAnalysisPollingInterval(60_000)).toBe(5_000);
    expect(caseAnalysisPollingInterval(5 * 60_000)).toBe(15_000);
    expect(caseAnalysisPollingInterval(15 * 60_000)).toBe(60_000);
    expect(caseAnalysisPollingInterval(2 * 60 * 60_000)).toBe(60_000);
  });

  it("keeps a continuously stranded two-hour cycle below 250 requests", () => {
    const duration = 2 * 60 * 60_000;
    let elapsed = 0;
    let requestCount = 1;

    while (elapsed < duration) {
      elapsed += caseAnalysisPollingInterval(elapsed);
      if (elapsed <= duration) requestCount += 1;
    }

    expect(requestCount).toBeLessThan(250);
  });

  it("fetches immediately again when a processing page is reloaded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T17:00:00.000Z"));
    vi.mocked(getCaseAnalysis).mockResolvedValue(processingStatus());
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queryOptions = {
      accessToken: "access-token",
      caseId: CASE_ID,
      userId: USER_ID,
    };

    const firstRender = renderHook(() => useCaseAnalysisQuery(queryOptions), {
      wrapper: wrapperFor(queryClient),
    });
    await vi.waitFor(() => expect(getCaseAnalysis).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(firstRender.result.current.isSuccess).toBe(true));
    firstRender.unmount();

    vi.setSystemTime(new Date("2026-08-19T17:20:00.000Z"));
    const secondRender = renderHook(() => useCaseAnalysisQuery(queryOptions), {
      wrapper: wrapperFor(queryClient),
    });

    await vi.waitFor(() => expect(getCaseAnalysis).toHaveBeenCalledTimes(2));
    secondRender.unmount();
  });

  it("returns a resumed processing attempt to the fast polling tier", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T17:00:00.000Z"));
    vi.mocked(getCaseAnalysis).mockResolvedValue(processingStatus(1));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queryOptions = {
      accessToken: "access-token",
      caseId: CASE_ID,
      userId: USER_ID,
    };
    const rendered = renderHook(() => useCaseAnalysisQuery(queryOptions), {
      wrapper: wrapperFor(queryClient),
    });
    await vi.waitFor(() => expect(getCaseAnalysis).toHaveBeenCalledTimes(1));

    vi.setSystemTime(new Date("2026-08-19T17:20:00.000Z"));
    vi.mocked(getCaseAnalysis).mockResolvedValue(processingStatus(2));
    act(() => {
      queryClient.setQueryData(
        caseAnalysisQueryKeys.detail(USER_ID, CASE_ID),
        processingStatus(2),
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_499);
    });
    expect(getCaseAnalysis).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await vi.waitFor(() => expect(getCaseAnalysis).toHaveBeenCalledTimes(2));
    rendered.unmount();
  });
});
