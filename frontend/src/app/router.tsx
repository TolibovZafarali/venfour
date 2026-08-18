import { createBrowserRouter, type RouteObject } from "react-router";

import type { PageMetadata } from "@/app/document-metadata";
import { AppShell } from "@/components/app-shell";
import { AnalysisPage } from "@/pages/analysis-page";
import { CookiePolicyPage } from "@/pages/cookie-policy-page";
import { HomePage } from "@/pages/home-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { PrivacyPage } from "@/pages/privacy-page";
import { RouteErrorPage } from "@/pages/route-error-page";
import { TotalLossReviewPage } from "@/pages/total-loss-review-page";

const metadata = (title: string, description: string): PageMetadata => ({
  title,
  description,
});

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
        path: "total-loss-review",
        element: <TotalLossReviewPage />,
        handle: metadata(
          "Start a Total-Loss Appraisal | Venfour",
          "Upload the vehicle value report your insurance company sent you to start a total-loss appraisal.",
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
