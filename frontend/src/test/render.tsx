import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { createMemoryRouter } from "react-router";

import { AppProvider } from "@/app/app-provider";
import { createAppQueryClient } from "@/app/query-client";
import { appRoutes } from "@/app/router";
import type { AuthService } from "@/features/auth";
import type { TotalLossDependencies } from "@/features/total-loss/dependencies";

interface RenderTestAppOptions {
  authService?: AuthService | null;
  authUnavailableReason?: string;
  strictMode?: boolean;
  totalLossDependencies?: TotalLossDependencies | null;
}

export function renderTestApp(
  initialEntries = ["/"],
  {
    authService,
    authUnavailableReason,
    strictMode = false,
    totalLossDependencies,
  }: RenderTestAppOptions = {},
) {
  const queryClient = createAppQueryClient({ retry: false });
  const router = createMemoryRouter(appRoutes, { initialEntries });

  const app = (
    <AppProvider
      authService={authService}
      authUnavailableReason={authUnavailableReason}
      queryClient={queryClient}
      router={router}
      totalLossDependencies={totalLossDependencies}
    />
  );

  const result = render(strictMode ? <StrictMode>{app}</StrictMode> : app);

  return { ...result, queryClient, router };
}
