import { createContext, useContext } from "react";

import type { CookieConsentPreferences } from "@/features/privacy/consent";

export interface CookieConsentContextValue {
  consent: CookieConsentPreferences | null;
  globalPrivacyControl: boolean;
  bannerVisible: boolean;
  preferencesOpen: boolean;
  acceptAll: () => void;
  rejectNonEssential: () => void;
  savePreferences: (analytics: boolean) => void;
  openPreferences: () => void;
  setPreferencesOpen: (open: boolean) => void;
}

export const CookieConsentContext =
  createContext<CookieConsentContextValue | null>(null);

export function useCookieConsent() {
  const context = useContext(CookieConsentContext);

  if (!context) {
    throw new Error(
      "useCookieConsent must be used inside CookieConsentProvider.",
    );
  }

  return context;
}
