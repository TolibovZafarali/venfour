import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { VehicleLookupError } from "@/features/total-loss/vehicle-lookup-service";
import type { VehicleLookupService } from "@/features/total-loss/vehicle-lookup-service";

import { DiminishedValueIntakeFlow } from "./diminished-value-intake-flow";
import {
  createEmptyDiminishedValueDraft,
  type DiminishedValueDraft,
} from "./types";

describe("DiminishedValueIntakeFlow", () => {
  it("validates each Continue action and focuses the first invalid control", async () => {
    const user = userEvent.setup();
    render(
      <FlowHarness
        initialDraft={createEmptyDiminishedValueDraft()}
        vehicleLookupService={vehicleService()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByLabelText("State where the accident occurred")).toHaveFocus();
    expect(screen.getByText("State is required.")).toHaveAttribute(
      "role",
      "alert",
    );
  });

  it("completes the four-step manual path while retaining answers and local files", async () => {
    const user = userEvent.setup();
    const service = vehicleService();
    render(
      <FlowHarness
        initialDraft={{
          ...createEmptyDiminishedValueDraft(),
          accidentState: "IL",
          accidentDate: "2026-08-01",
          repairStatus: "complete",
        }}
        vehicleLookupService={service}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Continue" }));
    const vehicleHeading = screen.getByRole("heading", {
      name: "Tell us about the vehicle",
    });
    expect(vehicleHeading).toBeInTheDocument();
    await waitFor(() => expect(vehicleHeading).toHaveFocus());

    await user.click(
      screen.getByRole("radio", { name: "Select vehicle details" }),
    );
    await screen.findByRole("option", { name: "Honda" });
    await user.selectOptions(screen.getByLabelText("Year"), "2024");
    await user.selectOptions(screen.getByLabelText("Make"), "Honda");
    await screen.findByRole("option", { name: "Accord" });
    await user.selectOptions(screen.getByLabelText("Model"), "Accord");
    await user.type(screen.getByLabelText("Mileage at the accident"), "48250");
    await user.type(screen.getByLabelText("Current mileage"), "49100");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText(/August 1, 2026 · IL/)).toBeInTheDocument();
    await chooseRadio(user, "Was another party at fault?", "Yes");
    await chooseRadio(
      user,
      "Was there structural or frame damage?",
      "No",
    );
    await chooseRadio(user, "Did any airbags deploy?", "Not sure");
    await user.type(
      screen.getByLabelText("At-fault party’s insurance company"),
      "Example Mutual",
    );

    const estimate = new File(["estimate"], "estimate.pdf", {
      type: "application/pdf",
      lastModified: 10,
    });
    const photo = new File(["photo"], "damage.jpg", {
      type: "image/jpeg",
      lastModified: 20,
    });
    await user.upload(screen.getByLabelText("Choose files"), [estimate, photo]);
    expect(screen.getByText("estimate.pdf")).toBeInTheDocument();
    expect(screen.getByText("damage.jpg")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Remove damage.jpg" }),
    );
    expect(screen.queryByText("damage.jpg")).not.toBeInTheDocument();
    expect(
      screen.getByText(/They have not been uploaded or sent to Venfour/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(screen.getByLabelText("Name"), "Jordan Lee");
    await user.type(screen.getByLabelText("Email"), "jordan@example.com");
    await user.type(screen.getByLabelText("Phone"), "312-555-0123");
    await chooseRadio(user, "Preferred contact method", "Email");
    await user.type(
      screen.getByLabelText("General availability"),
      "Weekdays after 4 p.m. Central Time",
    );

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByLabelText("At-fault party’s insurance company"),
    ).toHaveValue("Example Mutual");
    expect(screen.getByText("estimate.pdf")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Jordan Lee");

    await user.click(screen.getByRole("button", { name: "Request a review" }));
    const completionHeading = screen.getByRole("heading", {
      name: "Your review request is prepared",
    });
    expect(completionHeading).toBeInTheDocument();
    await waitFor(() => expect(completionHeading).toHaveFocus());
    expect(screen.getByText("Nothing was sent")).toBeInTheDocument();
    expect(
      screen.getByText(/no appointment or consultation has been confirmed/),
    ).toBeInTheDocument();
    expect(service.decodeVin).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Edit contact details" }),
    );
    expect(screen.getByLabelText("Email")).toHaveValue("jordan@example.com");
  });

  it("offers retry and guided entry after an NHTSA VIN lookup failure", async () => {
    const user = userEvent.setup();
    const service = vehicleService();
    vi.mocked(service.decodeVin)
      .mockRejectedValueOnce(
        new VehicleLookupError(
          "service-unavailable",
          "Vehicle lookup is temporarily unavailable. Try again.",
        ),
      )
      .mockResolvedValueOnce({
        vin: "1HGCM82633A004352",
        year: 2003,
        make: "HONDA",
        model: "Accord",
        trim: "EX",
      });
    render(
      <FlowHarness
        initialDraft={{
          ...createEmptyDiminishedValueDraft(),
          step: "vehicle",
          vin: "1HGCM82633A004352",
          mileageAtAccident: "48250",
        }}
        vehicleLookupService={service}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Find vehicle & continue" }),
    );
    expect(
      await screen.findByText(
        "Vehicle lookup is temporarily unavailable. Try again.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Select vehicle details instead" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Find vehicle & continue" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: "Describe the accident and repairs",
        }),
      ).toBeInTheDocument(),
    );
    expect(service.decodeVin).toHaveBeenCalledTimes(2);
  });

  it("returns directly to repairs after editing the accident summary", async () => {
    const user = userEvent.setup();
    render(
      <FlowHarness
        initialDraft={{
          ...createEmptyDiminishedValueDraft(),
          step: "accident-repairs",
          accidentState: "IL",
          accidentDate: "2026-08-01",
          repairStatus: "complete",
        }}
        vehicleLookupService={vehicleService()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Edit accident details" }),
    );
    await user.selectOptions(
      screen.getByLabelText("Repair status"),
      "in-progress",
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      screen.getByRole("heading", {
        name: "Describe the accident and repairs",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Repairs are in progress/)).toBeInTheDocument();
  });
});

function FlowHarness({
  initialDraft,
  vehicleLookupService,
}: {
  readonly initialDraft: DiminishedValueDraft;
  readonly vehicleLookupService: VehicleLookupService;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [files, setFiles] = useState<File[]>([]);
  return (
    <DiminishedValueIntakeFlow
      draft={draft}
      onDraftChange={setDraft}
      selectedFiles={files}
      onSelectedFilesChange={setFiles}
      vehicleLookupService={vehicleLookupService}
    />
  );
}

function vehicleService(): VehicleLookupService {
  return {
    decodeVin: vi.fn(async () => ({
      vin: "1HGCM82633A004352",
      year: 2003,
      make: "HONDA",
      model: "Accord",
      trim: "EX",
    })),
    listMakes: vi.fn(async () => ["Honda"]),
    listModels: vi.fn(async () => ["Accord"]),
  };
}

async function chooseRadio(
  user: ReturnType<typeof userEvent.setup>,
  groupName: string,
  optionName: string,
) {
  const group = screen.getByRole("group", { name: groupName });
  const accessibleName =
    optionName === "Email" || optionName === "Phone call"
      ? new RegExp(`^${escapeRegExp(optionName)}`, "u")
      : new RegExp(`^${escapeRegExp(optionName)}$`, "u");
  await user.click(
    within(group).getByRole("radio", {
      name: accessibleName,
    }),
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
