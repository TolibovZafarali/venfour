import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Download,
  Eye,
  FileText,
  LoaderCircle,
  Paperclip,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  DIMINISHED_VALUE_DOCUMENT_ACCEPT,
  validateDiminishedValueDocument,
} from "@/features/diminished-value/local-document-files";
import { useTotalLossDependencies } from "@/features/total-loss/dependencies";
import { IntakeTextareaField, IntakeTextField } from "@/features/total-loss/intake-fields";
import {
  formatCurrencyInput,
} from "@/features/total-loss/validation";
import type {
  TotalLossClaimJourneyState,
  TotalLossClaimResolver,
  TotalLossClaimSecured,
  TotalLossInsurerResponse,
  TotalLossInsurerResponseAnalysis,
  TotalLossInsurerResponseAnalysisEvidence,
  TotalLossInsurerResponseMediaType,
  TotalLossMoney,
} from "../contracts";
import {
  totalLossClaimQueryKeys,
  useTotalLossInsurerResponseAnalysisRetryMutation,
  useTotalLossInsurerResponseDownloadMutation,
  useTotalLossInsurerResponseMutation,
  useTotalLossInsurerResponseUploadPreparationMutation,
} from "../queries";
import {
  sha256Hex,
  TotalLossInsurerResponseStorageError,
} from "../insurer-response-storage-service";
import { RecordedTime } from "./completed-analysis-visuals";
import { StableActionLabel } from "./stable-action-label";
import { displayed } from "../report-format";
import { openPublishedReport, reservePublishedReportPreview } from "../browser-actions";
import { useInsurerResponseDraft } from "../use-insurer-response-draft";
import { resolvedTotalLossClaimJourneyState } from "../workflow-route";
import "./insurer-response.css";

interface InsurerResponseIdentity {
  readonly accessToken: string;
  readonly caseId: string;
  readonly claim: TotalLossClaimSecured;
  readonly onRefresh: () => Promise<unknown>;
  readonly userId: string;
}

type InsurerResponseAccess = Pick<InsurerResponseIdentity, "accessToken" | "caseId" | "userId">;

interface SelectedResponseFile {
  readonly displayFilename: string;
  readonly file: File;
  readonly mediaType: TotalLossInsurerResponseMediaType;
}

const MAX_RESPONSE_TEXT_CHARACTERS = 100_000;

function containsForbiddenResponseTextCharacter(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const forbiddenControl =
      (codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) ||
      (codePoint >= 0x7f && codePoint <= 0x9f);
    return forbiddenControl ||
      codePoint === 0x061c ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069);
  });
}

function parseResponseOffer(value: string) {
  const normalized = value.replaceAll("$", "").replaceAll(",", "").trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(normalized);
  if (!match) return null;
  const amount = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function initialOffer(response: TotalLossInsurerResponse | null) {
  const amount = response?.revisedOffer?.amountMinorUnits;
  if (!amount) return "";
  return formatCurrencyInput((amount / 100).toFixed(2));
}

function readableSize(byteSize: number) {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${Math.ceil(byteSize / 1024)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

function offerLabel(amountMinorUnits: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(amountMinorUnits / 100);
}

type InsurerResponseFormProps = InsurerResponseIdentity & {
  readonly actionContainer: HTMLElement | null;
  readonly onRecorded: (state: TotalLossClaimJourneyState) => void;
};

export function InsurerResponseForm(props: InsurerResponseFormProps) {
  return <InsurerResponseEditor
    key={`${props.userId}:${props.caseId}:${props.claim.insurerResponse?.responseId ?? "new"}`}
    {...props}
  />;
}

function InsurerResponseEditor({
  accessToken,
  actionContainer,
  caseId,
  claim,
  onRefresh,
  onRecorded,
  userId,
}: InsurerResponseFormProps) {
  const existing = claim.insurerResponse ?? null;
  const queryClient = useQueryClient();
  const dependencies = useTotalLossDependencies();
  const storage = dependencies?.totalLossInsurerResponseStorageService ?? null;
  const prepareUpload = useTotalLossInsurerResponseUploadPreparationMutation({
    accessToken,
    caseId,
    userId,
  });
  const recordResponse = useTotalLossInsurerResponseMutation({
    accessToken,
    caseId,
    userId,
  });
  const fieldId = useId();
  const responseHeading = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectionEpoch = useRef(0);
  const actionLocked = useRef(false);
  const [selectedFile, setSelectedFile] = useState<SelectedResponseFile | null>(null);
  const [validatingFile, setValidatingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const draft = useInsurerResponseDraft({
    userId,
    caseId,
    supersedesResponseId: existing?.responseId ?? null,
    initial: {
      responseText: existing?.text ?? "",
      offer: initialOffer(existing),
      retainDocument: Boolean(existing?.document),
      attachment: null,
    },
    pending: pending || validatingFile,
  });
  const { responseText, offer, retainDocument, attachment, clientRequestId } = draft.content;

  useEffect(() => () => { selectionEpoch.current += 1; }, []);

  const changed = (patch: Parameters<typeof draft.edit>[0]) => {
    draft.edit(patch);
    setError(null);
  };
  const parsedOffer = offer.trim() ? parseResponseOffer(offer) : null;
  const offerError = offer.trim() && !parsedOffer
    ? "Enter a revised offer greater than $0.00."
    : null;
  const textError = responseText.length > MAX_RESPONSE_TEXT_CHARACTERS
    ? "Keep the pasted response to 100,000 characters or fewer."
    : containsForbiddenResponseTextCharacter(responseText)
      ? "The pasted response contains unsupported hidden or control characters."
      : responseText && !responseText.trim()
        ? "The pasted response cannot contain only spaces."
        : null;
  const effectiveDocument = attachment || retainDocument && existing?.document;
  const hasMaterial = Boolean(responseText.trim() || effectiveDocument || parsedOffer);

  const selectFile = async (file: File | null) => {
    const epoch = ++selectionEpoch.current;
    if (!file) return;
    setValidatingFile(true);
    setFileError(null);
    try {
      const validation = await validateDiminishedValueDocument(file);
      if (epoch !== selectionEpoch.current) return;
      if (!validation.valid) {
        setFileError(validation.error.replace(/supporting document/giu, "insurer response file"));
        return;
      }
      const contentDigest = await sha256Hex(file);
      if (epoch !== selectionEpoch.current) return;
      setSelectedFile({
        displayFilename: validation.displayFilename,
        file,
        mediaType: validation.mimeType,
      });
      changed({
        retainDocument: false,
        attachment: {
          displayFilename: validation.displayFilename,
          mediaType: validation.mimeType,
          byteSize: file.size,
          contentDigest,
        },
      });
    } catch (caught) {
      if (epoch !== selectionEpoch.current) return;
      setFileError(caught instanceof TotalLossInsurerResponseStorageError
        ? caught.message
        : "We couldn’t check this response file. Please choose it again.");
    } finally {
      if (epoch === selectionEpoch.current) setValidatingFile(false);
    }
  };

  const submit = async () => {
    if (actionLocked.current || pending || validatingFile) return;
    const expectedWorkflowRevision = claim.workflow?.revision;
    if (!expectedWorkflowRevision) {
      setError("We couldn’t verify the current case revision. Refresh the case and try again.");
      return;
    }
    if (offerError) {
      setError(offerError);
      return;
    }
    if (textError) {
      setError(textError);
      return;
    }
    if (!hasMaterial) {
      setError("Paste the insurer’s response, add its file, or enter the revised offer.");
      return;
    }
    if (attachment && !selectedFile) {
      setError("Choose the response file again before saving, or remove it from this draft.");
      return;
    }
    if (selectedFile && !storage) {
      setError("Secure response upload is unavailable right now. Keep this page open and try again.");
      return;
    }

    actionLocked.current = true;
    setPending(true);
    setError(null);
    try {
      let documentId: string | null = null;
      if (selectedFile && storage) {
        const validation = await validateDiminishedValueDocument(selectedFile.file);
        if (!validation.valid) {
          throw new TotalLossInsurerResponseStorageError(validation.error);
        }
        const contentDigest = await sha256Hex(selectedFile.file);
        const preparation = await prepareUpload.mutateAsync({
          byteSize: selectedFile.file.size,
          clientRequestId,
          contentDigest,
          expectedWorkflowRevision,
          mediaType: validation.mimeType,
          originalFilename: validation.displayFilename,
        });
        await storage.uploadPreparedResponse({
          caseId,
          clientRequestId,
          file: selectedFile.file,
          preparation,
        });
        documentId = preparation.documentId;
      }

      const recorded = await recordResponse.mutateAsync({
        clientRequestId,
        documentId,
        expectedWorkflowRevision,
        responseText: responseText.trim() ? responseText : null,
        retainedDocumentId:
          !selectedFile && retainDocument ? existing?.document?.documentId ?? null : null,
        revisedOfferMinorUnits: parsedOffer,
        supersedesResponseId: existing?.responseId ?? null,
      });
      draft.submitted();
      await onRefresh().catch(() => undefined);
      onRecorded(recorded.state);
    } catch (caught) {
      await onRefresh().catch(() => undefined);
      const refreshedQuery = queryClient.getQueryState<TotalLossClaimResolver>(
        totalLossClaimQueryKeys.detail(userId, caseId),
      );
      const refreshed = refreshedQuery?.status === "success" ? refreshedQuery.data : null;
      if (
        refreshed?.state === "secured" && refreshed.caseId === caseId &&
        refreshed.insurerResponse?.clientRequestId === clientRequestId
      ) {
        draft.submitted();
        const resumedState = resolvedTotalLossClaimJourneyState(refreshed);
        if (resumedState) onRecorded(resumedState);
        return;
      }
      setError(
        caught instanceof TotalLossInsurerResponseStorageError
          ? caught.message.replace(/supporting document/giu, "insurer response file")
          : "We couldn’t save the insurer’s response. Your entries are still here; try again.",
      );
    } finally {
      actionLocked.current = false;
      setPending(false);
    }
  };

  const keepEditing = () => {
    if (draft.blocker.state !== "blocked") return;
    draft.blocker.reset();
    responseHeading.current?.focus({ preventScroll: true });
  };

  const disabled = pending || validatingFile;
  return (
    <section className="insurer-response-form" aria-labelledby={`${fieldId}-heading`}>
      <header className="response-heading" data-review-entrance="primary">
        <p className="response-eyebrow">{existing ? "Correct saved response" : "Insurer response"}</p>
        <h1 id={`${fieldId}-heading`} ref={responseHeading} tabIndex={-1}>Add the insurer’s response</h1>
        <p>Save what the insurer sent. Venfour will review it against the request and evidence in this case.</p>
      </header>

      {draft.blocker.state === "blocked" ? (
        <div className="response-draft-notice" role="alertdialog" aria-labelledby={`${fieldId}-leave-heading`} aria-describedby={`${fieldId}-leave-description`} onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            keepEditing();
          }
        }}>
          <h2 id={`${fieldId}-leave-heading`}>{pending ? "Your response is still saving" : "Leave this response?"}</h2>
          <p id={`${fieldId}-leave-description`}>
            {pending
              ? "Wait for saving to finish before leaving this page."
              : draft.storageError
                ? "This browser couldn’t save your draft. Leaving will discard your unsaved entries."
                : attachment
                  ? "Your text and offer are saved in this tab. Choose the file again when you return."
                  : "Your entries are saved in this tab. The response has not been submitted."}
          </p>
          <div className="response-draft-actions">
            <button autoFocus className="request-button request-button-secondary" onClick={keepEditing} type="button">Keep editing</button>
            {!pending ? <button className="request-button request-button-utility" onClick={() => draft.blocker.state === "blocked" && draft.blocker.proceed()} type="button">Leave page</button> : null}
          </div>
        </div>
      ) : null}
      {draft.storageError ? (
        <p className="response-draft-status request-error" role="alert">This browser couldn’t save your draft. Keep this page open until you submit the response.</p>
      ) : (
        <p className="response-draft-status" role="status">
          {draft.restored ? "Your unfinished response was restored. " : ""}
          {draft.dirty ? "Draft saved in this tab, not submitted. " : "Text and offer changes are saved in this tab until you submit. "}
          Files need to be chosen again after leaving or refreshing.
        </p>
      )}

      <div className="response-fields" data-review-entrance="secondary">
        <div className="response-shared-field">
          <IntakeTextareaField
            id={`${fieldId}-text`}
            label="Paste the response"
            disabled={disabled}
            error={textError || undefined}
            help="Optional if you add the original file or only received a revised offer."
            onChange={(event) => {
              changed({ responseText: event.target.value });
            }}
            placeholder="Paste the insurer’s email or written response here"
            maxLength={MAX_RESPONSE_TEXT_CHARACTERS}
            rows={9}
            value={responseText}
          />
        </div>

        <div className="response-supporting-fields">
          <section className="response-file-field" aria-labelledby={`${fieldId}-file-label`}>
            <div>
              <h2 id={`${fieldId}-file-label`}>Original response file</h2>
              <p>Optional · PDF, JPEG, PNG, HEIC, or HEIF · 10 MiB maximum</p>
            </div>
            <input
              accept={DIMINISHED_VALUE_DOCUMENT_ACCEPT}
              className="sr-only"
              disabled={disabled || !storage}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                event.target.value = "";
                void selectFile(file);
              }}
              ref={fileInput}
              type="file"
            />
            {selectedFile ? (
              <div className="response-file-selection">
                <FileText aria-hidden="true" />
                <div><strong>{selectedFile.displayFilename}</strong><span>{readableSize(selectedFile.file.size)}</span></div>
                <button disabled={disabled} onClick={() => fileInput.current?.click()} type="button"><RotateCcw aria-hidden="true" />Replace</button>
                {existing?.document ? <button disabled={disabled} onClick={() => {
                  setSelectedFile(null);
                  changed({ retainDocument: true, attachment: null });
                }} type="button">Keep saved file</button> : <button disabled={disabled} onClick={() => {
                  setSelectedFile(null);
                  changed({ attachment: null });
                }} type="button"><Trash2 aria-hidden="true" />Remove</button>}
              </div>
            ) : attachment ? (
              <div className="response-file-selection">
                <FileText aria-hidden="true" />
                <div><strong>{attachment.displayFilename}</strong><span>Choose this file again before saving, or remove it.</span></div>
                <button disabled={disabled || !storage} onClick={() => fileInput.current?.click()} type="button"><Upload aria-hidden="true" />Choose file again</button>
                <button disabled={disabled} onClick={() => changed({ attachment: null })} type="button"><Trash2 aria-hidden="true" />Remove</button>
                {existing?.document ? <button disabled={disabled} onClick={() => changed({ attachment: null, retainDocument: true })} type="button">Keep saved file</button> : null}
              </div>
            ) : existing?.document && retainDocument ? (
              <div className="response-file-selection">
                <FileText aria-hidden="true" />
                <div><strong>{existing.document.originalFilename}</strong><span>{readableSize(existing.document.byteSize)} · Saved with the current response</span></div>
                <button disabled={disabled || !storage} onClick={() => fileInput.current?.click()} type="button"><RotateCcw aria-hidden="true" />Replace</button>
                <button disabled={disabled} onClick={() => {
                  changed({ retainDocument: false });
                }} type="button"><Trash2 aria-hidden="true" />Remove</button>
              </div>
            ) : (
              <button className="response-file-picker" disabled={disabled || !storage} onClick={() => fileInput.current?.click()} type="button">
                {validatingFile ? <LoaderCircle className="request-spinner" aria-hidden="true" /> : <Upload aria-hidden="true" />}
                {validatingFile ? "Checking file…" : existing?.document ? "Choose replacement file" : "Choose response file"}
              </button>
            )}
            {!storage ? <p className="response-field-note">Secure file upload is temporarily unavailable. You can still save pasted text or a revised offer.</p> : null}
            {fileError ? <p className="request-error" role="alert">{fileError}</p> : null}
          </section>

          <div className="response-shared-field response-offer-field">
            <IntakeTextField
              label="Revised offer"
              optional
              autoComplete="off"
              disabled={disabled}
              error={offerError || undefined}
              help="Enter the insurer’s new dollar amount only if one was included."
              helpAfterInput
              id={`${fieldId}-offer`}
              inputMode="decimal"
              onChange={(event) => {
                changed({ offer: formatCurrencyInput(event.target.value) });
              }}
              placeholder="$0.00"
              value={formatCurrencyInput(offer)}
            />
          </div>
        </div>
      </div>

      {error ? <p className="response-submit-error request-error" role="alert">{error}</p> : null}
      {actionContainer ? createPortal(
        <button className="review-primary" disabled={disabled} onClick={() => void submit()} type="button">
          <StableActionLabel reserve="Saving response…">{pending ? "Saving response…" : existing ? "Save corrected response" : "Save response"}</StableActionLabel>
          {pending ? <LoaderCircle className="request-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
        </button>,
        actionContainer,
      ) : null}
    </section>
  );
}

function SavedResponseOriginal({
  accessToken,
  caseId,
  responseId,
  userId,
}: InsurerResponseAccess & { readonly responseId: string }) {
  const download = useTotalLossInsurerResponseDownloadMutation({ accessToken, caseId, userId });
  const locked = useRef(false);
  const [pendingAction, setPendingAction] = useState<"view" | "download" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (preview: boolean) => {
    if (locked.current) return;
    locked.current = true;
    const previewWindow = preview ? reservePublishedReportPreview() : null;
    setPendingAction(preview ? "view" : "download");
    setError(null);
    try {
      const original = await download.mutateAsync({ responseId });
      openPublishedReport(original.downloadUrl, original.suggestedFilename, preview, previewWindow);
    } catch {
      previewWindow?.close();
      setError(`We couldn’t ${preview ? "open" : "download"} the original response file. Please try again.`);
    } finally {
      locked.current = false;
      setPendingAction(null);
    }
  };

  return <div className="response-original-actions">
    <button className="request-button request-button-secondary" disabled={pendingAction !== null} onClick={() => void open(true)} type="button">
      {pendingAction === "view" ? <LoaderCircle className="request-spinner" aria-hidden="true" /> : <Eye aria-hidden="true" />}
      <StableActionLabel reserve="Opening original…">{pendingAction === "view" ? "Opening original…" : "View original"}</StableActionLabel>
    </button>
    <button className="request-button request-button-utility" disabled={pendingAction !== null} onClick={() => void open(false)} type="button">
      {pendingAction === "download" ? <LoaderCircle className="request-spinner" aria-hidden="true" /> : <Download aria-hidden="true" />}
      <StableActionLabel reserve="Preparing original…">{pendingAction === "download" ? "Preparing original…" : "Download original"}</StableActionLabel>
    </button>
    {error ? <p className="request-error" role="alert">{error}</p> : null}
  </div>;
}

function SavedResponseMaterial({
  accessToken,
  caseId,
  response,
  userId,
}: InsurerResponseAccess & {
  readonly response: TotalLossInsurerResponse;
}) {
  return (
    <dl className="response-summary">
      {response.text ? (
        <div>
          <dt>Written response</dt>
          <dd className="response-summary-text">{response.text}</dd>
        </div>
      ) : null}
      {response.document ? (
        <div>
          <dt>Original file</dt>
          <dd className="response-summary-file">
            <Paperclip aria-hidden="true" />
            <strong>{response.document.originalFilename}</strong>
            <span>{readableSize(response.document.byteSize)}</span>
            <SavedResponseOriginal key={response.responseId} accessToken={accessToken} caseId={caseId} responseId={response.responseId} userId={userId} />
          </dd>
        </div>
      ) : null}
      {response.revisedOffer ? (
        <div>
          <dt>Revised offer you entered</dt>
          <dd>
            <strong>
              {offerLabel(
                response.revisedOffer.amountMinorUnits,
                response.revisedOffer.currency,
              )}
            </strong>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function CorrectionAction({ onCorrect }: { readonly onCorrect: () => void }) {
  return (
    <div className="response-received-actions">
      <p>
        If you saved the wrong text, file, or offer, you can add a corrected
        version. The prior version remains in the case history.
      </p>
      <button
        className="request-button request-button-secondary"
        onClick={onCorrect}
        type="button"
      >
        <RotateCcw aria-hidden="true" />
        Correct this response
      </button>
    </div>
  );
}

export function InsurerResponseReceived({
  accessToken,
  caseId,
  response,
  onCorrect,
  userId,
}: InsurerResponseAccess & {
  readonly onCorrect: () => void;
  readonly response: TotalLossInsurerResponse;
}) {
  return (
    <section
      className="insurer-response-received"
      aria-labelledby="insurer-response-received-heading"
    >
      <p className="waiting-case-status" data-review-entrance="supporting">
        <span aria-hidden="true" />
        Response received
      </p>
      <div className="response-heading" data-review-entrance="primary">
        <h1 id="insurer-response-received-heading">
          The insurer’s response is saved
        </h1>
        <p className="review-lead" role="status">
          {response.processingState === "pending"
            ? "It is now part of this case. Venfour is preparing to review it against the evidence already saved here."
            : "The response you recorded remains part of this case."}
        </p>
      </div>
      <p className="sent-recorded" data-review-entrance="supporting">
        Response recorded: <RecordedTime value={response.receivedAt} />
      </p>
      <div data-review-entrance="secondary">
        <SavedResponseMaterial accessToken={accessToken} caseId={caseId} response={response} userId={userId} />
      </div>
      <div data-review-entrance="supporting">
        <CorrectionAction onCorrect={onCorrect} />
      </div>
    </section>
  );
}

function confidenceLabel(
  confidence: TotalLossInsurerResponseAnalysis["confidence"],
) {
  return confidence === "HIGH"
    ? "High confidence"
    : confidence === "MEDIUM"
      ? "Moderate confidence"
      : "Limited confidence";
}

function dispositionLabel(
  disposition: TotalLossInsurerResponseAnalysis["requestDisposition"]["category"],
) {
  switch (disposition) {
    case "ACCEPTED":
      return "Accepted";
    case "PARTIALLY_ACCEPTED":
      return "Partially accepted";
    case "REJECTED":
      return "Rejected";
    case "MORE_INFORMATION_REQUESTED":
      return "More information requested";
    case "UNCLEAR":
      return "Unclear";
  }
}

function responsePointLabel(
  disposition: TotalLossInsurerResponseAnalysis["responsePoints"][number]["disposition"],
) {
  switch (disposition) {
    case "ACCEPTED":
      return "Accepted";
    case "REJECTED":
      return "Rejected";
    case "QUESTIONED":
      return "Questioned";
    case "IGNORED":
      return "Not addressed";
    case "UNRESOLVED":
      return "Unresolved";
    case "UNCLEAR":
      return "Unclear";
  }
}

function recommendationLabel(
  category: TotalLossInsurerResponseAnalysis["recommendedNextStep"]["category"],
) {
  switch (category) {
    case "REVIEW_REVISED_OFFER":
      return "Review their revised offer";
    case "MORE_INFORMATION_MAY_BE_NEEDED":
      return "More information may be needed";
    case "FOLLOW_UP_APPEARS_WARRANTED":
      return "A follow-up appears warranted";
    case "VALUATION_ISSUE_APPEARS_RESOLVED":
      return "The valuation issue appears resolved";
    case "REVIEW_RESPONSE":
      return "Review the insurer’s response";
  }
}

function BasisReferences({
  caseEvidenceRefs,
  evidence,
  responseEvidenceRefs,
}: {
  readonly caseEvidenceRefs?: readonly string[];
  readonly evidence: TotalLossInsurerResponseAnalysisEvidence;
  readonly responseEvidenceRefs?: readonly string[];
}) {
  const caseCount = caseEvidenceRefs?.length ?? 0;
  const responseItems = (responseEvidenceRefs ?? []).map((reference) =>
    evidence.responseEvidence.find((item) => item.evidenceRef === reference),
  ).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const caseItems = (caseEvidenceRefs ?? []).map((reference) =>
    evidence.caseEvidence.find((item) => item.evidenceRef === reference),
  ).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const customerSuppliedCount = responseItems.filter(
    (item) => item.sourceType === "CUSTOMER_SUPPLIED_OFFER",
  ).length;
  const insurerResponseCount = responseItems.length - customerSuppliedCount;
  if (!responseItems.length && !caseCount) return null;
  const parts = [
    insurerResponseCount
      ? `${insurerResponseCount} ${insurerResponseCount === 1 ? "part" : "parts"} of the insurer response`
      : null,
    customerSuppliedCount
      ? customerSuppliedCount === 1
        ? "the revised-offer amount you recorded"
        : `${customerSuppliedCount} revised-offer amounts you recorded`
      : null,
    caseCount
      ? `${caseCount} ${caseCount === 1 ? "item" : "items"} in the existing case evidence`
      : null,
  ].filter((part): part is string => Boolean(part));
  const excerpt = (value: string) =>
    value.length > 360 ? `${value.slice(0, 357).trimEnd()}…` : value;
  return (
    <details className="response-analysis-basis">
      <summary>
        Basis: {new Intl.ListFormat("en-US", { type: "conjunction" }).format(parts)}
      </summary>
      <ul aria-label="Supporting evidence">
        {responseItems.map((item) => (
          <li key={item.evidenceRef}>
            <strong>
              {item.sourceType === "PASTED_TEXT"
                ? "Insurer response"
                : item.sourceType === "DOCUMENT_TEXT"
                  ? `Insurer document${item.pageNumber ? `, page ${item.pageNumber}` : ""}`
                  : item.sourceType === "CUSTOMER_SUPPLIED_OFFER"
                    ? "Amount you recorded"
                    : "Uploaded insurer document"}
            </strong>
            <span>
              {item.content
                ? `“${excerpt(item.content)}”`
                : item.sourceType === "CUSTOMER_SUPPLIED_OFFER"
                  ? "The revised-offer amount entered with this response."
                  : "The uploaded document was interpreted as a visual source."}
            </span>
          </li>
        ))}
        {caseItems.map((item) => (
          <li key={item.evidenceRef}>
            <strong>
              {item.evidenceType === "CUSTOMER_REQUEST"
                ? "Your request"
                : item.evidenceType === "INSURER_VALUATION"
                  ? "Saved insurer valuation"
                  : item.evidenceType === "VENFOUR_COMPARABLE"
                    ? "Saved comparable evidence"
                    : "Saved case evidence"}
            </strong>
            <span>{excerpt(item.summary)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function analysisOfferSourceLabel(
  offer: TotalLossInsurerResponseAnalysis["revisedOffer"],
) {
  if (offer.visualSourceInterpretation) {
    return offer.source === "BOTH"
      ? "Amount derived from the insurer document and matched to your entry"
      : "Amount derived from the insurer document";
  }
  switch (offer.source) {
    case "CUSTOMER_SUPPLIED":
      return "Amount you entered";
    case "INSURER_RESPONSE":
      return "Amount identified in the insurer response";
    case "BOTH":
      return "Amount supported by the response and your entry";
    case null:
      return "Revised offer";
  }
}

function supportedPriorValue(
  value: TotalLossMoney,
  currency: string | null,
) {
  if (
    value.amountMinorUnits === null ||
    !Number.isSafeInteger(value.amountMinorUnits) ||
    !displayed(value.formatted, "") ||
    value.currency !== currency
  ) {
    return null;
  }
  return value.formatted;
}

export function InsurerResponseReviewing({
  accessToken,
  caseId,
  claim,
  onCorrect,
  onRefresh,
  response,
  userId,
}: InsurerResponseIdentity & {
  readonly onCorrect: () => void;
  readonly response: TotalLossInsurerResponse;
}) {
  const retry = useTotalLossInsurerResponseAnalysisRetryMutation({
    accessToken,
    caseId,
    userId,
  });
  const [retryError, setRetryError] = useState<string | null>(null);
  const processing =
    response.processingState === "pending" ||
    response.processingState === "processing";
  const retryable = response.processingState === "retryable_failed";
  const unsupported = response.processingState === "unsupported";
  const unreadable = response.failureReason === "unreadable_document";

  const retryReview = async () => {
    if (!claim.workflow || retry.isPending) return;
    setRetryError(null);
    try {
      await retry.mutateAsync({
        clientRequestId: globalThis.crypto.randomUUID(),
        expectedWorkflowRevision: claim.workflow.revision,
      });
      await onRefresh().catch(() => undefined);
    } catch {
      await onRefresh().catch(() => undefined);
      setRetryError(
        "We couldn’t restart the review. The saved response has not changed; try again.",
      );
    }
  };

  return (
    <section
      className="insurer-response-reviewing"
      aria-labelledby="insurer-response-reviewing-heading"
    >
      <p className="waiting-case-status" data-review-entrance="supporting">
        <span aria-hidden="true" />
        {processing ? "Reviewing response" : "Response review"}
      </p>
      <div className="response-review-status" data-review-entrance="primary">
        <div
          className="response-review-status-mark"
          data-state={processing ? "processing" : "attention"}
          aria-hidden="true"
        >
          {processing ? (
            <ScanSearch />
          ) : (
            <CircleAlert />
          )}
        </div>
        <div>
          <h1 id="insurer-response-reviewing-heading">
            {processing
              ? "Venfour is reviewing the insurer’s response"
              : unsupported
                ? "This response could not be fully reviewed"
                : unreadable
                  ? "This document could not be reviewed"
                  : "The response review could not be completed"}
          </h1>
          <p className="review-lead" role="status">
            {processing
              ? "Venfour is comparing what the insurer said with the request, valuation, and evidence already saved in this case."
              : unsupported
                ? "Venfour could not reliably interpret the submitted material. The original response remains saved, and no case evidence or valuation has changed."
                : unreadable
                  ? "Venfour could not reliably read and analyze the submitted document. The original response remains saved, and no case evidence or valuation has changed."
                  : retryable
                    ? "The review stopped before an explanation could be completed. The original response remains saved, and you can try the review again."
                    : "Venfour could not complete a reliable explanation. The original response remains saved, and no case evidence or valuation has changed."}
          </p>
        </div>
      </div>
      <p className="sent-recorded" data-review-entrance="supporting">
        Response recorded: <RecordedTime value={response.receivedAt} />
      </p>
      {retryable ? (
        <div className="response-review-retry" data-review-entrance="secondary">
          {retryError ? (
            <p className="request-error" role="alert">
              {retryError}
            </p>
          ) : null}
          <button
            className="request-button request-button-primary"
            disabled={retry.isPending}
            onClick={() => void retryReview()}
            type="button"
          >
            {retry.isPending ? (
              <LoaderCircle className="request-spinner" aria-hidden="true" />
            ) : (
              <RefreshCw aria-hidden="true" />
            )}
            {retry.isPending ? "Restarting review…" : "Try review again"}
          </button>
        </div>
      ) : null}
      <details className="response-original-material" data-review-entrance="secondary">
        <summary>View the saved insurer response</summary>
        <SavedResponseMaterial accessToken={accessToken} caseId={caseId} response={response} userId={userId} />
      </details>
      <div data-review-entrance="supporting">
        <CorrectionAction onCorrect={onCorrect} />
      </div>
      <p className="response-analysis-disclosure" data-review-entrance="supporting">
        This step interprets the insurer response using evidence already in the
        case. It does not recalculate the vehicle’s value, change the published
        report, or send a reply.
      </p>
    </section>
  );
}

export function InsurerResponseReviewed({
  accessToken,
  caseId,
  onCorrect,
  priorValuation,
  response,
  userId,
}: InsurerResponseAccess & {
  readonly onCorrect: () => void;
  readonly priorValuation: TotalLossMoney;
  readonly response: TotalLossInsurerResponse & {
    readonly analysis: TotalLossInsurerResponseAnalysis;
    readonly analysisEvidence: TotalLossInsurerResponseAnalysisEvidence;
  };
}) {
  const { analysis, analysisEvidence } = response;
  const newOffer = analysis.revisedOffer;
  const priorOffer = supportedPriorValue(priorValuation, newOffer.currency);
  const hasOffer =
    newOffer.status === "PRESENT" &&
    newOffer.amountMinorUnits !== null &&
    newOffer.currency !== null;
  const partialDocument =
    analysis.inputCoverage.document === "UNREADABLE" ||
    analysis.inputCoverage.document === "UNSUPPORTED";

  return (
    <section
      className="insurer-response-reviewed"
      aria-labelledby="insurer-response-reviewed-heading"
    >
      <p className="waiting-case-status" data-review-entrance="supporting">
        <span aria-hidden="true" />
        Response reviewed
      </p>
      <div className="response-reviewed-heading" data-review-entrance="primary">
        <div className="response-review-status-mark" data-state="complete" aria-hidden="true">
          <CheckCircle2 />
        </div>
        <div>
          <h1 id="insurer-response-reviewed-heading">
            What the insurer’s response means
          </h1>
          <p className="review-lead">
            Venfour reviewed the saved response in the context of the request,
            valuation, and evidence already in this case.
          </p>
        </div>
      </div>

      <section className="response-analysis-section" data-review-entrance="secondary">
        <h2>Insurer’s response</h2>
        <div className="response-analysis-summary">
          <div>
            <h3>What the insurer said</h3>
            <p>{analysis.analysisSummary.whatInsurerSaid}</p>
          </div>
          <div>
            <h3>What this means for your case</h3>
            <p>{analysis.analysisSummary.whatThisMeans}</p>
          </div>
        </div>
        <BasisReferences
          evidence={analysisEvidence}
          {...analysis.analysisSummary}
        />
      </section>

      <section className="response-analysis-section" data-review-entrance="secondary">
        <h2>What changed</h2>
        {hasOffer ? (
          <dl className="response-offer-change">
            {priorOffer ? (
              <div>
                <dt>Previous insurer valuation</dt>
                <dd>{priorOffer}</dd>
              </div>
            ) : null}
            <div>
              <dt>{analysisOfferSourceLabel(newOffer)}</dt>
              <dd>
                {offerLabel(newOffer.amountMinorUnits!, newOffer.currency!)}
              </dd>
            </div>
          </dl>
        ) : null}
        {newOffer.visualSourceInterpretation ? (
          <div className="response-visual-transcription">
            <strong>Derived visual transcription</strong>
            <p>“{newOffer.visualSourceInterpretation.derivedText}”</p>
            <small>
              This text was derived from a visual reading. It does not replace
              the saved insurer document, which remains the authoritative
              source. Check the original before relying on the amount.
            </small>
          </div>
        ) : null}
        {analysis.importantChanges.length ? (
          <ul className="response-analysis-list">
            {analysis.importantChanges.map((change, index) => (
              <li key={`${index}:${change.description}`}>
                <p>{change.description}</p>
                <BasisReferences evidence={analysisEvidence} {...change} />
              </li>
            ))}
          </ul>
        ) : (
          <p>{analysis.insurerPosition.summary}</p>
        )}
        {hasOffer ? (
          <BasisReferences
            evidence={analysisEvidence}
            responseEvidenceRefs={newOffer.responseEvidenceRefs}
          />
        ) : null}
      </section>

      <section className="response-analysis-section" data-review-entrance="secondary">
        <h2>How they responded</h2>
        <p className="response-disposition">
          <span>{dispositionLabel(analysis.requestDisposition.category)}</span>
          {analysis.requestDisposition.summary}
        </p>
        <BasisReferences evidence={analysisEvidence} {...analysis.requestDisposition} />
        {analysis.responsePoints.length ? (
          <div className="response-points">
            {analysis.responsePoints.map((point, index) => (
              <article key={`${index}:${point.topic}`}>
                <header>
                  <h3>{point.topic}</h3>
                  <span>{responsePointLabel(point.disposition)}</span>
                </header>
                <dl>
                  <div>
                    <dt>What the insurer said</dt>
                    <dd>{point.whatInsurerSaid}</dd>
                  </div>
                  <div>
                    <dt>What this means</dt>
                    <dd>{point.whatThisMeans}</dd>
                  </div>
                </dl>
                <BasisReferences evidence={analysisEvidence} {...point} />
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="response-analysis-section" data-review-entrance="secondary">
        <h2>What matters</h2>
        {analysis.insurerArguments.length ? (
          <div className="response-arguments">
            {analysis.insurerArguments.map((argument, index) => (
              <article key={`${index}:${argument.argument}`}>
                <h3>{argument.argument}</h3>
                <p>{argument.whatItReliesOn}</p>
                <BasisReferences evidence={analysisEvidence} {...argument} />
              </article>
            ))}
          </div>
        ) : (
          <p>{analysis.insurerPosition.summary}</p>
        )}
        {analysis.unresolvedIssues.length ? (
          <div className="response-unresolved">
            <h3>Still unresolved</h3>
            <ul>
              {analysis.unresolvedIssues.map((issue, index) => (
                <li key={`${index}:${issue.description}`}>
                  <p>{issue.description}</p>
                  <BasisReferences evidence={analysisEvidence} {...issue} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="response-analysis-section response-recommendation" data-review-entrance="primary">
        <h2>Recommended next step</h2>
        <strong>
          {recommendationLabel(analysis.recommendedNextStep.category)}
        </strong>
        <p>{analysis.recommendedNextStep.explanation}</p>
        <BasisReferences evidence={analysisEvidence} {...analysis.recommendedNextStep} />
      </section>

      <section className="response-analysis-foundation" data-review-entrance="supporting">
        <h2>What this explanation is based on</h2>
        <p>
          This explanation uses the insurer response and the valuation evidence
          already saved in this case. It does not recalculate the vehicle’s
          value or change the published report.
        </p>
        <p>{confidenceLabel(analysis.confidence)} based on the available material.</p>
        {partialDocument ? (
          <p>
            Venfour could not reliably interpret the submitted document. The
            explanation uses only the other response material that was available.
          </p>
        ) : null}
        {analysis.inputCoverage.limitations.length ? (
          <ul>
            {analysis.inputCoverage.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        ) : null}
        {analysis.uncertainties.length ? (
          <div className="response-uncertainties">
            <h3>Uncertainty to keep in mind</h3>
            <ul>
              {analysis.uncertainties.map((uncertainty, index) => (
                <li key={`${index}:${uncertainty.description}`}>
                  {uncertainty.description}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <details className="response-original-material" data-review-entrance="supporting">
        <summary>View the saved insurer response</summary>
        <SavedResponseMaterial accessToken={accessToken} caseId={caseId} response={response} userId={userId} />
      </details>
      <div data-review-entrance="supporting">
        <CorrectionAction onCorrect={onCorrect} />
      </div>
    </section>
  );
}
