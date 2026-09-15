import { act, render } from "@testing-library/react";
import { createPortal } from "react-dom";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { visualSystemForLocation } from "./visual-system";
import { VisualSystemProvider } from "./visual-system-provider";

afterEach(() => document.documentElement.removeAttribute("data-visual-system"));

describe("document visual boundary", () => {
  it.each(["/", "/terms", "/start", "/settings", "/unknown/future-route"])("keeps the production host authoritative for %s", (path) => {
    expect(visualSystemForLocation(path, "https://venfour.com")).toBe("public");
    expect(visualSystemForLocation(path, "https://www.venfour.com")).toBe("public");
    expect(visualSystemForLocation(path, "https://app.venfour.com")).toBe("app");
  });

  it.each(["/app", "/start", "/appraisals", "/partners", "/admin/settings", "/auth/callback", "/new-workflow"])("defaults product routes to the app system in combined builds: %s", (path) => {
    expect(visualSystemForLocation(path, "http://localhost:5173")).toBe("app");
    expect(visualSystemForLocation(path, "https://staging.venfour.com")).toBe("app");
  });

  it("updates the whole document on navigation, including portals and route errors", async () => {
    const router = createMemoryRouter([
      { path: "/", element: <p>Public</p> },
      { path: "/start", element: createPortal(<div role="dialog">Account</div>, document.body) },
      { path: "/broken", loader: () => { throw new Error("Unavailable"); }, errorElement: <p>Error</p> },
    ]);
    const view = render(<><VisualSystemProvider router={router} /><RouterProvider router={router} /></>);
    expect(document.documentElement).toHaveAttribute("data-visual-system", "public");
    await act(() => router.navigate("/start"));
    expect(document.querySelector('[role="dialog"]')?.closest('[data-visual-system="app"]')).toBe(document.documentElement);
    await act(() => router.navigate("/broken"));
    expect(document.documentElement).toHaveAttribute("data-visual-system", "app");
    await act(() => router.navigate("/"));
    expect(document.documentElement).toHaveAttribute("data-visual-system", "public");
    view.unmount();
    expect(document.documentElement).not.toHaveAttribute("data-visual-system");
    router.dispose();
  });
});
