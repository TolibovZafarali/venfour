import {claimProjection,CASE_ID,REPORT_ID,NOW,BASE} from './fixtures';
import {TOTAL_LOSS_EDUCATION_STEPS} from '@/features/total-loss-claim/contracts';
import type {TotalLossEducationStep,TotalLossClaimJourneyState,TotalLossInsurerResponseRecorded} from '@/features/total-loss-claim/contracts';
import {materialUndervalueAnalysis} from '@/test/fixtures/analysis-presentation';
type PreviewResponseRecord=Omit<TotalLossInsurerResponseRecorded,'response'>&{response:Omit<TotalLossInsurerResponseRecorded['response'],'analysis'|'analysisEvidence'>};
const params=new URLSearchParams(location.search);
export const page=params.get('page')||(location.pathname.endsWith('/analysis')?'preview':location.pathname==='/'&&!params.has('mode')&&!params.has('stage')?'launcher':'review');
export const mode=(params.get('mode')||sessionStorage.getItem('review-mode')||'report') as 'report'|'manual';
export const fixture=params.get('fixture')||sessionStorage.getItem('review-fixture')||'full';
export const delay=Math.max(0,Math.min(2500,Number(params.get('delay')||sessionStorage.getItem('review-delay')||250)));
if(page==='review'){sessionStorage.setItem('review-mode',mode);sessionStorage.setItem('review-fixture',fixture);sessionStorage.setItem('review-delay',String(delay));}
export const storageKey=`venfour-synthetic-refinement-${mode}-${fixture}`;
const stage=params.get('stage')||'result';
const requestSent=stage==='sent'||stage==='response';
const completed:TotalLossEducationStep[]=stage==='result'?[]:stage==='insurer'?['result']:stage==='market'?['result',...(mode==='report'?['insurer_review' as const]:[])]:stage==='meaning'?['result','insurer_review','valuation']:['result','insurer_review','valuation','report','what_next'];
const initial=claimProjection(completed);
const value=(amount:number)=>({amountMinorUnits:amount*100,currency:'USD',formatted:new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(amount)});
initial.report.subjectVehicle.description=fixture==='long'?'2022 Land Rover Range Rover Sport HSE Silver Edition Sport Utility 4D':'2022 Toyota Camry SE';
initial.report.suggestedFilename='Venfour_Valuation_Evidence_2022_Toyota_Camry_v1.pdf';
initial.report.insurerEvidence.insurerName=fixture==='long'?'Example National Property and Casualty Insurance Company':'Example Insurance';
initial.report.insurerEvidence.comparables[0].vehicle='2022 Toyota Camry SE';
initial.report.marketEvidence.comparables[0].vehicle=initial.report.subjectVehicle.description;
if(fixture==='full'||fixture==='long'){
 const market=initial.report.marketEvidence;const row=market.comparables[0];
 market.comparables=[
 {...row,advertisedPrice:'$19,800',dealer:'Lakefront Toyota',location:'Chicago, IL',mileage:34600,distanceMiles:12.5},
 {...row,advertisedPrice:'$20,490',dealer:'North Shore Motors',location:'Evanston, IL',mileage:31500,distanceMiles:24},
 {...row,advertisedPrice:'$22,263',dealer:'Westfield Auto Group',location:'Oak Brook, IL',mileage:29400,distanceMiles:31},
 {...row,advertisedPrice:'$20,490',dealer:'Parkway Toyota',location:'Naperville, IL',mileage:30900,distanceMiles:43},
 {...row,advertisedPrice:'$20,190',dealer:'Riverfront Motors',location:'Aurora, IL',mileage:32900,distanceMiles:49},
 {...row,advertisedPrice:'$21,000',dealer:'Prairie Toyota',location:'Elgin, IL',mileage:30600,distanceMiles:52}];
 market.primary.selectedCount=6;
 const insurer=initial.report.insurerEvidence;
 insurer.comparables=[insurer.comparables[0],{...insurer.comparables[0],mileage:29500,advertisedPrice:'$20,100',adjustedValue:'$19,450',netAdjustment:'-$650',adjustments:{condition:'-$800',mileage:'$150',options:null,package:null}},{...insurer.comparables[0],mileage:33700,advertisedPrice:'$19,900',adjustedValue:'$19,150',netAdjustment:'-$750',adjustments:{condition:'-$700',mileage:'-$50',options:null,package:null}}];
 insurer.comparableCount=3;insurer.summary.totalCount=3;insurer.summary.partiallyDisclosedAdjustmentCount=3;
 insurer.summary.advertisedPrices={count:3,low:value(19800),median:value(19900),high:value(20100)};
 insurer.summary.adjustedValues={count:3,low:value(19150),median:value(19450),high:value(19500)};
}
if(fixture==='singular'){initial.report.conclusion.supportedRange.low=initial.report.conclusion.supportedRange.median;initial.report.conclusion.supportedRange.high=initial.report.conclusion.supportedRange.median;}
if(fixture==='sparse'){
 initial.report.conclusion.supportedRange=null;initial.report.conclusion.indicatedDifference=null;
 initial.report.insurerEvidence.comparableCount=0;initial.report.insurerEvidence.comparables=[];
 initial.report.insurerEvidence.summary={...initial.report.insurerEvidence.summary,totalCount:0,advertisedPrices:null,adjustedValues:null,partiallyDisclosedAdjustmentCount:0};
 initial.report.marketEvidence.comparables=[];initial.report.marketEvidence.primary=null;initial.report.insurerEvidence.adjustmentContext=null;
}
const requestBody='Hello,\n\nI am requesting reconsideration of the $19,046 valuation for my 2022 Toyota Camry SE under claim CLM-42.\n\nThe attached Venfour evidence package compares the insurer valuation with selected advertised vehicles. The selected prices range from $19,800 to $22,263, with a median of $20,490. This places the valuation $1,444 below that median.\n\nPlease review the attached evidence and explain whether the valuation can be revised. I understand that advertised prices do not establish final sale prices or a guaranteed settlement amount.\n\nPlease provide your response in writing.\n\nThank you,\nCase Owner';
initial.messageDraft=stage==='send'||requestSent?{...initial.messageDraft,body:requestBody}:null;
initial.sendingDetails={adjusterEmail:initial.messageDraft?'adjuster@example.com':null,adjusterEmailConfirmed:Boolean(initial.messageDraft),adjusterName:null,claimReference:initial.messageDraft?'CLM-42':null,claimReferenceConfirmed:Boolean(initial.messageDraft),customerName:fixture==='long'?'Alexandra Montgomery-Richardson':'Case Owner',insurerName:initial.report.insurerEvidence.insurerName,revision:1,vehicleDescription:initial.report.subjectVehicle.description};
if(requestSent){initial.education.steps.send={completedAt:NOW,viewedAt:NOW,skippedAt:null};initial.journey={fulfillmentState:'awaiting_insurer_response',nextState:'awaiting_insurer_response',retryable:false};initial.workflow.currentTask='awaiting_insurer_response';initial.responseIntake={negotiationRoundId:'88888888-8888-4888-8888-888888888888',outboundCommunicationId:'77777777-7777-4777-8777-777777777777'};initial.negotiationHistory=[{negotiationRoundId:'88888888-8888-4888-8888-888888888888',roundNumber:1,outbound:{body:requestBody,createdAt:NOW,messageVersionId:'66666666-6666-4666-8666-666666666666',recipient:'adjuster@example.com',reportVersionId:REPORT_ID,state:'sent',subject:initial.messageDraft.subject,versionNumber:initial.messageDraft.revision,customerReportedSentAt:NOW,communicationId:'77777777-7777-4777-8777-777777777777',negotiationRoundId:'88888888-8888-4888-8888-888888888888'},responses:[],followUp:null}];}
export const claim=params.has('reset')||!localStorage.getItem(storageKey)?initial:JSON.parse(localStorage.getItem(storageKey)!);
if(claim.journey?.nextState==='awaiting_insurer_response'&&!claim.insurerResponse&&!claim.responseIntake)claim.responseIntake={negotiationRoundId:'88888888-8888-4888-8888-888888888888',outboundCommunicationId:'77777777-7777-4777-8777-777777777777'};
const responseHistoryKey=`${storageKey}-insurer-responses`;
if(params.has('reset'))localStorage.removeItem(responseHistoryKey);
const persist=()=>localStorage.setItem(storageKey,JSON.stringify(claim));
if(page==='review')persist();
if(location.pathname==='/'&&page==='preview')history.replaceState(null,'',`/total-loss/cases/${CASE_ID}/analysis`);
else if(location.pathname==='/'&&page==='review'){
 const resumePath=params.has('resume')?localStorage.getItem(`${storageKey}-path`):null;
 const expectedPrefix=`${BASE}/review/`;
 const nextPath=resumePath?.startsWith(expectedPrefix)?resumePath:`${expectedPrefix}${stage==='send'?'request':stage}`;
 history.replaceState(null,'',nextPath);
}
export const events:string[]=[];export let failNext='';
export function simulateFailure(kind:string){failNext=kind;log(`Next ${kind} failure armed`);}
export function log(message:string){events.push(`${new Date().toISOString().slice(11,23)} ${message}`);window.dispatchEvent(new Event('synthetic-log'));}
export function clearLog(){events.length=0;window.dispatchEvent(new Event('synthetic-log'));}
window.addEventListener('synthetic-action',(event)=>log((event as CustomEvent).detail));
function result(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
function error(status:number,message:string){return result({error:{code:status===409?'CONFLICT':'SERVICE_UNAVAILABLE',message}},status);}
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.origin);
 if(url.origin!==location.origin)throw new Error('External network disabled in synthetic review');
 if(!url.pathname.startsWith('/api/'))return nativeFetch(input,init);
 const path=url.pathname.replace(`/api/v1/appraisal-cases/${CASE_ID}`,'');const method=init?.method||'GET';const body=init?.body?JSON.parse(String(init.body)):{};
 log(`${method} ${path}`);await new Promise(resolve=>setTimeout(resolve,delay));
 if(url.pathname.startsWith('/api/v1/analyses/'))return result(materialUndervalueAnalysis);
 if(path==='/analysis')return result({status:'completed',attemptCount:1,runId:materialUndervalueAnalysis.runId});
 if(path==='/claim')return result(claim);
 if(path==='/insurer-response'&&method==='POST'){
  const fingerprint=JSON.stringify({text:body.responseText,offer:body.revisedOfferMinorUnits,document:body.documentId,retainedDocument:body.retainedDocumentId,supersedes:body.supersedesResponseId});
  const history=JSON.parse(localStorage.getItem(responseHistoryKey)||'[]') as Array<{fingerprint:string;recorded:PreviewResponseRecord}>;
  const replay=history.find(entry=>entry.recorded.response.clientRequestId===body.clientRequestId);
  if(replay)return replay.fingerprint===fingerprint?result(replay.recorded):error(409,'This request was already used for a different response.');
  if(!claim.education.steps.send.completedAt)return error(409,'Record the sent request first.');
  if(body.expectedWorkflowRevision!==claim.workflow.revision)return error(409,'The workflow changed.');
  if(body.supersedesResponseId!==(claim.insurerResponse?.responseId??null))return error(409,'The saved response changed.');
  if(body.documentId||body.retainedDocumentId)return error(400,'This preview supports pasted text and revised offers only.');
  if(body.responseText!==null&&(typeof body.responseText!=='string'||!body.responseText.trim()||body.responseText.length>100_000))return error(400,'Enter valid response text.');
  if(body.revisedOfferMinorUnits!==null&&(!Number.isSafeInteger(body.revisedOfferMinorUnits)||body.revisedOfferMinorUnits<=0))return error(400,'Enter a valid revised offer.');
  if(!body.responseText&&!body.revisedOfferMinorUnits)return error(400,'Add response text or a revised offer.');
  if(failNext==='save'){failNext='';return error(503,'The response could not be saved.');}
  const response={
   responseId:crypto.randomUUID(),clientRequestId:body.clientRequestId,receivedAt:new Date().toISOString(),
   sourceType:'pasted_message' as const,text:body.responseText,document:null,
   revisedOffer:body.revisedOfferMinorUnits===null?null:{amountMinorUnits:body.revisedOfferMinorUnits,currency:'USD'},
   processingState:'pending' as const,failureReason:null,supersedesResponseId:body.supersedesResponseId,
  };
  claim.insurerResponse=response;
  claim.responseIntake=null;
  claim.journey={fulfillmentState:'insurer_response_received',nextState:'insurer_response_received',retryable:false};
  claim.workflow={...claim.workflow,currentTask:'insurer_response_received',revision:claim.workflow.revision+1};
  const recorded:PreviewResponseRecord={state:'insurer_response_received',response,workflowRevision:claim.workflow.revision};
  history.push({fingerprint,recorded});
  localStorage.setItem(responseHistoryKey,JSON.stringify(history));persist();
  log('Response saved in this browser only. Automatic review is not running.');
  return result(recorded);
 }
 if(path.startsWith('/education/')){
  if(body.expectedWorkflowRevision!==claim.workflow.revision)return error(409,'Progress changed');
  const step=path.split('/').pop()!;claim.education.steps[step]={completedAt:NOW,viewedAt:NOW,skippedAt:null};claim.workflow.revision++;
  const next=TOTAL_LOSS_EDUCATION_STEPS.find(s=>!claim.education.steps[s].completedAt&&!claim.education.steps[s].skippedAt);
  const states:Record<TotalLossEducationStep,TotalLossClaimJourneyState>={result:'guide_result',insurer_review:'guide_insurer_review',valuation:'guide_valuation',report:'guide_report',what_next:'guide_what_next',send:'prepare_request'};
  claim.journey.nextState=next?states[next]:'awaiting_insurer_response';persist();return result({education:claim.education,workflowRevision:claim.workflow.revision});
 }
 if(path==='/sending-details'){
  if(body.expectedRevision!==claim.sendingDetails.revision||body.expectedWorkflowRevision!==claim.workflow.revision)return error(409,'Sending details changed');
  claim.sendingDetails={...claim.sendingDetails,...body,revision:claim.sendingDetails.revision+1};claim.workflow.revision++;persist();return result({sendingDetails:claim.sendingDetails,workflowRevision:claim.workflow.revision});
 }
 if(path==='/message-draft'){
  if(method==='GET'){log(`Saved draft revision ${claim.messageDraft.revision}: ${claim.messageDraft.subject}`);return result(claim.messageDraft);}
  if(failNext==='conflict'){failNext='';claim.messageDraft={...claim.messageDraft,subject:'Saved from another browser tab',revision:claim.messageDraft.revision+1};persist();return error(409,'The draft changed in another browser tab.');}
  if(failNext==='save'){failNext='';return error(503,'The draft could not be saved.');}
  if(body.expectedRevision!==claim.messageDraft.revision)return error(409,'The draft changed in another browser tab.');
  claim.messageDraft={...claim.messageDraft,body:body.body,subject:body.subject,recipient:body.recipient,revision:claim.messageDraft.revision+1,updatedAt:NOW};persist();return result(claim.messageDraft);
 }
 if(path==='/message/prepare'){
  if(body.expectedWorkflowRevision!==claim.workflow.revision)return error(409,'The workflow changed.');
  if(!claim.messageDraft)claim.messageDraft={draftId:'55555555-5555-4555-8555-555555555555',purpose:'initial_reconsideration',recipient:claim.sendingDetails.adjusterEmail,reportVersionId:REPORT_ID,revision:1,subject:`Valuation reconsideration - Claim ${claim.sendingDetails.claimReference}`,body:requestBody,updatedAt:NOW};
  claim.workflow.revision++;persist();return result({draft:claim.messageDraft,messageVersion:{body:claim.messageDraft.body,createdAt:NOW,messageVersionId:'66666666-6666-4666-8666-666666666666',recipient:claim.messageDraft.recipient,reportVersionId:REPORT_ID,state:'prepared',subject:claim.messageDraft.subject,versionNumber:claim.messageDraft.revision},workflowRevision:claim.workflow.revision});
 }
 if(path==='/message/opened')return result({recorded:true});
 if(path==='/message/sent'){
  if(body.expectedWorkflowRevision!==claim.workflow.revision)return error(409,'The workflow changed.');
  claim.education.steps.send={completedAt:NOW,viewedAt:NOW,skippedAt:null};claim.journey={fulfillmentState:'awaiting_insurer_response',nextState:'awaiting_insurer_response',retryable:false};claim.responseIntake={negotiationRoundId:'88888888-8888-4888-8888-888888888888',outboundCommunicationId:'77777777-7777-4777-8777-777777777777'};claim.negotiationHistory=[{negotiationRoundId:'88888888-8888-4888-8888-888888888888',roundNumber:1,outbound:{body:claim.messageDraft.body,createdAt:NOW,messageVersionId:body.messageVersionId,recipient:claim.messageDraft.recipient!,reportVersionId:REPORT_ID,state:'sent',subject:claim.messageDraft.subject,versionNumber:claim.messageDraft.revision,customerReportedSentAt:NOW,communicationId:'77777777-7777-4777-8777-777777777777',negotiationRoundId:'88888888-8888-4888-8888-888888888888'},responses:[],followUp:null}];claim.workflow.revision++;claim.workflow.currentTask='awaiting_insurer_response';persist();
  return result({communicationId:'77777777-7777-4777-8777-777777777777',customerReportedSentAt:NOW,messageVersionId:body.messageVersionId,negotiationRoundId:'88888888-8888-4888-8888-888888888888',state:'awaiting_insurer_response',workflowRevision:claim.workflow.revision});
 }
 if(path.endsWith('/download')){if(failNext==='report'){failNext='';return error(503,'The report could not be opened. Try again.');}return result({downloadUrl:`${location.origin}/synthetic-report.pdf?download=evidence.pdf`,expiresAt:'2027-08-31T19:00:00.000Z',suggestedFilename:claim.report.suggestedFilename});}
 return error(500,`Unmocked synthetic operation: ${method} ${path}`);
};

window.addEventListener('click',(event)=>{const anchor=(event.target as Element)?.closest?.('a[href]');if(!anchor)return;const href=new URL(anchor.getAttribute('href')!,location.origin);if(href.origin!==location.origin){event.preventDefault();log('External navigation safely blocked in synthetic launcher');}},true);
