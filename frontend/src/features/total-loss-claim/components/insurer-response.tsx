import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Download,
  Eye,
  FileText,
  LoaderCircle,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";

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
  TotalLossResponseDecision,
  TotalLossResponseDecisionChoice,
  TotalLossResponseDecisionInput,
  TotalLossResponseRecommendation,
} from "../contracts";
import {
  totalLossClaimQueryKeys,
  useTotalLossInsurerResponseAnalysisRetryMutation,
  useTotalLossInsurerResponseDownloadMutation,
  useTotalLossInsurerResponseDecisionMutation,
  useTotalLossInsurerResponseMutation,
  useTotalLossInsurerResponseUploadPreparationMutation,
} from "../queries";
import {
  sha256Hex,
  TotalLossInsurerResponseStorageError,
} from "../insurer-response-storage-service";
import { RecordedTime } from "./completed-analysis-visuals";
import { totalLossClaimViewPath } from "../workflow-route";
import { StableActionLabel } from "./stable-action-label";
import { displayed } from "../report-format";
import { openPublishedReport, reservePublishedReportPreview } from "../browser-actions";
import { useInsurerResponseDraft } from "../use-insurer-response-draft";
import { resolvedTotalLossClaimJourneyState } from "../workflow-route";
import { clearResponseDecisionAttempt, readResponseDecisionAttempt, responseDecisionAttemptKey, writeResponseDecisionAttempt } from "../response-decision-attempt";
import { insurerOfferProvenanceLabel } from "../resolution";
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
  readonly onRecorded?: (state: TotalLossClaimJourneyState) => void;
  readonly onRecordAttempt?: (clientRequestId: string) => void;
  readonly correction?: TotalLossInsurerResponse | null;
  readonly inline?: boolean;
};

export function InsurerResponseForm(props: InsurerResponseFormProps) {
  return <InsurerResponseEditor
    key={`${props.userId}:${props.caseId}:${props.claim.responseIntake?.negotiationRoundId ?? props.correction?.negotiationRoundId}:${props.claim.responseIntake?.outboundCommunicationId ?? props.correction?.outboundCommunicationId}:${props.correction?.responseId ?? "new"}`}
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
  onRecordAttempt,
  correction,
  inline = false,
  userId,
}: InsurerResponseFormProps) {
  const existing = correction ?? null;
  const outboundCommunicationId = existing?.outboundCommunicationId ?? claim.responseIntake?.outboundCommunicationId;
  const negotiationRoundId = existing?.negotiationRoundId ?? claim.responseIntake?.negotiationRoundId;
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
    negotiationRoundId: negotiationRoundId ?? "unavailable",
    outboundCommunicationId: outboundCommunicationId ?? "unavailable",
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
  useEffect(() => {
    if (inline) responseHeading.current?.focus({ preventScroll: true });
  }, [inline]);

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
    if (!expectedWorkflowRevision || !outboundCommunicationId || !negotiationRoundId) {
      setError("We couldn’t confirm that this case is ready to save the response. Refresh the case and try again.");
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
          outboundCommunicationId,
          supersedesResponseId: existing?.responseId ?? null,
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

      onRecordAttempt?.(clientRequestId);
      const recorded = await recordResponse.mutateAsync({
        clientRequestId,
        documentId,
        expectedWorkflowRevision,
        outboundCommunicationId,
        responseText: responseText.trim() ? responseText : null,
        retainedDocumentId:
          !selectedFile && retainDocument ? existing?.document?.documentId ?? null : null,
        revisedOfferMinorUnits: parsedOffer,
        supersedesResponseId: existing?.responseId ?? null,
      });
      draft.submitted();
      await onRefresh().catch(() => undefined);
      onRecorded?.(recorded.state);
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
        if (resumedState) onRecorded?.(resumedState);
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
  const saveAction = <button className={inline ? "request-button request-button-primary" : "review-primary"} disabled={disabled} onClick={() => void submit()} type="button">
    <StableActionLabel reserve="Saving response…">{pending ? "Saving response…" : existing ? "Save corrected response" : "Save response"}</StableActionLabel>
    {pending ? <LoaderCircle className="request-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
  </button>;
  return (
    <section className="insurer-response-form" data-inline={inline || undefined} aria-labelledby={`${fieldId}-heading`}>
      {inline ? <h3 className="sr-only" id={`${fieldId}-heading`} ref={responseHeading} tabIndex={-1}>Response details</h3> : <header className="response-heading" data-review-entrance="primary">
        <p className="response-eyebrow">{existing ? "Correct saved response" : "Insurer response"}</p>
        <h1 id={`${fieldId}-heading`} ref={responseHeading} tabIndex={-1}>Add the insurer’s response</h1>
        <p>Save what the insurer sent. Venfour will review it against the request and evidence in this case.</p>
      </header>}

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

      <div className="response-fields" data-review-entrance={inline ? undefined : "secondary"}>
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
      {inline ? <div className="message-local-actions">{saveAction}</div> : actionContainer ? createPortal(saveAction, actionContainer) : null}
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

function CorrectionAction({ onCorrect }: { readonly onCorrect?: () => void }) {
  if (!onCorrect) return null;
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
        Correct response
      </button>
    </div>
  );
}

function ResponseReviewHeading({ headingId, onCorrect }: { readonly headingId: string; readonly onCorrect?: () => void }) {
  return <header className="response-review-heading" data-review-entrance="primary">
    <div className="response-review-title-row">
      <h1 id={headingId}>Your response review</h1>
      {onCorrect ? <button className="request-button request-button-utility" onClick={onCorrect} type="button">
        <RotateCcw aria-hidden="true" />Correct response
      </button> : null}
    </div>
    <p className="review-lead">Understand the insurer’s reply and choose what to do next.</p>
  </header>;
}

function ResponseReviewProgress({ headingId, onCorrect, pending }: {
  readonly onCorrect?: () => void;
  readonly headingId: string;
  readonly pending: boolean;
}) {
  return <>
    <ResponseReviewHeading headingId={headingId} onCorrect={onCorrect} />
    <div className="response-review-state-panel" data-review-entrance="secondary" role="status">
      <LoaderCircle className="request-spinner" aria-hidden="true" />
      <div>
        <h2>{pending ? "Your response is saved" : "Reviewing the insurer’s reply"}</h2>
        <p>{pending ? "The review will begin automatically."
          : "We’re comparing their reply with your request and the evidence saved in your case."}</p>
        <p className="response-state-note">You can leave this page and return later. Your review will appear here when it’s ready.</p>
      </div>
    </div>
  </>;
}

export function InsurerResponseReceived({
  accessToken,
  caseId,
  response,
  onCorrect,
  userId,
  showReviewProgress = false,
}: InsurerResponseAccess & {
  readonly onCorrect?: () => void;
  readonly response: TotalLossInsurerResponse;
  readonly showReviewProgress?: boolean;
}) {
  if (showReviewProgress) return <section className="insurer-response-received" aria-labelledby="insurer-response-received-heading">
    <ResponseReviewProgress headingId="insurer-response-received-heading" pending={response.processingState === "pending"} onCorrect={onCorrect} />
  </section>;
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
          The response you recorded remains part of this case.
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
  category: TotalLossResponseRecommendation["state"],
) {
  switch (category) {
    case "ACCEPT_OFFER": return "Accept this offer";
    case "CONTINUE_CHALLENGING": return "Ask the insurer to reconsider";
    case "NO_CLEAR_RECOMMENDATION": return "No clear recommendation";
  }
}

function ResponseDecisionArea({ accessToken, actionContainer, caseId, claim, onContinue, onDecisionAttempt, onRefresh, response, userId, readOnly = false }: InsurerResponseIdentity & {
  readonly response: TotalLossInsurerResponse & { readonly recommendation: TotalLossResponseRecommendation };
  readonly readOnly?: boolean;
  readonly actionContainer: HTMLElement | null;
  readonly onDecisionAttempt: (clientRequestId: string) => void;
  readonly onContinue: () => void;
}) {
  const { recommendation, usableOffer } = response;
  const key = responseDecisionAttemptKey(userId, caseId, response.responseId, recommendation.recommendationId);
  const queryClient = useQueryClient();
  const mutation = useTotalLossInsurerResponseDecisionMutation({ accessToken, caseId, userId, responseId: response.responseId });
  const [attempt, setAttempt] = useState(() => readOnly || response.decision ? null : readResponseDecisionAttempt(key, recommendation.recommendationId, usableOffer));
  const attemptRef = useRef(attempt);
  const [selection, setSelection] = useState<TotalLossResponseDecisionChoice | null>(attempt?.choice ?? null);
  const choiceId = useId();
  const [acknowledged, setAcknowledged] = useState<TotalLossResponseDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const locked = useRef(false);
  const confirmed = useRef(Boolean(response.decision));
  const decision = response.decision ?? acknowledged;
  const decisionId = decision?.decisionId;
  const continuationFocused = useRef(false);

  useEffect(() => {
    if (!decisionId || !attemptRef.current || !actionContainer || continuationFocused.current) return;
    const next = actionContainer.querySelector<HTMLAnchorElement>(".review-primary");
    if (next) {
      continuationFocused.current = true;
      next.focus({ preventScroll: true });
    }
  }, [actionContainer, decisionId]);

  useEffect(() => {
    if (readOnly || !response.decision) return;
    confirmed.current = true;
    clearResponseDecisionAttempt(key);
  }, [key, readOnly, response.decision]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (confirmed.current || !attemptRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const confirm = (saved: TotalLossResponseDecision) => {
    confirmed.current = true;
    clearResponseDecisionAttempt(key);
    setAcknowledged(saved);
    setError(null);
  };

  const choose = async (choice: TotalLossResponseDecisionChoice) => {
    if (readOnly || locked.current || decision || (attemptRef.current && attemptRef.current.choice !== choice)) return;
    if (!claim.workflow || (choice === "ACCEPT_OFFER" && !usableOffer)) return;
    const input: TotalLossResponseDecisionInput = {
      ...(attemptRef.current ?? {
        clientRequestId: globalThis.crypto.randomUUID(),
        recommendationId: recommendation.recommendationId,
        choice,
        offerId: choice === "ACCEPT_OFFER" ? usableOffer!.offerId : null,
      }),
      workflowRevision: claim.workflow.revision,
    };
    attemptRef.current = input;
    setAttempt(input);
    setStorageUnavailable(!writeResponseDecisionAttempt(key, input));
    locked.current = true;
    setPending(true);
    setError(null);
    try {
      onDecisionAttempt(input.clientRequestId);
      const result = await mutation.mutateAsync(input);
      if (!result.response.decision) throw new Error("The saved choice could not be verified.");
      confirm(result.response.decision);
      queryClient.setQueryData<TotalLossClaimResolver>(totalLossClaimQueryKeys.detail(userId, caseId), (current) => {
        if (current?.state !== "secured" || current.caseId !== caseId ||
          current.insurerResponse?.responseId !== response.responseId ||
          current.insurerResponse.recommendation?.recommendationId !== recommendation.recommendationId ||
          !current.workflow || current.workflow.revision > result.workflowRevision) return current;
        return { ...current, insurerResponse: result.response, workflow: { ...current.workflow, revision: result.workflowRevision } };
      });
      await onRefresh().catch(() => undefined);
    } catch {
      await onRefresh().catch(() => undefined);
      const refreshed = queryClient.getQueryState<TotalLossClaimResolver>(totalLossClaimQueryKeys.detail(userId, caseId));
      const current = refreshed?.status === "success" ? refreshed.data : null;
      const saved = current?.state === "secured" && current.caseId === caseId &&
        current.insurerResponse?.responseId === response.responseId &&
        current.insurerResponse.recommendation?.recommendationId === recommendation.recommendationId
        ? current.insurerResponse.decision : null;
      if (saved) confirm(saved);
      else setError("We couldn’t confirm that your choice was saved. Retry the same choice; your response and recommendation have not changed.");
    } finally {
      locked.current = false;
      setPending(false);
    }
  };

  const nextLabel = decision?.choice === "ACCEPT_OFFER" ? "Review acceptance steps"
    : claim.followUp?.state === "sent" ? "View sent follow-up" : claim.followUp?.draft ? "Review my follow-up" : "Prepare my follow-up";
  return (
    <div className="response-decision">
      {decision ? <div className="response-decision-recorded" role="status">
        <CheckCircle2 aria-hidden="true" />
        <div>
          <strong>Choice saved</strong>
          <p>{decision.choice === "ACCEPT_OFFER"
            ? `You chose to accept ${offerLabel(decision.amountMinorUnits!, decision.currency!)}.`
            : "You chose to ask the insurer to reconsider."}</p>
          <p>Recorded <RecordedTime value={decision.recordedAt} />.</p>
          <p>{decision.choice === "ACCEPT_OFFER"
            ? `${insurerOfferProvenanceLabel(usableOffer!.source)}. ${readOnly ? "This saved choice applies to the exact offer in this response. Your current case step is shown above." : "Your case is still open. Nothing has been sent to the insurer. Next, review the steps to accept this offer."}`
            : readOnly ? "This decision is preserved with this saved response. Any resulting follow-up is available in case history."
              : claim.followUp?.state === "sent" ? "You confirmed sending your follow-up. Your case remains open while you wait for the insurer."
                : "Nothing has been sent to the insurer. Next, prepare a follow-up using your saved evidence."}</p>
        </div>
      </div> : readOnly ? <p>No decision was recorded for this saved response version.</p> : <>
        <p>Choose what you want to do. Saving your choice does not contact the insurer or close your case.</p>
        {usableOffer ? <p className="response-decision-offer">{insurerOfferProvenanceLabel(usableOffer.source)}: <strong>{offerLabel(usableOffer.amountMinorUnits, usableOffer.currency)}</strong></p>
          : <p>There isn’t a clearly supported offer amount available to accept from this response.</p>}
        <fieldset className="response-choice-options" disabled={pending || !claim.workflow}>
          <legend className="sr-only">Choose what to do next</legend>
          {(["CONTINUE_CHALLENGING", ...(usableOffer ? ["ACCEPT_OFFER"] : [])] as TotalLossResponseDecisionChoice[]).map((choice) => <label key={choice} className="response-choice-option" data-selected={selection === choice || undefined}>
            <input type="radio" name={choiceId} value={choice} aria-label={recommendationLabel(choice)} checked={selection === choice}
              disabled={Boolean(attempt && attempt.choice !== choice)} onChange={() => setSelection(choice)} />
            <span><strong>{recommendationLabel(choice)}</strong><span>{choice === "ACCEPT_OFFER"
              ? "Review the steps to accept the offer shown above."
              : "Prepare a follow-up using your response and case evidence."}</span>
              {recommendation.state === choice ? <small>Recommended</small> : null}
            </span>
          </label>)}
        </fieldset>
        {attempt && !pending ? <p className="response-decision-notice" role="status">Your choice still needs confirmation. Retry saving that same choice.</p> : null}
        {storageUnavailable ? <p className="response-decision-notice">This browser could not preserve the pending choice. Keep this page open until saving is confirmed.</p> : null}
        {error ? <p className="request-error" role="alert">{error}</p> : null}
        <div className="message-local-actions">
          <button className="request-button request-button-primary" disabled={pending || !selection || !claim.workflow} type="button" onClick={() => selection && void choose(selection)}>
            {pending ? <LoaderCircle className="request-spinner" aria-hidden="true" /> : null}
            {pending ? "Saving choice…" : attempt ? "Retry saving choice" : "Save my choice"}
          </button>
        </div>
      </>}
      {decision && !readOnly && actionContainer ? createPortal(<nav className="review-actions response-review-next" aria-label="Review navigation">
        <Link className="review-primary" onClick={onContinue} to={totalLossClaimViewPath(caseId, decision.choice === "ACCEPT_OFFER" ? "review_resolution" : "review_follow_up")}>
          {nextLabel}<span className="review-action-icon"><ArrowRight aria-hidden="true" /></span>
        </Link>
      </nav>, actionContainer) : null}
    </div>
  );
}

function BasisReferences({
  caseEvidenceRefs,
  evidence,
  label = "View sources",
  responseEvidenceRefs,
}: {
  readonly caseEvidenceRefs?: readonly string[];
  readonly evidence: TotalLossInsurerResponseAnalysisEvidence;
  readonly label?: string;
  readonly responseEvidenceRefs?: readonly string[];
}) {
  const responseItems = [...new Set(responseEvidenceRefs ?? [])].map((reference) =>
    evidence.responseEvidence.find((item) => item.evidenceRef === reference),
  ).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const caseItems = [...new Set(caseEvidenceRefs ?? [])].map((reference) =>
    evidence.caseEvidence.find((item) => item.evidenceRef === reference),
  ).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const sourceCount = responseItems.length + caseItems.length;
  if (!sourceCount) return null;
  const excerpt = (value: string) =>
    value.length > 360 ? `${value.slice(0, 357).trimEnd()}…` : value;
  return (
    <details className="response-analysis-basis">
      <summary>
        <span>{label}</span>
        <span className="response-source-count">{sourceCount}</span>
        <ChevronDown aria-hidden="true" />
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
                  ? "Original insurer valuation"
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
      ? "Revised offer from the insurer document — matched to your entry"
      : "Revised offer from the insurer document";
  }
  switch (offer.source) {
    case "CUSTOMER_SUPPLIED":
      return "Revised offer you entered";
    case "INSURER_RESPONSE":
      return "Revised offer in the insurer response";
    case "BOTH":
      return "Revised offer in the response — matched to your entry";
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
  readOnly = false,
}: InsurerResponseIdentity & {
  readonly onCorrect?: () => void;
  readonly response: TotalLossInsurerResponse;
  readonly readOnly?: boolean;
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
    if (readOnly || !claim.workflow || retry.isPending) return;
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

  return <section className="insurer-response-reviewing" aria-labelledby="insurer-response-reviewing-heading">
    {processing ? <ResponseReviewProgress headingId="insurer-response-reviewing-heading" pending={response.processingState === "pending"} onCorrect={onCorrect} /> : <>
      <ResponseReviewHeading headingId="insurer-response-reviewing-heading" onCorrect={onCorrect} />
      <div className="response-review-state-panel" data-review-entrance="secondary">
        <CircleAlert aria-hidden="true" />
        <div>
          <h2>{unsupported ? "This response could not be fully reviewed"
            : unreadable ? "This document could not be reviewed"
              : "The response review could not be completed"}</h2>
          <p role="status">{unsupported
            ? "We couldn’t reliably interpret this material. Your original reply is saved. You can add clearer text or a different file using Correct response."
            : unreadable ? "We couldn’t reliably read this document. Your original reply is saved. You can paste the reply or add a clearer file using Correct response."
              : retryable ? "The review stopped before it could finish. Your original reply is saved. Try the review again."
                : "We couldn’t complete a reliable review. Your original reply is saved. Use Correct response to add anything that is missing."}</p>
          <p className="response-state-note">Your valuation and case evidence have not changed.</p>
          {retryable && !readOnly ? <div className="response-review-retry">
            {retryError ? <p className="request-error" role="alert">{retryError}</p> : null}
            <button className="request-button request-button-primary" disabled={retry.isPending} onClick={() => void retryReview()} type="button">
              {retry.isPending ? <LoaderCircle className="request-spinner" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
              {retry.isPending ? "Restarting review…" : "Try review again"}
            </button>
          </div> : null}
        </div>
      </div>
    </>}

  </section>;
}

function FullResponseReview({ analysis, evidence, recommendation }: {
  readonly analysis: TotalLossInsurerResponseAnalysis;
  readonly evidence: TotalLossInsurerResponseAnalysisEvidence;
  readonly recommendation: TotalLossResponseRecommendation | null;
}) {
  const [activeTab, setActiveTab] = useState(0);
  const id = useId();
  const tabs = ["Their reply", "Open questions", "Review notes"];
  const newOffer = analysis.revisedOffer;
  const hasOffer = newOffer.status === "PRESENT" && newOffer.amountMinorUnits !== null && newOffer.currency !== null;
  const limitations = [...new Set([...(recommendation?.limitations ?? []), ...analysis.inputCoverage.limitations])]
    .filter((text) => !analysis.uncertainties.some((item) => item.description === text));

  return <details className="response-full-review">
    <summary><span>Read the full review</span><ChevronDown aria-hidden="true" /></summary>
    <div className="response-full-review-content">
      <div className="response-review-tabs" role="tablist" aria-label="Full review sections">
        {tabs.map((label, index) => <button key={label} id={`${id}-tab-${index}`} role="tab" type="button"
          aria-selected={activeTab === index} aria-controls={`${id}-panel-${index}`} tabIndex={activeTab === index ? 0 : -1}
          onClick={() => setActiveTab(index)} onKeyDown={(event) => {
            const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
              : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
                : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
            if (next === null) return;
            event.preventDefault();
            setActiveTab(next);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
          }}>{label}</button>)}
      </div>
      <div className="response-full-panel" id={`${id}-panel-0`} role="tabpanel" aria-labelledby={`${id}-tab-0`} hidden={activeTab !== 0} tabIndex={0}>
        <div className="response-reply-summary">
          <div className="response-reply-heading"><h3>How they responded</h3><span>{dispositionLabel(analysis.requestDisposition.category)}</span></div>
          <p>{analysis.requestDisposition.summary}</p>
          <BasisReferences evidence={evidence} label="Sources for this summary" {...analysis.requestDisposition} />
        </div>
        {hasOffer ? <div className="response-offer-source">
          <dl><div><dt>{analysisOfferSourceLabel(newOffer)}</dt><dd>{offerLabel(newOffer.amountMinorUnits!, newOffer.currency!)}</dd></div></dl>
          <BasisReferences evidence={evidence} label="Sources for this amount" responseEvidenceRefs={newOffer.responseEvidenceRefs} />
        </div> : null}
        <div className="response-review-topics">
          <details className="response-review-topic">
            <summary><span>What their reply means</span><ChevronDown aria-hidden="true" /></summary>
            <div>
              <p>{analysis.analysisSummary.whatThisMeans}</p>
              <BasisReferences evidence={evidence} {...analysis.analysisSummary} />
              {analysis.insurerPosition.summary !== analysis.analysisSummary.whatThisMeans ? <>
                <h4>The insurer’s position</h4><p>{analysis.insurerPosition.summary}</p>
                <BasisReferences evidence={evidence} {...analysis.insurerPosition} />
              </> : null}
            </div>
          </details>
          {analysis.importantChanges.length ? <details className="response-review-topic">
            <summary><span>Changes in their reply</span><ChevronDown aria-hidden="true" /></summary>
            <div><ul className="response-review-notes">{analysis.importantChanges.map((change, index) => <li key={index}>
              <p>{change.description}</p><BasisReferences evidence={evidence} {...change} />
            </li>)}</ul></div>
          </details> : null}
          {analysis.responsePoints.map((point, index) => <details className="response-review-topic" key={`${index}:${point.topic}`}>
            <summary><span>{point.topic}</span><ChevronDown aria-hidden="true" /></summary>
            <div>
              <p className="response-topic-outcome">{responsePointLabel(point.disposition)}</p>
              <dl className="response-point-explanation">
                <div><dt>What the insurer said</dt><dd>{point.whatInsurerSaid}</dd></div>
                <div><dt>What this means for you</dt><dd>{point.whatThisMeans}</dd></div>
              </dl>
              <BasisReferences evidence={evidence} {...point} />
            </div>
          </details>)}
        </div>
      </div>
      <div className="response-full-panel" id={`${id}-panel-1`} role="tabpanel" aria-labelledby={`${id}-tab-1`} hidden={activeTab !== 1} tabIndex={0}>
        <h3>What still needs an answer</h3>
        {analysis.unresolvedIssues.length ? <ul className="response-review-notes">
          {analysis.unresolvedIssues.map((issue, index) => <li key={index}><p>{issue.description}</p><BasisReferences evidence={evidence} {...issue} /></li>)}
        </ul> : <p>No unresolved questions were identified in this review. Check the review notes for any limits.</p>}
        {analysis.insurerArguments.length ? <div className="response-insurer-reasons">
          <h4>The insurer’s reasons</h4>
          <div className="response-review-topics">{analysis.insurerArguments.map((argument, index) => <details className="response-review-topic" key={index}>
            <summary><span>{argument.argument}</span><ChevronDown aria-hidden="true" /></summary>
            <div><p>{argument.whatItReliesOn}</p><BasisReferences evidence={evidence} {...argument} /></div>
          </details>)}</div>
        </div> : null}
      </div>
      <div className="response-full-panel" id={`${id}-panel-2`} role="tabpanel" aria-labelledby={`${id}-tab-2`} hidden={activeTab !== 2} tabIndex={0}>
        <h3>How this review was made</h3>
        <p>This explanation uses the insurer response and the valuation evidence already saved in this case. It does not recalculate the vehicle’s value or change the published report.</p>
        <p className="response-review-confidence">{confidenceLabel(analysis.confidence)} based on the available material.</p>
        {limitations.length || analysis.uncertainties.length ? <div className="response-review-limits">
          <h4>Keep in mind</h4>
          <ul className="response-review-notes">
            {limitations.map((text) => <li key={text}><p>{text}</p></li>)}
            {analysis.uncertainties.map((item, index) => <li key={`uncertainty-${index}`}><p>{item.description}</p><BasisReferences evidence={evidence} {...item} /></li>)}
          </ul>
        </div> : null}
      </div>
    </div>
  </details>;
}

function RecommendationExplanation({ analysis, evidence, recommendation }: {
  readonly analysis: TotalLossInsurerResponseAnalysis;
  readonly evidence: TotalLossInsurerResponseAnalysisEvidence;
  readonly recommendation: TotalLossResponseRecommendation | null;
}) {
  const reasons = [...new Set(recommendation?.reasons.length ? recommendation.reasons : [analysis.analysisSummary.whatThisMeans])];
  return <details className="response-review-details">
    <summary><span>{recommendation && recommendation.state !== "NO_CLEAR_RECOMMENDATION" ? "Why we suggest this" : "About this review"}</span><ChevronDown aria-hidden="true" /></summary>
    <div className="response-reasoning-body">
      <ul className="response-reasoning-points">
        {reasons.map((reason) => <li key={reason}>{reason}</li>)}
      </ul>
      <BasisReferences evidence={evidence} label="View supporting sources" {...(recommendation ?? analysis.analysisSummary)} />
      <FullResponseReview analysis={analysis} evidence={evidence} recommendation={recommendation} />
    </div>
  </details>;
}

export function InsurerResponseReviewed({
  accessToken, caseId, claim, onContinue, onCorrect, onDecisionAttempt, onRefresh,
  originalInsurerValue, originalInsurerValueLabel, readOnly = false, response, userId,
}: InsurerResponseIdentity & {
  readonly onCorrect?: () => void;
  readonly onDecisionAttempt: (clientRequestId: string) => void;
  readonly onContinue: () => void;
  readonly originalInsurerValue: TotalLossMoney;
  readonly originalInsurerValueLabel: "Original insurer offer" | "Original insurer valuation";
  readonly readOnly?: boolean;
  readonly response: TotalLossInsurerResponse & {
    readonly analysis: TotalLossInsurerResponseAnalysis;
    readonly analysisEvidence: TotalLossInsurerResponseAnalysisEvidence;
  };
}) {
  const { analysis, analysisEvidence, recommendation } = response;
  const [actionContainer, setActionContainer] = useState<HTMLElement | null>(null);
  const newOffer = analysis.revisedOffer;
  const originalValue = supportedPriorValue(originalInsurerValue, newOffer.currency);
  const hasOffer = newOffer.status === "PRESENT" && newOffer.amountMinorUnits !== null && newOffer.currency !== null;
  const partialDocument = analysis.inputCoverage.document === "UNREADABLE" || analysis.inputCoverage.document === "UNSUPPORTED";
  const limitations = [...new Set([
    ...(recommendation?.limitations ?? []), ...analysis.inputCoverage.limitations,
    ...analysis.uncertainties.map((item) => item.description),
  ])];

  return <section className="insurer-response-reviewed" aria-labelledby="insurer-response-reviewed-heading">
    <ResponseReviewHeading headingId="insurer-response-reviewed-heading" onCorrect={onCorrect} />
    <div className="message-flow response-review-flow" data-review-entrance="secondary">
      <section className="message-flow-step response-review-section" aria-labelledby="response-change-heading">
        <div className="response-section-heading"><span className="message-step-marker" aria-hidden="true">1</span><h2 id="response-change-heading">What changed</h2></div>
        <div className="response-section-content">
          <p className="response-change-summary">{analysis.analysisSummary.whatInsurerSaid}</p>
          {hasOffer ? <dl className="response-offer-change" data-paired={Boolean(originalValue)}>
            {originalValue ? <div><dt>{originalInsurerValueLabel}</dt><dd>{originalValue}</dd></div> : null}
            <div><dt>{analysisOfferSourceLabel(newOffer)}</dt><dd>{offerLabel(newOffer.amountMinorUnits!, newOffer.currency!)}</dd></div>
          </dl> : <p className="response-no-offer">{newOffer.status === "ABSENT" ? "No new offer was included in this response." : "We couldn’t confirm a new offer from this response."}</p>}
          {newOffer.visualSourceInterpretation ? <div className="response-visual-transcription">
            <strong>Amount read from the document</strong><p>“{newOffer.visualSourceInterpretation.derivedText}”</p>
            <small>This text was read from the document image. It does not replace the saved insurer document. Check the original before relying on the amount.</small>
          </div> : null}
          <p className="response-change-meaning">{analysis.analysisSummary.whatThisMeans}</p>
        </div>
      </section>
      <section className="message-flow-step response-review-section" aria-labelledby="response-recommendation-heading">
        <div className="response-section-heading"><span className="message-step-marker" aria-hidden="true">2</span><h2 id="response-recommendation-heading">What we recommend</h2></div>
        <div className="response-section-content response-recommendation">
          <strong>{recommendation ? recommendationLabel(recommendation.state) : "Recommendation unavailable"}</strong>
          <p>{recommendation ? recommendation.summary : "This saved review does not yet have an evidence-based recommendation. Your analysis and original response remain available."}</p>
          <div className="response-review-cautions">
            <p>{confidenceLabel(analysis.confidence)} based on the available material.</p>
            {partialDocument ? <p>Venfour could not reliably interpret the submitted document. The explanation uses only the other response material that was available.</p> : null}
            {limitations.length ? <ul>{limitations.map((text) => <li key={text}>{text}</li>)}</ul> : null}
          </div>
          <RecommendationExplanation analysis={analysis} evidence={analysisEvidence} recommendation={recommendation} />
        </div>
      </section>
      <section className="message-flow-step response-review-section" aria-labelledby="response-choice-heading">
        <div className="response-section-heading"><span className="message-step-marker" aria-hidden="true">3</span><h2 id="response-choice-heading">Your choice</h2></div>
        <div className="response-section-content">
          {recommendation ? <ResponseDecisionArea
            key={`${userId}:${caseId}:${response.responseId}:${recommendation.recommendationId}:${readOnly}`}
            accessToken={accessToken} caseId={caseId} claim={claim} onRefresh={onRefresh} userId={userId}
            response={{ ...response, recommendation }} readOnly={readOnly} actionContainer={actionContainer}
            onDecisionAttempt={onDecisionAttempt} onContinue={onContinue}
          /> : <p>There’s no recommendation to act on yet. You can read the review and find the insurer’s reply in your case history.</p>}
        </div>
      </section>
    </div>
    <div ref={setActionContainer} />

  </section>;
}
