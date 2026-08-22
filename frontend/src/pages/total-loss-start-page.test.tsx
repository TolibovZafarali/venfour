import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AuthService,
  AuthStateChangeListener,
} from "@/features/auth/auth-service";
import { AUTH_RETURN_LOCATION_STORAGE_KEY } from "@/features/auth/return-location";
import type { AppraisalCaseService } from "@/features/cases/service";
import { appraisalCaseQueryKeys } from "@/features/cases/queries";
import type { AppraisalCase } from "@/features/cases/types";
import type {
  SaveTotalLossDetailsInput,
  TotalLossCaseDetails,
  TotalLossCaseDetailsValues,
  TotalLossReportUploadLease,
} from "@/features/total-loss/data-types";
import type { TotalLossDependencies } from "@/features/total-loss/dependencies";
import {
  createEmptyTotalLossDraft,
  readTotalLossDraft,
  writeTotalLossDraft,
} from "@/features/total-loss/draft";
import type { TotalLossDetailsService } from "@/features/total-loss/service";
import { TotalLossDetailsConflictError } from "@/features/total-loss/service";
import { totalLossQueryKeys } from "@/features/total-loss/queries";
import type { TotalLossReportStorageService } from "@/features/total-loss/storage-service";
import type { TotalLossDraft } from "@/features/total-loss/types";
import {
  VehicleLookupError,
  type VehicleLookupService,
} from "@/features/total-loss/vehicle-lookup-service";
import { renderTestApp } from "@/test/render";

vi.mock("@/config/product-availability", () => ({
  totalLossManualIntakeAvailable: true,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const RECENT_CASE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_USER_ID = "44444444-4444-4444-8444-444444444444";
const REPORT_UPLOAD_ID = "55555555-5555-4555-8555-555555555555";
const CREATED_AT = "2026-08-18T14:00:00.000Z";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createSensitiveManualDraft(
  overrides: Partial<Omit<TotalLossDraft, "manual">> = {},
): TotalLossDraft {
  return {
    ...createEmptyTotalLossDraft(new Date(CREATED_AT)),
    mode: "manual",
    step: "vehicle",
    manual: {
      vin: "1HGCM82633A004352",
      vehicleYear: "2020",
      make: "Sensitive Make",
      model: "Sensitive Model",
      trim: "Private Trim",
      mileageAtLoss: "48250",
      zipCode: "60611",
      dateOfLoss: "2020-01-02",
      insurerName: "Private Insurer",
      insurerVehicleValuation: "18750.00",
    },
    ownerUserId: USER_ID,
    dirty: true,
    revision: 4,
    ...overrides,
  };
}

function sessionFor(id = USER_ID) {
  return {
    access_token: `access-${id}`,
    expires_in: 3600,
    refresh_token: `refresh-${id}`,
    token_type: "bearer",
    user: {
      app_metadata: {},
      aud: "authenticated",
      created_at: CREATED_AT,
      email: "owner@example.com",
      id,
      user_metadata: {},
    },
  } as Session;
}

function createAuthHarness(initialSession: Session | null) {
  let listener: AuthStateChangeListener | null = null;
  const getSession = vi.fn(async () => initialSession);
  const service: AuthService = {
    exchangeCodeForSession: vi.fn(async () => sessionFor()),
    getSession,
    onAuthStateChange: vi.fn((nextListener) => {
      listener = nextListener;
      return () => undefined;
    }),
    sendMagicLink: vi.fn(async () => undefined),
    signInWithGoogle: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    verifyEmailOtp: vi.fn(async () => sessionFor()),
  };

  return {
    emit(
      session: Session | null,
      event: AuthChangeEvent = session ? "SIGNED_IN" : "SIGNED_OUT",
    ) {
      listener?.(event, session);
    },
    getSession,
    service,
  };
}

function appraisalCase(
  id: string,
  userId = USER_ID,
  lastActivityAt = CREATED_AT,
): AppraisalCase {
  return {
    id,
    userId,
    serviceType: "total_loss",
    status: "draft",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    lastActivityAt,
  };
}

const emptyDetailsValues: TotalLossCaseDetailsValues = {
  intakeMode: "manual",
  vin: null,
  vehicleYear: null,
  vehicleMake: null,
  vehicleModel: null,
  vehicleTrim: null,
  mileageAtLoss: null,
  postalCode: null,
  dateOfLoss: null,
  insurerName: null,
  insurerVehicleValuation: null,
  reportOriginalFilename: null,
  reportUploadedAt: null,
  intakeCompletedAt: null,
};

function detailsFor(
  caseId: string,
  values: Partial<TotalLossCaseDetailsValues> = {},
): TotalLossCaseDetails {
  return {
    caseId,
    ...emptyDetailsValues,
    ...values,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

interface DependencyHarnessOptions {
  readonly details?: readonly TotalLossCaseDetails[];
  readonly recentCase?: AppraisalCase | null;
  readonly recoverLostCreateResponse?: boolean;
}

function createDependencyHarness({
  details = [],
  recentCase = null,
  recoverLostCreateResponse = false,
}: DependencyHarnessOptions = {}) {
  const cases = new Map<string, AppraisalCase>();
  const detailRows = new Map(details.map((row) => [row.caseId, row]));
  if (recentCase) cases.set(recentCase.id, recentCase);
  let updateSequence = 0;
  let lostInsertAttempts = 0;

  const createOrGetAppraisalCase = vi.fn<
    AppraisalCaseService["createOrGetAppraisalCase"]
  >(async (input) => {
    const existing = cases.get(input.caseId);
    if (existing) return existing;

    lostInsertAttempts += 1;
    const created = appraisalCase(input.caseId, input.userId);
    cases.set(created.id, created);

    if (recoverLostCreateResponse) {
      // The fake commits the insert, loses its response, then performs the
      // service contract's same-ID recovery before resolving to the route.
      return cases.get(input.caseId) ?? created;
    }
    return created;
  });

  const caseService: AppraisalCaseService = {
    createAppraisalCase: vi.fn(async ({ userId }) =>
      appraisalCase(CASE_ID, userId),
    ),
    createOrGetAppraisalCase,
    listAppraisalCases: vi.fn(async () => [...cases.values()]),
    getRecentDraftAppraisalCase: vi.fn(async () => recentCase),
    getAppraisalCase: vi.fn(async ({ caseId }) => cases.get(caseId) ?? null),
    touchAppraisalCase: vi.fn(async ({ caseId }) => cases.get(caseId) ?? null),
  };

  const saveDetails = vi.fn<TotalLossDetailsService["saveDetails"]>(
    async (input: SaveTotalLossDetailsInput) => {
      const current = detailRows.get(input.caseId);
      if (
        (input.expectedUpdatedAt === null && current) ||
        (input.expectedUpdatedAt !== null &&
          current?.updatedAt !== input.expectedUpdatedAt)
      ) {
        throw new TotalLossDetailsConflictError(current ?? null);
      }
      updateSequence += 1;
      const updatedAt = `2026-08-18T14:${String(updateSequence).padStart(2, "0")}:00.000Z`;
      const next: TotalLossCaseDetails = {
        ...(current ?? detailsFor(input.caseId)),
        ...input.values,
        caseId: input.caseId,
        updatedAt,
      };
      detailRows.set(input.caseId, next);
      return next;
    },
  );

  const finalizeReportUpload = vi.fn<
    TotalLossDetailsService["finalizeReportUpload"]
  >(async (input) => {
    const current =
      detailRows.get(input.caseId) ??
      detailsFor(input.caseId, { intakeMode: "report" });
    updateSequence += 1;
    const next: TotalLossCaseDetails = {
      ...current,
      intakeMode: "report",
      reportOriginalFilename: input.originalFilename,
      reportUploadedAt: input.uploadedAt,
      updatedAt: `2026-08-18T15:${String(updateSequence).padStart(2, "0")}:00.000Z`,
    };
    detailRows.set(input.caseId, next);
    return next;
  });

  const reportLeaseFor = (caseId: string): TotalLossReportUploadLease => {
    const current = detailRows.get(caseId);
    return {
      uploadId: REPORT_UPLOAD_ID,
      expiresAt: "2026-08-18T16:00:00.000Z",
      detailsUpdatedAt: current?.updatedAt ?? CREATED_AT,
      reportOriginalFilename: current?.reportOriginalFilename ?? null,
      reportUploadedAt: current?.reportUploadedAt ?? null,
      recoveryRequired: false,
    };
  };

  const acquireReportUploadLease = vi.fn<
    TotalLossDetailsService["acquireReportUploadLease"]
  >(async ({ caseId }) => reportLeaseFor(caseId));
  const renewReportUploadLease = vi.fn<
    TotalLossDetailsService["renewReportUploadLease"]
  >(async ({ caseId }) => reportLeaseFor(caseId));
  const markReportUploadReady = vi.fn<
    TotalLossDetailsService["markReportUploadReady"]
  >(async ({ caseId }) => reportLeaseFor(caseId));
  const completeReportUploadRecovery = vi.fn<
    TotalLossDetailsService["completeReportUploadRecovery"]
  >(async ({ caseId }) => reportLeaseFor(caseId));
  const cancelReportUpload = vi.fn<
    TotalLossDetailsService["cancelReportUpload"]
  >(
    async ({ caseId }) =>
      detailRows.get(caseId) ?? detailsFor(caseId, { intakeMode: "report" }),
  );

  const detailsService: TotalLossDetailsService = {
    getDetails: vi.fn(async ({ caseId }) => detailRows.get(caseId) ?? null),
    createDetails: vi.fn(async ({ caseId, values }) => {
      const next = {
        ...detailsFor(caseId),
        ...values,
      };
      detailRows.set(caseId, next);
      return next;
    }),
    updateDetails: vi.fn(async ({ caseId, changes }) => {
      const next = {
        ...(detailRows.get(caseId) ?? detailsFor(caseId)),
        ...changes,
      };
      detailRows.set(caseId, next);
      return next;
    }),
    saveDetails,
    acquireReportUploadLease,
    renewReportUploadLease,
    markReportUploadReady,
    completeReportUploadRecovery,
    finalizeReportUpload,
    cancelReportUpload,
  };

  const uploadReport = vi.fn<TotalLossReportStorageService["uploadReport"]>(
    async ({ userId, caseId, file }) => ({
      path: `${userId}/${caseId}/valuation-report.pdf`,
      displayFilename: file.name,
    }),
  );
  const downloadReport = vi.fn<TotalLossReportStorageService["downloadReport"]>(
    async () => new Blob(["%PDF-1.7 previous"], { type: "application/pdf" }),
  );
  const restoreReport = vi.fn<TotalLossReportStorageService["restoreReport"]>(
    async () => undefined,
  );
  const downloadReportBackup = vi.fn<
    TotalLossReportStorageService["downloadReportBackup"]
  >(async () => new Blob(["%PDF-1.7 previous"], { type: "application/pdf" }));
  const storeReportBackup = vi.fn<
    TotalLossReportStorageService["storeReportBackup"]
  >(async () => undefined);
  const deleteReportBackup = vi.fn<
    TotalLossReportStorageService["deleteReportBackup"]
  >(async () => undefined);
  const storageService: TotalLossReportStorageService = {
    downloadReport,
    downloadReportBackup,
    storeReportBackup,
    restoreReport,
    deleteReportBackup,
    uploadReport,
  };
  const decodeVin = vi.fn<VehicleLookupService["decodeVin"]>(async (vin) => ({
    vin: vin.trim().toUpperCase(),
    year: 2003,
    make: "Honda",
    model: "Accord",
    trim: "EX-V6",
  }));
  const listMakes = vi.fn<VehicleLookupService["listMakes"]>(async () => [
    "Honda",
    "Toyota",
  ]);
  const listModels = vi.fn<VehicleLookupService["listModels"]>(
    async ({ make }) =>
      make === "Toyota" ? ["Camry", "Corolla"] : ["Accord", "Civic"],
  );
  const vehicleLookupService: VehicleLookupService = {
    decodeVin,
    listMakes,
    listModels,
  };
  const dependencies: TotalLossDependencies = {
    appraisalCaseService: caseService,
    totalLossDetailsService: detailsService,
    totalLossReportStorageService: storageService,
    vehicleLookupService,
  };

  return {
    caseService,
    createOrGetAppraisalCase,
    dependencies,
    detailRows,
    detailsService,
    downloadReport,
    decodeVin,
    get lostInsertAttempts() {
      return lostInsertAttempts;
    },
    saveDetails,
    finalizeReportUpload,
    restoreReport,
    uploadReport,
    vehicleLookupService,
    listMakes,
    listModels,
  };
}

async function chooseMode(
  user: ReturnType<typeof userEvent.setup>,
  label: "I have my valuation report" | "I don’t have the report",
) {
  await user.click(screen.getByRole("radio", { name: new RegExp(label, "i") }));
  await user.click(
    withinIntakeFlow().getByRole("button", { name: "Continue" }),
  );
}

function withinIntakeFlow() {
  const flow = document.querySelector<HTMLElement>(
    "[data-appraisal-start-flow]",
  );
  if (!flow) throw new Error("Appraisal intake flow was not rendered.");
  return within(flow);
}

async function fillManualIntake(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("VIN"), "1hgcm82633a004352");
  await user.type(screen.getByLabelText("Mileage at date of loss"), "48250");
  expect(screen.getByLabelText("Mileage at date of loss")).toHaveValue(
    "48,250",
  );
  await user.click(
    screen.getByRole("button", { name: "Find vehicle & continue" }),
  );

  await user.type(screen.getByLabelText("ZIP code"), "60611");
  await chooseLossDate(user, {
    year: "2020",
    month: "0",
    day: "January 2, 2020",
  });
  await user.type(
    screen.getByLabelText("Insurance company"),
    "  Acme   Mutual  ",
  );
  await user.type(
    screen.getByLabelText("Insurer’s vehicle valuation"),
    "18750",
  );
  expect(screen.getByLabelText("Insurer’s vehicle valuation")).toHaveValue(
    "$18,750",
  );
}

async function chooseLossDate(
  user: ReturnType<typeof userEvent.setup>,
  selection: { year: string; month: string; day: string },
) {
  await user.click(screen.getByRole("button", { name: "Date of loss" }));
  await user.selectOptions(
    screen.getByLabelText("Calendar year"),
    selection.year,
  );
  await user.selectOptions(
    screen.getByLabelText("Calendar month"),
    selection.month,
  );
  await user.click(screen.getByRole("gridcell", { name: selection.day }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/start?service=total-loss", () => {
  it("renders the accessible opening choice without creating or loading a case", async () => {
    const auth = createAuthHarness(null);
    const harness = createDependencyHarness();

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });

    const pageHeading = screen.getByRole("heading", {
      name: "Start your CCC report review",
    });
    expect(pageHeading).toBeVisible();
    const layout = pageHeading.closest("[data-total-loss-layout]");
    expect(layout).toHaveClass(
      "lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]",
    );
    expect(layout?.querySelector("[data-total-loss-flow]")).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /I have my valuation report/i }),
    ).toBeVisible();
    expect(
      screen.getByRole("radio", { name: /I don’t have the report/i }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Back to total loss" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Saved on this device")).not.toBeInTheDocument();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Primary navigation" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Get Started" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open navigation" }),
    ).not.toBeInTheDocument();
    const signInButton = await screen.findByRole("button", { name: "Sign In" });
    expect(signInButton.previousElementSibling).toHaveTextContent(
      "Already have an account?",
    );
    expect(screen.queryByText("Progress")).not.toBeInTheDocument();
    expect(screen.queryByText("Step I of III")).not.toBeInTheDocument();
    const progress = screen.getByRole("list", { name: "Appraisal steps" });
    expect(progress.children).toHaveLength(3);
    expect(progress.children[0]).toHaveAttribute("aria-current", "step");
    expect(progress.children[0]).toHaveClass(
      "rounded-xl",
      "border",
      "border-brand",
      "bg-brand",
    );
    expect(progress.children[0]).toBeEmptyDOMElement();
    expect(progress).not.toHaveTextContent("Start");
    expect(progress).not.toHaveTextContent("Vehicle");
    expect(progress).not.toHaveTextContent("Claim");
    expect(screen.getByLabelText("Start, step 1, current")).toBeVisible();
    expect(screen.getByLabelText("Vehicle, step 2")).toBeVisible();
    expect(screen.getByLabelText("Claim, step 3")).toBeVisible();

    await waitFor(() => expect(auth.service.getSession).toHaveBeenCalledOnce());
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
    expect(
      harness.caseService.getRecentDraftAppraisalCase,
    ).not.toHaveBeenCalled();
    expect(harness.detailsService.getDetails).not.toHaveBeenCalled();
    expect(harness.uploadReport).not.toHaveBeenCalled();
  });

  it("keeps the canonical service and case in the authentication return URL", async () => {
    const auth = createAuthHarness(null);
    const user = userEvent.setup();

    renderTestApp([`/start?service=total-loss&caseId=${CASE_ID}`], {
      authService: auth.service,
      totalLossDependencies: createDependencyHarness().dependencies,
    });

    await user.click(
      await screen.findByRole("button", { name: /^Sign in$/u }),
    );
    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    expect(
      window.localStorage.getItem(AUTH_RETURN_LOCATION_STORAGE_KEY),
    ).toBe(`/start?service=total-loss&caseId=${CASE_ID}`);
  });

  it("keeps a signed-out manual draft local, restores it, then migrates it after sign-in", async () => {
    const signedOutAuth = createAuthHarness(null);
    const harness = createDependencyHarness();
    const user = userEvent.setup();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(CASE_ID);

    const firstRender = renderTestApp(["/start?service=total-loss"], {
      authService: signedOutAuth.service,
      totalLossDependencies: harness.dependencies,
    });
    await chooseMode(user, "I don’t have the report");
    await fillManualIntake(user);
    expect(
      screen.getByRole("button", { name: "Date of loss" }),
    ).toHaveTextContent("January 2, 2020");
    await user.click(
      screen.getByRole("button", { name: "Continue to Free Value Check" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Sign in to Venfour" }),
    ).toHaveTextContent(
      "Sign in to securely save your total-loss information and continue to the free value check.",
    );
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
    expect(harness.saveDetails).not.toHaveBeenCalled();
    const storedBeforeAuth = readTotalLossDraft();
    expect(storedBeforeAuth).toMatchObject({
      ok: true,
      draft: {
        mode: "manual",
        step: "claim",
        pendingAuthAction: "complete-manual",
        manual: {
          vin: "1HGCM82633A004352",
          mileageAtLoss: "48250",
          dateOfLoss: "2020-01-02",
          insurerName: "Acme Mutual",
          insurerVehicleValuation: "18750.00",
        },
      },
    });

    firstRender.unmount();
    const restoredAuth = createAuthHarness(sessionFor());
    renderTestApp(["/start?service=total-loss"], {
      authService: restoredAuth.service,
      totalLossDependencies: harness.dependencies,
    });

    expect(
      await screen.findByRole("heading", { name: "Your information is saved" }),
    ).toBeVisible();
    expect(
      screen.getByText("You’re ready for the free value check."),
    ).toBeVisible();
    expect(harness.createOrGetAppraisalCase).toHaveBeenCalledOnce();
    expect(harness.createOrGetAppraisalCase).toHaveBeenCalledWith({
      caseId: CASE_ID,
      serviceType: "total_loss",
      userId: USER_ID,
    });
    expect(harness.saveDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: CASE_ID,
        userId: USER_ID,
        values: expect.objectContaining({
          intakeMode: "manual",
          vin: "1HGCM82633A004352",
          vehicleMake: "Honda",
          insurerVehicleValuation: 18750,
          intakeCompletedAt: expect.any(String),
        }),
      }),
    );
    const persistedCaseInput =
      harness.createOrGetAppraisalCase.mock.calls[0]?.[0];
    expect(persistedCaseInput).not.toHaveProperty("status");
  });

  it("uses one stable reserved case ID under StrictMode when a lost create response is recovered", async () => {
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness({
      recoverLostCreateResponse: true,
    });
    const user = userEvent.setup();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(CASE_ID);

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      strictMode: true,
      totalLossDependencies: harness.dependencies,
    });
    await screen.findByRole("radio", { name: /I don’t have the report/i });
    await chooseMode(user, "I don’t have the report");

    await waitFor(() =>
      expect(harness.createOrGetAppraisalCase).toHaveBeenCalledOnce(),
    );
    expect(harness.lostInsertAttempts).toBe(1);
    expect(harness.createOrGetAppraisalCase).toHaveBeenCalledWith({
      caseId: CASE_ID,
      serviceType: "total_loss",
      userId: USER_ID,
    });
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: {
        confirmedCaseId: CASE_ID,
        reservedCaseId: CASE_ID,
        ownerUserId: USER_ID,
      },
    });
    expect(
      screen.getByRole("heading", { name: "Tell us about your vehicle" }),
    ).toBeVisible();
  });

  it("finds a vehicle by VIN before moving smoothly to claim details", async () => {
    const auth = createAuthHarness(null);
    const harness = createDependencyHarness();
    const user = userEvent.setup();

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });
    await chooseMode(user, "I don’t have the report");

    const vehicleHeading = screen.getByRole("heading", {
      name: "Tell us about your vehicle",
    });
    expect(vehicleHeading.closest("section")).not.toHaveClass("sm:h-[40rem]");
    await user.type(screen.getByLabelText("VIN"), "1hgcm82633a004352");
    await user.type(screen.getByLabelText("Mileage at date of loss"), "50000");
    expect(screen.getByLabelText("Mileage at date of loss")).toHaveValue(
      "50,000",
    );
    await user.click(
      screen.getByRole("button", { name: "Find vehicle & continue" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Add the claim details" }),
    ).toBeVisible();
    expect(screen.getByText("Vehicle: 2003 Honda Accord EX-V6")).toBeVisible();
    expect(harness.decodeVin).toHaveBeenCalledWith("1HGCM82633A004352");
    const progress = screen.getByRole("list", { name: "Appraisal steps" });
    expect(progress.children).toHaveLength(3);
    expect(progress.children[0]).toHaveClass("border-brand", "bg-brand");
    expect(progress.children[0]).toBeEmptyDOMElement();
    expect(progress.children[0].querySelector("svg")).not.toBeInTheDocument();
    expect(
      document.querySelector("[data-intake-transition='forward']"),
    ).toBeInTheDocument();
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: {
        step: "claim",
        manual: {
          vin: "1HGCM82633A004352",
          vehicleYear: "2003",
          make: "Honda",
          model: "Accord",
          mileageAtLoss: "50000",
        },
      },
    });
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      await screen.findByRole("heading", {
        name: "Tell us about your vehicle",
      }),
    ).toBeVisible();
    expect(
      document.querySelector("[data-intake-transition='backward']"),
    ).toBeInTheDocument();
  });

  it("uses dependent dropdowns when the user does not have a VIN", async () => {
    const auth = createAuthHarness(null);
    const harness = createDependencyHarness();
    const user = userEvent.setup();

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });
    await chooseMode(user, "I don’t have the report");
    expect(
      document.querySelector('[data-vehicle-method-panel="vin"]'),
    ).toHaveClass("vehicle-method-panel");
    expect(
      document.querySelector('[data-vehicle-method-panel="details"]'),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("radio", { name: "Select vehicle details" }),
    );
    expect(
      document.querySelector('[data-vehicle-method-panel="vin"]'),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-vehicle-method-panel="details"]'),
    ).toHaveClass("vehicle-method-panel");

    await waitFor(() => expect(screen.getByLabelText("Make")).toBeEnabled());
    await user.selectOptions(screen.getByLabelText("Year"), "2020");
    await user.selectOptions(screen.getByLabelText("Make"), "Honda");
    await waitFor(() => expect(screen.getByLabelText("Model")).toBeEnabled());
    await user.selectOptions(screen.getByLabelText("Model"), "Accord");
    await user.selectOptions(screen.getByLabelText("Make"), "Toyota");
    expect(screen.getByLabelText("Model")).toHaveValue("");
    await waitFor(() => expect(screen.getByLabelText("Model")).toBeEnabled());
    await user.selectOptions(screen.getByLabelText("Model"), "Camry");
    await user.type(screen.getByLabelText("Mileage at date of loss"), "42000");
    await user.click(
      withinIntakeFlow().getByRole("button", { name: "Continue" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Add the claim details" }),
    ).toBeVisible();
    expect(harness.decodeVin).not.toHaveBeenCalled();
    expect(harness.listModels).toHaveBeenLastCalledWith({
      year: 2020,
      make: "Toyota",
    });
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: {
        manual: {
          vin: "",
          vehicleYear: "2020",
          make: "Toyota",
          model: "Camry",
          mileageAtLoss: "42000",
        },
      },
    });
  });

  it("keeps VIN lookup failures in place and offers the guided fallback", async () => {
    const auth = createAuthHarness(null);
    const harness = createDependencyHarness();
    const user = userEvent.setup();
    harness.decodeVin.mockRejectedValueOnce(
      new VehicleLookupError(
        "vehicle-not-found",
        "We couldn’t identify a vehicle with that VIN. Check the VIN and try again.",
      ),
    );

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });
    await chooseMode(user, "I don’t have the report");
    await user.type(screen.getByLabelText("VIN"), "1hgcm82633a004352");
    await user.type(screen.getByLabelText("Mileage at date of loss"), "50000");
    await user.click(
      screen.getByRole("button", { name: "Find vehicle & continue" }),
    );

    expect(
      await screen.findByText(
        "We couldn’t identify a vehicle with that VIN. Check the VIN and try again.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Tell us about your vehicle" }),
    ).toBeVisible();
    expect(
      screen.getByRole("radio", { name: "Select vehicle details" }),
    ).toBeEnabled();
  });

  it("does not mount an operative report input before authentication", async () => {
    const auth = createAuthHarness(null);
    const harness = createDependencyHarness();
    const user = userEvent.setup();

    const { container } = renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });
    await chooseMode(user, "I have my valuation report");

    expect(
      container.querySelector('input[type="file"]'),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Sign in to choose PDF" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Sign in to Venfour" }),
    ).toHaveTextContent(
      "Sign in so Venfour can securely store your original CCC valuation report with your total-loss case.",
    );
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
    expect(harness.uploadReport).not.toHaveBeenCalled();
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: {
        mode: "report",
        step: "report",
        pendingAuthAction: "upload-report",
      },
    });
  });

  it("validates, uploads, retries replacement, and completes a private report intake", async () => {
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness();
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.spyOn(crypto, "randomUUID").mockReturnValue(CASE_ID);

    const { container, router } = renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });
    await chooseMode(user, "I have my valuation report");
    const fileInput = await waitFor(() => {
      const input =
        container.querySelector<HTMLInputElement>('input[type="file"]');
      expect(input).toBeInTheDocument();
      return input as HTMLInputElement;
    });

    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["not a pdf"], "valuation.txt", { type: "text/plain" }),
        ],
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The report filename must end in .pdf.",
    );
    expect(harness.uploadReport).not.toHaveBeenCalled();

    const original = new File(["%PDF-1.7"], "insurer-valuation.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(fileInput, { target: { files: [original] } });
    expect(await screen.findByText("Report saved securely")).toBeVisible();
    expect(screen.getByText("insurer-valuation.pdf")).toBeVisible();
    expect(harness.uploadReport).toHaveBeenLastCalledWith({
      caseId: CASE_ID,
      file: original,
      replaceExisting: false,
      uploadId: REPORT_UPLOAD_ID,
      userId: USER_ID,
    });
    await expect(
      harness.uploadReport.mock.results.at(-1)?.value,
    ).resolves.toMatchObject({
      path: `${USER_ID}/${CASE_ID}/valuation-report.pdf`,
    });
    expect(harness.finalizeReportUpload).toHaveBeenCalledOnce();

    harness.uploadReport.mockRejectedValueOnce(
      new Error("Replacement storage is temporarily unavailable."),
    );
    const replacement = new File(["%PDF-1.7 replacement"], "replacement.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(fileInput, { target: { files: [replacement] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Replacement storage is temporarily unavailable.",
    );
    expect(harness.uploadReport).toHaveBeenNthCalledWith(2, {
      caseId: CASE_ID,
      file: replacement,
      replaceExisting: true,
      uploadId: REPORT_UPLOAD_ID,
      userId: USER_ID,
    });
    expect(screen.getByText("insurer-valuation.pdf")).toBeVisible();
    expect(harness.finalizeReportUpload).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(screen.getByText("replacement.pdf")).toBeVisible(),
    );
    expect(harness.uploadReport).toHaveBeenCalledTimes(3);
    expect(harness.finalizeReportUpload).toHaveBeenCalledTimes(2);

    harness.finalizeReportUpload
      .mockRejectedValueOnce(
        new Error("The uploaded report metadata could not be saved."),
      )
      .mockRejectedValueOnce(
        new Error("The uploaded report metadata could not be saved."),
      );
    const metadataFailureReplacement = new File(
      ["%PDF-1.7 latest replacement"],
      "latest-replacement.pdf",
      { type: "application/pdf" },
    );
    fireEvent.change(fileInput, {
      target: { files: [metadataFailureReplacement] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The uploaded report metadata could not be saved.",
    );
    expect(screen.getByText("replacement.pdf")).toBeVisible();
    expect(harness.uploadReport).toHaveBeenCalledTimes(4);
    expect(harness.finalizeReportUpload).toHaveBeenCalledTimes(4);
    expect(harness.restoreReport).toHaveBeenCalledTimes(2);
    expect(harness.restoreReport).toHaveBeenLastCalledWith({
      backup: expect.any(Blob),
      caseId: CASE_ID,
      uploadId: REPORT_UPLOAD_ID,
      userId: USER_ID,
    });

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(screen.getByText("latest-replacement.pdf")).toBeVisible(),
    );
    expect(harness.uploadReport).toHaveBeenCalledTimes(5);
    expect(harness.finalizeReportUpload).toHaveBeenCalledTimes(5);
    expect(harness.downloadReport).toHaveBeenCalledTimes(4);

    await user.click(
      screen.getByRole("button", { name: "Continue to Free Value Check" }),
    );
    expect(
      await screen.findByText("ZIP code is required."),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe("/start");

    await user.type(screen.getByLabelText("ZIP code"), "606011234");
    fireEvent.blur(screen.getByLabelText("ZIP code"));
    expect(screen.getByLabelText("ZIP code")).toHaveValue("60601-1234");
    await user.click(
      screen.getByRole("button", { name: "Continue to Free Value Check" }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/total-loss/cases/${CASE_ID}/analysis`,
      ),
    );
    expect(
      await screen.findByRole("heading", {
        name: "We’re reviewing your valuation report.",
      }),
    ).toBeVisible();
    expect(harness.saveDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: CASE_ID,
        values: expect.objectContaining({
          intakeMode: "report",
          intakeCompletedAt: expect.any(String),
          postalCode: "60601-1234",
        }),
      }),
    );
    const authenticatedRequest = fetchSpy.mock.calls.find(([input]) =>
      String(input).includes(`/api/v1/appraisal-cases/${CASE_ID}/analysis`),
    );
    expect(authenticatedRequest).toBeDefined();
    expect(
      new Headers(authenticatedRequest?.[1]?.headers).get("Authorization"),
    ).toBe(`Bearer access-${USER_ID}`);
    for (const [input] of harness.saveDetails.mock.calls) {
      expect(input).not.toHaveProperty("status");
    }
  });

  it("shows a report completion save failure without claiming the intake is ready", async () => {
    const savedReport = detailsFor(CASE_ID, {
      intakeMode: "report",
      reportOriginalFilename: "saved-report.pdf",
      reportUploadedAt: CREATED_AT,
    });
    expect(
      writeTotalLossDraft({
        ...createEmptyTotalLossDraft(new Date(CREATED_AT)),
        mode: "report",
        step: "report",
        confirmedCaseId: CASE_ID,
        reservedCaseId: CASE_ID,
        ownerUserId: USER_ID,
      }).ok,
    ).toBe(true);
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness({ details: [savedReport] });
    const user = userEvent.setup();

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });

    expect(await screen.findByText("saved-report.pdf")).toBeVisible();
    await user.type(screen.getByLabelText("ZIP code"), "60611");
    harness.saveDetails.mockRejectedValueOnce(
      new Error("The completed intake could not be saved."),
    );
    await user.click(
      screen.getByRole("button", { name: "Continue to Free Value Check" }),
    );

    expect(
      await screen.findByText("The completed intake could not be saved."),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Your report is ready" }),
    ).not.toBeInTheDocument();
  });

  it("offers the newest saved draft and dismisses it without creating a replacement", async () => {
    const recent = appraisalCase(
      RECENT_CASE_ID,
      USER_ID,
      "2026-08-17T18:30:00.000Z",
    );
    const recentDetails = detailsFor(RECENT_CASE_ID, {
      intakeMode: "manual",
      vehicleYear: 2021,
      vehicleMake: "Toyota",
      vehicleModel: "Camry",
    });
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness({
      details: [recentDetails],
      recentCase: recent,
    });
    const user = userEvent.setup();

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });

    expect(
      await screen.findByRole("heading", {
        name: "Continue your saved appraisal?",
      }),
    ).toBeVisible();
    expect(await screen.findByText("2021 Toyota Camry")).toBeVisible();
    expect(screen.getByText(/Last saved Aug 17, 2026/)).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Start a new appraisal" }),
    );
    expect(
      screen.getByRole("group", {
        name: "Do you have your insurance valuation report?",
      }),
    ).toBeVisible();
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: {
        dismissedResumeCaseId: RECENT_CASE_ID,
        confirmedCaseId: null,
      },
    });
  });

  it("resumes a completed owned case directly into the ready state", async () => {
    const recent = appraisalCase(RECENT_CASE_ID);
    const recentDetails = detailsFor(RECENT_CASE_ID, {
      intakeMode: "report",
      reportOriginalFilename: "saved-report.pdf",
      reportUploadedAt: CREATED_AT,
      intakeCompletedAt: CREATED_AT,
    });
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness({
      details: [recentDetails],
      recentCase: recent,
    });
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });
    await screen.findByRole("heading", {
      name: "Continue your saved appraisal?",
    });
    await user.click(
      withinIntakeFlow().getByRole("button", { name: "Continue" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Your report is ready" }),
    ).toBeVisible();
    expect(
      screen.getByText(/Start the free value check/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Start value check" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Replace report" }),
    ).toBeVisible();
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
    expect(harness.saveDetails).not.toHaveBeenCalled();
    expect(harness.uploadReport).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not trust a local ready step when no completed server details exist", async () => {
    expect(
      writeTotalLossDraft(
        createSensitiveManualDraft({
          step: "ready",
          confirmedCaseId: CASE_ID,
          reservedCaseId: CASE_ID,
          dirty: false,
        }),
      ).ok,
    ).toBe(true);
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness({
      recentCase: appraisalCase(CASE_ID),
    });

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });

    expect(
      await screen.findByRole("heading", {
        name: "Tell us about your vehicle",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "We couldn’t confirm that this intake was completed. Review and save it again.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Your information is saved" }),
    ).not.toBeInTheDocument();
  });

  it("automatically resumes an explicitly referenced owned total-loss draft", async () => {
    const explicitCase = appraisalCase(CASE_ID);
    const explicitDetails = detailsFor(CASE_ID, {
      intakeMode: "manual",
      vin: "1HGCM82633A004352",
      vehicleYear: 2020,
      vehicleMake: "Honda",
      vehicleModel: "Accord",
      mileageAtLoss: 48250,
    });
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness({
      details: [explicitDetails],
      recentCase: explicitCase,
    });

    renderTestApp([`/start?service=total-loss&caseId=${CASE_ID}`], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });

    expect(
      await screen.findByRole("heading", {
        name: "Tell us about your vehicle",
      }),
    ).toBeVisible();
    expect(screen.getByLabelText("VIN")).toHaveValue("1HGCM82633A004352");
    expect(screen.getByText("Vehicle: 2020 Honda Accord")).toBeVisible();
    expect(harness.caseService.getAppraisalCase).toHaveBeenCalledWith({
      caseId: CASE_ID,
      userId: USER_ID,
    });
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: {
        confirmedCaseId: CASE_ID,
        reservedCaseId: CASE_ID,
        ownerUserId: USER_ID,
      },
    });
  });

  it("does not render owner-bound local fields while session restoration is pending", async () => {
    expect(writeTotalLossDraft(createSensitiveManualDraft())).toEqual({
      ok: true,
    });
    const sessionRestoration = createDeferred<Session | null>();
    const auth = createAuthHarness(null);
    auth.getSession.mockReturnValue(sessionRestoration.promise);

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: null,
    });
    await waitFor(() => expect(auth.getSession).toHaveBeenCalledOnce());

    expect(screen.getByText("Loading your saved appraisal…")).toBeVisible();
    expect(screen.queryByLabelText("VIN")).not.toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("1HGCM82633A004352"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("Private Insurer"),
    ).not.toBeInTheDocument();

    await act(async () => {
      sessionRestoration.resolve(sessionFor());
      await sessionRestoration.promise;
    });
    expect(await screen.findByLabelText("VIN")).toHaveValue(
      "1HGCM82633A004352",
    );
    expect(
      screen.getByText(/Vehicle: 2020 Sensitive Make Sensitive Model/),
    ).toBeVisible();
  });

  it("waits for explicit ownership before handling a pending auth action", async () => {
    expect(
      writeTotalLossDraft(
        createSensitiveManualDraft({
          ownerUserId: null,
          pendingAuthAction: "complete-manual",
          reservedCaseId: CASE_ID,
          step: "claim",
        }),
      ),
    ).toEqual({ ok: true });
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness();
    const ownership = createDeferred<AppraisalCase | null>();
    harness.caseService.getAppraisalCase = vi.fn(() => ownership.promise);

    renderTestApp([`/start?service=total-loss&caseId=${RECENT_CASE_ID}`], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });
    await waitFor(() =>
      expect(harness.caseService.getAppraisalCase).toHaveBeenCalledWith({
        caseId: RECENT_CASE_ID,
        userId: USER_ID,
      }),
    );

    expect(screen.getByText("Loading your saved appraisal…")).toBeVisible();
    expect(
      screen.queryByLabelText("Insurance company"),
    ).not.toBeInTheDocument();
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
    expect(harness.saveDetails).not.toHaveBeenCalled();

    await act(async () => {
      ownership.resolve(appraisalCase(RECENT_CASE_ID));
      await ownership.promise;
    });
    expect(
      await screen.findByRole("group", {
        name: "Do you have your insurance valuation report?",
      }),
    ).toBeVisible();
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
    expect(harness.saveDetails).not.toHaveBeenCalled();
    expect(harness.detailsService.getDetails).toHaveBeenCalledWith({
      caseId: RECENT_CASE_ID,
      userId: USER_ID,
    });
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: {
        confirmedCaseId: RECENT_CASE_ID,
        reservedCaseId: RECENT_CASE_ID,
        ownerUserId: USER_ID,
        pendingAuthAction: null,
        manual: {
          vin: "",
          insurerName: "",
        },
      },
    });
  });

  it.each([
    ["an invalid target", "not-a-case-id", false],
    ["an unavailable owned target", RECENT_CASE_ID, true],
  ] as const)(
    "blocks local sensitive fields when an explicit link has %s",
    async (_label, targetCaseId, ownershipLookupExpected) => {
      expect(writeTotalLossDraft(createSensitiveManualDraft())).toEqual({
        ok: true,
      });
      const auth = createAuthHarness(sessionFor());
      const harness = createDependencyHarness();

      renderTestApp([`/start?service=total-loss&caseId=${targetCaseId}`], {
        authService: auth.service,
        totalLossDependencies: harness.dependencies,
      });

      expect(screen.queryByLabelText("VIN")).not.toBeInTheDocument();
      expect(
        screen.queryByDisplayValue("1HGCM82633A004352"),
      ).not.toBeInTheDocument();
      expect(
        await screen.findByText(
          "This saved appraisal cannot be opened from this link.",
        ),
      ).toBeVisible();
      expect(screen.getByText("Saved appraisal unavailable")).toBeVisible();
      expect(screen.queryByLabelText("VIN")).not.toBeInTheDocument();
      expect(
        screen.queryByDisplayValue("Private Insurer"),
      ).not.toBeInTheDocument();
      if (ownershipLookupExpected) {
        expect(harness.caseService.getAppraisalCase).toHaveBeenCalledWith({
          caseId: RECENT_CASE_ID,
          userId: USER_ID,
        });
      } else {
        expect(harness.caseService.getAppraisalCase).not.toHaveBeenCalled();
      }
      expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
      expect(harness.saveDetails).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["sign-out", null],
    ["an account change", sessionFor(OTHER_USER_ID)],
  ] as const)(
    "clears owner-bound draft, report UI, and cached details after %s",
    async (_label, nextSession) => {
      const localDraft = {
        ...createEmptyTotalLossDraft(new Date(CREATED_AT)),
        mode: "report" as const,
        step: "report" as const,
        confirmedCaseId: CASE_ID,
        reservedCaseId: CASE_ID,
        ownerUserId: USER_ID,
      };
      expect(writeTotalLossDraft(localDraft)).toEqual({ ok: true });
      const savedDetails = detailsFor(CASE_ID, {
        intakeMode: "report",
        reportOriginalFilename: "private-report.pdf",
        reportUploadedAt: CREATED_AT,
      });
      const auth = createAuthHarness(sessionFor());
      const harness = createDependencyHarness({ details: [savedDetails] });

      const { queryClient } = renderTestApp(["/start?service=total-loss"], {
        authService: auth.service,
        totalLossDependencies: harness.dependencies,
      });
      expect(await screen.findByText("private-report.pdf")).toBeVisible();
      expect(
        queryClient.getQueryData(totalLossQueryKeys.details(USER_ID, CASE_ID)),
      ).toMatchObject({ caseId: CASE_ID });

      act(() => auth.emit(nextSession));

      expect(
        await screen.findByRole("group", {
          name: "Do you have your insurance valuation report?",
        }),
      ).toBeVisible();
      expect(screen.queryByText("private-report.pdf")).not.toBeInTheDocument();
      expect(readTotalLossDraft()).toMatchObject({
        ok: true,
        draft: {
          ownerUserId: null,
          confirmedCaseId: null,
          reservedCaseId: null,
        },
      });
      expect(
        queryClient.getQueryData(totalLossQueryKeys.details(USER_ID, CASE_ID)),
      ).toBeUndefined();
    },
  );

  it.each([
    ["sign-out", null],
    ["an account change", sessionFor(OTHER_USER_ID)],
  ] as const)(
    "does not repopulate old-user caches when a deferred save finishes after %s",
    async (_label, nextSession) => {
      const auth = createAuthHarness(sessionFor());
      const harness = createDependencyHarness();
      const pendingSave = createDeferred<TotalLossCaseDetails>();
      harness.saveDetails.mockImplementationOnce(() => pendingSave.promise);
      const user = userEvent.setup();
      vi.spyOn(crypto, "randomUUID").mockReturnValue(CASE_ID);

      const { queryClient } = renderTestApp(["/start?service=total-loss"], {
        authService: auth.service,
        totalLossDependencies: harness.dependencies,
      });
      await chooseMode(user, "I don’t have the report");
      await waitFor(() => expect(harness.saveDetails).toHaveBeenCalledOnce());
      expect(
        queryClient.getQueryData(
          appraisalCaseQueryKeys.detail(USER_ID, CASE_ID),
        ),
      ).toMatchObject({ id: CASE_ID, userId: USER_ID });

      act(() => auth.emit(nextSession));
      await screen.findByRole("group", {
        name: "Do you have your insurance valuation report?",
      });

      const pendingInput = harness.saveDetails.mock.calls[0]?.[0];
      await act(async () => {
        pendingSave.resolve({
          ...detailsFor(CASE_ID),
          ...pendingInput.values,
          updatedAt: "2026-08-18T17:00:00.000Z",
        });
        await pendingSave.promise;
      });
      await waitFor(() => expect(queryClient.isMutating()).toBe(0));
      await waitFor(() =>
        expect(
          queryClient.getQueriesData({
            queryKey: appraisalCaseQueryKeys.user(USER_ID),
          }),
        ).toEqual([]),
      );
      expect(
        queryClient.getQueryData(totalLossQueryKeys.details(USER_ID, CASE_ID)),
      ).toBeUndefined();
      expect(
        queryClient.getQueryData(
          appraisalCaseQueryKeys.detail(USER_ID, CASE_ID),
        ),
      ).toBeUndefined();
    },
  );

  it("restores a local manual step without any authenticated persistence", async () => {
    const draft = {
      ...createEmptyTotalLossDraft(new Date(CREATED_AT)),
      mode: "manual" as const,
      step: "vehicle" as const,
      manual: {
        vin: "1HGCM82633A004352",
        vehicleYear: "2020",
        make: "Honda",
        model: "Accord",
        trim: "EX-L",
        mileageAtLoss: "48250",
        zipCode: "",
        dateOfLoss: "",
        insurerName: "",
        insurerVehicleValuation: "",
      },
      dirty: true,
      revision: 4,
    };
    expect(writeTotalLossDraft(draft)).toEqual({ ok: true });
    const auth = createAuthHarness(null);
    const harness = createDependencyHarness();

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });

    expect(screen.getByLabelText("VIN")).toHaveValue("1HGCM82633A004352");
    expect(screen.getByText("Vehicle: 2020 Honda Accord EX-L")).toBeVisible();
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
    expect(harness.saveDetails).not.toHaveBeenCalled();
  });

  it("retains incomplete typed strings locally after authenticated autosave and reload", async () => {
    const baseDraft = createSensitiveManualDraft({
      confirmedCaseId: CASE_ID,
      reservedCaseId: CASE_ID,
    });
    const incompleteDraft: TotalLossDraft = {
      ...baseDraft,
      manual: {
        ...baseDraft.manual,
        vin: "",
        vehicleYear: "20",
        mileageAtLoss: "12,",
      },
    };
    expect(writeTotalLossDraft(incompleteDraft).ok).toBe(true);
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness({
      recentCase: appraisalCase(CASE_ID),
    });

    const firstRender = renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });
    await waitFor(() => expect(harness.saveDetails).toHaveBeenCalled());
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: {
        dirty: true,
        manual: { vehicleYear: "20", mileageAtLoss: "12," },
      },
    });
    firstRender.unmount();

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });
    expect(await screen.findByLabelText("Year")).toHaveValue("20");
    expect(screen.getByLabelText("Mileage at date of loss")).toHaveValue("12");
  });

  it("restores saved report metadata without replacing dirty inactive manual values", async () => {
    const baseDraft = createSensitiveManualDraft({
      mode: "report",
      step: "report",
      confirmedCaseId: CASE_ID,
      reservedCaseId: CASE_ID,
    });
    expect(
      writeTotalLossDraft({
        ...baseDraft,
        manual: { ...baseDraft.manual, vehicleYear: "20" },
      }).ok,
    ).toBe(true);
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness({
      details: [
        detailsFor(CASE_ID, {
          intakeMode: "report",
          reportOriginalFilename: "saved-report.pdf",
          reportUploadedAt: CREATED_AT,
        }),
      ],
      recentCase: appraisalCase(CASE_ID),
    });

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });

    expect(await screen.findByText("saved-report.pdf")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Continue to Free Value Check" }),
    ).toBeEnabled();
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: {
        dirty: true,
        manual: { vehicleYear: "20" },
      },
    });
  });

  it("preserves inactive manual and report data while switching modes", async () => {
    const savedDetails = detailsFor(CASE_ID, {
      intakeMode: "report",
      vin: "1HGCM82633A004352",
      vehicleYear: 2020,
      vehicleMake: "Honda",
      vehicleModel: "Accord",
      mileageAtLoss: 48250,
      reportOriginalFilename: "saved-report.pdf",
      reportUploadedAt: CREATED_AT,
    });
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness({
      details: [savedDetails],
      recentCase: appraisalCase(CASE_ID),
    });
    const user = userEvent.setup();

    renderTestApp([`/start?service=total-loss&caseId=${CASE_ID}`], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });
    await waitFor(() =>
      expect(harness.detailsService.getDetails).toHaveBeenCalledWith({
        caseId: CASE_ID,
        userId: USER_ID,
      }),
    );
    await waitFor(() =>
      expect(readTotalLossDraft()).toMatchObject({
        ok: true,
        draft: { step: "report", mode: "report" },
      }),
    );
    expect(await screen.findByText("saved-report.pdf")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Back" }));
    await chooseMode(user, "I don’t have the report");

    expect(
      await screen.findByRole("heading", {
        name: "Tell us about your vehicle",
      }),
    ).toBeVisible();
    expect(screen.getByLabelText("VIN")).toHaveValue("1HGCM82633A004352");
    expect(screen.getByText("Vehicle: 2020 Honda Accord")).toBeVisible();
    expect(harness.detailRows.get(CASE_ID)).toMatchObject({
      intakeMode: "manual",
      intakeCompletedAt: null,
      reportOriginalFilename: "saved-report.pdf",
    });

    await user.click(screen.getByRole("button", { name: "Back" }));
    await chooseMode(user, "I have my valuation report");
    expect(await screen.findByText("saved-report.pdf")).toBeVisible();
    expect(harness.detailRows.get(CASE_ID)).toMatchObject({
      intakeMode: "report",
      intakeCompletedAt: null,
      vin: "1HGCM82633A004352",
    });
  });

  it("retains a dirty browser draft and offers a choice on an optimistic save conflict", async () => {
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness();
    const user = userEvent.setup();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(CASE_ID);

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });
    await chooseMode(user, "I don’t have the report");
    await waitFor(() => expect(harness.saveDetails).toHaveBeenCalledOnce());

    const newerServerDetails = detailsFor(CASE_ID, {
      intakeMode: "manual",
      vin: "2HGFC2F59MH500001",
      vehicleYear: 2021,
      vehicleMake: "Honda",
      vehicleModel: "Civic",
      mileageAtLoss: 25000,
    });
    harness.saveDetails.mockRejectedValueOnce(
      new TotalLossDetailsConflictError(newerServerDetails),
    );
    await user.type(screen.getByLabelText("VIN"), "1HGCM82633A004352");

    expect(
      await screen.findByText(
        "This appraisal changed in another session",
        {},
        { timeout: 2000 },
      ),
    ).toBeVisible();
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: {
        dirty: true,
        manual: { vin: "1HGCM82633A004352" },
      },
    });

    await user.click(screen.getByRole("button", { name: "Use saved version" }));
    expect(screen.getByLabelText("VIN")).toHaveValue("2HGFC2F59MH500001");
    expect(screen.getByText("Vehicle: 2021 Honda Civic")).toBeVisible();
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: { dirty: false },
    });
    expect(harness.saveDetails).toHaveBeenCalledTimes(2);
  });

  it("serializes autosaves and coalesces edits made while an older snapshot is saving", async () => {
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness();
    const user = userEvent.setup();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(CASE_ID);

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });
    await chooseMode(user, "I don’t have the report");
    await waitFor(() => expect(harness.saveDetails).toHaveBeenCalledOnce());

    const pendingSave = createDeferred<TotalLossCaseDetails>();
    harness.saveDetails.mockImplementationOnce(() => pendingSave.promise);
    await user.click(
      screen.getByRole("radio", { name: "Select vehicle details" }),
    );
    await waitFor(() => expect(harness.saveDetails).toHaveBeenCalledTimes(2), {
      timeout: 2000,
    });
    await waitFor(() =>
      expect(
        screen.getByRole("radio", { name: "Diminished Value" }),
      ).toBeDisabled(),
    );

    await user.selectOptions(screen.getByLabelText("Year"), "2020");
    await waitFor(() => expect(screen.getByLabelText("Make")).toBeEnabled());
    await user.selectOptions(screen.getByLabelText("Make"), "Honda");
    await waitFor(() => expect(screen.getByLabelText("Model")).toBeEnabled());
    await user.selectOptions(screen.getByLabelText("Model"), "Accord");
    await user.type(screen.getByLabelText("Mileage at date of loss"), "48250");
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 700);
    });
    expect(harness.saveDetails).toHaveBeenCalledTimes(2);

    const firstAutosaveInput = harness.saveDetails.mock.calls[1]?.[0];
    await act(async () => {
      pendingSave.resolve({
        ...detailsFor(CASE_ID),
        ...firstAutosaveInput.values,
        updatedAt: "2026-08-18T16:00:00.000Z",
      });
      await pendingSave.promise;
    });

    await waitFor(() => expect(harness.saveDetails).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(
        screen.getByRole("radio", { name: "Diminished Value" }),
      ).toBeEnabled(),
    );
    expect(harness.saveDetails.mock.calls[2]?.[0]).toMatchObject({
      caseId: CASE_ID,
      expectedUpdatedAt: "2026-08-18T16:00:00.000Z",
      values: {
        vin: null,
        vehicleYear: 2020,
        vehicleMake: "Honda",
        vehicleModel: "Accord",
        mileageAtLoss: 48250,
      },
    });
  });
});
