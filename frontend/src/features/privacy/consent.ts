export const COOKIE_CONSENT_STORAGE_KEY = "venfour.cookie-consent";
export const COOKIE_CONSENT_CHANGE_EVENT = "venfour:cookie-consent-change";

const CONSENT_VERSION = 2;
const CONSENT_COOKIE = "venfour.consent";

export function sharedCookieDomain() {
  return ["venfour.com", "www.venfour.com", "app.venfour.com"].includes(window.location.hostname)
    && window.location.protocol === "https:" ? "; Domain=venfour.com; Secure" : "";
}

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
  advertising: boolean;
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
  advertising = false,
): CookieConsentPreferences {
  const globalPrivacyControl = isGlobalPrivacyControlEnabled();

  return {
    version: CONSENT_VERSION,
    essential: true,
    analytics: globalPrivacyControl ? false : analytics,
    advertising: globalPrivacyControl ? false : advertising,
    source: globalPrivacyControl ? "global-privacy-control" : source,
    savedAt: new Date().toISOString(),
  };
}

export function readStoredCookieConsent(): CookieConsentPreferences | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const cookie = sharedCookieDomain() ? document.cookie.split("; ").find(row => row.startsWith(`${CONSENT_COOKIE}=`))?.slice(CONSENT_COOKIE.length + 1) : null;
    const rawConsent = cookie ? decodeURIComponent(cookie) : window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (!rawConsent) {
      return null;
    }

    const consent = JSON.parse(rawConsent);
    // Earlier analytics permission never authorizes advertising.
    if (consent?.version === 1) { consent.version = CONSENT_VERSION; consent.advertising = false; }
    if (!isCookieConsentPreferences(consent)) {
      return null;
    }

    if (isGlobalPrivacyControlEnabled() && (consent.analytics || consent.advertising)) {
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

  try { window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(consent)); } catch { /* Preferences cannot block the service. */ }
  if (sharedCookieDomain()) {
    try { document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(consent))}; Path=/; Max-Age=15552000; SameSite=Lax${sharedCookieDomain()}`; } catch { /* Fail closed when storage is unavailable. */ }
  }
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

export function hasAdvertisingConsent() {
  return !isGlobalPrivacyControlEnabled() && readStoredCookieConsent()?.advertising === true;
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
    typeof candidate.advertising === "boolean" &&
    typeof candidate.savedAt === "string" &&
    Number.isFinite(Date.parse(candidate.savedAt)) &&
    Date.now() - Date.parse(candidate.savedAt) >= 0 &&
    Date.now() - Date.parse(candidate.savedAt) < 15552000 * 1000 &&
    consentSources.some((source) => source === candidate.source)
  );
}
