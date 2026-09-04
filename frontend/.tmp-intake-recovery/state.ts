import {materialUndervalueAnalysis} from '@/test/fixtures/analysis-presentation';
import {TotalLossDetailsConflictError} from '@/features/total-loss/service';
import {CURRENT_PRIVACY_NOTICE_VERSION,CURRENT_SERVICE_TERMS_VERSION} from '@/features/customer-profile/types';

export const USER_ID='14141414-1414-4414-8414-141414141414';
export const CASES={failure:'21212121-2121-4121-8121-212121212121',missing:'22222222-2222-4222-8222-222222222222',offer:'23232323-2323-4323-8323-232323232323',report:'24242424-2424-4424-8424-242424242424',insufficient:'25252525-2525-4525-8525-252525252525',resumeManual:'26262626-2626-4626-8626-262626262626',resumeReport:'27272727-2727-4727-8727-272727272727'} as const;
const INITIAL_AT='2026-09-02T12:00:00.000Z';
const STORAGE='venfour.local-intake-recovery.evidence.v1';
const clone=<T,>(value:T):T=>structuredClone(value);
const params=new URLSearchParams(location.search);
const requested=params.get('scenario');
export const scenario=(requested&&requested in CASES?requested:sessionStorage.getItem('intake-recovery-scenario')||'failure') as keyof typeof CASES;
sessionStorage.setItem('intake-recovery-scenario',scenario);
const timestamp=()=>new Date().toISOString();
function seed(){
 const rows:any={};const inputs:any={};const jobs:any={};const contacts:any={};const caseStatuses:any={};
 for(const [name,id] of Object.entries(CASES)){
  const report=name==='report'||name==='resumeReport';const resume=name==='resumeManual'||name==='resumeReport';const offer=name==='missing'||name==='insufficient'?null:19046;
  const inputId=crypto.randomUUID();
  rows[id]={caseId:id,intakeMode:report?'report':'manual',vin:null,vehicleYear:2022,vehicleMake:'Toyota',vehicleModel:'Camry',vehicleTrim:'SE',vehicleConfiguration:null,mileageAtLoss:48000,postalCode:'60611',dateOfLoss:'2026-08-10',insurerName:'Example Insurance',insurerVehicleValuation:offer,vehicleCondition:'Good',optionsPackages:'Factory equipment',reportProvider:report?'CCC':null,reportExtractionStatus:report?'confirmed':'not_requested',reportExtractionConfidence:report?1:null,reportExtractedAt:report?INITIAL_AT:null,reportFactsConfirmedAt:report?INITIAL_AT:null,analysisInputRevision:1,analysisInputId:inputId,reportStorageOwnerId:report?USER_ID:null,reportUploadRecoveryRequired:false,reportOriginalFilename:report?'synthetic-valuation.pdf':null,reportUploadedAt:report?INITIAL_AT:null,intakeCompletedAt:INITIAL_AT,createdAt:INITIAL_AT,updatedAt:INITIAL_AT};
  inputs[inputId]=clone(rows[id]);caseStatuses[id]=name==='failure'||resume?'draft':'check_complete';
  jobs[id]={inputId,status:name==='failure'?'failed':resume?'not_submitted':'completed',attemptCount:resume?0:1,runId:resume?null:crypto.randomUUID(),error:{code:'UNSUPPORTED_VEHICLE',message:'Review the saved vehicle information before requesting another analysis.'},retryable:false};
  contacts[id]={caseId:id,firstName:'Taylor',lastName:'Recovery',fullName:'Taylor Recovery',email:'taylor.recovery@example.com',phoneNumber:'+13125550142',emailVerifiedAt:INITIAL_AT,serviceTermsVersion:CURRENT_SERVICE_TERMS_VERSION,serviceTermsAcknowledgedAt:INITIAL_AT,privacyNoticeVersion:CURRENT_PRIVACY_NOTICE_VERSION,privacyNoticeAcknowledgedAt:INITIAL_AT,operationalFollowUpAllowed:false,operationalFollowUpUpdatedAt:INITIAL_AT,createdAt:INITIAL_AT,updatedAt:INITIAL_AT};
 }
 return {rows,inputs,jobs,contacts,caseStatuses,reopenedInputs:{},historicalJobs:[],events:[],createdCases:0,analysisSubmissions:0};
}
if(params.has('reset')){
 localStorage.removeItem(STORAGE);
 localStorage.removeItem('venfour.totalLossDraft.v1');
}
export let state:any=JSON.parse(localStorage.getItem(STORAGE)||'null')||seed();
function persist(){localStorage.setItem(STORAGE,JSON.stringify(state));window.dispatchEvent(new Event('intake-recovery-evidence'));}
export function log(event:string,detail:any={}){state.events.push({at:timestamp(),event,...detail});persist();}
persist();
if(location.pathname==='/'){
 const next=params.get('entry')==='correction'?`/start?service=total-loss&caseId=${CASES[scenario]}&intent=correct-intake`:params.get('entry')==='resume'?`/start?service=total-loss&caseId=${CASES[scenario]}&view=intake`:`/total-loss/cases/${CASES[scenario]}/analysis`;
 history.replaceState(null,'',next);
}
function owned(input:any){
 if(input.userId!==USER_ID||!state.rows[input.caseId])throw new Error('Synthetic ownership boundary denied the request.');
 return state.rows[input.caseId];
}
function caseRow(id:string){return {id,userId:USER_ID,serviceType:'total_loss',status:state.caseStatuses[id],createdAt:INITIAL_AT,updatedAt:state.rows[id].updatedAt,lastActivityAt:state.rows[id].updatedAt};}
const blocked=async()=>{throw new Error('Operation outside intake recovery fixture scope.');};
function saved(input:any){
 const current=owned(input);if(current.updatedAt!==input.expectedUpdatedAt)throw new TotalLossDetailsConflictError(clone(current));
 if(state.caseStatuses[input.caseId]!=='draft')throw new Error('Only draft appraisals can be updated. Explicit authoritative recovery is required.');
 const changes=input.values??input.changes;
 const changed=Object.keys(changes).filter(key=>JSON.stringify(current[key]??null)!==JSON.stringify(changes[key]??null));
 let next={...current,...changes,updatedAt:timestamp()};
 if(changed.length){
  const nextId=crypto.randomUUID();
  next={...next,analysisInputId:nextId,analysisInputRevision:current.analysisInputRevision+1,intakeCompletedAt:null};
  state.inputs[nextId]=clone(next);
 }
 state.rows[input.caseId]=next;
 log('saveDetails',{caseId:input.caseId,expectedUpdatedAt:input.expectedUpdatedAt,changed,inputId:next.analysisInputId,inputRevision:next.analysisInputRevision,offer:next.insurerVehicleValuation,mileage:next.mileageAtLoss});
 return clone(next);
}
export const dependencies:any={
 appraisalCaseService:{
  createAppraisalCase:async()=>{state.createdCases++;persist();throw new Error('Unexpected duplicate-case creation.');},
  createOrGetAppraisalCase:async(input:any)=>{owned(input);log('createOrGetExistingCase',{caseId:input.caseId});return caseRow(input.caseId);},
  listAppraisalCases:async()=>Object.keys(state.rows).map(caseRow),
  getRecentDraftAppraisalCase:async()=>null,
  getOrCreateTotalLossDraft:async()=>{log('getExistingDraft',{caseId:CASES[scenario]});return caseRow(CASES[scenario]);},
  getAppraisalCase:async(input:any)=>{owned(input);log('getCase',{caseId:input.caseId});return caseRow(input.caseId);},
  touchAppraisalCase:async(input:any)=>{owned(input);return caseRow(input.caseId);},
 },
 totalLossDetailsService:{
  getDetails:async(input:any)=>{const row=owned(input);log('getDetails',{caseId:input.caseId,inputId:row.analysisInputId,inputRevision:row.analysisInputRevision});return clone(row);},
  createDetails:blocked,updateDetails:async(input:any)=>saved(input),saveDetails:async(input:any)=>saved(input),
  confirmIntake:async(input:any)=>{const row=owned(input);if(row.updatedAt!==input.expectedUpdatedAt)throw new TotalLossDetailsConflictError(clone(row));const next={...row,intakeCompletedAt:timestamp(),updatedAt:timestamp()};state.rows[input.caseId]=next;log('confirmIntake',{caseId:input.caseId,inputId:row.analysisInputId,inputRevision:row.analysisInputRevision,offer:row.insurerVehicleValuation});return clone(next);},
  acquireReportUploadLease:blocked,reclaimReportUploadLease:blocked,renewReportUploadLease:blocked,markReportUploadReady:blocked,completeReportUploadRecovery:blocked,finalizeReportUpload:blocked,cancelReportUpload:blocked,
 },
 totalLossIdentityService:{
  getContact:async(caseId:string)=>{log('getContact',{caseId});return clone(state.contacts[caseId]);},
  saveContactAndBeginClaim:async(input:any)=>{owned(input);const contact={...state.contacts[input.caseId],...input,fullName:`${input.firstName} ${input.lastName}`,updatedAt:timestamp()};state.contacts[input.caseId]=contact;log('saveContact',{caseId:input.caseId,email:input.email,firstName:input.firstName,lastName:input.lastName,phoneNumber:input.phoneNumber});return {claimId:null,expiresAt:null,contact:clone(contact)};},
  completeIdentityClaim:async()=>{},
 },
 totalLossReportStorageService:{downloadReport:blocked,downloadReportBackup:blocked,storeReportBackup:blocked,restoreReport:blocked,deleteReportBackup:blocked,uploadReport:blocked},
 vehicleLookupService:{
  decodeVin:async(vin:string)=>({vin,year:2022,make:'Toyota',model:'Camry',trim:'SE'}),
  listMakes:async()=>['Honda','Toyota'],listModels:async()=>['Camry','Corolla'],
  listTrims:async()=>['LE','SE','XLE'].map(label=>({source:'synthetic',id:`trim-${label}`,label,trim:label,queryField:'trim',queryValues:[label]})),
 },
};
function presentation(id:string,job:any){
 const input=state.inputs[job.inputId];const output:any=clone(materialUndervalueAnalysis);
 const manual=input.intakeMode==='manual';const missing=input.insurerVehicleValuation===null;
 output.runId=job.runId;output.vehicle={...output.vehicle,year:input.vehicleYear,make:input.vehicleMake,model:input.vehicleModel,trim:input.vehicleTrim,mileage:input.mileageAtLoss,lossDate:input.dateOfLoss,postalCode:input.postalCode};
 if(manual){
  Object.assign(output.analysisScope,{inputMode:'MANUAL',reportAvailable:false,reportExtractionAvailable:false,reportReviewPerformed:false,reportProvider:null,reportAdapter:null,partialExtraction:false,reportComparablesAvailable:false,reportAdjustmentsAvailable:false,insurerValuationAvailable:!missing,insurerValuationComparisonPerformed:!missing,offerComparisonPerformed:!missing});
  output.reportReview=null;output.insurerValuation.source=missing?'NONE':'CUSTOMER_ENTERED';
 }
 if(missing){
  output.insurerValuation.value={cents:null,display:'Not provided'};output.insurerValuation.comparisonToPrimaryEvidence=null;
  output.assessment={...output.assessment,classification:'INSUFFICIENT_EVIDENCE',classificationLabel:'Insufficient evidence',summary:'An insurer offer is required to complete the comparison.'};
  output.findings=[{code:'MISSING_CCC_VEHICLE_VALUATION',label:'Insurer offer not supplied',description:'The manual vehicle details were supplied without an insurer offer.'}];
 }else{output.insurerValuation.value={cents:Math.round(input.insurerVehicleValuation*100),display:`$${input.insurerVehicleValuation.toLocaleString('en-US')}.00`};}
 if(id===CASES.insufficient){output.primaryExternalEvidence=null;output.analysisScope.marketEvidenceAvailable=false;output.findings.push({code:'INSUFFICIENT_RESOLVED_EXTERNAL_EVIDENCE',label:'Not enough independent evidence',description:'The independent market evidence is insufficient.'});}
 return output;
}
function response(data:any,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
function statusFor(id:string){
 const job=state.jobs[id];const row=state.rows[id];
 if(job.inputId!==row.analysisInputId||job.status==='not_submitted')return {status:'not_submitted'};
 if(job.status==='processing'&&Date.now()>=job.completeAt){job.status='completed';state.caseStatuses[id]='check_complete';log('analysisCompleted',{caseId:id,inputId:job.inputId,inputRevision:row.analysisInputRevision,runId:job.runId});}
 const {status,attemptCount,runId,error,retryable}=job;
 return status==='completed'?{status,attemptCount,runId}:status==='failed'?{status,attemptCount,error,retryable}:{status,attemptCount,processingExpiresAt:new Date(Date.now()+300000).toISOString()};
}
const nativeFetch=globalThis.fetch.bind(globalThis);
globalThis.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.origin);
 if(url.origin!==location.origin)throw new Error('External network disabled for isolated local intake verification.');
 if(!url.pathname.startsWith('/api/'))return nativeFetch(input,init);
 const method=init?.method||'GET';
 const correction=url.pathname.match(/^\/api\/v1\/appraisal-cases\/([^/]+)\/intake-correction$/);
 if(correction){
  const id=correction[1];const row=state.rows[id];const body=JSON.parse(String(init?.body||'{}'));
  const authorization=new Headers(init?.headers).get('Authorization');
  if(authorization!=='Bearer local-intake-verification-token')return response({error:{code:'UNAUTHORIZED',message:'Authentication required.'}},401);
  if(method!=='POST'||!row)return response({error:{code:'NOT_FOUND',message:'Unknown synthetic correction route.'}},404);
  if(body.analysisInputId!==row.analysisInputId)return response({error:{code:'INTAKE_CORRECTION_CONFLICT',message:'The saved intake changed. Reload before correcting.'}},409);
  state.reopenedInputs??={};state.historicalJobs??=[];
  const job=state.jobs[id];
  const failedDraft=state.caseStatuses[id]==='draft'&&job.status==='failed'&&!job.retryable&&job.inputId===row.analysisInputId;
  const unsubmittedDraft=state.caseStatuses[id]==='draft'&&row.intakeCompletedAt!==null&&statusFor(id).status==='not_submitted'&&(row.intakeMode==='manual'||row.intakeMode==='report');
  const eligibleMissingOffer=state.caseStatuses[id]==='check_complete'&&job.status==='completed'&&job.inputId===row.analysisInputId&&id===CASES.missing&&row.intakeMode==='manual'&&row.insurerVehicleValuation===null;
  const replay=state.caseStatuses[id]==='draft'&&state.reopenedInputs[id]===row.analysisInputId;
  if(!failedDraft&&!unsubmittedDraft&&!eligibleMissingOffer&&!replay)return response({error:{code:'INTAKE_CORRECTION_UNAVAILABLE',message:'This result is not eligible for intake recovery.'}},409);
  state.caseStatuses[id]='draft';state.reopenedInputs[id]=row.analysisInputId;
  log('beginIntakeCorrection',{caseId:id,inputId:row.analysisInputId,inputRevision:row.analysisInputRevision,replay,previousCaseStatus:eligibleMissingOffer?'check_complete':'draft',analysisSubmissions:state.analysisSubmissions});
  return response({caseId:id,analysisInputId:row.analysisInputId});
 }
 const match=url.pathname.match(/^\/api\/v1\/appraisal-cases\/([^/]+)\/analysis$/);
 if(match){
  const id=match[1];if(!state.rows[id])return response({error:{code:'NOT_FOUND',message:'Unknown synthetic case.'}},404);
  if(method==='POST'){
   const row=state.rows[id];if(!row.intakeCompletedAt)return response({error:{code:'INTAKE_NOT_COMPLETED',message:'Confirm the saved intake first.'}},409);
   const previous=state.jobs[id];
   if(previous.inputId===row.analysisInputId&&previous.status==='completed')return response(statusFor(id));
   state.analysisSubmissions++;
   state.historicalJobs??=[];if(previous.attemptCount>0)state.historicalJobs.push({caseId:id,...clone(previous)});
   state.jobs[id]={inputId:row.analysisInputId,status:'processing',attemptCount:previous.attemptCount+1,runId:crypto.randomUUID(),completeAt:Date.now()+2000};
   log('submitAnalysis',{caseId:id,inputId:row.analysisInputId,inputRevision:row.analysisInputRevision,priorInputId:previous.inputId,priorRunId:previous.runId,offer:row.insurerVehicleValuation,mileage:row.mileageAtLoss});
  }else log('getAnalysisStatus',{caseId:id,status:statusFor(id).status,inputId:state.rows[id].analysisInputId});
  return response(statusFor(id));
 }
 const run=url.pathname.match(/^\/api\/v1\/analyses\/([^/]+)$/);
 if(run){const entry=Object.entries(state.jobs).find(([,job]:any)=>job.runId===run[1]);if(entry){log('getAnalysisResult',{caseId:entry[0],runId:run[1],inputId:(entry[1] as any).inputId});return response(presentation(entry[0],entry[1]));}const historical=state.historicalJobs?.find((job:any)=>job.runId===run[1]);if(historical&&historical.status==='completed')return response(presentation(historical.caseId,historical));}
 log('unexpectedApiRequest',{method,path:url.pathname});
 return response({error:{code:'OUT_OF_SCOPE',message:`Unexpected local operation: ${method} ${url.pathname}`}},500);
};
window.addEventListener('click',(event)=>{const anchor=(event.target as Element)?.closest?.('a[href]');if(!anchor)return;const target=new URL(anchor.getAttribute('href')!,location.origin);if(target.origin!==location.origin){event.preventDefault();log('externalNavigationBlocked');}},true);
