import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { FreeValuationProcessingProvider } from "@/features/analyses/components/free-valuation-processing";
import { AccountControl, SignInDialogProvider, useAuth } from "@/features/auth";
import { useSignInDialog } from "@/features/auth/sign-in-dialog-context";
import { resetScenario, scenarioPath, snapshot } from "./state";
import { continueEntryPreview, entryPreviewHref, entryPreviewMode } from "./entry-preview";

export function PreviewShell() {
  const { auth } = useAuth();
  const pathname = useLocation().pathname;
  const loading = pathname === "/_local/valuation-processing";
  const confirmingPayment = pathname.endsWith("/claim/checkout") && snapshot().phase === "confirming";
  const preparingReport = pathname.endsWith("/claim/processing") && snapshot().phase === "paid";
  const queryClient = useQueryClient();
  const [paymentBlocked, setPaymentBlocked] = useState(false);

  // Keep the star field mounted while the next route appears beneath its exit.
  return <>
    <SignInDialogProvider>
      <PreviewSignIn />
      <FreeValuationProcessingProvider accountControl={<AccountControl />}>
        <div className="contents" onClickCapture={(event) => {
          if (import.meta.env.VITE_WORKSPACE_STRIPE_SANDBOX && event.target instanceof Element
            && event.target.closest("button.checkout-submit[type=submit]")) {
            event.preventDefault();
            event.stopPropagation();
            setPaymentBlocked(true);
          }
        }} onSubmitCapture={(event) => {
          if (import.meta.env.VITE_WORKSPACE_STRIPE_SANDBOX && event.target instanceof HTMLFormElement
            && event.target.querySelector(".checkout-field-groups")) {
            event.preventDefault();
            event.stopPropagation();
            setPaymentBlocked(true);
          }
        }}>
          <Outlet />
        </div>
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
      {import.meta.env.VITE_WORKSPACE_STRIPE_SANDBOX ? <span role="status">{paymentBlocked ? "Payment submission is disabled in this preview." : "Stripe test mode · Payments disabled"}</span> : null}
      {snapshot().phase === "payment-unverified" && auth.status === "signedIn" && auth.identity === "anonymous" ? <span>Demo code: 123-456</span> : null}
      {loading ? <Link to={scenarioPath("free")} onClick={() => {
        resetScenario("free");
        queryClient.clear();
      }}>Continue to result <span aria-hidden>→</span></Link> : null}
      {confirmingPayment || preparingReport ? <button type="button" onClick={() => {
        resetScenario(confirmingPayment ? "paid" : "completed");
        void queryClient.invalidateQueries();
      }}>{confirmingPayment ? "Continue to report preparation" : "Continue to completed report"} <span aria-hidden>→</span></button> : null}
      <a href="/_local/workspace">All screens</a>
    </aside>
  </>;
}

function PreviewSignIn() {
  const { openSignIn } = useSignInDialog();
  const { search } = useLocation();
  useEffect(() => {
    if (new URLSearchParams(search).has("previewSignIn")) openSignIn();
  }, [openSignIn, search]);
  return null;
}
