import { consumeAuthReturnLocation, type readCaseClaimCallbackParameter } from "@/features/auth/return-location";
import type { StaffCaseOperationsService } from "@/features/admin/case-operations/service";
import type { NavigateFunction } from "react-router";
import { isPartnerHost } from "@/features/referral-partners/urls";
import type { CompleteTotalLossIdentityClaimResult } from "@/features/total-loss/data-types";
import type { TotalLossIdentityService } from "@/features/total-loss/identity-service";

class CaseClaimCompletionError extends Error {
  readonly code = "CASE_CLAIM_FAILED";
}

const defaultSignInLocations = new Set([
  "/", "/app", "/appraisals", "/start", "/start?service=total-loss", "/total-loss/start",
]);

export async function completedAuthReturnLocation(
  caseClaim: ReturnType<typeof readCaseClaimCallbackParameter>,
  completedClaim: CompleteTotalLossIdentityClaimResult | null,
  staffService?: Pick<StaffCaseOperationsService, "isStaff"> | null,
) {
  const storedReturnLocation = consumeAuthReturnLocation();
  if (caseClaim.kind !== "claim") {
    if (isPartnerHost()) return storedReturnLocation;
    if (staffService && defaultSignInLocations.has(storedReturnLocation)) {
      try {
        if (await staffService.isStaff()) return "/admin";
      } catch {
        // An unavailable staff check must not prevent ordinary sign-in.
      }
    }
    return ["/", "/appraisals"].includes(storedReturnLocation) ? "/app" : storedReturnLocation;
  }
  if (!completedClaim) {
    throw new Error("The secure case-access link could not be completed.");
  }
  return `/total-loss/cases/${encodeURIComponent(completedClaim.caseId)}`;
}

export function navigateAfterAuth(
  destination: string,
  navigate: NavigateFunction,
  replaceDocument: (path: string) => void = (path) => window.location.replace(path),
) {
  if (destination === "/admin" && !isPartnerHost()) {
    // Request the protected document so the staff edge-access policy runs.
    replaceDocument(destination);
    return;
  }
  void navigate(destination, { replace: true });
}

export async function completeCaseClaim(
  identityService: TotalLossIdentityService | null | undefined,
  claimId: string,
  expectedUserId: string,
) {
  if (!identityService) {
    throw new Error("Secure case access is temporarily unavailable.");
  }
  let result: Awaited<ReturnType<typeof identityService.completeIdentityClaim>>;
  try {
    result = await identityService.completeIdentityClaim(claimId);
  } catch {
    throw new CaseClaimCompletionError(
      "The secure case-access link could not be completed.",
    );
  }
  if (!result || result.ownerUserId !== expectedUserId) {
    throw new CaseClaimCompletionError(
      "The secure case-access link could not be completed.",
    );
  }
  return result;
}
