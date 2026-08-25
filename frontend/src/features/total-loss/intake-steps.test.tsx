import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import {
  ChoiceStep,
  ClaimStep,
  ContactStep,
  ReportStep,
  ReviewStep,
} from "@/features/total-loss/intake-steps";
import type {
  TotalLossContactFormValues,
  TotalLossManualFormValues,
} from "@/features/total-loss/types";

const manualValues: TotalLossManualFormValues = {
  vin: "1HGCM82633A004352",
  vehicleYear: "2023",
  make: "Honda",
  model: "Accord",
  trim: "EX-L",
  mileageAtLoss: "31250",
  zipCode: "60601",
  dateOfLoss: "2026-08-18",
  insurerName: "Example Insurance",
  insurerVehicleValuation: "",
  vehicleCondition: "Good",
  optionsPackages: "Technology package",
};

const contactValues: TotalLossContactFormValues = {
  firstName: "Example",
  lastName: "Customer",
  email: "a-very-long-local-testing-address@example.test",
  phoneNumber: "(312) 555-0182",
  termsAccepted: true,
  privacyAccepted: true,
  operationalFollowUpAllowed: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("total-loss intake step presentation", () => {
  it("keeps the simplified contact fields aligned separately from consent", () => {
    render(
      <MemoryRouter>
        <ContactStep
          mode="manual"
          values={contactValues}
          errors={{}}
          onChange={vi.fn()}
          onBack={vi.fn()}
          onContinue={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Your contact details" })).toBeVisible();
    const firstName = screen.getByLabelText("First name");
    const lastName = screen.getByLabelText("Last name");
    const email = screen.getByLabelText("Email address");
    const phone = screen.getByLabelText("Phone number");
    const fieldGrid = firstName.parentElement?.parentElement;
    expect(firstName).toHaveAttribute(
      "autocomplete",
      "given-name",
    );
    expect(lastName).toHaveAttribute(
      "autocomplete",
      "family-name",
    );
    expect(email).toHaveAttribute("type", "email");
    expect(phone).toHaveAttribute("type", "tel");
    expect(lastName.parentElement?.parentElement).toBe(fieldGrid);
    expect(email.parentElement?.parentElement).toBe(fieldGrid);
    expect(phone.parentElement?.parentElement).toBe(fieldGrid);
    expect(fieldGrid).toHaveClass("sm:grid-cols-2");
    expect(screen.getByText("Used to save your appraisal.")).toBeVisible();
    expect(screen.queryByText(/continue in this browser now/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Required fields help us/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Required unless marked optional")).not.toBeInTheDocument();
    expect(screen.getAllByText("Optional")).toHaveLength(2);
    expect(
      screen.getByRole("heading", { name: "Consent and preferences" }),
    ).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /Terms of Use/i })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /Privacy Policy/i })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /Case follow-up/i })).toBeVisible();
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Contact details" })).not.toBeInTheDocument();
  });

  it("keeps report choices and progress mounted while the selection changes", () => {
    const onSelect = vi.fn();
    const onContinue = vi.fn();
    const { rerender } = render(
      <ChoiceStep
        selectedMode="report"
        onSelect={onSelect}
        onContinue={onContinue}
      />,
    );
    const reportChoice = screen
      .getByRole("radio", { name: /I have my valuation report/i })
      .closest("label");
    const noReportChoice = screen
      .getByRole("radio", { name: /I don’t have the report/i })
      .closest("label");
    const progress = screen.getByRole("list", { name: "Appraisal steps" });
    const reportSegments = progress.querySelectorAll(
      "[data-intake-progress-segment]",
    );
    const sixthSegment = reportSegments[5];
    expect(reportSegments).toHaveLength(6);
    expect(sixthSegment).toHaveAttribute("data-visible", "true");
    expect(reportChoice?.parentElement).toHaveAttribute(
      "data-stable-selection-group",
    );

    rerender(
      <ChoiceStep
        selectedMode="manual"
        onSelect={onSelect}
        onContinue={onContinue}
      />,
    );

    expect(
      screen
        .getByRole("radio", { name: /I have my valuation report/i })
        .closest("label"),
    ).toBe(reportChoice);
    expect(
      screen
        .getByRole("radio", { name: /I don’t have the report/i })
        .closest("label"),
    ).toBe(noReportChoice);
    expect(screen.getByRole("list", { name: "Appraisal steps" })).toBe(
      progress,
    );
    const manualSegments = progress.querySelectorAll(
      "[data-intake-progress-segment]",
    );
    expect(manualSegments).toHaveLength(6);
    expect(manualSegments[5]).toBe(sixthSegment);
    expect(manualSegments[5]).toHaveAttribute("data-visible", "false");
    expect(manualSegments[5]).toHaveAttribute("aria-hidden", "true");
    expect(manualSegments[5]).toHaveStyle({ left: "100%", width: "0px" });
    expect(screen.getByLabelText("Start, step 1, current")).toBeVisible();
  });

  it("renumbers the no-report review as the fifth sequential step", () => {
    const { rerender } = render(
      <ReviewStep
        mode="manual"
        values={manualValues}
        contact={contactValues}
        onBack={vi.fn()}
        onEditVehicle={vi.fn()}
        onEditClaim={vi.fn()}
        onStartAnalysis={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Review, step 5, current")).toBeVisible();
    expect(screen.queryByLabelText("Review, step 6, current")).not.toBeInTheDocument();

    rerender(
      <ReviewStep
        mode="report"
        values={manualValues}
        contact={contactValues}
        onBack={vi.fn()}
        onEditVehicle={vi.fn()}
        onEditClaim={vi.fn()}
        onStartAnalysis={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Review, step 6, current")).toBeVisible();
  });

  it("asks only for the necessary claim and insurance facts", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const user = userEvent.setup();
    const { container } = render(
      <ClaimStep
        mode="manual"
        values={manualValues}
        errors={{}}
        onChange={vi.fn()}
        onBlur={vi.fn()}
        onBack={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Mileage at time of loss")).toBeVisible();
    expect(screen.getByLabelText("ZIP code")).toBeVisible();
    expect(screen.getByRole("button", { name: "Date of loss" })).toBeVisible();
    const mileageLabel = container.querySelector(
      'label[for="total-loss-mileage"]',
    );
    const zipLabel = container.querySelector('label[for="total-loss-zip"]');
    const dateLabel = container.querySelector('label[for="total-loss-date"]');
    expect(dateLabel?.parentElement?.className).toBe(
      mileageLabel?.parentElement?.className,
    );
    expect(dateLabel?.parentElement?.className).toBe(
      zipLabel?.parentElement?.className,
    );
    expect(screen.queryByLabelText("Pre-loss condition")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/options or packages/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", {
        name: "Prior branded/rebuilt/salvage title?",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Insurance information" })).toBeVisible();
    expect(screen.getByLabelText("Insurance company")).toBeVisible();
    expect(screen.getByLabelText("Insurer’s vehicle valuation")).toBeVisible();
    expect(
      screen.queryByText(
        "The value assigned to the vehicle before deductible, loan payoff, or other settlement adjustments.",
      ),
    ).not.toBeInTheDocument();

    const valuationTooltip = screen.getByRole("button", {
      name: "More information about Insurer’s vehicle valuation",
    });
    await user.hover(valuationTooltip);

    expect(
      await screen.findByRole("tooltip"),
    ).toHaveTextContent(
      "The value assigned to the vehicle before deductible, loan payoff, or other settlement adjustments.",
    );
  });

  it("shows the valuation explanation when the help icon receives keyboard focus", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const user = userEvent.setup();
    render(
      <ClaimStep
        mode="manual"
        values={{ ...manualValues, insurerName: "Progressive" }}
        errors={{}}
        onChange={vi.fn()}
        onBlur={vi.fn()}
        onBack={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();

    expect(
      screen.getByRole("button", {
        name: "More information about Insurer’s vehicle valuation",
      }),
    ).toHaveFocus();

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "The value assigned to the vehicle before deductible, loan payoff, or other settlement adjustments.",
    );
  });

  it("describes the shared report upload limit as a total", () => {
    render(
      <ReportStep
        storageAvailable
        uploadState="idle"
        extractionState="idle"
        onBack={vi.fn()}
        onFilesSelected={vi.fn()}
        onRetryUpload={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "PDF, JPG/JPEG, or PNG · 50 MiB total. Select image pages in order.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/50 MiB per file/u)).not.toBeInTheDocument();
  });

  it("uses vehicle-value language and keeps review cards overflow-safe", () => {
    render(
      <ReviewStep
        mode="manual"
        values={manualValues}
        contact={contactValues}
        onBack={vi.fn()}
        onEditVehicle={vi.fn()}
        onEditClaim={vi.fn()}
        onStartAnalysis={vi.fn()}
      />,
    );

    expect(screen.getByText("No insurer vehicle value supplied")).toBeVisible();
    expect(screen.queryByText("No insurer offer supplied")).not.toBeInTheDocument();

    for (const title of ["Vehicle", "Claim", "Evidence available", "Results access"]) {
      const panel = screen.getByRole("heading", { name: title }).closest("section");
      expect(panel).toHaveClass("min-w-0", "overflow-hidden");
      expect(panel?.lastElementChild).toHaveClass(
        "min-w-0",
        "break-words",
        "[overflow-wrap:anywhere]",
      );
    }
  });
});
