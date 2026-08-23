import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { createMemoryRouter } from "react-router";

import { AppProvider } from "@/app/app-provider";
import { createAppQueryClient } from "@/app/query-client";
import { appRoutes } from "@/app/router";
import type { AdminDiminishedValueDependencies } from "@/features/admin/diminished-value/dependencies";
import type { AuthService } from "@/features/auth";
import type { AppraisalCaseService } from "@/features/cases/service";
import type { DiminishedValueDependencies } from "@/features/diminished-value/dependencies";
import type { TotalLossDependencies } from "@/features/total-loss/dependencies";

interface RenderTestAppOptions {
  adminDiminishedValueDependencies?: AdminDiminishedValueDependencies | null;
  appraisalCaseService?: AppraisalCaseService | null;
  authService?: AuthService | null;
  authUnavailableReason?: string;
  diminishedValueDependencies?: DiminishedValueDependencies | null;
  strictMode?: boolean;
  totalLossDependencies?: TotalLossDependencies | null;
}

export function renderTestApp(
  initialEntries = ["/"],
  {
    adminDiminishedValueDependencies = null,
    appraisalCaseService = null,
    authService,
    authUnavailableReason,
    diminishedValueDependencies,
    strictMode = false,
    totalLossDependencies,
  }: RenderTestAppOptions = {},
) {
  const queryClient = createAppQueryClient({ retry: false });
  const router = createMemoryRouter(appRoutes, { initialEntries });

  const app = (
    <AppProvider
      adminDiminishedValueDependencies={adminDiminishedValueDependencies}
      appraisalCaseService={appraisalCaseService}
      authService={authService}
      authUnavailableReason={authUnavailableReason}
      diminishedValueDependencies={diminishedValueDependencies}
      queryClient={queryClient}
      router={router}
      totalLossDependencies={totalLossDependencies}
    />
  );

  const result = render(strictMode ? <StrictMode>{app}</StrictMode> : app);

  return { ...result, queryClient, router };
}
