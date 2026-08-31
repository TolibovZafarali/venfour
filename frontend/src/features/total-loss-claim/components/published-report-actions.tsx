import type { TotalLossPublishedReport } from "../contracts";
import { usePublishedReport } from "../use-published-report";

interface ReportActionProps {
  readonly accessToken: string;
  readonly caseId: string;
  readonly report: TotalLossPublishedReport;
  readonly userId: string;
}

export function ReportFileRow({ report, ...identity }: ReportActionProps) {
  const { error, pendingAction, open } = usePublishedReport({
    ...identity,
    reportVersionId: report.reportId,
  });

  return (
    <div>
      <p>Venfour Total-Loss Valuation Evidence Package</p>
      <p>PDF · {report.versionLabel} · Issued {report.issueDate}</p>
      <p>{report.suggestedFilename}</p>
      <div>
        <button type="button" disabled={pendingAction !== null} onClick={() => void open(true)}>
          {pendingAction === "view" ? "Opening…" : "View report"}
        </button>
        <button type="button" disabled={pendingAction !== null} onClick={() => void open(false)}>
          {pendingAction === "download" ? "Preparing PDF…" : "Download PDF"}
        </button>
      </div>
      {pendingAction ? <p role="status">Preparing your report</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
