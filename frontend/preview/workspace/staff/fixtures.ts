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
const stages = ['analysis_failed','analysis_processing','analysis_complete','intake_in_progress','analysis_complete','closed'] as const;
const names = ['Maya Chen','Daniel Brooks','Elena Rivera','James Wilson','Sofia Patel','Noah Williams'];
const activityTimes = ['18','19','19','17','15','20'];
const vehicleFacts = [
  { vehicleYear:2022,vehicleMake:'Honda',vehicleModel:'Accord',vehicleTrim:'EX-L',mileageAtLoss:48250,vin:'1HGCV1F30NA000001' },
  { vehicleYear:2021,vehicleMake:'Toyota',vehicleModel:'Camry',vehicleTrim:'SE',mileageAtLoss:61700,vin:'4T1G11AK1MU000002' },
  { vehicleYear:2023,vehicleMake:'Mazda',vehicleModel:'CX-5',vehicleTrim:'Touring',mileageAtLoss:28100,vin:'JM3KFBCM1P0000003' },
  { vehicleYear:2020,vehicleMake:'Subaru',vehicleModel:'Outback',vehicleTrim:'Limited',mileageAtLoss:null,vin:null },
  { vehicleYear:2022,vehicleMake:'Hyundai',vehicleModel:'Tucson',vehicleTrim:'SEL',mileageAtLoss:35600,vin:'5NMJB3AE1NH000005' },
  { vehicleYear:2021,vehicleMake:'Honda',vehicleModel:'CR-V',vehicleTrim:'EX',mileageAtLoss:53800,vin:'7FARW1H51ME000006' },
];
export const cases = stages.map((stage,i) => listItem({
  caseId:`${String(i+10).padStart(8,'0')}-3333-4333-8333-333333333333`,
  ownerUserId:`${String(i+20).padStart(8,'0')}-2222-4222-8222-222222222222`,
  customerFullName:i===3?null:names[i],contactFullName:names[i],verifiedEmail:i===3?null:`customer${i+1}@example.com`,contactEmail:`customer${i+1}@example.com`,
  ownerIsAnonymous:i===3,contactEmailVerified:i!==3,identityClaimedAt:i===3?null:'2026-09-06T14:40:00.000Z',
  caseStage:stage,caseStatus:stage==='closed'?'closed':stage==='analysis_complete'?'paid':stage==='analysis_processing'?'checking':'draft',
  needsAttention:stage==='analysis_failed',
  analysisStatus:stage==='analysis_failed'?'failed':stage==='analysis_processing'?'processing':stage==='analysis_complete'||stage==='closed'?'completed':null,
  analysisFailureCode:stage==='analysis_failed'?'PROVIDER_TIMEOUT':null,
  analysisRetryable:stage==='analysis_failed'?true:null,
  analysisAttemptCount:stage==='analysis_failed'?2:stage.startsWith('analysis_')||stage==='closed'?1:null,
  analysisProcessingExpiresAt:stage==='analysis_processing'?'2026-09-07T21:15:00.000Z':null,
  reportUploadedAt:stage==='intake_in_progress'?null:'2026-09-06T14:30:00.000Z',
  caseCreatedAt:'2026-09-05T13:00:00.000Z',caseUpdatedAt:`2026-09-07T${activityTimes[i]}:00:00.000Z`,lastActivityAt:`2026-09-07T${activityTimes[i]}:00:00.000Z`,
}));
export const largeCases = Array.from({length:57},(_,i)=>listItem({
  ...cases[i%cases.length],caseId:`${String(700+i).padStart(8,'0')}-1000-4000-8000-000000000001`,
  contactFullName:`Sample customer ${i+7}`,customerFullName:cases[i%cases.length].ownerIsAnonymous?null:`Sample customer ${i+7}`,
}));

export function detail(id:string): StaffTotalLossCaseOperation | null {
  const allCases=[...cases,...largeCases];
  const index=allCases.findIndex(c=>c.caseId===id&&c.serviceType==='total_loss');
  if(index<0)return null;
  const item=allCases[index];
  const scenario=index%cases.length;
  const completed=item.analysisStatus==='completed';
  const hasReport=Boolean(item.reportUploadedAt);
  const hasJob=item.analysisStatus!==null;
  const jobId=`${String(900+index).padStart(8,'0')}-1000-4000-8000-000000000001`;
  const runId=`${String(1000+index).padStart(8,'0')}-1000-4000-8000-000000000001`;
  return {...totalLossCase(),...item,...vehicleFacts[scenario],serviceType:'total_loss',
    operationalFollowUpAllowed:item.ownerIsAnonymous?null:true,
    intakeMode:scenario===3?'manual':'report',
    dateOfLoss:scenario===3?null:'2026-09-03',postalCode:scenario===3?null:'60601',
    insurerName:scenario===3?null:'Example Mutual',insurerVehicleValuation:scenario===3?null:21450.5,
    vehicleCondition:scenario===3?null:'Good',vehicleOptionsPackages:scenario===3?null:'Technology package',
    detailsCreatedAt:'2026-09-05T13:10:00.000Z',detailsUpdatedAt:hasReport?'2026-09-06T15:00:00.000Z':item.lastActivityAt,
    intakeCompletedAt:hasReport?'2026-09-06T15:00:00.000Z':null,
    reportOriginalFilename:hasReport?'synthetic-valuation.pdf':null,reportStorageOwnerId:hasReport?item.ownerUserId:null,
    reportStorageObjectPath:hasReport?`${item.ownerUserId}/${id}/valuation-report.pdf`:null,
    reportProviderName:hasReport?'Example valuation provider':null,reportExtractionStatus:hasReport?'confirmed':null,
    reportExtractionConfidence:hasReport?0.91:null,reportExtractedAt:hasReport?'2026-09-06T14:35:00.000Z':null,
    reportFactsConfirmedAt:hasReport?'2026-09-06T15:00:00.000Z':null,
    analysisInputRevision:hasReport?1:null,analysisInputId:hasReport?`${String(1100+index).padStart(8,'0')}-1000-4000-8000-000000000001`:null,
    analysisJobId:hasJob?jobId:null,analysisJobCreatedAt:hasJob?'2026-09-06T15:01:00.000Z':null,
    analysisJobUpdatedAt:hasJob?(item.analysisStatus==='processing'?item.lastActivityAt:'2026-09-06T15:05:00.000Z'):null,
    analysisJobFinishedAt:hasJob&&item.analysisStatus!=='processing'?'2026-09-06T15:05:00.000Z':null,
    analysisRunId:completed?runId:null,analysisRunCreatedAt:completed?'2026-09-06T15:05:00.000Z':null,
    analysisRunSchemaVersion:completed?'1.0.0':null,analysisVersion:completed?'phase3f':null,
    discrepancyAnalysisVersion:completed?'1.0.0':null,comparableScoringVersion:completed?'1.0.0':null,
    analysisClassification:completed?'MATERIAL_UNDERVALUE_SIGNAL':null,
    analysisEvidenceStrength:completed?'STRONG':null,analysisEvidenceBasis:completed?'CURRENT_MARKET':null};
}
