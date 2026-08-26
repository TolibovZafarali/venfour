import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import {
  IntakeDatePicker,
  IntakeProgress,
  IntakeRadioChoiceGroup,
  IntakeStepTransition,
  OTHER_VEHICLE_TRIM_OPTION,
  ServiceSelector,
  VehicleIdentificationFields,
  type VehicleTrimOption,
} from "@/features/intake";

describe("shared appraisal intake controls", () => {
  test("renders text-free four-step progress with accessible step names", () => {
    render(
      <IntakeProgress
        current={4}
        steps={[
          { label: "Start" },
          { label: "Vehicle" },
          { label: "Accident and repairs" },
          { label: "Consultation" },
        ]}
      />,
    );

    const currentStep = screen.getByLabelText("Consultation, step 4, current");
    expect(currentStep).toHaveAttribute("aria-current", "step");
    expect(currentStep).toHaveClass("border-brand", "bg-brand");
    expect(currentStep).toBeEmptyDOMElement();
    expect(screen.queryByText("Accident and repairs")).not.toBeInTheDocument();
  });

  test("keeps progress segments mounted while their layout morphs", () => {
    const { container, rerender } = render(
      <IntakeProgress current={1} total={2} label="Start" />,
    );
    const segments = container.querySelectorAll(
      "[data-intake-progress-segment]",
    );
    const firstSegment = segments[0];
    const thirdSegment = segments[2];
    const twoStepWidth = (firstSegment as HTMLElement).style.width;

    expect(segments).toHaveLength(3);
    expect(thirdSegment).toHaveAttribute("aria-hidden", "true");
    expect(thirdSegment).toHaveAttribute("data-visible", "false");
    expect(thirdSegment).toHaveStyle({ left: "100%", width: "0px" });

    rerender(<IntakeProgress current={1} total={3} label="Start" />);

    const expandedSegments = container.querySelectorAll(
      "[data-intake-progress-segment]",
    );
    expect(expandedSegments[0]).toBe(firstSegment);
    expect(expandedSegments[2]).toBe(thirdSegment);
    expect((expandedSegments[0] as HTMLElement).style.width).not.toBe(
      twoStepWidth,
    );
    expect(expandedSegments[0]).toHaveClass("border-brand", "bg-brand");
    expect(expandedSegments[2]).not.toHaveAttribute("aria-hidden");
    expect(expandedSegments[2]).toHaveAttribute("data-visible", "true");

    rerender(<IntakeProgress current={1} total={2} label="Start" />);

    const collapsedSegments = container.querySelectorAll(
      "[data-intake-progress-segment]",
    );
    expect(collapsedSegments[2]).toBe(thirdSegment);
    expect(collapsedSegments[2]).toHaveAttribute("aria-hidden", "true");
    expect(collapsedSegments[2]).toHaveStyle({ left: "100%", width: "0px" });
  });

  test("crossfades directional steps without a blank frame", () => {
    vi.useFakeTimers();
    const { container, rerender, unmount } = render(
      <IntakeStepTransition direction="forward" transitionKey="start">
        <div>
          <IntakeProgress current={1} total={3} />
          <p>Start step</p>
        </div>
      </IntakeStepTransition>,
    );

    try {
      expect(
        container.querySelector("[data-intake-transition-layer='outgoing']"),
      ).not.toBeInTheDocument();

      rerender(
        <IntakeStepTransition direction="forward" transitionKey="vehicle">
          <div>
            <IntakeProgress current={2} total={3} />
            <p>Vehicle step</p>
          </div>
        </IntakeStepTransition>,
      );

      const forwardOutgoing = container.querySelector(
        "[data-intake-transition-layer='outgoing']",
      );
      const forwardIncoming = container.querySelector(
        "[data-intake-transition-layer='incoming']",
      );
      expect(forwardOutgoing).toHaveTextContent("Start step");
      expect(forwardOutgoing).toHaveClass("intake-step-forward-exit");
      expect(forwardOutgoing).toHaveAttribute("aria-hidden", "true");
      expect(forwardOutgoing).toHaveAttribute("inert");
      expect(forwardIncoming).toHaveTextContent("Vehicle step");
      expect(forwardIncoming).toHaveClass("intake-step-forward-enter");
      expect(
        container.querySelectorAll("[aria-label='Appraisal steps']"),
      ).toHaveLength(2);

      act(() => vi.advanceTimersByTime(400));
      expect(screen.queryByText("Start step")).not.toBeInTheDocument();

      rerender(
        <IntakeStepTransition direction="backward" transitionKey="start">
          <div>
            <IntakeProgress current={1} total={3} />
            <p>Start step</p>
          </div>
        </IntakeStepTransition>,
      );

      expect(
        container.querySelector("[data-intake-transition-layer='outgoing']"),
      ).toHaveClass("intake-step-backward-exit");
      expect(
        container.querySelector("[data-intake-transition-layer='incoming']"),
      ).toHaveClass("intake-step-backward-enter");
    } finally {
      unmount();
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  test("uses keyboard-operable native service radios and reports changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ServiceSelector value="total-loss" onChange={onChange} />,
    );

    expect(
      screen.getByRole("group", { name: "Choose an appraisal service" }),
    ).toBeVisible();
    const totalLoss = screen.getByRole("radio", { name: "Total Loss" });
    expect(totalLoss).toBeChecked();
    expect(totalLoss.closest("label")).toHaveClass(
      "border-transparent",
      "bg-brand",
      "text-white",
    );

    const diminishedValue = screen.getByRole("radio", {
      name: "Diminished Value",
    });
    diminishedValue.focus();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith("diminished-value");
  });

  test("keeps the vehicle method panel mounted when its fields change", () => {
    const sharedProps = {
      idPrefix: "vehicle",
      values: {
        vin: "",
        vehicleYear: "",
        make: "",
        model: "",
        trim: "",
      },
      errors: {},
      yearOptions: ["2026"],
      makeOptions: [],
      modelOptions: [],
      makesState: "idle" as const,
      modelsState: "idle" as const,
      vinLookupState: "idle" as const,
      onEntryMethodChange: vi.fn(),
      onChange: vi.fn(),
      onRetryMakes: vi.fn(),
      onRetryModels: vi.fn(),
    };
    const { container, rerender } = render(
      <VehicleIdentificationFields {...sharedProps} entryMethod="vin" />,
    );
    const methodSwitch = container.querySelector(
      "[data-vehicle-method-switch]",
    );
    const methodPanel = container.querySelector(
      '[data-vehicle-method-panel="vin"]',
    );
    expect(methodSwitch).toHaveAttribute("data-stable-selection-group");

    rerender(
      <VehicleIdentificationFields {...sharedProps} entryMethod="details" />,
    );

    expect(container.querySelector("[data-vehicle-method-switch]")).toBe(
      methodSwitch,
    );
    expect(
      container.querySelector('[data-vehicle-method-panel="details"]'),
    ).toBe(methodPanel);
  });

  test("makes VIN length and lookup states clear without changing the field contract", () => {
    const sharedProps = {
      idPrefix: "vehicle",
      entryMethod: "vin" as const,
      values: {
        vin: "1HGCM8",
        vehicleYear: "",
        make: "",
        model: "",
        trim: "",
      },
      errors: {},
      yearOptions: ["2026"],
      makeOptions: [],
      modelOptions: [],
      makesState: "idle" as const,
      modelsState: "idle" as const,
      vinLookupState: "idle" as const,
      onEntryMethodChange: vi.fn(),
      onChange: vi.fn(),
      onRetryMakes: vi.fn(),
      onRetryModels: vi.fn(),
    };
    const { container, rerender } = render(
      <VehicleIdentificationFields {...sharedProps} />,
    );

    const vinInput = screen.getByLabelText("VIN");
    expect(screen.getByText("Enter your 17-character VIN")).toBeVisible();
    expect(vinInput).toHaveAttribute("maxlength", "17");
    expect(vinInput).toHaveAttribute("placeholder", "1HGCM82633A004352");
    expect(container.querySelector("[data-vin-character-count]")).toHaveTextContent(
      "6/17",
    );
    expect(container.querySelector("[data-vin-entry-state]")).toHaveAttribute(
      "data-vin-entry-state",
      "idle",
    );

    rerender(
      <VehicleIdentificationFields
        {...sharedProps}
        values={{ ...sharedProps.values, vin: "1HGCM82633A004352" }}
        vinLookupState="loading"
      />,
    );
    expect(screen.getByLabelText("VIN")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking your VIN…Matching the year, make, and model.",
    );
    expect(container.querySelector("[data-vin-entry-state]")).toHaveAttribute(
      "data-vin-entry-state",
      "loading",
    );

    rerender(
      <VehicleIdentificationFields
        {...sharedProps}
        values={{
          vin: "1HGCM82633A004352",
          vehicleYear: "2003",
          make: "Honda",
          model: "Accord",
          trim: "EX-V6",
        }}
        vinLookupState="success"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "VIN confirmedVehicle found: 2003 Honda Accord",
    );
    expect(container.querySelector("[data-vin-entry-state]")).toHaveAttribute(
      "data-vin-entry-state",
      "success",
    );

    rerender(
      <VehicleIdentificationFields
        {...sharedProps}
        vinLookupState="error"
        vinLookupMessage="We couldn’t identify a vehicle with that VIN."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "We couldn’t match this VINWe couldn’t identify a vehicle with that VIN.",
    );
    expect(screen.getByLabelText("VIN")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(container.querySelector("[data-vin-entry-state]")).toHaveAttribute(
      "data-vin-entry-state",
      "error",
    );
  });

  test("groups model and trim together without extra trim helper copy", () => {
    render(
      <VehicleIdentificationFields
        idPrefix="vehicle"
        entryMethod="details"
        values={{
          vin: "",
          vehicleYear: "2026",
          make: "Honda",
          model: "Accord",
          trim: "EX-L",
        }}
        yearOptions={["2026"]}
        makeOptions={["Honda"]}
        modelOptions={["Accord"]}
        trimOptions={[trimOption("ex-l", "EX-L")]}
        makesState="success"
        modelsState="success"
        trimsState="success"
        vinLookupState="idle"
        trimRequired
        onEntryMethodChange={vi.fn()}
        onChange={vi.fn()}
        onRetryMakes={vi.fn()}
        onRetryModels={vi.fn()}
      />,
    );

    const modelColumn = screen.getByLabelText("Model").parentElement
      ?.parentElement?.parentElement;
    const trimColumn = screen.getByLabelText("Trim").parentElement
      ?.parentElement?.parentElement;

    expect(modelColumn?.parentElement).toBe(trimColumn?.parentElement);
    expect(modelColumn).not.toHaveClass("sm:col-span-2");
    expect(trimColumn).not.toHaveClass("sm:col-span-2");
    expect(
      screen.queryByText("Select the exact trim or style for this vehicle."),
    ).not.toBeInTheDocument();
  });

  test("locks VIN-decoded vehicle details while keeping trim editable", () => {
    render(
      <VehicleIdentificationFields
        idPrefix="vehicle"
        entryMethod="vin"
        values={{
          vin: "1HGCM82633A004352",
          vehicleYear: "2003",
          make: "Honda",
          model: "Accord",
          trim: "EX-V6",
        }}
        yearOptions={["2003"]}
        makeOptions={["Honda"]}
        modelOptions={["Accord"]}
        trimOptions={[
          trimOption("ex-v6", "EX-V6"),
          trimOption("lx", "LX"),
        ]}
        makesState="success"
        modelsState="success"
        trimsState="success"
        vinLookupState="success"
        vinLookupMessage="Vehicle found: 2003 Honda Accord EX-V6"
        trimRequired
        onEntryMethodChange={vi.fn()}
        onChange={vi.fn()}
        onRetryMakes={vi.fn()}
        onRetryModels={vi.fn()}
      />,
    );

    const confirmedVehicle = screen.getByRole("region", {
      name: "Confirmed vehicle details",
    });
    expect(within(confirmedVehicle).getByText("2003")).toBeVisible();
    expect(within(confirmedVehicle).getByText("Honda")).toBeVisible();
    expect(within(confirmedVehicle).getByText("Accord")).toBeVisible();
    expect(
      within(confirmedVehicle).getByRole("combobox", { name: "Trim" }),
    ).toHaveValue("ex-v6");
    expect(
      within(confirmedVehicle).queryByRole("textbox", { name: "Year" }),
    ).not.toBeInTheDocument();
    expect(
      within(confirmedVehicle).queryByRole("textbox", { name: "Make" }),
    ).not.toBeInTheDocument();
    expect(
      within(confirmedVehicle).queryByRole("textbox", { name: "Model" }),
    ).not.toBeInTheDocument();
  });

  test("shows configuration labels and reports the selected full trim option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onTrimSelectionChange = vi.fn();
    const longRangeAwd = trimOption(
      "model-3-long-range-awd",
      "Long Range — AWD",
      {
        trim: "Long Range AWD",
        queryField: "version",
        queryValues: ["Long Range", "Long Range Battery"],
      },
    );
    render(
      <VehicleIdentificationFields
        idPrefix="vehicle"
        entryMethod="details"
        values={{
          vin: "",
          vehicleYear: "2019",
          make: "Tesla",
          model: "Model 3",
          trim: "",
        }}
        yearOptions={["2019"]}
        makeOptions={["Tesla"]}
        modelOptions={["Model 3"]}
        trimOptions={[
          trimOption("model-3-long-range-rwd", "Long Range — RWD"),
          longRangeAwd,
        ]}
        makesState="success"
        modelsState="success"
        trimsState="success"
        vinLookupState="idle"
        trimRequired
        onEntryMethodChange={vi.fn()}
        onChange={onChange}
        onTrimSelectionChange={onTrimSelectionChange}
        onRetryMakes={vi.fn()}
        onRetryModels={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Trim" });
    expect(
      screen.getByRole("option", { name: "Long Range — RWD" }),
    ).toBeVisible();
    expect(
      screen.getByRole("option", { name: "Long Range — AWD" }),
    ).toBeVisible();

    await user.selectOptions(select, longRangeAwd.id);

    expect(onTrimSelectionChange).toHaveBeenCalledWith(longRangeAwd);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("falls back to the canonical trim and preserves ambiguous legacy values", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const sharedProps = {
      idPrefix: "vehicle",
      entryMethod: "details" as const,
      yearOptions: ["2019"],
      makeOptions: ["Tesla"],
      modelOptions: ["Model 3"],
      makesState: "success" as const,
      modelsState: "success" as const,
      trimsState: "success" as const,
      vinLookupState: "idle" as const,
      trimRequired: true,
      onEntryMethodChange: vi.fn(),
      onChange,
      onRetryMakes: vi.fn(),
      onRetryModels: vi.fn(),
    };
    const longRangeRwd = trimOption(
      "model-3-long-range-rwd",
      "Long Range",
      { trim: "Long Range RWD" },
    );
    const longRangeAwd = trimOption(
      "model-3-long-range-awd",
      "Long Range — AWD",
      { trim: "Long Range", queryValues: ["Long Range Battery"] },
    );
    const { rerender } = render(
      <VehicleIdentificationFields
        {...sharedProps}
        values={{
          vin: "",
          vehicleYear: "2019",
          make: "Tesla",
          model: "Model 3",
          trim: "Long Range",
        }}
        trimOptions={[longRangeRwd, longRangeAwd]}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Trim" });
    expect(select).toHaveValue("__legacy-current-trim__");
    expect(
      screen.getByRole("option", { name: "Current selection: Long Range" }),
    ).toBeVisible();
    expect(screen.getAllByRole("option", { name: "Long Range" })).toHaveLength(
      1,
    );

    await user.selectOptions(select, longRangeAwd.id);
    expect(onChange).toHaveBeenCalledWith("trim", "Long Range");

    rerender(
      <VehicleIdentificationFields
        {...sharedProps}
        values={{
          vin: "",
          vehicleYear: "2019",
          make: "Tesla",
          model: "Model 3",
          trim: "Legacy Performance",
        }}
        trimOptions={[longRangeRwd, longRangeAwd]}
      />,
    );
    expect(
      screen.getByRole("option", { name: "Legacy Performance" }),
    ).toBeVisible();
  });

  test("requires a stale provider identity to be explicitly reselected", async () => {
    const user = userEvent.setup();
    const onTrimSelectionChange = vi.fn();
    const longRange = trimOption("model-3-long-range", "Long Range", {
      queryField: "version",
      queryValues: ["Long Range", "Long Range Battery"],
    });
    render(
      <VehicleIdentificationFields
        idPrefix="vehicle"
        entryMethod="details"
        values={{
          vin: "",
          vehicleYear: "2019",
          make: "Tesla",
          model: "Model 3",
          trim: "Long Range",
        }}
        vehicleConfiguration={{
          source: "marketcheck",
          field: "version",
          values: ["Retired Long Range Alias"],
        }}
        yearOptions={["2019"]}
        makeOptions={["Tesla"]}
        modelOptions={["Model 3"]}
        trimOptions={[longRange]}
        makesState="success"
        modelsState="success"
        trimsState="success"
        vinLookupState="idle"
        trimRequired
        onEntryMethodChange={vi.fn()}
        onChange={vi.fn()}
        onTrimSelectionChange={onTrimSelectionChange}
        onRetryMakes={vi.fn()}
        onRetryModels={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Trim" });
    expect(select).toHaveValue("__legacy-current-trim__");
    expect(
      screen.getByRole("option", { name: "Current selection: Long Range" }),
    ).toBeVisible();

    await user.selectOptions(select, longRange.id);
    expect(onTrimSelectionChange).toHaveBeenCalledWith(longRange);
  });

  test("keeps Other / Not sure enabled when exact trims fail to load", async () => {
    const user = userEvent.setup();
    const onTrimSelectionChange = vi.fn();
    render(
      <VehicleIdentificationFields
        idPrefix="vehicle"
        entryMethod="details"
        values={{
          vin: "",
          vehicleYear: "2024",
          make: "Honda",
          model: "Accord",
          trim: "",
        }}
        yearOptions={["2024"]}
        makeOptions={["Honda"]}
        modelOptions={["Accord"]}
        trimOptions={[OTHER_VEHICLE_TRIM_OPTION]}
        makesState="success"
        modelsState="success"
        trimsState="error"
        vinLookupState="idle"
        trimRequired
        onEntryMethodChange={vi.fn()}
        onChange={vi.fn()}
        onTrimSelectionChange={onTrimSelectionChange}
        onRetryMakes={vi.fn()}
        onRetryModels={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Trim" });
    expect(select).toBeEnabled();
    expect(screen.getByText(/Choose Other \/ Not sure/u)).toBeVisible();
    await user.selectOptions(select, OTHER_VEHICLE_TRIM_OPTION.id);
    expect(onTrimSelectionChange).toHaveBeenCalledWith(
      OTHER_VEHICLE_TRIM_OPTION,
    );
  });

  test("supports a service-specific calendar label", async () => {
    const user = userEvent.setup();
    render(
      <IntakeDatePicker
        id="accident-date"
        label="Accident date"
        calendarLabel="Choose accident date"
        value=""
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Accident date" }));
    expect(
      screen.getByRole("grid", { name: "Choose accident date" }),
    ).toBeVisible();
  });

  test("associates a radio-choice validation error with each option", () => {
    render(
      <IntakeRadioChoiceGroup
        id="fault"
        legend="Was another party at fault?"
        value=""
        error="Choose an answer."
        options={[
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
          { value: "not-sure", label: "Not sure" },
        ]}
        onChange={vi.fn()}
      />,
    );

    for (const label of ["Yes", "No", "Not sure"]) {
      const option = screen.getByRole("radio", { name: label });
      expect(option).toHaveAttribute("aria-invalid", "true");
      expect(option).toHaveAccessibleDescription("Choose an answer.");
    }
  });

  test("uses a soft fill and neutral border for selected choices", () => {
    render(
      <IntakeRadioChoiceGroup
        id="ownership"
        legend="Do you own the vehicle?"
        value="yes"
        options={[
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]}
        onChange={vi.fn()}
      />,
    );

    const selectedLabel = screen
      .getByRole("radio", { name: "Yes" })
      .closest("label");
    expect(selectedLabel).toHaveClass("border-line", "bg-brand-soft/55");
    expect(selectedLabel).not.toHaveClass(
      "shadow-[inset_0_0_0_1px_var(--brand)]",
    );
  });
});

function trimOption(
  id: string,
  label: string,
  overrides: Partial<Omit<VehicleTrimOption, "id" | "label">> = {},
): VehicleTrimOption {
  return {
    source: "marketcheck",
    id,
    label,
    trim: label,
    queryField: "trim",
    queryValues: [label],
    ...overrides,
  };
}
