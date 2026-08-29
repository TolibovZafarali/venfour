import { useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { environment } from "@/config/env";
import { useAuth } from "@/features/auth";
import { createApiClient } from "@/lib/api/client";

export function LocalClaimTestingPage() {
  const { auth, ensureGuestSession } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
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

  return <section className="mx-auto max-w-3xl space-y-6 px-6 py-16">
    <h1 className="text-3xl font-semibold">Local claim testing</h1>
    <p>Synthetic cases only. External report and market providers are blocked. The displayed $1 is a local payment fixture, not a product price.</p>
    <p>Current session: {auth.status === "signedIn" ? auth.identity : auth.status}. A new case uses this session. Sign out first to exercise Secure your claim again.</p>
    <div className="flex flex-wrap gap-3">
      {(["supportable", "exception"] as const).map((mode) => <Button key={mode} disabled={pending} onClick={() => void create(mode)}>
        Create {mode} case
      </Button>)}
    </div>
    {error ? <p role="alert">Couldn’t create the fixture. Check that the local harness is installed and running, then retry.</p> : null}
    <p>After securing your claim, use the terminal payment helper, then the processing helper. Neither action is available from customer code.</p>
    <pre className="overflow-auto rounded-lg bg-white p-4 text-sm">{`VENFOUR_LOCAL_POST_CONTINUE=1 .venv/bin/python -m scripts.local_claim_flow pay CASE_ID\nVENFOUR_LOCAL_POST_CONTINUE=1 .venv/bin/python -m scripts.local_claim_flow process CASE_ID`}</pre>
    <p>No-dispute manual testing is not enabled yet: the current assessment preserves the frozen preview classification. A separate downstream fixture needs to be agreed before testing that state. Existing no-dispute tests remain available offline.</p>
  </section>;
}
