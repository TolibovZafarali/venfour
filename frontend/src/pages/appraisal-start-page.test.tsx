import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

import type { AuthService } from "@/features/auth";
import type { DiminishedValueDependencies } from "@/features/diminished-value/dependencies";
import type { TotalLossDependencies } from "@/features/total-loss/dependencies";
import { renderTestApp as renderBaseTestApp } from "@/test/render";

const TOTAL_LOSS_CASE_ID = "22222222-2222-4222-8222-222222222222";
const ANONYMOUS_USER_ID = "11111111-1111-4111-8111-111111111111";

function anonymousSession(): Session {
  return {
    access_token: "guest-access-token",
    expires_in: 3600,
    refresh_token: "guest-refresh-token",
    token_type: "bearer",
    user: {
      app_metadata: { provider: "anonymous", providers: [] },
      aud: "authenticated",
      created_at: "2026-08-23T12:00:00.000Z",
      id: ANONYMOUS_USER_ID,
      is_anonymous: true,
      user_metadata: {},
    },
  } as Session;
}

function createGuestAuthService(): AuthService {
  const session = anonymousSession();
  return {
    exchangeCodeForSession: vi.fn(async () => session),
    getSession: vi.fn(async () => session),
    onAuthStateChange: vi.fn(() => () => undefined),
    signInAnonymously: vi.fn(async () => session),
    sendMagicLink: vi.fn(async () => undefined),
    signInWithGoogle: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    verifyEmailOtp: vi.fn(async () => session),
  };
}

function createTotalLossDependencies(): TotalLossDependencies {
  const appraisalCase = {
    id: TOTAL_LOSS_CASE_ID,
    userId: ANONYMOUS_USER_ID,
    serviceType: "total_loss" as const,
    status: "draft" as const,
    createdAt: "2026-08-23T12:00:00.000Z",
    updatedAt: "2026-08-23T12:00:00.000Z",
    lastActivityAt: "2026-08-23T12:00:00.000Z",
  };
  const appraisalCaseService = {
    createAppraisalCase: vi.fn(async () => appraisalCase),
    createOrGetAppraisalCase: vi.fn(async () => appraisalCase),
    getAppraisalCase: vi.fn(async () => appraisalCase),
    getOrCreateTotalLossDraft: vi.fn(async () => appraisalCase),
    getRecentDraftAppraisalCase: vi.fn(async () => null),
    listAppraisalCases: vi.fn(async () => [appraisalCase]),
    touchAppraisalCase: vi.fn(async () => appraisalCase),
  };
  return {
    appraisalCaseService,
    totalLossDetailsService: { getDetails: vi.fn(async () => null) },
    totalLossIdentityService: { getContact: vi.fn(async () => null) },
    totalLossReportStorageService: {},
    vehicleLookupService: {},
  } as unknown as TotalLossDependencies;
}

function renderTestApp(
  initialEntries: Parameters<typeof renderBaseTestApp>[0],
  options: Parameters<typeof renderBaseTestApp>[1] = {},
) {
  return renderBaseTestApp(initialEntries, {
    authService: createGuestAuthService(),
    totalLossDependencies: createTotalLossDependencies(),
    ...options,
  });
}

type ServiceLabel = "Total Loss" | "Diminished Value";

function expectSelectedService(selectedLabel: ServiceLabel) {
  const otherLabel: ServiceLabel =
    selectedLabel === "Total Loss" ? "Diminished Value" : "Total Loss";
  const selected = screen.getByRole("radio", { name: selectedLabel });
  const other = screen.getByRole("radio", { name: otherLabel });

  expect(selected).toBeChecked();
  expect(selected.closest("label")).toHaveAttribute("aria-current", "true");
  expect(other).not.toBeChecked();
  expect(other.closest("label")).not.toHaveAttribute("aria-current");
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("/start appraisal intake", () => {
  it.each([
    ["missing", "/start?campaign=spring"],
    ["invalid", "/start?service=collision&campaign=spring"],
  ])(
    "normalizes a %s service to total loss with replace navigation",
    async (_scenario, initialEntry) => {
      const { router } = renderTestApp([initialEntry]);

      await waitFor(() =>
        expect(
          new URLSearchParams(router.state.location.search).get("service"),
        ).toBe("total-loss"),
      );

      const searchParams = new URLSearchParams(router.state.location.search);
      expect(router.state.historyAction).toBe("REPLACE");
      expect(searchParams.get("campaign")).toBe("spring");
      expect(
        screen.getByRole("heading", {
          name: "Start your Total Loss review",
        }),
      ).toBeVisible();
      expectSelectedService("Total Loss");
    },
  );

  it.each([
    [
      "total loss",
      "/start?service=total-loss",
      "Start your Total Loss review",
      "Total Loss",
      "2024 Hyundai Elantra SEL",
      "12 comparable vehicles · within 87 miles",
    ],
    [
      "diminished value",
      "/start?service=diminished-value",
      "Diminished Value intake is currently paused",
      "Diminished Value",
      "2025 Hyundai Tucson SEL",
      "Accident history · repairs · mileage · local market",
    ],
  ] as const)(
    "renders the explicit %s deep link with native active-selector semantics",
    (
      _scenario,
      initialEntry,
      heading,
      selectedLabel,
      exampleVehicle,
      supportingLine,
    ) => {
      const { router } = renderTestApp([initialEntry]);

      expect(router.state.location.search).toBe(
        initialEntry.slice(initialEntry.indexOf("?")),
      );
      expect(screen.getByRole("heading", { name: heading })).toBeVisible();
      expectSelectedService(selectedLabel);
      expect(
        screen.getByRole("region", { name: exampleVehicle }),
      ).toBeVisible();
      expect(screen.getByLabelText(supportingLine)).toBeVisible();
      expect(
        document.querySelector("[data-appraisal-start-page]"),
      ).toHaveClass("appraisal-start-gradient");
      expect(
        document.querySelector('[data-appraisal-section-content="intro"]'),
      ).toHaveClass("lg:py-12");
      expect(
        document.querySelector('[data-appraisal-section-content="flow"]'),
      ).toHaveClass("lg:py-12");
    },
  );

  it("pushes service choices and follows browser Back and Forward history", async () => {
    const user = userEvent.setup();
    const { router } = renderTestApp(["/start?service=total-loss"]);

    await user.click(screen.getByRole("radio", { name: "Diminished Value" }));

    await waitFor(() =>
      expect(router.state.location.search).toBe("?service=diminished-value"),
    );
    expect(router.state.historyAction).toBe("PUSH");
    expectSelectedService("Diminished Value");

    await act(async () => {
      await router.navigate(-1);
    });
    await waitFor(() =>
      expect(router.state.location.search).toBe("?service=total-loss"),
    );
    expect(router.state.historyAction).toBe("POP");
    expectSelectedService("Total Loss");

    await act(async () => {
      await router.navigate(1);
    });
    await waitFor(() =>
      expect(router.state.location.search).toBe("?service=diminished-value"),
    );
    expect(router.state.historyAction).toBe("POP");
    expectSelectedService("Diminished Value");
  });

  it("drops a new-case reservation when switching to another service", async () => {
    const user = userEvent.setup();
    const { router } = renderTestApp([
      `/start?service=total-loss&newCaseId=${TOTAL_LOSS_CASE_ID}`,
    ]);

    await user.click(screen.getByRole("radio", { name: "Diminished Value" }));

    await waitFor(() =>
      expect(
        new URLSearchParams(router.state.location.search).get("service"),
      ).toBe("diminished-value"),
    );
    expect(
      new URLSearchParams(router.state.location.search).has("newCaseId"),
    ).toBe(false);
  });

  it("navigates between the responsive overview and selected intake", async () => {
    const user = userEvent.setup();
    const { router } = renderTestApp([
      "/start?service=diminished-value&campaign=spring",
    ]);
    const intro = document.querySelector<HTMLElement>(
      "[data-appraisal-start-intro]",
    );
    const flow = document.querySelector<HTMLElement>(
      "[data-appraisal-start-flow]",
    );

    expect(intro).toHaveAttribute("data-mobile-stage-visible", "true");
    expect(flow).toHaveAttribute("data-mobile-stage-visible", "false");

    await user.click(
      within(intro!).getByRole("button", { name: "View service update" }),
    );

    await waitFor(() =>
      expect(
        new URLSearchParams(router.state.location.search).get("view"),
      ).toBe("intake"),
    );
    let searchParams = new URLSearchParams(router.state.location.search);
    expect(router.state.historyAction).toBe("PUSH");
    expect(searchParams.get("service")).toBe("diminished-value");
    expect(searchParams.get("campaign")).toBe("spring");
    expect(intro).toHaveAttribute("data-mobile-stage-visible", "false");
    expect(flow).toHaveAttribute("data-mobile-stage-visible", "true");

    await user.click(
      within(flow!).getByRole("button", { name: "Back to services" }),
    );

    await waitFor(() =>
      expect(
        new URLSearchParams(router.state.location.search).get("view"),
      ).toBeNull(),
    );
    searchParams = new URLSearchParams(router.state.location.search);
    expect(router.state.historyAction).toBe("REPLACE");
    expect(searchParams.get("service")).toBe("diminished-value");
    expect(searchParams.get("campaign")).toBe("spring");
    expect(intro).toHaveAttribute("data-mobile-stage-visible", "true");
    expect(flow).toHaveAttribute("data-mobile-stage-visible", "false");
  });

  it("removes a total-loss caseId only for the pushed diminished-value entry", async () => {
    const user = userEvent.setup();
    const caseId = TOTAL_LOSS_CASE_ID;
    const { router } = renderTestApp([
      `/start?service=total-loss&caseId=${caseId}&campaign=renewal`,
    ]);

    await user.click(screen.getByRole("radio", { name: "Diminished Value" }));

    await waitFor(() =>
      expect(
        new URLSearchParams(router.state.location.search).get("service"),
      ).toBe("diminished-value"),
    );
    let searchParams = new URLSearchParams(router.state.location.search);
    expect(router.state.historyAction).toBe("PUSH");
    expect(searchParams.get("caseId")).toBeNull();
    expect(searchParams.get("campaign")).toBe("renewal");

    await act(async () => {
      await router.navigate(-1);
    });
    await waitFor(() =>
      expect(
        new URLSearchParams(router.state.location.search).get("service"),
      ).toBe("total-loss"),
    );
    searchParams = new URLSearchParams(router.state.location.search);
    expect(searchParams.get("caseId")).toBe(caseId);
    expect(searchParams.get("campaign")).toBe("renewal");
  });

  it("keeps Diminished Value selected while a direct case link renders only the pause state", () => {
    const dependencyAccess = vi.fn();
    const diminishedValueDependencies = new Proxy(
      {} as DiminishedValueDependencies,
      {
        get() {
          dependencyAccess();
          throw new Error(
            "Paused Diminished Value dependencies were accessed.",
          );
        },
      },
    );
    const caseId = TOTAL_LOSS_CASE_ID;
    const { router } = renderTestApp(
      [
        `/start?service=diminished-value&view=intake&caseId=${caseId}&campaign=spring`,
      ],
      { diminishedValueDependencies },
    );

    expectSelectedService("Diminished Value");
    expect(
      screen.getByRole("heading", {
        name: "Diminished Value intake is currently paused",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "Diminished Value intake is not open yet",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Start a Total Loss review" }),
    ).toHaveAttribute("href", "/start?service=total-loss");
    expect(
      screen.queryByLabelText("State where the accident occurred"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Request a review" }),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('input[type="file"]'),
    ).not.toBeInTheDocument();
    expect(dependencyAccess).not.toHaveBeenCalled();
    expect(
      new URLSearchParams(router.state.location.search).get("caseId"),
    ).toBe(caseId);
  });

  it("cannot bypass the pause through a caseId after switching services", async () => {
    const user = userEvent.setup();
    const caseId = TOTAL_LOSS_CASE_ID;
    const { router } = renderTestApp([
      `/start?service=diminished-value&view=intake&caseId=${caseId}`,
    ]);

    await user.click(screen.getByRole("radio", { name: "Total Loss" }));
    await waitFor(() =>
      expect(
        new URLSearchParams(router.state.location.search).get("service"),
      ).toBe("total-loss"),
    );
    expect(
      new URLSearchParams(router.state.location.search).get("caseId"),
    ).toBeNull();
    expect(
      await screen.findByRole("group", {
        name: "Do you have your insurance valuation report?",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", {
        name: "Sign in before starting your review",
      }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Diminished Value" }));
    expect(
      await screen.findByRole("heading", {
        name: "Diminished Value intake is not open yet",
      }),
    ).toBeVisible();
    expect(screen.queryByLabelText("VIN")).not.toBeInTheDocument();
  });
});
