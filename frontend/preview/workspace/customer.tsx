import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { AppProvider } from "@/app/app-provider";
import { appRoutes } from "@/app/router";
import { createAppQueryClient } from "@/app/query-client";
import { LocalValuationProcessingPage } from "@/pages/local-valuation-processing-page";
import { scenarios, resetScenario, installPreviewFetch, previewAuth, previewCaseService, previewDetails, previewProfileService } from "./state";
import { screens } from "./catalog";
import { Launcher } from "./launcher";
import { PreviewShell } from "./preview-shell";
import { entryPreviewMode } from "./entry-preview";
import "./preview.css";

installPreviewFetch();
const selectedScreen = screens.find(item => item.id === new URLSearchParams(location.search).get("screen"));
if (location.pathname === "/_local/workspace" && selectedScreen) {
  resetScenario(selectedScreen.phase ?? "free");
  if (selectedScreen.signedOut) localStorage.setItem("venfour-workspace-preview-signed-out", "true");
}
const requested = new URLSearchParams(location.search).get("state");
const scenario = scenarios.find(item => item[0] === (requested === "approval" ? "ready" : requested));
if (location.pathname === "/_local/workspace" && scenario) resetScenario(scenario[0]);
if (location.pathname === "/_local/valuation-processing") resetScenario("free");
if (entryPreviewMode) resetScenario(entryPreviewMode === "new" ? "zero" : "free");

const router = createBrowserRouter([{ element: <PreviewShell />, children: [
  { path: "/_local/workspace", element: <Launcher scenario={scenario} screen={selectedScreen} /> },
  { path: "/_local/valuation-processing", element: <LocalValuationProcessingPage /> },
  ...appRoutes,
] }]);
createRoot(document.getElementById("root")!).render(<>
  <AppProvider router={router} queryClient={createAppQueryClient({ retry: false })} authService={previewAuth} appraisalCaseService={previewCaseService}
    adminCaseOperationsDependencies={null} adminDiminishedValueDependencies={null} customerProfileService={previewProfileService} diminishedValueDependencies={null}
    totalLossDependencies={previewDetails} authTurnstileController={{ runWithToken: async (_action, operation) => operation("local-preview") }} />
</>);
