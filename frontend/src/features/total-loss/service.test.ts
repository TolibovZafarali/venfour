import { createClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppraisalCaseService } from "@/features/cases/service";
import type { AppraisalCase } from "@/features/cases/types";
import type { TotalLossCaseDetails } from "@/features/total-loss/data-types";
import {
  createTotalLossDetailsService,
  TotalLossDetailsConflictError,
  TotalLossDetailsResponseError,
  TotalLossReportUploadBusyError,
  TotalLossReportUploadLeaseLostError,
} from "@/features/total-loss/service";
import type { Database } from "@/lib/supabase/database.types";
import { server } from "@/test/mocks/server";

const SUPABASE_URL = "https://total-loss-details-test.supabase.co";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_AT = "2026-08-18T14:00:00.000Z";
const UPDATED_AT = "2026-08-18T15:00:00.000Z";
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";
const DETAILS_COLUMNS =
  "case_id,intake_mode,vin,vehicle_year,vehicle_make,vehicle_model,vehicle_trim,vehicle_configuration,mileage_at_loss,postal_code,date_of_loss,insurer_name,insurer_vehicle_valuation,vehicle_condition,vehicle_options_packages,report_provider_name,report_extraction_status,report_extraction_confidence,report_extracted_at,report_facts_confirmed_at,analysis_input_revision,analysis_input_id,report_storage_owner_id,report_upload_recovery_required,report_original_filename,report_uploaded_at,intake_completed_at,created_at,updated_at";

const detailsRow = {
  case_id: CASE_ID,
  intake_mode: "manual",
  vin: "1HGCM82633A004352",
  vehicle_year: 2023,
  vehicle_make: "Honda",
  vehicle_model: "Accord",
  vehicle_trim: null,
  vehicle_configuration: {
    source: "marketcheck",
    field: "version",
    values: ["Accord EX-L CVT FWD"],
  },
  mileage_at_loss: 31250,
  postal_code: "60601",
  date_of_loss: "2026-08-18",
  insurer_name: "Example Insurance",
  insurer_vehicle_valuation: 20500.5,
  vehicle_condition: "Good",
  vehicle_options_packages: "Technology package",
  report_provider_name: null,
  report_extraction_status: "not_requested",
  report_extraction_confidence: null,
  report_extracted_at: null,
  report_facts_confirmed_at: null,
  analysis_input_revision: 1,
  analysis_input_id: "44444444-4444-4444-8444-444444444444",
  report_storage_owner_id: USER_ID,
  report_upload_recovery_required: false,
  report_original_filename: null,
  report_uploaded_at: null,
  intake_completed_at: null,
  created_at: CREATED_AT,
  updated_at: UPDATED_AT,
};

const leaseRow = {
  upload_id: UPLOAD_ID,
  expires_at: "2026-08-18T15:30:00.000Z",
  details_updated_at: UPDATED_AT,
  report_original_filename: null,
  report_uploaded_at: null,
  recovery_required: false,
};

beforeEach(() => {
  server.use(
    http.post(
      `${SUPABASE_URL}/rest/v1/rpc/get_owned_total_loss_report_storage_locator`,
      () =>
        HttpResponse.json([
          {
            case_id: CASE_ID,
            bucket_id: "case-files",
            storage_owner_id: USER_ID,
            canonical_object_path: `${USER_ID}/${CASE_ID}/valuation-report.pdf`,
            backup_object_path: `${USER_ID}/${CASE_ID}/valuation-report-backup.pdf`,
            finalized_upload_id: null,
          },
        ]),
    ),
  );
});

const expectedDetails: TotalLossCaseDetails = {
  caseId: CASE_ID,
  intakeMode: "manual",
  vin: "1HGCM82633A004352",
  vehicleYear: 2023,
  vehicleMake: "Honda",
  vehicleModel: "Accord",
  vehicleTrim: null,
  vehicleConfiguration: {
    source: "marketcheck",
    field: "version",
    values: ["Accord EX-L CVT FWD"],
  },
  mileageAtLoss: 31250,
  postalCode: "60601",
  dateOfLoss: "2026-08-18",
  insurerName: "Example Insurance",
  insurerVehicleValuation: 20500.5,
  vehicleCondition: "Good",
  optionsPackages: "Technology package",
  reportProvider: null,
  reportExtractionStatus: "not_requested",
  reportExtractionConfidence: null,
  reportExtractedAt: null,
  reportFactsConfirmedAt: null,
  analysisInputRevision: 1,
  analysisInputId: "44444444-4444-4444-8444-444444444444",
  reportStorageOwnerId: USER_ID,
  reportUploadRecoveryRequired: false,
  reportOriginalFilename: null,
  reportUploadedAt: null,
  intakeCompletedAt: null,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

const appraisalCase: AppraisalCase = {
  id: CASE_ID,
  userId: USER_ID,
  serviceType: "total_loss",
  status: "draft",
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  lastActivityAt: UPDATED_AT,
};

function createTestHarness() {
  const client = createClient<Database>(
    SUPABASE_URL,
    "sb_publishable_total_loss_test",
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  const touchAppraisalCase = vi.fn(async () => appraisalCase);
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
    service: createTotalLossDetailsService(client, appraisalCaseService),
    touchAppraisalCase,
  };
}

describe("total-loss details service", () => {
  it("fetches details only by the requested parent case", async () => {
    let requestUrl: URL | undefined;
    server.use(
      http.get(
        `${SUPABASE_URL}/rest/v1/total_loss_case_details`,
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

  it("maps the owner-visible report recovery gate", async () => {
    server.use(
      http.get(
        `${SUPABASE_URL}/rest/v1/total_loss_case_details`,
        () =>
          HttpResponse.json({
            ...detailsRow,
            report_upload_recovery_required: true,
          }),
      ),
    );

    const { service } = createTestHarness();
    await expect(
      service.getDetails({ caseId: CASE_ID, userId: USER_ID }),
    ).resolves.toMatchObject({ reportUploadRecoveryRequired: true });
  });

  it.each([null, "true", 1])(
    "rejects an invalid report recovery gate value of %j",
    async (reportUploadRecoveryRequired) => {
      server.use(
        http.get(
          `${SUPABASE_URL}/rest/v1/total_loss_case_details`,
          () =>
            HttpResponse.json({
              ...detailsRow,
              report_upload_recovery_required:
                reportUploadRecoveryRequired,
            }),
        ),
      );

      const { service } = createTestHarness();
      await expect(
        service.getDetails({ caseId: CASE_ID, userId: USER_ID }),
      ).rejects.toThrow(
        "Supabase returned an invalid Total-Loss boolean field.",
      );
    },
  );

  it.each([
    "case_id",
    "intake_mode",
    "created_at",
    "updated_at",
  ] as const)("rejects total-loss details with a null %s", async (field) => {
    server.use(
      http.get(
        `${SUPABASE_URL}/rest/v1/total_loss_case_details`,
        () => HttpResponse.json({ ...detailsRow, [field]: null }),
      ),
    );

    const { service } = createTestHarness();
    await expect(
      service.getDetails({ caseId: CASE_ID, userId: USER_ID }),
    ).rejects.toThrow("Supabase returned incomplete total-loss details.");
  });

  it("inserts only writable intake values and touches the parent afterward", async () => {
    let requestBody: unknown;
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/total_loss_case_details`,
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json(detailsRow);
        },
      ),
    );

    const { service, touchAppraisalCase } = createTestHarness();
    await service.createDetails({
      caseId: CASE_ID,
      userId: USER_ID,
      values: {
        intakeMode: "manual",
        vin: "1HGCM82633A004352",
        vehicleYear: 2023,
        vehicleCondition: "Good",
        optionsPackages: "Technology package",
      },
    });

    expect(requestBody).toEqual({
      case_id: CASE_ID,
      intake_mode: "manual",
      report_storage_owner_id: USER_ID,
      vehicle_condition: "Good",
      vehicle_options_packages: "Technology package",
      vehicle_year: 2023,
      vin: "1HGCM82633A004352",
    });
    expect(touchAppraisalCase).toHaveBeenCalledWith({
      caseId: CASE_ID,
      userId: USER_ID,
    });
  });

  it("conditions updates on the last server timestamp", async () => {
    let requestBody: unknown;
    let requestUrl: URL | undefined;
    server.use(
      http.patch(
        `${SUPABASE_URL}/rest/v1/total_loss_case_details`,
        async ({ request }) => {
          requestBody = await request.json();
          requestUrl = new URL(request.url);
          return HttpResponse.json({
            ...detailsRow,
            vehicle_model: "Accord Hybrid",
            updated_at: "2026-08-18T15:01:00.000Z",
          });
        },
      ),
    );

    const { service } = createTestHarness();
    const result = await service.updateDetails({
      caseId: CASE_ID,
      userId: USER_ID,
      expectedUpdatedAt: UPDATED_AT,
      changes: { vehicleModel: "Accord Hybrid" },
    });

    expect(requestBody).toEqual({ vehicle_model: "Accord Hybrid" });
    expect(requestUrl?.searchParams.get("case_id")).toBe(`eq.${CASE_ID}`);
    expect(requestUrl?.searchParams.get("updated_at")).toBe(
      `eq.${UPDATED_AT}`,
    );
    expect(result.vehicleModel).toBe("Accord Hybrid");
  });

  it("returns the current server row in an optimistic-write conflict", async () => {
    server.use(
      http.patch(`${SUPABASE_URL}/rest/v1/total_loss_case_details`, () =>
        HttpResponse.json(null),
      ),
      http.get(`${SUPABASE_URL}/rest/v1/total_loss_case_details`, () =>
        HttpResponse.json(detailsRow),
      ),
    );

    const { service, touchAppraisalCase } = createTestHarness();
    const error = await service
      .updateDetails({
        caseId: CASE_ID,
        userId: USER_ID,
        expectedUpdatedAt: CREATED_AT,
        changes: { vehicleModel: "Stale edit" },
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TotalLossDetailsConflictError);
    expect((error as TotalLossDetailsConflictError).currentDetails).toEqual(
      expectedDetails,
    );
    expect(touchAppraisalCase).not.toHaveBeenCalled();
  });

  it("recovers an insert race by fetching the existing row without overwriting it", async () => {
    server.use(
      http.post(`${SUPABASE_URL}/rest/v1/total_loss_case_details`, () =>
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
      http.get(`${SUPABASE_URL}/rest/v1/total_loss_case_details`, () =>
        HttpResponse.json(detailsRow),
      ),
    );

    const { service } = createTestHarness();
    await expect(
      service.createDetails({
        caseId: CASE_ID,
        userId: USER_ID,
        values: { intakeMode: "manual" },
      }),
    ).rejects.toMatchObject({ currentDetails: expectedDetails });
  });

  it("recovers a lost insert response when the fetched row matches", async () => {
    server.use(
      http.post(`${SUPABASE_URL}/rest/v1/total_loss_case_details`, () =>
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
      http.get(`${SUPABASE_URL}/rest/v1/total_loss_case_details`, () =>
        HttpResponse.json(detailsRow),
      ),
    );

    const { service, touchAppraisalCase } = createTestHarness();
    await expect(
      service.createDetails({
        caseId: CASE_ID,
        userId: USER_ID,
        values: {
          intakeMode: "manual",
          vin: "1HGCM82633A004352",
          vehicleYear: 2023,
          vehicleMake: "Honda",
          vehicleModel: "Accord",
          vehicleTrim: null,
          vehicleConfiguration: {
            source: "marketcheck",
            field: "version",
            values: ["Accord EX-L CVT FWD"],
          },
          mileageAtLoss: 31250,
          postalCode: "60601",
          dateOfLoss: "2026-08-18",
          insurerName: "Example Insurance",
          insurerVehicleValuation: 20500.5,
          vehicleCondition: "Good",
          optionsPackages: "Technology package",
        },
      }),
    ).resolves.toEqual(expectedDetails);
    expect(touchAppraisalCase).toHaveBeenCalledWith({
      caseId: CASE_ID,
      userId: USER_ID,
    });
  });

  it("acquires a report lease with the expected details revision", async () => {
    let requestBody: unknown;
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/acquire_total_loss_report_upload`,
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json(leaseRow);
        },
      ),
    );

    const { service } = createTestHarness();
    await expect(service.acquireReportUploadLease({
      caseId: CASE_ID,
      userId: USER_ID,
      expectedUpdatedAt: UPDATED_AT,
      uploadId: UPLOAD_ID,
    })).resolves.toEqual({
      uploadId: UPLOAD_ID,
      expiresAt: "2026-08-18T15:30:00.000Z",
      detailsUpdatedAt: UPDATED_AT,
      reportOriginalFilename: null,
      reportUploadedAt: null,
      recoveryRequired: false,
      storageOwnerUserId: USER_ID,
    });

    expect(requestBody).toEqual({
      case_id: CASE_ID,
      expected_updated_at: UPDATED_AT,
      upload_id: UPLOAD_ID,
    });
  });

  it("preserves a null expected revision when acquiring the first report lease", async () => {
    let requestBody: unknown;
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/acquire_total_loss_report_upload`,
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json(leaseRow);
        },
      ),
    );

    const { service } = createTestHarness();
    await expect(
      service.acquireReportUploadLease({
        caseId: CASE_ID,
        userId: USER_ID,
        expectedUpdatedAt: null,
        uploadId: UPLOAD_ID,
      }),
    ).resolves.toMatchObject({ uploadId: UPLOAD_ID });
    expect(requestBody).toEqual({
      case_id: CASE_ID,
      expected_updated_at: null,
      upload_id: UPLOAD_ID,
    });
  });

  it("reclaims an interrupted report lease with a fresh scoped token", async () => {
    let requestBody: unknown;
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/reclaim_total_loss_report_upload`,
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json({
            ...leaseRow,
            recovery_required: true,
          });
        },
      ),
    );

    const { service } = createTestHarness();
    await expect(
      service.reclaimReportUploadLease({
        caseId: CASE_ID,
        userId: USER_ID,
        expectedUpdatedAt: UPDATED_AT,
        uploadId: UPLOAD_ID,
      }),
    ).resolves.toEqual({
      uploadId: UPLOAD_ID,
      expiresAt: "2026-08-18T15:30:00.000Z",
      detailsUpdatedAt: UPDATED_AT,
      reportOriginalFilename: null,
      reportUploadedAt: null,
      recoveryRequired: true,
      storageOwnerUserId: USER_ID,
    });
    expect(requestBody).toEqual({
      case_id: CASE_ID,
      expected_updated_at: UPDATED_AT,
      upload_id: UPLOAD_ID,
    });
  });

  it("rejects a reclaimed lease returned for a different attempt token", async () => {
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/reclaim_total_loss_report_upload`,
        () =>
          HttpResponse.json({
            ...leaseRow,
            upload_id: "44444444-4444-4444-8444-444444444444",
          }),
      ),
    );

    const { service } = createTestHarness();
    await expect(
      service.reclaimReportUploadLease({
        caseId: CASE_ID,
        userId: USER_ID,
        expectedUpdatedAt: UPDATED_AT,
        uploadId: UPLOAD_ID,
      }),
    ).rejects.toBeInstanceOf(TotalLossDetailsResponseError);
  });

  it.each(["upload_id", "expires_at", "details_updated_at"] as const)(
    "rejects a report-upload lease with a null %s",
    async (field) => {
      server.use(
        http.post(
          `${SUPABASE_URL}/rest/v1/rpc/acquire_total_loss_report_upload`,
          () => HttpResponse.json({ ...leaseRow, [field]: null }),
        ),
      );

      const { service } = createTestHarness();
      await expect(
        service.acquireReportUploadLease({
          caseId: CASE_ID,
          userId: USER_ID,
          expectedUpdatedAt: UPDATED_AT,
          uploadId: UPLOAD_ID,
        }),
      ).rejects.toThrow(
        "Supabase returned an incomplete report-upload lease.",
      );
    },
  );

  it("defaults a nullable recovery marker to false", async () => {
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/acquire_total_loss_report_upload`,
        () => HttpResponse.json({ ...leaseRow, recovery_required: null }),
      ),
    );

    const { service } = createTestHarness();
    await expect(
      service.acquireReportUploadLease({
        caseId: CASE_ID,
        userId: USER_ID,
        expectedUpdatedAt: UPDATED_AT,
        uploadId: UPLOAD_ID,
      }),
    ).resolves.toMatchObject({ recoveryRequired: false });
  });

  it("rejects an acquired lease returned for a different attempt token", async () => {
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/acquire_total_loss_report_upload`,
        () =>
          HttpResponse.json({
            ...leaseRow,
            upload_id: "44444444-4444-4444-8444-444444444444",
          }),
      ),
    );

    const { service } = createTestHarness();
    await expect(service.acquireReportUploadLease({
      caseId: CASE_ID,
      userId: USER_ID,
      expectedUpdatedAt: UPDATED_AT,
      uploadId: UPLOAD_ID,
    })).rejects.toBeInstanceOf(TotalLossDetailsResponseError);
  });

  it("scopes renew, ready, and recovery RPCs to the unguessable upload ID", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    for (const rpcName of [
      "renew_total_loss_report_upload",
      "mark_total_loss_report_upload_ready",
      "complete_total_loss_report_upload_recovery",
    ]) {
      server.use(
        http.post(
          `${SUPABASE_URL}/rest/v1/rpc/${rpcName}`,
          async ({ request }) => {
            requests.push({
              path: new URL(request.url).pathname,
              body: await request.json(),
            });
            return HttpResponse.json(leaseRow);
          },
        ),
      );
    }

    const { service } = createTestHarness();
    await service.renewReportUploadLease({
      caseId: CASE_ID,
      userId: USER_ID,
      uploadId: UPLOAD_ID,
    });
    await service.markReportUploadReady({
      caseId: CASE_ID,
      userId: USER_ID,
      uploadId: UPLOAD_ID,
      hasBackup: true,
    });
    await service.completeReportUploadRecovery({
      caseId: CASE_ID,
      userId: USER_ID,
      uploadId: UPLOAD_ID,
    });

    expect(requests.map(({ body }) => body)).toEqual([
      { case_id: CASE_ID, upload_id: UPLOAD_ID },
      { case_id: CASE_ID, has_backup: true, upload_id: UPLOAD_ID },
      { case_id: CASE_ID, upload_id: UPLOAD_ID },
    ]);
  });

  it("finalizes metadata and parent activity in one server transaction", async () => {
    let requestBody: unknown;
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/finalize_total_loss_report_upload`,
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json({
            ...detailsRow,
            intake_mode: "report",
            report_original_filename: "valuation.pdf",
            report_uploaded_at: UPDATED_AT,
          });
        },
      ),
    );

    const { service, touchAppraisalCase } = createTestHarness();
    await expect(service.finalizeReportUpload({
      caseId: CASE_ID,
      userId: USER_ID,
      uploadId: UPLOAD_ID,
      originalFilename: "valuation.pdf",
      uploadedAt: UPDATED_AT,
    })).resolves.toMatchObject({
      reportOriginalFilename: "valuation.pdf",
      reportUploadedAt: UPDATED_AT,
    });
    expect(requestBody).toEqual({
      case_id: CASE_ID,
      upload_id: UPLOAD_ID,
      report_original_filename: "valuation.pdf",
      report_uploaded_at: UPDATED_AT,
    });
    expect(touchAppraisalCase).not.toHaveBeenCalled();
  });

  it("rejects incomplete public details returned by a report-upload RPC", async () => {
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/finalize_total_loss_report_upload`,
        () => HttpResponse.json({ ...detailsRow, updated_at: null }),
      ),
    );

    const { service } = createTestHarness();
    await expect(
      service.finalizeReportUpload({
        caseId: CASE_ID,
        userId: USER_ID,
        uploadId: UPLOAD_ID,
        originalFilename: "valuation.pdf",
        uploadedAt: UPDATED_AT,
      }),
    ).rejects.toThrow("Supabase returned incomplete total-loss details.");
  });

  it("cancels only the case and upload token supplied to the RPC", async () => {
    let requestBody: unknown;
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/cancel_total_loss_report_upload`,
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json(detailsRow);
        },
      ),
    );

    const { service } = createTestHarness();
    await expect(service.cancelReportUpload({
      caseId: CASE_ID,
      userId: USER_ID,
      uploadId: UPLOAD_ID,
    })).resolves.toEqual(expectedDetails);
    expect(requestBody).toEqual({
      case_id: CASE_ID,
      upload_id: UPLOAD_ID,
    });
  });

  it("maps report lease contention and stale-token SQL states", async () => {
    const rpcUrl = `${SUPABASE_URL}/rest/v1/rpc/acquire_total_loss_report_upload`;
    server.use(
      http.post(rpcUrl, () =>
        HttpResponse.json(
          { code: "55P03", message: "report upload busy" },
          { status: 409 },
        ),
      ),
    );
    const { service } = createTestHarness();
    await expect(service.acquireReportUploadLease({
      caseId: CASE_ID,
      userId: USER_ID,
      expectedUpdatedAt: UPDATED_AT,
      uploadId: UPLOAD_ID,
    })).rejects.toBeInstanceOf(TotalLossReportUploadBusyError);

    server.use(
      http.post(rpcUrl, () =>
        HttpResponse.json(
          { code: "55000", message: "report upload lease lost" },
          { status: 409 },
        ),
      ),
    );
    await expect(service.acquireReportUploadLease({
      caseId: CASE_ID,
      userId: USER_ID,
      expectedUpdatedAt: UPDATED_AT,
      uploadId: UPLOAD_ID,
    })).rejects.toBeInstanceOf(TotalLossReportUploadLeaseLostError);
  });

  it("returns the current public details when report acquisition loses its CAS", async () => {
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/acquire_total_loss_report_upload`,
        () =>
          HttpResponse.json(
            { code: "40001", message: "details changed" },
            { status: 409 },
          ),
      ),
      http.get(`${SUPABASE_URL}/rest/v1/total_loss_case_details`, () =>
        HttpResponse.json(detailsRow),
      ),
    );

    const { service } = createTestHarness();
    const error = await service.acquireReportUploadLease({
      caseId: CASE_ID,
      userId: USER_ID,
      expectedUpdatedAt: null,
      uploadId: UPLOAD_ID,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TotalLossDetailsConflictError);
    expect((error as TotalLossDetailsConflictError).currentDetails).toEqual(
      expectedDetails,
    );
  });
});
