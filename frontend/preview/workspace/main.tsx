import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { AppProvider } from "@/app/app-provider";
import { appRoutes } from "@/app/router";
import { createAppQueryClient } from "@/app/query-client";
import { LocalValuationProcessingPage } from "@/pages/local-valuation-processing-page";
import { scenarios, resetScenario, installPreviewFetch, previewAuth, previewCaseService, previewDetails, previewProfileService } from "./state";
import { Launcher } from "./launcher";
import { PreviewShell } from "./preview-shell";
import "./preview.css";

installPreviewFetch();
const requested = new URLSearchParams(location.search).get("state");
const scenario = scenarios.find(item => item[0] === (requested === "approval" ? "ready" : requested));
if (location.pathname === "/_local/workspace" && scenario) resetScenario(scenario[0]);
if (location.pathname === "/_local/valuation-processing") resetScenario("free");

const router = createBrowserRouter([{ element: <PreviewShell />, children: [
  { path: "/_local/workspace", element: <Launcher scenario={scenario} /> },
  { path: "/_local/valuation-processing", element: <LocalValuationProcessingPage /> },
  ...appRoutes,
] }]);
createRoot(document.getElementById("root")!).render(<>
  <AppProvider router={router} queryClient={createAppQueryClient({ retry: false })} authService={previewAuth} appraisalCaseService={previewCaseService}
    adminCaseOperationsDependencies={null} adminDiminishedValueDependencies={null} customerProfileService={previewProfileService} diminishedValueDependencies={null}
    totalLossDependencies={previewDetails} authTurnstileController={{ runWithToken: async (_action, operation) => operation("local-preview") }} />
</>);
