import { useRef, useState } from "react";

import { getTotalLossMessageDraft } from "@/features/total-loss-claim/api";
import type {
  TotalLossClaimSecured,
  TotalLossMessageDraft,
  TotalLossPreparedMessageVersion,
  TotalLossPublishedReport,
} from "@/features/total-loss-claim/contracts";
import { normalizeCustomerRequestBody } from "@/features/total-loss-claim/customer-message-copy";
import {
  useTotalLossEducationProgressMutation,
  useTotalLossMessageDraftMutation,
  useTotalLossPrepareMessageMutation,
  useTotalLossSendingDetailsMutation,
} from "@/features/total-loss-claim/queries";
import {
  contentOf,
  EMAIL_PATTERN,
  normalizedContent,
  sameContent,
} from "@/features/total-loss-claim/request-state";

// The existing request API requires these review acknowledgements. Keep them
// tied to explicit draft creation without requiring the retired review screens.
const OPTIONAL_REVIEW_STEPS = [
  "insurer_review",
  "valuation",
  "report",
  "what_next",
] as const;

export interface RequestPreparationOptions {
  readonly accessToken: string;
  readonly caseId: string;
  readonly claim: TotalLossClaimSecured;
  readonly onRefresh: () => Promise<unknown>;
  readonly report: TotalLossPublishedReport;
  readonly userId: string;
}

export function useRequestPreparation(options: RequestPreparationOptions) {
  const { accessToken, caseId, claim, report, userId } = options;
  const { mutateAsync: recordEducation } =
    useTotalLossEducationProgressMutation({ accessToken, caseId, userId });
  const { mutateAsync: saveDetails } = useTotalLossSendingDetailsMutation({
    accessToken,
    caseId,
    userId,
  });
  const { mutateAsync: prepare } = useTotalLossPrepareMessageMutation({
    accessToken,
    caseId,
    userId,
  });
  const { mutateAsync: saveDraft } = useTotalLossMessageDraftMutation({
    accessToken,
    caseId,
    userId,
  });
  const [draft, setDraft] = useState<TotalLossMessageDraft | null>(
    claim.messageDraft ?? null,
  );
  const [preparedVersion, setPreparedVersion] =
    useState<TotalLossPreparedMessageVersion | null>(null);
  const [preparedRevision, setPreparedRevision] = useState<number | null>(null);
  const [email, setEmail] = useState(claim.sendingDetails?.adjusterEmail ?? "");
  const [reference, setReference] = useState(
    claim.sendingDetails?.claimReference ?? "",
  );
  const [creating, setCreating] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(globalThis.crypto.randomUUID());
  const creatingRef = useRef(false);
  const pendingGenerated = useRef<Awaited<ReturnType<typeof prepare>> | null>(
    null,
  );
  const details = claim.sendingDetails;

  const createDraft = async () => {
    if (creatingRef.current || !claim.workflow || !details) return;
    setAttempted(true);
    if (!EMAIL_PATTERN.test(email.trim())) {
      setError("Enter the adjuster’s valid email address.");
      return;
    }
    if (!reference.trim()) {
      setError("Enter the claim or reference number.");
      return;
    }
    creatingRef.current = true;
    setCreating(true);
    setError(null);
    try {
      let revision = claim.workflow.revision;
      if (!pendingGenerated.current) {
        if (!claim.education?.steps.result.completedAt) {
          const result = await recordEducation({
            expectedWorkflowRevision: revision,
            state: "completed",
            step: "result",
          });
          revision = result.workflowRevision;
        }
        const progress = claim.education?.steps;
        if (
          !OPTIONAL_REVIEW_STEPS.some((step) => progress?.[step].skippedAt) &&
          !OPTIONAL_REVIEW_STEPS.every((step) => progress?.[step].completedAt)
        ) {
          const skip = !progress?.what_next.completedAt
            ? "what_next"
            : (OPTIONAL_REVIEW_STEPS.find((step) => !progress?.[step].completedAt) ??
              "what_next");
          const result = await recordEducation({
            expectedWorkflowRevision: revision,
            state: "skipped",
            step: skip,
          });
          revision = result.workflowRevision;
        }
        if (
          !details.adjusterEmailConfirmed ||
          !details.claimReferenceConfirmed ||
          email.trim() !== details.adjusterEmail ||
          reference.trim() !== details.claimReference
        ) {
          const result = await saveDetails({
            adjusterName: details.adjusterName,
            adjusterEmail: email.trim(),
            adjusterEmailConfirmed: true,
            claimReference: reference.trim(),
            claimReferenceConfirmed: true,
            expectedRevision: details.revision,
            expectedWorkflowRevision: revision,
          });
          revision = result.workflowRevision;
        }
        pendingGenerated.current = await prepare({
          clientRequestId: request.current,
          expectedWorkflowRevision: revision,
        });
      }
      const generated = pendingGenerated.current;
      const repairedBody = normalizeCustomerRequestBody(
        generated.draft.body,
        report,
      );
      let nextDraft = generated.draft;
      let nextVersion: TotalLossPreparedMessageVersion | null =
        generated.messageVersion;
      if (repairedBody !== generated.draft.body) {
        const corrected = normalizedContent({
          body: repairedBody,
          recipient: generated.draft.recipient ?? email.trim(),
          subject: generated.draft.subject,
        });
        try {
          nextDraft = await saveDraft({
            ...corrected,
            expectedRevision: generated.draft.revision,
          });
        } catch {
          const current = await getTotalLossMessageDraft(caseId, accessToken);
          if (
            current.reportVersionId !== generated.draft.reportVersionId ||
            !sameContent(contentOf(current), corrected)
          )
            throw new Error("The draft could not be saved.");
          nextDraft = current;
        }
        nextVersion = null;
      }
      setPreparedRevision(generated.workflowRevision);
      setPreparedVersion(nextVersion);
      setDraft(nextDraft);
    } catch {
      await options.onRefresh().catch(() => undefined);
      setError(
        "We couldn’t create your request draft. Your case is saved; try again.",
      );
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const incomingDraft = creating ? null : claim.messageDraft;
  const selectedDraft =
    incomingDraft && (!draft || incomingDraft.revision > draft.revision)
      ? incomingDraft
      : draft;

  return {
    attempted,
    createDraft,
    creating,
    details,
    draft: selectedDraft,
    email,
    error,
    markAttempted: () => setAttempted(true),
    preparedVersion,
    reference,
    setEmail,
    setReference,
    workflowRevision: Math.max(
      preparedRevision ?? 0,
      claim.workflow?.revision ?? 1,
    ),
  };
}
