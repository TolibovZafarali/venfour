import { useSyncExternalStore } from "react";

import { hostAudience } from "@/app/site-boundary";

const COOKIE_NAME = "venfour.app-session";
const COOKIE_ATTRIBUTES = "Domain=venfour.com; Path=/; Secure; SameSite=Lax";
const HINT_LIFETIME_SECONDS = 15 * 60;

// This nonsecret hint changes navigation labels only. App authentication and
// authorization always use the session stored on the application origin.
export function updatePublicSessionHint(permanentSession: boolean) {
  if (hostAudience() !== "application" || typeof document === "undefined") return;
  try {
    document.cookie = `${COOKIE_NAME}=${permanentSession ? "1" : ""}; ${COOKIE_ATTRIBUTES}; Max-Age=${permanentSession ? HINT_LIFETIME_SECONDS : 0}`;
  } catch {
    // Cookie availability must never affect sign-in or sign-out.
  }
}

function readPublicSessionHint() {
  if (hostAudience() !== "public" || typeof document === "undefined") return false;
  try {
    const values = document.cookie.split(";").map(value => value.trim())
      .filter(value => value.startsWith(`${COOKIE_NAME}=`));
    return values.length === 1 && values[0] === `${COOKIE_NAME}=1`;
  } catch {
    return false;
  }
}

function subscribeToPublicSessionHint(onChange: () => void) {
  if (hostAudience() !== "public") return () => {};
  window.addEventListener("focus", onChange);
  window.addEventListener("pageshow", onChange);
  document.addEventListener("visibilitychange", onChange);
  const interval = window.setInterval(onChange, 30_000);
  return () => {
    window.removeEventListener("focus", onChange);
    window.removeEventListener("pageshow", onChange);
    document.removeEventListener("visibilitychange", onChange);
    window.clearInterval(interval);
  };
}

export function usePublicSessionHint() {
  return useSyncExternalStore(subscribeToPublicSessionHint, readPublicSessionHint, () => false);
}
