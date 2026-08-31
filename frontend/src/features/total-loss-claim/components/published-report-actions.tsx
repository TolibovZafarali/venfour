import { Download, ExternalLink, FileText } from "lucide-react";
import { useState } from "react";

import { openPublishedReport } from "../browser-actions";
import type { TotalLossPublishedReport } from "../contracts";
import { useTotalLossReportDownloadMutation } from "../queries";

interface ReportActionProps {
  readonly accessToken: string;
  readonly caseId: string;
  readonly report: TotalLossPublishedReport;
  readonly userId: string;
  readonly compact?: boolean;
}

export function PublishedReportActions({
  accessToken,
  caseId,
  report,
  userId,
  compact = false,
}: ReportActionProps) {
  const download = useTotalLossReportDownloadMutation({
    accessToken,
    caseId,
    userId,
  });
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<
    "view" | "download" | null
  >(null);
  const open = async (preview: boolean) => {
    if (pendingAction) return;
    setError(null);
    setPendingAction(preview ? "view" : "download");
    try {
      const details = await download.mutateAsync({
        reportVersionId: report.reportId,
      });
      openPublishedReport(
        details.downloadUrl,
        details.suggestedFilename,
        preview,
      );
    } catch {
      setError(
        `We couldn’t ${preview ? "open" : "download"} the report. Please try again.`,
      );
    } finally {
      setPendingAction(null);
    }
  };
  return (
    <div className="case-report-actions">
      <div className="case-utility-actions">
        <button
          type="button"
          className="case-button"
          data-variant="text"
          disabled={pendingAction !== null}
          onClick={() => void open(true)}
        >
          <ExternalLink aria-hidden />
          {pendingAction === "view"
            ? "Opening…"
            : compact
              ? "View"
              : "View report"}
        </button>
        <button
          type="button"
          className="case-button"
          data-variant="text"
          disabled={pendingAction !== null}
          onClick={() => void open(false)}
        >
          <Download aria-hidden />
          {pendingAction === "download"
            ? "Preparing PDF…"
            : compact
              ? "Download"
              : "Download PDF"}
        </button>
      </div>
      {pendingAction && (
        <span className="sr-only" role="status">
          Preparing your report
        </span>
      )}
      {error && (
        <p className="case-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ReportFileRow(props: ReportActionProps) {
  const { report } = props;
  return (
    <div className="case-report-file">
      <div className="case-file-heading">
        <FileText aria-hidden />
        <div>
          <h2>Venfour Total-Loss Valuation Evidence Package</h2>
          <p>
            PDF · {report.versionLabel} · Issued {report.issueDate}
          </p>
        </div>
      </div>
      <PublishedReportActions {...props} compact />
      <details className="case-file-details">
        <summary>File details</summary>
        <p>{report.suggestedFilename}</p>
      </details>
    </div>
  );
}
