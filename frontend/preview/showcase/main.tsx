import { createRoot } from "react-dom/client";
import { createBrowserRouter, Outlet } from "react-router";
import { AppProvider } from "@/app/app-provider";
import { appRoutes } from "@/app/router";
import { createAppQueryClient } from "@/app/query-client";
import { SignInDialogProvider } from "@/features/auth";
import { FreeValuationProcessingProvider } from "@/features/analyses/components/free-valuation-processing";
import { manifest, resultPath, installShowcaseFetch, resetShowcase, previewAuth, caseService, profileService, details } from "./state";
import "./showcase.css";

installShowcaseFetch();
const params = new URLSearchParams(location.search);
if (params.has("reset")) resetShowcase();
if (params.has("openAll")) resetShowcase(true);

export function Intro() {
  return <main className="showcase-intro">
    <p className="showcase-eyebrow">Venfour · Local historical showcase</p>
    <h1>{manifest.title}</h1>
    <p className="showcase-lead">A real insurer report. Saved market evidence. A result you can explain.</p>
    <p>This case shows a $19,046 insurer value alongside nine selected historical comparables. The saved review found no material discrepancy. Use it to demonstrate how Venfour explains the evidence, including when it does not support a higher request.</p>
    <div className="showcase-actions"><a className="showcase-primary" href={resultPath}>Start the walkthrough →</a><a href="/_local/showcase?reset=1">Reset walkthrough</a></div>
    <h2>What to show</h2>
    <ol><li>Read the result and the distinction between asking prices and settlement amounts.</li><li>Open the insurer’s comparables and their disclosed adjustments.</li><li>Compare historical evidence with the separate then-current market context.</li><li>Review the conclusion and the locally generated summary.</li></ol>
    <div className="showcase-actions"><a href="/generated/insurer-report-redacted.pdf" target="_blank" rel="noreferrer">Open redacted original report excerpt</a><a href="/generated/Venfour_Local_Historical_Showcase.pdf" target="_blank" rel="noreferrer">Open showcase summary</a></div>
    <details className="showcase-provenance" open><summary>Source, redaction and demonstration limits</summary><p>{manifest.provenance}</p><ul>{manifest.limitations.map(text => <li key={text}>{text}</li>)}</ul><p>{manifest.redaction}</p><p>The original selected run is {manifest.sourceRunId}, captured {manifest.capturedAt.slice(0, 10)}. The display adapter preserves its classification, counts, selected prices and weights.</p><a href="/generated/case.json" target="_blank" rel="noreferrer">Inspect sanitized values and source checksums</a></details>
  </main>;
}
export function Shell() {
  return <><aside className="showcase-notice" aria-label="Local showcase notice"><strong>Local historical showcase · Genuine data, sanitized</strong><span>Account, payment and progress are simulated. Saved result: no material discrepancy.</span><nav><a href="/_local/showcase">Source & limits</a><a href="/_local/showcase?reset=1">Reset walkthrough</a><a href={resultPath + "?openAll=1"}>Unlock review sections</a></nav></aside><SignInDialogProvider><FreeValuationProcessingProvider><Outlet /></FreeValuationProcessingProvider></SignInDialogProvider></>;
}
const router = createBrowserRouter([{ element: <Shell />, children: [{ path: "/_local/showcase", element: <Intro /> }, ...appRoutes] }]);
createRoot(document.getElementById("root")!).render(<AppProvider router={router} queryClient={createAppQueryClient({ retry: false })} authService={previewAuth} appraisalCaseService={caseService} customerProfileService={profileService} totalLossDependencies={details} adminCaseOperationsDependencies={null} adminDiminishedValueDependencies={null} diminishedValueDependencies={null} authTurnstileController={{ runWithToken: async () => { throw new Error("Sign-in is not required for the local showcase."); } }} />);
