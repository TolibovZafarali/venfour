import { createClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import type { AppraisalCaseService } from "@/features/cases/service";
import type { AppraisalCase } from "@/features/cases/types";
import type {
  CreateDiminishedValueDetailsValues,
  DiminishedValueCaseDetails,
} from "@/features/diminished-value/data-types";
import {
  createDiminishedValueDetailsService,
  DiminishedValueDetailsConflictError,
  DiminishedValueDetailsResponseError,
} from "@/features/diminished-value/service";
import type { Database } from "@/lib/supabase/database.types";
import { server } from "@/test/mocks/server";

const SUPABASE_URL = "https://diminished-value-details-test.supabase.co";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_CASE_ID = "33333333-3333-4333-8333-333333333333";
const CREATED_AT = "2026-08-19T14:00:00.000Z";
const UPDATED_AT = "2026-08-19T15:00:00.000Z";
const SUBMITTED_AT = "2026-08-19T16:00:00.000Z";
const DETAILS_COLUMNS =
  "case_id,draft_step,accident_state,accident_date,repair_status,vehicle_entry_method,vin,vehicle_year,vehicle_make,vehicle_model,vehicle_trim,mileage_at_accident,current_mileage,other_party_at_fault,at_fault_insurer,repair_cost,repair_facility,structural_damage,airbag_deployment,major_repair_details,full_name,email,phone,preferred_contact_method,availability,notes,submitted_at,revision,created_at,updated_at";

const detailsRow = {
  case_id: CASE_ID,
  draft_step: "consultation",
  accident_state: "IL",
  accident_date: "2026-08-01",
  repair_status: "in-progress",
  vehicle_entry_method: "details",
  vin: null,
  vehicle_year: 2023,
  vehicle_make: "Honda",
  vehicle_model: "Accord",
  vehicle_trim: "EX-L",
  mileage_at_accident: 31250,
  current_mileage: 31900,
  other_party_at_fault: "yes",
  at_fault_insurer: "Example Insurance",
  repair_cost: 8450.75,
  repair_facility: "Example Collision",
  structural_damage: "no",
  airbag_deployment: "no",
  major_repair_details: "Replaced rear quarter panel.",
  full_name: "Jordan Example",
  email: "jordan@example.com",
  phone: "312-555-0100",
  preferred_contact_method: "email",
  availability: "Weekday afternoons",
  notes: "Please email first.",
  submitted_at: null,
  revision: 4,
  created_at: CREATED_AT,
  updated_at: UPDATED_AT,
};

const createValues = {
  draftStep: "consultation",
  accidentState: "IL",
  accidentDate: "2026-08-01",
  repairStatus: "in-progress",
  vehicleEntryMethod: "details",
  vin: null,
  vehicleYear: 2023,
  vehicleMake: "Honda",
  vehicleModel: "Accord",
  vehicleTrim: "EX-L",
  mileageAtAccident: 31250,
  currentMileage: 31900,
  otherPartyAtFault: "yes",
  atFaultInsurer: "Example Insurance",
  repairCost: 8450.75,
  repairFacility: "Example Collision",
  structuralDamage: "no",
  airbagDeployment: "no",
  majorRepairDetails: "Replaced rear quarter panel.",
  fullName: "Jordan Example",
  email: "jordan@example.com",
  phone: "312-555-0100",
  preferredContactMethod: "email",
  availability: "Weekday afternoons",
  notes: "Please email first.",
} satisfies CreateDiminishedValueDetailsValues;

const expectedDetails: DiminishedValueCaseDetails = {
  caseId: CASE_ID,
  draftStep: "consultation",
  accidentState: "IL",
  accidentDate: "2026-08-01",
  repairStatus: "in-progress",
  vehicleEntryMethod: "details",
  vin: null,
  vehicleYear: 2023,
  vehicleMake: "Honda",
  vehicleModel: "Accord",
  vehicleTrim: "EX-L",
  mileageAtAccident: 31250,
  currentMileage: 31900,
  otherPartyAtFault: "yes",
  atFaultInsurer: "Example Insurance",
  repairCost: 8450.75,
  repairFacility: "Example Collision",
  structuralDamage: "no",
  airbagDeployment: "no",
  majorRepairDetails: "Replaced rear quarter panel.",
  fullName: "Jordan Example",
  email: "jordan@example.com",
  phone: "312-555-0100",
  preferredContactMethod: "email",
  availability: "Weekday afternoons",
  notes: "Please email first.",
  submittedAt: null,
  revision: 4,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

const appraisalCase: AppraisalCase = {
  id: CASE_ID,
  userId: USER_ID,
  serviceType: "diminished_value",
  status: "draft",
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  lastActivityAt: UPDATED_AT,
};

function createTestHarness() {
  const client = createClient<Database>(
    SUPABASE_URL,
    "sb_publishable_diminished_value_test",
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  const touchAppraisalCase = vi.fn<
    AppraisalCaseService["touchAppraisalCase"]
  >(async () => appraisalCase);
  const appraisalCaseService = {
    createAppraisalCase: async () => appraisalCase,
    createOrGetAppraisalCase: async () => appraisalCase,
    getOrCreateTotalLossDraft: async () => appraisalCase,
    listAppraisalCases: async () => [],
    getRecentDraftAppraisalCase: async () => null,
    getAppraisalCase: async () => appraisalCase,
    touchAppraisalCase,
  } satisfies AppraisalCaseService;

  return {
    service: createDiminishedValueDetailsService(client, appraisalCaseService),
    touchAppraisalCase,
  };
}

describe("diminished-value details service", () => {
  it("fetches and maps details only for the requested parent case", async () => {
    let requestUrl: URL | undefined;
    server.use(
      http.get(
        `${SUPABASE_URL}/rest/v1/diminished_value_case_details`,
        ({ request }) => {
          requestUrl = new URL(request.url);
          return HttpResponse.json(detailsRow);
        },
      ),
    );

    const { service } = createTestHarness();
    await expect(
      service.getDetails({ caseId: CASE_ID, userId: USER_ID }),
    ).resolves.toEqual(expectedDetails);
    expect(requestUrl?.searchParams.get("case_id")).toBe(`eq.${CASE_ID}`);
    expect(requestUrl?.searchParams.get("select")).toBe(DETAILS_COLUMNS);
  });

  it("rejects details returned outside the requested case scope", async () => {
    server.use(
      http.get(
        `${SUPABASE_URL}/rest/v1/diminished_value_case_details`,
        () => HttpResponse.json({ ...detailsRow, case_id: OTHER_CASE_ID }),
      ),
    );

    const { service } = createTestHarness();
    await expect(
      service.getDetails({ caseId: CASE_ID, userId: USER_ID }),
    ).rejects.toBeInstanceOf(DiminishedValueDetailsResponseError);
  });

  it("rejects persisted text values outside the intake contract", async () => {
    server.use(
      http.get(
        `${SUPABASE_URL}/rest/v1/diminished_value_case_details`,
        () => HttpResponse.json({ ...detailsRow, draft_step: "complete" }),
      ),
    );

    const { service } = createTestHarness();
    await expect(
      service.getDetails({ caseId: CASE_ID, userId: USER_ID }),
    ).rejects.toBeInstanceOf(DiminishedValueDetailsResponseError);
  });

  it("creates only writable values and touches the exact parent scope", async () => {
    let requestBody: unknown;
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/diminished_value_case_details`,
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json(detailsRow);
        },
      ),
    );

    const { service, touchAppraisalCase } = createTestHarness();
    await expect(
      service.saveDetails({
        caseId: CASE_ID,
        userId: USER_ID,
        expectedRevision: null,
        values: createValues,
      }),
    ).resolves.toEqual(expectedDetails);

    expect(requestBody).toEqual({
      case_id: CASE_ID,
      draft_step: "consultation",
      accident_state: "IL",
      accident_date: "2026-08-01",
      repair_status: "in-progress",
      vehicle_entry_method: "details",
      vin: null,
      vehicle_year: 2023,
      vehicle_make: "Honda",
      vehicle_model: "Accord",
      vehicle_trim: "EX-L",
      mileage_at_accident: 31250,
      current_mileage: 31900,
      other_party_at_fault: "yes",
      at_fault_insurer: "Example Insurance",
      repair_cost: 8450.75,
      repair_facility: "Example Collision",
      structural_damage: "no",
      airbag_deployment: "no",
      major_repair_details: "Replaced rear quarter panel.",
      full_name: "Jordan Example",
      email: "jordan@example.com",
      phone: "312-555-0100",
      preferred_contact_method: "email",
      availability: "Weekday afternoons",
      notes: "Please email first.",
    });
    expect(touchAppraisalCase).toHaveBeenCalledWith({
      caseId: CASE_ID,
      userId: USER_ID,
    });
  });

  it("keeps a committed create successful when the activity touch fails", async () => {
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/diminished_value_case_details`,
        () => HttpResponse.json(detailsRow),
      ),
    );

    const { service, touchAppraisalCase } = createTestHarness();
    touchAppraisalCase.mockResolvedValueOnce(null);

    await expect(
      service.createDetails({
        caseId: CASE_ID,
        userId: USER_ID,
        values: createValues,
      }),
    ).resolves.toEqual(expectedDetails);
    expect(touchAppraisalCase).toHaveBeenCalledOnce();
  });

  it("conditions saves on the expected server revision", async () => {
    let requestBody: unknown;
    let requestUrl: URL | undefined;
    server.use(
      http.patch(
        `${SUPABASE_URL}/rest/v1/diminished_value_case_details`,
        async ({ request }) => {
          requestBody = await request.json();
          requestUrl = new URL(request.url);
          return HttpResponse.json({
            ...detailsRow,
            draft_step: "vehicle",
            vehicle_model: "Accord Hybrid",
            revision: 5,
          });
        },
      ),
    );

    const { service } = createTestHarness();
    const result = await service.saveDetails({
      caseId: CASE_ID,
      userId: USER_ID,
      expectedRevision: 4,
      values: {
        draftStep: "vehicle",
        vehicleModel: "Accord Hybrid",
      },
    });

    expect(requestBody).toEqual({
      draft_step: "vehicle",
      vehicle_model: "Accord Hybrid",
    });
    expect(requestUrl?.searchParams.get("case_id")).toBe(`eq.${CASE_ID}`);
    expect(requestUrl?.searchParams.get("revision")).toBe("eq.4");
    expect(result).toMatchObject({
      draftStep: "vehicle",
      vehicleModel: "Accord Hybrid",
      revision: 5,
    });
  });

  it("keeps a committed update successful when the activity touch fails", async () => {
    server.use(
      http.patch(
        `${SUPABASE_URL}/rest/v1/diminished_value_case_details`,
        () =>
          HttpResponse.json({
            ...detailsRow,
            draft_step: "vehicle",
            vehicle_model: "Accord Hybrid",
            revision: 5,
          }),
      ),
    );

    const { service, touchAppraisalCase } = createTestHarness();
    touchAppraisalCase.mockRejectedValueOnce(
      new Error("parent activity update failed"),
    );

    await expect(
      service.updateDetails({
        caseId: CASE_ID,
        userId: USER_ID,
        expectedRevision: 4,
        changes: {
          draftStep: "vehicle",
          vehicleModel: "Accord Hybrid",
        },
      }),
    ).resolves.toMatchObject({
      draftStep: "vehicle",
      vehicleModel: "Accord Hybrid",
      revision: 5,
    });
    expect(touchAppraisalCase).toHaveBeenCalledOnce();
  });

  it("returns the current server row after an optimistic-write conflict", async () => {
    server.use(
      http.patch(
        `${SUPABASE_URL}/rest/v1/diminished_value_case_details`,
        () => HttpResponse.json(null),
      ),
      http.get(
        `${SUPABASE_URL}/rest/v1/diminished_value_case_details`,
        () => HttpResponse.json(detailsRow),
      ),
    );

    const { service, touchAppraisalCase } = createTestHarness();
    const error = await service
      .updateDetails({
        caseId: CASE_ID,
        userId: USER_ID,
        expectedRevision: 3,
        changes: { vehicleModel: "Stale edit" },
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DiminishedValueDetailsConflictError);
    expect(
      (error as DiminishedValueDetailsConflictError).currentDetails,
    ).toEqual(expectedDetails);
    expect(touchAppraisalCase).not.toHaveBeenCalled();
  });

  it("recovers a lost insert response only when every writable value matches", async () => {
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/diminished_value_case_details`,
        () =>
          HttpResponse.json(
            {
              code: "PGRST000",
              details: null,
              hint: null,
              message: "connection lost after commit",
            },
            { status: 503 },
          ),
      ),
      http.get(
        `${SUPABASE_URL}/rest/v1/diminished_value_case_details`,
        () => HttpResponse.json(detailsRow),
      ),
    );

    const { service, touchAppraisalCase } = createTestHarness();
    await expect(
      service.createDetails({
        caseId: CASE_ID,
        userId: USER_ID,
        values: createValues,
      }),
    ).resolves.toEqual(expectedDetails);
    expect(touchAppraisalCase).toHaveBeenCalledWith({
      caseId: CASE_ID,
      userId: USER_ID,
    });
  });

  it("keeps a recovered committed create successful when the activity touch fails", async () => {
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/diminished_value_case_details`,
        () =>
          HttpResponse.json(
            {
              code: "PGRST000",
              details: null,
              hint: null,
              message: "connection lost after commit",
            },
            { status: 503 },
          ),
      ),
      http.get(
        `${SUPABASE_URL}/rest/v1/diminished_value_case_details`,
        () => HttpResponse.json(detailsRow),
      ),
    );

    const { service, touchAppraisalCase } = createTestHarness();
    touchAppraisalCase.mockRejectedValueOnce(
      new Error("parent activity update failed"),
    );

    await expect(
      service.createDetails({
        caseId: CASE_ID,
        userId: USER_ID,
        values: createValues,
      }),
    ).resolves.toEqual(expectedDetails);
    expect(touchAppraisalCase).toHaveBeenCalledOnce();
  });

  it("surfaces a divergent insert recovery as a concurrent-edit conflict", async () => {
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/diminished_value_case_details`,
        () =>
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
      http.get(
        `${SUPABASE_URL}/rest/v1/diminished_value_case_details`,
        () =>
          HttpResponse.json({
            ...detailsRow,
            vehicle_model: "Different model",
          }),
      ),
    );

    const { service, touchAppraisalCase } = createTestHarness();
    const error = await service
      .createDetails({
        caseId: CASE_ID,
        userId: USER_ID,
        values: createValues,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DiminishedValueDetailsConflictError);
    expect(error).toMatchObject({
      currentDetails: { vehicleModel: "Different model" },
    });
    expect(touchAppraisalCase).not.toHaveBeenCalled();
  });

  it("maps idempotent submission receipts without touching the parent again", async () => {
    const requestBodies: unknown[] = [];
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/submit_diminished_value_case`,
        async ({ request }) => {
          requestBodies.push(await request.json());
          return HttpResponse.json({
            case_id: CASE_ID,
            status: "submitted",
            submitted_at: SUBMITTED_AT,
            revision: 5,
          });
        },
      ),
    );

    const { service, touchAppraisalCase } = createTestHarness();
    await expect(
      service.submitCase({ caseId: CASE_ID, userId: USER_ID }),
    ).resolves.toEqual({
      caseId: CASE_ID,
      status: "submitted",
      submittedAt: SUBMITTED_AT,
    });
    await expect(
      service.submitCase({ caseId: CASE_ID, userId: USER_ID }),
    ).resolves.toEqual({
      caseId: CASE_ID,
      status: "submitted",
      submittedAt: SUBMITTED_AT,
    });

    expect(requestBodies).toEqual([{ case_id: CASE_ID }, { case_id: CASE_ID }]);
    expect(touchAppraisalCase).not.toHaveBeenCalled();
  });

  it.each([
    {
      receipt: {
        case_id: null,
        status: "submitted",
        submitted_at: SUBMITTED_AT,
      },
      label: "no case identifier",
    },
    {
      receipt: {
        case_id: OTHER_CASE_ID,
        status: "submitted",
        submitted_at: SUBMITTED_AT,
      },
      label: "another case",
    },
    {
      receipt: {
        case_id: CASE_ID,
        status: "draft",
        submitted_at: SUBMITTED_AT,
      },
      label: "an editable status",
    },
    {
      receipt: {
        case_id: CASE_ID,
        status: null,
        submitted_at: SUBMITTED_AT,
      },
      label: "no status",
    },
    {
      receipt: {
        case_id: CASE_ID,
        status: "submitted",
        submitted_at: null,
      },
      label: "no submission timestamp",
    },
  ])("rejects a submission receipt for $label", async ({ receipt }) => {
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/submit_diminished_value_case`,
        () => HttpResponse.json(receipt),
      ),
    );

    const { service } = createTestHarness();
    await expect(
      service.submitCase({ caseId: CASE_ID, userId: USER_ID }),
    ).rejects.toBeInstanceOf(DiminishedValueDetailsResponseError);
  });
});
