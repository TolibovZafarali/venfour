import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import type { RouterProviderProps } from "react-router";

import { AuthProvider, type AuthService } from "@/features/auth";
import { appraisalCaseQueryKeys } from "@/features/cases/queries";
import { CookieConsentProvider } from "@/features/privacy/cookie-consent-provider";

interface AppProviderProps {
  authService?: AuthService | null;
  authUnavailableReason?: string;
  queryClient: QueryClient;
  router: RouterProviderProps["router"];
}

export function AppProvider({
  authService,
  authUnavailableReason,
  queryClient,
  router,
}: AppProviderProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider
        service={authService}
        unavailableReason={authUnavailableReason}
        onIdentityChange={() => {
          queryClient.removeQueries({ queryKey: appraisalCaseQueryKeys.all });
        }}
      >
        <CookieConsentProvider>
          <RouterProvider router={router} />
        </CookieConsentProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
