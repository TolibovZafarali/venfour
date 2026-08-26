import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CompleteTotalLossIdentityClaimResult,
  SaveTotalLossContactInput,
  TotalLossContact,
  TotalLossIdentityClaim,
} from "@/features/total-loss/data-types";
import { splitTotalLossContactName } from "@/features/total-loss/types";
import type { Database } from "@/lib/supabase/database.types";

type RpcClient = {
  rpc: (
    name: string,
    parameters: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: Error | null }>;
};

const ISO_TIMESTAMP_PATTERN =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.\d+)?(?<offset>Z|[+-]\d{2}:\d{2})$/u;

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
        "save_total_loss_contact_details_and_begin_claim",
        {
          case_id: input.caseId,
          first_name: input.firstName,
          last_name: input.lastName,
          email: input.email,
          phone_number: input.phoneNumber,
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
      const expiresAt = nullableCanonicalTimestamp(row.claim_expires_at);
      if ((claimId === null) !== (expiresAt === null)) {
        throw new TotalLossIdentityResponseError(
          "Supabase returned incomplete case-access claim details.",
        );
      }
      return { claimId, expiresAt, contact };
    },

    async completeIdentityClaim(claimId) {
      const { data, error } = await rpcClient.rpc(
        "complete_total_loss_case_claim_with_context",
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
        claimPurpose: requiredClaimPurpose(row.claim_purpose),
      };
    },
  };
}

function requiredClaimPurpose(value: unknown) {
  if (value !== "intake" && value !== "post_continue") {
    throw new TotalLossIdentityResponseError(
      "Supabase returned an invalid case-access claim purpose.",
    );
  }
  return value;
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
  const fullName = requiredString(value.full_name);
  const fallbackName = splitTotalLossContactName(fullName);
  const contact: TotalLossContact = {
    caseId: requiredString(value.case_id),
    firstName: nullableString(value.first_name) ?? fallbackName.firstName,
    lastName: nullableString(value.last_name) ?? fallbackName.lastName,
    fullName,
    email: requiredString(value.email),
    phoneNumber: nullableString(value.phone_number),
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

function nullableCanonicalTimestamp(value: unknown) {
  const timestamp = nullableString(value);
  if (timestamp === null) return null;

  const match = ISO_TIMESTAMP_PATTERN.exec(timestamp);
  const parsed = new Date(timestamp);
  if (
    !match?.groups ||
    !isValidTimestampComponents(match.groups) ||
    Number.isNaN(parsed.getTime())
  ) {
    throw new TotalLossIdentityResponseError(
      "Supabase returned an invalid case-access claim expiration.",
    );
  }
  return parsed.toISOString();
}

function isValidTimestampComponents(groups: Record<string, string>) {
  const year = Number(groups.year);
  const month = Number(groups.month);
  const day = Number(groups.day);
  const hour = Number(groups.hour);
  const minute = Number(groups.minute);
  const second = Number(groups.second);
  const offset = groups.offset;
  const offsetHours = offset === "Z" ? 0 : Number(offset.slice(1, 3));
  const offsetMinutes = offset === "Z" ? 0 : Number(offset.slice(4, 6));

  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59 &&
    offsetHours >= 0 &&
    offsetHours <= 23 &&
    offsetMinutes >= 0 &&
    offsetMinutes <= 59
  );
}

function daysInMonth(year: number, month: number) {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
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
