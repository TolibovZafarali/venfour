import {useEffect} from 'react';
import {useParams,useLocation,useNavigate} from 'react-router';
import {CompletedAnalysis} from '@/features/total-loss-claim/components/completed-analysis';
import {useTotalLossClaimQuery} from '@/features/total-loss-claim/queries';
import type {TotalLossClaimWorkflowView} from '@/features/total-loss-claim/workflow-route';
import {CASE_ID,USER_ID,BASE} from './fixtures';
import {mode,storageKey} from './state';

export function Harness({accessToken}:{accessToken:string}){const{stage='result'}=useParams();const location=useLocation();const navigate=useNavigate();const query=useTotalLossClaimQuery({accessToken:accessToken,caseId:CASE_ID,userId:USER_ID});useEffect(()=>localStorage.setItem(`${storageKey}-path`,`${location.pathname}${location.search}`),[location.pathname,location.search]);useEffect(()=>{if(query.data?.state==='secured'&&query.data.journey?.nextState==='awaiting_insurer_response'&&location.pathname.endsWith('/review/request'))navigate(`${BASE}/review/waiting`,{replace:true});},[location.pathname,navigate,query.data]);if(query.isError)return <p role="alert">{query.error.message}</p>;if(!query.data||query.data.state!=='secured'||!query.data.report)return <p>Loading synthetic report…</p>;return <CompletedAnalysis accessToken={accessToken} caseId={CASE_ID} claim={query.data} intakeMode={mode} onRefresh={query.refetch} report={query.data.report} userId={USER_ID} view={`review_${stage.replaceAll('-','_')}` as TotalLossClaimWorkflowView}/>;}
