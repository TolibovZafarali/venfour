# Referral partner proposal: owner review and release boundary

The complete proposed text is in [referral-partner-agreement-draft.md](referral-partner-agreement-draft.md). Revision `2026-09-16.1` is DRAFT. The canonical content and structured policy are in `venfour/data/referral_partner_agreement_draft.json`. The unsigned PDF is generated with `.venv/bin/python scripts/render_partner_agreement_draft.py`.

No production migration, invitation, signature, email, payout, or domain change was performed. Local synthetic signatures are not contracts. The database migration seeds a held draft in the existing template system. Managers can edit it but cannot publish it, remove its hold, or prepare an agreement from it through the current operations. Releasing it requires a separate reviewed change, not a UI toggle. Editing the bundled proposal also requires updating the migration seed, readable text, and PDF; the consistency test detects drift.

## Administrative decisions proposed for approval

- First valid pre-purchase attribution controls, one partner per case. Permit documented corrections of actual tracking errors, retaining history; no newly invented referrals or opportunistic reassignment.
- Eligibility is the later of verified success or 30 days after payment. The proposed payout deadline means **the 15th of the month after payment eligibility**, not necessarily the month after verification. For example: payment September 20, verification September 25, eligibility October 20, payout initiation November 15 or next banking business day. The tier month remains September.
- No minimum payout threshold; secure payee/tax onboarding; itemized statements; holds preserve earned amounts.
- Required refunds, reversals, and successful chargebacks invalidate the affected commission. Unresolved disputes pause payment. Paid invalid amounts use documented offsets or repayment requests after review, never unauthorized debits.
- Later reversals ordinarily preserve rates earned in good faith on other cases. A purely discretionary goodwill refund preserves an otherwise earned commission, but never overrides an actual refund entitlement or creates success.
- Missouri governing law is a proposed choice based on the existing Missouri-first program, not a verified determination of all applicable law. Review the responsibility limits, notices, termination protections, and prospective amendments with counsel.
- Approve the operational meaning of 30 days (the calculation uses 30 elapsed 24-hour days), the bank calendar, secure payee provider, and reviewer procedures before release. The calculation requires an explicitly supplied banking-holiday calendar; it does not guess holidays.

## Customer-policy and legal decisions

| Topic | Current customer policy / existing behavior | Proposed partner terms and decision |
| --- | --- | --- |
| Exactly $1,000 | Manual outcome-guarantee refund is for less than $1,000; exactly $1,000 is explicitly excluded. | Commission requires strictly greater than $1,000. Exactly $1,000 receives neither this commission nor this manual refund. Confirm that gap deliberately; customer policy was not changed. Automatic no-dispute protection remains separate. |
| Baseline | Insurer valuation associated with the case at purchase. | Latest genuine written offer communicated before paid service begins. Those can differ. Decide how to reconcile the two contracts without silently changing a customer's purchased rights. |
| Components | Policy names vehicle ACV and excludes several unrelated settlement amounts. | Draft additionally expressly excludes taxes, title/registration, salvage and other listed items, requires equivalent vehicle components, and uses value before Venfour's fee. Confirm consistent normalization of combined insurer figures. |
| Outcome evidence | Customer-recorded resolution or a purchase is not verified final accepted insurer evidence. | Authorized review must establish baseline authenticity/timing, final value, acceptance, completed process, and refund/dispute clearance. Do not infer success from an expired refund deadline. |
| Counting and amounts | Existing attribution freezes a fixed USD amount when a case is attributed; purchase conversion records payment. Purchase conversion alone creates no earnings; the new local register is separate, and there is no payout scheduler. Older planning rates are not this draft's policy. | New $50/$75 marginal tiers count verified outcomes in America/Chicago months, separately from eligibility and payment months. Never rewrite historical fixed-rate agreements or turn conversion counts into earned balances. |
| Appraisal obligations | Product terms and report scope may create appraisal or appraisal-review obligations regardless of a marketing label. | Obtain a scope-specific review of the outcome refund guarantee and contingent referral compensation against applicable USPAP, licensing and independence obligations. No conclusion of compliance is made here. |
| Regulated partners | General partner-manager permission is not professional compliance approval. | Attorneys, law firms, adjusters, insurance professionals and other regulated partners need separate documented jurisdiction-specific approval before paid referrals. |

The Appraisal Foundation describes USPAP as covering personal property and other appraisal disciplines; applicability and compensation implications require a qualified scope-specific review ([USPAP overview](https://appraisalfoundation.org/pages/uspap)). The customer disclosure provision follows the need to disclose material connections clearly in the actual recommendation ([FTC endorsement guidance](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking)). Missouri recognizes electronic records and signatures, but that alone does not resolve authority, consent, professional restrictions, or other contract requirements ([RSMo 432.230](https://www.revisor.mo.gov/main/OneSection.aspx?section=432.230)).

## Implemented and reused

The existing invitation/verified-email flow, independent unchecked signing confirmations, authenticated server signature records, content digests, immutable snapshots, manager countersignature, private storage, document download authorization, and durable email jobs remain authoritative. The acceptance checkbox now explicitly states intent to sign and acceptance of the agreement. Both parties use the same retained PDF; sender/reply-to addresses remain server configuration, with no invented inbox.

The agreement renderer and website understand the structured tier policy while preserving legacy fixed-rate documents. Unsupported policies fail closed. The complete proposal, commission summary, and simulation use the same source wording. The local admin and business previews share the same session's synthetic records, including the completed PDF. Production holds are not bypassed by this simulation.

`venfour/partner_commissions.py` implements the proposed deterministic eligibility, strict cents threshold, tier sequencing, Central month boundaries, duplicate rejection/replay, immutable calculation entries, hold and due dates, limited statement projection, and refund/reversal/goodwill handling. It accepts **trusted reviewer facts**, not user input. It has no public write endpoint, offset, debit, or transfer operation. The subsequent local earnings work adds a durable ledger adapter and read API, described in `docs/operations/referral-partners.md`; the new local manager review connects documented manual verification to that register. Hosted release and payment execution remain unconfigured. An in-memory calculation is not an accounting ledger or independent verification of documents.

## Required before real activation

The following operating contracts and release checks remain required:

1. Hosted validation of the implemented manager outcome-review workflow and its documented service/process/refund-review procedure. Retained insurer evidence and live payment-state checks are connected locally. Regulated-partner compliance approval remains unimplemented; those cases cannot be approved through this initial workflow.
2. Release validation and integration of the new local transactional commission register. It serializes verification per partner, freezes each ordinal/rate, preserves adjustment history, and uses the tested rules, and now posts atomically with authorized local review decisions. Hosted validation remains required. Corrections must be append-only and reviewed; existing attribution is intentionally immutable. A customer assertion must never become a verified fact automatically.
3. Approved secure payee/tax collection and manual payment/statement reconciliation. No new payout platform or automatic transfers were added. Decide the approved administrative workflow before exposing balances or promising payment dates operationally.
4. A prospective amendment workflow and termination record that preserve original referral entitlements. Existing onboarding prevents silently editing a signed version but does not yet provide an active-partner amendment/termination workflow.
5. Release validation of the structured policy captured in the immutable agreement and referenced by attribution, plus hosted checks of configured sender/reply-to, manager grants, private PDF delivery and partner isolation. Existing fixed-rate fields must not be read as earned amounts under this policy.

Keep the proposal held until these operations and the owner/legal decisions above are resolved. Approval of the wording alone must not enable a program that cannot fulfill its terms.

## Local review

Start/restart from the repository root:

```sh
env -u VENFOUR_WORKSPACE_STRIPE_SESSION_FILE npm --prefix frontend run preview:workspace
```

Use `http://127.0.0.1:4186/_local/workspace` for all screens. Stop with Ctrl-C in that server terminal; reload the browser after restarting. This preview keeps fictional state in the browser and blocks external network requests.

- Fresh journey: `http://127.0.0.1:4186/_local/businesses?example=journey`; use `demonstration-1@example.test`, code `123456`. The Restart journey control resets fictional records.
- Company-details shortcut: `http://127.0.0.1:4186/_local/businesses?example=onboarding`. Save details, read the summary and all sections, enter the displayed signer title, check the three acknowledgements, and simulate signing. Then use Simulate Venfour approval.
- Partner copy: expand Agreement history in that business dashboard and choose Download signed PDF. The synthetic banner and PDF identify this as nonbinding.
- In the **same browser tab**, choose Admin preview, open the same fictional business, and expand Agreement history for the admin PDF. Both downloads retain identical bytes. A different tab may have separate session storage.
- Draft: `http://127.0.0.1:4186/admin/referral-partners/templates`, select Venfour Referral Partner Agreement. Save draft remains available; Publish is disabled. The real database API independently rejects publication.

No real email is sent from the synthetic preview. Existing email delivery is covered by offline retry/idempotency tests; actual configured delivery needs its own authorized hosted check before activation.

## Validation recorded locally

- 60 Python tests passed across commission rules, proposal consistency/rendering, partner API authorization, private referral projections, and PDF/email delivery recovery.
- 29 frontend tests passed across the partner features and synthetic signing/copy workflow, including identical PDF bytes for both audiences and duplicate submission protection.
- 183 database assertions passed in the onboarding, attribution, guest-cleanup protection, and proposal-hold suites.
- A fresh network-isolated migration rehearsal applied the 29-migration baseline and all 50 subsequent migrations, preserving baseline records. Its summary records zero hosted/provider calls. Evidence: `/tmp/venfour-partner-release-hold/summary.json` and `/tmp/venfour-partner-release-hold-tests/database-test-results.json`. The final dedicated rehearsal container is retained for inspection; shared local Supabase was not reset.
- Production frontend build, app and preview TypeScript checks, scoped lint, and `git diff --check` passed. The build retains its existing large-bundle advisory.
- Desktop and 390-pixel mobile agreement/signature layouts were inspected, as were all seven pages of the unsigned PDF. Both synthetic dashboard downloads and the disabled Publish control were exercised in the browser.
