import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@supabase/supabase-js";
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
  return { listener: () => listener, service };
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

function appraisalCase(status: AppraisalCase["status"]): AppraisalCase {
  return {
    id: CASE_ID,
    userId: USER_ID,
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

function storedDocument(
  documentId: string,
  file: File,
): DiminishedValueStoredDocument {
  return {
    id: documentId,
    path: `${USER_ID}/${CASE_ID}/diminished-value/${documentId}.pdf`,
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
  >(async () => appraisalCase(status));
  const caseService: AppraisalCaseService = {
    createAppraisalCase: vi.fn(async () => appraisalCase(status)),
    createOrGetAppraisalCase,
    listAppraisalCases: vi.fn(async () => [appraisalCase(status)]),
    getRecentDraftAppraisalCase: vi.fn(async () => null),
    getAppraisalCase: vi.fn(async () => appraisalCase(status)),
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
  >(async ({ documentId, file }) => {
    const stored = storedDocument(documentId, file);
    storedDocuments.push(stored);
    return stored;
  });
  const documentService: DiminishedValueDocumentStorageService = {
    listDocuments: vi.fn(async () => [...storedDocuments]),
    uploadDocument,
    removeDocument: vi.fn(async ({ document }) => {
      const index = storedDocuments.findIndex(
        (candidate) => candidate.id === document.id,
      );
      if (index >= 0) storedDocuments.splice(index, 1);
    }),
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
    commitSubmission,
    dependencies,
    getDetails,
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

    await waitFor(() =>
      expect(auth.service.getSession).toHaveBeenCalledOnce(),
    );
    expect(screen.getByText("Checking your saved request…")).toBeVisible();
    expect(
      screen.queryByDisplayValue("Jordan Private"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("jordan.private@example.com"),
    ).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Private case notes")).not.toBeInTheDocument();

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

    expect(await screen.findByLabelText("Name")).toHaveValue(
      "Jordan Private",
    );
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
    await user.click(
      screen.getByRole("button", { name: "Request a review" }),
    );
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
    await user.click(
      screen.getByRole("button", { name: "Request a review" }),
    );
    expect(
      await screen.findByText("connection lost after commit"),
    ).toBeVisible();
    expect(harness.saveDetails).toHaveBeenCalledOnce();
    expect(harness.submitCase).toHaveBeenCalledOnce();

    await user.click(
      screen.getByRole("button", { name: "Request a review" }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Venfour received your review request",
      }),
    ).toBeVisible();
    expect(harness.saveDetails).toHaveBeenCalledOnce();
    expect(harness.submitCase).toHaveBeenCalledTimes(2);
  });
});
