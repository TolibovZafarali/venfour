import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '@supabase/supabase-js';
import { http, HttpResponse } from 'msw';
import { describe, expect, test, vi } from 'vitest';
import type { AuthService } from '@/features/auth';
import { server } from '@/test/mocks/server';
import { renderTestApp } from '@/test/render';
import { referralQueryRoot } from './hooks';
import { seedOutcomeReview } from '../../../preview/workspace/staff/outcome-fixtures';

const USER='11111111-1111-4111-8111-111111111111', PARTNER='22222222-2222-4222-8222-222222222222', REF='33333333-3333-4333-8333-333333333333';
const session={access_token:'fixture',refresh_token:'fixture',token_type:'bearer',expires_in:3600,user:{id:USER,email:'manager@example.test',email_confirmed_at:'2026-09-01T00:00:00Z',created_at:'2026-09-01T00:00:00Z',aud:'authenticated',app_metadata:{},user_metadata:{}}} as Session;
const authService: AuthService={getSession:async()=>session,onAuthStateChange:()=>()=>{},signInWithGoogle:vi.fn(),signInWithApple:vi.fn(),sendMagicLink:vi.fn(),sendEmailCode:vi.fn(),verifyEmailCode:async()=>session,exchangeCodeForSession:async()=>session,verifyEmailOtp:async()=>session,signOut:vi.fn()};
function harness(blocked=false) {
  const review=seedOutcomeReview('2026-09-16T12:00:00Z');review.source.payment_held=blocked;
  let allowed=true, fail=false;
  const saves: Record<string, unknown>[]=[];
  server.use(http.get('*/api/v1/staff/referral-partners/access',()=>HttpResponse.json({is_partner_manager:allowed,is_partner:false,email_configured:true})),http.post('*/api/v1/staff/referral-partners/operations',async({request})=>{
    const {action,payload}=await request.json() as {action:string;payload:Record<string,unknown>};
    if (!allowed) return HttpResponse.json({}, {status:403});
    if (action==='outcome_decide') { saves.push(payload); if(fail)return HttpResponse.json({}, {status:503}); return HttpResponse.json({decision:payload.decision}); }
    return HttpResponse.json(review);
  }));
  const app=renderTestApp([`/admin/referral-partners/${PARTNER}/outcomes/${REF}`],{authService,adminCaseOperationsDependencies:{caseService:{isStaff:async()=>true,listCases:async()=>[],getTotalLossCase:async()=>null}}});
  return {app,review,saves,deny:()=>{allowed=false;},fail:()=>{fail=true;}};
}
async function fillApproval(user: ReturnType<typeof userEvent.setup>, final='21500') {
  await user.selectOptions(await screen.findByLabelText('Decision'),'approved');
  await user.type(screen.getByLabelText('Baseline vehicle value (USD) *'),'20000');
  await user.type(screen.getByLabelText('Final accepted vehicle value (USD) *'),final);
  const selectors=screen.getAllByRole('combobox').slice(1);
  for (const [n,selector] of selectors.entries()) await user.selectOptions(selector,`0007800${n}-7000-4000-8000-000000000001`);
  for(const [label,value] of [['Baseline communicated *','2026-08-01T12:00'],['Paid service began *','2026-08-12T12:00'],['Final value accepted *','2026-09-15T12:00']]) {
    const input=screen.getByLabelText(label); await user.clear(input); await user.type(input,value);
  }
  for(const check of screen.getAllByRole('checkbox')) await user.click(check);
  await user.type(screen.getByLabelText('Evidence and decision rationale *'),'Pages 1 and 2 establish equivalent values, acceptance, process, and refund rights.');
}
describe('manager outcome review',()=>{
  test('defaults to missing evidence and saves a private decision without a commission',async()=>{
    const user=userEvent.setup(), api=harness();
    expect(await screen.findByLabelText('Decision')).toHaveValue('needs_evidence');
    await user.type(screen.getByLabelText('What evidence is missing? *'),'Please retain reliable final acceptance evidence.');
    await user.click(screen.getByRole('button',{name:'Save review decision'}));
    expect(await screen.findByRole('status')).toHaveTextContent('No commission was added');
    expect(api.saves[0]).toMatchObject({decision:'needs_evidence',facts:{}});
    expect(Object.values(sessionStorage).join('')).not.toContain('Please retain reliable');
  });
  test('requires a greater-than-$1000 increase and all evidence before approving',async()=>{
    const user=userEvent.setup(),api=harness();await fillApproval(user,'21000');
    expect(screen.getByRole('button',{name:'Approve and record commission'})).toBeDisabled();
    await user.clear(screen.getByLabelText('Final accepted vehicle value (USD) *'));await user.type(screen.getByLabelText('Final accepted vehicle value (USD) *'),'21500');
    expect(screen.getByRole('button',{name:'Approve and record commission'})).toBeEnabled();
    await user.click(screen.getByRole('button',{name:'Approve and record commission'}));
    await waitFor(()=>expect(api.saves).toHaveLength(1));
    expect(api.saves[0]).toMatchObject({decision:'approved',facts:{baseline_vehicle_value_minor:2000000,final_vehicle_value_minor:2150000,refund_rights_reviewed:true}});
    expect(api.saves[0]).not.toHaveProperty('reviewer_id');expect(api.saves[0]).not.toHaveProperty('amount_minor');
  });
  test('payment holds disable approval but allow an evidence decision',async()=>{
    harness(true);await screen.findByLabelText('Decision');
    expect(screen.getByRole('option',{name:'Approve successful outcome'})).toBeDisabled();
    expect(screen.getByText(/Resolve payment, refund, or dispute/)).toBeVisible();
  });
  test('stale source requires explicit rereview; access revocation removes private evidence',async()=>{
    const user=userEvent.setup(),api=harness();await screen.findByLabelText('Decision');
    await user.type(screen.getByLabelText('What evidence is missing? *'),'Please retain reliable final acceptance evidence.');
    api.review.source_digest='d'.repeat(64);await act(()=>api.app.queryClient.invalidateQueries({queryKey:referralQueryRoot}));
    expect(await screen.findByRole('alert')).toHaveTextContent('The record changed');
    expect(screen.getByRole('button',{name:'Save review decision'})).toBeDisabled();
    api.deny();await act(()=>api.app.queryClient.invalidateQueries({queryKey:referralQueryRoot}));
    await waitFor(()=>expect(screen.queryByText('Retained evidence')).not.toBeInTheDocument());
  });
  test('failed writes keep notes and retry the same request identity',async()=>{
    const user=userEvent.setup(),api=harness();api.fail();await screen.findByLabelText('Decision');
    await user.type(screen.getByLabelText('What evidence is missing? *'),'Please retain reliable final acceptance evidence.');
    await user.click(screen.getByRole('button',{name:'Save review decision'}));await screen.findByRole('alert');
    expect(screen.getByLabelText('What evidence is missing? *')).toHaveValue('Please retain reliable final acceptance evidence.');
    await user.click(screen.getByRole('button',{name:'Save review decision'}));await waitFor(()=>expect(api.saves).toHaveLength(2));
    expect(api.saves[1].request_id).toBe(api.saves[0].request_id);
  });
});
