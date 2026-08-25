import { render, screen, within } from "@testing-library/react";
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

const reportProcessingLabels = [
  "Uploading",
  "Reading report",
  "Extracting vehicle and valuation details",
  "Ready for review",
] as const;

function expectReportProcessingStatuses(expected: readonly string[]) {
  const progress = screen.getByRole("list", {
    name: "Report processing progress",
  });
  const stages = Array.from(
    progress.querySelectorAll<HTMLElement>("[data-report-processing-status]"),
  );

  expect(stages).toHaveLength(4);
  expect(expected).toHaveLength(4);
  stages.forEach((stage, index) => {
    expect(
      within(stage).getByText(reportProcessingLabels[index]),
    ).toBeVisible();
    expect(stage).toHaveAttribute(
      "data-report-processing-status",
      expected[index],
    );
    expect(stage).toHaveAttribute(
      "data-report-processing-step",
      String(index + 1),
    );
  });
}

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

  it("offers explicit recovery actions when secure report storage is unavailable", async () => {
    const user = userEvent.setup();
    const onRetryStorage = vi.fn();
    render(
      <MemoryRouter>
        <ReportStep
          storageAvailable={false}
          uploadState="idle"
          extractionState="idle"
          hideBack
          onRetryStorage={onRetryStorage}
          onBack={vi.fn()}
          onFilesSelected={vi.fn()}
          onRetryUpload={vi.fn()}
          onContinue={vi.fn()}
        />
      </MemoryRouter>,
    );

    await user.click(
      screen.getByRole("button", { name: "Retry secure storage" }),
    );
    expect(onRetryStorage).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Return home" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("presents upload as the first of exactly four report-processing stages", () => {
    render(
      <ReportStep
        storageAvailable
        selectedFilename="insurer-valuation.pdf"
        uploadState="uploading"
        extractionState="idle"
        onBack={vi.fn()}
        onFilesSelected={vi.fn()}
        onRetryUpload={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByText("Uploading your report securely")).toBeVisible();
    expect(screen.getByText("Uploading securely")).toBeVisible();
    expect(screen.getByText("insurer-valuation.pdf")).toBeVisible();
    expect(
      screen.getByText(
        "Nothing else is needed right now. Reading begins automatically after the upload is confirmed.",
      ),
    ).toBeVisible();
    expectReportProcessingStatuses(["active", "pending", "pending", "pending"]);
    expect(
      screen.queryByRole("button", { name: "Review extracted details" }),
    ).not.toBeInTheDocument();
  });

  it("confirms the upload and keeps replacement secondary while report extraction is processing", () => {
    render(
      <ReportStep
        storageAvailable
        savedFilename="insurer-valuation.pdf"
        uploadState="success"
        extractionState="processing"
        onBack={vi.fn()}
        onFilesSelected={vi.fn()}
        onRetryUpload={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByText("Report uploaded successfully")).toBeVisible();
    expect(screen.getByText("Venfour is reading your report")).toBeVisible();
    expect(
      screen.getByText(
        "You don’t need to do anything while we work. We’ll make the review button available when your details are ready.",
      ),
    ).toBeVisible();
    expectReportProcessingStatuses(["complete", "active", "active", "pending"]);

    const replaceReport = screen.getByRole("button", {
      name: "Replace report",
    });
    expect(replaceReport).toBeVisible();
    expect(replaceReport).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Review extracted details" }),
    ).not.toBeInTheDocument();
  });

  it("truthfully presents a replacement queued behind the current read", () => {
    render(
      <ReportStep
        storageAvailable
        selectedFilename="replacement.pdf"
        savedFilename="insurer-valuation.pdf"
        uploadState="queued"
        extractionState="processing"
        onBack={vi.fn()}
        onFilesSelected={vi.fn()}
        onRetryUpload={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByText("Replacement selected")).toBeVisible();
    expect(screen.getByText("We’ll replace your report next")).toBeVisible();
    expect(
      screen.getByText(
        "You don’t need to do anything. Keep this page open and the replacement will upload automatically when the current read finishes.",
      ),
    ).toBeVisible();
    expectReportProcessingStatuses(["waiting", "pending", "pending", "pending"]);
    expect(
      screen.getByText("Waiting for the current report read to finish"),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Review extracted details" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("We’ll replace your report next").closest("[data-flow-card]"),
    ).not.toHaveAttribute("aria-busy");
  });

  it("does not leak stale ready details while a replacement is uploading", () => {
    render(
      <ReportStep
        storageAvailable
        selectedFilename="replacement.pdf"
        savedFilename="insurer-valuation.pdf"
        uploadState="uploading"
        extractionState="partial"
        extractionWarnings={["Old report warning"]}
        onBack={vi.fn()}
        onFilesSelected={vi.fn()}
        onRetryUpload={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByText("Uploading your replacement report")).toBeVisible();
    expect(screen.queryByText("Your details are ready to review")).not.toBeInTheDocument();
    expect(screen.queryByText("Items to confirm")).not.toBeInTheDocument();
    expect(screen.queryByText("Old report warning")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Review extracted details" }),
    ).not.toBeInTheDocument();
  });

  it.each(["partial", "complete"] as const)(
    "makes review available only after %s extraction reaches readiness",
    (extractionState) => {
      render(
        <ReportStep
          storageAvailable
          savedFilename="insurer-valuation.pdf"
          uploadState="success"
          extractionState={extractionState}
          reportProvider="CCC"
          extractionWarnings={
            extractionState === "partial"
              ? ["Confirm the trim before continuing."]
              : []
          }
          onBack={vi.fn()}
          onFilesSelected={vi.fn()}
          onRetryUpload={vi.fn()}
          onContinue={vi.fn()}
        />,
      );

      expect(
        screen.getByText("Your details are ready to review"),
      ).toBeVisible();
      expectReportProcessingStatuses([
        "complete",
        "complete",
        "complete",
        "complete",
      ]);
      expect(
        screen.getByRole("button", { name: "Review extracted details" }),
      ).toBeEnabled();
      expect(
        screen.getByRole("button", { name: "Replace report" }),
      ).toBeEnabled();

      if (extractionState === "partial") {
        expect(screen.getByText("Items to confirm")).toBeVisible();
        expect(
          screen.getByText("Confirm the trim before continuing."),
        ).toBeVisible();
      }
    },
  );

  it("keeps the uploaded report and offers a truthful manual fallback after extraction fails", () => {
    render(
      <ReportStep
        storageAvailable
        savedFilename="insurer-valuation.pdf"
        uploadState="success"
        extractionState="error"
        onBack={vi.fn()}
        onFilesSelected={vi.fn()}
        onRetryUpload={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByText("Your report is safely uploaded")).toBeVisible();
    expect(
      screen.getByText(
        "You won’t need to upload the report again. It will remain attached to this appraisal.",
      ),
    ).toBeVisible();
    expectReportProcessingStatuses([
      "complete",
      "attention",
      "pending",
      "pending",
    ]);
    expect(
      screen.queryByRole("button", { name: "Review extracted details" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue with manual details" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Replace report" }),
    ).toBeEnabled();
  });

  it("does not offer a manual fallback when the report itself was not saved", () => {
    render(
      <ReportStep
        storageAvailable
        selectedFilename="insurer-valuation.pdf"
        uploadState="error"
        extractionState="error"
        uploadError="The report could not be saved."
        onBack={vi.fn()}
        onFilesSelected={vi.fn()}
        onRetryUpload={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The report could not be saved.",
    );
    expect(
      screen.queryByRole("button", { name: "Continue with manual details" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Review extracted details" }),
    ).not.toBeInTheDocument();
    const errorActions = within(screen.getByRole("alert")).getAllByRole(
      "button",
    );
    expect(errorActions.map((action) => action.textContent)).toEqual([
      "Try again",
      "Choose another report",
    ]);
    expect(errorActions[0]).toHaveClass("bg-brand", "report-action-focus");
    expect(errorActions[1]).toHaveClass("border-line", "report-action-focus");
    expect(
      screen.queryByRole("button", { name: "Choose report" }),
    ).not.toBeInTheDocument();
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
