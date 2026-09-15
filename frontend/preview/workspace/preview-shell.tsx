import { useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useLocation } from "react-router";
import { FreeValuationProcessingProvider } from "@/features/analyses/components/free-valuation-processing";
import { AccountControl, SignInDialogProvider } from "@/features/auth";
import { resetScenario, scenarioPath } from "./state";

export function PreviewShell() {
  const loading = useLocation().pathname === "/_local/valuation-processing";
  const queryClient = useQueryClient();

  // Keep the star field mounted while the next route appears beneath its exit.
  return <>
    <SignInDialogProvider>
      <FreeValuationProcessingProvider accountControl={<AccountControl />}>
        <Outlet />
      </FreeValuationProcessingProvider>
    </SignInDialogProvider>
    <aside className="workspace-preview-note" aria-label="Preview notice">
      <span>Local preview · Fictional data</span>
      {loading ? <Link to={scenarioPath("free")} onClick={() => {
        resetScenario("free");
        queryClient.clear();
      }}>Continue to result <span aria-hidden>→</span></Link> : null}
      <a href="/_local/workspace">All states</a>
    </aside>
  </>;
}
