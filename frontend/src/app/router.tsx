import { createBrowserRouter, type RouteObject } from "react-router";

import type { PageMetadata } from "@/app/document-metadata";
import { AppShell } from "@/components/app-shell";
import { AnalysisPage } from "@/pages/analysis-page";
import { ContactPage } from "@/pages/contact-page";
import { HomePage } from "@/pages/home-page";
import { MethodologyPage } from "@/pages/methodology-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { PrivacyPage } from "@/pages/privacy-page";
import { RouteErrorPage } from "@/pages/route-error-page";
import { TermsPage } from "@/pages/terms-page";

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
          "Venfour",
          "Independent review of CCC total-loss vehicle valuations and relevant market evidence.",
        ),
      },
      {
        path: "analyses/:runId",
        element: <AnalysisPage />,
        handle: metadata(
          "Vehicle Valuation Analysis | Venfour",
          "Review the CCC valuation, selected market evidence, findings, and limitations for this vehicle analysis.",
        ),
      },
      {
        path: "methodology",
        element: <MethodologyPage />,
        handle: metadata(
          "Methodology | Venfour",
          "Learn how Venfour structures a CCC report, evaluates vehicle-market evidence, and produces a conservative assessment.",
        ),
      },
      {
        path: "privacy",
        element: <PrivacyPage />,
        handle: metadata(
          "Privacy | Venfour",
          "Learn how the current Venfour service processes uploaded valuation reports and analysis-derived information.",
        ),
      },
      {
        path: "terms",
        element: <TermsPage />,
        handle: metadata(
          "Terms of Use | Venfour",
          "Read the terms and important limitations for using the Venfour vehicle-valuation review service.",
        ),
      },
      {
        path: "contact",
        element: <ContactPage />,
        handle: metadata(
          "Contact | Venfour",
          "Find the current support channel for questions about Venfour and its CCC valuation-review experience.",
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
