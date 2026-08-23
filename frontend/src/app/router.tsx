import {
  createBrowserRouter,
  type LoaderFunctionArgs,
  replace,
  type RouteObject,
} from "react-router";

import type { PageMetadata } from "@/app/document-metadata";
import { AppShell } from "@/components/app-shell";
import { AdminDiminishedValueAccessGate } from "@/features/admin/diminished-value/admin-access-gate";
import { AuthCallbackPage } from "@/features/auth";
import { AnalysisPage } from "@/pages/analysis-page";
import { AdminDiminishedValueCasePage } from "@/pages/admin-diminished-value-case-page";
import { AdminDiminishedValueQueuePage } from "@/pages/admin-diminished-value-queue-page";
import { AppraisalsPage } from "@/pages/appraisals-page";
import { AppraisalStartPage } from "@/pages/appraisal-start-page";
import { ContactPage } from "@/pages/contact-page";
import { CookiePolicyPage } from "@/pages/cookie-policy-page";
import { HomePage } from "@/pages/home-page";
import { MethodologyPage } from "@/pages/methodology-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { PrivacyPage } from "@/pages/privacy-page";
import { RouteErrorPage } from "@/pages/route-error-page";
import { TermsPage } from "@/pages/terms-page";
import { TotalLossAnalysisPage } from "@/pages/total-loss-analysis-page";

const metadata = (title: string, description: string): PageMetadata => ({
  title,
  description,
});

function redirectToTotalLossStart({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);

  url.searchParams.set("service", "total-loss");

  return replace(`/start?${url.searchParams.toString()}`);
}

export const appRoutes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        index: true,
        element: <HomePage />,
        handle: metadata(
          "Vehicle Valuation Reviews After an Accident | Venfour",
          "Review an original CCC total-loss valuation report or submit repaired-vehicle details for future manual diminished-value review.",
        ),
      },
      {
        path: "start",
        element: <AppraisalStartPage />,
        handle: metadata(
          "Start a Vehicle Valuation Review | Venfour",
          "Start a supported CCC total-loss review or submit a diminished-value request for future manual review.",
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
        element: <AppraisalsPage />,
        handle: metadata(
          "My Appraisals | Venfour",
          "Continue saved vehicle-review requests, follow total-loss value checks, and reopen completed results.",
        ),
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
        path: "admin/diminished-value",
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
        path: "auth/callback",
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
          "Learn how Venfour reviews supported CCC report facts and market evidence using structured, conservative rules.",
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
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
