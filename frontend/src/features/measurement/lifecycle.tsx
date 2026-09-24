import { useEffect, useMemo } from "react";
import { useLocation } from "react-router";
import { COOKIE_CONSENT_CHANGE_EVENT, hasAdvertisingConsent, hasAnalyticsConsent, readStoredCookieConsent } from "@/features/privacy/consent";
import { captureAttribution, clearAttribution } from "./attribution";
import { emitBusinessEvent } from "./events";
import { loadGoogleTag, updateGoogleConsent } from "./google";
import { useCaseMeasurement } from "./use-case-measurement";

export function MeasurementLifecycle({ caseId }: { caseId?: string }) {
  const location = useLocation();
  const { id: landingEventId } = useMemo(() => ({ key: location.key, id: crypto.randomUUID() }), [location.key]);
  useCaseMeasurement(caseId);
  useEffect(() => {
    if (/^\/(admin|partners|auth)(\/|$)/.test(location.pathname)) return;
    const update = () => {
      if (!hasAdvertisingConsent() && readStoredCookieConsent()) clearAttribution();
      captureAttribution(location.search, location.pathname);
      updateGoogleConsent();
      if (location.pathname === "/") {
        if (hasAnalyticsConsent() || hasAdvertisingConsent()) emitBusinessEvent({ event_name: "landing_view", event_id: landingEventId, timestamp: new Date().toISOString() });
        void loadGoogleTag();
      }
    };
    update();
    window.addEventListener(COOKIE_CONSENT_CHANGE_EVENT, update);
    window.addEventListener("focus", update);
    return () => { window.removeEventListener(COOKIE_CONSENT_CHANGE_EVENT, update); window.removeEventListener("focus", update); };
  }, [landingEventId, location.pathname, location.search]);
  return null;
}
