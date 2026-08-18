import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import {
  COOKIE_CONSENT_STORAGE_KEY,
  createCookieConsent,
  isGlobalPrivacyControlEnabled,
  readStoredCookieConsent,
  writeStoredCookieConsent,
} from "@/features/privacy/consent";
import type {
  ConsentSource,
  CookieConsentPreferences,
} from "@/features/privacy/consent";
import {
  CookieConsentContext,
  type CookieConsentContextValue,
} from "@/features/privacy/cookie-consent-context";

interface CookieConsentProviderProps {
  children: ReactNode;
}

export function CookieConsentProvider({
  children,
}: CookieConsentProviderProps) {
  const [globalPrivacyControl] = useState(isGlobalPrivacyControlEnabled);
  const [consent, setConsent] = useState<CookieConsentPreferences | null>(() => {
    const storedConsent = readStoredCookieConsent();

    if (storedConsent) {
      return storedConsent;
    }

    return globalPrivacyControl
      ? createCookieConsent(false, "global-privacy-control")
      : null;
  });
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const preferencesTriggerRef = useRef<HTMLElement | null>(null);

  const openPreferences = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      preferencesTriggerRef.current = document.activeElement;
    }
    setPreferencesOpen(true);
  }, []);

  const changePreferencesOpen = useCallback((open: boolean) => {
    setPreferencesOpen(open);
    if (!open) {
      const trigger = preferencesTriggerRef.current;
      queueMicrotask(() => trigger?.focus());
    }
  }, []);

  const persistConsent = useCallback(
    (analytics: boolean, source: ConsentSource) => {
      const nextConsent = createCookieConsent(analytics, source);
      writeStoredCookieConsent(nextConsent);
      setConsent(nextConsent);
      changePreferencesOpen(false);
    },
    [changePreferencesOpen],
  );

  useEffect(() => {
    if (globalPrivacyControl && consent) {
      writeStoredCookieConsent(consent);
    }
  }, [consent, globalPrivacyControl]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== COOKIE_CONSENT_STORAGE_KEY) {
        return;
      }

      const storedConsent = readStoredCookieConsent();
      setConsent(
        storedConsent ??
          (globalPrivacyControl
            ? createCookieConsent(false, "global-privacy-control")
            : null),
      );
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [globalPrivacyControl]);

  const value = useMemo<CookieConsentContextValue>(
    () => ({
      consent,
      globalPrivacyControl,
      bannerVisible: consent === null,
      preferencesOpen,
      acceptAll: () => persistConsent(true, "accept-all"),
      rejectNonEssential: () =>
        persistConsent(false, "reject-non-essential"),
      savePreferences: (analytics) =>
        persistConsent(analytics, "preferences"),
      openPreferences,
      setPreferencesOpen: changePreferencesOpen,
    }),
    [
      changePreferencesOpen,
      consent,
      globalPrivacyControl,
      openPreferences,
      persistConsent,
      preferencesOpen,
    ],
  );

  return (
    <CookieConsentContext.Provider value={value}>
      {children}
    </CookieConsentContext.Provider>
  );
}
