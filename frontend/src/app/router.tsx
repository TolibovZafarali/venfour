import {
  createBrowserRouter,
  type LoaderFunctionArgs,
  replace,
  type RouteObject,
} from "react-router";

import type { PageMetadata } from "@/app/document-metadata";
import { AppShell } from "@/components/app-shell";
import { AuthCallbackPage } from "@/features/auth";
import { AnalysisPage } from "@/pages/analysis-page";
import { AppraisalStartPage } from "@/pages/appraisal-start-page";
import { CookiePolicyPage } from "@/pages/cookie-policy-page";
import { HomePage } from "@/pages/home-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { PrivacyPage } from "@/pages/privacy-page";
import { RouteErrorPage } from "@/pages/route-error-page";
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
          "Vehicle Appraisals After an Accident | Venfour",
          "Start a total-loss appraisal online or learn how a diminished value appraisal documents value lost after repairs.",
        ),
      },
      {
        path: "start",
        element: <AppraisalStartPage />,
        handle: metadata(
          "Start Your Vehicle Appraisal | Venfour",
          "Start a total-loss or diminished value appraisal and provide the details Venfour needs to review your vehicle.",
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
        path: "auth/callback",
        element: <AuthCallbackPage />,
        handle: metadata(
          "Finish Signing In | Venfour",
          "Finish securely signing in to Venfour.",
        ),
      },
      {
        path: "privacy",
        element: <PrivacyPage />,
        handle: metadata(
          "Privacy Policy | Venfour",
          "Learn how Venfour handles information used for vehicle valuation reviews.",
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
