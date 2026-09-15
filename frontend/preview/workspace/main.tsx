import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { AppProvider } from "@/app/app-provider";
import { appRoutes } from "@/app/router";
import { createAppQueryClient } from "@/app/query-client";
import { scenarios, resetScenario, installPreviewFetch, previewAuth, previewCaseService, previewDetails } from "./state";
import { Launcher } from "./launcher";
import "./preview.css";

installPreviewFetch();
const requested = new URLSearchParams(location.search).get("state");
const scenario = scenarios.find(item => item[0] === (requested === "approval" ? "ready" : requested));
if (location.pathname === "/_local/workspace" && scenario) resetScenario(scenario[0]);

const router = createBrowserRouter([{ path: "/_local/workspace", element: <Launcher scenario={scenario} /> }, ...appRoutes]);
createRoot(document.getElementById("root")!).render(<>
  <AppProvider router={router} queryClient={createAppQueryClient({ retry: false })} authService={previewAuth} appraisalCaseService={previewCaseService}
    adminCaseOperationsDependencies={null} adminDiminishedValueDependencies={null} customerProfileService={null} diminishedValueDependencies={null}
    totalLossDependencies={previewDetails} authTurnstileController={{ runWithToken: async (_action, operation) => operation("local-preview") }} />
  <aside className="workspace-preview-note" aria-label="Preview notice"><span>Local preview · Fictional data</span><a href="/_local/workspace">All states</a></aside>
</>);
