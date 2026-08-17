import { render, screen, within } from "@testing-library/react";
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
        name: "Know how your vehicle valuation compares.",
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
      within(primaryNavigation).getByRole("link", { name: "Methodology" }),
    ).toBeInTheDocument();
    expect(
      within(primaryNavigation).getByRole("link", { name: "Contact" }),
    ).toBeInTheDocument();

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
