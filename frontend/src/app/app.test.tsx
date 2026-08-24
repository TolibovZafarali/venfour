import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, test, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

import venfourMark from "../../../assets/brand/venfour-mark.svg";
import type { AdminDiminishedValueDependencies } from "@/features/admin/diminished-value/dependencies";
import type { AuthService } from "@/features/auth";
import { appraisalCaseQueryKeys } from "@/features/cases/queries";
import type { CustomerProfileService } from "@/features/customer-profile";
import {
  createEmptyTotalLossDraft,
  readTotalLossDraft,
  writeTotalLossDraft,
} from "@/features/total-loss/draft";
import type { TotalLossDependencies } from "@/features/total-loss/dependencies";
import { RouteErrorPage } from "@/pages/route-error-page";
import { representativeRunId } from "@/test/fixtures/analysis-presentation";
import { renderTestApp } from "@/test/render";

describe("Venfour application", () => {
  test("renders the root route", () => {
    renderTestApp();

    expect(
      screen.getByRole("heading", {
        name: "Your Vehicle’s Value, Made Clear.",
      }),
    ).toBeInTheDocument();
    expect(document.title).toBe(
      "Vehicle Valuation Reviews After an Accident | Venfour",
    );
  });

  test("uses focused metadata and the compact shell for the appraisal intake", async () => {
    renderTotalLossApp(
      ["/start?service=total-loss"],
      createTestAnonymousSession(),
    );

    await waitFor(() =>
      expect(document.title).toBe(
        "Start a Total Loss Review | Venfour",
      ),
    );
    expect(
      screen.queryByText("Already have an account?"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Primary navigation" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Get Started" }),
    ).not.toBeInTheDocument();
  });

  test("redirects the legacy total-loss start URL and preserves its query", async () => {
    const { router } = renderTotalLossApp(
      [
        "/total-loss/start?caseId=saved-case&campaign=renewal&service=diminished-value",
      ],
      createTestAnonymousSession(),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe("/start"));
    const searchParams = new URLSearchParams(router.state.location.search);
    expect(searchParams.get("service")).toBe("total-loss");
    expect(searchParams.get("caseId")).toBe("saved-case");
    expect(searchParams.get("campaign")).toBe("renewal");
    await waitFor(() =>
      expect(document.title).toBe(
        "Start a Total Loss Review | Venfour",
      ),
    );
  });

  test("provides homepage-focused primary and footer navigation", () => {
    renderTestApp();

    const primaryNavigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    expect(
      within(primaryNavigation).getByRole("link", { name: "Total Loss" }),
    ).toHaveAttribute("href", "#total-loss");
    expect(
      within(primaryNavigation).getByRole("link", { name: "Diminished Value" }),
    ).toHaveAttribute("href", "#diminished-value");
    expect(
      within(primaryNavigation).getByRole("link", { name: "How It Works" }),
    ).toHaveAttribute("href", "#how-it-works");
    expect(
      within(primaryNavigation).getByRole("link", {
        name: "Get Started",
      }),
    ).toHaveAttribute("href", "/start?service=total-loss");

    const footerNavigation = screen.getByRole("navigation", {
      name: "Footer navigation",
    });
    expect(within(footerNavigation).getAllByRole("link")).toHaveLength(7);
    expect(
      within(footerNavigation).getByRole("link", { name: "Total Loss" }),
    ).toHaveAttribute("href", "#total-loss");
    expect(
      within(footerNavigation).getByRole("link", { name: "Diminished Value" }),
    ).toHaveAttribute("href", "#diminished-value");
    expect(
      within(footerNavigation).getByRole("link", { name: "Methodology" }),
    ).toHaveAttribute("href", "/methodology");
    expect(
      within(footerNavigation).getByRole("link", { name: "Terms" }),
    ).toHaveAttribute("href", "/terms");
    expect(
      within(footerNavigation).getByRole("link", { name: "Privacy" }),
    ).toHaveAttribute("href", "/privacy");
    expect(
      within(footerNavigation).getByRole("link", { name: "Cookie Policy" }),
    ).toHaveAttribute("href", "/cookies");
    expect(
      within(footerNavigation).getByRole("link", { name: "Contact" }),
    ).toHaveAttribute("href", "/contact");
    expect(
      within(footerNavigation).getByRole("button", {
        name: "Cookie preferences",
      }),
    ).toBeVisible();

    const headerLogo = screen
      .getByRole("banner")
      .querySelector<HTMLImageElement>("img[data-brand-logo='venfour']");
    const footerLogo = screen
      .getByRole("contentinfo")
      .querySelector<HTMLImageElement>("img[data-brand-logo='venfour']");
    expect(headerLogo).toHaveAttribute("src", venfourMark);
    expect(footerLogo).toHaveAttribute("src", venfourMark);
    expect(headerLogo).toHaveClass("size-7");
    expect(footerLogo).toHaveClass("size-6");
    expect(
      within(screen.getByRole("banner")).getByText("VENFOUR"),
    ).toBeVisible();
    expect(
      within(screen.getByRole("contentinfo")).getByText("VENFOUR"),
    ).toBeVisible();
    expect(
      within(screen.getByRole("contentinfo")).getByText(
        `© ${new Date().getFullYear()} VENFOUR. All rights reserved.`,
      ),
    ).toBeVisible();

    const renderedImageSources = Array.from(
      document.querySelectorAll<HTMLImageElement>("img[src]"),
      (image) => image.getAttribute("src") ?? "",
    ).join(" ");
    expect(renderedImageSources).not.toContain("venfour-logo-black.svg");
    expect(renderedImageSources).not.toContain("venfour-logo-white.svg");

  });

  test("offers report and no-report intake after secure setup", async () => {
    renderTotalLossApp();

    const noReportOption = await screen.findByRole("radio", {
      name: /I don’t have the report/i,
    });
    expect(noReportOption).toBeEnabled();
    expect(
      screen.getByRole("radio", { name: /I have my valuation report/i }),
    ).toBeEnabled();
    expect(
      screen.queryByText(/not available in this tester release/i),
    ).not.toBeInTheDocument();
  });

  test("resumes a saved no-report draft as an active manual intake", async () => {
    expect(
      writeTotalLossDraft({
        ...createEmptyTotalLossDraft(),
        mode: "manual",
        step: "vehicle",
        manual: {
          ...createEmptyTotalLossDraft().manual,
          vin: "1HGCM82633A004352",
        },
      }).ok,
    ).toBe(true);

    renderTotalLossApp();

    expect(
      await screen.findByRole("heading", {
        name: "Tell us about your vehicle",
      }),
    ).toBeVisible();
    expect(screen.getByLabelText("VIN")).toHaveValue(
      "1HGCM82633A004352",
    );
    expect(
      screen.queryByText(/original CCC report/i),
    ).not.toBeInTheDocument();
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: {
        mode: "manual",
        manual: {
          vin: "1HGCM82633A004352",
        },
      },
    });
  });

  test("opens and dismisses an accessible mobile navigation", async () => {
    const user = userEvent.setup();
    renderTestApp();

    const openNavigation = screen.getByRole("button", {
      name: "Open navigation",
    });
    expect(openNavigation).toHaveAttribute("aria-expanded", "false");
    expect(openNavigation).toHaveAttribute(
      "aria-controls",
      "mobile-navigation",
    );
    const mobileControls = openNavigation.parentElement;
    expect(mobileControls).not.toBeNull();
    if (!mobileControls) {
      throw new Error("Mobile navigation controls were not rendered.");
    }
    expect(
      within(mobileControls).getByRole("link", { name: "Get Started" }),
    ).toHaveAttribute("href", "/start?service=total-loss");
    expect(
      screen.queryByRole("navigation", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();

    await user.click(openNavigation);

    const mobileNavigation = screen.getByRole("navigation", {
      name: "Mobile navigation",
    });
    const closeNavigation = screen.getByRole("button", {
      name: "Close navigation",
    });
    expect(closeNavigation).toHaveAttribute("aria-expanded", "true");
    expect(mobileNavigation).toHaveAttribute("id", "mobile-navigation");
    expect(
      within(mobileNavigation).getByRole("link", { name: "Total Loss" }),
    ).toHaveAttribute("href", "#total-loss");
    expect(
      within(mobileNavigation).getByRole("link", { name: "Diminished Value" }),
    ).toHaveAttribute("href", "#diminished-value");
    expect(
      within(mobileNavigation).getByRole("link", { name: "How It Works" }),
    ).toHaveAttribute("href", "#how-it-works");
    expect(
      within(mobileNavigation).getByRole("button", { name: "Sign In" }),
    ).toBeVisible();
    within(mobileNavigation).getByRole("link", { name: "Total Loss" }).focus();
    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("navigation", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open navigation" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Open navigation" })).toHaveFocus();
  });

  test("keeps the account control stable while restoring a signed-out session", async () => {
    let resolveSession: ((session: Session | null) => void) | undefined;
    const authService = createTestAuthService(null, {
      getSession: () =>
        new Promise((resolve) => {
          resolveSession = resolve;
        }),
    });

    renderTestApp(["/"], { authService });

    expect(screen.getByText("Checking sign-in status")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sign In" }),
    ).not.toBeInTheDocument();

    await act(async () => resolveSession?.(null));

    expect(
      await screen.findByRole("button", { name: "Sign In" }),
    ).toBeVisible();
  });

  test("shows signed-in identity, signs out, and clears customer case data", async () => {
    const user = userEvent.setup();
    const signOut = vi.fn(async () => {});
    const session = createTestSession();
    const { queryClient } = renderTestApp(["/"], {
      authService: createTestAuthService(session, { signOut }),
    });

    const account = await screen.findByRole("button", {
      name: "Account for ada@example.com",
    });
    expect(account).toHaveTextContent("Ada");

    queryClient.setQueryData(
      appraisalCaseQueryKeys.list(session.user.id),
      ["private-case-sentinel"],
    );
    expect(
      writeTotalLossDraft({
        ...createEmptyTotalLossDraft(),
        ownerUserId: session.user.id,
      }).ok,
    ).toBe(true);

    await user.click(account);
    expect(screen.getByText("ada@example.com")).toBeVisible();
    await user.click(screen.getByRole("menuitem", { name: "Sign Out" }));

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
    expect(
      await screen.findByRole("button", { name: "Sign In" }),
    ).toBeVisible();
    expect(
      queryClient.getQueryData(appraisalCaseQueryKeys.list(session.user.id)),
    ).toBeUndefined();
    expect(readTotalLossDraft()).toEqual({ ok: true, draft: null });
  });

  test("keeps an anonymous session signed out in the shell and skips staff access", async () => {
    const user = userEvent.setup();
    const isStaff = vi.fn(async () => true);
    const adminDiminishedValueDependencies = {
      caseService: { isStaff },
      documentService: {},
    } as unknown as AdminDiminishedValueDependencies;

    renderTestApp(["/"], {
      adminDiminishedValueDependencies,
      authService: createTestAuthService(createTestAnonymousSession()),
    });

    expect(
      await screen.findByRole("button", { name: "Sign In" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Account for/ }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Open navigation" }),
    );
    expect(
      within(
        screen.getByRole("navigation", { name: "Mobile navigation" }),
      ).getByRole("button", { name: "Sign In" }),
    ).toBeVisible();
    expect(isStaff).not.toHaveBeenCalled();
  });

  test("clears a different owner's draft during initial session restoration", async () => {
    expect(
      writeTotalLossDraft({
        ...createEmptyTotalLossDraft(),
        ownerUserId: "22222222-2222-4222-8222-222222222222",
      }).ok,
    ).toBe(true);

    renderTestApp(["/"], {
      authService: createTestAuthService(createTestSession()),
    });

    await screen.findByRole("button", {
      name: "Account for ada@example.com",
    });
    expect(readTotalLossDraft()).toEqual({ ok: true, draft: null });
  });

  test("shows signed-in identity and sign out in mobile navigation", async () => {
    const user = userEvent.setup();
    renderTestApp(["/"], {
      authService: createTestAuthService(createTestSession()),
    });

    await screen.findByRole("button", {
      name: "Account for ada@example.com",
    });
    await user.click(
      screen.getByRole("button", { name: "Open navigation" }),
    );

    const mobileNavigation = screen.getByRole("navigation", {
      name: "Mobile navigation",
    });
    expect(
      within(mobileNavigation).getByText("ada@example.com"),
    ).toBeVisible();
    expect(
      within(mobileNavigation).getByRole("button", { name: "Sign Out" }),
    ).toBeVisible();
  });

  test("closes mobile navigation and focuses the total-loss section", async () => {
    const user = userEvent.setup();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      const { router } = renderTestApp();
      await user.click(
        screen.getByRole("button", { name: "Open navigation" }),
      );

      const mobileNavigation = screen.getByRole("navigation", {
        name: "Mobile navigation",
      });
      const totalLossLink = within(mobileNavigation).getByRole("link", {
        name: "Total Loss",
      });
      await user.click(totalLossLink);

      expect(
        screen.queryByRole("navigation", { name: "Mobile navigation" }),
      ).not.toBeInTheDocument();

      await router.navigate("/#total-loss");
      const totalLoss = document.getElementById("total-loss");
      expect(totalLoss).not.toBeNull();
      await waitFor(() => expect(totalLoss).toHaveFocus());
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
          configurable: true,
          value: originalScrollIntoView,
        });
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
      }
    }
  });

  test("uses the unified total-loss entry point away from the homepage", () => {
    renderTestApp(["/privacy"]);

    const primaryNavigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    expect(
      within(primaryNavigation).getByRole("link", { name: "Total Loss" }),
    ).toHaveAttribute("href", "/#total-loss");
    expect(
      within(primaryNavigation).getByRole("link", { name: "Diminished Value" }),
    ).toHaveAttribute("href", "/#diminished-value");
    expect(
      within(primaryNavigation).getByRole("link", { name: "How It Works" }),
    ).toHaveAttribute("href", "/#how-it-works");
    expect(
      within(primaryNavigation).getByRole("link", { name: "Get Started" }),
    ).toHaveAttribute("href", "/start?service=total-loss");

    const openNavigation = screen.getByRole("button", {
      name: "Open navigation",
    });
    const mobileControls = openNavigation.parentElement;
    expect(mobileControls).not.toBeNull();
    if (!mobileControls) {
      throw new Error("Mobile navigation controls were not rendered.");
    }
    expect(
      within(mobileControls).getByRole("link", { name: "Get Started" }),
    ).toHaveAttribute("href", "/start?service=total-loss");
    expect(
      screen.getByRole("heading", { name: "How Venfour handles your information" }),
    ).toBeVisible();
  });

  test("resets scroll when a home link navigates to the hashless homepage", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    try {
      const { router } = renderTestApp(["/privacy"]);
      expect(scrollTo).not.toHaveBeenCalled();

      await user.click(screen.getByRole("link", { name: "Venfour home" }));

      await waitFor(() => expect(router.state.location.pathname).toBe("/"));
      expect(router.state.location.hash).toBe("");
      await waitFor(() => expect(scrollTo).toHaveBeenCalledOnce());
      expect(scrollTo).toHaveBeenCalledWith({
        top: 0,
        left: 0,
        behavior: "auto",
      });
    } finally {
      scrollTo.mockRestore();
    }
  });

  test("does not override native scroll restoration on a refreshed homepage", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    try {
      renderTestApp();

      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      scrollTo.mockRestore();
    }
  });

  test.each([
    ["total-loss", "Your vehicle was totaled"],
    ["diminished-value", "Repairs can fix the vehicle—not its history."],
    ["how-it-works", "Start online in a few steps"],
  ])("honors the homepage #%s anchor after cross-page navigation", async (id, heading) => {
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    try {
      const { router } = renderTestApp([`/#${id}`]);

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce());
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
      expect(document.getElementById(id)).toHaveFocus();
      expect(screen.getByRole("heading", { name: heading })).toBeVisible();
      await waitFor(() => expect(router.state.location.hash).toBe(""));
      expect(router.state.location.pathname).toBe("/");
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      scrollTo.mockRestore();
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
          configurable: true,
          value: originalScrollIntoView,
        });
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
      }
    }
  });

  test("transitions the shared header between integrated and detached states", () => {
    const intersectionObserverDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "IntersectionObserver",
    );
    const observe = vi.fn<(target: Element) => void>();
    const disconnect = vi.fn<() => void>();
    let observerCallback: IntersectionObserverCallback | undefined;

    class ControlledIntersectionObserver implements IntersectionObserver {
      static current: ControlledIntersectionObserver | undefined;

      readonly root = null;
      readonly rootMargin = "0px";
      readonly scrollMargin = "0px";
      readonly thresholds = [0];

      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
        ControlledIntersectionObserver.current = this;
      }

      disconnect(): void {
        disconnect();
      }

      observe(target: Element): void {
        observe(target);
      }

      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }

      unobserve(target: Element): void {
        void target;
      }
    }

    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: ControlledIntersectionObserver,
    });

    let unmount: (() => void) | undefined;
    try {
      ({ unmount } = renderTestApp());
      const header = screen.getByRole("banner");
      expect(header).toHaveAttribute("data-header-state", "integrated");
      expect(header).toHaveClass("motion-reduce:transition-none");
      expect(observe).toHaveBeenCalledOnce();

      const sentinel = observe.mock.calls[0]?.[0];
      expect(sentinel).toBeInstanceOf(HTMLSpanElement);
      expect(sentinel).toHaveAttribute("aria-hidden", "true");
      expect(observerCallback).toBeDefined();
      expect(ControlledIntersectionObserver.current).toBeDefined();
      const callback = observerCallback;
      const observer = ControlledIntersectionObserver.current;
      if (!sentinel || !callback || !observer) {
        throw new Error("The header intersection observer was not initialized.");
      }

      const entry = (isIntersecting: boolean) =>
        ({
          isIntersecting,
          intersectionRatio: isIntersecting ? 1 : 0,
          target: sentinel,
        }) as IntersectionObserverEntry;

      act(() => {
        callback([entry(false)], observer);
      });
      expect(header).toHaveAttribute("data-header-state", "detached");

      act(() => {
        callback([entry(true)], observer);
      });
      expect(header).toHaveAttribute("data-header-state", "integrated");

      unmount();
      unmount = undefined;
      expect(disconnect).toHaveBeenCalledOnce();
    } finally {
      unmount?.();
      if (intersectionObserverDescriptor) {
        Object.defineProperty(
          globalThis,
          "IntersectionObserver",
          intersectionObserverDescriptor,
        );
      } else {
        Reflect.deleteProperty(globalThis, "IntersectionObserver");
      }
    }
  });

  test.each([
    [
      "/methodology",
      "How the Total Loss review works",
      "Total-Loss Review Methodology | Venfour",
    ],
    ["/terms", "Terms for using Venfour", "Terms of Use | Venfour"],
    ["/contact", "Questions about Venfour", "Contact Venfour"],
    [
      "/contact?topic=diminished-value",
      "Get help with a diminished-value request",
      "Contact Venfour",
    ],
    ["/privacy", "How Venfour handles your information", "Privacy Policy | Venfour"],
    [
      "/cookies",
      "Cookies and browser storage at Venfour",
      "Cookie Policy | Venfour",
    ],
  ])("renders the public route %s", (path, heading, title) => {
    renderTestApp([path]);

    expect(screen.getByRole("heading", { name: heading })).toBeVisible();
    expect(document.title).toBe(title);
  });

  test("describes authenticated case-owned report processing", () => {
    renderTestApp(["/privacy"]);

    expect(
      screen.getByRole("heading", {
        name: "Total-loss report and analysis handling",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(/retrieves the report through a server-controlled path/i),
    ).toBeVisible();
    expect(
      screen.getByText(/resulting validated analysis is linked to the appraisal case/i),
    ).toBeVisible();
    expect(
      screen.getByText(/case or results identifier by itself is not authorization/i),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Diminished-value request handling" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "How legacy report processing works" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/separate legacy valuation-review upload still creates/i),
    ).not.toBeInTheDocument();
  });

  test("redirects the retired total-loss review URL to the unified intake", async () => {
    const { router } = renderTotalLossApp(
      ["/total-loss-review?campaign=renewal&service=diminished-value"],
      createTestAnonymousSession(),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe("/start"));
    const searchParams = new URLSearchParams(router.state.location.search);
    expect(searchParams.get("service")).toBe("total-loss");
    expect(searchParams.get("campaign")).toBe("renewal");
    expect(
      screen.getByRole("heading", { name: "Start your Total Loss review" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Upload your insurance value report" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(document.title).toBe(
        "Start a Total Loss Review | Venfour",
      ),
    );
  });

  test("keeps saved analysis routes operational", async () => {
    renderTestApp([`/analyses/${representativeRunId}`], {
      authService: createTestAuthService(createTestSession()),
    });

    expect(await screen.findByText("Valuation analysis loaded.")).toBeVisible();
    expect(document.title).toBe("Vehicle Valuation Analysis | Venfour");
  });

  test("does not expose the placeholder workspace route", () => {
    renderTestApp(["/workspace"]);

    expect(
      screen.getByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
  });

  test("renders the not-found route", () => {
    renderTestApp(["/missing"]);

    expect(
      screen.getByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Page Not Found | Venfour");
  });

  test("uses an intentional error page for unexpected route failures", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: <BrokenRoute />,
          errorElement: <RouteErrorPage />,
        },
      ],
      { initialEntries: ["/"] },
    );

    render(<RouterProvider router={router} />);

    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t display this page.",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("private render detail")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Return to Venfour" }),
    ).toHaveAttribute("href", "/");
    expect(document.title).toBe("Page Error | Venfour");

    consoleError.mockRestore();
  });
});

function BrokenRoute(): never {
  throw new Error("private render detail");
}

function renderTotalLossApp(
  initialEntries = ["/start?service=total-loss"],
  session = createTestSession(),
) {
  const appraisalCase = {
    id: "22222222-2222-4222-8222-222222222222",
    userId: session.user.id,
    serviceType: "total_loss" as const,
    status: "draft" as const,
    createdAt: "2026-08-23T12:00:00.000Z",
    updatedAt: "2026-08-23T12:00:00.000Z",
    lastActivityAt: "2026-08-23T12:00:00.000Z",
  };
  const appraisalCaseService = {
    createAppraisalCase: async () => appraisalCase,
    createOrGetAppraisalCase: async () => appraisalCase,
    getAppraisalCase: async () => appraisalCase,
    getOrCreateTotalLossDraft: async () => appraisalCase,
    getRecentDraftAppraisalCase: async () => appraisalCase,
    listAppraisalCases: async () => [appraisalCase],
    touchAppraisalCase: async () => appraisalCase,
  };
  const customerProfileService: CustomerProfileService = {
    getProfile: async () => ({
      userId: session.user.id,
      fullName: "Ada Lovelace",
      fullNameConfirmedAt: "2026-08-23T12:00:00.000Z",
      serviceTermsVersion: "2026-08-23",
      serviceTermsAcknowledgedAt: "2026-08-23T12:00:00.000Z",
      privacyNoticeVersion: "2026-08-23",
      privacyNoticeAcknowledgedAt: "2026-08-23T12:00:00.000Z",
      operationalFollowUpAllowed: false,
      operationalFollowUpUpdatedAt: "2026-08-23T12:00:00.000Z",
      createdAt: "2026-08-23T12:00:00.000Z",
      updatedAt: "2026-08-23T12:00:00.000Z",
    }),
    confirmProfile: async () => {
      throw new Error("The confirmed test profile should not be resubmitted.");
    },
  };
  const totalLossDependencies = {
    appraisalCaseService,
    totalLossDetailsService: { getDetails: async () => null },
    totalLossReportStorageService: {},
    vehicleLookupService: {},
  } as unknown as TotalLossDependencies;

  return renderTestApp(initialEntries, {
    authService: createTestAuthService(session),
    customerProfileService,
    totalLossDependencies,
  });
}

function createTestSession(): Session {
  return {
    access_token: "test-access-token",
    expires_in: 3600,
    refresh_token: "test-refresh-token",
    token_type: "bearer",
    user: {
      app_metadata: { provider: "email", providers: ["email"] },
      aud: "authenticated",
      created_at: "2026-08-18T14:00:00.000Z",
      email: "ada@example.com",
      email_confirmed_at: "2026-08-18T14:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
      user_metadata: { full_name: "Ada Lovelace" },
    },
  };
}

function createTestAnonymousSession(): Session {
  const session = createTestSession();
  session.user.app_metadata = { provider: "anonymous", providers: [] };
  session.user.email = undefined;
  session.user.id = "33333333-3333-4333-8333-333333333333";
  session.user.is_anonymous = true;
  session.user.user_metadata = {};
  return session;
}

function createTestAuthService(
  session: Session | null,
  overrides: Partial<AuthService> = {},
): AuthService {
  return {
    exchangeCodeForSession: async () => {
      if (!session) {
        throw new Error("No test session is available.");
      }
      return session;
    },
    getSession: async () => session,
    onAuthStateChange: () => () => {},
    sendMagicLink: async () => {},
    signInAnonymously: async () => session ?? createTestAnonymousSession(),
    signInWithGoogle: async () => {},
    signOut: async () => {},
    verifyEmailOtp: async () => {
      if (!session) {
        throw new Error("No test session is available.");
      }
      return session;
    },
    ...overrides,
  };
}
