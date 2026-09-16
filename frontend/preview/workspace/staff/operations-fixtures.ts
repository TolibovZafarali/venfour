import type { AdminFact, AdminListOptions, AdminOperationsService, AdminResource, AdminRow } from '@/features/admin/operations/types';
import { assertAdminResourceScope, normalizeAdminListOptions, normalizeAdminRecordRequest, parseAdminOverview, parseAdminPage, parseAdminRow } from '@/features/admin/operations/validation';
import { cases, largeCases, detail } from './fixtures';

const asOf = '2026-09-07T21:00:00.000Z';
const id = (value: number) => `${String(value).padStart(8, '0')}-1000-4000-8000-000000000001`;
const facts = (values: Record<string, string | null>): AdminFact[] => Object.entries(values).map(([label, value]) => ({ label, value }));
const row = (value: Partial<AdminRow> & Pick<AdminRow, 'id' | 'title'>): AdminRow => parseAdminRow({
  caseId: null, customerId: null, subtitle: null, summary: null, status: 'active', kind: 'account', identity: null, verified: null, caseCount: null,
  attentionReasons: [], createdAt: '2026-09-05T13:00:00.000Z', updatedAt: asOf, facts: [], sections: [], ...value,
});
const stages = ['analysis_failed','analysis_processing','awaiting_insurer_response','intake_in_progress','waiting_human_review','resolved'];
const makeCaseRow = (item: typeof cases[number], index:number) => {
  const scenario=index%cases.length;
  const legacy=detail(item.caseId)!;
  const currentTask=scenario===2||scenario===4||scenario===5?stages[scenario]:null;
  return row({
    id:item.caseId,caseId:item.caseId,customerId:item.ownerUserId,title:item.customerFullName??item.contactFullName??'Guest customer',subtitle:item.verifiedEmail??item.contactEmail,
    summary:[legacy.vehicleYear,legacy.vehicleMake,legacy.vehicleModel,legacy.vehicleTrim].filter(Boolean).join(' '),status:stages[scenario],kind:'total_loss',
    identity:item.ownerIsAnonymous?'guest':'account',verified:item.verifiedEmail!==null,
    attentionReasons:scenario===0?['PROVIDER_TIMEOUT']:scenario===4?['REPORT_REVIEW_HOLD','REFUND_FAILED','ACTIVE_PAYMENT_DISPUTE']:[],createdAt:item.caseCreatedAt,updatedAt:item.lastActivityAt,
    facts:facts({'Initial stage':item.caseStage,'Workflow phase':scenario===5?'resolution':scenario===2?'negotiation':scenario===4?'preparation':null,'Current task':currentTask,'Case status':item.caseStatus,'Verified account email':item.verifiedEmail,'Entered contact name':item.contactFullName,'Entered contact email':item.contactEmail,'Entered email verified':String(item.contactEmailVerified)}),
    sections:[{title:'Recorded milestones',facts:facts({'Case created':item.caseCreatedAt,'Intake completed':legacy.intakeCompletedAt,'Report uploaded':item.reportUploadedAt,'Initial analysis finished':legacy.analysisJobFinishedAt,'Case resolved':scenario===5?item.lastActivityAt:null})},{title:'Technical details',facts:facts({'Case ID':item.caseId,'Account ID':item.ownerUserId,'Workflow revision':currentTask?'8':null})}],
  });
};
const caseRows=cases.map(makeCaseRow);
const customers=caseRows.map(item=>row({
  id:item.customerId!,customerId:item.customerId,title:item.identity==='guest'?'Guest identity':item.title,subtitle:item.identity==='guest'?null:item.subtitle,
  summary:'1 total-loss case',kind:item.identity!,identity:item.identity,status:item.verified?'verified':'unverified',verified:item.verified,caseCount:1,updatedAt:item.updatedAt,
  facts:facts({'Confirmed name':item.identity==='guest'?null:item.title,'Account email':item.identity==='guest'?null:item.subtitle,'Email verified at':item.verified?'2026-09-06T14:40:00.000Z':null,'Follow-up allowed':item.identity==='guest'?null:'true','Total-loss cases':'1'}),
  sections:[{title:'Technical details',facts:facts({'Account ID':item.customerId,'Account created':item.createdAt})}],
}));
customers.push(row({id:id(100),customerId:id(100),title:'Avery Thompson',subtitle:'avery@example.com',summary:'0 total-loss cases',kind:'account',identity:'account',status:'verified',verified:true,caseCount:0,facts:facts({'Confirmed name':'Avery Thompson','Account email':'avery@example.com','Email verified at':'2026-09-07T11:00:00.000Z','Follow-up allowed':null,'Total-loss cases':'0'})}));
const reports=[
  ...caseRows.filter(item=>detail(item.id)!.reportUploadedAt).map((item,i)=>row({id:`upload:${id(200+i)}`,caseId:item.id,customerId:item.customerId,title:'Insurer valuation.pdf',subtitle:item.title,summary:'Uploaded valuation source',status:'uploaded',kind:'uploaded',createdAt:detail(item.id)!.reportUploadedAt!,updatedAt:'2026-09-06T15:00:00.000Z',facts:facts({'Source':'Customer upload','Provider':'Example valuation provider','Extraction status':'confirmed','Uploaded at':detail(item.id)!.reportUploadedAt,'Facts confirmed at':'2026-09-06T15:00:00.000Z'}),sections:[{title:'Technical details',facts:facts({'Storage owner ID':item.customerId,'Storage object':detail(item.id)!.reportStorageObjectPath})}]})),
  ...(['superseded','published','human_review_required'] as const).map((status,i)=>row({id:id(210+i),caseId:caseRows[i===2?4:2].id,customerId:caseRows[i===2?4:2].customerId,title:`Valuation report · version ${i===1?2:1}`,subtitle:caseRows[i===2?4:2].title,summary:'Generated customer report',status,kind:'generated',attentionReasons:i===2?['REPORT_REVIEW_HOLD']:[],createdAt:`2026-09-07T${i===0?'10':'14'}:00:00.000Z`,updatedAt:`2026-09-07T${i===0?'14':'15'}:00:00.000Z`,facts:facts({'Version':i===1?'2':'1','Generated at':`2026-09-07T${i===0?'10':'14'}:00:00.000Z`,'Published at':i===0?'2026-09-07T11:00:00.000Z':i===1?'2026-09-07T14:30:00.000Z':null,'Current version':String(i!==0),'Current published version':String(i===1),'Superseded':String(i===0),'Failure':null}),sections:[...(i===2?[{title:'Release review',facts:facts({'Status':'queued','Decision':null,'Due at':'2026-09-08T14:00:00.000Z'})}]:[]),{title:'Technical details',facts:facts({'Version ID':id(210+i),'Supersedes version ID':i===1?id(210):null})}]})),
];
const processing=[
  row({id:id(300),caseId:caseRows[0].id,customerId:caseRows[0].customerId,title:'Initial analysis',subtitle:caseRows[0].title,summary:'Valuation screening',kind:'initial_analysis',status:'failed',attentionReasons:['PROVIDER_TIMEOUT'],facts:facts({'Attempts':'2','Failure':'PROVIDER_TIMEOUT','Retryable':'true','Current':'true','Processing expires at':null,'Finished at':'2026-09-06T15:05:00.000Z'})}),
  row({id:id(301),caseId:caseRows[1].id,customerId:caseRows[1].customerId,title:'Initial analysis',subtitle:caseRows[1].title,summary:'Valuation screening',kind:'initial_analysis',status:'processing',facts:facts({'Attempts':'1','Failure':null,'Current':'true','Processing expires at':'2026-09-07T21:15:00.000Z'})}),
  row({id:id(302),caseId:caseRows[4].id,customerId:caseRows[4].customerId,title:'Paid package',subtitle:caseRows[4].title,summary:'Report preparation and review',kind:'paid_package',status:'waiting_human_review',attentionReasons:['REPORT_REVIEW_HOLD'],facts:facts({'Attempts':'1','Current':'true','Failure':null,'Retryable':null,'Processing expires at':null}),sections:[{title:'Work item · generate_report',facts:facts({'Status':'completed','Attempts':'1','Completed at':'2026-09-07T14:00:00.000Z'})},{title:'Release review',facts:facts({'Status':'queued','Due at':'2026-09-08T14:00:00.000Z'})}]}),
  row({id:id(303),caseId:caseRows[2].id,customerId:caseRows[2].customerId,title:'Insurer response',subtitle:caseRows[2].title,summary:'Response analysis',kind:'insurer_response',status:'completed',facts:facts({'Attempts':'1','Current':'true','Completed at':'2026-09-07T16:00:00.000Z','Next attempt at':null})}),
  row({id:id(304),caseId:caseRows[2].id,customerId:caseRows[2].customerId,title:'Initial analysis',subtitle:caseRows[2].title,summary:'Historical valuation screening',kind:'initial_analysis',status:'failed',facts:facts({'Attempts':'1','Failure':'PROVIDER_TIMEOUT','Retryable':'true','Current':'false','Finished at':'2026-09-05T15:00:00.000Z'})}),
];
const payments=[2,4,5].map((index,i)=>row({id:id(400+i),caseId:caseRows[index].id,customerId:caseRows[index].customerId,title:`Order ${String(400+i).padStart(8,'0')}`,subtitle:caseRows[index].title,summary:'Total-loss review',kind:'order',status:i===2?'refunded':i===1?'disputed':'paid',facts:facts({'Amount':'USD 14900 minor units','Currency':'USD','Mode':'Test','Paid at':'2026-09-07T12:00:00.000Z','Refunded at':i===2?'2026-09-07T19:00:00.000Z':null,'Access status':'active','Access reason':i===2?'REFUND_ACCESS_RETAINED':null}),attentionReasons:i===1?['REFUND_FAILED','ACTIVE_PAYMENT_DISPUTE']:[],sections:[{title:'Transaction · payment',facts:facts({'Kind':'payment','Amount':'USD 14900 minor units','Recorded at':'2026-09-07T12:00:00.000Z'})},...(i===2?[{title:'Refund request',facts:facts({'Status':'succeeded','Mode':'Test','Amount':'USD 14900 minor units','Access policy':'retain','Refund reversal transaction ID':null})}]:i===1?[{title:'Refund request',facts:facts({'Status':'failed','Failure':'PROVIDER_REFUND_FAILED','Mode':'Test','Amount':'USD 14900 minor units','Access policy':'retain','Refund reversal transaction ID':id(410)})},{title:'Transaction · refund_reversal',facts:facts({'Kind':'refund_reversal','Amount':'USD 14900 minor units','Related transaction ID':id(411)})},{title:'Payment dispute',facts:facts({'Status':'active','Mode':'Test','Amount':'USD 14900 minor units'})}]:[]),{title:'Checkout attempt',facts:facts({'Status':'expired','Mode':'Test','Finished at':'2026-09-07T11:00:00.000Z'})},{title:'Checkout attempt',facts:facts({'Status':'complete','Mode':'Test','Finished at':'2026-09-07T12:00:00.000Z'})}]}));
const activity=['case.customer_resolution_confirmed','message.customer_reported_sent','report.published','message.email_app_opened','insurer_response.analysis_completed','report.release_review_required','package.processing_started','payment.fulfilled'].map((event,i)=>{
  const target=caseRows[[5,2,2,2,2,4,4,2][i]];
  const time=`2026-09-07T${String(20-i).padStart(2,'0')}:00:00.000Z`;
  return row({id:id(500+i),caseId:target.id,customerId:target.customerId,title:event,subtitle:target.title,summary:i===0||i===1||i===3?'customer':'system',kind:'workflow_event',status:event,createdAt:time,updatedAt:time,facts:facts({'Event':event,'Actor category':i===0||i===1||i===3?'customer':'system','Recorded at':time,'Associated entity':null}),sections:[{title:'Technical details',facts:facts({'Event ID':id(500+i)})}]});
});

function activeRow(resource:AdminResource,item:AdminRow):boolean {
  if(resource==='cases')return item.status!=='resolved'&&item.status!=='closed';
  if(resource!=='processing'||item.facts.find(fact=>fact.label==='Current')?.value!=='true')return false;
  if(item.kind==='initial_analysis')return item.status==='processing';
  if(item.kind==='insurer_response')return ['pending','processing'].includes(item.status);
  return item.kind==='paid_package'&&['queued','processing','source_frozen','assessment_ready','report_generating','waiting_ai_review'].includes(item.status);
}

export function createSyntheticOperationsService(mode:string):AdminOperationsService {
  const expandedCases=mode==='large'?[...caseRows,...largeCases.map((item,index)=>makeCaseRow(item,index+cases.length))]:caseRows;
  const expandedCustomers=customers.map(item=>{
    const count=expandedCases.filter(c=>c.customerId===item.customerId).length;
    return row({...item,caseCount:count,summary:`${count} total-loss cases`,facts:item.facts.map(fact=>fact.label==='Total-loss cases'?{...fact,value:String(count)}:fact)});
  });
  const data:Record<AdminResource,AdminRow[]>={cases:expandedCases,customers:expandedCustomers,reports,processing,payments,activity};
  for(const resource of Object.keys(data) as AdminResource[])for(const item of data[resource])assertAdminResourceScope(item,resource);
  const result=async<T,>(value:T):Promise<T>=>{if(mode==='loading')return new Promise(()=>{});if(mode==='error')throw new Error('Synthetic connection failure');if(mode==='denied')throw Object.assign(new Error('Staff access unavailable'),{code:'42501'});return value;};
  const list=async(resource:AdminResource,options:AdminListOptions={})=>{
    const normalized=normalizeAdminListOptions(resource,options),f=normalized.filters;
    const filtered=(mode==='empty'?[]:data[resource]).filter(item=>{
      if(resource==='customers'&&item.identity!==(f.identity??'account'))return false;
      if(f.caseId&&item.caseId!==f.caseId)return false;
      if(f.customerId&&item.customerId!==f.customerId)return false;
      if(f.identity&&item.identity!==f.identity)return false;
      if(f.status&&item.status!==f.status)return false;
      if(f.kind&&item.kind!==f.kind)return false;
      if(f.attention&&String(item.attentionReasons.length>0)!==f.attention)return false;
      if(f.active&&String(activeRow(resource,item))!==f.active)return false;
      if(f.verified&&String(item.verified)!==f.verified)return false;
      if(f.hasCases&&String(resource==='customers'?(item.caseCount??0)>0:true)!==f.hasCases)return false;
      return !normalized.search||[item.title,item.subtitle,item.summary,item.id,item.caseId].join(' ').toLowerCase().includes(normalized.search.toLowerCase());
    }).sort((a,b)=>Date.parse(normalized.sort==='created'?b.createdAt:b.updatedAt)-Date.parse(normalized.sort==='created'?a.createdAt:a.updatedAt)||b.id.localeCompare(a.id));
    const {page,pageSize}=normalized;
    return result(parseAdminPage({items:filtered.slice((page-1)*pageSize,page*pageSize).map(item=>({...item,sections:[]})),total:filtered.length,page,pageSize,asOf},resource,normalized));
  };
  return {
    list,
    overview:()=>result(parseAdminOverview({asOf,activeCases:mode==='empty'?0:expandedCases.filter(c=>activeRow('cases',c)).length,attentionCases:mode==='empty'?0:expandedCases.filter(c=>c.attentionReasons.length).length,processingJobs:mode==='empty'?0:processing.filter(c=>activeRow('processing',c)).length,registeredAccounts:mode==='empty'?0:expandedCustomers.filter(c=>c.identity==='account').length,attention:mode==='empty'?[]:[...expandedCases].filter(c=>c.attentionReasons.length).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.id.localeCompare(a.id)).slice(0,5),activity:mode==='empty'?[]:activity})),
    customer:customerId=>result(mode==='empty'?null:expandedCustomers.find(c=>c.id===customerId)??null),
    case:caseId=>result(mode==='empty'?null:expandedCases.find(c=>c.id===caseId)??null),
    record:(resource,recordId)=>{
      const requested=normalizeAdminRecordRequest(resource,recordId);
      return result(mode==='empty'?null:data[requested.resource].find(item=>item.id===requested.id)??null);
    },
  };
}
