import type {
  TotalLossClaimSecured,
  TotalLossMessageDraft,
} from "@/features/total-loss-claim/contracts";

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

const OPTIONAL_REVIEW_STEPS = [
  "insurer_review",
  "valuation",
  "report",
  "what_next",
] as const;

export function requestReviewComplete(
  claim: TotalLossClaimSecured,
  reportId: string,
) {
  const progress = claim.education?.steps;
  return Boolean(
    claim.education?.reportVersionId === reportId &&
      progress?.result.completedAt &&
      (OPTIONAL_REVIEW_STEPS.every((step) => progress[step].completedAt) ||
        OPTIONAL_REVIEW_STEPS.some((step) => progress[step].skippedAt)),
  );
}

export type DraftContent = Pick<TotalLossMessageDraft, "body" | "subject"> & {
  readonly recipient: string;
};

export function contentOf(draft: TotalLossMessageDraft): DraftContent {
  return {
    recipient: draft.recipient ?? "",
    subject: draft.subject,
    body: draft.body,
  };
}

export function normalizedContent(content: DraftContent): DraftContent {
  return {
    recipient: content.recipient.trim().toLowerCase(),
    subject: content.subject.trim(),
    body: content.body,
  };
}

export function sameContent(left: DraftContent, right: DraftContent) {
  return (
    left.recipient === right.recipient &&
    left.subject === right.subject &&
    left.body === right.body
  );
}

export function validationError(content: DraftContent) {
  if (!EMAIL_PATTERN.test(content.recipient.trim()))
    return "Enter a valid recipient email address.";
  if (!content.subject.trim()) return "Add an email subject.";
  if (!content.body.trim()) return "Add an email message.";
  return null;
}

export function requestIsSent(claim: TotalLossClaimSecured) {
  return (
    claim.journey?.nextState === "awaiting_insurer_response" ||
    claim.journey?.nextState === "insurer_response_received" ||
    claim.journey?.fulfillmentState === "awaiting_insurer_response" ||
    claim.journey?.fulfillmentState === "insurer_response_received" ||
    claim.workflow?.currentTask === "awaiting_insurer_response" ||
    claim.workflow?.currentTask === "insurer_response_received"
  );
}
