import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, test, vi } from "vitest";

import venfourMark from "../../../assets/brand/venfour-mark.svg";
import { RouteErrorPage } from "@/pages/route-error-page";
import { renderTestApp } from "@/test/render";

describe("Venfour application", () => {
  test("renders the root route", () => {
    renderTestApp();

    expect(
      screen.getByRole("heading", {
        name: "Know what your car is worth.",
      }),
    ).toBeInTheDocument();
    expect(document.title).toBe(
      "Check Your Car’s Value After an Accident | Venfour",
    );
  });

  test("provides restrained primary and footer navigation", async () => {
    const user = userEvent.setup();
    renderTestApp();

    const primaryNavigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    expect(
      within(primaryNavigation).getByRole("link", { name: "Services" }),
    ).toHaveAttribute("href", "#services");
    expect(
      within(primaryNavigation).getByRole("link", { name: "Methodology" }),
    ).toHaveAttribute("href", "/methodology");
    expect(
      within(primaryNavigation).getByRole("link", { name: "Contact" }),
    ).toHaveAttribute("href", "/contact");
    expect(
      within(primaryNavigation).getByRole("link", {
        name: "Get started",
      }),
    ).toHaveAttribute("href", "#services");

    const footerNavigation = screen.getByRole("navigation", {
      name: "Footer navigation",
    });
    for (const label of ["Methodology", "Privacy", "Terms", "Contact"]) {
      expect(
        within(footerNavigation).getByRole("link", { name: label }),
      ).toBeInTheDocument();
    }

    const headerLogo = screen
      .getByRole("banner")
      .querySelector<HTMLImageElement>("img[data-brand-logo='venfour']");
    const footerLogo = screen
      .getByRole("contentinfo")
      .querySelector<HTMLImageElement>("img[data-brand-logo='venfour']");
    expect(headerLogo).toHaveAttribute("src", venfourMark);
    expect(footerLogo).toHaveAttribute("src", venfourMark);

    const renderedImageSources = Array.from(
      document.querySelectorAll<HTMLImageElement>("img[src]"),
      (image) => image.getAttribute("src") ?? "",
    ).join(" ");
    expect(renderedImageSources).not.toContain("venfour-logo-black.svg");
    expect(renderedImageSources).not.toContain("venfour-logo-white.svg");

    await user.click(
      within(primaryNavigation).getByRole("link", { name: "Methodology" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "A structured review of report facts and market evidence",
      }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Methodology | Venfour");
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
      within(mobileControls).getByRole("link", { name: "Get started" }),
    ).toHaveAttribute("href", "#services");
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
      within(mobileNavigation).getByRole("link", { name: "Services" }),
    ).toHaveAttribute("href", "#services");
    expect(
      within(mobileNavigation).getByRole("link", { name: "Methodology" }),
    ).toHaveAttribute("href", "/methodology");
    expect(
      within(mobileNavigation).getByRole("link", { name: "Contact" }),
    ).toHaveAttribute("href", "/contact");
    within(mobileNavigation).getByRole("link", { name: "Services" }).focus();
    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("navigation", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open navigation" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Open navigation" })).toHaveFocus();
  });

  test("closes mobile navigation and focuses the services section", async () => {
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
      const servicesLink = within(mobileNavigation).getByRole("link", {
        name: "Services",
      });
      await user.click(servicesLink);

      expect(
        screen.queryByRole("navigation", { name: "Mobile navigation" }),
      ).not.toBeInTheDocument();

      await router.navigate("/#services");
      const services = document.getElementById("services");
      expect(services).not.toBeNull();
      await waitFor(() => expect(services).toHaveFocus());
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

  test("uses the dedicated review entry point away from the homepage", () => {
    renderTestApp(["/methodology"]);

    const primaryNavigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    expect(
      within(primaryNavigation).getByRole("link", { name: "Services" }),
    ).toHaveAttribute("href", "/#services");
    expect(
      within(primaryNavigation).getByRole("link", { name: "Methodology" }),
    ).toHaveAttribute("href", "/methodology");
    expect(
      within(primaryNavigation).getByRole("link", { name: "Contact" }),
    ).toHaveAttribute("href", "/contact");
    expect(
      within(primaryNavigation).getByRole("link", { name: "Get started" }),
    ).toHaveAttribute("href", "/total-loss-review");

    const openNavigation = screen.getByRole("button", {
      name: "Open navigation",
    });
    const mobileControls = openNavigation.parentElement;
    expect(mobileControls).not.toBeNull();
    if (!mobileControls) {
      throw new Error("Mobile navigation controls were not rendered.");
    }
    expect(
      within(mobileControls).getByRole("link", { name: "Get started" }),
    ).toHaveAttribute("href", "/total-loss-review");
  });

  test("honors a homepage section hash after cross-page navigation", async () => {
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      renderTestApp(["/#services"]);

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce());
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
      expect(document.getElementById("services")).toHaveFocus();
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
    ["/privacy", "How Venfour handles your information", "Privacy | Venfour"],
    ["/terms", "Terms for using Venfour", "Terms of Use | Venfour"],
    [
      "/total-loss-review",
      "Review your total-loss valuation",
      "Total-Loss Valuation Review | Venfour",
    ],
    [
      "/methodology",
      "A structured review of report facts and market evidence",
      "Methodology | Venfour",
    ],
    ["/contact", "Questions about Venfour", "Contact | Venfour"],
  ])("mounts the public route %s", (path, heading, title) => {
    renderTestApp([path]);

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(document.title).toBe(title);
  });

  test("shows a truthful contact fallback when no support email is configured", () => {
    renderTestApp(["/contact"]);

    expect(
      screen.getByText(
        "Direct email support is not currently available through this site.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /^Email / }),
    ).not.toBeInTheDocument();
  });

  test.each([
    [
      "/contact?topic=vehicle-value",
      "Ask about your vehicle’s market value",
      /self-service vehicle-details workflow is not available yet/i,
    ],
    [
      "/contact?topic=diminished-value",
      "Ask about diminished value after a repair",
      /does not currently provide an automated diminished-value appraisal/i,
    ],
    [
      "/contact?topic=report-format",
      "Ask about another valuation report",
      /automated review currently supports original CCC valuation report PDFs/i,
    ],
  ])("keeps the inquiry handoff at %s truthful", (path, heading, disclosure) => {
    renderTestApp([path]);

    expect(screen.getByRole("heading", { name: heading })).toBeVisible();
    expect(screen.getByText(disclosure)).toBeVisible();
    expect(
      screen.getByText(
        "Direct email support is not currently available through this site.",
      ),
    ).toBeVisible();
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
