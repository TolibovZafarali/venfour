import { http, HttpResponse } from "msw";

import type { HealthResponse } from "@/lib/api/contracts";
import {
  materialUndervalueAnalysis,
  representativeRunId,
} from "@/test/fixtures/analysis-presentation";

export const handlers = [
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
    HttpResponse.json({ status: "not_submitted" as const }),
  ),
  http.post("*/api/v1/appraisal-cases/:caseId/analysis", () =>
    HttpResponse.json(
      {
        status: "processing" as const,
        attemptCount: 1,
        processingExpiresAt: null,
      },
      { status: 202 },
    ),
  ),
];
