import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DiminishedValueDependencies } from "@/features/diminished-value/dependencies";
import { renderTestApp } from "@/test/render";

type ServiceLabel = "Total Loss" | "Diminished Value";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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

function withinIntakeFlow() {
  const flow = document.querySelector<HTMLElement>(
    "[data-appraisal-start-flow]",
  );
  if (!flow) throw new Error("Appraisal intake flow was not rendered.");
  return within(flow);
}

async function chooseAccidentDate(
  user: ReturnType<typeof userEvent.setup>,
) {
  await user.click(screen.getByRole("button", { name: "Accident date" }));
  await user.selectOptions(screen.getByLabelText("Calendar year"), "2020");
  await user.selectOptions(screen.getByLabelText("Calendar month"), "0");
  await user.click(
    screen.getByRole("gridcell", { name: "January 2, 2020" }),
  );
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
          name: "Start your total-loss appraisal",
        }),
      ).toBeVisible();
      expectSelectedService("Total Loss");
    },
  );

  it.each([
    [
      "total loss",
      "/start?service=total-loss",
      "Start your total-loss appraisal",
      "Total Loss",
      "2024 Hyundai Elantra SEL",
      "12 comparable vehicles · within 87 miles",
    ],
    [
      "diminished value",
      "/start?service=diminished-value",
      "Start your diminished-value appraisal",
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
      expect(
        document.querySelector("[data-appraisal-start-flow]"),
      ).toHaveClass("lg:pt-5");
    },
  );

  it("pushes service choices and follows browser Back and Forward history", async () => {
    const user = userEvent.setup();
    const { router } = renderTestApp(["/start?service=total-loss"]);

    await user.click(
      screen.getByRole("radio", { name: "Diminished Value" }),
    );

    await waitFor(() =>
      expect(router.state.location.search).toBe(
        "?service=diminished-value",
      ),
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
      expect(router.state.location.search).toBe(
        "?service=diminished-value",
      ),
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

    await user.click(
      within(intro!).getByRole("button", { name: "Continue" }),
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
    const caseId = "22222222-2222-4222-8222-222222222222";
    const { router } = renderTestApp([
      `/start?service=total-loss&caseId=${caseId}&campaign=renewal`,
    ]);

    await user.click(
      screen.getByRole("radio", { name: "Diminished Value" }),
    );

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

  it("restores the local diminished-value draft after navigating away", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const { router } = renderTestApp([
      "/start?service=diminished-value&view=intake",
    ]);

    await user.selectOptions(
      screen.getByLabelText("State where the accident occurred"),
      "IL",
    );
    expect(
      screen.getByLabelText("State where the accident occurred"),
    ).toHaveValue("IL");

    await act(async () => {
      await router.navigate("/");
    });
    expect(
      await screen.findByRole("heading", {
        name: "Your Vehicle’s Value, Made Clear.",
      }),
    ).toBeVisible();
    await act(async () => {
      await router.navigate(-1);
    });

    expect(
      await screen.findByRole("heading", {
        name: "Start your diminished-value appraisal",
      }),
    ).toBeVisible();
    expect(
      screen.getByLabelText("State where the accident occurred"),
    ).toHaveValue("IL");
    expect(window.localStorage).toHaveLength(1);
  });

  it("ignores a VIN lookup that finishes after switching services", async () => {
    const user = userEvent.setup();
    const lookup = createDeferred<{
      vin: string;
      year: number;
      make: string;
      model: string;
      trim: string;
    }>();
    const decodeVin = vi.fn(() => lookup.promise);
    const diminishedValueDependencies = {
      vehicleLookupService: {
        decodeVin,
        listMakes: vi.fn(async () => []),
        listModels: vi.fn(async () => []),
      },
    } as unknown as DiminishedValueDependencies;

    renderTestApp(["/start?service=diminished-value&view=intake"], {
      diminishedValueDependencies,
    });
    await user.selectOptions(
      screen.getByLabelText("State where the accident occurred"),
      "IL",
    );
    await chooseAccidentDate(user);
    await user.selectOptions(
      screen.getByLabelText("Repair status"),
      "complete",
    );
    await user.click(
      withinIntakeFlow().getByRole("button", { name: "Continue" }),
    );
    await user.type(screen.getByLabelText("VIN"), "1HGCM82633A004352");
    await user.type(screen.getByLabelText("Mileage at the accident"), "48250");
    await user.click(
      screen.getByRole("button", { name: "Find vehicle & continue" }),
    );
    expect(decodeVin).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("radio", { name: "Total Loss" }));
    expect(
      await screen.findByRole("heading", {
        name: "Start your total-loss appraisal",
      }),
    ).toBeVisible();
    await act(async () => {
      lookup.resolve({
        vin: "1HGCM82633A004352",
        year: 2003,
        make: "Honda",
        model: "Accord",
        trim: "EX",
      });
      await lookup.promise;
    });

    await user.click(
      screen.getByRole("radio", { name: "Diminished Value" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Tell us about the vehicle",
      }),
    ).toBeVisible();
    expect(screen.getByLabelText("VIN")).toHaveValue("1HGCM82633A004352");
    expect(
      screen.queryByRole("heading", {
        name: "Describe the accident and repairs",
      }),
    ).not.toBeInTheDocument();
  });

  it("retains the local diminished-value draft across a service round-trip and requires auth before submission", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const decodeVin = vi.fn(async () => ({
      vin: "1HGCM82633A004352",
      year: 2020,
      make: "Honda",
      model: "Accord",
      trim: "EX",
    }));
    const diminishedValueDependencies = {
      vehicleLookupService: {
        decodeVin,
        listMakes: vi.fn(async () => []),
        listModels: vi.fn(async () => []),
      },
    } as unknown as DiminishedValueDependencies;

    renderTestApp(["/start?service=diminished-value&view=intake"], {
      diminishedValueDependencies,
    });

    await user.selectOptions(
      screen.getByLabelText("State where the accident occurred"),
      "IL",
    );
    await chooseAccidentDate(user);
    await user.selectOptions(
      screen.getByLabelText("Repair status"),
      "in-progress",
    );
    await user.click(
      withinIntakeFlow().getByRole("button", { name: "Continue" }),
    );

    await user.type(screen.getByLabelText("VIN"), "1hgcm82633a004352");
    await user.type(screen.getByLabelText("Mileage at the accident"), "48250");
    await user.type(screen.getByLabelText("Current mileage"), "49100");
    await user.click(
      screen.getByRole("button", { name: "Find vehicle & continue" }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Describe the accident and repairs",
      }),
    ).toBeVisible();
    expect(decodeVin).toHaveBeenCalledWith("1HGCM82633A004352");

    await user.click(
      within(
        screen.getByRole("group", { name: "Was another party at fault?" }),
      ).getByRole("radio", { name: "Yes" }),
    );
    await user.click(
      within(
        screen.getByRole("group", {
          name: "Was there structural or frame damage?",
        }),
      ).getByRole("radio", { name: "No" }),
    );
    await user.click(
      within(
        screen.getByRole("group", { name: "Did any airbags deploy?" }),
      ).getByRole("radio", { name: "Not sure" }),
    );
    await user.type(
      screen.getByLabelText("Major repair information"),
      "Front suspension and passenger-side body work.",
    );
    expect(
      screen.getByRole("button", { name: "Sign in to attach files" }),
    ).toBeVisible();

    await user.click(screen.getByRole("radio", { name: "Total Loss" }));
    expect(
      await screen.findByRole("heading", {
        name: "Start your total-loss appraisal",
      }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("radio", { name: "Diminished Value" }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Describe the accident and repairs",
      }),
    ).toBeVisible();
    expect(
      screen.getByText("January 2, 2020 · IL · Repairs are in progress"),
    ).toBeVisible();
    expect(screen.getByLabelText("Major repair information")).toHaveValue(
      "Front suspension and passenger-side body work.",
    );
    expect(
      within(
        screen.getByRole("group", { name: "Was another party at fault?" }),
      ).getByRole("radio", { name: "Yes" }),
    ).toBeChecked();

    await user.click(
      withinIntakeFlow().getByRole("button", { name: "Continue" }),
    );
    await user.type(screen.getByLabelText("Name"), "Ada Driver");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Phone"), "3125550123");
    await user.click(
      within(
        screen.getByRole("group", { name: "Preferred contact method" }),
      ).getByRole("radio", { name: /^Email/u }),
    );
    await user.type(
      screen.getByLabelText("General availability"),
      "Weekdays after 4 p.m. Central Time",
    );
    await user.click(
      screen.getByRole("button", { name: "Request a review" }),
    );

    expect(
      screen.getByRole("heading", { name: "Sign in to Venfour" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", {
        name: "Venfour received your review request",
      }),
    ).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.localStorage).toHaveLength(1);
  });
});
