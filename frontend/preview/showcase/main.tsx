import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet } from "react-router";
import { AppProvider } from "@/app/app-provider";
import { appRoutes } from "@/app/router";
import { createAppQueryClient } from "@/app/query-client";
import { SignInDialogProvider } from "@/features/auth";
import { FreeValuationProcessingProvider } from "@/features/analyses/components/free-valuation-processing";
import { startPath, installShowcaseFetch, resetShowcase, prepareShowcase, previewAuth, caseService, profileService, details } from "./state";
import "./showcase.css";

const queryClient = createAppQueryClient({ retry: false });
installShowcaseFetch(queryClient);
if (new URLSearchParams(location.search).has("reset")) resetShowcase();
prepareShowcase();
function Shell() {
  return <><aside className="showcase-notice" aria-label="Local showcase">
    <span>Fictional local case · no emails or charges · payment details simulated</span>
    <a href="/_local/showcase?reset=1" onClick={() => window.addEventListener("beforeunload", event => event.stopImmediatePropagation(), { capture: true, once: true })}>Reset walkthrough</a>
  </aside><SignInDialogProvider><FreeValuationProcessingProvider><Outlet /></FreeValuationProcessingProvider></SignInDialogProvider></>;
}
const router = createBrowserRouter([{ element: <Shell />, children: [{ path: "/_local/showcase", element: <Navigate to={startPath} replace /> }, ...appRoutes] }]);
createRoot(document.getElementById("root")!).render(<AppProvider router={router} queryClient={queryClient} authService={previewAuth} appraisalCaseService={caseService} customerProfileService={profileService} totalLossDependencies={details} adminCaseOperationsDependencies={null} adminDiminishedValueDependencies={null} diminishedValueDependencies={null} authTurnstileController={{ runWithToken: async (_action, operation) => operation("local-only") }} />);
