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
  useTotalLossMessageDraftMutation,
  useTotalLossPrepareMessageMutation,
  useTotalLossSendingDetailsMutation,
} from "@/features/total-loss-claim/queries";
import {
  contentOf,
  EMAIL_PATTERN,
  normalizedContent,
  requestReviewComplete,
  sameContent,
} from "@/features/total-loss-claim/request-state";

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
    claim.messageDraft?.reportVersionId === report.reportId
      ? claim.messageDraft
      : null,
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
  const reviewCompleted = requestReviewComplete(claim, report.reportId);

  const createDraft = async () => {
    if (creatingRef.current || !claim.workflow || !details) return;
    setAttempted(true);
    if (!reviewCompleted) {
      setError("Complete the review before preparing your request.");
      return;
    }
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
      if (
        generated.draft.reportVersionId !== report.reportId ||
        generated.messageVersion.reportVersionId !== report.reportId
      ) {
        pendingGenerated.current = null;
        request.current = globalThis.crypto.randomUUID();
        throw new Error("The published report changed.");
      }
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

  const incomingDraft =
    !creating && claim.messageDraft?.reportVersionId === report.reportId
      ? claim.messageDraft
      : null;
  const currentDraft = draft?.reportVersionId === report.reportId ? draft : null;
  const selectedDraft =
    incomingDraft &&
    (!currentDraft || incomingDraft.revision > currentDraft.revision)
      ? incomingDraft
      : currentDraft;

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
    reviewCompleted,
    setEmail,
    setReference,
    workflowRevision: Math.max(
      preparedRevision ?? 0,
      claim.workflow?.revision ?? 1,
    ),
  };
}
