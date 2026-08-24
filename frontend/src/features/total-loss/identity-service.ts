import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CompleteTotalLossIdentityClaimResult,
  SaveTotalLossContactInput,
  TotalLossContact,
  TotalLossIdentityClaim,
} from "@/features/total-loss/data-types";
import type { Database } from "@/lib/supabase/database.types";

type RpcClient = {
  rpc: (
    name: string,
    parameters: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: Error | null }>;
};

export interface TotalLossIdentityService {
  getContact(caseId: string): Promise<TotalLossContact | null>;
  saveContactAndBeginClaim(
    input: SaveTotalLossContactInput,
  ): Promise<TotalLossIdentityClaim>;
  completeIdentityClaim(
    claimId: string,
  ): Promise<CompleteTotalLossIdentityClaimResult | void>;
}

export class TotalLossIdentityResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TotalLossIdentityResponseError";
  }
}

export function createTotalLossIdentityService(
  client: SupabaseClient<Database>,
): TotalLossIdentityService {
  const rpcClient = client as unknown as RpcClient;

  return {
    async getContact(caseId) {
      const { data, error } = await client
        .from("total_loss_case_contacts" as never)
        .select("*")
        .eq("case_id" as never, caseId)
        .maybeSingle();
      if (error) throw error;
      return data ? mapContact(data) : null;
    },

    async saveContactAndBeginClaim(input) {
      const { data, error } = await rpcClient.rpc(
        "save_total_loss_contact_and_begin_claim",
        {
          case_id: input.caseId,
          full_name: input.fullName,
          email: input.email,
          service_terms_version: input.serviceTermsVersion,
          privacy_notice_version: input.privacyNoticeVersion,
          operational_follow_up_allowed: input.operationalFollowUpAllowed,
        },
      );
      if (error) throw error;
      const row = firstRow(data);
      const contact = mapContact(row);
      if (contact.caseId !== input.caseId) {
        throw new TotalLossIdentityResponseError(
          "Supabase returned contact details outside the requested case.",
        );
      }
      const claimId = nullableString(row.claim_id);
      const expiresAt = nullableString(row.claim_expires_at);
      if ((claimId === null) !== (expiresAt === null)) {
        throw new TotalLossIdentityResponseError(
          "Supabase returned incomplete case-access claim details.",
        );
      }
      return { claimId, expiresAt, contact };
    },

    async completeIdentityClaim(claimId) {
      const { data, error } = await rpcClient.rpc(
        "complete_total_loss_case_claim",
        { claim_id: claimId },
      );
      if (error) throw error;
      const row = firstRow(data);
      if (row.outcome !== "claimed" && row.outcome !== "already_claimed") {
        throw new TotalLossIdentityResponseError(
          "The case-access link could not be completed.",
        );
      }
      return {
        outcome: row.outcome,
        caseId: requiredString(row.case_id),
        ownerUserId: requiredString(row.owner_user_id),
        contactEmail: requiredString(row.contact_email),
        emailVerifiedAt: requiredString(row.email_verified_at),
        claimedAt: requiredString(row.claimed_at),
        ownershipTransferred: requiredBoolean(row.ownership_transferred),
      };
    },
  };
}

function firstRow(data: unknown): Record<string, unknown> {
  const row = Array.isArray(data) ? data[0] : data;
  if (!isRecord(row)) {
    throw new TotalLossIdentityResponseError(
      "Supabase returned incomplete case-contact details.",
    );
  }
  return row;
}

function mapContact(value: unknown): TotalLossContact {
  if (!isRecord(value)) {
    throw new TotalLossIdentityResponseError(
      "Supabase returned incomplete case-contact details.",
    );
  }
  const contact: TotalLossContact = {
    caseId: requiredString(value.case_id),
    fullName: requiredString(value.full_name),
    email: requiredString(value.email),
    emailVerifiedAt: nullableString(value.email_verified_at),
    serviceTermsVersion: requiredString(value.service_terms_version),
    serviceTermsAcknowledgedAt: requiredString(
      value.service_terms_acknowledged_at,
    ),
    privacyNoticeVersion: requiredString(value.privacy_notice_version),
    privacyNoticeAcknowledgedAt: requiredString(
      value.privacy_notice_acknowledged_at,
    ),
    operationalFollowUpAllowed: requiredBoolean(
      value.operational_follow_up_allowed,
    ),
    operationalFollowUpUpdatedAt: requiredString(
      value.operational_follow_up_updated_at,
    ),
    createdAt: requiredString(value.created_at),
    updatedAt: requiredString(value.updated_at),
  };
  return contact;
}

function requiredString(value: unknown) {
  if (typeof value !== "string" || value.length < 1) {
    throw new TotalLossIdentityResponseError(
      "Supabase returned an incomplete contact field.",
    );
  }
  return value;
}

function nullableString(value: unknown) {
  if (value === null || value === undefined) return null;
  return requiredString(value);
}

function requiredBoolean(value: unknown) {
  if (typeof value !== "boolean") {
    throw new TotalLossIdentityResponseError(
      "Supabase returned an incomplete contact choice.",
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
