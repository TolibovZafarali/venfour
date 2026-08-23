export const CURRENT_SERVICE_TERMS_VERSION = "2026-08-23";
export const CURRENT_PRIVACY_NOTICE_VERSION = "2026-08-23";

export interface CustomerProfile {
  readonly userId: string;
  readonly fullName: string | null;
  readonly fullNameConfirmedAt: string | null;
  readonly serviceTermsVersion: string | null;
  readonly serviceTermsAcknowledgedAt: string | null;
  readonly privacyNoticeVersion: string | null;
  readonly privacyNoticeAcknowledgedAt: string | null;
  readonly operationalFollowUpAllowed: boolean | null;
  readonly operationalFollowUpUpdatedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ConfirmCustomerProfileInput {
  readonly userId: string;
  readonly fullName: string;
  readonly operationalFollowUpAllowed: boolean;
}

export function isCustomerProfileConfirmed(
  profile: CustomerProfile | null | undefined,
): profile is CustomerProfile {
  return Boolean(
    profile?.fullName?.trim() &&
    profile.fullNameConfirmedAt &&
    profile.serviceTermsVersion === CURRENT_SERVICE_TERMS_VERSION &&
    profile.serviceTermsAcknowledgedAt &&
    profile.privacyNoticeVersion === CURRENT_PRIVACY_NOTICE_VERSION &&
    profile.privacyNoticeAcknowledgedAt &&
    profile.operationalFollowUpAllowed !== null &&
    profile.operationalFollowUpUpdatedAt,
  );
}
