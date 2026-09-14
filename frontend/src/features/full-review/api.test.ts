import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ postForm: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ createApiClient: () => mock }));
import { uploadFullReview } from "./api";

const caseId = "22222222-2222-4222-8222-222222222222";
const reportId = "33333333-3333-4333-8333-333333333333";
const ready = { caseId, stage: "full_review", status: "ready", ready: true, issues: [], message: "Ready",
  analysisInputId: "44444444-4444-4444-8444-444444444444", analysisInputRevision: 2, checkoutAvailable: true,
  locked: false, canReuseReport: false, report: { id: reportId, filename: "report.pdf", revision: 4 } };
const pdf = () => new File(["%PDF-simulated"], "report.pdf", { type: "application/pdf" });

beforeEach(() => { vi.clearAllMocks(); mock.postForm.mockResolvedValue(ready); });

describe("private report upload", () => {
  it("sends one authenticated PDF to the owner-checked server upload and extraction boundary", async () => {
    const file = pdf();
    expect(await uploadFullReview(caseId, "fixture-token", file)).toEqual(ready);
    expect(mock.postForm).toHaveBeenCalledOnce();
    const [path, form, options] = mock.postForm.mock.calls[0];
    expect(path).toBe(`/api/v1/appraisal-cases/${caseId}/full-review/report`);
    expect([...form.keys()]).toEqual(["report"]);
    expect(form.get("report")).toMatchObject({ name: "report.pdf", type: "application/pdf", size: file.size });
    expect(options).toEqual({ accessToken: "fixture-token" });
  });

  it("rejects invalid files before transport and preserves server upload failure", async () => {
    await expect(uploadFullReview(caseId, "fixture-token", new File(["text"], "report.txt", { type: "text/plain" }))).rejects.toThrow();
    expect(mock.postForm).not.toHaveBeenCalled();
    mock.postForm.mockRejectedValueOnce(new Error("Upload unavailable"));
    await expect(uploadFullReview(caseId, "fixture-token", pdf())).rejects.toThrow("Upload unavailable");
    expect(mock.postForm).toHaveBeenCalledOnce();
  });

  it("does not accept a response for another case or premature readiness", async () => {
    mock.postForm.mockResolvedValueOnce({ ...ready, caseId: reportId });
    await expect(uploadFullReview(caseId, "fixture-token", pdf())).rejects.toThrow("verify the saved report");
    mock.postForm.mockResolvedValueOnce({ ...ready, status: "uploaded", report: null });
    await expect(uploadFullReview(caseId, "fixture-token", pdf())).rejects.toThrow("verify the saved report");
  });

  it.each([
    { analysisInputId: undefined }, { analysisInputId: "wrong" }, { analysisInputRevision: 0 },
    { analysisInputRevision: true }, { analysisInputRevision: 1.5 }, { checkoutAvailable: undefined },
    { checkoutAvailable: "true" }, { report: { ...ready.report, revision: 0 } },
  ])("fails closed on malformed continuation metadata %o", async override => {
    mock.postForm.mockResolvedValueOnce({ ...ready, ...override });
    await expect(uploadFullReview(caseId, "fixture-token", pdf())).rejects.toThrow("verify the saved report");
  });

  it("preserves a saved legacy review with unavailable input identity", async () => {
    const legacy = { ...ready, analysisInputId: null, analysisInputRevision: null, checkoutAvailable: false };
    mock.postForm.mockResolvedValueOnce(legacy);
    await expect(uploadFullReview(caseId, "fixture-token", pdf())).resolves.toEqual(legacy);
  });
});
