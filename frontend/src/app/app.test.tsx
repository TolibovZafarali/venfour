import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { renderTestApp } from "@/test/render";

describe("Venfour application", () => {
  test("renders the root route", () => {
    renderTestApp();

    expect(
      screen.getByRole("heading", {
        name: "Understand the evidence behind your vehicle valuation.",
      }),
    ).toBeInTheDocument();
  });

  test("navigates to the workspace and loads health through MSW", async () => {
    const user = userEvent.setup();
    renderTestApp();

    await user.click(screen.getByRole("link", { name: "Open workspace" }));

    expect(
      screen.getByRole("heading", { name: "Your valuation workspace" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Backend connection is available."),
    ).toBeInTheDocument();
  });

  test("renders the not-found route", () => {
    renderTestApp(["/missing"]);

    expect(
      screen.getByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
  });
});
