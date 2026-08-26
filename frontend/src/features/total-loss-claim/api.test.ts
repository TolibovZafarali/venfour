import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import {
  getTotalLossClaim,
  renewTotalLossClaimAccessLink,
  requestTotalLossClaimRecovery,
} from "@/features/total-loss-claim/api";
import { server } from "@/test/mocks/server";

const CASE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_CASE_ID = "55555555-5555-4555-8555-555555555555";
const CLAIM_ID = "44444444-4444-4444-8444-444444444444";

describe("total-loss claim API", () => {
  it("maps an owner-authorized resolver and sends its bearer token", async () => {
    let authorization: string | null = null;
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", ({ request }) => {
        authorization = request.headers.get("Authorization");
        return HttpResponse.json({
          state: "secure_required",
          caseId: CASE_ID,
          contactEmail: "owner@example.com",
          workflow: {
            phase: "review",
            currentTask: "secure_claim",
            revision: 2,
          },
        });
      }),
    );

    await expect(getTotalLossClaim(CASE_ID, "access-token")).resolves.toEqual({
      state: "secure_required",
      caseId: CASE_ID,
      contactEmail: "owner@example.com",
      workflow: {
        phase: "review",
        currentTask: "secure_claim",
        revision: 2,
      },
    });
    expect(authorization).toBe("Bearer access-token");
  });

  it("rejects case identity drift and contact disclosure in mismatch state", async () => {
    server.use(
      http.get("*/api/v1/appraisal-cases/:caseId/claim", () =>
        HttpResponse.json({
          state: "account_switch_required",
          caseId: OTHER_CASE_ID,
          contactEmail: "must-not-be-returned@example.com",
          workflow: null,
        }),
      ),
    );

    await expect(getTotalLossClaim(CASE_ID, "access-token")).rejects.toThrow(
      /exposed contact details|different case/u,
    );
  });

  it("validates a renewed access link before returning it", async () => {
    server.use(
      http.post(
        "*/api/v1/appraisal-cases/:caseId/claim/access-link",
        () =>
          HttpResponse.json(
            {
              state: "secure_required",
              caseId: CASE_ID,
              contactEmail: "owner@example.com",
              claimId: CLAIM_ID,
              expiresAt: "2026-08-26T13:00:00.000Z",
            },
            { status: 202 },
          ),
      ),
    );

    await expect(
      renewTotalLossClaimAccessLink(CASE_ID, "access-token"),
    ).resolves.toMatchObject({ caseId: CASE_ID, claimId: CLAIM_ID });
  });

  it("allows an access-link request to report a concurrent secured state without exposing link details", async () => {
    server.use(
      http.post(
        "*/api/v1/appraisal-cases/:caseId/claim/access-link",
        () =>
          HttpResponse.json({
            state: "secured",
            caseId: CASE_ID,
            contactEmail: null,
            claimId: null,
            expiresAt: null,
          }),
      ),
    );

    await expect(
      renewTotalLossClaimAccessLink(CASE_ID, "access-token"),
    ).resolves.toEqual({
      state: "secured",
      caseId: CASE_ID,
      contactEmail: null,
      claimId: null,
      expiresAt: null,
    });
  });

  it("sends the public recovery body without returning match details", async () => {
    let body: unknown;
    let authorization: string | null = "unexpected";
    server.use(
      http.post(
        "*/api/v1/appraisal-cases/:caseId/claim/access-recovery",
        async ({ request }) => {
          authorization = request.headers.get("Authorization");
          body = await request.json();
          return HttpResponse.json({ status: "accepted" }, { status: 202 });
        },
      ),
    );

    await expect(
      requestTotalLossClaimRecovery(CASE_ID, {
        email: "owner@example.com",
        turnstileToken: "fresh-token",
      }),
    ).resolves.toEqual({ status: "accepted" });
    expect(body).toEqual({
      email: "owner@example.com",
      turnstileToken: "fresh-token",
    });
    expect(authorization).toBeNull();
  });
});
