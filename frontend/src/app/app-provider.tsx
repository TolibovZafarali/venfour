import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { RouterProvider } from "react-router";
import type { RouterProviderProps } from "react-router";

import {
  AdminDiminishedValueDependenciesProvider,
  createAdminDiminishedValueDependencies,
  type AdminDiminishedValueDependencies,
} from "@/features/admin/diminished-value/dependencies";
import { adminDiminishedValueQueryKeys } from "@/features/admin/diminished-value/queries";
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
const defaultAdminDiminishedValueDependencies =
  supabaseClientState.status === "available"
    ? createAdminDiminishedValueDependencies(supabaseClientState.client)
    : null;

interface AppProviderProps {
  adminDiminishedValueDependencies?: AdminDiminishedValueDependencies | null;
  authService?: AuthService | null;
  authUnavailableReason?: string;
  diminishedValueDependencies?: DiminishedValueDependencies | null;
  queryClient: QueryClient;
  router: RouterProviderProps["router"];
  totalLossDependencies?: TotalLossDependencies | null;
}

export function AppProvider({
  adminDiminishedValueDependencies,
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
  const resolvedAdminDiminishedValueDependencies =
    adminDiminishedValueDependencies === undefined
      ? defaultAdminDiminishedValueDependencies
      : adminDiminishedValueDependencies;
  const handleIdentityResolved = useCallback(
    (nextUserId: string | null) => {
      queryClient.removeQueries({ queryKey: appraisalCaseQueryKeys.all });
      queryClient.removeQueries({
        queryKey: adminDiminishedValueQueryKeys.all,
      });

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
        <AdminDiminishedValueDependenciesProvider
          dependencies={resolvedAdminDiminishedValueDependencies}
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
        </AdminDiminishedValueDependenciesProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
