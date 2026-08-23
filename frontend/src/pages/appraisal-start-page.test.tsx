import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DiminishedValueDependencies } from "@/features/diminished-value/dependencies";
import { renderTestApp } from "@/test/render";

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
          name: "Start your CCC report review",
        }),
      ).toBeVisible();
      expectSelectedService("Total Loss");
    },
  );

  it.each([
    [
      "total loss",
      "/start?service=total-loss",
      "Start your CCC report review",
      "Total Loss",
      "2024 Hyundai Elantra SEL",
      "12 comparable vehicles · within 87 miles",
    ],
    [
      "diminished value",
      "/start?service=diminished-value",
      "Diminished Value is coming next",
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
        document.querySelector("[data-appraisal-start-intro]"),
      ).toHaveClass("lg:pt-5");
      expect(document.querySelector("[data-appraisal-start-flow]")).toHaveClass(
        "lg:pt-5",
      );
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

    await user.click(within(intro!).getByRole("button", { name: "Continue" }));

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
    const caseId = "22222222-2222-4222-8222-222222222222";
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
    const caseId = "22222222-2222-4222-8222-222222222222";
    const { router } = renderTestApp(
      [
        `/start?service=diminished-value&view=intake&caseId=${caseId}&campaign=spring`,
      ],
      { diminishedValueDependencies },
    );

    expectSelectedService("Diminished Value");
    expect(
      screen.getByRole("heading", {
        name: "Diminished Value is coming next",
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
    const caseId = "22222222-2222-4222-8222-222222222222";
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
      await screen.findByRole("heading", {
        name: "Sign in before starting your review",
      }),
    ).toBeVisible();

    await user.click(screen.getByRole("radio", { name: "Diminished Value" }));
    expect(
      await screen.findByRole("heading", {
        name: "Diminished Value intake is not open yet",
      }),
    ).toBeVisible();
    expect(screen.queryByLabelText("VIN")).not.toBeInTheDocument();
  });
});
