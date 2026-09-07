import type { StaffCaseOperationListItem, StaffTotalLossCaseOperation } from '@/features/admin/case-operations/types';
import type { Session } from '@supabase/supabase-js';
const STAFF_USER_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_USER_ID = "22222222-2222-4222-8222-222222222222";
const CASE_ID = "33333333-3333-4333-8333-333333333333";
const JOB_ID = "55555555-5555-4555-8555-555555555555";
const RUN_ID = "66666666-6666-4666-8666-666666666666";

function listItem(
  overrides: Partial<StaffCaseOperationListItem> = {},
): StaffCaseOperationListItem {
  return {
    caseId: CASE_ID,
    ownerUserId: OWNER_USER_ID,
    customerFullName: "Ada Lovelace",
    verifiedEmail: "ada@example.com",
    ownerIsAnonymous: false,
    contactFullName: "Ada Lovelace",
    contactEmail: "ada@example.com",
    contactEmailVerified: true,
    identityClaimedAt: "2026-08-20T14:05:00.000Z",
    serviceType: "total_loss",
    caseStatus: "draft",
    caseStage: "analysis_failed",
    needsAttention: true,
    caseCreatedAt: "2026-08-20T13:00:00.000Z",
    caseUpdatedAt: "2026-08-21T14:00:00.000Z",
    lastActivityAt: "2026-08-21T15:00:00.000Z",
    reportUploadedAt: "2026-08-20T14:30:00.000Z",
    analysisStatus: "failed",
    analysisAttemptCount: 2,
    analysisRetryable: true,
    analysisFailureCode: "PROVIDER_TIMEOUT",
    analysisProcessingExpiresAt: null,
    ...overrides,
  };
}

function totalLossCase(): StaffTotalLossCaseOperation {
  return {
    ...listItem(),
    serviceType: "total_loss",
    operationalFollowUpAllowed: true,
    intakeMode: "report",
    vin: "1HGCV1F30NA000001",
    vehicleYear: 2022,
    vehicleMake: "Honda",
    vehicleModel: "Accord",
    vehicleTrim: "EX-L",
    mileageAtLoss: 48250,
    postalCode: "60601",
    dateOfLoss: "2026-07-04",
    insurerName: "Example Mutual",
    insurerVehicleValuation: 21450.5,
    vehicleCondition: "Good",
    vehicleOptionsPackages: "Technology package",
    reportProviderName: "Example valuation provider",
    reportExtractionStatus: "confirmed",
    reportExtractionConfidence: 0.91,
    reportExtractedAt: "2026-08-20T13:55:00.000Z",
    reportFactsConfirmedAt: "2026-08-20T14:00:00.000Z",
    analysisInputRevision: 4,
    analysisInputId: "77777777-7777-4777-8777-777777777777",
    intakeCompletedAt: "2026-08-20T14:00:00.000Z",
    detailsCreatedAt: "2026-08-20T13:10:00.000Z",
    detailsUpdatedAt: "2026-08-20T14:30:00.000Z",
    reportOriginalFilename: "valuation.pdf",
    reportStorageOwnerId: OWNER_USER_ID,
    reportStorageObjectPath: `${OWNER_USER_ID}/${CASE_ID}/valuation-report.pdf`,
    analysisJobId: JOB_ID,
    analysisJobCreatedAt: "2026-08-20T14:31:00.000Z",
    analysisJobUpdatedAt: "2026-08-20T14:35:00.000Z",
    analysisJobFinishedAt: "2026-08-20T14:35:00.000Z",
    analysisRunId: RUN_ID,
    analysisRunCreatedAt: "2026-08-20T14:35:00.000Z",
    analysisRunSchemaVersion: "1.0.0",
    analysisVersion: "phase3f",
    discrepancyAnalysisVersion: "1.0.0",
    comparableScoringVersion: "1.0.0",
    analysisClassification: "MATERIAL_UNDERVALUE_SIGNAL",
    analysisEvidenceStrength: "STRONG",
    analysisEvidenceBasis: "CURRENT_MARKET",
  };
}

function sessionFor(): Session {
  return {
    access_token: "staff-access-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 2_000_000_000,
    refresh_token: "staff-refresh-token",
    user: {
      id: STAFF_USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: "staff@example.com",
      email_confirmed_at: "2026-08-19T12:00:00.000Z",
      phone: "",
      confirmed_at: "2026-08-19T12:00:00.000Z",
      last_sign_in_at: "2026-08-19T12:00:00.000Z",
      app_metadata: {},
      user_metadata: { full_name: "Staff Reviewer" },
      identities: [],
      created_at: "2026-08-19T12:00:00.000Z",
      updated_at: "2026-08-19T12:00:00.000Z",
      is_anonymous: false,
    },
  };
}

export const session = sessionFor();
const stages = ['analysis_failed','analysis_processing','analysis_complete','intake_in_progress','report_required','closed'] as const;
const names = ['Maya Chen','Daniel Brooks','Elena Rivera','James Wilson','Sofia Patel','Noah Williams'];
export const cases = stages.map((stage,i) => listItem({
 caseId:`${String(i+10).padStart(8,'0')}-3333-4333-8333-333333333333`,
 customerFullName:names[i],contactFullName:names[i],verifiedEmail:`customer${i+1}@example.com`,contactEmail:`customer${i+1}@example.com`,
 caseStage:stage,caseStatus:stage==='closed'?'closed':stage==='analysis_complete'?'check_complete':stage==='analysis_processing'?'checking':'draft',
 needsAttention:stage==='analysis_failed'||stage==='report_required',
 analysisStatus:stage==='analysis_failed'?'failed':stage==='analysis_processing'?'processing':stage==='analysis_complete'||stage==='closed'?'completed':null,
 analysisFailureCode:stage==='analysis_failed'?'PROVIDER_TIMEOUT':null,
 analysisRetryable:stage==='analysis_failed'?true:null,
 analysisAttemptCount:stage==='analysis_failed'?2:stage.startsWith('analysis_')||stage==='closed'?1:null,
 reportUploadedAt:stage==='report_required'||stage==='intake_in_progress'?null:'2026-09-06T14:30:00.000Z',
 caseCreatedAt:'2026-09-05T13:00:00.000Z',caseUpdatedAt:`2026-09-07T${String(18-i).padStart(2,'0')}:00:00.000Z`,lastActivityAt:`2026-09-07T${String(18-i).padStart(2,'0')}:00:00.000Z`,
 ...(i===3?{ownerIsAnonymous:true,verifiedEmail:null,contactEmailVerified:false,identityClaimedAt:null}:{}),
}));
export function detail(id:string) {
 const item=cases.find(c=>c.caseId===id&&c.serviceType==='total_loss');
 if(!item)return null;
 const completed=item.analysisStatus==='completed';
 return {...totalLossCase(),...item,serviceType:'total_loss' as const,
 reportOriginalFilename:item.reportUploadedAt?'synthetic-valuation.pdf':null,
 reportStorageObjectPath:null,
 analysisJobId:item.analysisStatus?JOB_ID:null,
 analysisJobFinishedAt:item.analysisStatus==='processing'?null:'2026-09-07T14:35:00.000Z',
 analysisRunId:completed?RUN_ID:null,analysisRunCreatedAt:completed?'2026-09-07T14:35:00.000Z':null,
 analysisClassification:completed?'MATERIAL_UNDERVALUE_SIGNAL':null,
 analysisEvidenceStrength:completed?'STRONG':null,analysisEvidenceBasis:completed?'CURRENT_MARKET':null};
}
