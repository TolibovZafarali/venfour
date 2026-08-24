import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AdminCaseOperationsDependencies } from "@/features/admin/case-operations/dependencies";
import { adminCaseOperationsQueryKeys } from "@/features/admin/case-operations/queries";
import type {
  StaffCaseOperationListItem,
  StaffTotalLossCaseOperation,
} from "@/features/admin/case-operations/types";
import type {
  AuthService,
  AuthStateChangeListener,
} from "@/features/auth/auth-service";
import { renderTestApp } from "@/test/render";

const STAFF_USER_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_USER_ID = "22222222-2222-4222-8222-222222222222";
const CASE_ID = "33333333-3333-4333-8333-333333333333";
const DV_CASE_ID = "44444444-4444-4444-8444-444444444444";
const JOB_ID = "55555555-5555-4555-8555-555555555555";
const RUN_ID = "66666666-6666-4666-8666-666666666666";

describe("admin case-operations pages", () => {
  it("requires database-backed staff access before loading case data", async () => {
    const dependencies = createAdminDependencies({ staff: false });
    renderTestApp(["/admin/cases"], {
      adminCaseOperationsDependencies: dependencies,
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t find this page.",
      }),
    ).toBeVisible();
    expect(dependencies.caseService.isStaff).toHaveBeenCalledOnce();
    expect(dependencies.caseService.listCases).not.toHaveBeenCalled();
    expect(dependencies.caseService.getTotalLossCase).not.toHaveBeenCalled();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
  });

  it("renders only the relevant mixed case list and preserves the DV detail route", async () => {
    const totalLoss = listItem();
    const diminishedValue = listItem({
      caseId: DV_CASE_ID,
      serviceType: "diminished_value",
      caseStatus: "submitted",
      caseStage: "submitted",
      needsAttention: false,
      reportUploadedAt: null,
      analysisStatus: null,
      analysisAttemptCount: null,
      analysisRetryable: null,
      analysisFailureCode: null,
      analysisProcessingExpiresAt: null,
      contactFullName: null,
      contactEmail: null,
      contactEmailVerified: false,
      identityClaimedAt: null,
    });
    const dependencies = createAdminDependencies({
      cases: [totalLoss, diminishedValue],
    });
    renderTestApp(["/admin/cases"], {
      adminCaseOperationsDependencies: dependencies,
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("heading", {
        name: "Customer and case operations",
      }),
    ).toBeVisible();
    const cases = await screen.findByRole("list", { name: "Customer cases" });
    const cards = within(cases).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Ada Lovelace");
    expect(cards[0]).toHaveTextContent("#33333333");
    expect(cards[0]).toHaveTextContent("Analysis failed");
    expect(cards[0]).toHaveTextContent("Needs attention");
    expect(cards[1]).toHaveTextContent("Diminished value");
    expect(
      within(cards[1]).getByRole("link", { name: "Open request" }),
    ).toHaveAttribute("href", `/admin/diminished-value/${DV_CASE_ID}`);
    expect(
      screen.queryByRole("navigation", { name: "Primary navigation" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  });

  it("renders bounded total-loss operational detail without mutation or PDF controls", async () => {
    const dependencies = createAdminDependencies();
    renderTestApp([`/admin/cases/${CASE_ID}`], {
      adminCaseOperationsDependencies: dependencies,
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("heading", {
        name: "Total-loss case #33333333",
      }),
    ).toBeVisible();
    for (const heading of [
      "Customer",
      "Case",
      "Total-loss intake",
      "Valuation report",
      "Analysis activity",
      "Completed run summary",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeVisible();
    }
    expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ada@example.com").length).toBeGreaterThan(0);
    expect(screen.getByText("valuation.pdf")).toBeVisible();
    expect(screen.getByText("Provider Timeout")).toBeVisible();
    expect(screen.getByText("Material Undervalue Signal")).toBeVisible();
    expect(screen.getByText("Strong")).toBeVisible();
    expect(screen.getByText("Current Market")).toBeVisible();
    expect(dependencies.caseService.getTotalLossCase).toHaveBeenCalledWith(
      CASE_ID,
    );

    for (const control of [
      "Edit",
      "Delete",
      "Approve",
      "Retry analysis",
      "Download",
      "View PDF",
      "Impersonate",
    ]) {
      expect(
        screen.queryByRole("button", { name: new RegExp(control, "iu") }),
      ).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("link", { name: /PDF/iu })).not.toBeInTheDocument();
  });

  it("normalizes an uppercase route identifier before reading detail", async () => {
    const dependencies = createAdminDependencies();
    renderTestApp([`/admin/cases/${CASE_ID.toUpperCase()}`], {
      adminCaseOperationsDependencies: dependencies,
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("heading", {
        name: "Total-loss case #33333333",
      }),
    ).toBeVisible();
    expect(dependencies.caseService.getTotalLossCase).toHaveBeenCalledWith(
      CASE_ID,
    );
  });

  it("uses one neutral state for invalid, nonexistent, and nonstaff case identifiers", async () => {
    const dependencies = createAdminDependencies({ appraisalCase: null });
    const invalid = renderTestApp(["/admin/cases/not-a-case"], {
      adminCaseOperationsDependencies: dependencies,
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t find this case.",
      }),
    ).toBeVisible();
    expect(dependencies.caseService.getTotalLossCase).not.toHaveBeenCalled();
    invalid.unmount();

    renderTestApp([`/admin/cases/${CASE_ID}`], {
      adminCaseOperationsDependencies: dependencies,
      authService: createAuthHarness(sessionFor()).service,
    });
    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t find this case.",
      }),
    ).toBeVisible();
  });

  it("removes protected case data after same-token staff revocation", async () => {
    let staff = true;
    const dependencies = createAdminDependencies();
    vi.mocked(dependencies.caseService.isStaff).mockImplementation(
      async () => staff,
    );
    const { queryClient } = renderTestApp(["/admin/cases"], {
      adminCaseOperationsDependencies: dependencies,
      authService: createAuthHarness(sessionFor()).service,
    });

    expect(await screen.findByText("Ada Lovelace")).toBeVisible();
    expect(
      queryClient.getQueryData(adminCaseOperationsQueryKeys.cases(STAFF_USER_ID)),
    ).toBeDefined();

    staff = false;
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: adminCaseOperationsQueryKeys.access(STAFF_USER_ID),
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
          adminCaseOperationsQueryKeys.cases(STAFF_USER_ID),
        ),
      ).toBeUndefined(),
    );
  });

  it("removes protected case data when the authenticated session signs out", async () => {
    const auth = createAuthHarness(sessionFor());
    const { queryClient } = renderTestApp(["/admin/cases"], {
      adminCaseOperationsDependencies: createAdminDependencies(),
      authService: auth.service,
    });
    expect(await screen.findByText("Ada Lovelace")).toBeVisible();

    await act(async () => auth.emit(null, "SIGNED_OUT"));

    expect(
      await screen.findByRole("heading", { name: "Sign in to continue." }),
    ).toBeVisible();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    expect(
      queryClient.getQueryData(adminCaseOperationsQueryKeys.cases(STAFF_USER_ID)),
    ).toBeUndefined();
  });
});

function createAdminDependencies({
  appraisalCase = totalLossCase(),
  cases = [listItem()],
  staff = true,
}: {
  readonly appraisalCase?: StaffTotalLossCaseOperation | null;
  readonly cases?: StaffCaseOperationListItem[];
  readonly staff?: boolean;
} = {}): AdminCaseOperationsDependencies {
  return {
    caseService: {
      getTotalLossCase: vi.fn(async () => appraisalCase),
      isStaff: vi.fn(async () => staff),
      listCases: vi.fn(async () => cases),
    },
  };
}

function listItem(
  overrides: Partial<StaffCaseOperationListItem> = {},
): StaffCaseOperationListItem {
  return {
    caseId: CASE_ID,
    ownerUserId: OWNER_USER_ID,
    customerFullName: "Ada Lovelace",
    verifiedEmail: "ada@example.com",
    ownerIsAnonymous: false,
    contactFullName: "Ada Lovelace",
    contactEmail: "ada@example.com",
    contactEmailVerified: true,
    identityClaimedAt: "2026-08-20T14:05:00.000Z",
    serviceType: "total_loss",
    caseStatus: "draft",
    caseStage: "analysis_failed",
    needsAttention: true,
    caseCreatedAt: "2026-08-20T13:00:00.000Z",
    caseUpdatedAt: "2026-08-21T14:00:00.000Z",
    lastActivityAt: "2026-08-21T15:00:00.000Z",
    reportUploadedAt: "2026-08-20T14:30:00.000Z",
    analysisStatus: "failed",
    analysisAttemptCount: 2,
    analysisRetryable: true,
    analysisFailureCode: "PROVIDER_TIMEOUT",
    analysisProcessingExpiresAt: null,
    ...overrides,
  };
}

function totalLossCase(): StaffTotalLossCaseOperation {
  return {
    ...listItem(),
    serviceType: "total_loss",
    operationalFollowUpAllowed: true,
    intakeMode: "report",
    vin: "1HGCV1F30NA000001",
    vehicleYear: 2022,
    vehicleMake: "Honda",
    vehicleModel: "Accord",
    vehicleTrim: "EX-L",
    mileageAtLoss: 48250,
    postalCode: "60601",
    dateOfLoss: "2026-07-04",
    insurerName: "Example Mutual",
    insurerVehicleValuation: 21450.5,
    vehicleCondition: "Good",
    vehicleOptionsPackages: "Technology package",
    reportProviderName: "Example valuation provider",
    reportExtractionStatus: "confirmed",
    reportExtractionConfidence: 0.91,
    reportExtractedAt: "2026-08-20T13:55:00.000Z",
    reportFactsConfirmedAt: "2026-08-20T14:00:00.000Z",
    analysisInputRevision: 4,
    analysisInputId: "77777777-7777-4777-8777-777777777777",
    intakeCompletedAt: "2026-08-20T14:00:00.000Z",
    detailsCreatedAt: "2026-08-20T13:10:00.000Z",
    detailsUpdatedAt: "2026-08-20T14:30:00.000Z",
    reportOriginalFilename: "valuation.pdf",
    reportStorageOwnerId: OWNER_USER_ID,
    reportStorageObjectPath: `${OWNER_USER_ID}/${CASE_ID}/valuation-report.pdf`,
    analysisJobId: JOB_ID,
    analysisJobCreatedAt: "2026-08-20T14:31:00.000Z",
    analysisJobUpdatedAt: "2026-08-20T14:35:00.000Z",
    analysisJobFinishedAt: "2026-08-20T14:35:00.000Z",
    analysisRunId: RUN_ID,
    analysisRunCreatedAt: "2026-08-20T14:35:00.000Z",
    analysisRunSchemaVersion: "1.0.0",
    analysisVersion: "phase3f",
    discrepancyAnalysisVersion: "1.0.0",
    comparableScoringVersion: "1.0.0",
    analysisClassification: "MATERIAL_UNDERVALUE_SIGNAL",
    analysisEvidenceStrength: "STRONG",
    analysisEvidenceBasis: "CURRENT_MARKET",
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
