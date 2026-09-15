# Customer workspace navigation release

Released September 15, 2026 to [app.venfour.com](https://app.venfour.com/).

## Requested outcomes

1. **Old customer navigation removed.** Removed the Customer Portal header treatment, the standalone My appraisals page and cards, and normal navigation links to that page. The existing Venfour visual language remains, with a clean header and compact legal footer.
2. **Root and login resume.** The application root and default authenticated entry open the most recently active incomplete appraisal. If only completed appraisals exist, they open the most recently active completed workspace. Selection uses fresh, owner-scoped saved state. The public website homepage keeps its existing behavior.
3. **Account-menu switching.** The account menu lists vehicles with concise statuses, indicates the current appraisal, and includes Start new appraisal. Its bounded scroll area works on desktop, mobile, and the full-screen processing view. Each selection resolves that appraisal's current workspace.
4. **Legacy compatibility.** `/appraisals` uses the same resume entry as the app root. Signed-out visitors receive normal sign-in/start handling; customers without appraisals enter the passive start flow. No card page or redirect loop remains.
5. **Authentication continuity.** Default callbacks now resolve through the application entry. Explicit safe case return paths remain intact. Guest claims use the trusted case entry and existing ownership checks. Live Google sign-in resumed an existing saved result. Apple authorization redirect and automated Apple/email callback and claim contracts passed; complete live Apple and email sign-ins were not performed.
6. **Zero appraisals.** The start experience opens without creating a case. Creation requires the customer's explicit continuation.
7. **Multiple appraisals.** Incomplete work takes precedence over completed history; saved activity orders each group. Customers can select any owned appraisal from the menu. Opening or switching does not reset or advance its workflow.
8. **Staff, admin, and partner isolation.** Database-authorized role routing runs before customer resume. Existing staff and partner destinations remain separate. Local role tests passed; a production customer was denied the admin route. Read-only production checks verified all 24 owners and their case visibility, including the staff role.
9. **Tests passed.** Complete frontend: 2,051 passed, 3 existing skips. Final affected regression: 311 passed. Complete offline backend: 2,103 passed. Database: 2,713 assertions across 53 files passed. Lint, type checking, production build, deployment dry run, and whitespace checks passed. Browser observations covered desktop and mobile switching, refresh, history navigation, zero/one/multiple cases, processing, and logout/login resume.
10. **Production revision.** Frontend Worker version `62a4b172-050c-42d5-ae17-48ab4d86ecae` is deployed. Database migration `20260915000200_customer_workspace_navigation.sql` is applied. Deployed JavaScript and CSS hashes match the tested production build.
11. **Existing cases and data preserved.** All 24 appraisal cases and core analysis, report, workflow, stored-object metadata, payment, and approval data remained unchanged. Of 83 table fingerprints checked, 79 matched exactly. The four differences were existing Google account/identity records refreshed during sign-in, an older test checkout expiring before deployment, and its expiration webhook. No account or identity was created or deleted.
12. **No new provider analysis or payment.** MarketCheck request attempts remained 63, payment transactions remained zero, and orders/checkouts remained three each. No new checkout or valuation was triggered by navigation or verification. Manual first-payment approval settings and decisions were preserved.

## Durable workspace coverage

The navigation selects an existing entry point; that entry continues to use the authoritative owner-checked workflow. These branches are covered by local automated contracts. Production smoke testing used existing cases without submitting new work.

| Saved state | Resume behavior |
| --- | --- |
| Free valuation intake | Existing intake and saved fields |
| Processing | Existing analysis progress; no new submission |
| ESTIMATE, LISTING_CONTEXT, INSUFFICIENT | Existing saved analysis result |
| Report upload, extraction | Existing report-review workspace and operation state |
| Confirmation/reconciliation, strict review | Existing report details and review state |
| Awaiting Venfour approval, approved/ready for payment | Existing review readiness and manual approval gate |
| Paid processing, report/result delivery | Existing claim resolver, entitlement, and delivery state |
| Insurer response/waiting | Existing claim workflow and response round |
| Completed case | Existing completed workspace/history |

The owner list stays lightweight: it reads vehicle labels, activity, and workspace status without resolving rich claim data for every row or loading artifacts. Opening the menu refreshes that list; navigation adds no recurring polling. A fresh case selection resolves only the selected case. Automatic analysis submission requires a short-lived intent from explicit intake confirmation, cleared on default resume and account changes.

## Verification evidence

| Evidence | Result |
| --- | --- |
| [Frontend suite](frontend-tests.json) | 2,051 passed; 3 skipped; 0 failed |
| [Final affected regression](final-regression-tests.json) | 311 passed; 0 failed; overlaps the full suite |
| [Offline backend suite](backend-tests.txt) | 2,103 passed; no unexpected network attempts |
| [Database suite](database/test-results.json) | 53 files; 2,713 assertions; 0 failed |
| [Local browser observations](browser-results.json) | 12 observations; zero writes or page errors; API requests were GET only |
| [Production HTTP and asset checks](production-http-smoke.json) | Root, app, legacy entry, callback, and health returned 200; asset hashes matched |
| [Production owner isolation](production-owner-scope.json) | 24 owners checked; all 24 cases owner-scoped; 23 customer roles and 1 staff role |
| [Data comparison](data-verification.json) | Existing cases and core data preserved; changes explained above |
| [Checkout expiration review](stripe-expiry-review.json) | Existing test checkout expired at 15:59:34 UTC; webhook received before deployment |

Local browser fixtures were fictional. Screenshots include [desktop](desktop-menu.png), [390px mobile](mobile-390-menu.png), [320px mobile](mobile-320-menu.png), and [processing](processing-menu.png). Production browser checks separately verified Google login, saved-result resume, switching between two existing cases, legacy-entry resume, refresh, and customer/admin isolation. Apple reached its real authorization screen; a canceled callback displayed recoverable sign-in guidance. Email controls were available, and automated email authentication contracts passed without sending a verification email.

## Deployment scope

Only the production frontend Worker and navigation database migration changed. The migration extends lightweight owner discovery and adds the role lookup; it does not change customer records or valuation calculations. The existing unrelated communications migration was absent from production, so this release applied only the new navigation migration in a targeted transaction and recorded its migration history. A separate rehearsal against that production migration shape passed all 19 navigation assertions.

The backend service, MarketCheck configuration, Stripe configuration, queues, and valuation methodology were unchanged. Temporary preview servers, preview source, and the two isolated test database containers created for this release were removed after validation. Source changes remain uncommitted in the workspace.
