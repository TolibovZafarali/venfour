import { useRef, useState } from "react";

import { openPublishedReport, reservePublishedReportPreview } from "./browser-actions";
import { useTotalLossReportDownloadMutation } from "./queries";

export function usePublishedReport({
  accessToken,
  caseId,
  reportVersionId,
  userId,
}: {
  readonly accessToken: string;
  readonly caseId: string;
  readonly reportVersionId: string;
  readonly userId: string;
}) {
  const download = useTotalLossReportDownloadMutation({ accessToken, caseId, userId });
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"view" | "download" | null>(null);
  const pending = useRef(false);

  const open = async (preview: boolean) => {
    if (pending.current) return;
    pending.current = true;
    const previewWindow = preview ? reservePublishedReportPreview() : null;
    setError(null);
    setPendingAction(preview ? "view" : "download");
    try {
      const details = await download.mutateAsync({ reportVersionId });
      openPublishedReport(details.downloadUrl, details.suggestedFilename, preview, previewWindow);
    } catch {
      previewWindow?.close();
      setError(`We couldn’t ${preview ? "open" : "download"} the report. Please try again.`);
    } finally {
      pending.current = false;
      setPendingAction(null);
    }
  };

  return { error, pendingAction, open };
}
