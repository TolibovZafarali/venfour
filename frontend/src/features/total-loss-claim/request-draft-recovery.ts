import type { TotalLossMessageDraft } from "./contracts";
import { contentOf, normalizedContent, sameContent } from "./request-state";
import type { DraftContent } from "./request-state";

interface RequestDraftRecovery {
  readonly version: 1;
  readonly baselineRevision: number;
  readonly baseline: DraftContent;
  readonly content: DraftContent;
  readonly failed: boolean;
  readonly pendingContent: DraftContent | null;
}

export function requestDraftRecoveryKey({
  userId,
  caseId,
  draft,
  followUpDraftId,
}: {
  readonly userId: string;
  readonly caseId: string;
  readonly draft: TotalLossMessageDraft;
  readonly followUpDraftId?: string;
}) {
  return `venfour:request-draft:v1:${[
    userId, caseId, draft.reportVersionId, draft.purpose, draft.draftId,
    followUpDraftId ?? "initial",
  ].map(encodeURIComponent).join(":")}`;
}

function isContent(value: unknown): value is DraftContent {
  if (!value || typeof value !== "object") return false;
  const content = value as Record<string, unknown>;
  return typeof content.recipient === "string" && content.recipient.length <= 320 &&
    typeof content.subject === "string" && content.subject.length <= 998 &&
    typeof content.body === "string" && content.body.length <= 50_000;
}

function readRecovery(key: string): RequestDraftRecovery | null {
  const value: unknown = JSON.parse(window.sessionStorage.getItem(key) ?? "null");
  if (!value || typeof value !== "object") return null;
  const recovery = value as Record<string, unknown>;
  if (recovery.version !== 1 || typeof recovery.baselineRevision !== "number" ||
    !Number.isSafeInteger(recovery.baselineRevision) || recovery.baselineRevision < 1 ||
    !isContent(recovery.baseline) || !isContent(recovery.content) ||
    typeof recovery.failed !== "boolean" ||
    (recovery.pendingContent !== null && !isContent(recovery.pendingContent))) return null;
  return recovery as unknown as RequestDraftRecovery;
}

export function clearRequestDraftRecovery(key: string) {
  try {
    window.sessionStorage.removeItem(key);
    return true;
  } catch {
    try {
      window.sessionStorage.setItem(key, "null");
      return true;
    } catch {
      return false;
    }
  }
}

export function restoreRequestDraft(key: string, draft: TotalLossMessageDraft, display: DraftContent) {
  const fallback = { content: display, baseline: draft, failed: false, conflict: false, restored: false, storageError: false, pendingContent: null as DraftContent | null };
  try {
    const recovery = readRecovery(key);
    if (!recovery) return fallback;
    const incoming = contentOf(draft);
    if (sameContent(normalizedContent(recovery.content), incoming) &&
      (!recovery.pendingContent || draft.revision > recovery.baselineRevision)) {
      clearRequestDraftRecovery(key);
      return fallback;
    }
    // An acknowledged save can be newer than the query cache during section navigation.
    const baseline = recovery.baselineRevision > draft.revision
      ? { ...draft, ...recovery.baseline, revision: recovery.baselineRevision }
      : draft;
    const pendingWasSaved = Boolean(recovery.pendingContent && draft.revision > recovery.baselineRevision && sameContent(incoming, recovery.pendingContent));
    const conflict = !pendingWasSaved && draft.revision >= recovery.baselineRevision &&
      !sameContent(incoming, recovery.baseline);
    return {
      content: recovery.content,
      baseline,
      failed: recovery.failed,
      conflict,
      restored: true,
      storageError: false,
      pendingContent: pendingWasSaved ? null : recovery.pendingContent,
    };
  } catch {
    return { ...fallback, storageError: true };
  }
}

export function preserveRequestDraft(key: string, content: DraftContent, baseline: TotalLossMessageDraft, failed: boolean, pendingContent: DraftContent | null = null, retainMatching = false) {
  if (!retainMatching && !pendingContent && sameContent(normalizedContent(content), contentOf(baseline))) return clearRequestDraftRecovery(key);
  try {
    const recovery: RequestDraftRecovery = {
      version: 1,
      baselineRevision: baseline.revision,
      baseline: contentOf(baseline),
      content,
      failed,
      pendingContent,
    };
    window.sessionStorage.setItem(key, JSON.stringify(recovery));
    return true;
  } catch {
    return false;
  }
}

export function reconcileRequestDraft(key: string, previous: TotalLossMessageDraft, saved: TotalLossMessageDraft) {
  try {
    const recovery = readRecovery(key);
    if (!recovery) return true;
    if (recovery.baselineRevision > saved.revision) return true;
    if (sameContent(normalizedContent(recovery.content), contentOf(saved))) {
      // Keep the acknowledged snapshot until the resolver projection catches up.
      return preserveRequestDraft(key, recovery.content, saved, false, null, true);
    }
    if (recovery.baselineRevision !== previous.revision || !sameContent(recovery.baseline, contentOf(previous))) return true;
    // A previous editor's in-flight save must preserve edits made after it unmounted.
    return preserveRequestDraft(key, recovery.content, saved, false);
  } catch {
    return false;
  }
}

export function recordRequestDraftFailure(key: string, baseline: TotalLossMessageDraft) {
  try {
    const recovery = readRecovery(key);
    if (!recovery || recovery.baselineRevision !== baseline.revision ||
      !sameContent(recovery.baseline, contentOf(baseline))) return;
    preserveRequestDraft(key, recovery.content, baseline, true, recovery.pendingContent);
  } catch {
    // The editor retains its entries and blocks navigation when storage is unavailable.
  }
}

export function acknowledgeRequestDraftProjection(key: string, draft: TotalLossMessageDraft) {
  try {
    const recovery = readRecovery(key);
    if (recovery && draft.revision >= recovery.baselineRevision &&
      (!recovery.pendingContent || draft.revision > recovery.baselineRevision) &&
      sameContent(normalizedContent(recovery.content), contentOf(draft))) {
      clearRequestDraftRecovery(key);
    }
  } catch {
    // A failed cleanup never replaces the editable content or its server baseline.
  }
}
