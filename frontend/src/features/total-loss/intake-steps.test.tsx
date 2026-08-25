import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import {
  ChoiceStep,
  ClaimStep,
  ContactStep,
  ReportUploadStep,
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

    expect(screen.getByRole("heading", { name: "Contact details" })).toBeVisible();
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
    expect(screen.queryByRole("heading", { name: "Your contact details" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review & analyze" })).toBeVisible();
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
    const fourthSegment = reportSegments[3];
    expect(reportSegments).toHaveLength(4);
    expect(fourthSegment).toHaveAttribute("data-visible", "false");
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
    expect(manualSegments).toHaveLength(4);
    expect(manualSegments[3]).toBe(fourthSegment);
    expect(manualSegments[3]).toHaveAttribute("data-visible", "true");
    expect(manualSegments[3]).not.toHaveAttribute("aria-hidden");
    expect(screen.getByLabelText("Start, step 1, current")).toBeVisible();
  });

  it("asks report customers for the market ZIP on the upload step", () => {
    const { rerender } = render(
      <MemoryRouter>
        <ReportUploadStep
          storageAvailable
          marketZipCode="60601"
          marketZipCodeError="Check this ZIP code."
          uploadState="idle"
          onMarketZipCodeChange={vi.fn()}
          onMarketZipCodeBlur={vi.fn()}
          onBack={vi.fn()}
          onFilesSelected={vi.fn()}
          onRetryUpload={vi.fn()}
          onContinue={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Market ZIP code")).toHaveValue("60601");
    expect(screen.getByText("Used to find comparable vehicles near you.")).toBeVisible();
    expect(screen.getByText("Check this ZIP code.")).toBeVisible();
    expect(screen.getByLabelText("Valuation report, step 2, current")).toBeVisible();

    rerender(
      <MemoryRouter>
        <ContactStep
          mode="report"
          values={contactValues}
          errors={{}}
          onChange={vi.fn()}
          onBack={vi.fn()}
          onContinue={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByLabelText("Market ZIP code")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Contact, step 3, current")).toBeVisible();
    expect(screen.queryByText(/review your details/i)).not.toBeInTheDocument();
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

  it("describes the private upload limit and defers report analysis", () => {
    render(
      <ReportUploadStep
        storageAvailable
        marketZipCode=""
        uploadState="idle"
        onMarketZipCodeChange={vi.fn()}
        onMarketZipCodeBlur={vi.fn()}
        onBack={vi.fn()}
        onFilesSelected={vi.fn()}
        onRetryUpload={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "Add your market ZIP and securely attach the report to your private appraisal. Venfour won’t read or analyze it until after your contact details are saved.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Private, owner-only storage · PDF, JPG, or PNG · 50 MiB total",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/reading report/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/extracting vehicle/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/review extracted details/i)).not.toBeInTheDocument();
  });

  it("shows only secure upload progress while the file is being saved", () => {
    render(
      <ReportUploadStep
        storageAvailable
        marketZipCode="60611"
        selectedFilename="insurer-valuation.pdf"
        uploadState="uploading"
        onMarketZipCodeChange={vi.fn()}
        onMarketZipCodeBlur={vi.fn()}
        onBack={vi.fn()}
        onFilesSelected={vi.fn()}
        onRetryUpload={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByText("Uploading securely")).toBeVisible();
    expect(screen.getByText("insurer-valuation.pdf")).toBeVisible();
    expect(
      screen.getByText(
        "Keep this page open while Venfour finishes saving the file.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Continue to contact" })).not.toBeInTheDocument();
    expect(screen.queryByText(/ready for review/i)).not.toBeInTheDocument();
  });

  it("continues directly to contact after a report is securely attached", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();

    render(
      <ReportUploadStep
        storageAvailable
        marketZipCode="60611"
        savedFilename="insurer-valuation.pdf"
        uploadState="success"
        onMarketZipCodeChange={vi.fn()}
        onMarketZipCodeBlur={vi.fn()}
        onBack={vi.fn()}
        onFilesSelected={vi.fn()}
        onRetryUpload={vi.fn()}
        onContinue={onContinue}
      />,
    );

    expect(screen.getByText("Report securely attached")).toBeVisible();
    expect(
      screen.getByText(
        "Next, add your contact details. The report will be reviewed during analysis.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Replace report" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Continue to contact" }));

    expect(onContinue).toHaveBeenCalledOnce();
    expect(screen.queryByText(/review your details/i)).not.toBeInTheDocument();
  });

  it("offers a focused retry when secure upload fails", async () => {
    const user = userEvent.setup();
    const onRetryUpload = vi.fn();

    render(
      <ReportUploadStep
        storageAvailable
        marketZipCode="60611"
        selectedFilename="insurer-valuation.pdf"
        uploadState="error"
        uploadError="The report could not be saved."
        onMarketZipCodeChange={vi.fn()}
        onMarketZipCodeBlur={vi.fn()}
        onBack={vi.fn()}
        onFilesSelected={vi.fn()}
        onRetryUpload={onRetryUpload}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The report could not be saved.",
    );
    expect(screen.queryByRole("button", { name: "Continue to contact" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try upload again" }));

    expect(onRetryUpload).toHaveBeenCalledOnce();
  });
});
