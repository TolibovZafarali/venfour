# Local purchase-page email verification

This change is restricted to the dormant/local post-Continue purchase experience.
It does not activate a hosted release or change hosted Auth configuration.
The normal local launcher remains `colima start`, then
`VENFOUR_LOCAL_POST_CONTINUE=1 node scripts/dev-local.mjs` from the repository root.
Use the canonical application origin `http://localhost:5173` and the local inbox
at `http://127.0.0.1:54324`.

## Inline claim and session sequence

The local purchase panel uses the existing bodyless authenticated request to
`POST /api/v1/appraisal-cases/<case-id>/claim/access-link`. Its response supplies
the saved contact email, case-bound claim ID, and claim expiry. There is no
editable replacement-email field. The name of this backward-compatible endpoint
does not determine whether Auth sends a code or a link.

Auth calls are:

```ts
await isolatedClient.auth.signInWithOtp({
  email: savedContactEmail,
  options: {
    captchaToken,
    shouldCreateUser: true,
    emailRedirectTo: `${origin}/total-loss/cases/${caseId}/claim/checkout`,
  },
});
await isolatedClient.auth.verifyOtp({
  email: savedContactEmail,
  token: sixRawDigits,
  type: "email",
});
```

The isolated client uses memory-only storage, no token refresh, no URL-session
detection, and no persistent PKCE verifier. After Auth verifies the email, the
existing identity service calls `complete_total_loss_case_claim_with_context`
using that verified session. It validates the returned case, permanent owner,
contact email, and `post_continue` purpose. Only then does the main client call
`auth.setSession({ access_token, refresh_token })`. Its normal Auth listener
refreshes the purchase page under the permanent owner; there is no navigation
to a callback or to appraisals.

The database remains authoritative for original ownership, exact saved-email
matching, verified permanent identity, claim expiry/revocation, ownership transfer,
same-destination claim replay, and paid-case fences. No migration changes those
contracts. A matching already-secured permanent owner sees **Verified** immediately
without sending a code. Payment remains controlled by the existing server state
and Stripe configuration, not by code entry or a browser success flag.

The panel displays `123-456`, accepts typing or paste with digits, a dash, or a
space, and submits only the six digits. Codes are cleared on submission and
never written to storage or logs. A retry deadline is the only verification
value stored in localStorage; it contains no code, email, or claim credential.
The resend control appears after the 60-second product cooldown. Same-origin
tabs share that deadline and serialize sends; Auth still enforces its own limits.
**Already have a code?** obtains the existing case binding without sending mail,
so a reloaded or second tab can resume entry.

If Auth verifies the code but claim completion or session installation has a
transient failure, the service can retry with its scoped verified session in
memory for at most five minutes, without retaining the code. During this
handoff, automatic old-owner claim refetches are paused and an already-pending
old-owner response cannot remove the retry form. A changed identity or expired
pending session fails closed; the normal recovery path remains available.

The local main Auth client uses Supabase's supported browser lock and a separate
same-origin storage mutation lock. All of its session writes/removals serialize,
including Auth methods that do not acquire the main Auth lock themselves. The
expected anonymous identity is checked inside that storage lock immediately
before installing the intended session. Browsers without Web Locks do not offer
the inline code flow; ordinary Auth remains available. Idle retry credentials
are disposed at their deadline or when the original identity changes.

The new panel, service, and guarded session installation require the existing
development build, local feature flag, and loopback origin. Outside that gate,
the previous magic-link panel and normal Auth client remain unchanged.

## Supabase support and email formatting

Supabase's passwordless email OTP and magic-link methods share the same Auth
implementation. The email template selects which credential presentation the
customer receives. `signInWithOtp` requests the email; `verifyOtp` with
`{ email, token, type: 'email' }` verifies the raw code and returns a session.
New accounts can use the confirmation template and existing accounts the
magic-link template, so both repository templates include the purchase branch.
See [Supabase passwordless email documentation](https://supabase.com/docs/guides/auth/auth-email-passwordless).

Supabase exposes `.Token`, `.TokenHash`, `.SiteURL`, and `.RedirectTo` to its
[Go email templates](https://supabase.com/docs/guides/auth/auth-email-templates).
The running local Auth version `v2.195.0` uses Go `html/template` for both
[email subjects and bodies](https://github.com/supabase/auth/blob/v2.195.0/internal/mailer/templatemailer/template.go).
Go's built-in [`len`, `slice`, and conditionals](https://pkg.go.dev/text/template)
support formatting without modifying the authoritative token:

```gotemplate
{{ if eq (len .Token) 6 }}{{ slice .Token 0 3 }}-{{ slice .Token 3 6 }}{{ else }}{{ .Token }}{{ end }}
```

The length check prevents invalid slicing. A six-digit token is displayed as
`123-456`; an unexpected token length is displayed unchanged. The frontend must
submit six raw digits to Auth, never the punctuation. There is no separate token
issuer or email sender, and no code is included in the subject or a URL.

The repository explicitly sets `auth.email.otp_length = 6`, supported by the
installed CLI `2.115.0` and the
[CLI configuration reference](https://supabase.com/docs/guides/local-development/cli/config#auth.email.otp_length).
The unchanged limits are `max_frequency = "60s"`, `otp_expiry = 3600`, and
`auth.rate_limit.email_sent = 30`. Do not shorten the expiry without reviewing
existing confirmation and recovery links, which share that setting.

## Local template selection and compatibility

The new request supplies the same-origin purchase path
`/total-loss/cases/<case-id>/claim/checkout` as `emailRedirectTo`. Both templates
recognize a length-guarded prefix of `.SiteURL + "/total-loss/cases/"` and render:

- Subject: `Your Venfour verification code`
- Body: `Use this code to verify your claim:`, the formatted code, then
  `This code expires soon. If you didn't request it, you can ignore this email.`
- No magic-link button in that branch.

This is an email presentation switch, not proof of case ownership. The case-bound
claim and database ownership checks remain the authorization boundary.

All `/auth/callback/...` requests remain on the previous branches, including
preview-ready copy, intake verification, old case-claim links, and recovery.
Those branches retain the existing `token_hash` link and `type=email` callback.
No existing callback was removed from the allowlist.

Only localhost purchase redirect patterns were added to the repository local
configuration. When `.SiteURL` is exactly `http://localhost:5173`, an explicit
length-guarded `http://127.0.0.1:5173/total-loss/cases/` alias also selects the code
branch. This exception is disabled for every other Site URL, including hosted
environments. There is no arbitrary-origin or substring match. The canonical
`localhost` origin remains preferred for local QA.

`local_smtp` remains enabled on port `54324`; no custom SMTP relay is configured.
Local Auth emails therefore go to Mailpit. Use `.test` fixture addresses during
manual QA; do not send test messages through hosted Auth.

## Verification

The offline contract checks are:

```sh
.venv/bin/python -m unittest tests.test_local_auth_email_templates -v
```

They cover both templates, safe prefix/length guards, unchanged old callback
branches, code-only purchase content, subject branching, six-digit configuration,
local-only purchase redirects, Mailpit, and unchanged rate/expiry limits.
They check template structure; the actual Go rendering must also be exercised
with local Supabase and Mailpit after local Auth reloads its configuration.
`supabase status` with CLI `2.115.0` successfully parses the updated config.

Manual QA: continue to the local purchase page, choose **Send verification code**,
open the matching email in Mailpit, enter its code on the same purchase page,
and choose **Verify**. The page should remain on its checkout route and unlock
the existing payment section after the case claim succeeds. Do not paste codes,
email bodies, token hashes, access tokens, or refresh tokens into test output.

The opt-in live Auth/database checks use only the running local services and
clean up their own disposable cases, accounts, and Mailpit messages:

```sh
VENFOUR_LOCAL_POST_CONTINUE=1 .venv/bin/python -m unittest tests.local_claim_email_otp_integration -v
```

The browser workflow has also been exercised with actual Mailpit delivery,
incorrect-code rejection, inline verification, a second tab resuming the same
code, both tabs updating to **Verified**, and verified-owner reload. The dormant
local payment section becomes available for initialization and truthfully
reports unavailable payment setup when Stripe test checkout is not enabled.

The final local verification run passed:

- 929 frontend tests across 73 files, including input formatting, safe errors,
  cooldowns, identity changes, session-write races, and transfer retry handling.
- 1,145 offline Python tests, including six template/configuration checks.
- 1,254 database assertions across 19 files.
- All six live local integration tests together: new-account OTP, existing-account
  OTP, wrong/expired/reused codes, resend, claim expiry, transfer/replay, matching
  permanent-owner bypass, wrong-account denial, and the legacy intake callback.
- Frontend typecheck, production build, changed-file lint, and diff whitespace
  checks. The full lint command still reports the pre-existing
  `react-hooks/set-state-in-effect` finding in
  `frontend/src/pages/total-loss-start-page.tsx:1013`; that file was not changed.
- Desktop (1440px) and mobile (390px) browser checks with no horizontal overflow,
  visible `123-456` formatting, actual inline verification on the final session
  guards, and neutral recovery without disclosure of the saved email.

An initial full frontend run hit an unrelated timeout in the existing guest
preview return test. Its focused rerun and two subsequent full frontend runs
passed. The build retains its existing large-chunk warning.

The local fixture launcher intentionally checks backend `/health`, not `/ready`:
external document and market providers are disabled in this mode, so the normal
full-customer-path readiness endpoint remains unavailable. The tested claim,
Auth, and Mailpit paths remain usable. No real payment was submitted.

## Future hosted configuration, only with separate authorization

Before a later hosted release, coordinate the frontend change with these Auth
settings; none have been applied remotely by this local work:

The local-only frontend activation gate must be reviewed separately. Editing a
hosted template alone does not activate the new purchase verification panel.

1. Update both Confirm signup and Magic link email bodies from their respective
   repository templates. Preserve the fallback and preview-ready branches.
2. Update both subjects to the conditional subject in `supabase/config.toml`.
   The purchase branch must yield `Your Venfour verification code`, while the
   existing subjects remain unchanged for callback flows.
3. Set email OTP length to six (`mailer_otp_length: 6` in the management API;
   `auth.email.otp_length = 6` locally). Keep current hosted expiry/rate limits
   unless a separately reviewed product change requires adjustment.
4. Ensure the configured Site URL matches the deployed canonical app origin.
   Add the precise hosted purchase redirect pattern
   `https://<app-origin>/total-loss/cases/*/claim/checkout` to the redirect
   allowlist; retain all existing callback entries. Do not add broad wildcards
   or accept arbitrary return URLs. OTP verification itself does not navigate
   through `/auth/callback` or require a link click.
5. Retain provider CAPTCHA, resend frequency, email quotas, and verification
   limits. A resend remains another `signInWithOtp` request, subject to Auth's
   configured frequency limit; the UI cooldown must not be shorter than it.
   No hosted rate-limit increases or SMTP changes are required merely to render
   an OTP instead of a link.

Recheck live hosted settings and actual delivery only after that release is
authorized; the local repository is not evidence of hosted configuration.
