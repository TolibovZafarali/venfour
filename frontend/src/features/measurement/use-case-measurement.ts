import { useEffect } from "react";
import { COOKIE_CONSENT_CHANGE_EVENT, readStoredCookieConsent } from "@/features/privacy/consent";
import { measureFinancialEvents, syncCaseAttribution, trackCaseEvent } from "./service";

export function useCaseMeasurement(caseId: string | undefined, started = false) {
  useEffect(() => {
    if (!caseId) return;
    const sync = () => {
      if (!readStoredCookieConsent()) return;
      void syncCaseAttribution(caseId).then(() => measureFinancialEvents(caseId)).catch(() => {});
      if (started) trackCaseEvent("review_started", caseId);
    };
    sync();
    window.addEventListener(COOKIE_CONSENT_CHANGE_EVENT, sync);
    window.addEventListener("focus", sync);
    return () => { window.removeEventListener(COOKIE_CONSENT_CHANGE_EVENT, sync); window.removeEventListener("focus", sync); };
  }, [caseId, started]);
}
