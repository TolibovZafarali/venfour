import { createBrowserRouter, type RouteObject } from "react-router";

import { AppShell } from "@/components/app-shell";
import { AnalysisPage } from "@/pages/analysis-page";
import { HomePage } from "@/pages/home-page";
import { NotFoundPage } from "@/pages/not-found-page";

export const appRoutes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "analyses/:runId", element: <AnalysisPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
