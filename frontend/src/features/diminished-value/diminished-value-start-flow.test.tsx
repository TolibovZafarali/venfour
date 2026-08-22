import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AuthService,
  AuthStateChangeListener,
} from "@/features/auth/auth-service";
import type { AppraisalCaseService } from "@/features/cases/service";
import type { AppraisalCase } from "@/features/cases/types";
import type { VehicleLookupService } from "@/features/intake";
import { renderTestApp } from "@/test/render";

import { diminishedValueDraftToDetailsValues } from "./data-mappers";
import type { DiminishedValueCaseDetails } from "./data-types";
import type { DiminishedValueDependencies } from "./dependencies";
import {
  createEmptyDiminishedValueDraftEnvelope,
  readDiminishedValueDraftEnvelope,
  writeDiminishedValueDraftEnvelope,
} from "./draft";
import type { DiminishedValueDetailsService } from "./service";
import type {
  DiminishedValueDocumentStorageService,
  DiminishedValueStoredDocument,
} from "./storage-service";
import {
  createEmptyDiminishedValueDraft,
  type DiminishedValueDraft,
} from "./types";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const RECENT_CASE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_CASE_ID = "44444444-4444-4444-8444-444444444444";
const CREATED_AT = "2026-08-19T14:00:00.000Z";
const SUBMITTED_AT = "2026-08-19T16:00:00.000Z";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
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

function createAuthHarness(getSession: () => Promise<Session | null>) {
  let listener: AuthStateChangeListener | null = null;
  const service: AuthService = {
    exchangeCodeForSession: vi.fn(async () => sessionFor()),
    getSession: vi.fn(getSession),
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
    listener: () => listener,
    service,
  };
}

function completeDraft(
  step: DiminishedValueDraft["step"] = "consultation",
): DiminishedValueDraft {
  return {
    ...createEmptyDiminishedValueDraft(),
    step,
    accidentState: "IL",
    accidentDate: "2026-08-01",
    repairStatus: "complete",
    vehicleEntryMethod: "details",
    vehicleYear: "2024",
    make: "Honda",
    model: "Accord",
    trim: "EX-L",
    mileageAtAccident: "31,250",
    currentMileage: "31,900",
    otherPartyAtFault: "yes",
    atFaultInsurer: "Example Mutual",
    repairCost: "$8,750.00",
    repairFacility: "Lakefront Collision",
    structuralDamage: "no",
    airbagDeployment: "no",
    majorRepairDetails: "Replaced the front bumper and left fender.",
    fullName: "Jordan Private",
    email: "jordan.private@example.com",
    phone: "312-555-0123",
    preferredContactMethod: "email",
    availability: "Weekdays after 4 p.m. Central Time",
    notes: "Private case notes",
  };
}

function detailsFor(
  draft: DiminishedValueDraft,
  overrides: Partial<DiminishedValueCaseDetails> = {},
): DiminishedValueCaseDetails {
  const values = diminishedValueDraftToDetailsValues(draft);
  return {
    caseId: CASE_ID,
    draftStep: values.draftStep,
    accidentState: values.accidentState ?? null,
    accidentDate: values.accidentDate ?? null,
    repairStatus: values.repairStatus ?? null,
    vehicleEntryMethod: values.vehicleEntryMethod,
    vin: values.vin ?? null,
    vehicleYear: values.vehicleYear ?? null,
    vehicleMake: values.vehicleMake ?? null,
    vehicleModel: values.vehicleModel ?? null,
    vehicleTrim: values.vehicleTrim ?? null,
    mileageAtAccident: values.mileageAtAccident ?? null,
    currentMileage: values.currentMileage ?? null,
    otherPartyAtFault: values.otherPartyAtFault ?? null,
    atFaultInsurer: values.atFaultInsurer ?? null,
    repairCost: values.repairCost ?? null,
    repairFacility: values.repairFacility ?? null,
    structuralDamage: values.structuralDamage ?? null,
    airbagDeployment: values.airbagDeployment ?? null,
    majorRepairDetails: values.majorRepairDetails ?? null,
    fullName: values.fullName ?? null,
    email: values.email ?? null,
    phone: values.phone ?? null,
    preferredContactMethod: values.preferredContactMethod ?? null,
    availability: values.availability ?? null,
    notes: values.notes ?? null,
    revision: 0,
    submittedAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function appraisalCase(
  status: AppraisalCase["status"],
  id = CASE_ID,
  userId = USER_ID,
): AppraisalCase {
  return {
    id,
    userId,
    serviceType: "diminished_value",
    status,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    lastActivityAt: CREATED_AT,
  };
}

function persistOwnerDraft(
  draft: DiminishedValueDraft,
  options: { dirty?: boolean; serverRevision?: number | null } = {},
) {
  const envelope = {
    ...createEmptyDiminishedValueDraftEnvelope(new Date(CREATED_AT)),
    intake: draft,
    confirmedCaseId: CASE_ID,
    reservedCaseId: CASE_ID,
    ownerUserId: USER_ID,
    dirty: options.dirty ?? false,
    revision: options.dirty ? 4 : 0,
    serverRevision: options.serverRevision ?? 0,
  };
  expect(writeDiminishedValueDraftEnvelope(envelope)).toEqual({ ok: true });
}

function persistAnonymousDraft(
  draft: DiminishedValueDraft,
  reservedCaseId: string | null = null,
) {
  const envelope = {
    ...createEmptyDiminishedValueDraftEnvelope(new Date(CREATED_AT)),
    intake: draft,
    reservedCaseId,
    dirty: true,
    revision: 1,
  };
  expect(writeDiminishedValueDraftEnvelope(envelope)).toEqual({ ok: true });
}

function storedDocument(
  documentId: string,
  file: File,
  caseId = CASE_ID,
  userId = USER_ID,
): DiminishedValueStoredDocument {
  return {
    id: documentId,
    path: `${userId}/${caseId}/diminished-value/${documentId}.pdf`,
    displayFilename: file.name,
    mimeType: "application/pdf",
    extension: "pdf",
    size: file.size,
    createdAt: CREATED_AT,
  };
}

function createDependencyHarness(initialDetails: DiminishedValueCaseDetails) {
  let details = initialDetails;
  let status: AppraisalCase["status"] = initialDetails.submittedAt
    ? "submitted"
    : "draft";
  const storedDocuments: DiminishedValueStoredDocument[] = [];

  const createOrGetAppraisalCase = vi.fn<
    AppraisalCaseService["createOrGetAppraisalCase"]
  >(async ({ caseId, userId }) => appraisalCase(status, caseId, userId));
  const getRecentDraftAppraisalCase = vi.fn<
    AppraisalCaseService["getRecentDraftAppraisalCase"]
  >(async () => null);
  const getAppraisalCase = vi.fn<AppraisalCaseService["getAppraisalCase"]>(
    async ({ caseId, userId }) => appraisalCase(status, caseId, userId),
  );
  const caseService: AppraisalCaseService = {
    createAppraisalCase: vi.fn(async () => appraisalCase(status)),
    createOrGetAppraisalCase,
    listAppraisalCases: vi.fn(async () => [
      appraisalCase(status, details.caseId),
    ]),
    getRecentDraftAppraisalCase,
    getAppraisalCase,
    touchAppraisalCase: vi.fn(async () => appraisalCase(status)),
  };

  const getDetails = vi.fn<DiminishedValueDetailsService["getDetails"]>(
    async () => details,
  );
  const saveDetails = vi.fn<DiminishedValueDetailsService["saveDetails"]>(
    async (input) => {
      details = {
        ...details,
        ...input.values,
        caseId: input.caseId,
        revision: details.revision + 1,
        updatedAt: "2026-08-19T15:00:00.000Z",
      };
      return details;
    },
  );
  const commitSubmission = () => {
    const submittedAt = details.submittedAt ?? SUBMITTED_AT;
    if (details.submittedAt === null) {
      details = {
        ...details,
        submittedAt,
        revision: details.revision + 1,
        updatedAt: submittedAt,
      };
    }
    status = "submitted";
    return {
      caseId: details.caseId,
      status: "submitted" as const,
      submittedAt,
    };
  };
  const submitCase = vi.fn<DiminishedValueDetailsService["submitCase"]>(
    async () => commitSubmission(),
  );
  const detailsService: DiminishedValueDetailsService = {
    getDetails,
    createDetails: vi.fn(async ({ caseId, values }) => {
      details = {
        ...details,
        ...values,
        caseId,
        revision: 0,
      };
      return details;
    }),
    updateDetails: vi.fn(async ({ caseId, changes }) => {
      details = {
        ...details,
        ...changes,
        caseId,
        revision: details.revision + 1,
      };
      return details;
    }),
    saveDetails,
    submitCase,
  };

  const uploadDocument = vi.fn<
    DiminishedValueDocumentStorageService["uploadDocument"]
  >(async ({ caseId, documentId, file, userId }) => {
    const stored = storedDocument(documentId, file, caseId, userId);
    storedDocuments.push(stored);
    return stored;
  });
  const listDocuments = vi.fn<
    DiminishedValueDocumentStorageService["listDocuments"]
  >(async () => [...storedDocuments]);
  const removeDocument = vi.fn<
    DiminishedValueDocumentStorageService["removeDocument"]
  >(async ({ document }) => {
    const index = storedDocuments.findIndex(
      (candidate) => candidate.id === document.id,
    );
    if (index >= 0) storedDocuments.splice(index, 1);
  });
  const documentService: DiminishedValueDocumentStorageService = {
    listDocuments,
    uploadDocument,
    removeDocument,
  };

  const vehicleLookupService: VehicleLookupService = {
    decodeVin: vi.fn(async () => ({
      vin: "1HGCM82633A004352",
      year: 2003,
      make: "Honda",
      model: "Accord",
      trim: "EX-L",
    })),
    listMakes: vi.fn(async () => ["Honda"]),
    listModels: vi.fn(async () => ["Accord"]),
  };

  const dependencies: DiminishedValueDependencies = {
    appraisalCaseService: caseService,
    diminishedValueDetailsService: detailsService,
    diminishedValueDocumentStorageService: documentService,
    vehicleLookupService,
  };

  return {
    caseService,
    commitSubmission,
    createOrGetAppraisalCase,
    dependencies,
    getAppraisalCase,
    getDetails,
    getRecentDraftAppraisalCase,
    listDocuments,
    removeDocument,
    saveDetails,
    submitCase,
    uploadDocument,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("DiminishedValueStartFlow controller", () => {
  it("never renders owner-bound PII while auth is loading or after it resolves signed out", async () => {
    persistOwnerDraft(completeDraft());
    const restoration = createDeferred<Session | null>();
    const auth = createAuthHarness(() => restoration.promise);

    renderTestApp(["/start?service=diminished-value&view=intake"], {
      authService: auth.service,
      diminishedValueDependencies: null,
    });

    await waitFor(() => expect(auth.service.getSession).toHaveBeenCalledOnce());
    expect(screen.getByText("Checking your saved request…")).toBeVisible();
    expect(
      screen.queryByDisplayValue("Jordan Private"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("jordan.private@example.com"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("Private case notes"),
    ).not.toBeInTheDocument();

    await act(async () => {
      restoration.resolve(null);
      await restoration.promise;
    });

    expect(
      await screen.findByRole("heading", {
        name: "Start with the accident details",
      }),
    ).toBeVisible();
    expect(
      screen.queryByDisplayValue("Jordan Private"),
    ).not.toBeInTheDocument();
    expect(readDiminishedValueDraftEnvelope()).toMatchObject({
      ok: true,
      envelope: {
        confirmedCaseId: null,
        ownerUserId: null,
        intake: { fullName: "", email: "", notes: "" },
      },
    });
  });

  it("continues submission after authentication with the same reserved case", async () => {
    const draft = completeDraft();
    persistAnonymousDraft(draft, CASE_ID);
    const harness = createDependencyHarness(detailsFor(draft));
    const auth = createAuthHarness(async () => null);
    const user = userEvent.setup();

    renderTestApp(["/start?service=diminished-value&view=intake"], {
      authService: auth.service,
      diminishedValueDependencies: harness.dependencies,
    });

    expect(
      await screen.findByRole("heading", {
        name: "Prepare your review request",
      }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Request a review" }));
    expect(
      screen.getByRole("heading", { name: "Sign in to Venfour" }),
    ).toBeVisible();
    expect(readDiminishedValueDraftEnvelope()).toMatchObject({
      ok: true,
      envelope: {
        pendingAuthAction: "submit-review",
        reservedCaseId: CASE_ID,
      },
    });

    await act(async () => auth.emit(sessionFor()));
    await user.click(screen.getByRole("button", { name: "Close sign in" }));

    expect(
      await screen.findByRole("heading", {
        name: "Venfour received your review request",
      }),
    ).toBeVisible();
    expect(harness.createOrGetAppraisalCase).toHaveBeenCalledOnce();
    expect(harness.createOrGetAppraisalCase).toHaveBeenCalledWith({
      caseId: CASE_ID,
      serviceType: "diminished_value",
      userId: USER_ID,
    });
    expect(harness.submitCase).toHaveBeenCalledOnce();
    expect(readDiminishedValueDraftEnvelope()).toEqual({
      ok: true,
      envelope: null,
    });
  });

  it("does not submit a reserved case after authentication on a different explicit case", async () => {
    const caseADraft = completeDraft();
    const caseBDraft = {
      ...completeDraft(),
      fullName: "Explicit Case B",
      email: "case-b@example.com",
    };
    persistAnonymousDraft(caseADraft, CASE_ID);
    const harness = createDependencyHarness(detailsFor(caseADraft));
    harness.getDetails.mockImplementation(({ caseId }) =>
      Promise.resolve(
        caseId === OTHER_CASE_ID
          ? detailsFor(caseBDraft, { caseId: OTHER_CASE_ID })
          : detailsFor(caseADraft),
      ),
    );
    const auth = createAuthHarness(async () => null);
    const user = userEvent.setup();

    const { router } = renderTestApp(
      ["/start?service=diminished-value&view=intake"],
      {
        authService: auth.service,
        diminishedValueDependencies: harness.dependencies,
      },
    );

    expect(await screen.findByLabelText("Name")).toHaveValue("Jordan Private");
    await user.click(screen.getByRole("button", { name: "Request a review" }));
    expect(
      screen.getByRole("heading", { name: "Sign in to Venfour" }),
    ).toBeVisible();

    await act(async () => {
      await router.navigate(
        `/start?service=diminished-value&view=intake&caseId=${OTHER_CASE_ID}`,
      );
      auth.emit(sessionFor());
    });
    await user.click(screen.getByRole("button", { name: "Close sign in" }));

    expect(await screen.findByLabelText("Name")).toHaveValue("Explicit Case B");
    expect(harness.createOrGetAppraisalCase).toHaveBeenCalledWith({
      caseId: CASE_ID,
      serviceType: "diminished_value",
      userId: USER_ID,
    });
    expect(harness.saveDetails).not.toHaveBeenCalled();
    expect(harness.submitCase).not.toHaveBeenCalled();
    expect(readDiminishedValueDraftEnvelope()).toMatchObject({
      ok: true,
      envelope: {
        confirmedCaseId: OTHER_CASE_ID,
        pendingAuthAction: null,
      },
    });
  });

  it("resumes the most recent draft when the local intake remains empty", async () => {
    const recentDraft = {
      ...completeDraft(),
      fullName: "Recent Driver",
      email: "recent@example.com",
    };
    const harness = createDependencyHarness(
      detailsFor(recentDraft, { caseId: RECENT_CASE_ID }),
    );
    harness.getRecentDraftAppraisalCase.mockResolvedValue(
      appraisalCase("draft", RECENT_CASE_ID),
    );
    const auth = createAuthHarness(async () => sessionFor());

    const { router } = renderTestApp(
      ["/start?service=diminished-value&view=intake"],
      {
        authService: auth.service,
        diminishedValueDependencies: harness.dependencies,
      },
    );

    expect(await screen.findByLabelText("Name")).toHaveValue("Recent Driver");
    expect(harness.getRecentDraftAppraisalCase).toHaveBeenCalledWith({
      serviceType: "diminished_value",
      userId: USER_ID,
    });
    expect(harness.getAppraisalCase).toHaveBeenCalledWith({
      caseId: RECENT_CASE_ID,
      userId: USER_ID,
    });
    await waitFor(() =>
      expect(
        new URLSearchParams(router.state.location.search).get("caseId"),
      ).toBe(RECENT_CASE_ID),
    );
  });

  it("does not replace a newly entered local draft when a slow recent lookup resolves", async () => {
    const recentLookup = createDeferred<AppraisalCase | null>();
    const recentDraft = {
      ...completeDraft(),
      fullName: "Recent Driver",
    };
    const harness = createDependencyHarness(
      detailsFor(recentDraft, { caseId: RECENT_CASE_ID }),
    );
    harness.getRecentDraftAppraisalCase.mockImplementation(
      () => recentLookup.promise,
    );
    const auth = createAuthHarness(async () => sessionFor());
    const user = userEvent.setup();

    renderTestApp(["/start?service=diminished-value&view=intake"], {
      authService: auth.service,
      diminishedValueDependencies: harness.dependencies,
    });

    await waitFor(() =>
      expect(harness.getRecentDraftAppraisalCase).toHaveBeenCalledOnce(),
    );
    await user.selectOptions(
      screen.getByLabelText("State where the accident occurred"),
      "IL",
    );
    await act(async () => {
      recentLookup.resolve(appraisalCase("draft", RECENT_CASE_ID));
      await recentLookup.promise;
    });

    expect(
      screen.getByLabelText("State where the accident occurred"),
    ).toHaveValue("IL");
    expect(screen.queryByDisplayValue("Recent Driver")).not.toBeInTheDocument();
    expect(harness.getAppraisalCase).not.toHaveBeenCalledWith({
      caseId: RECENT_CASE_ID,
      userId: USER_ID,
    });
  });

  it("gates an explicit case until its authoritative details are loaded", async () => {
    const serverDraft = {
      ...completeDraft(),
      fullName: "Explicit Driver",
    };
    const details = createDeferred<DiminishedValueCaseDetails | null>();
    const harness = createDependencyHarness(detailsFor(serverDraft));
    harness.getDetails.mockImplementationOnce(() => details.promise);
    const auth = createAuthHarness(async () => sessionFor());

    renderTestApp(
      [`/start?service=diminished-value&view=intake&caseId=${CASE_ID}`],
      {
        authService: auth.service,
        diminishedValueDependencies: harness.dependencies,
      },
    );

    expect(
      await screen.findByText("Loading your saved request…"),
    ).toBeVisible();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();

    await act(async () => {
      details.resolve(detailsFor(serverDraft));
      await details.promise;
    });

    expect(await screen.findByLabelText("Name")).toHaveValue("Explicit Driver");
    expect(harness.getAppraisalCase).toHaveBeenCalledWith({
      caseId: CASE_ID,
      userId: USER_ID,
    });
    expect(harness.listDocuments).toHaveBeenCalledWith({
      caseId: CASE_ID,
      userId: USER_ID,
    });
  });

  it("does not copy a prior case draft into an empty explicit case", async () => {
    persistOwnerDraft(completeDraft(), {
      dirty: true,
      serverRevision: 4,
    });
    const harness = createDependencyHarness(detailsFor(completeDraft()));
    harness.getDetails.mockResolvedValue(null);
    const auth = createAuthHarness(async () => sessionFor());

    renderTestApp(
      [`/start?service=diminished-value&view=intake&caseId=${OTHER_CASE_ID}`],
      {
        authService: auth.service,
        diminishedValueDependencies: harness.dependencies,
      },
    );

    expect(
      await screen.findByRole("heading", {
        name: "Start with the accident details",
      }),
    ).toBeVisible();
    expect(
      screen.queryByDisplayValue("Jordan Private"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("Private case notes"),
    ).not.toBeInTheDocument();
    expect(harness.saveDetails).not.toHaveBeenCalled();
    expect(readDiminishedValueDraftEnvelope()).toMatchObject({
      ok: true,
      envelope: {
        confirmedCaseId: OTHER_CASE_ID,
        dirty: false,
        intake: {
          accidentState: "",
          fullName: "",
          notes: "",
          step: "start",
        },
        ownerUserId: USER_ID,
        serverRevision: null,
      },
    });
  });

  it("preserves a same-case local draft while its first details row is pending", async () => {
    persistOwnerDraft(completeDraft(), {
      dirty: true,
      serverRevision: null,
    });
    const harness = createDependencyHarness(detailsFor(completeDraft()));
    harness.getDetails.mockResolvedValue(null);
    const auth = createAuthHarness(async () => sessionFor());

    renderTestApp(
      [`/start?service=diminished-value&view=intake&caseId=${CASE_ID}`],
      {
        authService: auth.service,
        diminishedValueDependencies: harness.dependencies,
      },
    );

    expect(await screen.findByLabelText("Name")).toHaveValue("Jordan Private");
    await waitFor(() => expect(harness.saveDetails).toHaveBeenCalledOnce(), {
      timeout: 2500,
    });
    expect(harness.saveDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: CASE_ID,
        expectedRevision: null,
        userId: USER_ID,
        values: expect.objectContaining({
          fullName: "Jordan Private",
          notes: "Private case notes",
        }),
      }),
    );
  });

  it("reloads an explicitly submitted case into read-only confirmed state", async () => {
    const localDraft = completeDraft();
    persistOwnerDraft(localDraft);
    const submittedDraft = {
      ...localDraft,
      fullName: "Submitted Driver",
    };
    const harness = createDependencyHarness(
      detailsFor(submittedDraft, {
        revision: 3,
        submittedAt: SUBMITTED_AT,
        updatedAt: SUBMITTED_AT,
      }),
    );
    const auth = createAuthHarness(async () => sessionFor());

    renderTestApp(
      [`/start?service=diminished-value&view=intake&caseId=${CASE_ID}`],
      {
        authService: auth.service,
        diminishedValueDependencies: harness.dependencies,
      },
    );

    expect(
      await screen.findByRole("heading", {
        name: "Venfour received your review request",
      }),
    ).toBeVisible();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Request a review" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Choose files")).not.toBeInTheDocument();
    expect(readDiminishedValueDraftEnvelope()).toEqual({
      ok: true,
      envelope: null,
    });
  });

  it("ignores a stale case failure after a different explicit case starts loading", async () => {
    const caseAFetch = createDeferred<AppraisalCase | null>();
    const caseBDetails = createDeferred<DiminishedValueCaseDetails | null>();
    const caseBDraft = {
      ...completeDraft(),
      fullName: "Case B Driver",
      email: "case-b@example.com",
    };
    const harness = createDependencyHarness(detailsFor(completeDraft()));
    harness.getAppraisalCase.mockImplementation(({ caseId }) =>
      caseId === CASE_ID
        ? caseAFetch.promise
        : Promise.resolve(appraisalCase("draft", caseId)),
    );
    harness.getDetails.mockImplementation(({ caseId }) =>
      caseId === OTHER_CASE_ID
        ? caseBDetails.promise
        : Promise.resolve(detailsFor(completeDraft())),
    );
    const auth = createAuthHarness(async () => sessionFor());

    const { router } = renderTestApp(
      [`/start?service=diminished-value&view=intake&caseId=${CASE_ID}`],
      {
        authService: auth.service,
        diminishedValueDependencies: harness.dependencies,
      },
    );

    await waitFor(() =>
      expect(harness.getAppraisalCase).toHaveBeenCalledWith({
        caseId: CASE_ID,
        userId: USER_ID,
      }),
    );
    await act(async () => {
      await router.navigate(
        `/start?service=diminished-value&view=intake&caseId=${OTHER_CASE_ID}`,
      );
    });
    await waitFor(() =>
      expect(harness.getDetails).toHaveBeenCalledWith({
        caseId: OTHER_CASE_ID,
        userId: USER_ID,
      }),
    );

    await act(async () => {
      caseAFetch.reject(new Error("case A failed"));
      await caseAFetch.promise.catch(() => undefined);
    });
    expect(screen.getByText("Loading your saved request…")).toBeVisible();

    await act(async () => {
      caseBDetails.resolve(detailsFor(caseBDraft, { caseId: OTHER_CASE_ID }));
      await caseBDetails.promise;
    });

    expect(await screen.findByLabelText("Name")).toHaveValue("Case B Driver");
    expect(screen.queryByText("case A failed")).not.toBeInTheDocument();
    expect(router.state.location.search).toContain(`caseId=${OTHER_CASE_ID}`);
  });

  it("gates and retries a failed restored case without an explicit URL", async () => {
    const draft = completeDraft();
    persistOwnerDraft(draft);
    const harness = createDependencyHarness(detailsFor(draft));
    harness.getAppraisalCase
      .mockRejectedValueOnce(new Error("restored case unavailable"))
      .mockResolvedValueOnce(appraisalCase("draft"));
    const auth = createAuthHarness(async () => sessionFor());
    const user = userEvent.setup();

    renderTestApp(["/start?service=diminished-value&view=intake"], {
      authService: auth.service,
      diminishedValueDependencies: harness.dependencies,
    });

    expect(await screen.findByText("restored case unavailable")).toBeVisible();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByLabelText("Name")).toHaveValue("Jordan Private");
    expect(harness.getAppraisalCase).toHaveBeenCalledTimes(2);
  });

  it("does not apply a pending case creation after navigating to an explicit case", async () => {
    persistAnonymousDraft(completeDraft(), CASE_ID);
    const caseCreation = createDeferred<AppraisalCase>();
    const caseBDraft = {
      ...completeDraft(),
      fullName: "Explicit Case B",
    };
    const harness = createDependencyHarness(detailsFor(completeDraft()));
    harness.createOrGetAppraisalCase.mockImplementation(
      () => caseCreation.promise,
    );
    harness.getDetails.mockImplementation(({ caseId }) =>
      Promise.resolve(
        caseId === OTHER_CASE_ID
          ? detailsFor(caseBDraft, { caseId: OTHER_CASE_ID })
          : detailsFor(completeDraft()),
      ),
    );
    const auth = createAuthHarness(async () => sessionFor());

    const { router } = renderTestApp(
      ["/start?service=diminished-value&view=intake"],
      {
        authService: auth.service,
        diminishedValueDependencies: harness.dependencies,
      },
    );

    await waitFor(() =>
      expect(harness.createOrGetAppraisalCase).toHaveBeenCalledOnce(),
    );
    await act(async () => {
      await router.navigate(
        `/start?service=diminished-value&view=intake&caseId=${OTHER_CASE_ID}`,
      );
    });
    expect(await screen.findByLabelText("Name")).toHaveValue("Explicit Case B");

    await act(async () => {
      caseCreation.resolve(appraisalCase("draft", CASE_ID));
      await caseCreation.promise;
    });

    await waitFor(() =>
      expect(router.state.location.search).toContain(`caseId=${OTHER_CASE_ID}`),
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Explicit Case B");
    expect(readDiminishedValueDraftEnvelope()).toMatchObject({
      ok: true,
      envelope: { confirmedCaseId: OTHER_CASE_ID },
    });
  });

  it("does not run a second queued case A save against a slow explicit case B", async () => {
    const caseADraft = completeDraft();
    const caseBDraft = {
      ...completeDraft(),
      fullName: "Queued Save Case B",
      email: "queued-b@example.com",
    };
    persistOwnerDraft(caseADraft, { dirty: true, serverRevision: 0 });
    const firstSave = createDeferred<DiminishedValueCaseDetails>();
    const caseBDetails = createDeferred<DiminishedValueCaseDetails | null>();
    const harness = createDependencyHarness(detailsFor(caseADraft));
    harness.saveDetails.mockImplementationOnce(() => firstSave.promise);
    harness.getDetails.mockImplementation(({ caseId }) =>
      caseId === OTHER_CASE_ID
        ? caseBDetails.promise
        : Promise.resolve(detailsFor(caseADraft)),
    );
    const auth = createAuthHarness(async () => sessionFor());
    const user = userEvent.setup();

    const { router } = renderTestApp(
      ["/start?service=diminished-value&view=intake"],
      {
        authService: auth.service,
        diminishedValueDependencies: harness.dependencies,
      },
    );

    expect(await screen.findByLabelText("Name")).toHaveValue("Jordan Private");
    await waitFor(() => expect(harness.saveDetails).toHaveBeenCalledOnce(), {
      timeout: 2500,
    });
    await user.click(screen.getByRole("button", { name: "Request a review" }));
    expect(
      screen.getByRole("button", { name: "Request a review" }),
    ).toBeDisabled();

    await act(async () => {
      await router.navigate(
        `/start?service=diminished-value&view=intake&caseId=${OTHER_CASE_ID}`,
      );
    });
    await waitFor(() =>
      expect(harness.getDetails).toHaveBeenCalledWith({
        caseId: OTHER_CASE_ID,
        userId: USER_ID,
      }),
    );

    await act(async () => {
      firstSave.resolve(detailsFor(caseADraft, { revision: 1 }));
      await firstSave.promise;
    });
    await act(async () => {
      caseBDetails.resolve(detailsFor(caseBDraft, { caseId: OTHER_CASE_ID }));
      await caseBDetails.promise;
    });

    expect(await screen.findByLabelText("Name")).toHaveValue(
      "Queued Save Case B",
    );
    expect(harness.saveDetails).toHaveBeenCalledOnce();
    expect(harness.submitCase).not.toHaveBeenCalled();
    expect(readDiminishedValueDraftEnvelope()).toMatchObject({
      ok: true,
      envelope: { confirmedCaseId: OTHER_CASE_ID },
    });
  });

  it("does not render case A submission completion after navigating to case B", async () => {
    const caseADraft = completeDraft();
    const caseBDraft = {
      ...completeDraft(),
      fullName: "Case B Driver",
      email: "case-b@example.com",
    };
    persistOwnerDraft(caseADraft);
    const harness = createDependencyHarness(detailsFor(caseADraft));
    const submission = createDeferred<{
      caseId: string;
      status: "submitted";
      submittedAt: string;
    }>();
    let caseASubmitted = false;
    harness.submitCase.mockImplementation(() => submission.promise);
    harness.getDetails.mockImplementation(({ caseId }) => {
      if (caseId === OTHER_CASE_ID) {
        return Promise.resolve(
          detailsFor(caseBDraft, { caseId: OTHER_CASE_ID }),
        );
      }
      return Promise.resolve(
        detailsFor(caseADraft, {
          revision: caseASubmitted ? 2 : 0,
          submittedAt: caseASubmitted ? SUBMITTED_AT : null,
          updatedAt: caseASubmitted ? SUBMITTED_AT : CREATED_AT,
        }),
      );
    });
    const auth = createAuthHarness(async () => sessionFor());
    const user = userEvent.setup();

    const { router } = renderTestApp(
      [`/start?service=diminished-value&view=intake&caseId=${CASE_ID}`],
      {
        authService: auth.service,
        diminishedValueDependencies: harness.dependencies,
      },
    );

    expect(await screen.findByLabelText("Name")).toHaveValue("Jordan Private");
    await user.click(screen.getByRole("button", { name: "Request a review" }));
    await waitFor(() => expect(harness.submitCase).toHaveBeenCalledOnce());

    await act(async () => {
      await router.navigate(
        `/start?service=diminished-value&view=intake&caseId=${OTHER_CASE_ID}`,
      );
    });
    expect(await screen.findByLabelText("Name")).toHaveValue("Case B Driver");

    caseASubmitted = true;
    await act(async () => {
      submission.resolve({
        caseId: CASE_ID,
        status: "submitted",
        submittedAt: SUBMITTED_AT,
      });
      await submission.promise;
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Name")).toHaveValue("Case B Driver"),
    );
    expect(
      screen.queryByRole("heading", {
        name: "Venfour received your review request",
      }),
    ).not.toBeInTheDocument();
    expect(readDiminishedValueDraftEnvelope()).toMatchObject({
      ok: true,
      envelope: { confirmedCaseId: OTHER_CASE_ID },
    });
  });

  it("clears stale save activity after navigating to another case", async () => {
    const caseADraft = completeDraft();
    const caseBDraft = {
      ...completeDraft(),
      fullName: "Case B Driver",
    };
    persistOwnerDraft(caseADraft, { dirty: true, serverRevision: 0 });
    const save = createDeferred<DiminishedValueCaseDetails>();
    const harness = createDependencyHarness(detailsFor(caseADraft));
    harness.saveDetails.mockImplementation(() => save.promise);
    harness.getDetails.mockImplementation(({ caseId }) =>
      Promise.resolve(
        caseId === OTHER_CASE_ID
          ? detailsFor(caseBDraft, { caseId: OTHER_CASE_ID })
          : detailsFor(caseADraft),
      ),
    );
    const auth = createAuthHarness(async () => sessionFor());

    const { router } = renderTestApp(
      ["/start?service=diminished-value&view=intake"],
      {
        authService: auth.service,
        diminishedValueDependencies: harness.dependencies,
      },
    );

    await waitFor(() => expect(harness.saveDetails).toHaveBeenCalledOnce(), {
      timeout: 2500,
    });
    expect(screen.getByText("Saving securely…")).toBeVisible();

    await act(async () => {
      await router.navigate(
        `/start?service=diminished-value&view=intake&caseId=${OTHER_CASE_ID}`,
      );
    });
    expect(await screen.findByLabelText("Name")).toHaveValue("Case B Driver");

    await act(async () => {
      save.resolve(detailsFor(caseADraft, { revision: 1 }));
      await save.promise;
    });

    await waitFor(() =>
      expect(screen.queryByText("Saving securely…")).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Case B Driver");
    expect(screen.queryByText(/couldn’t save/u)).not.toBeInTheDocument();
  });

  it("ignores a recent lookup that resolves after switching services", async () => {
    const recentLookup = createDeferred<AppraisalCase | null>();
    const harness = createDependencyHarness(
      detailsFor(completeDraft(), { caseId: RECENT_CASE_ID }),
    );
    harness.getRecentDraftAppraisalCase.mockImplementation(
      () => recentLookup.promise,
    );
    const auth = createAuthHarness(async () => sessionFor());

    const { router } = renderTestApp(
      ["/start?service=diminished-value&view=intake"],
      {
        authService: auth.service,
        diminishedValueDependencies: harness.dependencies,
        totalLossDependencies: null,
      },
    );

    await waitFor(() =>
      expect(harness.getRecentDraftAppraisalCase).toHaveBeenCalledOnce(),
    );
    await act(async () => {
      await router.navigate("/start?service=total-loss&view=intake");
    });
    expect(
      screen.getByRole("heading", { name: "Start your CCC report review" }),
    ).toBeVisible();

    await act(async () => {
      recentLookup.resolve(appraisalCase("draft", RECENT_CASE_ID));
      await recentLookup.promise;
    });

    expect(harness.getAppraisalCase).not.toHaveBeenCalledWith({
      caseId: RECENT_CASE_ID,
      userId: USER_ID,
    });
  });

  it("keeps a verified submission successful when document refresh fails", async () => {
    const draft = completeDraft();
    persistOwnerDraft(draft);
    const harness = createDependencyHarness(detailsFor(draft));
    const auth = createAuthHarness(async () => sessionFor());
    const user = userEvent.setup();

    renderTestApp(["/start?service=diminished-value&view=intake"], {
      authService: auth.service,
      diminishedValueDependencies: harness.dependencies,
    });

    expect(
      await screen.findByRole("heading", {
        name: "Prepare your review request",
      }),
    ).toBeVisible();
    harness.listDocuments.mockRejectedValueOnce(
      new Error("document refresh unavailable"),
    );
    await user.click(screen.getByRole("button", { name: "Request a review" }));

    expect(
      await screen.findByRole("heading", {
        name: "Venfour received your review request",
      }),
    ).toBeVisible();
    expect(
      screen.queryByText("document refresh unavailable"),
    ).not.toBeInTheDocument();
    expect(readDiminishedValueDraftEnvelope()).toEqual({
      ok: true,
      envelope: null,
    });
  });

  it("uploads, refreshes, and removes an authenticated stored document", async () => {
    const draft = completeDraft("accident-repairs");
    persistOwnerDraft(draft);
    const harness = createDependencyHarness(detailsFor(draft));
    const auth = createAuthHarness(async () => sessionFor());
    const user = userEvent.setup();

    renderTestApp(["/start?service=diminished-value&view=intake"], {
      authService: auth.service,
      diminishedValueDependencies: harness.dependencies,
    });

    expect(
      await screen.findByRole("heading", {
        name: "Describe the accident and repairs",
      }),
    ).toBeVisible();
    const estimate = new File(["%PDF-1.7\n"], "estimate.pdf", {
      type: "application/pdf",
      lastModified: 10,
    });
    await user.upload(screen.getByLabelText("Choose files"), estimate);

    await waitFor(() => expect(harness.uploadDocument).toHaveBeenCalledOnce());
    expect(harness.uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: CASE_ID,
        file: estimate,
        userId: USER_ID,
      }),
    );
    expect(
      await screen.findByRole("list", { name: "Attached documents" }),
    ).toHaveTextContent("estimate.pdf");
    expect(harness.listDocuments).toHaveBeenCalledWith({
      caseId: CASE_ID,
      userId: USER_ID,
    });

    await user.click(
      screen.getByRole("button", { name: "Remove estimate.pdf" }),
    );
    await waitFor(() => expect(harness.removeDocument).toHaveBeenCalledOnce());
    expect(harness.removeDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: CASE_ID,
        userId: USER_ID,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText("estimate.pdf")).not.toBeInTheDocument(),
    );
  });

  it("finishes a stored document removal after the same explicit case loses its URL parameter", async () => {
    const draft = completeDraft("accident-repairs");
    const estimate = new File(["%PDF-1.7\n"], "stored-estimate.pdf", {
      type: "application/pdf",
      lastModified: 10,
    });
    const document = storedDocument("stored-document", estimate);
    const removal = createDeferred<void>();
    const harness = createDependencyHarness(detailsFor(draft));
    harness.listDocuments.mockResolvedValue([document]);
    harness.removeDocument.mockImplementationOnce(() => removal.promise);
    const auth = createAuthHarness(async () => sessionFor());
    const user = userEvent.setup();

    const { router } = renderTestApp(
      [`/start?service=diminished-value&view=intake&caseId=${CASE_ID}`],
      {
        authService: auth.service,
        diminishedValueDependencies: harness.dependencies,
      },
    );

    expect(
      await screen.findByRole("list", { name: "Attached documents" }),
    ).toHaveTextContent("stored-estimate.pdf");
    await user.click(
      screen.getByRole("button", { name: "Remove stored-estimate.pdf" }),
    );
    await waitFor(() => expect(harness.removeDocument).toHaveBeenCalledOnce());

    await act(async () => {
      await router.navigate("/start?service=diminished-value&view=intake");
    });
    await act(async () => {
      removal.resolve();
      await removal.promise;
    });

    await waitFor(() =>
      expect(screen.queryByText("stored-estimate.pdf")).not.toBeInTheDocument(),
    );
    expect(harness.removeDocument).toHaveBeenCalledWith({
      caseId: CASE_ID,
      document,
      userId: USER_ID,
    });
    expect(screen.queryByText(/could not be removed/u)).not.toBeInTheDocument();
    expect(readDiminishedValueDraftEnvelope()).toMatchObject({
      ok: true,
      envelope: { confirmedCaseId: CASE_ID },
    });
  });

  it("autosaves a dirty local draft against its persisted base revision", async () => {
    const localDraft = completeDraft();
    persistOwnerDraft(localDraft, { dirty: true, serverRevision: 3 });
    const serverDraft = {
      ...localDraft,
      fullName: "Server-side name",
      notes: "Server-side notes",
    };
    const harness = createDependencyHarness(
      detailsFor(serverDraft, { revision: 4 }),
    );
    const auth = createAuthHarness(async () => sessionFor());

    renderTestApp(["/start?service=diminished-value&view=intake"], {
      authService: auth.service,
      diminishedValueDependencies: harness.dependencies,
    });

    expect(await screen.findByLabelText("Name")).toHaveValue("Jordan Private");
    await waitFor(() => expect(harness.saveDetails).toHaveBeenCalledOnce(), {
      timeout: 2500,
    });
    expect(harness.saveDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: CASE_ID,
        userId: USER_ID,
        expectedRevision: 3,
        values: expect.objectContaining({
          fullName: "Jordan Private",
          notes: "Private case notes",
        }),
      }),
    );
  });

  it("waits for the upload queue and refuses submission when a document remains failed", async () => {
    const draft = completeDraft("accident-repairs");
    persistOwnerDraft(draft);
    const harness = createDependencyHarness(detailsFor(draft));
    const upload = createDeferred<DiminishedValueStoredDocument>();
    harness.uploadDocument.mockImplementationOnce(() => upload.promise);
    const auth = createAuthHarness(async () => sessionFor());
    const user = userEvent.setup();

    renderTestApp(["/start?service=diminished-value&view=intake"], {
      authService: auth.service,
      diminishedValueDependencies: harness.dependencies,
    });

    expect(
      await screen.findByRole("heading", {
        name: "Describe the accident and repairs",
      }),
    ).toBeVisible();
    const estimate = new File(["%PDF-1.7\n"], "estimate.pdf", {
      type: "application/pdf",
      lastModified: 10,
    });
    await user.upload(screen.getByLabelText("Choose files"), estimate);
    await waitFor(() => expect(harness.uploadDocument).toHaveBeenCalledOnce());

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Request a review" }));
    expect(harness.submitCase).not.toHaveBeenCalled();

    await act(async () => {
      upload.reject(new Error("storage unavailable"));
      await upload.promise.catch(() => undefined);
    });

    expect(
      await screen.findByText(
        "Retry or remove documents that did not finish uploading.",
      ),
    ).toBeVisible();
    expect(harness.submitCase).not.toHaveBeenCalled();
  });

  it("drains a successful deferred document upload before submitting", async () => {
    const draft = completeDraft("accident-repairs");
    persistOwnerDraft(draft);
    const harness = createDependencyHarness(detailsFor(draft));
    const upload = createDeferred<DiminishedValueStoredDocument>();
    let uploadedDocument: DiminishedValueStoredDocument | null = null;
    harness.uploadDocument.mockImplementationOnce(() => upload.promise);
    harness.listDocuments.mockImplementation(async () =>
      uploadedDocument ? [uploadedDocument] : [],
    );
    const auth = createAuthHarness(async () => sessionFor());
    const user = userEvent.setup();

    renderTestApp(["/start?service=diminished-value&view=intake"], {
      authService: auth.service,
      diminishedValueDependencies: harness.dependencies,
    });

    expect(
      await screen.findByRole("heading", {
        name: "Describe the accident and repairs",
      }),
    ).toBeVisible();
    const estimate = new File(["%PDF-1.7\n"], "deferred-estimate.pdf", {
      type: "application/pdf",
      lastModified: 10,
    });
    await user.upload(screen.getByLabelText("Choose files"), estimate);
    await waitFor(() => expect(harness.uploadDocument).toHaveBeenCalledOnce());

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Request a review" }));
    expect(harness.submitCase).not.toHaveBeenCalled();

    const uploadInput = harness.uploadDocument.mock.calls[0][0];
    uploadedDocument = storedDocument(
      uploadInput.documentId,
      estimate,
      uploadInput.caseId,
      uploadInput.userId,
    );
    await act(async () => {
      upload.resolve(uploadedDocument!);
      await upload.promise;
    });

    expect(
      await screen.findByRole("heading", {
        name: "Venfour received your review request",
      }),
    ).toBeVisible();
    expect(harness.submitCase).toHaveBeenCalledOnce();
    expect(screen.getByText(/1 supporting document/u)).toBeVisible();
  });

  it("clears a reserved case upload queue before hydrating an empty explicit case", async () => {
    const draft = completeDraft("accident-repairs");
    persistAnonymousDraft(draft, CASE_ID);
    const caseCreation = createDeferred<AppraisalCase>();
    const harness = createDependencyHarness(detailsFor(draft));
    harness.createOrGetAppraisalCase.mockImplementation(
      () => caseCreation.promise,
    );
    harness.getDetails.mockResolvedValue(null);
    const auth = createAuthHarness(async () => sessionFor());
    const user = userEvent.setup();

    const { router } = renderTestApp(
      ["/start?service=diminished-value&view=intake"],
      {
        authService: auth.service,
        diminishedValueDependencies: harness.dependencies,
      },
    );

    expect(
      await screen.findByRole("heading", {
        name: "Describe the accident and repairs",
      }),
    ).toBeVisible();
    await waitFor(() =>
      expect(harness.createOrGetAppraisalCase).toHaveBeenCalledOnce(),
    );
    const estimate = new File(["%PDF-1.7\n"], "queued-estimate.pdf", {
      type: "application/pdf",
      lastModified: 10,
    });
    await user.upload(screen.getByLabelText("Choose files"), estimate);
    expect(await screen.findByText("queued-estimate.pdf")).toBeVisible();
    expect(harness.uploadDocument).not.toHaveBeenCalled();

    await act(async () => {
      await router.navigate(
        `/start?service=diminished-value&view=intake&caseId=${OTHER_CASE_ID}`,
      );
    });
    expect(
      await screen.findByRole("heading", {
        name: "Start with the accident details",
      }),
    ).toBeVisible();
    expect(screen.queryByText("queued-estimate.pdf")).not.toBeInTheDocument();

    await act(async () => {
      caseCreation.resolve(appraisalCase("draft", CASE_ID));
      await caseCreation.promise;
    });

    expect(harness.uploadDocument).not.toHaveBeenCalled();
    expect(readDiminishedValueDraftEnvelope()).toMatchObject({
      ok: true,
      envelope: {
        confirmedCaseId: OTHER_CASE_ID,
        intake: { step: "start" },
      },
    });
  });

  it("retries an idempotent lost-response submission without saving the frozen case again", async () => {
    const draft = completeDraft();
    persistOwnerDraft(draft);
    const harness = createDependencyHarness(detailsFor(draft));
    harness.submitCase.mockImplementationOnce(async () => {
      harness.commitSubmission();
      throw new Error("connection lost after commit");
    });
    const auth = createAuthHarness(async () => sessionFor());
    const user = userEvent.setup();

    renderTestApp(["/start?service=diminished-value&view=intake"], {
      authService: auth.service,
      diminishedValueDependencies: harness.dependencies,
    });

    expect(
      await screen.findByRole("heading", {
        name: "Prepare your review request",
      }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Request a review" }));
    expect(
      await screen.findByText(
        "connection lost after commit Your answers are locked until Venfour verifies the request.",
      ),
    ).toBeVisible();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(harness.saveDetails).toHaveBeenCalledOnce();
    expect(harness.submitCase).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("heading", {
        name: "Venfour received your review request",
      }),
    ).toBeVisible();
    expect(harness.saveDetails).toHaveBeenCalledOnce();
    expect(harness.submitCase).toHaveBeenCalledTimes(2);
  });

  it("does not continue an ambiguous case A retry after explicit case B loads", async () => {
    const caseADraft = completeDraft();
    const caseBDraft = {
      ...completeDraft(),
      fullName: "Retry Case B",
      email: "retry-b@example.com",
    };
    persistOwnerDraft(caseADraft);
    const retryDetails = createDeferred<DiminishedValueCaseDetails | null>();
    const savedDetails = detailsFor(caseADraft, { revision: 1 });
    let caseAReads = 0;
    const harness = createDependencyHarness(detailsFor(caseADraft));
    harness.getAppraisalCase.mockImplementation(({ caseId, userId }) =>
      Promise.resolve(appraisalCase("draft", caseId, userId)),
    );
    harness.saveDetails.mockResolvedValue(savedDetails);
    harness.getDetails.mockImplementation(({ caseId }) => {
      if (caseId === OTHER_CASE_ID) {
        return Promise.resolve(
          detailsFor(caseBDraft, { caseId: OTHER_CASE_ID }),
        );
      }
      caseAReads += 1;
      return caseAReads === 1
        ? Promise.resolve(detailsFor(caseADraft))
        : retryDetails.promise;
    });
    harness.submitCase.mockImplementationOnce(async () => {
      harness.commitSubmission();
      throw new Error("connection lost after commit");
    });
    const auth = createAuthHarness(async () => sessionFor());
    const user = userEvent.setup();

    const { router } = renderTestApp(
      ["/start?service=diminished-value&view=intake"],
      {
        authService: auth.service,
        diminishedValueDependencies: harness.dependencies,
      },
    );

    expect(await screen.findByLabelText("Name")).toHaveValue("Jordan Private");
    await user.click(screen.getByRole("button", { name: "Request a review" }));
    expect(
      await screen.findByText(/answers are locked until Venfour verifies/u),
    ).toBeVisible();

    (savedDetails as { caseId: string }).caseId = OTHER_CASE_ID;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(harness.getDetails).toHaveBeenCalledTimes(2));

    await act(async () => {
      await router.navigate(
        `/start?service=diminished-value&view=intake&caseId=${OTHER_CASE_ID}`,
      );
    });
    expect(await screen.findByLabelText("Name")).toHaveValue("Retry Case B");

    await act(async () => {
      retryDetails.resolve(detailsFor(caseADraft, { revision: 1 }));
      await retryDetails.promise;
    });

    expect(harness.submitCase).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Name")).toHaveValue("Retry Case B");
    expect(
      screen.queryByRole("heading", {
        name: "Venfour received your review request",
      }),
    ).not.toBeInTheDocument();
    expect(readDiminishedValueDraftEnvelope()).toMatchObject({
      ok: true,
      envelope: { confirmedCaseId: OTHER_CASE_ID },
    });
  });
});
