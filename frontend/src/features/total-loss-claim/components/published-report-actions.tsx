import { Download, ExternalLink } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { openPublishedReport } from "@/features/total-loss-claim/browser-actions";
import type { TotalLossPublishedReport } from "@/features/total-loss-claim/contracts";
import { useTotalLossReportDownloadMutation } from "@/features/total-loss-claim/queries";
import { WorkflowError } from "@/features/total-loss-claim/components/claim-workflow-shell";

export function PublishedReportActions({
  accessToken,
  caseId,
  report,
  userId,
}: {
  readonly accessToken: string;
  readonly caseId: string;
  readonly report: TotalLossPublishedReport;
  readonly userId: string;
}) {
  const download = useTotalLossReportDownloadMutation({
    accessToken,
    caseId,
    userId,
  });
  const [error, setError] = useState<string | null>(null);

  const open = async (preview: boolean) => {
    setError(null);
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
        "We couldn’t open the report just now. Try again; your published report remains available.",
      );
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={download.isPending}
          onClick={() => void open(true)}
        >
          <ExternalLink className="size-4" aria-hidden />
          Open report
        </Button>
        <Button
          type="button"
          disabled={download.isPending}
          onClick={() => void open(false)}
        >
          <Download className="size-4" aria-hidden />
          {download.isPending ? "Preparing download…" : "Download report"}
        </Button>
      </div>
      {error ? <WorkflowError>{error}</WorkflowError> : null}
    </div>
  );
}
