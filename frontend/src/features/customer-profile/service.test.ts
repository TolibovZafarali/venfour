import { createClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import {
  createCustomerProfileService,
  CustomerProfileResponseError,
} from "@/features/customer-profile/service";
import type { CustomerProfile } from "@/features/customer-profile/types";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { server } from "@/test/mocks/server";

const SUPABASE_URL = "https://profile-test.supabase.co";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-08-23T12:00:00.000Z";
const PROFILE_COLUMNS =
  "id,display_name,full_name_confirmed_at,service_terms_version,service_terms_acknowledged_at,privacy_notice_version,privacy_notice_acknowledged_at,operational_follow_up_allowed,operational_follow_up_updated_at,created_at,updated_at";

const profileRow: Tables<"profiles"> = {
  id: USER_ID,
  display_name: "Confirmed Customer",
  full_name_confirmed_at: NOW,
  service_terms_version: "2026-08-23",
  service_terms_acknowledged_at: NOW,
  privacy_notice_version: "2026-08-23",
  privacy_notice_acknowledged_at: NOW,
  operational_follow_up_allowed: true,
  operational_follow_up_updated_at: NOW,
  created_at: NOW,
  updated_at: NOW,
};

const expectedProfile: CustomerProfile = {
  userId: USER_ID,
  fullName: "Confirmed Customer",
  fullNameConfirmedAt: NOW,
  serviceTermsVersion: "2026-08-23",
  serviceTermsAcknowledgedAt: NOW,
  privacyNoticeVersion: "2026-08-23",
  privacyNoticeAcknowledgedAt: NOW,
  operationalFollowUpAllowed: true,
  operationalFollowUpUpdatedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};

function createTestService() {
  const client = createClient<Database>(
    SUPABASE_URL,
    "sb_publishable_profile_test",
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  return createCustomerProfileService(client);
}

describe("customer profile service", () => {
  it("loads only the requested Auth-owned profile fields", async () => {
    let requestUrl: URL | undefined;
    server.use(
      http.get(`${SUPABASE_URL}/rest/v1/profiles`, ({ request }) => {
        requestUrl = new URL(request.url);
        return HttpResponse.json(profileRow);
      }),
    );

    await expect(createTestService().getProfile(USER_ID)).resolves.toEqual(
      expectedProfile,
    );
    expect(requestUrl?.searchParams.get("id")).toBe(`eq.${USER_ID}`);
    expect(requestUrl?.searchParams.get("select")).toBe(PROFILE_COLUMNS);
  });

  it("confirms normalized name, current acknowledgements, and optional follow-up without sending email", async () => {
    let requestBody: unknown;
    server.use(
      http.post(
        `${SUPABASE_URL}/rest/v1/rpc/confirm_customer_profile`,
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json(profileRow);
        },
      ),
    );

    await expect(
      createTestService().confirmProfile({
        userId: USER_ID,
        fullName: "  Confirmed   Customer  ",
        operationalFollowUpAllowed: true,
      }),
    ).resolves.toEqual(expectedProfile);
    expect(requestBody).toEqual({
      full_name: "Confirmed Customer",
      operational_follow_up_allowed: true,
      privacy_notice_version: "2026-08-23",
      service_terms_version: "2026-08-23",
    });
    expect(requestBody).not.toHaveProperty("email");
  });

  it("rejects a profile returned outside the requested ownership scope", async () => {
    server.use(
      http.post(`${SUPABASE_URL}/rest/v1/rpc/confirm_customer_profile`, () =>
        HttpResponse.json({ ...profileRow, id: OTHER_USER_ID }),
      ),
    );

    await expect(
      createTestService().confirmProfile({
        userId: USER_ID,
        fullName: "Confirmed Customer",
        operationalFollowUpAllowed: false,
      }),
    ).rejects.toBeInstanceOf(CustomerProfileResponseError);
  });
});
