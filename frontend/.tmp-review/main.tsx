import './state';
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {createBrowserRouter,RouterProvider,useParams,useLocation} from 'react-router';
import {AppShell} from '@/components/app-shell';
import {AuthContext} from '@/features/auth/auth-context';
import {CookieConsentContext} from '@/features/privacy/cookie-consent-context';
import {CompletedAnalysis} from '@/features/total-loss-claim/components/completed-analysis';
import {useTotalLossClaimQuery} from '@/features/total-loss-claim/queries';
import {PublicHomePage} from '@/pages/home-page';
import {TotalLossAnalysisPage} from '@/pages/total-loss-analysis-page';
import {CASE_ID,USER_ID,BASE} from './fixtures';
import {page,mode,fixture,events,simulateFailure,log,clearLog,storageKey} from './state';
import {Launcher} from './launcher';
import './styles.css';
const user={id:USER_ID,email:'owner@example.com',user_metadata:{full_name:'Case Owner'},app_metadata:{provider:'email'},aud:'authenticated',created_at:'2026-08-29T18:00:00.000Z'};
const session={access_token:'synthetic-access-token',refresh_token:'synthetic-refresh-token',expires_in:3600,token_type:'bearer',user};
const noop=async()=>{};
const auth:any={auth:page==='home'?{status:'signedOut',session:null,user:null}:{status:'signedIn',identity:'permanent',session,user},ensureGuestSession:async()=>session,restoreSession:async()=>session,runTurnstileChallenge:noop,signInWithGoogle:noop,sendMagicLink:noop,completeAuthCallback:async()=>session,completeEmailAuthCallback:async()=>session,signOut:noop};
const consent:any={consent:null,globalPrivacyControl:false,bannerVisible:false,preferencesOpen:false,acceptAll:noop,rejectNonEssential:noop,savePreferences:noop,openPreferences:noop,setPreferencesOpen:noop};
function Harness(){const{stage='result'}=useParams();const location=useLocation();useEffect(()=>localStorage.setItem(`${storageKey}-path`,`${location.pathname}${location.search}`),[location.pathname,location.search]);const query=useTotalLossClaimQuery({accessToken:session.access_token,caseId:CASE_ID,userId:USER_ID});if(query.isError)return <p role="alert">{query.error.message}</p>;if(!query.data||query.data.state!=='secured'||!query.data.report)return <p>Loading synthetic report…</p>;return <CompletedAnalysis accessToken={session.access_token} caseId={CASE_ID} claim={query.data} intakeMode={mode} onRefresh={query.refetch} report={query.data.report} userId={USER_ID} view={`review_${stage}` as any}/>;}
function Controls(){
 const[,rerender]=useState(0);
 useEffect(()=>{const update=()=>rerender(n=>n+1);window.addEventListener('synthetic-log',update);return()=>window.removeEventListener('synthetic-log',update);},[]);
 useEffect(()=>{const last=new Map<string,Element|null>();const selectors=['.review-stage-content','.request-prepare','.request-review','.request-composer','textarea'];const observe=()=>{for(const selector of selectors){const node=document.querySelector(`.completed-analysis ${selector}`);if(last.get(selector)===node)continue;if(node)log(`DOM mounted ${selector}`);else if(last.get(selector))log(`DOM unmounted ${selector}`);last.set(selector,node);}};const observer=new MutationObserver(observe);observer.observe(document.body,{subtree:true,childList:true});observe();return()=>observer.disconnect();},[]);
 return <div style={{font:'12px system-ui',padding:'10px 20px',background:'#f6f7f7',color:'#344354'}}><a href="/" style={{display:'inline-block',padding:'6px 0',color:'#155eef',textDecoration:'underline'}}>Synthetic launcher</a><details style={{font:'12px system-ui',padding:'8px 20px',background:'#f6f7f7',color:'#344354'}}><summary>Synthetic checks · {mode} · {fixture}</summary><p>Only local fixture requests. Copy and email opening are safely recorded. Report actions use a local fixture PDF. For a conflict: arm, edit, then choose Retry save followed by Load saved draft.</p><button onClick={()=>simulateFailure('conflict')}>Conflict on next save</button>{' '}<button onClick={()=>simulateFailure('save')}>Fail next save</button>{' '}<button onClick={()=>simulateFailure('report')}>Fail next report</button>{' '}<button onClick={clearLog}>Clear diagnostics</button><pre style={{whiteSpace:'pre-wrap'}}>{events.join('\n')}</pre></details></div>;
}
const router=createBrowserRouter(page==='launcher'?[{path:'/',element:<Launcher/>}]:[{element:<AppShell/>,children:[{path:`${BASE}/review/:stage`,element:<Harness/>},{path:'/total-loss/cases/:caseId/analysis',element:<TotalLossAnalysisPage/>},{path:'/',element:<PublicHomePage/>}]}]);
const runtime=globalThis as any;const root=runtime.__reviewRoot||=createRoot(document.getElementById('root')!);const queryClient=runtime.__reviewQueryClient||=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
root.render(<QueryClientProvider client={queryClient}><AuthContext.Provider value={auth}><CookieConsentContext.Provider value={consent}><RouterProvider router={router}/>{page==='launcher'?null:<Controls/>}</CookieConsentContext.Provider></AuthContext.Provider></QueryClientProvider>);
