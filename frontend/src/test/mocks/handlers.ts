import { http, HttpResponse } from "msw";

import type { HealthResponse } from "@/lib/api/contracts";
import {
  materialUndervalueAnalysis,
  representativeRunId,
} from "@/test/fixtures/analysis-presentation";

export const handlers = [
  http.get("*/api/v1/appraisal-cases/:caseId/full-review", ({ params }) => HttpResponse.json({
    caseId: params.caseId, stage: "full_review", status: "report_required", ready: false,
    analysisInputId: "44444444-4444-4444-8444-444444444444", analysisInputRevision: 1, checkoutAvailable: false,
    paymentReadiness: { status: "not_evaluated", eligible: false, reviewId: null, version: null, digest: null },
    issues: [], message: "Upload your complete report.", report: null, canReuseReport: false, locked: false,
  })),
  http.get("*/api/v1/staff/referral-partners/access", () => HttpResponse.json({ is_partner_manager: false, is_partner: false, email_configured: false })),
  http.get("*/health", () =>
    HttpResponse.json<HealthResponse>({ status: "ok" }),
  ),
  http.get("*/api/v1/analyses/:runId", ({ params }) => {
    if (params.runId === representativeRunId) {
      return HttpResponse.json(materialUndervalueAnalysis);
    }

    return HttpResponse.json(
      {
        error: {
          code: "ANALYSIS_NOT_FOUND",
          message: "Analysis run was not found.",
        },
      },
      { status: 404 },
    );
  }),
  http.get("*/api/v1/appraisal-cases/:caseId/analysis", () =>
    HttpResponse.json({ analysisInputId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", analysisInputRevision: 1, status: "not_submitted" as const }),
  ),
  http.post("*/api/v1/appraisal-cases/:caseId/analysis", () =>
    HttpResponse.json(
      {
        analysisInputId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", analysisInputRevision: 1, status: "processing" as const,
        attemptCount: 1,
        processingExpiresAt: null,
      },
      { status: 202 },
    ),
  ),
];
