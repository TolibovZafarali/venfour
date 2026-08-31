import { Download, ExternalLink, FileText, LoaderCircle } from "lucide-react";

import type { TotalLossPublishedReport } from "../contracts";
import { usePublishedReport } from "../use-published-report";
import { StableActionLabel } from "./stable-action-label";
import "./completed-request.css";

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
    <div className="report-file" data-review-reveal="detail" role="region" aria-label="Evidence package">
      <div className="report-file-document" aria-hidden="true">
        <FileText strokeWidth={1.4} />
        <span>PDF</span>
      </div>
      <div className="report-file-content">
        <p className="report-file-title">Venfour Total-Loss Valuation Evidence Package</p>
        <p className="report-file-meta">PDF · {report.versionLabel} · Issued {report.issueDate}</p>
        <p className="report-file-name">{report.suggestedFilename}</p>
      </div>
      <div className="report-file-actions">
        <button className="request-button request-button-utility" type="button" disabled={pendingAction !== null} onClick={() => void open(true)}>
          {pendingAction === "view" ? <LoaderCircle aria-hidden="true" className="request-spinner" /> : <ExternalLink aria-hidden="true" />}
          <StableActionLabel reserve="View report">{pendingAction === "view" ? "Opening…" : "View report"}</StableActionLabel>
        </button>
        <button className="request-button request-button-utility" type="button" disabled={pendingAction !== null} onClick={() => void open(false)}>
          {pendingAction === "download" ? <LoaderCircle aria-hidden="true" className="request-spinner" /> : <Download aria-hidden="true" />}
          <StableActionLabel reserve="Preparing PDF…">{pendingAction === "download" ? "Preparing PDF…" : "Download PDF"}</StableActionLabel>
        </button>
      </div>
      {pendingAction ? <p className="report-file-status" role="status">Preparing your report</p> : null}
      {error ? <p className="report-file-status request-error" role="alert">{error}</p> : null}
    </div>
  );
}
