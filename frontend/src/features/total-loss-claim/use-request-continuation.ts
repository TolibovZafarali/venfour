import { useState } from "react";

function savedVersion(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

export function useRequestContinuation(userId: string, caseId: string, reportId: string) {
  const key = `venfour:request-continuation:${userId}:${caseId}:${reportId}`;
  const [pending, setPending] = useState(() => ({ key, version: savedVersion(key) }));
  return {
    pendingVersion: pending.key === key ? pending.version : savedVersion(key),
    waitForContinue(version: string) {
      setPending({ key, version });
      try { sessionStorage.setItem(key, version); } catch { /* Keep the current page usable when storage is unavailable. */ }
    },
    continueFromRequest() {
      setPending({ key, version: null });
      try { sessionStorage.removeItem(key); } catch { /* In-memory navigation remains available. */ }
    },
  };
}
