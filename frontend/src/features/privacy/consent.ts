export const COOKIE_CONSENT_STORAGE_KEY = "venfour.cookie-consent";
export const COOKIE_CONSENT_CHANGE_EVENT = "venfour:cookie-consent-change";

const CONSENT_VERSION = 1;

const consentSources = [
  "accept-all",
  "reject-non-essential",
  "preferences",
  "global-privacy-control",
] as const;

export type ConsentSource = (typeof consentSources)[number];

export interface CookieConsentPreferences {
  version: typeof CONSENT_VERSION;
  essential: true;
  analytics: boolean;
  source: ConsentSource;
  savedAt: string;
}

type PrivacyAwareNavigator = Navigator & {
  globalPrivacyControl?: boolean;
};

export function isGlobalPrivacyControlEnabled() {
  return (
    typeof navigator !== "undefined" &&
    (navigator as PrivacyAwareNavigator).globalPrivacyControl === true
  );
}

export function createCookieConsent(
  analytics: boolean,
  source: ConsentSource,
): CookieConsentPreferences {
  const globalPrivacyControl = isGlobalPrivacyControlEnabled();

  return {
    version: CONSENT_VERSION,
    essential: true,
    analytics: globalPrivacyControl ? false : analytics,
    source: globalPrivacyControl ? "global-privacy-control" : source,
    savedAt: new Date().toISOString(),
  };
}

export function readStoredCookieConsent(): CookieConsentPreferences | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawConsent = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (!rawConsent) {
      return null;
    }

    const consent: unknown = JSON.parse(rawConsent);
    if (!isCookieConsentPreferences(consent)) {
      return null;
    }

    if (isGlobalPrivacyControlEnabled() && consent.analytics) {
      return createCookieConsent(false, "global-privacy-control");
    }

    return consent;
  } catch {
    return null;
  }
}

export function writeStoredCookieConsent(
  consent: CookieConsentPreferences,
) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    COOKIE_CONSENT_STORAGE_KEY,
    JSON.stringify(consent),
  );
  window.dispatchEvent(
    new CustomEvent<CookieConsentPreferences>(COOKIE_CONSENT_CHANGE_EVENT, {
      detail: consent,
    }),
  );
}

export function hasAnalyticsConsent() {
  return (
    !isGlobalPrivacyControlEnabled() &&
    readStoredCookieConsent()?.analytics === true
  );
}

function isCookieConsentPreferences(
  value: unknown,
): value is CookieConsentPreferences {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<CookieConsentPreferences>;

  return (
    candidate.version === CONSENT_VERSION &&
    candidate.essential === true &&
    typeof candidate.analytics === "boolean" &&
    typeof candidate.savedAt === "string" &&
    consentSources.some((source) => source === candidate.source)
  );
}
