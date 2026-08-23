import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables } from "@/lib/supabase/database.types";

import {
  CURRENT_PRIVACY_NOTICE_VERSION,
  CURRENT_SERVICE_TERMS_VERSION,
  type ConfirmCustomerProfileInput,
  type CustomerProfile,
} from "./types";

const CUSTOMER_PROFILE_COLUMNS =
  "id,display_name,full_name_confirmed_at,service_terms_version,service_terms_acknowledged_at,privacy_notice_version,privacy_notice_acknowledged_at,operational_follow_up_allowed,operational_follow_up_updated_at,created_at,updated_at" as const;

type CustomerProfileRow = Tables<"profiles">;

export interface CustomerProfileService {
  getProfile(userId: string): Promise<CustomerProfile | null>;
  confirmProfile(input: ConfirmCustomerProfileInput): Promise<CustomerProfile>;
}

export class CustomerProfileResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerProfileResponseError";
  }
}

function mapCustomerProfile(row: CustomerProfileRow): CustomerProfile {
  return {
    userId: row.id,
    fullName: row.display_name,
    fullNameConfirmedAt: row.full_name_confirmed_at,
    serviceTermsVersion: row.service_terms_version,
    serviceTermsAcknowledgedAt: row.service_terms_acknowledged_at,
    privacyNoticeVersion: row.privacy_notice_version,
    privacyNoticeAcknowledgedAt: row.privacy_notice_acknowledged_at,
    operationalFollowUpAllowed: row.operational_follow_up_allowed,
    operationalFollowUpUpdatedAt: row.operational_follow_up_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertOwnedProfile(profile: CustomerProfile, userId: string) {
  if (profile.userId !== userId) {
    throw new CustomerProfileResponseError(
      "Supabase returned a customer profile outside the requested ownership scope.",
    );
  }
}

export function normalizeCustomerFullName(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

export function createCustomerProfileService(
  client: SupabaseClient<Database>,
): CustomerProfileService {
  return {
    async getProfile(userId) {
      const { data, error } = await client
        .from("profiles")
        .select(CUSTOMER_PROFILE_COLUMNS)
        .eq("id", userId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      const profile = mapCustomerProfile(data);
      assertOwnedProfile(profile, userId);
      return profile;
    },

    async confirmProfile({ fullName, operationalFollowUpAllowed, userId }) {
      const normalizedFullName = normalizeCustomerFullName(fullName);
      const { data, error } = await client.rpc("confirm_customer_profile", {
        full_name: normalizedFullName,
        operational_follow_up_allowed: operationalFollowUpAllowed,
        privacy_notice_version: CURRENT_PRIVACY_NOTICE_VERSION,
        service_terms_version: CURRENT_SERVICE_TERMS_VERSION,
      });

      if (error) throw error;
      if (!data) {
        throw new CustomerProfileResponseError(
          "Supabase did not return the confirmed customer profile.",
        );
      }

      const profile = mapCustomerProfile(data);
      assertOwnedProfile(profile, userId);
      return profile;
    },
  };
}
