import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, test, vi } from "vitest";

import { RouteErrorPage } from "@/pages/route-error-page";
import { renderTestApp } from "@/test/render";

describe("Venfour application", () => {
  test("renders the root route", () => {
    renderTestApp();

    expect(
      screen.getByRole("heading", {
        name: "Know what your vehicle is worth after an accident.",
      }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Venfour");
  });

  test("provides restrained primary and footer navigation", async () => {
    const user = userEvent.setup();
    renderTestApp();

    const primaryNavigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    expect(
      within(primaryNavigation).getByRole("link", { name: "How it works" }),
    ).toHaveAttribute("href", "#how-it-works");
    expect(
      within(primaryNavigation).getByRole("link", { name: "Methodology" }),
    ).toBeInTheDocument();
    expect(
      within(primaryNavigation).getByRole("link", { name: "Contact" }),
    ).toBeInTheDocument();
    expect(
      within(primaryNavigation).getByRole("link", {
        name: "Start a valuation review",
      }),
    ).toHaveAttribute("href", "#report-review");

    const footerNavigation = screen.getByRole("navigation", {
      name: "Footer navigation",
    });
    for (const label of ["Methodology", "Privacy", "Terms", "Contact"]) {
      expect(
        within(footerNavigation).getByRole("link", { name: label }),
      ).toBeInTheDocument();
    }

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

  test("opens and closes an accessible mobile navigation", async () => {
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
      within(mobileNavigation).getByRole("link", { name: "How it works" }),
    ).toHaveAttribute("href", "#how-it-works");
    expect(
      within(mobileNavigation).getByRole("link", { name: "Methodology" }),
    ).toHaveAttribute("href", "/methodology");
    expect(
      within(mobileNavigation).getByRole("link", { name: "Contact" }),
    ).toHaveAttribute("href", "/contact");

    await user.click(closeNavigation);

    expect(
      screen.queryByRole("navigation", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open navigation" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  test("honors a homepage section hash after cross-page navigation", async () => {
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      renderTestApp(["/#report-review"]);

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce());
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

  test.each([
    ["/privacy", "How Venfour handles your information", "Privacy | Venfour"],
    ["/terms", "Terms for using Venfour", "Terms of Use | Venfour"],
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
