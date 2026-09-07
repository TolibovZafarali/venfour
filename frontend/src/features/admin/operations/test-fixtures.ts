import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { vi } from "vitest";
import type { StaffCaseOperationListItem, StaffTotalLossCaseOperation } from "@/features/admin/case-operations/types";
import type { AdminCaseOperationsDependencies } from "@/features/admin/case-operations/dependencies-context";
import type { AuthService, AuthStateChangeListener } from "@/features/auth/auth-service";
import type { AdminListOptions, AdminOperationsService, AdminPage, AdminResource, AdminRow } from "./types";

export const STAFF_USER_ID = "11111111-1111-4111-8111-111111111111";
export const OWNER_USER_ID = "22222222-2222-4222-8222-222222222222";
export const CASE_ID = "33333333-3333-4333-8333-333333333333";
const JOB_ID = "55555555-5555-4555-8555-555555555555";
const RUN_ID = "66666666-6666-4666-8666-666666666666";
export const ADMIN_TIME = "2026-09-07T12:00:00.000Z";

export function createAdminRow(overrides: Partial<AdminRow> = {}): AdminRow {
  return { id: CASE_ID, caseId: CASE_ID, customerId: OWNER_USER_ID, title: "Ada Lovelace", subtitle: "ada@example.com", summary: "2022 Honda Accord", status: "awaiting_insurer_response", kind: "total_loss", identity: "account", verified: true, caseCount: null, attentionReasons: [], createdAt: ADMIN_TIME, updatedAt: ADMIN_TIME, facts: [{ label: "Initial stage", value: "analysis_complete" }], sections: [{ title: "Technical details", facts: [{ label: "Case ID", value: CASE_ID }] }], ...overrides };
}

export function createAdminTestDependencies({ rows = {}, staff = true, legacyCase = createLegacyAdminCase() }: { readonly rows?: Partial<Record<AdminResource, readonly AdminRow[]>>; readonly staff?: boolean; readonly legacyCase?: StaffTotalLossCaseOperation | null } = {}): AdminCaseOperationsDependencies & { operationsService: AdminOperationsService } {
  const records: Record<AdminResource, readonly AdminRow[]> = { cases: [createAdminRow()], customers: [createAdminRow({ id: OWNER_USER_ID, customerId: OWNER_USER_ID, caseId: null, kind: "account", status: "verified", caseCount: 1, summary: "1 total-loss case" })], reports: [], processing: [], payments: [], activity: [], ...rows };
  async function list(resource: AdminResource, options: AdminListOptions = {}): Promise<AdminPage> {
    let items = [...records[resource]];
    const filters = options.filters ?? {};
    if (resource === "customers") items = items.filter(row => row.identity === (filters.identity ?? "account"));
    if (options.search) items = items.filter(row => [row.title, row.subtitle, row.summary, row.id].join(" ").toLowerCase().includes(options.search!.trim().toLowerCase()));
    for (const [key, value] of Object.entries(filters)) {
      if (key === "attention") items = items.filter(row => Boolean(row.attentionReasons.length) === (value === "true"));
      else if (key === "active") items = items.filter(row => (row.status !== "closed") === (value === "true"));
      else if (key === "hasCases") items = items.filter(row => Boolean(row.caseCount) === (value === "true"));
      else if (key === "verified") items = items.filter(row => row.verified === (value === "true"));
      else if (["caseId", "customerId", "status", "kind", "identity"].includes(key)) items = items.filter(row => row[key as keyof AdminRow] === value);
    }
    const timestamp = options.sort === "created" ? "createdAt" : "updatedAt";
    items.sort((a,b) => Date.parse(b[timestamp]) - Date.parse(a[timestamp]) || b.id.localeCompare(a.id));
    const total = items.length;
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 50;
    return { items: items.slice((page - 1) * pageSize, page * pageSize).map(row => ({ ...row, sections: [] })), total, page, pageSize, asOf: ADMIN_TIME };
  }
  return {
    caseService: { isStaff: vi.fn(async () => staff), listCases: vi.fn(async () => legacyCase ? [legacyCase] : []), getTotalLossCase: vi.fn(async id => legacyCase?.caseId === id ? legacyCase : null) },
    operationsService: {
      list: vi.fn(list),
      overview: vi.fn(async () => ({ asOf: ADMIN_TIME, activeCases: records.cases.filter(row => row.status !== "closed").length, attentionCases: records.cases.filter(row => row.attentionReasons.length).length, processingJobs: records.processing.filter(row => row.status === "processing").length, registeredAccounts: records.customers.filter(row => row.identity === "account").length, attention: records.cases.filter(row => row.attentionReasons.length).slice(0,5), activity: records.activity.slice(0,8) })),
      customer: vi.fn(async id => records.customers.find(row => row.customerId === id) ?? null),
      case: vi.fn(async id => records.cases.find(row => row.caseId === id) ?? null),
      record: vi.fn(async (resource: AdminResource, id: string) => records[resource].find(row => row.id === id) ?? null),
    },
  };
}

export function createLegacyAdminListItem(
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

export function createLegacyAdminCase(): StaffTotalLossCaseOperation {
  return {
    ...createLegacyAdminListItem(),
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

export function createAdminStaffSession(): Session {
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

export function createAdminAuthHarness(initialSession: Session | null) {
  let session = initialSession;
  let listener: AuthStateChangeListener | null = null;
  const service: AuthService = {
    exchangeCodeForSession: vi.fn(async () => createAdminStaffSession()),
    getSession: vi.fn(async () => session),
    onAuthStateChange: vi.fn((nextListener) => {
      listener = nextListener;
      return () => {
        listener = null;
      };
    }),
    sendEmailCode: async () => undefined,
    verifyEmailCode: async () => { throw new Error("Unexpected email code verification."); },
    sendMagicLink: vi.fn(async () => {}),
    signInWithGoogle: vi.fn(async () => {}),
    signInWithApple: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    verifyEmailOtp: vi.fn(async () => createAdminStaffSession()),
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
