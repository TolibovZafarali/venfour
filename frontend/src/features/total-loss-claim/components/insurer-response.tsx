import { ArrowRight, FileText, LoaderCircle, Paperclip, RotateCcw, Trash2, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";

import {
  DIMINISHED_VALUE_DOCUMENT_ACCEPT,
  validateDiminishedValueDocument,
} from "@/features/diminished-value/local-document-files";
import { useTotalLossDependencies } from "@/features/total-loss/dependencies";
import {
  formatCurrencyInput,
} from "@/features/total-loss/validation";
import type {
  TotalLossClaimSecured,
  TotalLossInsurerResponse,
  TotalLossInsurerResponseMediaType,
} from "../contracts";
import {
  useTotalLossInsurerResponseMutation,
  useTotalLossInsurerResponseUploadPreparationMutation,
} from "../queries";
import {
  sha256Hex,
  TotalLossInsurerResponseStorageError,
} from "../insurer-response-storage-service";
import { RecordedTime } from "./completed-analysis-visuals";
import { StableActionLabel } from "./stable-action-label";
import "./insurer-response.css";

interface InsurerResponseIdentity {
  readonly accessToken: string;
  readonly caseId: string;
  readonly claim: TotalLossClaimSecured;
  readonly onRefresh: () => Promise<unknown>;
  readonly userId: string;
}

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

export function InsurerResponseForm({
  accessToken,
  caseId,
  claim,
  onRefresh,
  onRecorded,
  userId,
}: InsurerResponseIdentity & {
  readonly onRecorded: () => void;
}) {
  const existing = claim.insurerResponse ?? null;
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
  const fileInput = useRef<HTMLInputElement>(null);
  const selectionEpoch = useRef(0);
  const requestId = useRef(globalThis.crypto.randomUUID());
  const actionLocked = useRef(false);
  const [responseText, setResponseText] = useState(existing?.text ?? "");
  const [offer, setOffer] = useState(() => initialOffer(existing));
  const [retainDocument, setRetainDocument] = useState(Boolean(existing?.document));
  const [selectedFile, setSelectedFile] = useState<SelectedResponseFile | null>(null);
  const [validatingFile, setValidatingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const changed = () => {
    requestId.current = globalThis.crypto.randomUUID();
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
  const effectiveDocument = selectedFile || retainDocument && existing?.document;
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
        setSelectedFile(null);
        setFileError(validation.error.replace(/supporting document/giu, "insurer response file"));
        return;
      }
      setSelectedFile({
        displayFilename: validation.displayFilename,
        file,
        mediaType: validation.mimeType,
      });
      setRetainDocument(false);
      changed();
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
          clientRequestId: requestId.current,
          contentDigest,
          expectedWorkflowRevision,
          mediaType: validation.mimeType,
          originalFilename: validation.displayFilename,
        });
        await storage.uploadPreparedResponse({
          caseId,
          clientRequestId: requestId.current,
          file: selectedFile.file,
          preparation,
        });
        documentId = preparation.documentId;
      }

      await recordResponse.mutateAsync({
        clientRequestId: requestId.current,
        documentId,
        expectedWorkflowRevision,
        responseText: responseText.trim() ? responseText : null,
        retainedDocumentId:
          !selectedFile && retainDocument ? existing?.document?.documentId ?? null : null,
        revisedOfferMinorUnits: parsedOffer,
        supersedesResponseId: existing?.responseId ?? null,
      });
      await onRefresh().catch(() => undefined);
      onRecorded();
    } catch (caught) {
      await onRefresh().catch(() => undefined);
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

  const disabled = pending || validatingFile;
  return (
    <section className="insurer-response-form" aria-labelledby={`${fieldId}-heading`}>
      <header className="response-heading" data-review-entrance="primary">
        <p className="response-eyebrow">{existing ? "Correct saved response" : "Insurer response"}</p>
        <h1 id={`${fieldId}-heading`}>Add the insurer’s response</h1>
        <p>Save what the insurer sent. Venfour will add it to this case without analyzing it yet.</p>
      </header>

      <div className="response-fields" data-review-entrance="secondary">
        <label className="response-field" htmlFor={`${fieldId}-text`}>
          <span>Paste the response</span>
          <textarea
            id={`${fieldId}-text`}
            disabled={disabled}
            onChange={(event) => {
              setResponseText(event.target.value);
              changed();
            }}
            placeholder="Paste the insurer’s email or written response here"
            maxLength={MAX_RESPONSE_TEXT_CHARACTERS}
            rows={9}
            value={responseText}
          />
          <small>Optional if you add the original file or only received a revised offer.</small>
          {textError ? <span className="request-field-error">{textError}</span> : null}
        </label>

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
                setRetainDocument(true);
                changed();
              }} type="button">Keep saved file</button> : <button disabled={disabled} onClick={() => {
                setSelectedFile(null);
                changed();
              }} type="button"><Trash2 aria-hidden="true" />Remove</button>}
            </div>
          ) : existing?.document && retainDocument ? (
            <div className="response-file-selection">
              <FileText aria-hidden="true" />
              <div><strong>{existing.document.originalFilename}</strong><span>{readableSize(existing.document.byteSize)} · Saved with the current response</span></div>
              <button disabled={disabled || !storage} onClick={() => fileInput.current?.click()} type="button"><RotateCcw aria-hidden="true" />Replace</button>
              <button disabled={disabled} onClick={() => {
                setRetainDocument(false);
                changed();
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

        <label className="response-field response-offer-field" htmlFor={`${fieldId}-offer`}>
          <span>Revised offer <small>Optional</small></span>
          <div><span aria-hidden="true">$</span><input
            aria-describedby={`${fieldId}-offer-help`}
            aria-invalid={offerError ? true : undefined}
            disabled={disabled}
            id={`${fieldId}-offer`}
            inputMode="decimal"
            onChange={(event) => {
              setOffer(formatCurrencyInput(event.target.value));
              changed();
            }}
            placeholder="0.00"
            value={offer.replace(/^\$/u, "")}
          /></div>
          <small id={`${fieldId}-offer-help`}>Enter the insurer’s new dollar amount only if one was included.</small>
          {offerError ? <span className="request-field-error">{offerError}</span> : null}
        </label>
      </div>

      <div className="response-submit" data-review-entrance="supporting">
        <p>The saved response becomes part of this case. It will not be analyzed or used to prepare a reply in this step.</p>
        {error ? <p className="request-error" role="alert">{error}</p> : null}
        <button className="request-button request-button-primary" disabled={disabled} onClick={() => void submit()} type="button">
          <StableActionLabel reserve="Saving response…">{pending ? "Saving response…" : existing ? "Save corrected response" : "Save response"}</StableActionLabel>
          {pending ? <LoaderCircle className="request-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
        </button>
      </div>
    </section>
  );
}

export function InsurerResponseReceived({
  response,
  onCorrect,
}: {
  readonly onCorrect: () => void;
  readonly response: TotalLossInsurerResponse;
}) {
  return (
    <section className="insurer-response-received" aria-labelledby="insurer-response-received-heading">
      <p className="waiting-case-status" data-review-entrance="supporting"><span aria-hidden="true" />Response received</p>
      <div className="response-heading" data-review-entrance="primary">
        <h1 id="insurer-response-received-heading">The insurer’s response is saved</h1>
        <p className="review-lead" role="status">It is now part of this case. Venfour has not analyzed it or prepared advice or a reply.</p>
      </div>
      <p className="sent-recorded" data-review-entrance="supporting">Response recorded: <RecordedTime value={response.receivedAt} /></p>
      <dl className="response-summary" data-review-entrance="secondary">
        {response.text ? <div><dt>Written response</dt><dd className="response-summary-text">{response.text}</dd></div> : null}
        {response.document ? <div><dt>Original file</dt><dd><Paperclip aria-hidden="true" />{response.document.originalFilename}<span>{readableSize(response.document.byteSize)}</span></dd></div> : null}
        {response.revisedOffer ? <div><dt>Revised offer</dt><dd><strong>{offerLabel(response.revisedOffer.amountMinorUnits, response.revisedOffer.currency)}</strong></dd></div> : null}
      </dl>
      <div className="response-received-actions" data-review-entrance="supporting">
        <p>If you saved the wrong text, file, or offer, you can add a corrected version. The prior version remains in the case history.</p>
        <button className="request-button request-button-secondary" onClick={onCorrect} type="button"><RotateCcw aria-hidden="true" />Correct this response</button>
      </div>
    </section>
  );
}
