import { isPartnerHost } from "@/features/referral-partners/urls";
import {
  createBrowserRouter,
  Navigate,
  type LoaderFunctionArgs,
  replace,
  type RouteObject,
} from "react-router";

import type { PageMetadata } from "@/app/document-metadata";
import { AppShell } from "@/components/app-shell";
import { environment } from "@/config/env";
import { publicSiteOnly } from "@/config/public-site";
import { routeAudience } from "@/app/site-boundary";
import { diminishedValueStaffReviewAvailable } from "@/config/product-availability";
import { adminRoute } from "@/features/admin/admin-routes";
import { PartnerDashboardPage, PartnerBusinessEarningsPage, PartnerDetailPage, PartnerInvitationPage, PartnerWorkspace } from "@/features/referral-partners/pages";
import { AdminDiminishedValueAccessGate } from "@/features/admin/diminished-value/admin-access-gate";
import { AuthCallbackPage } from "@/features/auth";
import { PublicSignInPage } from "@/features/auth/public-sign-in-page";
import { AnalysisPage } from "@/pages/analysis-page";
import { AdminDiminishedValueCasePage } from "@/pages/admin-diminished-value-case-page";
import { AdminDiminishedValueQueuePage } from "@/pages/admin-diminished-value-queue-page";
import { AppraisalStartPage } from "@/pages/appraisal-start-page";
import { ContactPage } from "@/pages/contact-page";
import { CookiePolicyPage } from "@/pages/cookie-policy-page";
import { AppEntryPage } from "@/pages/app-entry-page";
import { AppraisalResumePage } from "@/pages/appraisal-resume-page";
import { HomePage } from "@/pages/home-page";
import { MethodologyPage } from "@/pages/methodology-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { PrivacyPage } from "@/pages/privacy-page";
import { FindReviewPage, PreviewReturnPage } from "@/pages/preview-return-page";
import { ReferralPartnersPage } from "@/pages/referral-partners-page";
import { RouteErrorPage } from "@/pages/route-error-page";
import { TermsPage } from "@/pages/terms-page";
import { RefundPolicyPage } from "@/pages/refund-policy-page";
import { TotalLossAnalysisPage } from "@/pages/total-loss-analysis-page";
import { TotalLossClaimPage } from "@/pages/total-loss-claim-page";
import { TotalLossClaimWorkflowPage } from "@/pages/total-loss-claim-workflow-page";

const metadata = (title: string, description: string): PageMetadata => ({
  title,
  description,
});

function redirectToTotalLossStart({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);

  url.searchParams.set("service", "total-loss");

  return replace(`/start?${url.searchParams.toString()}`);
}

function redirectPartnerReferral({ params }: LoaderFunctionArgs) {
  const query = new URLSearchParams({ service: "total-loss" });
  // Invalid codes still enter ordinary intake; the database decides attribution.
  query.set("ref", params.code && params.code.length <= 256 ? params.code : "");
  return replace(`/start?${query.toString()}`);
}

const combinedRoutes: RouteObject[] = [
  { path: "/auth/sign-in", element: <PublicSignInPage /> },
  { path: "/r/:code", loader: redirectPartnerReferral },
  {
    path: "/",
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: "app", element: <AppEntryPage />, handle: metadata("Your Workspace | Venfour", "Resume your saved appraisal.") },
      { path: "refund-policy", element: <RefundPolicyPage />, handle: metadata("Fair-Result Refund Policy | Venfour", "Two separate protections: an automatic refund when a review does not support a dispute, and a manual refund for an eligible final valuation increase under $1,000.") },
      { path: "total-loss/cases/:caseId", element: <AppraisalResumePage />, handle: metadata("Your Appraisal | Venfour", "Resume your saved appraisal.") },
      ...(import.meta.env.DEV ? [{
        path: "_local/status-experience",
        lazy: async () => ({ Component: (await import("@/pages/local-status-experience-page")).LocalStatusExperiencePage }),
        handle: metadata("Status Experience Preview | Venfour", "Synthetic status transitions with no provider requests."),
      }] : []),
      ...(import.meta.env.DEV ? [{
        path: "_local/valuation-processing",
        lazy: async () => ({ Component: (await import("@/pages/local-valuation-processing-page")).LocalValuationProcessingPage }),
        handle: metadata("Valuation Processing Preview | Venfour", "Development-only continuous processing preview with synthetic vehicle details."),
      }] : []),
      ...(import.meta.env.DEV && environment.localClaimFixturesEnabled ? [{
        path: "_local/claims",
        lazy: async () => ({ Component: (await import("@/pages/local-claim-testing-page")).LocalClaimTestingPage }),
      }] : []),
      {
        index: true,
        element: <HomePage />,
        handle: metadata(
          "Vehicle Valuation Reviews After an Accident | Venfour",
          "Review a total-loss valuation with or without an insurer report. Diminished Value customer intake is currently paused.",
        ),
      },
      {
        path: "start",
        element: <AppraisalStartPage />,
        handle: metadata(
          "Start a Total Loss Review | Venfour",
          "Start a Total Loss market valuation with or without an insurer report, or view the current Diminished Value service update.",
        ),
      },
      {
        path: "total-loss/start",
        loader: redirectToTotalLossStart,
      },
      {
        path: "total-loss-review",
        loader: redirectToTotalLossStart,
      },
      {
        path: "appraisals",
        element: <AppEntryPage />,
        handle: metadata(
          "Your Appraisal | Venfour",
          "Continue saved vehicle-review requests, follow total-loss value checks, and reopen completed results.",
        ),
      },
      {
        path: "find-review",
        element: <FindReviewPage />,
        handle: metadata("Find Your Review | Venfour", "Recover secure access to your saved vehicle review."),
      },
      {
        path: "total-loss/cases/:caseId/return",
        element: <PreviewReturnPage />,
        handle: metadata("Return to Your Review | Venfour", "Return securely to your saved valuation preview."),
      },
      {
        path: "auth/callback/preview/:caseId/:claimId",
        element: <PreviewReturnPage />,
        handle: metadata("Return to Your Review | Venfour", "Verify your email to return to your saved review."),
      },
      {
        path: "auth/callback/preview-ready/:caseId/:claimId",
        element: <PreviewReturnPage />,
        handle: metadata("Your Preview Is Ready | Venfour", "Return securely to your completed valuation preview."),
      },
      {
        path: "analyses/:runId",
        element: <AnalysisPage />,
        handle: metadata(
          "Vehicle Valuation Analysis | Venfour",
          "Review the insurance valuation, selected market evidence, findings, and limitations for this vehicle analysis.",
        ),
      },
      {
        path: "total-loss/cases/:caseId/analysis",
        element: <TotalLossAnalysisPage />,
        handle: metadata(
          "Total-Loss Value Check | Venfour",
          "Track your total-loss value check and open the completed vehicle valuation analysis.",
        ),
      },
      {
        path: "total-loss/cases/:caseId/review-report",
        element: <TotalLossAnalysisPage reportWorkspace />,
        handle: metadata("Your Insurer Report | Venfour", "Prepare your saved valuation report for the full review."),
      },
      {
        path: "total-loss/cases/:caseId/claim",
        element: <TotalLossClaimPage />,
        handle: metadata(
          "Secure Your Total-Loss Claim | Venfour",
          "Secure or recover access to a saved Venfour total-loss claim.",
        ),
      },
      {
        path: "total-loss/cases/:caseId/claim/checkout",
        element: <TotalLossClaimWorkflowPage view="checkout" />,
        handle: metadata(
          "Secure Checkout | Venfour",
          "Review the purchase terms and continue to secure checkout.",
        ),
      },
      {
        path: "total-loss/cases/:caseId/claim/checkout/return",
        element: <TotalLossClaimWorkflowPage view="checkout_return" />,
        handle: metadata(
          "Confirming Payment | Venfour",
          "Resume your saved total-loss claim while Venfour confirms your payment.",
        ),
      },
      {
        path: "total-loss/cases/:caseId/claim/processing",
        element: <TotalLossClaimWorkflowPage view="processing" />,
        handle: metadata(
          "Preparing Your Valuation Package | Venfour",
          "Follow the preparation status for your total-loss valuation evidence package.",
        ),
      },
      {
        path: "total-loss/cases/:caseId/claim/review/result",
        element: <TotalLossClaimWorkflowPage view="review_result" />,
        handle: metadata("Your Valuation Result | Venfour", "Review your completed total-loss valuation and supporting evidence."),
      },
      {
        path: "total-loss/cases/:caseId/claim/review/insurer",
        element: <TotalLossClaimWorkflowPage view="review_insurer" />,
        handle: metadata("Understanding the Insurer Valuation | Venfour", "Review your completed total-loss valuation and supporting evidence."),
      },
      {
        path: "total-loss/cases/:caseId/claim/review/market",
        element: <TotalLossClaimWorkflowPage view="review_market" />,
        handle: metadata("Understanding the Market Evidence | Venfour", "Review your completed total-loss valuation and supporting evidence."),
      },
      {
        path: "total-loss/cases/:caseId/claim/review/meaning",
        element: <TotalLossClaimWorkflowPage view="review_meaning" />,
        handle: metadata("What Your Valuation Result Means | Venfour", "Review your completed total-loss valuation and supporting evidence."),
      },
      {
        path: "total-loss/cases/:caseId/claim/review/next",
        element: <TotalLossClaimWorkflowPage view="review_next" />,
        handle: metadata("Your Next Step | Venfour", "Review your completed total-loss valuation and supporting evidence."),
      },
      {
        path: "total-loss/cases/:caseId/claim/review/request",
        element: <TotalLossClaimWorkflowPage view="review_request" />,
        handle: metadata("Prepare Your Message | Venfour", "Review your completed total-loss valuation and supporting evidence."),
      },
      {
        path: "total-loss/cases/:caseId/claim/review/waiting",
        element: <TotalLossClaimWorkflowPage view="review_waiting" />,
        handle: metadata(
          "Waiting for the Insurer | Venfour",
          "Return to the active case after confirming that the reconsideration request was sent.",
        ),
      },
      {
        path: "total-loss/cases/:caseId/claim/review/response",
        element: <TotalLossClaimWorkflowPage view="review_response" />,
        handle: metadata(
          "Add the Insurer Response | Venfour",
          "Save the insurer’s written response and any revised offer to the active case.",
        ),
      },
      {
        path: "total-loss/cases/:caseId/claim/review/response-received",
        element: <TotalLossClaimWorkflowPage view="review_response_received" />,
        handle: metadata(
          "Insurer Response Received | Venfour",
          "Review the insurer response saved to this total-loss case.",
        ),
      },
      {
        path: "total-loss/cases/:caseId/claim/review/response-reviewing",
        element: <TotalLossClaimWorkflowPage view="review_response_reviewing" />,
        handle: metadata(
          "Reviewing the Insurer Response | Venfour",
          "Follow Venfour’s secure review of the insurer response saved to this total-loss case.",
        ),
      },
      {
        path: "total-loss/cases/:caseId/claim/review/response-reviewed",
        element: <TotalLossClaimWorkflowPage view="review_response_reviewed" />,
        handle: metadata(
          "Insurer Response Reviewed | Venfour",
          "Understand the insurer response in the context of the evidence already saved to this total-loss case.",
        ),
      },
      {
        path: "total-loss/cases/:caseId/claim/review/resolution",
        element: <TotalLossClaimWorkflowPage view="review_resolution" />,
        handle: metadata(
          "Case Outcome | Venfour",
          "Confirm or review the recorded outcome of your total-loss case.",
        ),
      },
      {
        path: "total-loss/cases/:caseId/claim/review/follow-up",
        element: <TotalLossClaimWorkflowPage view="review_follow_up" />,
        handle: metadata(
          "Your Follow-up Request | Venfour",
          "Review and send a follow-up grounded in your saved insurer response and case evidence.",
        ),
      },
      {
        path: "total-loss/cases/:caseId/claim/review/sent",
        element: <TotalLossClaimWorkflowPage view="review_sent" />,
        handle: metadata(
          "Waiting for the Insurer | Venfour",
          "Return to the active case after confirming that the reconsideration request was sent.",
        ),
      },
      {
        path: "total-loss/cases/:caseId/claim/overview",
        element: <TotalLossClaimWorkflowPage view="overview" />,
        handle: metadata("Valuation Overview | Venfour", "Understand your completed total-loss valuation and supporting evidence."),
      },
      {
        path: "total-loss/cases/:caseId/claim/evidence",
        element: <TotalLossClaimWorkflowPage view="evidence" />,
        handle: metadata("Valuation Evidence | Venfour", "Understand your completed total-loss valuation and supporting evidence."),
      },
      {
        path: "total-loss/cases/:caseId/claim/request",
        element: <TotalLossClaimWorkflowPage view="request" />,
        handle: metadata("Valuation Request | Venfour", "Understand your completed total-loss valuation and supporting evidence."),
      },
      {
        path: "total-loss/cases/:caseId/claim/activity",
        element: <TotalLossClaimWorkflowPage view="activity" />,
        handle: metadata("Case Activity | Venfour", "Understand your completed total-loss valuation and supporting evidence."),
      },
      {
        path: "total-loss/cases/:caseId/claim/guide/result",
        element: <TotalLossClaimWorkflowPage view="result" />,
        handle: metadata(
          "Completed Valuation Result | Venfour",
          "Understand what the completed total-loss evidence supports and the important limitations.",
        ),
      },
      {
        path: "total-loss/cases/:caseId/claim/guide/insurer-review",
        element: <TotalLossClaimWorkflowPage view="insurer_review" />,
        handle: metadata(
          "Insurer Evidence Review | Venfour",
          "Understand how insurer evidence and additional market evidence informed the completed review.",
        ),
      },
      {
        path: "total-loss/cases/:caseId/claim/guide/valuation",
        element: <TotalLossClaimWorkflowPage view="valuation" />,
        handle: metadata(
          "Valuation Evidence | Venfour",
          "Review the supported range, market context, assumptions, and limitations.",
        ),
      },
      {
        path: "total-loss/cases/:caseId/claim/guide/report",
        element: <TotalLossClaimWorkflowPage view="report" />,
        handle: metadata(
          "Valuation Evidence Package | Venfour",
          "Open or download the published Venfour total-loss valuation evidence package.",
        ),
      },
      {
        path: "total-loss/cases/:caseId/claim/guide/what-next",
        element: <TotalLossClaimWorkflowPage view="what_next" />,
        handle: metadata(
          "What May Happen Next | Venfour",
          "Review possible insurer responses before preparing a valuation reconsideration request.",
        ),
      },
      {
        path: "total-loss/cases/:caseId/claim/guide/send",
        element: <TotalLossClaimWorkflowPage view="send" />,
        handle: metadata(
          "Prepare Your Message | Venfour",
          "Review, copy, and open your valuation reconsideration email request.",
        ),
      },
      {
        path: "admin/diminished-value",
        loader: () => diminishedValueStaffReviewAvailable ? null : replace("/admin/cases"),
        element: <AdminDiminishedValueAccessGate />,
        children: [
          {
            index: true,
            element: <AdminDiminishedValueQueuePage />,
            handle: metadata(
              "Submitted Diminished-Value Requests | Venfour",
              "Review submitted diminished-value requests in the secure Venfour staff workspace.",
            ),
          },
          {
            path: ":caseId",
            element: <AdminDiminishedValueCasePage />,
            handle: metadata(
              "Diminished-Value Request | Venfour",
              "Review a submitted diminished-value request in the secure Venfour staff workspace.",
            ),
          },
        ],
      },
      {
        path: "auth/callback/*",
        element: <AuthCallbackPage />,
        handle: metadata(
          "Finish Signing In | Venfour",
          "Finish securely signing in to Venfour.",
        ),
      },
      {
        path: "methodology",
        element: <MethodologyPage />,
        handle: metadata(
          "Total-Loss Review Methodology | Venfour",
          "Learn how Venfour reviews available report facts and market evidence using structured, conservative rules.",
        ),
      },
      {
        path: "terms",
        element: <TermsPage />,
        handle: metadata(
          "Terms of Use | Venfour",
          "Read the terms and current service limits for Venfour total-loss reviews and diminished-value review requests.",
        ),
      },
      {
        path: "referral-partners",
        element: <ReferralPartnersPage />,
        handle: metadata(
          "Referral Partners | Venfour",
          "Learn about Venfour’s invitation-only referral program, beginning in Missouri, with automatic case attribution, commissions on qualifying purchases, and manual payouts.",
        ),
      },
      {
        path: "contact",
        element: <ContactPage />,
        handle: metadata(
          "Contact Venfour",
          "Contact Venfour about a supported report, a saved request, or the current vehicle-valuation review services.",
        ),
      },
      {
        path: "privacy",
        element: <PrivacyPage />,
        handle: metadata(
          "Privacy Policy | Venfour",
          "Learn how Venfour handles account, total-loss, diminished-value, document, and analysis information.",
        ),
      },
      {
        path: "cookies",
        element: <CookiePolicyPage />,
        handle: metadata(
          "Cookie Policy | Venfour",
          "Learn how Venfour uses essential browser storage and handles optional analytics preferences.",
        ),
      },
      {
        path: "*",
        element: <NotFoundPage />,
        handle: metadata(
          "Page Not Found | Venfour",
          "The requested Venfour page could not be found.",
        ),
      },
    ],
  },
  adminRoute,
  { path: "partners", element: <PartnerWorkspace />, children: [
    { index: true, element: <PartnerDashboardPage /> },
    { path: "sign-in", element: <Navigate to="/partners" replace /> },
    { path: "earnings", element: <PartnerDashboardPage earnings /> },
    { path: "businesses/:partnerSlug", element: <PartnerDetailPage /> },
    { path: "businesses/:partnerSlug/earnings", element: <PartnerBusinessEarningsPage /> },
    { path: "invitations/:invitationId", element: <PartnerInvitationPage /> },
    { path: ":partnerId", element: <PartnerDetailPage /> },
  ] },
];

export const publicRoutes: RouteObject[] = combinedRoutes.flatMap((route): RouteObject[] => {
  if (route.path !== "/" || route.index) return [];
  return [{
    ...route,
    children: route.children?.filter(child => child.index || child.path === "*" ||
      (child.path !== undefined && routeAudience(`/${child.path}`) === "public")),
  }];
});

const partnerRoutes: RouteObject[] = [
  { path: "/auth/callback/*", element: <AuthCallbackPage /> },
  { path: "/", element: <PartnerWorkspace />, children: [
    { index: true, element: <PartnerDashboardPage /> },
    { path: "sign-in", element: <Navigate to="/" replace /> },
    { path: "earnings", element: <PartnerDashboardPage earnings /> },
    { path: "businesses/:partnerSlug", element: <PartnerDetailPage /> },
    { path: "businesses/:partnerSlug/earnings", element: <PartnerBusinessEarningsPage /> },
    { path: "invitations/:invitationId", element: <PartnerInvitationPage /> },
    { path: "partners", loader: () => replace("/") },
    { path: "partners/invitations/:invitationId", element: <PartnerInvitationPage /> },
    { path: "partners/:partnerId", element: <PartnerDetailPage /> },
    { path: "*", element: <NotFoundPage /> },
  ] },
];
export const appRoutes = publicSiteOnly ? publicRoutes : isPartnerHost() ? partnerRoutes : combinedRoutes;

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
