import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ postJson: vi.fn(), postAuthenticated: vi.fn(), upload: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ createApiClient: () => mock }));
vi.mock("@/lib/supabase/client", () => ({ supabaseClientState: { status: "available", client: { storage: { from: mock.from } } } }));
import { uploadFullReview } from "./api";
const caseId="22222222-2222-4222-8222-222222222222", reportId="33333333-3333-4333-8333-333333333333";
function file() {
  const bytes=new TextEncoder().encode("%PDF-simulated");
  const value=new File([bytes],"report.pdf",{type:"application/pdf"});
  Object.defineProperty(value,"arrayBuffer",{value:async()=>bytes.buffer});
  return value;
}
beforeEach(() => {
  vi.clearAllMocks();vi.stubGlobal("crypto",{subtle:{digest:vi.fn().mockResolvedValue(new Uint8Array(32).buffer)}});
  mock.from.mockReturnValue({upload:mock.upload});mock.upload.mockResolvedValue({error:null});
  mock.postJson.mockResolvedValue({reportId,bucket:"case-files",path:`11111111-1111-4111-8111-111111111111/${caseId}/review-reports/${reportId}.pdf`});
  mock.postAuthenticated.mockResolvedValue({caseId,stage:"full_review",status:"ready",ready:true,issues:[],message:"Ready",locked:false,canReuseReport:false,report:{id:reportId,filename:"report.pdf",revision:4}});
});
describe("private report upload",()=>{
  it("hashes the PDF, uses a prepared path without overwrite, then extracts",async()=>{
    const pdf=file();expect((await uploadFullReview(caseId,"fixture-token",pdf)).ready).toBe(true);
    expect(mock.postJson).toHaveBeenCalledWith(expect.stringContaining("/report-upload"),expect.objectContaining({byteSize:pdf.size,sha256:expect.stringMatching(/^[a-f0-9]{64}$/)}),{accessToken:"fixture-token"});
    expect(mock.upload).toHaveBeenCalledWith(expect.stringContaining(`/review-reports/${reportId}.pdf`),pdf,{contentType:"application/pdf",upsert:false,cacheControl:"0"});
    expect(mock.postAuthenticated).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("/extract"),{accessToken:"fixture-token"});
  });
  it("does not extract when storage fails or the destination belongs to another case",async()=>{
    mock.upload.mockResolvedValueOnce({error:new Error("failed")});
    await expect(uploadFullReview(caseId,"fixture-token",file())).rejects.toThrow("upload did not finish");
    expect(mock.postAuthenticated).not.toHaveBeenCalled();
    mock.postJson.mockResolvedValueOnce({reportId,bucket:"case-files",path:"another-case/report.pdf"});
    await expect(uploadFullReview(caseId,"fixture-token",file())).rejects.toThrow("destination is invalid");
    expect(mock.upload).toHaveBeenCalledTimes(1);
  });
});
