import { render } from "@testing-library/react";
import { createMemoryRouter } from "react-router";

import { AppProvider } from "@/app/app-provider";
import { createAppQueryClient } from "@/app/query-client";
import { appRoutes } from "@/app/router";
import type { AuthService } from "@/features/auth";

interface RenderTestAppOptions {
  authService?: AuthService | null;
  authUnavailableReason?: string;
}

export function renderTestApp(
  initialEntries = ["/"],
  { authService, authUnavailableReason }: RenderTestAppOptions = {},
) {
  const queryClient = createAppQueryClient({ retry: false });
  const router = createMemoryRouter(appRoutes, { initialEntries });

  const result = render(
    <AppProvider
      authService={authService}
      authUnavailableReason={authUnavailableReason}
      queryClient={queryClient}
      router={router}
    />,
  );

  return { ...result, queryClient, router };
}
