# Synthetic admin preview

From the repository root, start `sh frontend/.tmp-dashboard/start.sh` and open
<http://127.0.0.1:4179/admin/referral-partners>. Stop the launcher with Ctrl+C.

## Business preview

For invitations and completed PDF copies delivered to Mailpit, use the local
email walkthrough instead: start `VENFOUR_LOCAL_POST_CONTINUE=1 node scripts/dev-local.mjs`
from the repository root, open <http://127.0.0.1:5173/admin/referral-partners>, and
use <http://127.0.0.1:54324> as the inbox. See
`docs/operations/referral-partners.md` for the manager-to-business walkthrough.
Both experiences now use the shared sign-in modal.

Open <http://127.0.0.1:4179/_local/businesses?example=journey> for the business-facing
journey. Choose **Sign in**, use `demonstration-1@example.test` and the simulated code `123456`, accept
the invitation, enter fictional company details, review the demonstration
agreement, and sign it. The preview-only **Simulate Venfour approval** control
then countersigns through the existing synthetic manager service. The same
business opens its active workspace with a referral link and an initially empty
referral history.

**Dashboard with referrals** opens a separate established fictional business with
sample submissions, purchases, refunds, and payment-review statuses. The screen
selector also opens company details and waiting-for-approval examples. These
screens render the shared business pages. Email authentication, agreement
delivery, and signatures are simulated; no actual message or agreement is sent.

Business preview records are separate from the staff preview's records and
persist across refreshes in the same tab. **Resume journey** preserves progress;
**Restart journey** resets the business examples and their form drafts. Switching
between staff and business previews reloads the page to select the corresponding
fictional identity and service.

The preview renders the shared admin screens with fictional browser-only records.
It does not call the partner API, send invitations or email, or change the local
or hosted database. Demonstration agreement wording, signatures, and commission
amounts have no legal or commercial effect.

Referral records cover pending invitations, business onboarding, manager approval,
active agreements, failed PDF preparation, and email review. Use the ordinary
admin controls to search, create and edit businesses, manage invitations, publish
demonstration templates, countersign, retry preparation, and download a sample PDF.

Active partners also have fictional referral links with working copy, pause, and
resume controls. Referral activity demonstrates submitted reviews, purchases,
refunds, and payments under review using opaque references. The large state has
57 referrals per seeded active business for pagination. Historical purchase totals
include purchases later refunded or placed under review; no earnings or payable
balance is simulated. These links and activity records stay within the preview.

The Preview state selector also includes large, empty, loading, error, denied,
staff-only, email-disabled, and save-error states. Staff-only keeps ordinary admin
access while withholding partner-management permission. Save-error keeps reads
available and fails changes so form recovery can be inspected.

Changes persist in session storage across refreshes in the same browser tab. Each
preview state has its own records. Reset partners restores that state's fictional
records and clears only this preview identity's partner form drafts.

From `frontend/`, verify the preview with:

```sh
./node_modules/.bin/vitest run .tmp-dashboard/referral-fixtures.test.ts .tmp-dashboard/operations-fixtures.test.ts --maxWorkers=1
./node_modules/.bin/tsc -p .tmp-dashboard/tsconfig.json
./node_modules/.bin/eslint .tmp-dashboard/main.tsx .tmp-dashboard/referral-fixtures.ts .tmp-dashboard/referral-fixtures.test.ts
```
