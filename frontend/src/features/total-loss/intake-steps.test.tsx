import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
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
