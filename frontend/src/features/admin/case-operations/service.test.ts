import { createClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import type { Database } from "@/lib/supabase/database.types";
import { server } from "@/test/mocks/server";

import {
  createStaffCaseOperationsService,
  StaffCaseOperationsResponseError,
} from "./service";

const SUPABASE_URL = "https://admin-case-operations-test.supabase.co";
const CASE_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_CASE_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_USER_ID = "33333333-3333-4333-8333-333333333333";
const JOB_ID = "44444444-4444-4444-8444-444444444444";
const RUN_ID = "55555555-5555-4555-8555-555555555555";

function createTestService() {
  const client = createClient<Database>(
    SUPABASE_URL,
    "sb_publishable_admin_case_operations_test",
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  return createStaffCaseOperationsService(client);
}

describe("staff case-operations service", () => {
  it.each([true, false])(
    "returns the database staff decision %s",
    async (staff) => {
      server.use(
        http.post(`${SUPABASE_URL}/rest/v1/rpc/is_venfour_staff`, () =>
          HttpResponse.json(staff),
        ),
      );

      await expect(createTestService().isStaff()).resolves.toBe(staff);
    },
  );

  it("sorts relevant cases by activity and maps total-loss and submitted-DV rows", async () => {
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/staff_list_case_operations`,
        () =>
          HttpResponse.json([
            listRow(),
            listRow({
              case_id: SECOND_CASE_ID,
              service_type: "diminished_value",
              case_status: "submitted",
              case_stage: "submitted",
              last_activity_at: "2026-08-22T17:00:00.000Z",
              report_uploaded_at: null,
              analysis_status: null,
              analysis_attempt_count: null,
              analysis_retryable: null,
              analysis_failure_code: null,
              analysis_processing_expires_at: null,
            }),
          ]),
      ),
    );

    const result = await createTestService().listCases();

    expect(result.map((item) => item.caseId)).toEqual([
      SECOND_CASE_ID,
      CASE_ID,
    ]);
    expect(result[0]).toMatchObject({
      serviceType: "diminished_value",
      caseStatus: "submitted",
      caseStage: "submitted",
    });
    expect(result[1]).toMatchObject({
      customerFullName: "Ada Lovelace",
      verifiedEmail: "ada@example.com",
      serviceType: "total_loss",
      caseStage: "analysis_complete",
      analysisStatus: "completed",
      analysisAttemptCount: 1,
    });
  });

  it.each([
    ["unknown stage", { case_stage: "making_things_up" }],
    [
      "unsubmitted diminished-value case",
      {
        service_type: "diminished_value",
        case_status: "draft",
        case_stage: "intake_in_progress",
      },
    ],
    ["zero analysis attempts", { analysis_attempt_count: 0 }],
    ["unsafe failure code", { analysis_failure_code: "provider leaked text" }],
    ["inconsistent completed state", { analysis_retryable: true }],
    ["invalid owner", { owner_user_id: "../owner" }],
  ])("rejects a list row with %s", async (_label, overrides) => {
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/staff_list_case_operations`,
        () => HttpResponse.json([listRow(overrides)]),
      ),
    );

    await expect(createTestService().listCases()).rejects.toBeInstanceOf(
      StaffCaseOperationsResponseError,
    );
  });

  it("maps the bounded total-loss detail and verifies the requested identifier", async () => {
    let requestBody: unknown;
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/staff_get_total_loss_case_operation`,
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json([detailRow()]);
        },
      ),
    );

    const result = await createTestService().getTotalLossCase(CASE_ID);

    expect(requestBody).toEqual({ requested_case_id: CASE_ID });
    expect(result).toMatchObject({
      caseId: CASE_ID,
      ownerUserId: OWNER_USER_ID,
      customerFullName: "Ada Lovelace",
      operationalFollowUpAllowed: true,
      intakeMode: "report",
      vehicleYear: 2022,
      reportOriginalFilename: "valuation.pdf",
      analysisJobId: JOB_ID,
      analysisRunId: RUN_ID,
      analysisClassification: "potential_undervaluation",
      analysisEvidenceStrength: "strong",
    });
  });

  it("normalizes an uppercase case identifier before requesting its row", async () => {
    let requestBody: unknown;
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/staff_get_total_loss_case_operation`,
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json([detailRow()]);
        },
      ),
    );

    await expect(
      createTestService().getTotalLossCase(CASE_ID.toUpperCase()),
    ).resolves.toMatchObject({ caseId: CASE_ID });
    expect(requestBody).toEqual({ requested_case_id: CASE_ID });
  });

  it("returns null for a case hidden by the database", async () => {
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/staff_get_total_loss_case_operation`,
        () => HttpResponse.json([]),
      ),
    );

    await expect(
      createTestService().getTotalLossCase(CASE_ID),
    ).resolves.toBeNull();
  });

  it.each([
    ["a mismatched identifier", [detailRow({ case_id: SECOND_CASE_ID })]],
    [
      "a non-total-loss service",
      [
        detailRow({
          service_type: "diminished_value",
          case_status: "submitted",
          case_stage: "submitted",
        }),
      ],
    ],
    ["more than one row", [detailRow(), detailRow()]],
    ["an invalid date", [detailRow({ date_of_loss: "2026-02-30" })]],
    [
      "an invalid completed-run field",
      [detailRow({ analysis_version: { unsafe: true } })],
    ],
  ])("rejects detail containing %s", async (_label, response) => {
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/staff_get_total_loss_case_operation`,
        () => HttpResponse.json(response),
      ),
    );

    await expect(
      createTestService().getTotalLossCase(CASE_ID),
    ).rejects.toBeInstanceOf(StaffCaseOperationsResponseError);
  });

  it("exposes no case mutation methods", () => {
    expect(Object.keys(createTestService()).sort()).toEqual([
      "getTotalLossCase",
      "isStaff",
      "listCases",
    ]);
  });
});

function listRow(overrides: Record<string, unknown> = {}) {
  return {
    case_id: CASE_ID,
    owner_user_id: OWNER_USER_ID,
    customer_full_name: "Ada Lovelace",
    verified_email: "ada@example.com",
    owner_is_anonymous: false,
    contact_full_name: "Ada Lovelace",
    contact_email: "ada@example.com",
    contact_email_verified: true,
    identity_claimed_at: "2026-08-20T14:05:00.000Z",
    service_type: "total_loss",
    case_status: "check_complete",
    case_stage: "analysis_complete",
    needs_attention: false,
    case_created_at: "2026-08-20T13:00:00.000Z",
    case_updated_at: "2026-08-21T14:00:00.000Z",
    last_activity_at: "2026-08-21T15:00:00.000Z",
    report_uploaded_at: "2026-08-20T14:30:00.000Z",
    analysis_status: "completed",
    analysis_attempt_count: 1,
    analysis_retryable: null,
    analysis_failure_code: null,
    analysis_processing_expires_at: null,
    ...overrides,
  };
}

function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    ...listRow(),
    operational_follow_up_allowed: true,
    intake_mode: "report",
    vin: "1HGCV1F30NA000001",
    vehicle_year: 2022,
    vehicle_make: "Honda",
    vehicle_model: "Accord",
    vehicle_trim: "EX-L",
    mileage_at_loss: 48250,
    postal_code: "60601",
    date_of_loss: "2026-07-04",
    insurer_name: "Example Mutual",
    insurer_vehicle_valuation: 21450.5,
    vehicle_condition: "Good",
    vehicle_options_packages: "Technology package",
    report_provider_name: "Example valuation provider",
    report_extraction_status: "confirmed",
    report_extraction_confidence: 0.91,
    report_extracted_at: "2026-08-20T13:55:00.000Z",
    report_facts_confirmed_at: "2026-08-20T14:00:00.000Z",
    analysis_input_revision: 4,
    analysis_input_id: "66666666-6666-4666-8666-666666666666",
    intake_completed_at: "2026-08-20T14:00:00.000Z",
    details_created_at: "2026-08-20T13:10:00.000Z",
    details_updated_at: "2026-08-20T14:30:00.000Z",
    report_original_filename: "valuation.pdf",
    report_storage_owner_id: OWNER_USER_ID,
    report_storage_object_path: `${OWNER_USER_ID}/${CASE_ID}/valuation-report.pdf`,
    analysis_job_id: JOB_ID,
    analysis_job_created_at: "2026-08-20T14:31:00.000Z",
    analysis_job_updated_at: "2026-08-20T14:35:00.000Z",
    analysis_job_finished_at: "2026-08-20T14:35:00.000Z",
    analysis_run_id: RUN_ID,
    analysis_run_created_at: "2026-08-20T14:35:00.000Z",
    analysis_run_schema_version: "1.0.0",
    analysis_version: "phase3f",
    discrepancy_analysis_version: "1.0.0",
    comparable_scoring_version: "1.0.0",
    analysis_classification: "potential_undervaluation",
    analysis_evidence_strength: "strong",
    analysis_evidence_basis: "Three eligible independent comparables.",
    ...overrides,
  };
}
