import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PDFDocument } from "pdf-lib";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AuthService,
  AuthStateChangeListener,
} from "@/features/auth/auth-service";
import type {
  TurnstileAction,
  TurnstileController,
} from "@/features/auth/turnstile-controller";
import type { AppraisalCaseService } from "@/features/cases/service";
import { appraisalCaseQueryKeys } from "@/features/cases/queries";
import type { AppraisalCase } from "@/features/cases/types";
import type {
  CustomerProfile,
  CustomerProfileService,
} from "@/features/customer-profile";
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
import type { TotalLossIdentityService } from "@/features/total-loss/identity-service";
import { TotalLossDetailsConflictError } from "@/features/total-loss/service";
import { totalLossQueryKeys } from "@/features/total-loss/queries";
import type { TotalLossReportStorageService } from "@/features/total-loss/storage-service";
import type { TotalLossDraft } from "@/features/total-loss/types";
import {
  VehicleLookupError,
  type VehicleLookupService,
  type VehicleTrimOption,
} from "@/features/total-loss/vehicle-lookup-service";
import { renderTestApp as renderBaseTestApp } from "@/test/render";

const { ingestReportMock } = vi.hoisted(() => ({
  ingestReportMock: vi.fn(),
}));

vi.mock("@/features/analyses/api/report-ingestion", () => ({
  ingestTotalLossReport: ingestReportMock,
}));

vi.mock("@/config/product-availability", () => ({
  totalLossManualIntakeAvailable: true,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const RECENT_CASE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_USER_ID = "44444444-4444-4444-8444-444444444444";
const GUEST_USER_ID = "77777777-7777-4777-8777-777777777777";
const REPORT_UPLOAD_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_CASE_ID = "66666666-6666-4666-8666-666666666666";
const NEW_CASE_INTENT_ID = "99999999-9999-4999-8999-999999999999";
const CREATED_AT = "2026-08-18T14:00:00.000Z";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function createPdfFile(name: string) {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  const bytes = await document.save();
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], name, { type: "application/pdf" });
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
      vehicleCondition: "Good",
      optionsPackages: "None known",
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
      email_confirmed_at: CREATED_AT,
      id,
      user_metadata: {},
    },
  } as Session;
}

function anonymousSessionFor(id = GUEST_USER_ID) {
  const session = sessionFor(id);
  session.user.app_metadata = { provider: "anonymous", providers: [] };
  session.user.email = undefined;
  session.user.email_confirmed_at = undefined;
  session.user.is_anonymous = true;
  session.user.user_metadata = {};
  return session;
}

function confirmedProfile(userId = USER_ID): CustomerProfile {
  return {
    userId,
    fullName: "Owner Driver",
    fullNameConfirmedAt: CREATED_AT,
    serviceTermsVersion: "2026-08-23",
    serviceTermsAcknowledgedAt: CREATED_AT,
    privacyNoticeVersion: "2026-08-23",
    privacyNoticeAcknowledgedAt: CREATED_AT,
    operationalFollowUpAllowed: false,
    operationalFollowUpUpdatedAt: CREATED_AT,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function createConfirmedProfileService(): CustomerProfileService {
  return {
    getProfile: vi.fn(async (userId) => confirmedProfile(userId)),
    confirmProfile: vi.fn(async ({ userId }) => confirmedProfile(userId)),
  };
}

function renderTestApp(
  initialEntries: Parameters<typeof renderBaseTestApp>[0],
  options: Parameters<typeof renderBaseTestApp>[1] = {},
) {
  return renderBaseTestApp(initialEntries, {
    customerProfileService: createConfirmedProfileService(),
    ...options,
  });
}

function createAuthHarness(
  initialSession: Session | null,
  guestSession = anonymousSessionFor(),
) {
  let listener: AuthStateChangeListener | null = null;
  let currentSession = initialSession;
  const getSession = vi.fn(async () => currentSession);
  const service: AuthService = {
    exchangeCodeForSession: vi.fn(async () => sessionFor()),
    getSession,
    onAuthStateChange: vi.fn((nextListener) => {
      listener = nextListener;
      return () => undefined;
    }),
    signInAnonymously: vi.fn(async () => {
      currentSession = guestSession;
      return guestSession;
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
      currentSession = session;
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
  vehicleCondition: null,
  optionsPackages: null,
  reportUploadRecoveryRequired: false,
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
  const getOrCreateTotalLossDraft = vi.fn<
    AppraisalCaseService["getOrCreateTotalLossDraft"]
  >(async ({ userId }) => {
    const newest = [...cases.values()]
      .filter((candidate) => candidate.userId === userId)
      .sort((left, right) =>
        right.lastActivityAt.localeCompare(left.lastActivityAt),
      )[0];
    if (newest) return newest;
    const created = appraisalCase(
      userId === USER_ID ? CASE_ID : OTHER_CASE_ID,
      userId,
    );
    cases.set(created.id, created);
    return created;
  });

  const caseService: AppraisalCaseService = {
    createAppraisalCase: vi.fn(async ({ userId }) =>
      appraisalCase(CASE_ID, userId),
    ),
    createOrGetAppraisalCase,
    listAppraisalCases: vi.fn(async () => [...cases.values()]),
    getRecentDraftAppraisalCase: vi.fn(async () => recentCase),
    getOrCreateTotalLossDraft,
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
      vehicleConfiguration: null,
      reportUploadRecoveryRequired: false,
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
  >(async ({ caseId }) => {
    const current = detailRows.get(caseId);
    if (current) {
      detailRows.set(caseId, {
        ...current,
        reportUploadRecoveryRequired: true,
      });
    }
    return reportLeaseFor(caseId);
  });
  const reclaimReportUploadLease = vi.fn<
    TotalLossDetailsService["reclaimReportUploadLease"]
  >(async ({ caseId }) => {
    const current = detailRows.get(caseId);
    if (current) {
      detailRows.set(caseId, {
        ...current,
        reportUploadRecoveryRequired: true,
      });
    }
    return {
      ...reportLeaseFor(caseId),
      recoveryRequired: true,
    };
  });
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
  >(async ({ caseId }) => {
    const current =
      detailRows.get(caseId) ?? detailsFor(caseId, { intakeMode: "report" });
    const next = {
      ...current,
      reportUploadRecoveryRequired: false,
    };
    detailRows.set(caseId, next);
    return next;
  });
  const confirmIntake = vi.fn<
    NonNullable<TotalLossDetailsService["confirmIntake"]>
  >(async ({ caseId, expectedUpdatedAt }) => {
    const current = detailRows.get(caseId);
    if (!current || current.updatedAt !== expectedUpdatedAt) {
      throw new TotalLossDetailsConflictError(current ?? null);
    }
    updateSequence += 1;
    const next: TotalLossCaseDetails = {
      ...current,
      intakeCompletedAt: CREATED_AT,
      updatedAt: `2026-08-18T18:${String(updateSequence).padStart(2, "0")}:00.000Z`,
    };
    detailRows.set(caseId, next);
    return next;
  });

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
    confirmIntake,
    acquireReportUploadLease,
    reclaimReportUploadLease,
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
  const listTrims = vi.fn<VehicleLookupService["listTrims"]>(
    async ({ make, model }) =>
      make === "Toyota" && model === "Camry"
        ? ["LE", "SE", "XLE"].map(vehicleTrimOption)
        : ["EX", "EX-L", "EX-V6"].map(vehicleTrimOption),
  );
  const vehicleLookupService: VehicleLookupService = {
    decodeVin,
    listMakes,
    listModels,
    listTrims,
  };
  const getContact = vi.fn<TotalLossIdentityService["getContact"]>(
    async () => null,
  );
  const saveContactAndBeginClaim = vi.fn<
    TotalLossIdentityService["saveContactAndBeginClaim"]
  >(async (input) => ({
    claimId: "88888888-8888-4888-8888-888888888888",
    expiresAt: "2026-08-24T14:00:00.000Z",
    contact: {
      caseId: input.caseId,
      firstName: input.firstName,
      lastName: input.lastName,
      fullName: `${input.firstName} ${input.lastName}`,
      email: input.email,
      phoneNumber: input.phoneNumber,
      emailVerifiedAt: null,
      serviceTermsVersion: input.serviceTermsVersion,
      serviceTermsAcknowledgedAt: CREATED_AT,
      privacyNoticeVersion: input.privacyNoticeVersion,
      privacyNoticeAcknowledgedAt: CREATED_AT,
      operationalFollowUpAllowed: input.operationalFollowUpAllowed,
      operationalFollowUpUpdatedAt: CREATED_AT,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
  }));
  const identityService: TotalLossIdentityService = {
    getContact,
    saveContactAndBeginClaim,
    completeIdentityClaim: vi.fn(async () => undefined),
  };
  const dependencies: TotalLossDependencies = {
    appraisalCaseService: caseService,
    totalLossDetailsService: detailsService,
    totalLossReportStorageService: storageService,
    totalLossIdentityService: identityService,
    vehicleLookupService,
  };

  return {
    caseService,
    createOrGetAppraisalCase,
    getOrCreateTotalLossDraft,
    dependencies,
    detailRows,
    detailsService,
    acquireReportUploadLease,
    reclaimReportUploadLease,
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
    listTrims,
    getContact,
    saveContactAndBeginClaim,
    confirmIntake,
  };
}

function vehicleTrimOption(trim: string): VehicleTrimOption {
  return {
    source: "marketcheck",
    id: `marketcheck-trim-${trim.toLowerCase()}`,
    label: trim,
    trim,
    queryField: "trim",
    queryValues: [trim],
  };
}

async function chooseMode(
  user: ReturnType<typeof userEvent.setup>,
  label: "I have my valuation report" | "I don’t have the report",
) {
  await user.click(
    await screen.findByRole("radio", { name: new RegExp(label, "i") }),
  );
  await user.click(
    withinIntakeFlow().getByRole("button", { name: "Continue" }),
  );
  await screen.findByRole("heading", {
    name:
      label === "I have my valuation report"
        ? "Upload your valuation report"
        : "Tell us about your vehicle",
  });
}

function withinIntakeFlow() {
  const flow = document.querySelector<HTMLElement>(
    "[data-appraisal-start-flow]",
  );
  if (!flow) throw new Error("Appraisal intake flow was not rendered.");
  return within(flow);
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  ingestReportMock.mockReset().mockResolvedValue({
    status: "partial",
    provider: null,
    adapter: "generic",
    confidence: "low",
    warnings: ["The report provider could not be identified."],
    missingFields: ["trim"],
    facts: {
      vin: null,
      vehicleYear: 2020,
      make: "Honda",
      model: "Accord",
      trim: null,
      mileageAtLoss: 48250,
      zipCode: "60611",
      dateOfLoss: "2026-08-18",
      insurerName: "Example Insurance",
      insurerVehicleValuation: 18750,
      vehicleCondition: "Good",
      optionsPackages: "None known",
    },
  });
});

describe("/start?service=total-loss", () => {
  it.each([
    {
      path: "/start?service=total-loss",
      label: /I have my valuation report/i,
      heading: "Upload your valuation report",
      mode: "report",
    },
    {
      path: `/start?service=total-loss&newCaseId=${NEW_CASE_INTENT_ID}`,
      label: /I don’t have the report/i,
      heading: "Tell us about your vehicle",
      mode: "manual",
    },
  ])("opens $mode intake immediately through delayed secure setup", async ({ path, label, heading, mode }) => {
    const session = createDeferred<Session | null>();
    const guest = createDeferred<Session>();
    const bootstrap = createDeferred<AppraisalCase>();
    const details = createDeferred<TotalLossCaseDetails | null>();
    const auth = createAuthHarness(null);
    auth.getSession.mockReturnValue(session.promise);
    auth.service.signInAnonymously = vi.fn(() => guest.promise);
    const harness = createDependencyHarness();
    harness.getOrCreateTotalLossDraft.mockReturnValue(bootstrap.promise);
    harness.detailsService.getDetails = vi.fn(() => details.promise);

    renderTestApp([path], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });

    const choice = screen.getByRole("radio", { name: label });
    const assertOpeningChoice = () => {
      expect(screen.getByRole("radio", { name: label })).toBe(choice);
      expect(choice).toBeEnabled();
      expect(screen.queryByText("Loading your saved appraisal…")).not.toBeInTheDocument();
      expect(document.querySelector("[data-appraisal-start-flow] .animate-spin")).toBeNull();
      expect(harness.saveDetails).not.toHaveBeenCalled();
      expect(harness.uploadReport).not.toHaveBeenCalled();
    };
    assertOpeningChoice();
    fireEvent.click(choice);
    expect(choice).toBeChecked();

    await act(async () => session.resolve(null));
    await waitFor(() => expect(auth.service.signInAnonymously).toHaveBeenCalledOnce());
    assertOpeningChoice();
    await act(async () => guest.resolve(anonymousSessionFor()));
    await waitFor(() => expect(harness.getOrCreateTotalLossDraft).toHaveBeenCalledOnce());
    assertOpeningChoice();
    await act(async () => bootstrap.resolve(appraisalCase(OTHER_CASE_ID, GUEST_USER_ID)));
    await waitFor(() => expect(harness.detailsService.getDetails).toHaveBeenCalled());
    assertOpeningChoice();

    fireEvent.click(withinIntakeFlow().getByRole("button", { name: "Continue" }));
    expect(withinIntakeFlow().getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.queryByText("Loading your saved appraisal…")).not.toBeInTheDocument();
    expect(harness.saveDetails).not.toHaveBeenCalled();

    await act(async () => details.resolve(null));
    expect(await screen.findByRole("heading", { name: heading })).toBeVisible();
    await waitFor(() => expect(harness.saveDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: OTHER_CASE_ID,
        userId: GUEST_USER_ID,
        values: expect.objectContaining({ intakeMode: mode }),
      }),
    ));
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
  });

  it("restores server details without overwriting them with an early opening choice", async () => {
    const auth = createAuthHarness(sessionFor());
    const saved = detailsFor(CASE_ID, {
      intakeMode: "manual",
      vin: "1HGCM82633A004352",
      vehicleYear: 2020,
      vehicleMake: "Honda",
      vehicleModel: "Accord",
    });
    const details = createDeferred<TotalLossCaseDetails | null>();
    const harness = createDependencyHarness({ details: [saved] });
    harness.detailsService.getDetails = vi.fn(() => details.promise);
    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });
    fireEvent.click(screen.getByRole("radio", { name: /I have my valuation report/i }));
    fireEvent.click(withinIntakeFlow().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(harness.detailsService.getDetails).toHaveBeenCalled());
    expect(harness.saveDetails).not.toHaveBeenCalled();
    await act(async () => details.resolve(saved));
    expect(await screen.findByLabelText("VIN")).toHaveValue(saved.vin);
    expect(harness.saveDetails).not.toHaveBeenCalled();
    expect(harness.uploadReport).not.toHaveBeenCalled();
  });

  it("starts signed-out visitors with a hidden anonymous session and durable guest draft", async () => {
    const auth = createAuthHarness(null);
    const harness = createDependencyHarness();

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });

    const pageHeading = screen.getByRole("heading", { level: 1 });
    expect(pageHeading).toBeVisible();
    const layout = pageHeading.closest("[data-total-loss-layout]");
    expect(layout).toHaveClass(
      "lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]",
    );
    const reportChoice =
      screen.getByRole("group", {
        name: "Do you have your insurance valuation report?",
      });
    expect(reportChoice).toBeVisible();
    expect(reportChoice.closest("[data-flow-card]")).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /I have my valuation report/i }),
    ).toBeEnabled();
    expect(
      screen.getByRole("radio", { name: /I don’t have the report/i }),
    ).toBeEnabled();
    expect(screen.queryByText(/Sign in before starting/i)).not.toBeInTheDocument();
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
    expect(signInButton.previousElementSibling).toHaveClass(
      "text-xs",
      "text-copy/80",
    );
    expect(screen.queryByRole("dialog", { name: /Sign in/i })).not.toBeInTheDocument();

    await waitFor(() =>
      expect(auth.service.signInAnonymously).toHaveBeenCalledOnce(),
    );
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(harness.getOrCreateTotalLossDraft).toHaveBeenCalledWith({
        userId: GUEST_USER_ID,
      }),
    );
    expect(harness.uploadReport).not.toHaveBeenCalled();
    await waitFor(() => expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: {
        confirmedCaseId: OTHER_CASE_ID,
        reservedCaseId: OTHER_CASE_ID,
        ownerUserId: GUEST_USER_ID,
      },
    }));
  });

  it.each([
    {
      error: new Error("CAPTCHA provider returned private diagnostic data"),
      expected: "We couldn’t complete the security check. Please try again.",
    },
    {
      error: new Error("Failed to fetch internal guest-auth endpoint"),
      expected:
        "We couldn’t reach the sign-in service. Check your connection and try again.",
    },
    {
      error: Object.assign(new Error("private upstream throttle detail"), {
        status: 429,
      }),
      expected:
        "Too many sign-in attempts. Please wait a few minutes and try again.",
    },
  ])(
    "bounds a guest bootstrap failure as: $expected",
    async ({ error, expected }) => {
      const auth = createAuthHarness(null);
      const signInAnonymously = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(anonymousSessionFor());
      auth.service.signInAnonymously = signInAnonymously;
      const user = userEvent.setup();

      renderTestApp(["/start?service=total-loss"], {
        authService: auth.service,
        totalLossDependencies: createDependencyHarness().dependencies,
      });

      expect(await screen.findByText(expected)).toBeVisible();
      expect(screen.queryByText(error.message)).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Try again" }));
      expect(
        await screen.findByRole("group", {
          name: "Do you have your insurance valuation report?",
        }),
      ).toBeVisible();
      expect(signInAnonymously).toHaveBeenCalledTimes(2);
    },
  );

  it("applies the same bounded guest-auth mapping when a retry fails", async () => {
    const auth = createAuthHarness(null);
    const retryError = Object.assign(
      new Error("private retry throttle diagnostic"),
      { status: 429 },
    );
    const signInAnonymously = vi
      .fn()
      .mockRejectedValueOnce(new Error("private initial auth diagnostic"))
      .mockRejectedValueOnce(retryError);
    auth.service.signInAnonymously = signInAnonymously;
    const user = userEvent.setup();

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: createDependencyHarness().dependencies,
    });

    expect(
      await screen.findByText(
        "Venfour could not prepare secure guest storage. Try again.",
      ),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByText(
        "Too many sign-in attempts. Please wait a few minutes and try again.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(retryError.message)).not.toBeInTheDocument();
    expect(signInAnonymously).toHaveBeenCalledTimes(2);
  });

  it("cancels guest authentication when SPA navigation leaves Total Loss", async () => {
    const auth = createAuthHarness(null);
    const challengeStarted = createDeferred<void>();
    let challengeSignal: AbortSignal | undefined;
    const turnstileController: TurnstileController = {
      async runWithToken<T>(
        _action: TurnstileAction,
        _operation: (captchaToken: string) => Promise<T>,
        signal?: AbortSignal,
      ): Promise<T> {
        challengeSignal = signal;
        challengeStarted.resolve();
        return await new Promise<T>((_resolve, reject) => {
          if (!signal) {
            reject(new Error("The security check requires cancellation."));
            return;
          }
          const interrupt = () =>
            reject(
              new Error(
                "The security check was interrupted. Please try again.",
              ),
            );
          if (signal.aborted) {
            interrupt();
            return;
          }
          signal.addEventListener("abort", interrupt, { once: true });
        });
      },
    };

    const { router } = renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      authTurnstileController: turnstileController,
      totalLossDependencies: createDependencyHarness().dependencies,
    });

    await challengeStarted.promise;
    expect(challengeSignal?.aborted).toBe(false);
    await act(async () => router.navigate("/"));

    await waitFor(() => expect(challengeSignal?.aborted).toBe(true));
    expect(auth.service.signInAnonymously).not.toHaveBeenCalled();
  });

  it("stores no guest access or refresh token in the browser intake draft", async () => {
    const auth = createAuthHarness(null);

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: createDependencyHarness().dependencies,
    });

    await screen.findByRole("group", {
      name: "Do you have your insurance valuation report?",
    });
    await waitFor(() => expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: { ownerUserId: GUEST_USER_ID },
    }));
    const serialized = window.localStorage.getItem(
      "venfour.totalLossDraft.v1",
    );
    expect(serialized).toContain(GUEST_USER_ID);
    expect(serialized).not.toContain(`access-${GUEST_USER_ID}`);
    expect(serialized).not.toContain(`refresh-${GUEST_USER_ID}`);
  });

  it("keeps the opening choices stable while preparing a durable server draft", async () => {
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness();
    const bootstrap = createDeferred<AppraisalCase>();
    harness.getOrCreateTotalLossDraft.mockReturnValueOnce(bootstrap.promise);

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });

    await waitFor(() =>
      expect(harness.getOrCreateTotalLossDraft).toHaveBeenCalledWith({
        userId: USER_ID,
      }),
    );
    const choice = screen.getByRole("radio", { name: /I don’t have the report/i });
    expect(choice).toBeEnabled();
    expect(screen.queryByText("Loading your saved appraisal…")).not.toBeInTheDocument();
    fireEvent.click(choice);
    expect(choice).toBeChecked();
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
    expect(harness.saveDetails).not.toHaveBeenCalled();

    await act(async () => {
      bootstrap.resolve(appraisalCase(CASE_ID));
      await bootstrap.promise;
    });

    expect(
      await screen.findByRole("group", {
        name: "Do you have your insurance valuation report?",
      }),
    ).toBeVisible();
    await waitFor(() => expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: {
        confirmedCaseId: CASE_ID,
        reservedCaseId: CASE_ID,
        ownerUserId: USER_ID,
        mode: "manual",
      },
    }));
    expect(screen.getByRole("radio", { name: /I don’t have the report/i })).toBe(choice);
    expect(choice).toBeChecked();
    expect(choice).toBeEnabled();
    expect(screen.queryByText("Loading your saved appraisal…")).not.toBeInTheDocument();
  });

  it("starts another appraisal with one URL intent across reloads", async () => {
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness({
      recentCase: appraisalCase(OTHER_CASE_ID),
    });
    const newCasePath =
      `/start?service=total-loss&newCaseId=${NEW_CASE_INTENT_ID}`;
    writeTotalLossDraft(
      createSensitiveManualDraft({
        confirmedCaseId: CASE_ID,
        reservedCaseId: CASE_ID,
        step: "ready",
      }),
    );

    const firstRender = renderTestApp([newCasePath], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });

    expect(
      await screen.findByRole("group", {
        name: "Do you have your insurance valuation report?",
      }),
    ).toBeVisible();
    expect(harness.getOrCreateTotalLossDraft).toHaveBeenCalledWith({
      userId: USER_ID,
    });
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: {
        confirmedCaseId: OTHER_CASE_ID,
        reservedCaseId: OTHER_CASE_ID,
        ownerUserId: USER_ID,
        mode: null,
        manual: {
          make: "",
          model: "",
          vin: "",
        },
      },
    });

    firstRender.unmount();
    renderTestApp([newCasePath], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });

    expect(
      await screen.findByRole("group", {
        name: "Do you have your insurance valuation report?",
      }),
    ).toBeVisible();
    expect(harness.getOrCreateTotalLossDraft).toHaveBeenCalledTimes(2);
    expect(harness.getOrCreateTotalLossDraft).toHaveBeenLastCalledWith({
      userId: USER_ID,
    });
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
  });

  it("retries a new-case bootstrap with the same URL reservation", async () => {
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness({
      recentCase: appraisalCase(OTHER_CASE_ID),
    });
    const user = userEvent.setup();
    harness.getOrCreateTotalLossDraft.mockRejectedValueOnce(
      new Error("temporary create failure"),
    );

    const { router } = renderTestApp(
      [`/start?service=total-loss&newCaseId=${NEW_CASE_INTENT_ID}`],
      {
        authService: auth.service,
        totalLossDependencies: harness.dependencies,
      },
    );

    expect(
      await screen.findByText(
        "Your durable Total Loss draft could not be prepared. No report has been requested or uploaded.",
      ),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("group", {
        name: "Do you have your insurance valuation report?",
      }),
    ).toBeVisible();
    expect(harness.getOrCreateTotalLossDraft).toHaveBeenCalledTimes(2);
    for (const [input] of harness.getOrCreateTotalLossDraft.mock.calls) {
      expect(input).toEqual({ userId: USER_ID });
    }
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
    expect(
      new URLSearchParams(router.state.location.search).get("newCaseId"),
    ).toBe(NEW_CASE_INTENT_ID);
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: {
        confirmedCaseId: OTHER_CASE_ID,
        reservedCaseId: OTHER_CASE_ID,
      },
    });
  });

  it("uses one atomic server draft under StrictMode", async () => {
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness();
    const user = userEvent.setup();

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      strictMode: true,
      totalLossDependencies: harness.dependencies,
    });
    await screen.findByRole("radio", { name: /I don’t have the report/i });
    await chooseMode(user, "I don’t have the report");

    expect(harness.getOrCreateTotalLossDraft).toHaveBeenCalledOnce();
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
    expect(harness.lostInsertAttempts).toBe(0);
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
    const auth = createAuthHarness(sessionFor());
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
    await user.click(screen.getByRole("button", { name: "Find vehicle" }));

    const confirmedVehicle = await screen.findByRole("region", {
      name: "Confirmed vehicle details",
    });
    expect(within(confirmedVehicle).getByText("2003")).toBeVisible();
    expect(within(confirmedVehicle).getByText("Honda")).toBeVisible();
    expect(within(confirmedVehicle).getByText("Accord")).toBeVisible();
    expect(
      within(confirmedVehicle).queryByRole("textbox", { name: "Year" }),
    ).not.toBeInTheDocument();
    expect(
      within(confirmedVehicle).queryByRole("textbox", { name: "Make" }),
    ).not.toBeInTheDocument();
    expect(
      within(confirmedVehicle).queryByRole("textbox", { name: "Model" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Trim")).toHaveValue(
      "__legacy-current-trim__",
    );
    expect(harness.listTrims).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("heading", { name: "Add the claim details" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Confirm vehicle & continue" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Add the claim details" }),
    ).toBeVisible();
    await user.type(screen.getByLabelText("Mileage at time of loss"), "50000");
    expect(screen.getByLabelText("Mileage at time of loss")).toHaveValue(
      "50,000",
    );
    expect(screen.getByText("Vehicle: 2003 Honda Accord EX-V6")).toBeVisible();
    expect(harness.decodeVin).toHaveBeenCalledWith("1HGCM82633A004352");
    const progress = screen.getByRole("list", { name: "Appraisal steps" });
    expect(progress.children).toHaveLength(4);
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
          trim: "EX-V6",
          mileageAtLoss: "50,000",
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

  it.each(["", "Retired EX-L label"])(
    "canonicalizes a hydrated provider identity with saved trim %j",
    async (savedTrim) => {
      const localDraft: TotalLossDraft = {
        ...createEmptyTotalLossDraft(new Date(CREATED_AT)),
        mode: "manual",
        step: "vehicle",
        manual: {
          ...createEmptyTotalLossDraft(new Date(CREATED_AT)).manual,
          vehicleYear: "2020",
          make: "Honda",
          model: "Accord",
          trim: savedTrim,
        },
        vehicleConfiguration: {
          source: "marketcheck",
          field: "trim",
          values: ["EX-L"],
        },
        dirty: true,
        revision: 4,
      };
      expect(writeTotalLossDraft(localDraft)).toEqual({ ok: true });
      const auth = createAuthHarness(sessionFor());
      const harness = createDependencyHarness();
      const user = userEvent.setup();

      renderTestApp(["/start?service=total-loss"], {
        authService: auth.service,
        totalLossDependencies: harness.dependencies,
      });

      await screen.findByRole("option", { name: "EX-L" });
      expect(screen.getByLabelText("Trim")).toHaveValue(
        "marketcheck-trim-ex-l",
      );
      await user.click(
        screen.getByRole("button", { name: "Confirm vehicle & continue" }),
      );

      expect(
        await screen.findByRole("heading", { name: "Add the claim details" }),
      ).toBeVisible();
      expect(screen.getByText("Vehicle: 2020 Honda Accord EX-L")).toBeVisible();
      expect(readTotalLossDraft()).toMatchObject({
        ok: true,
        draft: {
          step: "claim",
          manual: { trim: "EX-L" },
          vehicleConfiguration: {
            source: "marketcheck",
            field: "trim",
            values: ["EX-L"],
          },
        },
      });
    },
  );

  it(
    "keeps a VIN-provided trim usable without requesting generated trims",
    async () => {
      const auth = createAuthHarness(sessionFor());
      const harness = createDependencyHarness();
      const user = userEvent.setup();

      renderTestApp(["/start?service=total-loss"], {
        authService: auth.service,
        totalLossDependencies: harness.dependencies,
      });
      await chooseMode(user, "I don’t have the report");
      await user.type(screen.getByLabelText("VIN"), "1hgcm82633a004352");
      await user.click(screen.getByRole("button", { name: "Find vehicle" }));
      await screen.findByRole("region", { name: "Confirmed vehicle details" });
      expect(harness.listTrims).not.toHaveBeenCalled();
      await user.click(
        screen.getByRole("button", { name: "Confirm vehicle & continue" }),
      );

      expect(
        await screen.findByRole("heading", { name: "Add the claim details" }),
      ).toBeVisible();
      expect(readTotalLossDraft()).toMatchObject({
        ok: true,
        draft: {
          step: "claim",
          manual: { trim: "EX-V6" },
          vehicleConfiguration: null,
        },
      });
    },
  );

  it("loads generated trims when VIN decoding does not identify one", async () => {
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness();
    const user = userEvent.setup();
    harness.decodeVin.mockResolvedValueOnce({
      vin: "1HGCM82633A004352",
      year: 2003,
      make: "Honda",
      model: "Accord",
      trim: null,
    });
    harness.listTrims.mockResolvedValueOnce([
      {
        source: "openai",
        id: "openai-trim-ex",
        label: "EX",
        trim: "EX",
        queryField: "trim",
        queryValues: ["EX"],
      },
    ]);

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });
    await chooseMode(user, "I don’t have the report");
    await user.type(screen.getByLabelText("VIN"), "1hgcm82633a004352");
    await user.click(screen.getByRole("button", { name: "Find vehicle" }));

    await screen.findByRole("option", { name: "EX" });
    expect(harness.listTrims).toHaveBeenCalledWith({
      year: 2003,
      make: "Honda",
      model: "Accord",
    });
    await user.selectOptions(screen.getByLabelText("Trim"), "openai-trim-ex");
    await user.click(
      screen.getByRole("button", { name: "Confirm vehicle & continue" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Add the claim details" }),
    ).toBeVisible();
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: {
        manual: { trim: "EX" },
        vehicleConfiguration: null,
      },
    });
  });

  it("uses dependent dropdowns when the user does not have a VIN", async () => {
    const auth = createAuthHarness(sessionFor());
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
    await waitFor(() => expect(screen.getByLabelText("Trim")).toBeEnabled());
    await user.selectOptions(screen.getByLabelText("Trim"), "EX");
    await user.selectOptions(screen.getByLabelText("Make"), "Toyota");
    expect(screen.getByLabelText("Model")).toHaveValue("");
    expect(screen.getByLabelText("Trim")).toHaveValue("");
    expect(screen.getByLabelText("Trim")).toBeDisabled();
    await waitFor(() => expect(screen.getByLabelText("Model")).toBeEnabled());
    await user.selectOptions(screen.getByLabelText("Model"), "Camry");
    await waitFor(() => expect(screen.getByLabelText("Trim")).toBeEnabled());
    await user.selectOptions(screen.getByLabelText("Trim"), "XLE");
    await user.click(
      withinIntakeFlow().getByRole("button", {
        name: "Confirm vehicle & continue",
      }),
    );

    expect(
      await screen.findByRole("heading", { name: "Add the claim details" }),
    ).toBeVisible();
    await user.type(screen.getByLabelText("Mileage at time of loss"), "42000");
    expect(harness.decodeVin).not.toHaveBeenCalled();
    expect(harness.listModels).toHaveBeenLastCalledWith({
      year: 2020,
      make: "Toyota",
    });
    expect(harness.listTrims).toHaveBeenLastCalledWith({
      year: 2020,
      make: "Toyota",
      model: "Camry",
    });
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: {
        manual: {
          vin: "",
          vehicleYear: "2020",
          make: "Toyota",
          model: "Camry",
          trim: "XLE",
          mileageAtLoss: "42,000",
        },
        vehicleConfiguration: {
          source: "marketcheck",
          field: "trim",
          values: ["XLE"],
        },
      },
    });
  });

  it("keeps VIN lookup failures in place and offers the guided fallback", async () => {
    const auth = createAuthHarness(sessionFor());
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
    await user.click(screen.getByRole("button", { name: "Find vehicle" }));

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

  it("does not mount a report input until the guest chooses the report path", async () => {
    const auth = createAuthHarness(null);
    const harness = createDependencyHarness();
    const user = userEvent.setup();

    const { container } = renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });
    expect(
      container.querySelector('input[type="file"]'),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Market ZIP code")).not.toBeInTheDocument();
    await chooseMode(user, "I have my valuation report");
    expect(
      container.querySelector('input[type="file"]'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Market ZIP code")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: /Sign in/i })).not.toBeInTheDocument();
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
    expect(harness.getOrCreateTotalLossDraft).toHaveBeenCalledWith({
      userId: GUEST_USER_ID,
    });
    expect(harness.uploadReport).not.toHaveBeenCalled();
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: { mode: "report", ownerUserId: GUEST_USER_ID },
    });
  });

  it("collects report ZIP during upload and goes directly to analysis through contact", async () => {
    const auth = createAuthHarness(null, anonymousSessionFor(USER_ID));
    const harness = createDependencyHarness();
    const user = userEvent.setup();
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
      "Choose a PDF, JPG/JPEG, or PNG valuation report.",
    );
    expect(harness.uploadReport).not.toHaveBeenCalled();
    expect(ingestReportMock).not.toHaveBeenCalled();

    const report = await createPdfFile("insurer-valuation.pdf");
    fireEvent.change(fileInput, { target: { files: [report] } });

    expect(
      await screen.findByRole("button", { name: "Continue to contact" }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Continue to contact" }));
    expect(await screen.findByText("ZIP code is required.")).toBeVisible();
    await waitFor(() =>
      expect(screen.getByLabelText("Market ZIP code")).toHaveFocus(),
    );
    expect(
      screen.queryByRole("heading", { name: "Contact details" }),
    ).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Market ZIP code"), "606011234");
    await user.click(screen.getByRole("button", { name: "Continue to contact" }));

    expect(
      await screen.findByRole("heading", { name: "Contact details" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: "Market ZIP code" }),
    ).not.toBeInTheDocument();
    expect(harness.uploadReport).toHaveBeenCalledWith({
      caseId: CASE_ID,
      file: report,
      replaceExisting: false,
      uploadId: REPORT_UPLOAD_ID,
      userId: USER_ID,
    });
    expect(harness.finalizeReportUpload).toHaveBeenCalledOnce();
    expect(ingestReportMock).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("heading", { name: "Tell us about your vehicle" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Add the claim details" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Review your details" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/reading your report/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/extracted details/i)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("First name"), "Guest");
    await user.type(screen.getByLabelText("Last name"), "Customer");
    await user.type(screen.getByLabelText("Email address"), "guest@example.com");
    await user.click(screen.getByRole("checkbox", { name: /Terms of Use/i }));
    await user.click(screen.getByRole("checkbox", { name: /Privacy Policy/i }));
    await user.click(
      screen.getByRole("button", { name: "Review & analyze" }),
    );

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/total-loss/cases/${CASE_ID}/analysis`,
      ),
    );
    expect(harness.saveContactAndBeginClaim).toHaveBeenCalledOnce();
    expect(harness.confirmIntake).toHaveBeenCalledWith({
      caseId: CASE_ID,
      userId: USER_ID,
      expectedUpdatedAt: expect.any(String),
    });
    expect(harness.saveDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: CASE_ID,
        values: expect.objectContaining({
          intakeMode: "report",
          postalCode: "60601-1234",
          vehicleYear: null,
          vehicleMake: null,
          vehicleModel: null,
        }),
      }),
    );
    expect(ingestReportMock).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("heading", { name: "Review your details" }),
    ).not.toBeInTheDocument();
  });


  it("shows a late contact-save failure without claiming the analysis can start", async () => {
    expect(
      writeTotalLossDraft(
        createSensitiveManualDraft({
          step: "claim",
          confirmedCaseId: CASE_ID,
          reservedCaseId: CASE_ID,
        }),
      ).ok,
    ).toBe(true);
    const auth = createAuthHarness(anonymousSessionFor(USER_ID));
    const harness = createDependencyHarness();
    harness.saveContactAndBeginClaim.mockRejectedValueOnce(
      new Error("The contact details could not be saved."),
    );
    const user = userEvent.setup();

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });

    expect(
      await screen.findByRole("heading", { name: "Add the claim details" }),
    ).toBeVisible();
    await user.click(withinIntakeFlow().getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByRole("heading", {
        name: "Contact details",
      }),
    ).toBeVisible();
    await user.type(screen.getByLabelText("First name"), "Guest");
    await user.type(screen.getByLabelText("Last name"), "Customer");
    await user.type(screen.getByLabelText("Email address"), "guest@example.com");
    await user.click(screen.getByRole("checkbox", { name: /Terms of Use/i }));
    await user.click(screen.getByRole("checkbox", { name: /Privacy Policy/i }));
    await user.click(
      screen.getByRole("button", { name: "Review & analyze" }),
    );

    expect(
      await screen.findByText("The contact details could not be saved."),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Review your details" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start analysis" })).not.toBeInTheDocument();
  });

  it("bounds a late access-email security error after preserving the intake", async () => {
    expect(
      writeTotalLossDraft(
        createSensitiveManualDraft({
          step: "claim",
          confirmedCaseId: CASE_ID,
          reservedCaseId: CASE_ID,
        }),
      ).ok,
    ).toBe(true);
    const auth = createAuthHarness(anonymousSessionFor(USER_ID));
    const privateDiagnostic =
      "CAPTCHA provider returned private diagnostic data";
    auth.service.sendMagicLink = vi
      .fn()
      .mockRejectedValueOnce(new Error(privateDiagnostic));
    const harness = createDependencyHarness();
    const user = userEvent.setup();

    const { router } = renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });

    expect(
      await screen.findByRole("heading", { name: "Add the claim details" }),
    ).toBeVisible();
    await user.click(withinIntakeFlow().getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByRole("heading", {
        name: "Contact details",
      }),
    ).toBeVisible();
    await user.type(screen.getByLabelText("First name"), "Guest");
    await user.type(screen.getByLabelText("Last name"), "Customer");
    await user.type(screen.getByLabelText("Email address"), "guest@example.com");
    await user.click(screen.getByRole("checkbox", { name: /Terms of Use/i }));
    await user.click(screen.getByRole("checkbox", { name: /Privacy Policy/i }));
    await user.click(
      screen.getByRole("button", { name: "Review & analyze" }),
    );

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/total-loss/cases/${CASE_ID}/analysis`,
      ),
    );
    expect(auth.service.sendMagicLink).toHaveBeenCalledOnce();
    expect(harness.confirmIntake).toHaveBeenCalledOnce();
    expect(screen.queryByText(privateDiagnostic)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Review your details" }),
    ).not.toBeInTheDocument();
  });

  it("atomically resumes the newest saved draft without a browser resume fork", async () => {
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
    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });

    expect(
      await screen.findByRole("heading", {
        name: "Tell us about your vehicle",
      }),
    ).toBeVisible();
    await waitFor(() =>
      expect(readTotalLossDraft()).toMatchObject({
        ok: true,
        draft: {
          manual: {
            vehicleYear: "2021",
            make: "Toyota",
            model: "Camry",
          },
        },
      }),
    );
    expect(
      screen.queryByRole("heading", {
        name: "Continue your saved appraisal?",
      }),
    ).not.toBeInTheDocument();
    expect(harness.getOrCreateTotalLossDraft).toHaveBeenCalledWith({
      userId: USER_ID,
    });
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: {
        confirmedCaseId: RECENT_CASE_ID,
        reservedCaseId: RECENT_CASE_ID,
        ownerUserId: USER_ID,
      },
    });
  });

  it("resumes a completed owned case directly into its analysis experience", async () => {
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
    const { router } = renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/total-loss/cases/${RECENT_CASE_ID}/analysis`,
      ),
    );
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "We’re reviewing and analyzing your claim.",
      }),
    ).toBeVisible();
    expect(screen.queryByText("Your information is ready")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start analysis" })).not.toBeInTheDocument();
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
    expect(harness.saveDetails).not.toHaveBeenCalled();
    expect(harness.uploadReport).not.toHaveBeenCalled();
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

  it.each(["checking", "completed"] as const)(
    "resolves an explicitly referenced %s case without creating a blank draft",
    async (status) => {
      const explicitCase = { ...appraisalCase(CASE_ID), status };
      const auth = createAuthHarness(sessionFor());
      const harness = createDependencyHarness({ recentCase: explicitCase });

      renderTestApp([`/start?service=total-loss&caseId=${CASE_ID}`], {
        authService: auth.service,
        totalLossDependencies: harness.dependencies,
      });

      expect(
        await screen.findByText(
          "This saved appraisal cannot be opened from this link.",
        ),
      ).toBeVisible();
      expect(harness.caseService.getAppraisalCase).toHaveBeenCalledWith({
        caseId: CASE_ID,
        userId: USER_ID,
      });
      expect(
        screen.getByRole("link", { name: "View my appraisals" }),
      ).toHaveAttribute("href", "/appraisals");
      expect(harness.getOrCreateTotalLossDraft).not.toHaveBeenCalled();
      expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
    },
  );

  it("preserves a same-owner local draft when its explicit case is validated", async () => {
    const localDraft = createSensitiveManualDraft({
      confirmedCaseId: CASE_ID,
      reservedCaseId: CASE_ID,
    });
    expect(writeTotalLossDraft(localDraft)).toEqual({ ok: true });
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness({
      recentCase: appraisalCase(CASE_ID),
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
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: {
        confirmedCaseId: CASE_ID,
        reservedCaseId: CASE_ID,
        ownerUserId: USER_ID,
        mode: "manual",
        step: "vehicle",
        manual: {
          make: "Sensitive Make",
          model: "Sensitive Model",
          trim: "Private Trim",
          mileageAtLoss: "48250",
        },
      },
    });
    expect(harness.caseService.getAppraisalCase).toHaveBeenCalledOnce();
  });

  it("does not render owner-bound local fields while session restoration is pending", async () => {
    expect(writeTotalLossDraft(createSensitiveManualDraft())).toEqual({
      ok: true,
    });
    const sessionRestoration = createDeferred<Session | null>();
    const auth = createAuthHarness(null);
    auth.getSession.mockReturnValue(sessionRestoration.promise);
    const harness = createDependencyHarness();

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
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

  it("waits for explicit ownership and resolves that case before preparing a draft", async () => {
    expect(
      writeTotalLossDraft(
        createSensitiveManualDraft({
          ownerUserId: null,
          reservedCaseId: CASE_ID,
          step: "claim",
        }),
      ),
    ).toEqual({ ok: true });
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness();
    const ownership = createDeferred<AppraisalCase | null>();
    harness.caseService.getAppraisalCase = vi.fn(() => ownership.promise);

    const { router } = renderTestApp(
      [`/start?service=total-loss&caseId=${RECENT_CASE_ID}`],
      {
        authService: auth.service,
        totalLossDependencies: harness.dependencies,
      },
    );
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
      await screen.findByRole("heading", { name: "Add the claim details" }),
    ).toBeVisible();
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
    expect(harness.getOrCreateTotalLossDraft).not.toHaveBeenCalled();
    expect(router.state.location.search).toContain(
      `caseId=${RECENT_CASE_ID}`,
    );
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

  it("denies a direct saved-case open under a different signed-in identity", async () => {
    expect(writeTotalLossDraft(createSensitiveManualDraft())).toEqual({
      ok: true,
    });
    const ownerCase = appraisalCase(RECENT_CASE_ID, USER_ID);
    const auth = createAuthHarness(sessionFor(OTHER_USER_ID));
    const harness = createDependencyHarness({ recentCase: ownerCase });
    harness.caseService.getAppraisalCase = vi.fn(async ({ caseId, userId }) =>
      caseId === ownerCase.id && userId === ownerCase.userId ? ownerCase : null,
    );

    renderTestApp(
      [`/start?service=total-loss&view=intake&caseId=${RECENT_CASE_ID}`],
      {
        authService: auth.service,
        totalLossDependencies: harness.dependencies,
      },
    );

    expect(
      await screen.findByText(
        "This saved appraisal cannot be opened from this link.",
      ),
    ).toBeVisible();
    expect(harness.caseService.getAppraisalCase).toHaveBeenCalledWith({
      caseId: RECENT_CASE_ID,
      userId: OTHER_USER_ID,
    });
    expect(screen.queryByLabelText("VIN")).not.toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("Private Insurer"),
    ).not.toBeInTheDocument();
    expect(readTotalLossDraft()).toEqual({ ok: true, draft: null });
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
    expect(harness.saveDetails).not.toHaveBeenCalled();
  });

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
        postalCode: "60611",
        reportOriginalFilename: "private-report.pdf",
        reportUploadedAt: CREATED_AT,
      });
      const auth = createAuthHarness(sessionFor());
      const harness = createDependencyHarness({ details: [savedDetails] });

      const { queryClient } = renderTestApp(["/start?service=total-loss"], {
        authService: auth.service,
        totalLossDependencies: harness.dependencies,
      });
      expect(
        await screen.findByRole("heading", { name: "Contact details" }),
      ).toBeVisible();
      expect(
        queryClient.getQueryData(totalLossQueryKeys.details(USER_ID, CASE_ID)),
      ).toMatchObject({ caseId: CASE_ID });

      act(() => auth.emit(nextSession));

      expect(
        await screen.findByRole("group", {
          name: "Do you have your insurance valuation report?",
        }),
      ).toBeInTheDocument();
      expect(screen.queryByText("private-report.pdf")).not.toBeInTheDocument();
      expect(readTotalLossDraft()).toMatchObject({
        ok: true,
        draft: {
          ownerUserId: nextSession ? OTHER_USER_ID : GUEST_USER_ID,
          confirmedCaseId: OTHER_CASE_ID,
          reservedCaseId: OTHER_CASE_ID,
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
          appraisalCaseQueryKeys.totalLossDraft(USER_ID),
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
          queryClient
            .getQueriesData({
              queryKey: appraisalCaseQueryKeys.user(USER_ID),
            })
            .every(([, data]) => data === undefined),
        ).toBe(true),
      );
      expect(
        queryClient.getQueryData(totalLossQueryKeys.details(USER_ID, CASE_ID)),
      ).toBeUndefined();
      expect(
        queryClient.getQueryData(
          appraisalCaseQueryKeys.detail(USER_ID, CASE_ID),
        ),
      ).toBeUndefined();
      expect(
        queryClient.getQueryData(
          appraisalCaseQueryKeys.totalLossDraft(USER_ID),
        ),
      ).toBeUndefined();
    },
  );

  it("binds a pre-auth local manual step to the atomic server draft", async () => {
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
        vehicleCondition: "",
        optionsPackages: "",
      },
      dirty: true,
      revision: 4,
    };
    expect(writeTotalLossDraft(draft)).toEqual({ ok: true });
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness();

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });

    expect(await screen.findByLabelText("VIN")).toHaveValue(
      "1HGCM82633A004352",
    );
    expect(screen.getByText("Vehicle: 2020 Honda Accord")).toBeVisible();
    expect(harness.createOrGetAppraisalCase).not.toHaveBeenCalled();
    expect(harness.getOrCreateTotalLossDraft).toHaveBeenCalledWith({
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
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: { manual: { mileageAtLoss: "12," } },
    });
  });

  it("routes a dirty legacy report draft with no ZIP back to upload", async () => {
    const legacyDraft = createSensitiveManualDraft({
      mode: "report",
      step: "contact",
      confirmedCaseId: CASE_ID,
      reservedCaseId: CASE_ID,
    });
    expect(
      writeTotalLossDraft({
        ...legacyDraft,
        manual: { ...legacyDraft.manual, zipCode: "" },
      }).ok,
    ).toBe(true);
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness({
      details: [
        detailsFor(CASE_ID, {
          intakeMode: "report",
          reportOriginalFilename: "legacy-report.pdf",
          reportUploadedAt: CREATED_AT,
        }),
      ],
      recentCase: appraisalCase(CASE_ID),
    });

    renderTestApp(["/start?service=total-loss"], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });

    expect(
      await screen.findByRole("heading", {
        name: "Upload your valuation report",
      }),
    ).toBeVisible();
    expect(screen.getByLabelText("Market ZIP code")).toHaveValue("");
    expect(screen.getByText("legacy-report.pdf")).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Contact details" }),
    ).not.toBeInTheDocument();
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: { dirty: true, step: "report" },
    });
  });

  it("preserves report-extracted fields locally until the customer can correct them", async () => {
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
      screen.queryByRole("button", { name: "Review extracted details" }),
    ).not.toBeInTheDocument();
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: {
        dirty: true,
        manual: {
          vin: "1HGCM82633A004352",
          vehicleYear: "20",
          make: "Sensitive Make",
          model: "Sensitive Model",
          trim: "Private Trim",
          mileageAtLoss: "48250",
          zipCode: "60611",
        },
      },
    });
  });

  it("resumes a saved report at contact without re-reading legacy facts", async () => {
    const savedDetails = detailsFor(CASE_ID, {
      intakeMode: "report",
      vin: "1HGCM82633A004352",
      vehicleYear: 2020,
      vehicleMake: "Honda",
      vehicleModel: "Accord",
      vehicleTrim: "EX-L",
      mileageAtLoss: 48250,
      postalCode: "60611",
      reportOriginalFilename: "saved-report.pdf",
      reportUploadedAt: CREATED_AT,
    });
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness({
      details: [savedDetails],
      recentCase: appraisalCase(CASE_ID),
    });

    renderTestApp([`/start?service=total-loss&caseId=${CASE_ID}`], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });

    expect(
      await screen.findByRole("heading", { name: "Contact details" }),
    ).toBeVisible();
    expect(screen.queryByLabelText("Market ZIP code")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Tell us about your vehicle" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/reading your report/i)).not.toBeInTheDocument();
    expect(ingestReportMock).not.toHaveBeenCalled();
    expect(harness.detailRows.get(CASE_ID)).toEqual(savedDetails);
  });


  it.each(["failed", "pending"] as const)(
    "defers a saved report with legacy %s extraction state until final analysis",
    async (reportExtractionStatus) => {
      const savedDetails = detailsFor(CASE_ID, {
        intakeMode: "report",
        reportOriginalFilename: `${reportExtractionStatus}-report.pdf`,
        reportUploadedAt: CREATED_AT,
        reportExtractionStatus,
      });
      const auth = createAuthHarness(sessionFor());
      const harness = createDependencyHarness({
        details: [savedDetails],
        recentCase: appraisalCase(CASE_ID),
      });

      renderTestApp([`/start?service=total-loss&caseId=${CASE_ID}`], {
        authService: auth.service,
        totalLossDependencies: harness.dependencies,
      });

      expect(
        await screen.findByRole("heading", {
          name: "Upload your valuation report",
        }),
      ).toBeVisible();
      expect(screen.getByLabelText("Market ZIP code")).toHaveValue("");
      expect(screen.getByText(`${reportExtractionStatus}-report.pdf`)).toBeVisible();
      expect(
        screen.queryByRole("heading", { name: "Contact details" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/reading your report/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/extracted details/i)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "Review your details" }),
      ).not.toBeInTheDocument();
      expect(ingestReportMock).not.toHaveBeenCalled();
    },
  );


  it("keeps contact gated while a replacement upload lease is pending", async () => {
    const pendingLease = createDeferred<TotalLossReportUploadLease>();
    const readyDetails = detailsFor(CASE_ID, {
      intakeMode: "report",
      postalCode: "60611",
      reportOriginalFilename: "ready-report.pdf",
      reportUploadedAt: CREATED_AT,
    });
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness({
      details: [readyDetails],
      recentCase: appraisalCase(CASE_ID),
    });
    harness.acquireReportUploadLease.mockReturnValueOnce(pendingLease.promise);
    const user = userEvent.setup();

    const { container } = renderTestApp(
      [`/start?service=total-loss&caseId=${CASE_ID}`],
      {
        authService: auth.service,
        totalLossDependencies: harness.dependencies,
      },
    );

    expect(
      await screen.findByRole("heading", { name: "Contact details" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      await screen.findByRole("heading", {
        name: "Upload your valuation report",
      }),
    ).toBeVisible();

    const replacement = await createPdfFile("pending-replacement.pdf");
    const fileInput = container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    );
    expect(fileInput).toBeInTheDocument();
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [replacement] },
    });

    await waitFor(() =>
      expect(harness.acquireReportUploadLease).toHaveBeenCalledOnce(),
    );
    expect(screen.getByText("Uploading securely")).toBeVisible();
    expect(screen.getByText("pending-replacement.pdf")).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Contact details" }),
    ).not.toBeInTheDocument();
    expect(harness.uploadReport).not.toHaveBeenCalled();
    expect(harness.finalizeReportUpload).not.toHaveBeenCalled();
    expect(ingestReportMock).not.toHaveBeenCalled();

    await act(async () => {
      pendingLease.resolve({
        uploadId: REPORT_UPLOAD_ID,
        expiresAt: "2026-08-18T16:00:00.000Z",
        detailsUpdatedAt: readyDetails.updatedAt,
        reportOriginalFilename: readyDetails.reportOriginalFilename,
        reportUploadedAt: readyDetails.reportUploadedAt,
        recoveryRequired: false,
      });
      await pendingLease.promise;
    });

    expect(
      await screen.findByRole("heading", { name: "Contact details" }),
    ).toBeVisible();
    expect(harness.uploadReport).toHaveBeenCalledOnce();
    expect(harness.finalizeReportUpload).toHaveBeenCalledOnce();
    expect(ingestReportMock).not.toHaveBeenCalled();
  });


  it("keeps an interrupted replacement recovery-gated after remount", async () => {
    let staleReviewCommitted = false;
    const reviewObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.textContent?.includes("Review your details")) {
            staleReviewCommitted = true;
          }
        }
      }
    });
    reviewObserver.observe(document.body, { childList: true, subtree: true });
    expect(
      writeTotalLossDraft({
        ...createEmptyTotalLossDraft(new Date(CREATED_AT)),
        mode: "report",
        step: "review",
        confirmedCaseId: CASE_ID,
        reservedCaseId: CASE_ID,
        ownerUserId: USER_ID,
        reportExtractionStatus: "partial",
      }),
    ).toEqual({ ok: true });
    const recoveryDetails = detailsFor(CASE_ID, {
      intakeMode: "report",
      vehicleYear: 2020,
      vehicleMake: "Honda",
      vehicleModel: "Accord",
      reportUploadRecoveryRequired: true,
      reportOriginalFilename: "stale-ready-report.pdf",
      reportUploadedAt: CREATED_AT,
      reportExtractionStatus: "needs_confirmation",
    });
    const auth = createAuthHarness(sessionFor());
    const harness = createDependencyHarness({
      details: [recoveryDetails],
      recentCase: appraisalCase(CASE_ID),
    });

    renderTestApp([`/start?service=total-loss&caseId=${CASE_ID}`], {
      authService: auth.service,
      totalLossDependencies: harness.dependencies,
    });

    expect(
      await screen.findByText(
        "Venfour could not confirm the saved report after an interrupted replacement. Choose the report again so we can securely continue.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Upload your valuation report" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Choose report" })).toBeEnabled();
    expect(screen.queryByText("stale-ready-report.pdf")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Review extracted details" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Continue with manual details" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(ingestReportMock).not.toHaveBeenCalled();
    expect(readTotalLossDraft()).toMatchObject({
      ok: true,
      draft: { step: "report", reportExtractionStatus: "idle" },
    });
    reviewObserver.disconnect();
    expect(staleReviewCommitted).toBe(false);
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

  it("keeps the visible page stable while a report choice autosaves", async () => {
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
    await user.click(screen.getByRole("button", { name: "Back" }));

    const intro = document.querySelector("[data-appraisal-start-intro]");
    const flow = document.querySelector("[data-appraisal-start-flow]");
    const transition = document.querySelector("[data-intake-transition]");
    const progress = screen.getByRole("list", { name: "Appraisal steps" });
    const reportChoice = screen
      .getByRole("radio", { name: /I have my valuation report/i })
      .closest("label");
    const noReportChoice = screen
      .getByRole("radio", { name: /I don’t have the report/i })
      .closest("label");
    const pendingSave = createDeferred<TotalLossCaseDetails>();
    harness.saveDetails.mockImplementationOnce(() => pendingSave.promise);

    await user.click(
      screen.getByRole("radio", { name: /I have my valuation report/i }),
    );
    await waitFor(() => expect(harness.saveDetails).toHaveBeenCalledTimes(2), {
      timeout: 2000,
    });

    expect(
      screen.getByRole("radio", { name: "Diminished Value" }),
    ).toBeEnabled();
    expect(document.querySelector("[data-appraisal-start-intro]")).toBe(intro);
    expect(document.querySelector("[data-appraisal-start-flow]")).toBe(flow);
    expect(document.querySelector("[data-intake-transition]")).toBe(transition);
    expect(screen.getByRole("list", { name: "Appraisal steps" })).toBe(
      progress,
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

    const pendingInput = harness.saveDetails.mock.calls[1]?.[0];
    await act(async () => {
      pendingSave.resolve({
        ...detailsFor(CASE_ID),
        ...pendingInput.values,
        updatedAt: "2026-08-18T16:00:00.000Z",
      });
      await pendingSave.promise;
    });
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
    const methodSwitch = document.querySelector(
      "[data-vehicle-method-switch]",
    );
    const methodPanel = document.querySelector(
      '[data-vehicle-method-panel="vin"]',
    );
    const progress = screen.getByRole("list", { name: "Appraisal steps" });
    const heading = screen.getByRole("heading", {
      name: "Tell us about your vehicle",
    });
    await user.click(
      screen.getByRole("radio", { name: "Select vehicle details" }),
    );
    await waitFor(() => expect(harness.saveDetails).toHaveBeenCalledTimes(2), {
      timeout: 2000,
    });
    await waitFor(() =>
      expect(
        screen.getByRole("radio", { name: "Diminished Value" }),
      ).toBeEnabled(),
    );
    expect(screen.getByRole("radio", { name: "Use my VIN" })).toBeEnabled();
    expect(
      screen.getByRole("radio", { name: "Select vehicle details" }),
    ).toBeEnabled();
    expect(document.querySelector("[data-vehicle-method-switch]")).toBe(
      methodSwitch,
    );
    expect(
      document.querySelector('[data-vehicle-method-panel="details"]'),
    ).toBe(methodPanel);
    expect(screen.getByRole("list", { name: "Appraisal steps" })).toBe(
      progress,
    );
    expect(
      screen.getByRole("heading", { name: "Tell us about your vehicle" }),
    ).toBe(heading);

    await user.selectOptions(screen.getByLabelText("Year"), "2020");
    await waitFor(() => expect(screen.getByLabelText("Make")).toBeEnabled());
    await user.selectOptions(screen.getByLabelText("Make"), "Honda");
    await waitFor(() => expect(screen.getByLabelText("Model")).toBeEnabled());
    await user.selectOptions(screen.getByLabelText("Model"), "Accord");
    await waitFor(() => expect(screen.getByLabelText("Trim")).toBeEnabled());
    await user.selectOptions(screen.getByLabelText("Trim"), "EX-L");
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
    expect(harness.saveDetails.mock.calls[2]?.[0]).toMatchObject({
      caseId: CASE_ID,
      expectedUpdatedAt: "2026-08-18T16:00:00.000Z",
      values: {
        vin: null,
        vehicleYear: 2020,
        vehicleMake: "Honda",
        vehicleModel: "Accord",
        vehicleTrim: "EX-L",
        vehicleConfiguration: {
          source: "marketcheck",
          field: "trim",
          values: ["EX-L"],
        },
      },
    });
  });
});
