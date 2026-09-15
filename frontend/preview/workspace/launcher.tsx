import { Navigate } from "react-router";
import { scenarios, scenarioPath } from "./state";
export function Launcher({ scenario }: { scenario?: typeof scenarios[number] }) {
  if (scenario) return <Navigate replace to={scenarioPath(scenario[0])} />;
  return <div className="preview-launcher"><h1>One appraisal. One workspace.</h1><p>Local visual review with fictional cases. These screens use the customer routes and components. Uploads, login, processing, and payment are simulated in this browser; no provider, production, or payment service is connected.</p><nav aria-label="Workspace preview states">{scenarios.map(([state, title, description]) => <a key={state} href={`/_local/workspace?state=${state}`}><strong>{title}</strong><span>{description}</span></a>)}</nav><p>The free-result fixture continues to upload. Uploading a PDF simulates extraction, fact confirmation, and automated eligibility checks. Refresh restores the simulated stage.</p></div>;
}
