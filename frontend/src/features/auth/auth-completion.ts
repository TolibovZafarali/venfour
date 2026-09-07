import { consumeAuthReturnLocation, readCaseClaimCallbackParameter } from "@/features/auth/return-location";
import type { CompleteTotalLossIdentityClaimResult } from "@/features/total-loss/data-types";
import type { TotalLossIdentityService } from "@/features/total-loss/identity-service";

class CaseClaimCompletionError extends Error {
  readonly code = "CASE_CLAIM_FAILED";
}

export function completedAuthReturnLocation(
  caseClaim: ReturnType<typeof readCaseClaimCallbackParameter>,
  completedClaim: CompleteTotalLossIdentityClaimResult | null,
) {
  const storedReturnLocation = consumeAuthReturnLocation();
  if (caseClaim.kind !== "claim") return storedReturnLocation;
  if (!completedClaim) {
    throw new Error("The secure case-access link could not be completed.");
  }
  return completedClaim.claimPurpose === "post_continue"
    ? `/total-loss/cases/${encodeURIComponent(completedClaim.caseId)}/claim/checkout`
    : "/appraisals";
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
