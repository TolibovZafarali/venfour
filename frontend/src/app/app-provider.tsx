import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { RouterProvider } from "react-router";
import type { RouterProviderProps } from "react-router";

import { AuthProvider, type AuthService } from "@/features/auth";
import { appraisalCaseQueryKeys } from "@/features/cases/queries";
import {
  clearDiminishedValueDraftEnvelope,
  readDiminishedValueDraftEnvelope,
} from "@/features/diminished-value/draft";
import {
  createDiminishedValueDependencies,
  type DiminishedValueDependencies,
  DiminishedValueDependenciesProvider,
} from "@/features/diminished-value/dependencies";
import { CookieConsentProvider } from "@/features/privacy/cookie-consent-provider";
import {
  clearTotalLossDraft,
  readTotalLossDraft,
} from "@/features/total-loss/draft";
import {
  createTotalLossDependencies,
  type TotalLossDependencies,
  TotalLossDependenciesProvider,
} from "@/features/total-loss/dependencies";
import { supabaseClientState } from "@/lib/supabase/client";

const defaultTotalLossDependencies =
  supabaseClientState.status === "available"
    ? createTotalLossDependencies(supabaseClientState.client)
    : null;
const defaultDiminishedValueDependencies =
  supabaseClientState.status === "available"
    ? createDiminishedValueDependencies(supabaseClientState.client)
    : null;

interface AppProviderProps {
  authService?: AuthService | null;
  authUnavailableReason?: string;
  diminishedValueDependencies?: DiminishedValueDependencies | null;
  queryClient: QueryClient;
  router: RouterProviderProps["router"];
  totalLossDependencies?: TotalLossDependencies | null;
}

export function AppProvider({
  authService,
  authUnavailableReason,
  diminishedValueDependencies,
  queryClient,
  router,
  totalLossDependencies,
}: AppProviderProps) {
  const resolvedTotalLossDependencies =
    totalLossDependencies === undefined
      ? defaultTotalLossDependencies
      : totalLossDependencies;
  const resolvedDiminishedValueDependencies =
    diminishedValueDependencies === undefined
      ? defaultDiminishedValueDependencies
      : diminishedValueDependencies;
  const handleIdentityResolved = useCallback(
    (nextUserId: string | null) => {
      queryClient.removeQueries({ queryKey: appraisalCaseQueryKeys.all });

      const storedDraft = readTotalLossDraft();
      if (
        storedDraft.ok &&
        storedDraft.draft?.ownerUserId &&
        storedDraft.draft.ownerUserId !== nextUserId
      ) {
        clearTotalLossDraft();
      }

      const storedDiminishedValueDraft = readDiminishedValueDraftEnvelope();
      if (
        storedDiminishedValueDraft.ok &&
        storedDiminishedValueDraft.envelope?.ownerUserId &&
        storedDiminishedValueDraft.envelope.ownerUserId !== nextUserId
      ) {
        clearDiminishedValueDraftEnvelope();
      }
    },
    [queryClient],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider
        service={authService}
        unavailableReason={authUnavailableReason}
        onIdentityResolved={handleIdentityResolved}
      >
        <TotalLossDependenciesProvider
          dependencies={resolvedTotalLossDependencies}
        >
          <DiminishedValueDependenciesProvider
            dependencies={resolvedDiminishedValueDependencies}
          >
            <CookieConsentProvider>
              <RouterProvider router={router} />
            </CookieConsentProvider>
          </DiminishedValueDependenciesProvider>
        </TotalLossDependenciesProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
