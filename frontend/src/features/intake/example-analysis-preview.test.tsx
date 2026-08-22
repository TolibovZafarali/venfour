import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ExampleAnalysisPreview } from "@/features/intake/example-analysis-preview";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("example analysis preview", () => {
  test("renders the total-loss report example with proportional value bars", () => {
    const { container } = render(
      <ExampleAnalysisPreview service="total-loss" />,
    );

    expect(
      screen.getByRole("region", { name: "2024 Hyundai Elantra SEL" }),
    ).toHaveAttribute("data-example-service", "total-loss");
    expect(screen.getByText("Illustrative example")).toBeVisible();
    expect(screen.getByLabelText("Insurer valuation")).toBeVisible();
    expect(screen.getByLabelText("Local market evidence")).toBeVisible();
    expect(screen.getByLabelText("Potential value gap")).toBeVisible();
    expect(screen.getByLabelText("+$1,430")).toBeVisible();
    expect(
      screen.getByLabelText(
        "12 comparable vehicles · within 87 miles",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("img", {
        name: "Value comparison: Insurer valuation, $19,050; Market evidence, $20,480",
      }),
    ).toBeVisible();

    const bars = container.querySelectorAll("[data-example-bar]");
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveStyle({ width: "87%" });
    expect(bars[1]).toHaveStyle({ width: "94%" });
  });

  test("morphs the shared preview structure when the service changes", () => {
    const { container, rerender } = render(
      <ExampleAnalysisPreview service="total-loss" />,
    );
    const preview = container.querySelector("[data-example-analysis]");
    const barsBeforeChange = container.querySelectorAll(
      "[data-example-bar]",
    );

    rerender(<ExampleAnalysisPreview service="diminished-value" />);

    expect(container.querySelector("[data-example-analysis]")).toBe(preview);
    expect(
      screen.getByRole("region", { name: "2025 Hyundai Tucson SEL" }),
    ).toHaveAttribute("data-example-service", "diminished-value");
    expect(screen.getByLabelText("Value before accident")).toBeVisible();
    expect(screen.getByLabelText("Post-repair market value")).toBeVisible();
    expect(screen.getByLabelText("Estimated value loss")).toBeVisible();
    expect(screen.getAllByLabelText("$2,900")).not.toHaveLength(0);
    expect(
      screen.getByLabelText(
        "Accident history · repairs · mileage · local market",
      ),
    ).toBeVisible();
    expect(
      screen.getByLabelText(
        "This example shows what a reviewer may examine. Submitting the current form does not create an automated appraisal.",
      ),
    ).toBeVisible();

    const barsAfterChange = container.querySelectorAll(
      "[data-example-bar]",
    );
    expect(barsAfterChange[0]).toBe(barsBeforeChange[0]);
    expect(barsAfterChange[1]).toBe(barsBeforeChange[1]);
    expect(barsAfterChange[0]).toHaveStyle({ width: "94%" });
    expect(barsAfterChange[1]).toHaveStyle({ width: "85%" });
    expect(
      container.querySelector(".example-analysis-copy-incoming"),
    ).toBeInTheDocument();
    expect(
      container.querySelector(".example-analysis-copy-outgoing"),
    ).toBeInTheDocument();
  });

  test("updates immediately without copy or number animation for reduced motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    const { container, rerender } = render(
      <ExampleAnalysisPreview service="total-loss" />,
    );

    rerender(<ExampleAnalysisPreview service="diminished-value" />);

    expect(
      container.querySelector(".example-analysis-copy-incoming"),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector(".example-analysis-copy-outgoing"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("2024 Hyundai Elantra SEL")).not.toBeInTheDocument();
    expect(screen.getByText("2025 Hyundai Tucson SEL")).toBeInTheDocument();
    expect(screen.getAllByText("$31,800")).not.toHaveLength(0);
    expect(screen.getAllByText("$28,900")).not.toHaveLength(0);
  });
});
