import { afterEach, describe, expect, it } from "vitest";
import { communicationsService } from "@/features/admin/communications/service";
import { createSyntheticOperationsService } from "./operations-fixtures";
import { installStaffPreview } from "./screen-services";

const originalFetch = window.fetch;
const originalCommunications = { ...communicationsService };
afterEach(() => { window.fetch = originalFetch; Object.assign(communicationsService, originalCommunications); });

describe("current staff preview services", () => {
  it("lists and opens incomplete uploads with the production resource contract", async () => {
    const service = createSyntheticOperationsService("populated");
    const page = await service.list("incomplete_intakes");
    expect(page.total).toBeGreaterThan(0);
    expect(page.items[0].kind).toBe("incomplete_intake");
    expect(await service.record("incomplete_intakes", page.items[0].id)).toMatchObject({ caseId: page.items[0].caseId });
    expect((await createSyntheticOperationsService("empty").list("incomplete_intakes")).items).toEqual([]);
  });

  it("supplies local email delivery history while blocking network requests", async () => {
    installStaffPreview("populated");
    const history = await communicationsService.history("preview");
    expect(history.items.map(item => item.deliveryStatus)).toEqual(["delivered", "accepted", "failed"]);
    expect(history.items.every(item => item.recipient?.endsWith("@example.test"))).toBe(true);
    await expect(fetch("https://example.com")).rejects.toThrow("Network requests are disabled");
    installStaffPreview("empty");
    expect((await communicationsService.history("preview")).items).toEqual([]);
    installStaffPreview("error");
    await expect(communicationsService.history("preview")).rejects.toThrow("Preview service unavailable");
  });
});
