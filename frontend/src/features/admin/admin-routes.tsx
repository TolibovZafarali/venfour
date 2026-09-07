import type { RouteObject } from "react-router";

import { AdminCaseOperationsAccessGate } from "@/features/admin/case-operations/admin-access-gate";
import { AdminCaseOperationsPage } from "@/pages/admin-case-operations-page";
import { AdminTotalLossCasePage } from "@/pages/admin-total-loss-case-page";
import { AdminActivityPage, AdminCustomerPage, AdminCustomersPage, AdminOverviewPage, AdminPaymentsPage, AdminProcessingPage, AdminReportsPage } from "@/pages/admin-operations-pages";
import { NotFoundPage } from "@/pages/not-found-page";

import { AdminEntry, AdminLayout } from "./admin-layout";

export const adminRoute: RouteObject = {
  path: "admin",
  element: <AdminEntry />,
  children: [{
    element: <AdminCaseOperationsAccessGate />,
    children: [{
      element: <AdminLayout />,
      children: [
        { index: true, element: <AdminOverviewPage /> },
        { path: "cases", element: <AdminCaseOperationsPage /> },
        { path: "cases/:caseId", element: <AdminTotalLossCasePage /> },
        { path: "customers", element: <AdminCustomersPage /> },
        { path: "customers/:customerId", element: <AdminCustomerPage /> },
        { path: "reports", element: <AdminReportsPage /> },
        { path: "processing", element: <AdminProcessingPage /> },
        { path: "payments", element: <AdminPaymentsPage /> },
        { path: "activity", element: <AdminActivityPage /> },
        { path: "*", element: <NotFoundPage /> },
      ],
    }],
  }],
};
