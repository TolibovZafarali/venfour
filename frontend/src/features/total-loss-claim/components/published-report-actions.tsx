import { Download, ExternalLink, FileText, LoaderCircle } from "lucide-react";

import type { TotalLossPublishedReport } from "../contracts";
import { dateLabel } from "../report-format";
import { usePublishedReport } from "../use-published-report";
import { StableActionLabel } from "./stable-action-label";
import "./completed-request.css";

interface ReportActionProps {
  readonly accessToken: string;
  readonly caseId: string;
  readonly report: TotalLossPublishedReport;
  readonly userId: string;
  readonly variant?: "default" | "attachment";
}

export function ReportFileRow({ report, variant = "default", ...identity }: ReportActionProps) {
  const { error, pendingAction, open } = usePublishedReport({
    ...identity,
    reportVersionId: report.reportId,
  });
  const attachment = variant === "attachment";
  const viewAction = (
    <button key="view" className={`request-button ${attachment ? "request-button-text" : "request-button-utility"}`} type="button" disabled={pendingAction !== null} onClick={() => void open(true)}>
      {pendingAction === "view" ? <LoaderCircle aria-hidden="true" className="request-spinner" /> : <ExternalLink aria-hidden="true" />}
      <StableActionLabel reserve="View report">{pendingAction === "view" ? "Opening…" : "View report"}</StableActionLabel>
    </button>
  );
  const downloadAction = (
    <button key="download" className={`request-button ${attachment ? "request-button-secondary" : "request-button-utility"}`} type="button" disabled={pendingAction !== null} onClick={() => void open(false)}>
      {pendingAction === "download" ? <LoaderCircle aria-hidden="true" className="request-spinner" /> : <Download aria-hidden="true" />}
      <StableActionLabel reserve="Preparing report…">{pendingAction === "download" ? "Preparing report…" : "Download report"}</StableActionLabel>
    </button>
  );

  return (
    <div className={`report-file${attachment ? " report-file-attachment" : ""}`} data-review-entrance="supporting" role="region" aria-label="Valuation report">
      <div className="report-file-document" aria-hidden="true">
        <FileText strokeWidth={1.4} />
        <span>PDF</span>
      </div>
      <div className="report-file-content">
        <p className="report-file-title">{attachment ? "Valuation report" : "Your valuation report"}</p>
        <p className="report-file-meta">PDF report · Issued {dateLabel(report.issueDate)}</p>
      </div>
      <div className="report-file-actions">
        {attachment ? [downloadAction, viewAction] : [viewAction, downloadAction]}
      </div>
      {pendingAction ? <p className="report-file-status" role="status">Preparing your report…</p> : null}
      {error ? <p className="report-file-status request-error" role="alert">{error}</p> : null}
    </div>
  );
}
