import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ChoiceStep,
  ClaimStep,
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
  fullName: "Example Customer",
  email: "a-very-long-local-testing-address@example.test",
  termsAccepted: true,
  privacyAccepted: true,
  operationalFollowUpAllowed: false,
};

describe("total-loss intake step presentation", () => {
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

  it("asks only for the necessary claim and insurance facts", () => {
    render(
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
