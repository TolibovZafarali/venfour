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

export type AuthCallbackParameters =
  | { kind: "code"; code: string; flowId: string | null }
  | { kind: "email"; tokenHash: string }
  | { kind: "error"; message: string }
  | { kind: "invalid" }
  | { kind: "none" };

export function readAuthCallbackParameters(
  location: Pick<Location, "search" | "hash">,
): AuthCallbackParameters {
  const search = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const parameter = (name: string) => search.get(name) ?? hash.get(name);
  const errorDescription =
    parameter("error_description") ?? parameter("error");

  if (errorDescription) {
    return {
      kind: "error",
      message: errorDescription.replace(/\+/g, " "),
    };
  }

  const code = parameter("code");
  const tokenHash = parameter("token_hash");
  const tokenType = parameter("type");

  if (tokenHash !== null) {
    return tokenHash && tokenType === "email" && !code
      ? { kind: "email", tokenHash }
      : { kind: "invalid" };
  }

  if (code) {
    return {
      kind: "code",
      code,
      flowId: parameter("sb_flow_id") || null,
    };
  }

  if (tokenType !== null) {
    return { kind: "invalid" };
  }

  return { kind: "none" };
}
