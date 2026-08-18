import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import type { RouterProviderProps } from "react-router";

import { CookieConsentProvider } from "@/features/privacy/cookie-consent-provider";

interface AppProviderProps {
  queryClient: QueryClient;
  router: RouterProviderProps["router"];
}

export function AppProvider({ queryClient, router }: AppProviderProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <CookieConsentProvider>
        <RouterProvider router={router} />
      </CookieConsentProvider>
    </QueryClientProvider>
  );
}
