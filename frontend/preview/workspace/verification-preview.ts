import { ClaimEmailOtpError, type ClaimEmailOtpService } from "../../src/features/total-loss-claim/email-otp-service";
import { CASE_ID, USER_ID } from "./claim-fixtures";
import { GUEST_USER_ID, previewAuth, snapshot } from "./state";

export { ClaimEmailOtpError };

export const claimEmailOtpService: ClaimEmailOtpService = {
  sendCode: async ({ signal }) => {
    if (signal?.aborted) throw new ClaimEmailOtpError("aborted");
  },
  verifyCodeAndClaim: async ({ caseId, expectedUserId, email, signal, token }) => {
    if (signal?.aborted) throw new ClaimEmailOtpError("aborted");
    if (snapshot().phase !== "payment-unverified" || caseId !== CASE_ID || expectedUserId !== GUEST_USER_ID || email !== "preview@example.com") {
      throw new ClaimEmailOtpError("claim_conflict");
    }
    if (token !== "123456") throw new ClaimEmailOtpError("invalid_code");
    await previewAuth.verifyEmailCode(email, token);
    const now = new Date().toISOString();
    return {
      outcome: "claimed", caseId, ownerUserId: USER_ID, contactEmail: email,
      emailVerifiedAt: now, claimedAt: now, ownershipTransferred: true, claimPurpose: "post_continue",
    };
  },
  clearPendingVerification: () => undefined,
};
