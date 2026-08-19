import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import {
  IntakeDatePicker,
  IntakeProgress,
  IntakeRadioChoiceGroup,
  ServiceSelector,
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
      "border-brand",
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
});
