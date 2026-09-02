import { useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";

import type { TotalLossInsurerResponseMediaType } from "./contracts";

interface ResponseDraftAttachment {
  readonly displayFilename: string;
  readonly byteSize: number;
  readonly mediaType: TotalLossInsurerResponseMediaType;
  readonly contentDigest: string;
}

interface ResponseDraftContent {
  readonly responseText: string;
  readonly offer: string;
  readonly retainDocument: boolean;
  readonly attachment: ResponseDraftAttachment | null;
}

interface ResponseDraft extends ResponseDraftContent {
  readonly clientRequestId: string;
}

interface ResponseDraftOptions {
  readonly userId: string;
  readonly caseId: string;
  readonly supersedesResponseId: string | null;
  readonly negotiationRoundId: string;
  readonly outboundCommunicationId: string;
  readonly initial: ResponseDraftContent;
  readonly pending: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MEDIA_TYPES = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif",
]);

function sameContent(left: ResponseDraftContent, right: ResponseDraftContent) {
  return left.responseText === right.responseText &&
    left.offer === right.offer &&
    left.retainDocument === right.retainDocument &&
    left.attachment?.displayFilename === right.attachment?.displayFilename &&
    left.attachment?.byteSize === right.attachment?.byteSize &&
    left.attachment?.mediaType === right.attachment?.mediaType &&
    left.attachment?.contentDigest === right.attachment?.contentDigest;
}

function isAttachment(value: unknown): value is ResponseDraftAttachment | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const file = value as Record<string, unknown>;
  return typeof file.displayFilename === "string" &&
    [...file.displayFilename].length > 0 && [...file.displayFilename].length <= 255 &&
    typeof file.byteSize === "number" && Number.isSafeInteger(file.byteSize) &&
    file.byteSize > 0 && file.byteSize <= 10 * 1024 * 1024 &&
    typeof file.mediaType === "string" && MEDIA_TYPES.has(file.mediaType) &&
    typeof file.contentDigest === "string" && /^[a-f0-9]{64}$/u.test(file.contentDigest);
}

function readDraft(key: string, initial: ResponseDraftContent) {
  const fallback: ResponseDraft = {
    ...initial,
    clientRequestId: globalThis.crypto.randomUUID(),
  };
  try {
    const serialized = window.sessionStorage.getItem(key);
    if (!serialized) return { content: fallback, restored: false, storageError: false };
    const value: unknown = JSON.parse(serialized);
    if (value && typeof value === "object") {
      const draft = value as Record<string, unknown>;
      if (
        draft.version === 1 &&
        typeof draft.clientRequestId === "string" && UUID_PATTERN.test(draft.clientRequestId) &&
        typeof draft.responseText === "string" && draft.responseText.length <= 100_000 &&
        typeof draft.offer === "string" && draft.offer.length <= 100_000 &&
        typeof draft.retainDocument === "boolean" &&
        (!draft.retainDocument || initial.retainDocument) &&
        isAttachment(draft.attachment)
      ) {
        const content: ResponseDraft = {
          clientRequestId: draft.clientRequestId,
          responseText: draft.responseText,
          offer: draft.offer,
          retainDocument: draft.retainDocument,
          attachment: draft.attachment,
        };
        return { content, restored: !sameContent(content, initial), storageError: false };
      }
    }
    return { content: fallback, restored: false, storageError: false };
  } catch {
    return { content: fallback, restored: false, storageError: true };
  }
}

function clearDraft(key: string) {
  try {
    window.sessionStorage.removeItem(key);
    return true;
  } catch {
    try {
      window.sessionStorage.setItem(key, "");
      return true;
    } catch {
      return false;
    }
  }
}

export function useInsurerResponseDraft({
  userId,
  caseId,
  supersedesResponseId,
  negotiationRoundId,
  outboundCommunicationId,
  initial,
  pending,
}: ResponseDraftOptions) {
  const key = `venfour:insurer-response-draft:v2:${[userId, caseId, negotiationRoundId, outboundCommunicationId, supersedesResponseId ?? "new"].map(encodeURIComponent).join(":")}`;
  const [state, setState] = useState(() => readDraft(key, initial));
  const contentRef = useRef(state.content);
  const dirtyRef = useRef(!sameContent(state.content, initial));
  const submittedRef = useRef(false);
  const dirty = !sameContent(state.content, initial);
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    !submittedRef.current && (dirtyRef.current || pending) &&
    (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );

  useEffect(() => {
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (submittedRef.current || (!dirtyRef.current && !pending)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnUnsaved);
    return () => window.removeEventListener("beforeunload", warnUnsaved);
  }, [pending]);

  const edit = (patch: Partial<ResponseDraftContent>) => {
    const previous = contentRef.current;
    const next = { ...previous, ...patch };
    if (!sameContent(previous, next)) next.clientRequestId = globalThis.crypto.randomUUID();
    submittedRef.current = false;
    dirtyRef.current = !sameContent(next, initial);
    contentRef.current = next;
    let saved = false;
    try {
      if (dirtyRef.current) {
        window.sessionStorage.setItem(key, JSON.stringify({ version: 1, ...next }));
        saved = true;
      } else {
        saved = clearDraft(key);
      }
    } catch {
      saved = false;
    }
    setState((current) => ({ ...current, content: next, storageError: !saved }));
  };

  const submitted = () => {
    submittedRef.current = true;
    dirtyRef.current = false;
    clearDraft(key);
    if (blocker.state === "blocked") blocker.reset();
  };

  return { ...state, dirty, blocker, edit, submitted };
}
