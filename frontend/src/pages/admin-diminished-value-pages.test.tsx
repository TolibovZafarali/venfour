import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AdminDiminishedValueDependencies } from "@/features/admin/diminished-value/dependencies";
import { adminDiminishedValueQueryKeys } from "@/features/admin/diminished-value/queries";
import type { StaffDiminishedValueCase } from "@/features/admin/diminished-value/types";
import type {
  AuthService,
  AuthStateChangeListener,
} from "@/features/auth/auth-service";
import { AUTH_RETURN_LOCATION_STORAGE_KEY } from "@/features/auth/return-location";
import type { DiminishedValueStoredDocument } from "@/features/diminished-value/storage-service";
import { renderTestApp } from "@/test/render";

const STAFF_USER_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_USER_ID = "22222222-2222-4222-8222-222222222222";
const CASE_ID = "33333333-3333-4333-8333-333333333333";
const SECOND_CASE_ID = "44444444-4444-4444-8444-444444444444";
const DOCUMENT_ID = "55555555-5555-4555-8555-555555555555";

describe("admin diminished-value review pages", () => {
  it("does not render protected content while authentication is unavailable", async () => {
    const dependencies = createAdminDependencies();
    renderTestApp(["/admin/diminished-value"], {
      adminDiminishedValueDependencies: dependencies,
      authService: null,
      authUnavailableReason: "Secure sign-in is unavailable.",
    });

    expect(
      await screen.findByRole("heading", {
        name: "We can’t securely open this workspace right now.",
      }),
    ).toBeVisible();
    expect(screen.getByText("Secure sign-in is unavailable.")).toBeVisible();
    expect(dependencies.caseService.isStaff).not.toHaveBeenCalled();
    expect(dependencies.caseService.listSubmittedCases).not.toHaveBeenCalled();
  });

  it("requires authentication without starting a staff data query", async () => {
    const user = userEvent.setup();
    const auth = createAuthHarness(null);
    const dependencies = createAdminDependencies();

    renderTestApp(["/admin/diminished-value"], {
      adminDiminishedValueDependencies: dependencies,
      authService: auth.service,
    });

    expect(
      await screen.findByRole("heading", { name: "Sign in to continue." }),
    ).toBeVisible();
    expect(dependencies.caseService.isStaff).not.toHaveBeenCalled();
    expect(dependencies.caseService.listSubmittedCases).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      screen.getByText(
        "Sign in with an authorized Venfour staff account to open the secure review workspace.",
      ),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    expect(window.localStorage.getItem(AUTH_RETURN_LOCATION_STORAGE_KEY)).toBe(
      "/admin/diminished-value",
    );
  });

  it("shows a generic unavailable state to an authenticated nonstaff user", async () => {
    const dependencies = createAdminDependencies({ staff: false });
    renderTestApp([`/admin/diminished-value/${CASE_ID}`], {
      adminDiminishedValueDependencies: dependencies,
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t find this page.",
      }),
    ).toBeVisible();
    expect(screen.queryByText(CASE_ID)).not.toBeInTheDocument();
    expect(dependencies.caseService.getSubmittedCase).not.toHaveBeenCalled();
    expect(dependencies.documentService.listDocuments).not.toHaveBeenCalled();

    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: "Account for staff@example.com" }),
      );
    expect(
      screen.queryByRole("menuitem", { name: "Staff review" }),
    ).not.toBeInTheDocument();
  });

  it("renders the authorized queue newest first with staff-only navigation", async () => {
    const user = userEvent.setup();
    const newest = queueItem({
      caseId: SECOND_CASE_ID,
      submittedAt: "2026-08-20T15:00:00.000Z",
      fullName: "Grace Hopper",
      documentCount: 2,
    });
    const older = queueItem();
    const dependencies = createAdminDependencies({ queue: [newest, older] });

    renderTestApp(["/admin/diminished-value"], {
      adminDiminishedValueDependencies: dependencies,
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("heading", {
        name: "Submitted diminished-value requests",
      }),
    ).toBeVisible();
    const requests = await screen.findByRole("list", {
      name: "Submitted requests",
    });
    const cards = within(requests).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Grace Hopper");
    expect(cards[0]).toHaveTextContent("2 supporting documents");
    expect(cards[1]).toHaveTextContent("Ada Lovelace");
    expect(cards[1]).toHaveTextContent("At-fault insurer: Example Mutual");
    expect(
      screen.queryByRole("navigation", { name: "Primary navigation" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Account for staff@example.com" }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Staff review" }),
    ).toHaveAttribute("href", "/admin/diminished-value");
  });

  it("discovers staff navigation lazily after the signed-in account menu opens", async () => {
    const user = userEvent.setup();
    const dependencies = createAdminDependencies();
    renderTestApp(["/"], {
      adminDiminishedValueDependencies: dependencies,
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(dependencies.caseService.isStaff).not.toHaveBeenCalled();
    await user.click(
      await screen.findByRole("button", {
        name: "Account for staff@example.com",
      }),
    );

    expect(
      await screen.findByRole("menuitem", { name: "Staff review" }),
    ).toHaveAttribute("href", "/admin/diminished-value");
    expect(dependencies.caseService.isStaff).toHaveBeenCalledOnce();
  });

  it("renders an empty submitted queue", async () => {
    renderTestApp(["/admin/diminished-value"], {
      adminDiminishedValueDependencies: createAdminDependencies({ queue: [] }),
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("heading", { name: "No submitted requests" }),
    ).toBeVisible();
    expect(screen.getByText(/Customer drafts are not included/u)).toBeVisible();
  });

  it("keeps queue data hidden while the submitted list is loading", async () => {
    const pendingQueue = deferred<ReturnType<typeof queueItem>[]>();
    const dependencies = createAdminDependencies();
    vi.mocked(dependencies.caseService.listSubmittedCases).mockReturnValue(
      pendingQueue.promise,
    );
    renderTestApp(["/admin/diminished-value"], {
      adminDiminishedValueDependencies: dependencies,
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByLabelText("Loading submitted requests"),
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();

    await act(async () => pendingQueue.resolve([queueItem()]));
    expect(await screen.findByText("Ada Lovelace")).toBeVisible();
  });

  it("shows a retryable queue failure", async () => {
    const user = userEvent.setup();
    const dependencies = createAdminDependencies();
    vi.mocked(dependencies.caseService.listSubmittedCases)
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce([queueItem()]);

    renderTestApp(["/admin/diminished-value"], {
      adminDiminishedValueDependencies: dependencies,
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t load submitted requests.",
      }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Ada Lovelace")).toBeVisible();
  });

  it("renders every submitted intake group and its private documents read-only", async () => {
    const dependencies = createAdminDependencies({
      appraisalCase: submittedCase(),
      documents: [storedDocument()],
    });

    renderTestApp([`/admin/diminished-value/${CASE_ID}`], {
      adminDiminishedValueDependencies: dependencies,
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("heading", { name: "Diminished-value request" }),
    ).toBeVisible();
    for (const heading of [
      "Submission",
      "Customer",
      "Vehicle",
      "Accident",
      "Repairs and damage",
      "Review preferences",
      "Supporting documents",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeVisible();
    }
    expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0);
    expect(screen.getByText("2022")).toBeVisible();
    expect(screen.getByText("Honda")).toBeVisible();
    expect(screen.getByText("Accord")).toBeVisible();
    expect(screen.getByText("Example Collision")).toBeVisible();
    expect(
      screen.getByText("Weekdays after 4 p.m. Central Time"),
    ).toBeVisible();
    expect(await screen.findByText("repair invoice.pdf")).toBeVisible();
    expect(dependencies.documentService.listDocuments).toHaveBeenCalledWith({
      caseId: CASE_ID,
      userId: OWNER_USER_ID,
    });

    for (const control of ["Edit", "Delete", "Remove", "Approve", "Reject"]) {
      expect(
        screen.queryByRole("button", { name: new RegExp(control, "iu") }),
      ).not.toBeInTheDocument();
    }
  });

  it("downloads a document through the read-only service and reports failures per item", async () => {
    const user = userEvent.setup();
    const document = storedDocument();
    const dependencies = createAdminDependencies({
      appraisalCase: submittedCase(),
      documents: [document],
    });
    const createObjectUrl = vi.fn(() => "blob:staff-document");
    const revokeObjectUrl = vi.fn();
    const createDescriptor = Object.getOwnPropertyDescriptor(
      URL,
      "createObjectURL",
    );
    const revokeDescriptor = Object.getOwnPropertyDescriptor(
      URL,
      "revokeObjectURL",
    );
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });

    try {
      renderTestApp([`/admin/diminished-value/${CASE_ID}`], {
        adminDiminishedValueDependencies: dependencies,
        authService: createAuthHarness(sessionFor()).service,
      });
      await screen.findByText("repair invoice.pdf");
      await user.click(screen.getByRole("button", { name: "Download" }));

      await waitFor(() =>
        expect(
          dependencies.documentService.downloadDocument,
        ).toHaveBeenCalledWith({
          caseId: CASE_ID,
          userId: OWNER_USER_ID,
          document,
          signal: expect.any(AbortSignal),
        }),
      );
      expect(createObjectUrl).toHaveBeenCalledOnce();
      expect(anchorClick).toHaveBeenCalledOnce();
      await waitFor(() =>
        expect(revokeObjectUrl).toHaveBeenCalledWith("blob:staff-document"),
      );

      vi.mocked(
        dependencies.documentService.downloadDocument,
      ).mockRejectedValueOnce(new Error("revoked"));
      await user.click(screen.getByRole("button", { name: "Download" }));
      expect(
        await screen.findByText(
          "We couldn’t securely download this document. Try again.",
        ),
      ).toBeVisible();
    } finally {
      anchorClick.mockRestore();
      restoreProperty(URL, "createObjectURL", createDescriptor);
      restoreProperty(URL, "revokeObjectURL", revokeDescriptor);
    }
  });

  it.each(["sign-out", "same-user staff revocation"] as const)(
    "aborts a pending private download across %s",
    async (transition) => {
      const user = userEvent.setup();
      const pendingDownload = deferred<Blob>();
      const auth = createAuthHarness(sessionFor());
      let staff = true;
      const dependencies = createAdminDependencies({
        appraisalCase: submittedCase(),
        documents: [storedDocument()],
      });
      vi.mocked(dependencies.caseService.isStaff).mockImplementation(
        async () => staff,
      );
      vi.mocked(dependencies.documentService.downloadDocument).mockReturnValue(
        pendingDownload.promise,
      );
      const createObjectUrl = vi.fn(() => "blob:stale-staff-document");
      const createDescriptor = Object.getOwnPropertyDescriptor(
        URL,
        "createObjectURL",
      );
      const anchorClick = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: createObjectUrl,
      });

      try {
        const { queryClient } = renderTestApp(
          [`/admin/diminished-value/${CASE_ID}`],
          {
            adminDiminishedValueDependencies: dependencies,
            authService: auth.service,
          },
        );
        await screen.findByText("repair invoice.pdf");
        await user.click(screen.getByRole("button", { name: "Download" }));

        const downloadInput = vi.mocked(
          dependencies.documentService.downloadDocument,
        ).mock.calls[0][0];
        expect(downloadInput.signal?.aborted).toBe(false);

        if (transition === "sign-out") {
          await act(async () => auth.emit(null, "SIGNED_OUT"));
          await screen.findByRole("heading", { name: "Sign in to continue." });
        } else {
          staff = false;
          await act(async () => {
            await queryClient.invalidateQueries({
              queryKey: adminDiminishedValueQueryKeys.access(STAFF_USER_ID),
            });
          });
          await screen.findByRole("heading", {
            name: "We couldn’t find this page.",
          });
        }

        expect(downloadInput.signal?.aborted).toBe(true);
        await act(async () => {
          pendingDownload.resolve(
            new Blob(["%PDF-1.7\ncontent"], { type: "application/pdf" }),
          );
        });
        expect(createObjectUrl).not.toHaveBeenCalled();
        expect(anchorClick).not.toHaveBeenCalled();
      } finally {
        anchorClick.mockRestore();
        restoreProperty(URL, "createObjectURL", createDescriptor);
      }
    },
  );

  it("normalizes an uppercase route identifier before reading the case", async () => {
    const dependencies = createAdminDependencies({
      appraisalCase: submittedCase(),
    });
    renderTestApp([`/admin/diminished-value/${CASE_ID.toUpperCase()}`], {
      adminDiminishedValueDependencies: dependencies,
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("heading", { name: "Diminished-value request" }),
    ).toBeVisible();
    expect(dependencies.caseService.getSubmittedCase).toHaveBeenCalledWith(
      CASE_ID,
    );
  });

  it("uses the same unavailable state for invalid and nonexistent case identifiers", async () => {
    const dependencies = createAdminDependencies({ appraisalCase: null });
    const authService = createAuthHarness(sessionFor()).service;
    const invalid = renderTestApp(["/admin/diminished-value/not-a-case"], {
      adminDiminishedValueDependencies: dependencies,
      authService,
    });

    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t find this submitted request.",
      }),
    ).toBeVisible();
    expect(dependencies.caseService.getSubmittedCase).not.toHaveBeenCalled();
    invalid.unmount();

    renderTestApp([`/admin/diminished-value/${CASE_ID}`], {
      adminDiminishedValueDependencies: dependencies,
      authService,
    });
    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t find this submitted request.",
      }),
    ).toBeVisible();
  });

  it("purges protected query data when same-user staff access is revoked", async () => {
    let staff = true;
    const dependencies = createAdminDependencies({ queue: [queueItem()] });
    vi.mocked(dependencies.caseService.isStaff).mockImplementation(
      async () => staff,
    );
    const { queryClient } = renderTestApp(["/admin/diminished-value"], {
      adminDiminishedValueDependencies: dependencies,
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(await screen.findByText("Ada Lovelace")).toBeVisible();
    expect(
      queryClient.getQueryData(
        adminDiminishedValueQueryKeys.queue(STAFF_USER_ID),
      ),
    ).toBeDefined();

    staff = false;
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: adminDiminishedValueQueryKeys.access(STAFF_USER_ID),
      });
    });

    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t find this page.",
      }),
    ).toBeVisible();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        queryClient.getQueryData(
          adminDiminishedValueQueryKeys.queue(STAFF_USER_ID),
        ),
      ).toBeUndefined(),
    );
  });

  it("removes protected content when the authenticated session signs out", async () => {
    const auth = createAuthHarness(sessionFor());
    const { queryClient } = renderTestApp(["/admin/diminished-value"], {
      adminDiminishedValueDependencies: createAdminDependencies({
        queue: [queueItem()],
      }),
      authService: auth.service,
    });
    expect(await screen.findByText("Ada Lovelace")).toBeVisible();

    await act(async () => auth.emit(null, "SIGNED_OUT"));

    expect(
      await screen.findByRole("heading", { name: "Sign in to continue." }),
    ).toBeVisible();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    expect(
      queryClient.getQueryData(
        adminDiminishedValueQueryKeys.queue(STAFF_USER_ID),
      ),
    ).toBeUndefined();
  });
});

function createAdminDependencies({
  appraisalCase = submittedCase(),
  documents = [],
  queue = [queueItem()],
  staff = true,
}: {
  readonly appraisalCase?: StaffDiminishedValueCase | null;
  readonly documents?: DiminishedValueStoredDocument[];
  readonly queue?: ReturnType<typeof queueItem>[];
  readonly staff?: boolean;
} = {}): AdminDiminishedValueDependencies {
  return {
    caseService: {
      getSubmittedCase: vi.fn(async () => appraisalCase),
      isStaff: vi.fn(async () => staff),
      listSubmittedCases: vi.fn(async () => queue),
    },
    documentService: {
      downloadDocument: vi.fn(
        async () =>
          new Blob(["%PDF-1.7\ncontent"], { type: "application/pdf" }),
      ),
      listDocuments: vi.fn(async () => documents),
    },
  };
}

function queueItem(overrides: Partial<ReturnType<typeof baseQueueItem>> = {}) {
  return { ...baseQueueItem(), ...overrides };
}

function baseQueueItem() {
  return {
    caseId: CASE_ID,
    ownerUserId: OWNER_USER_ID,
    serviceType: "diminished_value" as const,
    status: "submitted" as const,
    submittedAt: "2026-08-19T15:00:00.000Z",
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    phone: "312-555-0123",
    preferredContactMethod: "email" as const,
    vehicleYear: 2022,
    vehicleMake: "Honda",
    vehicleModel: "Accord",
    accidentDate: "2026-07-04",
    atFaultInsurer: "Example Mutual",
    documentCount: 1,
  };
}

function submittedCase(): StaffDiminishedValueCase {
  return {
    caseId: CASE_ID,
    ownerUserId: OWNER_USER_ID,
    serviceType: "diminished_value",
    status: "submitted",
    draftStep: "consultation",
    accidentState: "IL",
    accidentDate: "2026-07-04",
    repairStatus: "complete",
    vehicleEntryMethod: "details",
    vin: null,
    vehicleYear: 2022,
    vehicleMake: "Honda",
    vehicleModel: "Accord",
    vehicleTrim: "EX-L",
    mileageAtAccident: 48250,
    currentMileage: 49100,
    otherPartyAtFault: "yes",
    atFaultInsurer: "Example Mutual",
    repairCost: 12500.5,
    repairFacility: "Example Collision",
    structuralDamage: "no",
    airbagDeployment: "no",
    majorRepairDetails: "Replaced the front bumper and hood.",
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    phone: "312-555-0123",
    preferredContactMethod: "email",
    availability: "Weekdays after 4 p.m. Central Time",
    notes: "Please review the repair invoice.",
    submittedAt: "2026-08-19T15:00:00.000Z",
    revision: 4,
    createdAt: "2026-08-18T15:00:00.000Z",
    updatedAt: "2026-08-19T15:00:00.000Z",
  };
}

function storedDocument(): DiminishedValueStoredDocument {
  return {
    id: DOCUMENT_ID,
    path: `${OWNER_USER_ID}/${CASE_ID}/diminished-value/${DOCUMENT_ID}.pdf`,
    displayFilename: "repair invoice.pdf",
    mimeType: "application/pdf",
    extension: "pdf",
    size: 17,
    createdAt: "2026-08-19T14:30:00.000Z",
  };
}

function sessionFor(): Session {
  return {
    access_token: "staff-access-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 2_000_000_000,
    refresh_token: "staff-refresh-token",
    user: {
      id: STAFF_USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: "staff@example.com",
      email_confirmed_at: "2026-08-19T12:00:00.000Z",
      phone: "",
      confirmed_at: "2026-08-19T12:00:00.000Z",
      last_sign_in_at: "2026-08-19T12:00:00.000Z",
      app_metadata: {},
      user_metadata: { full_name: "Staff Reviewer" },
      identities: [],
      created_at: "2026-08-19T12:00:00.000Z",
      updated_at: "2026-08-19T12:00:00.000Z",
      is_anonymous: false,
    },
  };
}

function createAuthHarness(initialSession: Session | null) {
  let session = initialSession;
  let listener: AuthStateChangeListener | null = null;
  const service: AuthService = {
    exchangeCodeForSession: vi.fn(async () => sessionFor()),
    getSession: vi.fn(async () => session),
    onAuthStateChange: vi.fn((nextListener) => {
      listener = nextListener;
      return () => {
        listener = null;
      };
    }),
    sendMagicLink: vi.fn(async () => {}),
    signInWithGoogle: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    verifyEmailOtp: vi.fn(async () => sessionFor()),
  };
  return {
    service,
    emit(nextSession: Session | null, event?: AuthChangeEvent) {
      session = nextSession;
      listener?.(
        event ?? (nextSession ? "SIGNED_IN" : "SIGNED_OUT"),
        nextSession,
      );
    },
  };
}

function restoreProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
  } else {
    Reflect.deleteProperty(target, key);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
