export const AUTH_RETURN_LOCATION_STORAGE_KEY =
  "venfour.auth.return-location";

const DEFAULT_RETURN_LOCATION = "/";
const AUTH_CALLBACK_PATH = "/auth/callback";
const CASE_CLAIM_CALLBACK_PREFIX = `${AUTH_CALLBACK_PATH}/case-claim/`;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

    if (
      url.origin !== origin ||
      url.pathname === AUTH_CALLBACK_PATH ||
      url.pathname.startsWith(`${AUTH_CALLBACK_PATH}/`)
    ) {
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

export function getAuthCallbackUrl(
  parameters: Readonly<Record<string, string>> = {},
) {
  const caseClaimId = parameters.case_claim;
  if (caseClaimId !== undefined && !UUID_PATTERN.test(caseClaimId)) {
    throw new Error("Invalid case claim callback parameter.");
  }

  const callbackPath = caseClaimId
    ? `${CASE_CLAIM_CALLBACK_PREFIX}${caseClaimId.toLowerCase()}`
    : AUTH_CALLBACK_PATH;
  const url = new URL(callbackPath, browserOrigin());
  for (const [key, value] of Object.entries(parameters)) {
    if (key === "case_claim") continue;
    if (/^[a-z][a-z0-9_]{0,49}$/u.test(key) && value.length <= 500) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
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

export type CaseClaimCallbackParameter =
  | { kind: "claim"; claimId: string }
  | { kind: "invalid" }
  | { kind: "none" };

export function readCaseClaimCallbackParameter(
  location: Pick<Location, "pathname" | "search" | "hash">,
): CaseClaimCallbackParameter {
  const search = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const values: string[] = [
    ...search.getAll("case_claim"),
    ...hash.getAll("case_claim"),
  ];

  if (location.pathname.startsWith(CASE_CLAIM_CALLBACK_PREFIX)) {
    const encodedClaimId = location.pathname.slice(
      CASE_CLAIM_CALLBACK_PREFIX.length,
    );
    if (!encodedClaimId || encodedClaimId.includes("/")) {
      return { kind: "invalid" };
    }
    try {
      values.unshift(decodeURIComponent(encodedClaimId));
    } catch {
      return { kind: "invalid" };
    }
  } else if (location.pathname.startsWith(`${AUTH_CALLBACK_PATH}/`)) {
    return { kind: "invalid" };
  }

  if (values.length === 0) return { kind: "none" };
  if (values.length !== 1 || !UUID_PATTERN.test(values[0])) {
    return { kind: "invalid" };
  }
  return { kind: "claim", claimId: values[0] };
}

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
