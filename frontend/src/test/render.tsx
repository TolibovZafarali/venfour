import { render } from "@testing-library/react";
import { createMemoryRouter } from "react-router";

import { AppProvider } from "@/app/app-provider";
import { createAppQueryClient } from "@/app/query-client";
import { appRoutes } from "@/app/router";

export function renderTestApp(initialEntries = ["/"]) {
  const queryClient = createAppQueryClient({ retry: false });
  const router = createMemoryRouter(appRoutes, { initialEntries });

  const result = render(
    <AppProvider queryClient={queryClient} router={router} />,
  );

  return { ...result, queryClient, router };
}
