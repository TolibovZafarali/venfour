import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createPaymentApprovalService, parsePaymentApprovalCase } from "./service";

import { approvalFixture } from "./test-fixtures";

describe("staff payment approval service", () => {
  it("sends only the exact reviewed lineage, decision, and idempotency identity", async () => {
    const row = approvalFixture(), item = parsePaymentApprovalCase(row);
    const rpc = vi.fn().mockResolvedValueOnce({ data: [row], error: null }).mockResolvedValueOnce({ data: {
      id: row.caseId, decision: "approved", createdAt: "2026-09-15T00:00:00Z",
    }, error: null });
    const service = createPaymentApprovalService({ rpc } as unknown as SupabaseClient<Database>);
    expect(await service.list()).toEqual([item]);
    await service.decide(item, "approved", row.caseId);
    expect(rpc).toHaveBeenLastCalledWith("staff_payment_approval_decide", {
      requested_case_id: item.caseId, expected_lineage: item.lineage, requested_decision: "approved", requested_request_id: row.caseId,
    });
  });
  it.each(["inputRevision", "reportId", "assessmentDigest", "ownerId"])("rejects malformed or cross-case %s metadata", key => {
    const row = approvalFixture();
    expect(() => parsePaymentApprovalCase({ ...row, lineage: { ...row.lineage, [key]: "invalid" } })).toThrow();
  });
  it("rejects insufficient rows and preserves server authorization denial", async () => {
    const row = approvalFixture();
    expect(() => parsePaymentApprovalCase({ ...row, evidenceStrength: "LOW" })).toThrow();
    const error = { code: "42501" }, rpc = vi.fn().mockResolvedValue({ data: null, error });
    const service = createPaymentApprovalService({ rpc } as unknown as SupabaseClient<Database>);
    await expect(service.list()).rejects.toBe(error);
    await expect(service.decide(parsePaymentApprovalCase(row), "approved", row.caseId)).rejects.toBe(error);
  });
});
