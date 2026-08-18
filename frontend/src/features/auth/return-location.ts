export const AUTH_RETURN_LOCATION_STORAGE_KEY =
  "venfour.auth.return-location";

const DEFAULT_RETURN_LOCATION = "/";

function browserOrigin() {
  return typeof window === "undefined" ? "http://localhost" : window.location.origin;
}

export function sanitizeReturnLocation(
  candidate: string | null | undefined,
  origin = browserOrigin(),
) {
  if (
    !candidate ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\")
  ) {
    return DEFAULT_RETURN_LOCATION;
  }

  try {
    const url = new URL(candidate, origin);

    if (url.origin !== origin || url.pathname === "/auth/callback") {
      return DEFAULT_RETURN_LOCATION;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_RETURN_LOCATION;
  }
}

export function getCurrentReturnLocation() {
  if (typeof window === "undefined") {
    return DEFAULT_RETURN_LOCATION;
  }

  return sanitizeReturnLocation(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
}

export function getAuthCallbackUrl() {
  return new URL("/auth/callback", browserOrigin()).toString();
}

export function storeAuthReturnLocation(returnTo?: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    AUTH_RETURN_LOCATION_STORAGE_KEY,
    sanitizeReturnLocation(returnTo ?? getCurrentReturnLocation()),
  );
}

export function consumeAuthReturnLocation() {
  if (typeof window === "undefined") {
    return DEFAULT_RETURN_LOCATION;
  }

  const stored = window.localStorage.getItem(
    AUTH_RETURN_LOCATION_STORAGE_KEY,
  );
  window.localStorage.removeItem(AUTH_RETURN_LOCATION_STORAGE_KEY);

  return sanitizeReturnLocation(stored);
}

export interface AuthCallbackParameters {
  code: string | null;
  error: string | null;
}

export function readAuthCallbackParameters(
  location: Pick<Location, "search" | "hash">,
): AuthCallbackParameters {
  const search = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const errorDescription =
    search.get("error_description") ??
    hash.get("error_description") ??
    search.get("error") ??
    hash.get("error");

  return {
    code: search.get("code") ?? hash.get("code"),
    error: errorDescription?.replace(/\+/g, " ") ?? null,
  };
}
