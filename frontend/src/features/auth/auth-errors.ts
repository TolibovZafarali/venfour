type AuthOperation = "callback" | "email" | "google" | "guest" | "signout";

interface ErrorDetails {
  code?: string;
  message?: string;
  status?: number;
}

function getErrorDetails(error: unknown): ErrorDetails {
  if (error instanceof Error) {
    return {
      code: "code" in error ? String(error.code) : undefined,
      message: error.message,
      status:
        "status" in error && typeof error.status === "number"
          ? error.status
          : undefined,
    };
  }

  if (typeof error === "object" && error !== null) {
    return {
      code: "code" in error ? String(error.code) : undefined,
      message: "message" in error ? String(error.message) : undefined,
      status:
        "status" in error && typeof error.status === "number"
          ? error.status
          : undefined,
    };
  }

  return {};
}

export function getFriendlyAuthError(
  error: unknown,
  operation: AuthOperation,
) {
  const details = getErrorDetails(error);
  const searchable = `${details.code ?? ""} ${details.message ?? ""}`.toLowerCase();

  if (
    details.status === 429 ||
    searchable.includes("rate limit") ||
    searchable.includes("rate_limit")
  ) {
    return "Too many sign-in attempts. Please wait a few minutes and try again.";
  }

  if (
    searchable.includes("failed to fetch") ||
    searchable.includes("network")
  ) {
    return "We couldn’t reach the sign-in service. Check your connection and try again.";
  }

  if (
    searchable.includes("security check") ||
    searchable.includes("turnstile") ||
    searchable.includes("captcha")
  ) {
    return "We couldn’t complete the security check. Please try again.";
  }

  switch (operation) {
    case "callback":
      return "This sign-in link is invalid or has expired. Please request a new one.";
    case "email":
      return "We couldn’t send the sign-in link. Check the address and try again.";
    case "google":
      return "We couldn’t start Google sign-in. Please try again.";
    case "guest":
      return "Venfour could not prepare secure guest storage. Try again.";
    case "signout":
      return "We couldn’t sign you out. Please try again.";
  }
}
