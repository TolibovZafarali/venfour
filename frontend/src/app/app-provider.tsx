import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { RouterProvider } from "react-router";
import type { RouterProviderProps } from "react-router";

import {
  AdminCaseOperationsDependenciesProvider,
  createAdminCaseOperationsDependencies,
  type AdminCaseOperationsDependencies,
} from "@/features/admin/case-operations/dependencies";
import { adminCaseOperationsQueryKeys } from "@/features/admin/case-operations/queries";
import {
  AdminDiminishedValueDependenciesProvider,
  createAdminDiminishedValueDependencies,
  type AdminDiminishedValueDependencies,
} from "@/features/admin/diminished-value/dependencies";
import { adminDiminishedValueQueryKeys } from "@/features/admin/diminished-value/queries";
import {
  AuthProvider,
  type AuthService,
  type TurnstileController,
} from "@/features/auth";
import { AppraisalCaseServiceProvider } from "@/features/cases/service-provider";
import { appraisalCaseQueryKeys } from "@/features/cases/queries";
import {
  createAppraisalCaseService,
  type AppraisalCaseService,
} from "@/features/cases/service";
import {
  createCustomerProfileService,
  CustomerProfileServiceProvider,
  type CustomerProfileService,
} from "@/features/customer-profile";
import { customerProfileQueryKeys } from "@/features/customer-profile/queries";
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
const defaultAdminCaseOperationsDependencies =
  supabaseClientState.status === "available"
    ? createAdminCaseOperationsDependencies(supabaseClientState.client)
    : null;
const defaultAppraisalCaseService =
  supabaseClientState.status === "available"
    ? createAppraisalCaseService(supabaseClientState.client)
    : null;
const defaultCustomerProfileService =
  supabaseClientState.status === "available"
    ? createCustomerProfileService(supabaseClientState.client)
    : null;

interface AppProviderProps {
  adminCaseOperationsDependencies?: AdminCaseOperationsDependencies | null;
  adminDiminishedValueDependencies?: AdminDiminishedValueDependencies | null;
  appraisalCaseService?: AppraisalCaseService | null;
  authService?: AuthService | null;
  authUnavailableReason?: string;
  authTurnstileController?: TurnstileController;
  customerProfileService?: CustomerProfileService | null;
  diminishedValueDependencies?: DiminishedValueDependencies | null;
  queryClient: QueryClient;
  router: RouterProviderProps["router"];
  totalLossDependencies?: TotalLossDependencies | null;
}

export function AppProvider({
  adminCaseOperationsDependencies,
  adminDiminishedValueDependencies,
  appraisalCaseService,
  authService,
  authUnavailableReason,
  authTurnstileController,
  customerProfileService,
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
  const resolvedAdminCaseOperationsDependencies =
    adminCaseOperationsDependencies === undefined
      ? defaultAdminCaseOperationsDependencies
      : adminCaseOperationsDependencies;
  const resolvedAppraisalCaseService =
    appraisalCaseService === undefined
      ? defaultAppraisalCaseService
      : appraisalCaseService;
  const resolvedCustomerProfileService =
    customerProfileService === undefined
      ? defaultCustomerProfileService
      : customerProfileService;
  const resolvedUserIdRef = useRef<string | null>(null);
  const identityInitializedRef = useRef(false);
  const handleIdentityResolved = useCallback(
    (nextUserId: string | null) => {
      const previousUserId = resolvedUserIdRef.current;
      resolvedUserIdRef.current = nextUserId;
      queryClient.removeQueries({ queryKey: appraisalCaseQueryKeys.all });
      queryClient.removeQueries({ queryKey: customerProfileQueryKeys.all });
      queryClient.removeQueries({ queryKey: adminCaseOperationsQueryKeys.all });
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

      if (
        identityInitializedRef.current &&
        previousUserId &&
        previousUserId !== nextUserId
      ) {
        queueMicrotask(() => {
          queryClient.removeQueries({
            queryKey: appraisalCaseQueryKeys.user(previousUserId),
          });
        });
      }
      identityInitializedRef.current = true;
    },
    [queryClient],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider
        service={authService}
        unavailableReason={authUnavailableReason}
        onIdentityResolved={handleIdentityResolved}
        turnstileController={authTurnstileController}
      >
        <CustomerProfileServiceProvider
          service={resolvedCustomerProfileService}
        >
          <AppraisalCaseServiceProvider service={resolvedAppraisalCaseService}>
            <AdminCaseOperationsDependenciesProvider
              dependencies={resolvedAdminCaseOperationsDependencies}
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
            </AdminCaseOperationsDependenciesProvider>
          </AppraisalCaseServiceProvider>
        </CustomerProfileServiceProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
