import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { prepareTotalLossIntakeCorrection } from "@/features/total-loss/intake-correction-api";
import { ApiError } from "@/lib/api/client";
import { server } from "@/test/mocks/server";

const CASE_ID = "22222222-2222-4222-8222-222222222222";
const INPUT_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ID = "44444444-4444-4444-8444-444444444444";
const endpoint = "*/api/v1/appraisal-cases/:caseId/intake-correction";
const requestValues = {
  accessToken: "saved-owner-token",
  analysisInputId: INPUT_ID,
  caseId: CASE_ID,
};

describe("prepare Total Loss intake correction", () => {
  it("sends one authenticated POST with the exact current input lineage to the same case", async () => {
    const requests: {
      authorization: string | null;
      contentType: string | null;
      pathname: string;
      body: unknown;
    }[] = [];
    server.use(http.post(endpoint, async ({ request }) => {
      requests.push({
        authorization: request.headers.get("Authorization"),
        contentType: request.headers.get("Content-Type"),
        pathname: new URL(request.url).pathname,
        body: await request.json(),
      });
      return HttpResponse.json({ caseId: CASE_ID, analysisInputId: INPUT_ID });
    }));

    await expect(prepareTotalLossIntakeCorrection(requestValues)).resolves.toBeUndefined();

    expect(requests).toEqual([{
      authorization: "Bearer saved-owner-token",
      contentType: "application/json",
      pathname: `/api/v1/appraisal-cases/${CASE_ID}/intake-correction`,
      body: { analysisInputId: INPUT_ID },
    }]);
  });

  it.each([
    { name: "null reply", response: null },
    { name: "primitive reply", response: "ready" },
    { name: "array reply", response: [CASE_ID, INPUT_ID] },
    { name: "empty reply", response: {} },
    { name: "missing case ID", response: { analysisInputId: INPUT_ID } },
    { name: "missing input ID", response: { caseId: CASE_ID } },
    { name: "different case", response: { caseId: OTHER_ID, analysisInputId: INPUT_ID } },
    { name: "different input revision", response: { caseId: CASE_ID, analysisInputId: OTHER_ID } },
    { name: "null input revision", response: { caseId: CASE_ID, analysisInputId: null } },
  ])("rejects a successful HTTP response with $name", async ({ response }) => {
    server.use(http.post(endpoint, () => HttpResponse.json(response)));

    await expect(prepareTotalLossIntakeCorrection(requestValues)).rejects.toThrow(
      "The saved intake changed. Reload it before correcting it.",
    );
  });

  it.each([401, 403, 409, 500])("propagates a %s API failure without retrying or treating it as prepared", async (status) => {
    let postCount = 0;
    server.use(http.post(endpoint, () => {
      postCount += 1;
      return HttpResponse.json({
        error: { code: "INTAKE_CORRECTION_UNAVAILABLE", message: "The intake cannot be corrected." },
      }, { status });
    }));

    await expect(prepareTotalLossIntakeCorrection(requestValues)).rejects.toEqual(
      new ApiError("The intake cannot be corrected.", status, "INTAKE_CORRECTION_UNAVAILABLE"),
    );
    expect(postCount).toBe(1);
  });

  it("propagates transport failure", async () => {
    server.use(http.post(endpoint, () => HttpResponse.error()));

    await expect(prepareTotalLossIntakeCorrection(requestValues)).rejects.toThrow("Failed to fetch");
  });

  it("rejects malformed response JSON", async () => {
    server.use(http.post(endpoint, () => new HttpResponse("not json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(prepareTotalLossIntakeCorrection(requestValues)).rejects.toEqual(
      new ApiError("The API returned an invalid JSON response.", 502),
    );
  });
});
