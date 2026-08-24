import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createTotalLossIdentityService } from "@/features/total-loss/identity-service";
import type { Database } from "@/lib/supabase/database.types";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const CLAIM_ID = "33333333-3333-4333-8333-333333333333";
const CREATED_AT = "2026-08-24T16:00:00.000Z";

const contactRow = {
  case_id: CASE_ID,
  full_name: "Local Customer",
  email: "local-customer@example.test",
  email_verified_at: null,
  service_terms_version: "2026-08-23",
  service_terms_acknowledged_at: CREATED_AT,
  privacy_notice_version: "2026-08-23",
  privacy_notice_acknowledged_at: CREATED_AT,
  operational_follow_up_allowed: false,
  operational_follow_up_updated_at: CREATED_AT,
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const saveInput = {
  caseId: CASE_ID,
  userId: USER_ID,
  fullName: "Local Customer",
  email: "local-customer@example.test",
  serviceTermsVersion: "2026-08-23",
  privacyNoticeVersion: "2026-08-23",
  operationalFollowUpAllowed: false,
};

function createServiceWithClaimExpiration(claimExpiresAt: unknown) {
  const rpc = vi.fn(async () => ({
    data: [
      {
        ...contactRow,
        claim_id: CLAIM_ID,
        claim_expires_at: claimExpiresAt,
      },
    ],
    error: null,
  }));
  const client = { rpc } as unknown as SupabaseClient<Database>;
  return createTotalLossIdentityService(client);
}

describe("total-loss identity service", () => {
  it("normalizes a Postgres timestamptz claim expiration for draft storage", async () => {
    const service = createServiceWithClaimExpiration(
      "2026-08-24T16:49:11.10474+00:00",
    );

    await expect(service.saveContactAndBeginClaim(saveInput)).resolves.toMatchObject({
      claimId: CLAIM_ID,
      expiresAt: "2026-08-24T16:49:11.104Z",
      contact: { caseId: CASE_ID },
    });
  });

  it.each([
    "not-a-timestamp",
    "2026-08-24",
    "2026-02-31T16:49:11+00:00",
    "2026-08-24T24:49:11+00:00",
    "2026-08-24T16:49:11+99:00",
  ])("rejects an invalid claim expiration: %s", async (claimExpiresAt) => {
    const service = createServiceWithClaimExpiration(claimExpiresAt);

    await expect(
      service.saveContactAndBeginClaim(saveInput),
    ).rejects.toMatchObject({
      name: "TotalLossIdentityResponseError",
      message: expect.stringContaining("invalid case-access claim expiration"),
    });
  });
});
