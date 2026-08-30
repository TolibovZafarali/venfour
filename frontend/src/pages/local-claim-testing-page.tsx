import { useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { environment } from "@/config/env";
import { useAuth } from "@/features/auth";
import { createApiClient } from "@/lib/api/client";

export function LocalClaimTestingPage() {
  const { auth, ensureGuestSession, signOut } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [caseId, setCaseId] = useState("");
  if (!environment.localPostContinueEnabled) return null;

  async function create(mode: string) {
    setPending(true);
    setError(false);
    try {
      const session = await ensureGuestSession();
      const result = await createApiClient({ baseUrl: environment.apiBaseUrl }).postJson<{ caseId: string }>(
        "/api/local/claim-fixtures", { mode }, { accessToken: session.access_token },
      );
      void navigate(`/total-loss/cases/${result.caseId}/analysis`);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  async function startAnonymousSession() {
    setPending(true);
    setError(false);
    try {
      await signOut();
      await ensureGuestSession();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return <section className="mx-auto max-w-3xl space-y-6 px-6 py-16">
    <h1 className="text-3xl font-semibold">Local claim testing</h1>
    <p>Synthetic cases only. External report and market providers are blocked. The displayed $1 is a local payment fixture, not a product price.</p>
    <p>Current session: {auth.status === "signedIn" ? auth.identity : auth.status}. A new case uses this session.</p>
    <div className="space-y-3 rounded-xl border bg-white p-5">
      <h2 className="text-lg font-semibold">Choose the journey to review</h2>
      <p><strong>A. Recognized anonymous owner:</strong> start a new anonymous session below, create a case, then select Continue my review. Your saved email and locked payment appear together.</p>
      <p><strong>B. Lost session:</strong> copy the case ID first, start a new anonymous session, then reopen that case below. Only the neutral recovery form should appear.</p>
      <p><strong>C. Verified owner:</strong> use the verification link from the local inbox. It returns to the same purchase page. Reload or reopen it to confirm the verified state persists.</p>
      <Button variant="outline" disabled={pending} onClick={() => void startAnonymousSession()}>Start a new anonymous session</Button>
      <p className="text-sm text-muted-foreground">This signs out the current local test account, including its other local sessions. It does not delete cases or payments. An old anonymous case will need its email recovery link.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-2 text-sm" htmlFor="local-case-id">Case ID to reopen
          <input id="local-case-id" className="min-w-0 rounded-md border px-3 py-2" value={caseId} onChange={(event) => setCaseId(event.target.value.trim())} placeholder="Paste the case ID from its URL" />
        </label>
        <Button variant="outline" disabled={!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(caseId)} onClick={() => void navigate(`/total-loss/cases/${caseId}/claim/checkout`)}>Reopen purchase</Button>
      </div>
      <a className="text-sm underline" href="http://127.0.0.1:54324" target="_blank" rel="noreferrer">Open local verification inbox</a>
    </div>
    <div className="flex flex-wrap gap-3">
      {(["supportable", "exception"] as const).map((mode) => <Button key={mode} disabled={pending} onClick={() => void create(mode)}>
        Create {mode} case
      </Button>)}
    </div>
    {error ? <p role="alert">Couldn’t create the fixture. Check that the local harness is installed and running, then retry.</p> : null}
    <p>Without sandbox Stripe configuration, payment fields stay unavailable. The terminal helpers exercise synthetic fulfillment and processing only; they do not test Payment Element or card authentication. Neither helper is available from customer code.</p>
    <pre className="overflow-auto rounded-lg bg-white p-4 text-sm">{`VENFOUR_LOCAL_POST_CONTINUE=1 .venv/bin/python -m scripts.local_claim_flow pay CASE_ID\nVENFOUR_LOCAL_POST_CONTINUE=1 .venv/bin/python -m scripts.local_claim_flow process CASE_ID`}</pre>
    <p>No-dispute manual testing is not enabled yet: the current assessment preserves the frozen preview classification. A separate downstream fixture needs to be agreed before testing that state. Existing no-dispute tests remain available offline.</p>
  </section>;
}
