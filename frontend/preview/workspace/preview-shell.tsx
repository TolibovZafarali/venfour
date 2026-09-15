import { useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useLocation } from "react-router";
import { FreeValuationProcessingProvider } from "@/features/analyses/components/free-valuation-processing";
import { AccountControl, SignInDialogProvider } from "@/features/auth";
import { resetScenario, scenarioPath, snapshot } from "./state";
import { continueEntryPreview, entryPreviewHref, entryPreviewMode } from "./entry-preview";

export function PreviewShell() {
  const pathname = useLocation().pathname;
  const loading = pathname === "/_local/valuation-processing";
  const confirmingPayment = pathname.endsWith("/claim/checkout") && snapshot().phase === "confirming";
  const preparingReport = pathname.endsWith("/claim/processing") && snapshot().phase === "paid";
  const queryClient = useQueryClient();

  // Keep the star field mounted while the next route appears beneath its exit.
  return <>
    <SignInDialogProvider>
      <FreeValuationProcessingProvider accountControl={<AccountControl />}>
        <Outlet />
      </FreeValuationProcessingProvider>
    </SignInDialogProvider>
    {entryPreviewMode ? <nav className="entry-preview-controls" aria-label="App entry preview controls">
      <span>App entry</span>
      <a href={entryPreviewHref("fast")}>Fast</a>
      <a href={entryPreviewHref("slow")}>Slow</a>
      <a href={entryPreviewHref("hold")}>Hold loading</a>
      <a href={entryPreviewHref("new")}>New visitor</a>
      <a href={entryPreviewHref(entryPreviewMode)}>Replay</a>
      {entryPreviewMode === "hold" && pathname === "/app" ? <button type="button" onClick={continueEntryPreview}>Continue →</button> : null}
    </nav> : null}
    <aside className="workspace-preview-note" aria-label="Preview notice">
      <span>Local preview · Fictional data</span>
      {loading ? <Link to={scenarioPath("free")} onClick={() => {
        resetScenario("free");
        queryClient.clear();
      }}>Continue to result <span aria-hidden>→</span></Link> : null}
      {confirmingPayment || preparingReport ? <button type="button" onClick={() => {
        resetScenario(confirmingPayment ? "paid" : "completed");
        void queryClient.invalidateQueries();
      }}>{confirmingPayment ? "Continue to report preparation" : "Continue to completed report"} <span aria-hidden>→</span></button> : null}
      <a href="/_local/workspace">All states</a>
    </aside>
  </>;
}
