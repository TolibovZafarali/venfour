import { beforeEach, describe, expect, it } from "vitest";

import type { TotalLossMessageDraft } from "./contracts";
import {
  preserveRequestDraft,
  reconcileRequestDraft,
  requestDraftRecoveryKey,
  restoreRequestDraft,
} from "./request-draft-recovery";
import { contentOf } from "./request-state";

const draft: TotalLossMessageDraft = {
  draftId: "draft-one", reportVersionId: "report-one", purpose: "initial_reconsideration",
  recipient: "adjuster@example.com", subject: "Saved subject", body: "Saved message",
  revision: 1, updatedAt: "2026-09-02T12:00:00Z",
};
const scope = { userId: "owner-one", caseId: "case-one", draft };
const key = requestDraftRecoveryKey(scope);

beforeEach(() => window.sessionStorage.clear());

describe("request draft recovery", () => {
  it("preserves raw temporarily invalid fields with their server baseline and failure state", () => {
    const authored = { ...contentOf(draft), subject: "", body: "My unfinished rewrite" };
    expect(preserveRequestDraft(key, authored, draft, true)).toBe(true);
    expect(restoreRequestDraft(key, draft, contentOf(draft))).toMatchObject({
      content: authored, baseline: draft, failed: true, restored: true, conflict: false,
    });
  });

  it("isolates owners, cases, reports, exact initial messages and follow-up rounds", () => {
    const authored = { ...contentOf(draft), body: "Only this initial request" };
    preserveRequestDraft(key, authored, draft, false);
    const otherScopes = [
      { ...scope, userId: "owner-two" }, { ...scope, caseId: "case-two" },
      { ...scope, draft: { ...draft, reportVersionId: "report-two" } },
      { ...scope, draft: { ...draft, draftId: "draft-two" } },
      { ...scope, followUpDraftId: "draft-one", draft: { ...draft, purpose: "follow_up_reconsideration" as const } },
      { ...scope, followUpDraftId: "draft-round-three", draft: { ...draft, draftId: "draft-round-three", purpose: "follow_up_reconsideration" as const } },
    ];
    for (const other of otherScopes) {
      const otherKey = requestDraftRecoveryKey(other);
      expect(otherKey).not.toBe(key);
      expect(restoreRequestDraft(otherKey, other.draft, contentOf(other.draft)).restored).toBe(false);
    }
  });

  it("keeps an acknowledged save until the resolver projection catches up, then clears it", () => {
    const content = { ...contentOf(draft), body: "Saved revised message" };
    const saved = { ...draft, ...content, revision: 2 };
    preserveRequestDraft(key, content, draft, true);
    expect(reconcileRequestDraft(key, draft, saved)).toBe(true);
    expect(restoreRequestDraft(key, draft, contentOf(draft))).toMatchObject({ content, baseline: saved, restored: true });
    expect(restoreRequestDraft(key, saved, contentOf(saved))).toMatchObject({ content, restored: false });
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });

  it("retains newer edits when an older mounted editor's save finishes", () => {
    const content = { ...contentOf(draft), subject: "First saved edit" };
    const saved = { ...draft, ...content, revision: 2 };
    const latest = { ...content, subject: "", body: "More work after returning" };
    preserveRequestDraft(key, latest, draft, false);
    reconcileRequestDraft(key, draft, saved);
    expect(restoreRequestDraft(key, saved, contentOf(saved))).toMatchObject({ content: latest, baseline: saved, conflict: false });
    expect(restoreRequestDraft(key, draft, contentOf(draft))).toMatchObject({ content: latest, baseline: saved, conflict: false });
  });

  it("does not let an old completion change a newer saved baseline", () => {
    const latestSaved = { ...draft, body: "Third revision", revision: 3 };
    const latest = { ...contentOf(latestSaved), subject: "Next rewrite" };
    preserveRequestDraft(key, latest, latestSaved, true);
    reconcileRequestDraft(key, draft, { ...draft, body: "Second revision", revision: 2 });
    expect(restoreRequestDraft(key, latestSaved, contentOf(latestSaved))).toMatchObject({ content: latest, baseline: latestSaved, failed: true });
  });

  it("restores work with a conflict when the server changed independently", () => {
    const authored = { ...contentOf(draft), body: "Local work" };
    preserveRequestDraft(key, authored, draft, false);
    const remote = { ...draft, subject: "Other tab", revision: 2 };
    expect(restoreRequestDraft(key, remote, contentOf(remote))).toMatchObject({ content: authored, conflict: true, restored: true });
  });

  it("reconciles an uncertain successful save during refresh", () => {
    const authored = { ...contentOf(draft), body: "Persisted despite lost response" };
    preserveRequestDraft(key, authored, draft, true);
    const saved = { ...draft, ...authored, revision: 2 };
    expect(restoreRequestDraft(key, saved, contentOf(saved))).toMatchObject({ content: authored, failed: false, restored: false });
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });

  it("ignores malformed stored recovery without adopting its content", () => {
    window.sessionStorage.setItem(key, JSON.stringify({ version: 1, content: "not a request" }));
    expect(restoreRequestDraft(key, draft, contentOf(draft))).toMatchObject({ content: contentOf(draft), restored: false });
  });
});
