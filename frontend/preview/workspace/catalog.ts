import { scenarios, type Scenario } from "./state";
import { CASE_ID, RUN_ID } from "./claim-fixtures";
import { entryPreviewHref } from "./entry-preview";

export type PreviewScreen = { id: string; title: string; description: string; path: string; phase?: Scenario; signedOut?: boolean };
type Category = { id: string; title: string; description: string; screens: PreviewScreen[] };
const screen = (id: string, title: string, path: string, description: string, phase?: Scenario): PreviewScreen => ({ id, title, path, description, phase });
const states = (...ids: Scenario[]): PreviewScreen[] => ids.map(id => {
  const item = scenarios.find(row => row[0] === id)!;
  return screen(id, item[1], `/_local/workspace?state=${id}`, item[2]);
});
const base = `/total-loss/cases/${CASE_ID}`;
export const categories: Category[] = [
  { id: "public", title: "Public website", description: "Website, service information, and policies.", screens: [
    screen("home", "Homepage", "/", "The public Venfour homepage."),
    screen("methodology", "Methodology", "/methodology", "How a valuation review works."),
    screen("contact", "Contact", "/contact", "Customer support and contact information."),
    screen("referrals", "Referral program", "/referral-partners", "Public introduction to the business referral program."),
    ...[["terms", "Terms of use"], ["privacy", "Privacy policy"], ["cookies", "Cookie policy"], ["refund-policy", "Refund policy"]].map(([id, title]) => screen(id, title, `/${id}`, "Current public policy page.")),
  ] },
  { id: "account", title: "Account & access", description: "Entry, sign-in, saved cases, and recovery.", screens: [
    screen("entry", "Entering the app", entryPreviewHref("slow"), "Try fast, slow, held loading, and new visitor entry."),
    { ...screen("sign-in", "Sign in", "/find-review?previewSignIn=1", "Open the shared sign-in dialog with a fictional account."), signedOut: true },
    screen("workspace", "Customer workspace", "/app", "Resume the saved appraisal and switch cases.", "free"),
    ...states("zero"),
    screen("find-review", "Find your review", "/find-review", "Saved-review recovery form."),
    { ...screen("return", "Return to a saved review", `${base}/return`, "Signed-out review recovery."), signedOut: true },
    screen("invalid-return", "Incomplete return link", "/total-loss/cases/example/return", "Recovery when a return link is incomplete."),
    screen("callback", "Sign-in callback", "/auth/callback", "Callback error with no sign-in parameters."),
  ] },
  { id: "intake", title: "Intake & free valuation", description: "Starting a case and reviewing the initial market result.", screens: [
    screen("start", "Start a review", "/start?service=total-loss", "Report and no-report starting choices.", "zero"),
    screen("diminished", "Diminished value", "/start?service=diminished-value", "Current service availability screen."),
    ...states("intake", "processing", "free", "listing", "insufficient"),
    screen("analysis", "Saved analysis", `/analyses/${RUN_ID}`, "The saved analysis presentation.", "free"),
    screen("loading", "Free valuation loading", "/_local/valuation-processing", "Full-screen loading animation and transition to the result."),
  ] },
  { id: "report", title: "Insurer report", description: "Upload, extraction, fact confirmation, and review readiness.", screens: states("upload", "extracting", "confirmation", "strict", "ready") },
  { id: "payment", title: "Payment & preparation", description: "Verification, checkout, and preparation of the paid report.", screens: [
    screen("secure", "Secure your review", `${base}/claim`, "Verify the fictional guest account.", "payment-unverified"),
    ...states("payment-unverified", "payment", "confirming", "paid"),
  ] },
  { id: "review", title: "Completed review", description: "Open each part of the completed customer report.", screens: [
    ...states("completed"),
    ...[["insurer", "Insurer explanation"], ["market", "Market evidence"], ["meaning", "Comparison meaning"], ["request", "Prepare request"]].map(([id, title]) => screen(`review-${id}`, title, `${base}/claim/review/${id}`, "Saved report with completed reading checkpoints.", "completed")),
    ...states("send"),
  ] },
  { id: "response", title: "Insurer response & outcome", description: "Waiting, saved responses, follow-up, and case closure.", screens: states("waiting", "response", "response-received", "response-reviewing", "response-reviewed", "follow-up", "resolution") },
  { id: "admin", title: "Admin", description: "Staff operations with fictional customers, cases, and payments.", screens: [
    ...[["", "Overview"], ["cases", "Cases"], ["customers", "Customers"], ["reports", "Reports"], ["processing", "Processing"], ["payments", "Payments"], ["payment-approvals", "Payment approvals"], ["communications", "Communications"], ["activity", "Activity"], ["referral-partners", "Referral partners"], ["referral-partners/templates", "Agreement templates"]].map(([id, title]) => screen(`admin-${id || "overview"}`, title, `/admin${id ? `/${id}` : ""}?state=populated`, "Shared staff page with local demonstration records.")),
    screen("admin-case", "Case detail", "/admin/cases/00000010-3333-4333-8333-333333333333?state=populated", "Customer, report, analysis, and operation history."),
    screen("admin-customer", "Customer detail", "/admin/customers/00000020-2222-4222-8222-222222222222?state=populated", "A fictional customer's profile and cases."),
    screen("admin-partner", "Business partner detail", "/admin/referral-partners/00061004-7000-4000-8000-000000000001?state=populated", "Agreement, referral link, and referral activity."),
  ] },
  { id: "business", title: "Businesses", description: "Invitation, company setup, approval, and the business workspace.", screens: [
    ...[["journey", "Invitation & sign-in", "Invitation entry with simulated email sign-in."], ["onboarding", "Company details & agreement", "Business information and demonstration agreement."], ["approval", "Waiting for approval", "Signed agreement awaiting Venfour approval."], ["active", "Business dashboard", "Active referral link and sample referral history."]].map(([id, title, description]) => screen(`business-${id}`, title, `/_local/businesses?example=${id}`, description)),
    screen("business-list", "Business accounts", "/partners?example=active", "Businesses linked to the fictional partner account."),
  ] },
  { id: "status", title: "Status & edge cases", description: "Loading, empty, error, and access states.", screens: [
    ...[["success", "Successful value check"], ["insufficient", "Insufficient evidence"], ["unavailable", "Service unavailable"], ["retry", "Retry value check"], ["missing", "Missing vehicle detail"], ["saved", "Review saved"], ["expired", "Expired access link"]].map(([id, title]) => screen(`status-${id}`, title, `/_local/status-experience?state=${id}`, "Isolated customer status preview.")),
    ...[["empty", "Empty admin workspace"], ["loading", "Admin loading"], ["error", "Admin error"], ["denied", "Admin access denied"], ["large", "Large admin lists"], ["staff-only", "Partner management restricted"], ["email-disabled", "Partner email disabled"], ["save-error", "Partner save error"]].map(([id, title]) => screen(`admin-state-${id}`, title, `/admin/${["staff-only", "email-disabled", "save-error"].includes(id) ? "referral-partners" : "cases"}?state=${id}`, "Fictional staff state; use the selector for other pages.")),
    screen("not-found", "Page not found", "/preview-page-not-found", "Unknown-route screen."),
  ] },
];
export const screens = categories.flatMap(category => category.screens);
export const screenHref = (item: PreviewScreen) => item.phase || item.signedOut ? `/_local/workspace?screen=${item.id}` : item.path;
