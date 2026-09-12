"""Email security, provider failure and state-boundary tests; no external sends."""
from __future__ import annotations
import copy
import hashlib
import json
import unittest
from pathlib import Path
from html.parser import HTMLParser
import struct
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlsplit

import httpx
from standardwebhooks.webhooks import Webhook
from starlette.applications import Starlette
from starlette.testclient import TestClient

from venfour.communications import CommunicationError, CommunicationService, auth_messages, verify_email_signature
from venfour.communications_api import communication_routes
from venfour.email_delivery import EmailConfiguration, EmailDeliveryError, email_payload, send_prepared
from venfour.email_templates import EmailTemplate, TEMPLATES, render_email, render_preview
from venfour.email_design import BRAND_LINE, DESIGN, LOGO_PATH, LOGO_SOURCE_SHA256

NOW = datetime.now(timezone.utc)
SECRET = 'whsec_' + 'c2lnbmF0dXJlLXRlc3Qtc2VjcmV0LW9ubHktbm90LXJlYWw='
CASE = 'f2000000-0000-4000-8000-000000000001'
CLAIM = 'f2000000-0000-4000-8000-000000000002'
JOB = 'f2000000-0000-4000-8000-000000000003'


def configuration(**kwargs):
    values = dict(provider='resend',mode='live',app_origin='https://venfour.example',api_origin='https://api.venfour.example',
        sender='Venfour <updates@example.test>',reply_to='support@example.test',auth_sender='Venfour <auth@example.test>',
        api_key='private-test-key',hook_secret=SECRET,webhook_secret=SECRET,dispatch_secret='x'*40,auth_enabled=True)
    return EmailConfiguration(**(values|kwargs))


def payload(action='magiclink',redirect='/auth/callback'):
    return {'user':{'email':'current@example.test','new_email':'new@example.test'},
        'email_data':{'site_url':'https://venfour.example','redirect_to':'https://venfour.example'+redirect,
        'email_action_type':action,'token':'123456','token_new':'654321','token_hash':'a'*64,'token_hash_new':'b'*64,'old_email':'previous@example.test'}}


def signed(value,*,resend=False,when=NOW):
    raw=json.dumps(value).encode()
    prefix='svix' if resend else 'webhook'
    headers={prefix+'-id':'event-example',prefix+'-timestamp':str(int(when.timestamp())),
             prefix+'-signature':Webhook(SECRET).sign('event-example',when,raw.decode())}
    return raw,headers


class EmailTemplateTests(unittest.TestCase):
    def test_every_template_has_accessible_html_plain_text_and_no_tracking(self):
        for key in TEMPLATES:
            with self.subTest(key=key):
                result=render_preview(key,reply_to='support@example.test')
                self.assertIn('role="presentation"',result.html)
                self.assertIn('lang="en"',result.html)
                self.assertNotIn('SAMPLE PREVIEW',result.html)
                self.assertIn(BRAND_LINE,result.text)
                self.assertNotIn('<script',result.html)
                self.assertEqual(result.html.count('<img '), 1)
                self.assertIn('https://venfour.com' + LOGO_PATH, result.html)
                self.assertNotIn('CLARITY FOR YOUR NEXT STEP', result.html)

    def test_shared_brand_matches_the_website_and_keeps_live_wordmark_text(self):
        root = Path(__file__).resolve().parents[1]
        theme = (root / 'frontend/src/styles/index.css').read_text()
        for email_token, site_token in [('brand', 'brand'), ('ink', 'ink'), ('body', 'copy'), ('border', 'line')]:
            self.assertIn(f'--{site_token}: {DESIGN[email_token]};', theme)
        self.assertEqual(hashlib.sha256((root / 'assets/brand/venfour-mark.svg').read_bytes()).hexdigest(), LOGO_SOURCE_SHA256)
        png = (root / 'frontend/public' / LOGO_PATH.lstrip('/')).read_bytes()
        self.assertEqual(png[:8], b'\x89PNG\r\n\x1a\n')
        self.assertEqual(struct.unpack('>II', png[16:24]), (112, 112))
        result = render_preview('paid_review_ready')
        self.assertIn('font-size:20px;line-height:28px;font-weight:600;letter-spacing:-.7px', result.html)
        self.assertIn('>Venfour</span>', result.html)
        self.assertNotIn('gradient', result.html)
        self.assertNotIn('box-shadow', result.html)
        self.assertIn('font-size:22px', result.html)
        self.assertIn('font-size:14px;line-height:20px;font-weight:600', result.html)

    def test_brand_origin_is_validated_and_never_contains_customer_identifiers(self):
        for origin in ('javascript:alert(1)', 'http://remote.example', 'https://user:pass@example.test',
                       'https://example.test/path', 'https://example.test?case=private', 'https://example.test/#private'):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                render_preview('auth_sign_in', brand_origin=origin)
        class Images(HTMLParser):
            def __init__(self):
                super().__init__(); self.sources = []
            def handle_starttag(self, tag, attrs):
                if tag == 'img': self.sources.append(dict(attrs)['src'])
        images = Images()
        images.feed(render_preview('auth_sign_in', brand_origin='http://127.0.0.1:4186/').html)
        self.assertEqual(images.sources, ['http://127.0.0.1:4186' + LOGO_PATH])

    def test_future_content_automatically_inherits_master_and_preview(self):
        template = EmailTemplate('future_email', 'A saved update', 'Your update', ('An update <script>literal</script>.',),
                                 details=(('Reference', '<private>'),))
        with patch.dict(TEMPLATES, {template.key: template}), patch.dict(DESIGN, {'brand': '#abc123'}):
            rendered = render_preview(template.key)
            self.assertEqual(rendered, render_email(template.key, action_url='https://example.test/preview'))
            self.assertIn('#abc123', rendered.html)
            self.assertIn('max-width:560px', rendered.html)
            self.assertIn('@media only screen and (max-width:480px)', rendered.html)
            self.assertIn('Reference: <private>', rendered.text)
            self.assertIn('&lt;private&gt;', rendered.html)
            self.assertNotIn('<script>', rendered.html)

    def test_preview_interactions_match_delivery_and_cannot_add_auth_links(self):
        for key, template in TEMPLATES.items():
            with self.subTest(key=key):
                rendered = render_preview(key)
                self.assertEqual('123-456' in rendered.html, template.interaction in {'code', 'code_and_link'})
                self.assertEqual('https://example.test/preview' in rendered.html, template.interaction in {'link', 'code_and_link'})
                self.assertEqual('Stop optional case reminders' in rendered.html, template.category == 'follow_up')
        for key in ('auth_sign_in', 'auth_password_changed_notification'):
            with self.assertRaises(ValueError):render_email(key, action_url='https://example.test/')
        result = render_email('auth_access', action_url='https://example.test/?x=1&y=2')
        self.assertIn('&amp;y=2', result.html)
        self.assertIn('?x=1&y=2', result.text)

    def test_header_injection_unsafe_links_and_untrusted_content(self):
        with self.assertRaises(ValueError):render_email('auth_sign_in',code='<script>')
        with self.assertRaises(ValueError):render_email('auth_access',action_url='https://trusted.test@evil.test/x\n')
        with self.assertRaises(ValueError):render_email('auth_access',action_url='javascript:alert(1)')
        result=render_email('auth_access',reply_to='<script>literal</script>')
        self.assertNotIn('<script>',result.html)
        with self.assertRaises(ValueError):email_payload(result,recipient='person@example.test\r\nBcc: evil@example.test',sender='a@b.test',reply_to='a@b.test',provider='resend',message_key='test')

    def test_six_and_eight_digit_codes_do_not_offer_auto_consumed_links(self):
        for code in ('123456','12345678'):
            result=render_email('auth_sign_in',code=code)
            self.assertIn(code[:3]+'-'+code[3:] if len(code)==6 else code,result.html)
            self.assertNotIn('href=',result.html)

    def test_configuration_fails_closed_and_never_exposes_secrets(self):
        for values in ({'provider':'unknown'},{'mode':'wrong'},{'api_key':''},{'reply_to':''},
                       {'app_origin':'http://remote.test'},{'api_origin':'https://bad.test/path'},
                       {'mode':'allowlist','allowlist':()},{'provider':'mailpit'}, {'mode':'dry_run'}):
            with self.subTest(values=values),self.assertRaises(ValueError):configuration(**values).validate()
        self.assertNotIn('private-test-key',repr(configuration()))
        self.assertNotIn(SECRET,repr(configuration()))
        self.assertFalse(configuration(mode='disabled',auth_enabled=False).may_send('a@b.test'))


class AuthEmailTests(unittest.TestCase):
    def test_provider_site_url_and_security_notification_recipient_match_auth_contract(self):
        p=payload();p['email_data']['site_url']='https://auth.example.test'
        self.assertEqual(auth_messages(p,configuration(),'https://auth.example.test')[0][1],'auth_sign_in')
        p=payload('email_changed_notification')
        self.assertEqual(auth_messages(p,configuration(),'https://auth.example.test')[0][0],'previous@example.test')
        p['email_data']['old_email']=''
        with self.assertRaises(CommunicationError):auth_messages(p,configuration(),'https://auth.example.test')

    def test_signatures_reject_tampering_expiry_and_future_timestamps(self):
        raw,headers=signed(payload())
        self.assertEqual(verify_email_signature(raw,headers,SECRET)['user']['email'],'current@example.test')
        for bad in (raw+b' ', b'{}'):
            with self.assertRaises(CommunicationError):verify_email_signature(bad,headers,SECRET)
        for when in (NOW-timedelta(minutes=10),NOW+timedelta(minutes=10)):
            raw,headers=signed(payload(),when=when)
            with self.assertRaises(CommunicationError):verify_email_signature(raw,headers,SECRET)

    def test_exact_case_and_claim_urls_and_code_contexts_are_preserved(self):
        cases=[('/auth/callback','auth_sign_in'),(f'/total-loss/cases/{CASE}/claim/checkout','auth_claim'),
            (f'/auth/callback/case-claim/{CLAIM}','auth_access'),
            (f'/auth/callback/preview/{CASE}/{CLAIM}','auth_access'),
            (f'/auth/callback/preview-ready/{CASE}/{CLAIM}','auth_preview_ready')]
        for redirect,key in cases:
            for action in ('signup','magiclink'):
                message=auth_messages(payload(action,redirect),configuration(),'https://auth.example.test')[0]
                self.assertEqual(message[1],key)
                if '/auth/callback/' in redirect:
                    self.assertEqual(urlsplit(message[3]).path,redirect)
                    self.assertEqual(parse_qs(urlsplit(message[3]).query),{'token_hash':['a'*64],'type':['email']})
                else:self.assertEqual(message[2],'123456')

    def test_rejects_foreign_origins_malformed_ids_and_unknown_auth_actions(self):
        for change in ({'redirect_to':'https://evil.test/auth/callback'},{'site_url':'https://evil.test'},
                       {'redirect_to':'https://venfour.example/auth/callback/preview/not-a-case/not-a-claim'},
                       {'email_action_type':'unexpected'}):
            p=payload();p['email_data'].update(change)
            with self.assertRaises(CommunicationError):auth_messages(p,configuration(),'https://auth.example.test')

    def test_secure_email_change_uses_reversed_hash_mapping_for_both_recipients(self):
        messages=auth_messages(payload('email_change'),configuration(),'https://auth.example.test')
        self.assertEqual([(x[0],x[2]) for x in messages],[('current@example.test','123456'),('new@example.test','654321')])
        self.assertEqual(parse_qs(urlsplit(messages[0][3]).query)['token'],['b'*64])
        self.assertEqual(parse_qs(urlsplit(messages[1][3]).query)['token'],['a'*64])
        p=payload('email_change');p['email_data']['token_hash_new']='';p['email_data']['token_new']=''
        messages=auth_messages(p,configuration(),'https://auth.example.test')
        self.assertEqual(len(messages),1);self.assertEqual(messages[0][0],'new@example.test')
        self.assertEqual(messages[0][2],'123456')

    def test_security_notification_capabilities_and_recovery_invite(self):
        for key in TEMPLATES:
            if key.endswith('_notification'):
                result=auth_messages(payload(key.removeprefix('auth_')),configuration(),'https://auth.example.test')
                self.assertEqual(result[0][1],key)
                self.assertEqual(result[0][2:],["",""] if isinstance(result[0],list) else ('',''))
        for action in ('invite','recovery'):
            self.assertEqual(parse_qs(urlsplit(auth_messages(payload(action),configuration(),'https://auth.example.test')[0][3]).query)['type'],[action])

    def test_hook_uses_stable_keys_and_keeps_tokens_out_of_delivery_ledger(self):
        requests=[]
        def respond(req):requests.append(req);return httpx.Response(200,json={'id':'message-id'})
        gateway=MagicMock()
        with httpx.Client(transport=httpx.MockTransport(respond)) as client:
            service=CommunicationService(gateway,configuration(),client=client,supabase_origin='https://auth.example.test')
            raw,headers=signed(payload())
            first=service.auth_hook(raw,headers);second=service.auth_hook(raw,headers)
            self.assertEqual(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key'])
            self.assertEqual(first,second)
            self.assertEqual(gateway.worker.call_count,0)
            service.record_auth_results(first)
            stored=json.dumps(gateway.worker.call_args.args)
            for private in ('123456','token_hash','current@example.test','<html','redirect_to'):
                self.assertNotIn(private,stored)

    def test_hook_allowlist_and_provider_failure_do_not_acknowledge_missing_email(self):
        gateway=MagicMock()
        with httpx.Client(transport=httpx.MockTransport(lambda req:httpx.Response(500))) as client:
            instance=CommunicationService(gateway,configuration(mode='allowlist',allowlist=('staff@example.test',)),client=client)
            raw,headers=signed(payload())
            with self.assertRaises(CommunicationError):instance.auth_hook(raw,headers)
            instance=CommunicationService(gateway,configuration(),client=client,supabase_origin='https://auth.example.test')
            with self.assertRaises(EmailDeliveryError):instance.auth_hook(raw,headers)


class ProviderTests(unittest.TestCase):
    def test_ambiguous_timeout_and_rejections_have_safe_error_codes(self):
        for status,review in ((429,False),(500,False),(401,True),(422,True),(409,True)):
            with httpx.Client(transport=httpx.MockTransport(lambda req:httpx.Response(status,json={'secret':'private-provider-detail'}))) as client:
                with self.assertRaises(EmailDeliveryError) as exc:send_prepared(client,provider='resend',payload={},key='key',api_key='secret')
                self.assertEqual(exc.exception.requires_review,review)
                self.assertNotIn('private',str(exc.exception))

    def test_webhook_deduplication_identity_and_suppression_payload_are_minimal(self):
        gateway=MagicMock();instance=CommunicationService(gateway,configuration())
        event={'type':'email.bounced','created_at':NOW.isoformat(),'data':{'email_id':'message-id','to':['Current@Example.test'],'html':'private-body'}}
        raw,headers=signed(event,resend=True)
        instance.webhook(raw,headers)
        action,args=gateway.worker.call_args.args
        self.assertEqual(action,'event');self.assertEqual(args['event_id'],'event-example')
        self.assertEqual(args['recipient_hash'],hashlib.sha256(b'current@example.test').hexdigest())
        self.assertNotIn('Current@Example.test',json.dumps(args));self.assertNotIn('private-body',json.dumps(args))
        instance.close()

    def test_mailpit_repeat_uses_message_id_lookup(self):
        paths=[]
        def respond(req):paths.append(req.url.path);return httpx.Response(200,json={'messages':[{'ID':'existing'}]})
        with httpx.Client(transport=httpx.MockTransport(respond)) as client:
            self.assertEqual(send_prepared(client,provider='mailpit',payload={'Headers':{'Message-ID':'<test@venfour.local>'}},key='test'),'existing')
        self.assertEqual(paths,['/api/v1/search'])


class DispatcherTests(unittest.TestCase):
    def make_service(self,*,prepared=None,configuration_override=None):
        gateway=MagicMock();calls=[];requests=[]
        job={'id':JOB,'case_id':CASE,'template_key':'intake_reminder','category':'follow_up',
            'first_attempt_at':NOW.isoformat(),'recipient_email':'current@example.test','unsubscribe_token':'c'*64,'prepared_payload':prepared}
        def worker(action,args=None):
            calls.append((action,copy.deepcopy(args)))
            if action=='lease':
                if sum(a=='lease' for a,_ in calls)>1:return None
                return job|{'lease_token':args['lease_token']}
            if action=='prepare':return {'prepared_provider':'resend','prepared_payload':prepared or args['prepared_payload']}
            return True
        gateway.worker.side_effect=worker
        def respond(req):requests.append(req);return httpx.Response(200,json={'id':'accepted-id'})
        client=httpx.Client(transport=httpx.MockTransport(respond))
        return CommunicationService(gateway,configuration_override or configuration(),client=client,now=lambda:NOW),job,calls,requests

    def test_dry_run_never_leases_prepares_or_calls_provider(self):
        instance,job,calls,requests=self.make_service(configuration_override=configuration(mode='dry_run',auth_enabled=False))
        instance.dispatch();self.assertEqual([a for a,_ in calls],['plan']);self.assertFalse(requests)

    def test_currentness_recheck_fenced_ack_and_correct_intake_link(self):
        instance,job,calls,requests=self.make_service()
        self.assertEqual(instance.dispatch()['accepted'],1)
        sent=json.loads(requests[0].content)
        self.assertIn('/total-loss/start?caseId='+CASE,sent['html'])
        self.assertNotIn('token_hash',sent['html'])
        self.assertIn('List-Unsubscribe',sent['headers'])
        self.assertLess([a for a,_ in calls].index('prepare'),[a for a,_ in calls].index('finish'))
        self.assertTrue(next(args for action,args in calls if action=='finish')['lease_token'])

    def test_changed_recipient_prepared_payload_never_sent(self):
        instance,job,calls,requests=self.make_service(prepared={'to':['other@example.test']})
        instance.dispatch();self.assertFalse(requests)
        self.assertEqual(next(args for action,args in calls if action=='fail')['error_code'],'EMAIL_PREPARED_IDENTITY_CHANGED')

    def test_expired_uncertainty_window_never_sends_again(self):
        instance,job,calls,requests=self.make_service();job['first_attempt_at']=(NOW-timedelta(hours=24)).isoformat()
        instance.dispatch();self.assertFalse(requests)
        self.assertTrue(next(args for action,args in calls if action=='fail')['requires_review'])

    def test_progress_after_lease_cancels_before_provider_call(self):
        instance,job,calls,requests=self.make_service();original=instance.gateway.worker.side_effect
        instance.gateway.worker.side_effect=lambda action,args=None:None if action=='prepare' else original(action,args)
        instance.dispatch();self.assertFalse(requests)


class EmailApiTests(unittest.TestCase):
    def setUp(self):
        self.gateway=MagicMock();self.instance=CommunicationService(self.gateway,configuration())
        self.app=Starlette(routes=communication_routes());self.app.state.communication_service=self.instance
        self.client=TestClient(self.app)

    def tearDown(self):self.client.close();self.instance.close()

    def test_staff_and_dispatch_authentication_private_errors(self):
        for method,path in (('get','/api/v1/staff/communications'),('post','/internal/v1/communications/dispatch')):
            response=getattr(self.client,method)(path)
            self.assertEqual(response.status_code,401);self.assertIn('no-store',response.headers['cache-control'])
        self.assertFalse(self.gateway.worker.called)

    def test_staff_authorization_is_forwarded_and_failure_hides_data(self):
        self.gateway.staff.side_effect=CommunicationError(403)
        response=self.client.get('/api/v1/staff/communications',headers={'Authorization':'Bearer fake-caller-token'})
        self.assertEqual(response.status_code,403)
        self.assertEqual(self.gateway.staff.call_args.args[-1],'fake-caller-token')

    def test_gallery_uses_one_authorized_read_and_the_delivery_preview_bytes(self):
        self.gateway.staff.return_value = {}
        response = self.client.get('/api/v1/staff/communications', headers={'Authorization': 'Bearer staff-token'})
        self.assertEqual(response.status_code, 200)
        self.gateway.staff.assert_called_once_with('overview', {}, 'staff-token')
        self.assertFalse(self.gateway.worker.called)
        templates = response.json()['templates']
        self.assertEqual({t['key'] for t in templates}, set(TEMPLATES))
        for template in templates:
            expected = render_preview(template['key'], reply_to='support@example.test', brand_origin='https://venfour.example')
            self.assertEqual(template['preview']['html'], expected.html)
            self.assertEqual(template['preview']['text'], expected.text)
        self.assertNotIn(SECRET, response.text)
        self.assertNotIn('private-test-key', response.text)

    def test_test_send_matches_gallery_html_and_plain_text(self):
        self.instance.config = configuration(allowlist=('staff@example.test',))
        self.gateway.staff.return_value = {'email': 'staff@example.test'}
        self.gateway.worker.side_effect = [{'status': 'reserved'}, True]
        with patch('venfour.communications.send_prepared', return_value='message-example') as send:
            result = self.instance.test_send('auth_password_changed_notification', CASE, 'staff-token')
        self.assertEqual(result['status'], 'accepted')
        sent = send.call_args.kwargs['payload']
        expected = self.instance._preview('auth_password_changed_notification')
        self.assertEqual(sent['html'], expected.html)
        self.assertEqual(sent['text'], expected.text)
        self.assertNotIn('href=', sent['html'])

    def test_unsubscribe_get_never_mutates_post_is_neutral(self):
        path='/emails/preferences/'+'d'*64
        self.assertEqual(self.client.get(path).status_code,200);self.assertFalse(self.gateway.worker.called)
        self.assertEqual(self.client.post(path,content='List-Unsubscribe=One-Click').status_code,200)
        self.assertEqual(self.gateway.worker.call_args.args,('unsubscribe',{'token':'d'*64}))

    def test_forged_and_oversized_webhooks_are_rejected(self):
        self.assertEqual(self.client.post('/hooks/auth/email',json=payload()).status_code,401)
        self.assertEqual(self.client.post('/webhooks/resend',content=b'x'*70000).status_code,413)
        self.assertFalse(self.gateway.worker.called)
