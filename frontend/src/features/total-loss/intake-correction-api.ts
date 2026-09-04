import { environment } from "@/config/env";
import { createApiClient } from "@/lib/api/client";

const apiClient = createApiClient({ baseUrl: environment.apiBaseUrl });

export async function prepareTotalLossIntakeCorrection({
  accessToken,
  analysisInputId,
  caseId,
}: {
  readonly accessToken: string;
  readonly analysisInputId: string;
  readonly caseId: string;
}) {
  const response = await apiClient.postJson<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/intake-correction`,
    { analysisInputId },
    { accessToken },
  );
  if (
    !response ||
    typeof response !== "object" ||
    !("caseId" in response) ||
    response.caseId !== caseId ||
    !("analysisInputId" in response) ||
    response.analysisInputId !== analysisInputId
  ) {
    throw new Error("The saved intake changed. Reload it before correcting it.");
  }
}
