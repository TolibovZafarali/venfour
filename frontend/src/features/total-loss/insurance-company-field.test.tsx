import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InsuranceCompanyField } from "@/features/total-loss/insurance-company-field";

function InsuranceCompanyHarness({
  initialValue = "",
  error,
}: {
  readonly initialValue?: string;
  readonly error?: string;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <>
      <InsuranceCompanyField
        id="insurance-company"
        value={value}
        error={error}
        onChange={setValue}
        onBlur={vi.fn()}
      />
      <output data-testid="insurer-value">{value}</output>
    </>
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InsuranceCompanyField", () => {
  it("filters common insurers and stores the selected company name", async () => {
    const user = userEvent.setup();
    render(<InsuranceCompanyHarness />);

    const combobox = screen.getByRole("combobox", {
      name: "Insurance company",
    });
    await user.click(combobox);
    await user.type(combobox, "prog");

    expect(
      screen.getByRole("option", { name: "Progressive" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("option", { name: "State Farm" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Other / Not listed" }),
    ).toBeVisible();

    await user.click(screen.getByRole("option", { name: "Progressive" }));

    expect(combobox).toHaveValue("Progressive");
    expect(screen.getByTestId("insurer-value")).toHaveTextContent(
      "Progressive",
    );
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.click(combobox);
    expect(screen.getByRole("listbox", { name: "Insurance companies" })).toBeVisible();
  });

  it("reveals a manual field only after Other / Not listed is selected", async () => {
    const user = userEvent.setup();
    render(<InsuranceCompanyHarness />);

    expect(
      screen.queryByLabelText("Insurance company name"),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("combobox", { name: "Insurance company" }),
    );
    await user.click(
      screen.getByRole("option", { name: "Other / Not listed" }),
    );

    const manualField = screen.getByLabelText("Insurance company name");
    expect(manualField).toHaveFocus();
    await user.type(manualField, "Regional Mutual");

    expect(screen.getByTestId("insurer-value")).toHaveTextContent(
      "Regional Mutual",
    );
  });

  it("supports selecting a filtered insurer with the keyboard", async () => {
    const user = userEvent.setup();
    render(<InsuranceCompanyHarness />);

    const combobox = screen.getByRole("combobox", {
      name: "Insurance company",
    });
    await user.click(combobox);
    await user.type(combobox, "gei");
    await user.keyboard("{Enter}");

    expect(combobox).toHaveValue("GEICO");
    expect(screen.getByTestId("insurer-value")).toHaveTextContent("GEICO");
  });

  it("preserves an existing unlisted insurer as a manual value", () => {
    render(<InsuranceCompanyHarness initialValue="Example Insurance" />);

    expect(
      screen.getByRole("combobox", { name: "Insurance company" }),
    ).toHaveValue("Other / Not listed");
    expect(screen.getByLabelText("Insurance company name")).toHaveValue(
      "Example Insurance",
    );
  });

  it("moves required validation to the manual field for an unlisted insurer", async () => {
    const user = userEvent.setup();
    render(<InsuranceCompanyHarness error="Insurance company is required." />);

    const combobox = screen.getByRole("combobox", {
      name: "Insurance company",
    });
    expect(combobox).toHaveAccessibleDescription(
      "Insurance company is required.",
    );

    await user.click(combobox);
    await user.click(
      screen.getByRole("option", { name: "Other / Not listed" }),
    );

    expect(combobox).not.toHaveAccessibleDescription();
    expect(screen.getByLabelText("Insurance company name")).toHaveAccessibleDescription(
      "Insurance company is required.",
    );
  });
});
