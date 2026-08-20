import { createClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import type { Database } from "@/lib/supabase/database.types";
import { server } from "@/test/mocks/server";

import {
  createStaffDiminishedValueCaseService,
  StaffDiminishedValueResponseError,
} from "./service";

const SUPABASE_URL = "https://admin-diminished-value-test.supabase.co";
const CASE_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_CASE_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_USER_ID = "33333333-3333-4333-8333-333333333333";

function createTestService() {
  const client = createClient<Database>(
    SUPABASE_URL,
    "sb_publishable_admin_diminished_value_test",
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  return createStaffDiminishedValueCaseService(client);
}

describe("staff diminished-value case service", () => {
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

  it("sorts the submitted queue newest first and maps its narrow fields", async () => {
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/list_submitted_diminished_value_cases`,
        () =>
          HttpResponse.json([
            queueRow({
              case_id: CASE_ID,
              submitted_at: "2026-08-19T14:00:00.000Z",
            }),
            queueRow({
              case_id: SECOND_CASE_ID,
              submitted_at: "2026-08-20T15:00:00.000Z",
              document_count: 2,
              full_name: "Grace Hopper",
            }),
          ]),
      ),
    );

    const result = await createTestService().listSubmittedCases();

    expect(result.map((item) => item.caseId)).toEqual([
      SECOND_CASE_ID,
      CASE_ID,
    ]);
    expect(result[0]).toMatchObject({
      documentCount: 2,
      fullName: "Grace Hopper",
      ownerUserId: OWNER_USER_ID,
      serviceType: "diminished_value",
      status: "submitted",
    });
  });

  it.each([
    ["draft", { status: "draft" }],
    ["total-loss", { service_type: "total_loss" }],
    ["negative document count", { document_count: -1 }],
    ["invalid owner", { owner_user_id: "../owner" }],
  ])(
    "rejects a queue row outside the %s contract",
    async (_label, override) => {
      server.use(
        http.post(
          `${SUPABASE_URL}/rest/v1/rpc/list_submitted_diminished_value_cases`,
          () => HttpResponse.json([queueRow(override)]),
        ),
      );

      await expect(
        createTestService().listSubmittedCases(),
      ).rejects.toBeInstanceOf(StaffDiminishedValueResponseError);
    },
  );

  it("maps the complete submitted case and verifies the requested identifier", async () => {
    let requestBody: unknown;
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/get_submitted_diminished_value_case`,
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json([detailRow()]);
        },
      ),
    );

    const result = await createTestService().getSubmittedCase(CASE_ID);

    expect(requestBody).toEqual({ requested_case_id: CASE_ID });
    expect(result).toMatchObject({
      caseId: CASE_ID,
      ownerUserId: OWNER_USER_ID,
      status: "submitted",
      fullName: "Ada Lovelace",
      vehicleYear: 2022,
      vehicleMake: "Honda",
      vehicleModel: "Accord",
      submittedAt: "2026-08-19T15:00:00.000Z",
      revision: 4,
    });
  });

  it("normalizes an uppercase case identifier before requesting its row", async () => {
    let requestBody: unknown;
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/get_submitted_diminished_value_case`,
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json([detailRow()]);
        },
      ),
    );

    await expect(
      createTestService().getSubmittedCase(CASE_ID.toUpperCase()),
    ).resolves.toMatchObject({ caseId: CASE_ID });
    expect(requestBody).toEqual({ requested_case_id: CASE_ID });
  });

  it("returns null for a case hidden by the database", async () => {
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/get_submitted_diminished_value_case`,
        () => HttpResponse.json([]),
      ),
    );

    await expect(
      createTestService().getSubmittedCase(CASE_ID),
    ).resolves.toBeNull();
  });

  it("rejects malformed or out-of-scope detail responses", async () => {
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/get_submitted_diminished_value_case`,
        () => HttpResponse.json([detailRow({ case_id: SECOND_CASE_ID })]),
      ),
    );

    await expect(
      createTestService().getSubmittedCase(CASE_ID),
    ).rejects.toBeInstanceOf(StaffDiminishedValueResponseError);
  });

  it("exposes no case mutation methods", () => {
    expect(Object.keys(createTestService()).sort()).toEqual([
      "getSubmittedCase",
      "isStaff",
      "listSubmittedCases",
    ]);
  });
});

function queueRow(overrides: Record<string, unknown> = {}) {
  return {
    case_id: CASE_ID,
    owner_user_id: OWNER_USER_ID,
    service_type: "diminished_value",
    status: "submitted",
    submitted_at: "2026-08-19T15:00:00.000Z",
    full_name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "312-555-0123",
    preferred_contact_method: "email",
    vehicle_year: 2022,
    vehicle_make: "Honda",
    vehicle_model: "Accord",
    accident_date: "2026-07-04",
    at_fault_insurer: "Example Mutual",
    document_count: 1,
    ...overrides,
  };
}

function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    case_id: CASE_ID,
    owner_user_id: OWNER_USER_ID,
    service_type: "diminished_value",
    status: "submitted",
    draft_step: "consultation",
    accident_state: "IL",
    accident_date: "2026-07-04",
    repair_status: "complete",
    vehicle_entry_method: "details",
    vin: null,
    vehicle_year: 2022,
    vehicle_make: "Honda",
    vehicle_model: "Accord",
    vehicle_trim: "EX-L",
    mileage_at_accident: 48250,
    current_mileage: 49100,
    other_party_at_fault: "yes",
    at_fault_insurer: "Example Mutual",
    repair_cost: 12500.5,
    repair_facility: "Example Collision",
    structural_damage: "no",
    airbag_deployment: "no",
    major_repair_details: "Replaced the front bumper and hood.",
    full_name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "312-555-0123",
    preferred_contact_method: "email",
    availability: "Weekdays after 4 p.m. Central Time",
    notes: "Please review the repair invoice.",
    submitted_at: "2026-08-19T15:00:00.000Z",
    revision: 4,
    created_at: "2026-08-18T15:00:00.000Z",
    updated_at: "2026-08-19T15:00:00.000Z",
    ...overrides,
  };
}
