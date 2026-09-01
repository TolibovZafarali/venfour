import { createClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  AppraisalCaseResponseError,
  createAppraisalCaseService,
  type AppraisalCaseService,
} from "@/features/cases/service";
import type {
  AppraisalCase,
  CreateAppraisalCaseInput,
} from "@/features/cases/types";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { server } from "@/test/mocks/server";

const SUPABASE_URL = "https://case-test.supabase.co";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_ID = "33333333-3333-4333-8333-333333333333";
const CASE_COLUMNS =
  "id,user_id,service_type,status,created_at,updated_at,last_activity_at";

const caseRow: Tables<"appraisal_cases"> = {
  id: CASE_ID,
  user_id: USER_ID,
  service_type: "total_loss",
  status: "draft",
  created_at: "2026-08-18T14:00:00.000Z",
  updated_at: "2026-08-18T14:00:00.000Z",
  last_activity_at: "2026-08-18T14:00:00.000Z",
};

const expectedCase: AppraisalCase = {
  id: CASE_ID,
  userId: USER_ID,
  serviceType: "total_loss",
  status: "draft",
  createdAt: "2026-08-18T14:00:00.000Z",
  updatedAt: "2026-08-18T14:00:00.000Z",
  lastActivityAt: "2026-08-18T14:00:00.000Z",
};

const ownedCaseOperationRow = {
    case_id: CASE_ID,
    owner_user_id: USER_ID,
    service_type: "total_loss",
    case_status: "draft",
    case_stage: "analysis_processing",
    needs_attention: false,
    case_created_at: "2026-08-18T14:00:00.000Z",
    case_updated_at: "2026-08-18T15:00:00.000Z",
    last_activity_at: "2026-08-18T15:00:00.000Z",
    report_uploaded_at: "2026-08-18T14:30:00.000Z",
    analysis_status: "processing",
    analysis_attempt_count: 2,
    analysis_retryable: null,
    analysis_failure_code: null,
    analysis_processing_expires_at: "2026-08-18T15:05:00.000Z",
    has_total_loss_claim_workflow: false,
};

const expectedOperationCase: AppraisalCase = {
  ...expectedCase,
  updatedAt: "2026-08-18T15:00:00.000Z",
  lastActivityAt: "2026-08-18T15:00:00.000Z",
  caseStage: "analysis_processing",
  needsAttention: false,
  reportUploadedAt: "2026-08-18T14:30:00.000Z",
  analysisStatus: "processing",
  analysisAttemptCount: 2,
  analysisRetryable: null,
  analysisFailureCode: null,
  analysisProcessingExpiresAt: "2026-08-18T15:05:00.000Z",
  hasTotalLossClaimWorkflow: false,
};

function createTestService() {
  const client = createClient<Database>(
    SUPABASE_URL,
    "sb_publishable_case_test",
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );

  return createAppraisalCaseService(client);
}

describe("appraisal case service", () => {
  it("creates a draft-defaulted case without sending a browser-controlled status", async () => {
    let requestBody: unknown;
    let requestUrl: URL | undefined;

    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/appraisal_cases`,
        async ({ request }) => {
          requestUrl = new URL(request.url);
          requestBody = await request.json();
          return HttpResponse.json(caseRow);
        },
      ),
    );

    const result = await createTestService().createAppraisalCase({
      userId: USER_ID,
      serviceType: "total_loss",
    });

    expect(requestBody).toEqual({
      service_type: "total_loss",
      user_id: USER_ID,
    });
    expect(requestUrl?.searchParams.get("select")).toBe(CASE_COLUMNS);
    expect(result).toEqual(expectedCase);
  });

  it("creates a case with a stable browser-reserved ID and no status", async () => {
    let requestBody: unknown;

    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/appraisal_cases`,
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json(caseRow);
        },
      ),
    );

    await expect(
      createTestService().createOrGetAppraisalCase({
        caseId: CASE_ID,
        userId: USER_ID,
        serviceType: "total_loss",
      }),
    ).resolves.toEqual(expectedCase);
    expect(requestBody).toEqual({
      id: CASE_ID,
      service_type: "total_loss",
      user_id: USER_ID,
    });
  });

  it("recovers a duplicate or lost insert response by fetching the same owned draft", async () => {
    server.use(
      http.post(`${SUPABASE_URL}/rest/v1/appraisal_cases`, () =>
        HttpResponse.json(
          {
            code: "23505",
            details: null,
            hint: null,
            message: "duplicate key value violates unique constraint",
          },
          { status: 409 },
        ),
      ),
      http.get(`${SUPABASE_URL}/rest/v1/appraisal_cases`, () =>
        HttpResponse.json(caseRow),
      ),
    );

    await expect(
      createTestService().createOrGetAppraisalCase({
        caseId: CASE_ID,
        userId: USER_ID,
        serviceType: "total_loss",
      }),
    ).resolves.toEqual(expectedCase);
  });

  it("rejects a recovered case outside the expected service or draft status", async () => {
    server.use(
      http.post(`${SUPABASE_URL}/rest/v1/appraisal_cases`, () =>
        HttpResponse.json(
          {
            code: "23505",
            details: null,
            hint: null,
            message: "duplicate key value violates unique constraint",
          },
          { status: 409 },
        ),
      ),
      http.get(`${SUPABASE_URL}/rest/v1/appraisal_cases`, () =>
        HttpResponse.json({ ...caseRow, status: "paid" }),
      ),
    );

    await expect(
      createTestService().createOrGetAppraisalCase({
        caseId: CASE_ID,
        userId: USER_ID,
        serviceType: "total_loss",
      }),
    ).rejects.toBeInstanceOf(AppraisalCaseResponseError);
  });

  it("uses the owned operations RPC and maps its computed case stage", async () => {
    let requestBody: unknown;

    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/list_owned_case_operations`,
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json([ownedCaseOperationRow]);
        },
      ),
    );

    const result = await createTestService().listAppraisalCases(USER_ID);

    expect(requestBody).toEqual({});
    expect(result).toEqual([expectedOperationCase]);
  });

  it("rejects an owner-list row outside the active ownership scope", async () => {
    server.use(
      http.post(`${SUPABASE_URL}/rest/v1/rpc/list_owned_case_operations`, () =>
        HttpResponse.json([
          { ...ownedCaseOperationRow, owner_user_id: OTHER_USER_ID },
        ]),
      ),
    );

    await expect(
      createTestService().listAppraisalCases(USER_ID),
    ).rejects.toBeInstanceOf(AppraisalCaseResponseError);
  });

  it("atomically gets or creates the active owner's Total Loss draft", async () => {
    let requestBody: unknown;

    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/get_or_create_total_loss_draft`,
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json(caseRow);
        },
      ),
    );

    await expect(
      createTestService().getOrCreateTotalLossDraft({ userId: USER_ID }),
    ).resolves.toEqual(expectedCase);
    expect(requestBody).toEqual({});
  });

  it("rejects an atomic Total Loss draft outside the expected workflow", async () => {
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/get_or_create_total_loss_draft`,
        () => HttpResponse.json({ ...caseRow, user_id: OTHER_USER_ID }),
      ),
    );

    await expect(
      createTestService().getOrCreateTotalLossDraft({ userId: USER_ID }),
    ).rejects.toBeInstanceOf(AppraisalCaseResponseError);
  });

  it("server-filters and limits the most recent draft for a workflow", async () => {
    let requestUrl: URL | undefined;

    server.use(
      http.get(`${SUPABASE_URL}/rest/v1/appraisal_cases`, ({ request }) => {
        requestUrl = new URL(request.url);
        return HttpResponse.json(caseRow);
      }),
    );

    await expect(
      createTestService().getRecentDraftAppraisalCase({
        userId: USER_ID,
        serviceType: "total_loss",
      }),
    ).resolves.toEqual(expectedCase);

    expect(requestUrl?.searchParams.get("user_id")).toBe(`eq.${USER_ID}`);
    expect(requestUrl?.searchParams.get("service_type")).toBe("eq.total_loss");
    expect(requestUrl?.searchParams.get("status")).toBe("eq.draft");
    expect(requestUrl?.searchParams.get("order")).toBe("last_activity_at.desc");
    expect(requestUrl?.searchParams.get("limit")).toBe("1");
  });

  it("scopes detail requests to both owner and case ID", async () => {
    let requestUrl: URL | undefined;

    server.use(
      http.get(`${SUPABASE_URL}/rest/v1/appraisal_cases`, ({ request }) => {
        requestUrl = new URL(request.url);
        return HttpResponse.json(caseRow);
      }),
    );

    const result = await createTestService().getAppraisalCase({
      userId: USER_ID,
      caseId: CASE_ID,
    });

    expect(requestUrl?.searchParams.get("user_id")).toBe(`eq.${USER_ID}`);
    expect(requestUrl?.searchParams.get("id")).toBe(`eq.${CASE_ID}`);
    expect(result).toEqual(expectedCase);
  });

  it("returns null when an owned case does not exist", async () => {
    server.use(
      http.get(`${SUPABASE_URL}/rest/v1/appraisal_cases`, () =>
        HttpResponse.json(null),
      ),
    );

    await expect(
      createTestService().getAppraisalCase({
        userId: USER_ID,
        caseId: CASE_ID,
      }),
    ).resolves.toBeNull();
  });

  it("touches a case through the restricted RPC without sending owner or status", async () => {
    let requestBody: unknown;

    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/touch_appraisal_case`,
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json({
            ...caseRow,
            last_activity_at: "2026-08-18T15:30:00.000Z",
            updated_at: "2026-08-18T15:30:00.000Z",
          });
        },
      ),
    );

    const result = await createTestService().touchAppraisalCase({
      userId: USER_ID,
      caseId: CASE_ID,
    });

    expect(requestBody).toEqual({ case_id: CASE_ID });
    expect(result).toMatchObject({
      id: CASE_ID,
      userId: USER_ID,
      lastActivityAt: "2026-08-18T15:30:00.000Z",
    });
  });

  it("propagates Supabase errors", async () => {
    server.use(
      http.post(`${SUPABASE_URL}/rest/v1/rpc/list_owned_case_operations`, () =>
        HttpResponse.json(
          {
            code: "42501",
            details: null,
            hint: null,
            message: "permission denied for function",
          },
          { status: 403 },
        ),
      ),
    );

    await expect(
      createTestService().listAppraisalCases(USER_ID),
    ).rejects.toMatchObject({
      code: "42501",
      message: "permission denied for function",
    });
  });

  it("rejects a touched row outside the requested ownership scope", async () => {
    server.use(
      http.post(`${SUPABASE_URL}/rest/v1/rpc/touch_appraisal_case`, () =>
        HttpResponse.json({
          ...caseRow,
          user_id: "33333333-3333-4333-8333-333333333333",
        }),
      ),
    );

    await expect(
      createTestService().touchAppraisalCase({
        userId: USER_ID,
        caseId: CASE_ID,
      }),
    ).rejects.toBeInstanceOf(AppraisalCaseResponseError);
  });

  it("does not expose a browser status or generic update mutation", () => {
    expectTypeOf<keyof CreateAppraisalCaseInput>().toEqualTypeOf<
      "userId" | "serviceType"
    >();
    expectTypeOf<keyof AppraisalCaseService>().toEqualTypeOf<
      | "createAppraisalCase"
      | "createOrGetAppraisalCase"
      | "getOrCreateTotalLossDraft"
      | "listAppraisalCases"
      | "getRecentDraftAppraisalCase"
      | "getAppraisalCase"
      | "touchAppraisalCase"
    >();
  });
});
