import { act, render, screen, waitFor, within } from "@testing-library/react";
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

    expect(
      screen.getByLabelText("State where the accident occurred"),
    ).toHaveFocus();
    expect(screen.getByText("State is required.")).toHaveAttribute(
      "role",
      "alert",
    );
  });

  it("submits the four-step manual path and renders only confirmed completion", async () => {
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
    await chooseRadio(user, "Was there structural or frame damage?", "No");
    await chooseRadio(user, "Did any airbags deploy?", "Not sure");
    await user.type(
      screen.getByLabelText("At-fault party’s insurance company"),
      "Example Mutual",
    );

    const estimate = new File(["%PDF-1.7\n"], "estimate.pdf", {
      type: "application/pdf",
      lastModified: 10,
    });
    const photo = new File(
      [new Uint8Array([0xff, 0xd8, 0xff, 0x00])],
      "damage.jpg",
      {
        type: "image/jpeg",
        lastModified: 20,
      },
    );
    await user.upload(screen.getByLabelText("Choose files"), [estimate, photo]);
    expect(await screen.findByText("estimate.pdf")).toBeInTheDocument();
    expect(await screen.findByText("damage.jpg")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove damage.jpg" }));
    expect(screen.queryByText("damage.jpg")).not.toBeInTheDocument();
    expect(screen.getByText(/awaiting secure upload/)).toBeInTheDocument();

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
      name: "Venfour received your review request",
    });
    expect(completionHeading).toBeInTheDocument();
    await waitFor(() => expect(completionHeading).toHaveFocus());
    expect(screen.getByText("Request received")).toBeInTheDocument();
    expect(
      screen.getByText(/no appraisal has been completed/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/It is not an automated appraisal/i),
    ).toBeInTheDocument();
    expect(service.decodeVin).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Edit contact details" }),
    ).not.toBeInTheDocument();
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

  it("disables every consultation control until a deferred submission failure settles", async () => {
    const user = userEvent.setup();
    const submission = createDeferred<void>();
    const onSubmitAttempt = vi.fn();
    render(
      <DeferredSubmissionHarness
        submission={submission.promise}
        onSubmitAttempt={onSubmitAttempt}
      />,
    );

    const name = screen.getByLabelText("Name");
    const email = screen.getByLabelText("Email");
    const phone = screen.getByLabelText("Phone");
    const availability = screen.getByLabelText("General availability");
    const emailPreference = within(
      screen.getByRole("group", { name: "Preferred contact method" }),
    ).getByRole("radio", { name: /^Email/u });
    const back = screen.getByRole("button", { name: "Back" });
    const requestReview = screen.getByRole("button", {
      name: "Request a review",
    });

    await user.click(requestReview);

    expect(onSubmitAttempt).toHaveBeenCalledOnce();
    expect(name).toBeDisabled();
    expect(email).toBeDisabled();
    expect(phone).toBeDisabled();
    expect(availability).toBeDisabled();
    expect(emailPreference).toBeDisabled();
    expect(back).toBeDisabled();
    expect(requestReview).toBeDisabled();

    await user.type(name, " Changed");
    await user.click(back);
    await user.click(requestReview);
    expect(name).toHaveValue("Jordan Lee");
    expect(
      screen.getByRole("heading", { name: "Prepare your review request" }),
    ).toBeInTheDocument();
    expect(onSubmitAttempt).toHaveBeenCalledOnce();

    await act(async () => {
      submission.reject(new Error("Submission unavailable"));
      await submission.promise.catch(() => undefined);
    });

    expect(await screen.findByText("Submission unavailable")).toBeVisible();
    expect(name).toBeEnabled();
    expect(email).toBeEnabled();
    expect(phone).toBeEnabled();
    expect(availability).toBeEnabled();
    expect(emailPreference).toBeEnabled();
    expect(back).toBeEnabled();
    expect(requestReview).toBeEnabled();

    await user.type(name, " Updated");
    expect(name).toHaveValue("Jordan Lee Updated");
    await user.click(back);
    expect(
      screen.getByRole("heading", {
        name: "Describe the accident and repairs",
      }),
    ).toBeInTheDocument();
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function DeferredSubmissionHarness({
  submission,
  onSubmitAttempt,
}: {
  readonly submission: Promise<void>;
  readonly onSubmitAttempt: () => void;
}) {
  const [draft, setDraft] = useState<DiminishedValueDraft>({
    ...createEmptyDiminishedValueDraft(),
    step: "consultation",
    accidentState: "IL",
    accidentDate: "2026-08-01",
    repairStatus: "complete",
    vehicleEntryMethod: "details",
    vehicleYear: "2024",
    make: "Honda",
    model: "Accord",
    mileageAtAccident: "48,250",
    otherPartyAtFault: "yes",
    structuralDamage: "no",
    airbagDeployment: "no",
    fullName: "Jordan Lee",
    email: "jordan@example.com",
    phone: "312-555-0123",
    preferredContactMethod: "email",
    availability: "Weekdays after 4 p.m. Central Time",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [lookupService] = useState(vehicleService);

  return (
    <DiminishedValueIntakeFlow
      draft={draft}
      onDraftChange={setDraft}
      selectedFiles={[]}
      onSelectedFilesChange={() => undefined}
      onSubmit={() => {
        onSubmitAttempt();
        setSubmissionError(null);
        setSubmitting(true);
        void submission.catch((error: unknown) => {
          setSubmissionError(
            error instanceof Error ? error.message : "Submission unavailable",
          );
          setSubmitting(false);
        });
      }}
      submitting={submitting}
      submissionError={submissionError}
      vehicleLookupService={lookupService}
    />
  );
}

function FlowHarness({
  initialDraft,
  vehicleLookupService,
}: {
  readonly initialDraft: DiminishedValueDraft;
  readonly vehicleLookupService: VehicleLookupService;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [files, setFiles] = useState<File[]>([]);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  return (
    <DiminishedValueIntakeFlow
      draft={draft}
      onDraftChange={setDraft}
      selectedFiles={files}
      onSelectedFilesChange={setFiles}
      onSubmit={() => {
        setSubmittedAt("2026-08-19T12:00:00.000Z");
        setDraft((current) => ({ ...current, step: "complete" }));
      }}
      submittedAt={submittedAt}
      submittedFileCount={files.length}
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
    listTrims: vi.fn(async () => ["EX"]),
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
