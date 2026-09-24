import { prepareTotalLossIntakeCorrection } from "./intake-correction-api";
import type { TotalLossDetailsService } from "./service";
import { vehicleFacts, type VehicleFactField } from "./vehicle-facts";

export async function confirmVehicleDetail({ service, accessToken, userId, caseId, analysisInputId, field, value }: {
  service: TotalLossDetailsService; accessToken: string; userId: string; caseId: string;
  analysisInputId: string; field: VehicleFactField; value: string;
}) {
  const current = await service.getDetails({ userId, caseId });
  if (!current || current.analysisInputId !== analysisInputId || !service.confirmIntake) {
    throw new Error("The saved review changed. Reload before confirming a detail.");
  }
  const facts = vehicleFacts({ ...current.vehicleFacts, [field]: value.trim() });
  await prepareTotalLossIntakeCorrection({ accessToken, caseId, analysisInputId });
  const updated = await service.updateDetails({ userId, caseId, expectedUpdatedAt: current.updatedAt, changes: { vehicleFacts: facts } });
  return service.confirmIntake({ userId, caseId, expectedUpdatedAt: updated.updatedAt });
}
