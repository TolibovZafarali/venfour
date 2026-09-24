import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmVehicleDetail } from "./confirm-vehicle-detail";
import { prepareTotalLossIntakeCorrection } from "./intake-correction-api";
import type { TotalLossDetailsService } from "./service";

vi.mock("./intake-correction-api", () => ({ prepareTotalLossIntakeCorrection: vi.fn() }));
const input = { accessToken: "token", userId: "owner", caseId: "case", analysisInputId: "input", field: "drivetrain" as const, value: "FWD" };
function service() {
  return {
    getDetails: vi.fn().mockResolvedValue({ analysisInputId: "input", updatedAt: "original", vehicleFacts: { engine: "2.4L 4 cylinder" }, reportOriginalFilename: "saved.pdf" }),
    updateDetails: vi.fn().mockResolvedValue({ updatedAt: "updated", analysisInputId: "new-input" }),
    confirmIntake: vi.fn().mockResolvedValue({ analysisInputId: "new-input", analysisInputRevision: 2 }),
  };
}
beforeEach(() => vi.clearAllMocks());
describe("confirm one missing vehicle fact", () => {
  it("preserves other facts and the uploaded report while creating a new input revision", async () => {
    const mock = service();
    await expect(confirmVehicleDetail({ ...input, service: mock as unknown as TotalLossDetailsService })).resolves.toMatchObject({ analysisInputId: "new-input" });
    expect(prepareTotalLossIntakeCorrection).toHaveBeenCalledWith({ accessToken: "token", caseId: "case", analysisInputId: "input" });
    expect(mock.updateDetails).toHaveBeenCalledWith({ userId: "owner", caseId: "case", expectedUpdatedAt: "original", changes: { vehicleFacts: { engine: "2.4L 4 cylinder", drivetrain: "FWD" } } });
    expect(mock.confirmIntake).toHaveBeenCalledWith({ userId: "owner", caseId: "case", expectedUpdatedAt: "updated" });
  });
  it("rejects a stale result before unlocking or changing intake", async () => {
    const mock = service();
    mock.getDetails.mockResolvedValue({ analysisInputId: "another-input" });
    await expect(confirmVehicleDetail({ ...input, service: mock as unknown as TotalLossDetailsService })).rejects.toThrow("saved review changed");
    expect(prepareTotalLossIntakeCorrection).not.toHaveBeenCalled();
    expect(mock.updateDetails).not.toHaveBeenCalled();
  });
  it("does not confirm or submit when the guarded update fails", async () => {
    const mock = service();
    mock.updateDetails.mockRejectedValue(new Error("conflict"));
    await expect(confirmVehicleDetail({ ...input, service: mock as unknown as TotalLossDetailsService })).rejects.toThrow("conflict");
    expect(mock.confirmIntake).not.toHaveBeenCalled();
  });
});
