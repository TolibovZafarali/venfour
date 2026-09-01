import type { SupabaseClient } from "@supabase/supabase-js";
import { createContext, useContext } from "react";

import { environment } from "@/config/env";
import {
  createAppraisalCaseService,
  type AppraisalCaseService,
} from "@/features/cases/service";
import {
  createTotalLossDetailsService,
  type TotalLossDetailsService,
} from "@/features/total-loss/service";
import {
  createTotalLossReportStorageService,
  type TotalLossReportStorageService,
} from "@/features/total-loss/storage-service";
import { createNhtsaVpicVehicleLookupService } from "@/features/total-loss/nhtsa-vpic-vehicle-lookup";
import type { VehicleLookupService } from "@/features/total-loss/vehicle-lookup-service";
import {
  createTotalLossIdentityService,
  type TotalLossIdentityService,
} from "@/features/total-loss/identity-service";
import type { Database } from "@/lib/supabase/database.types";
import {
  createTotalLossInsurerResponseStorageService,
  type TotalLossInsurerResponseStorageService,
} from "@/features/total-loss-claim/insurer-response-storage-service";

export interface TotalLossDependencies {
  readonly appraisalCaseService: AppraisalCaseService;
  readonly totalLossDetailsService: TotalLossDetailsService;
  readonly totalLossInsurerResponseStorageService?: TotalLossInsurerResponseStorageService;
  readonly totalLossReportStorageService: TotalLossReportStorageService;
  readonly totalLossIdentityService?: TotalLossIdentityService;
  readonly vehicleLookupService: VehicleLookupService;
}

export const TotalLossDependenciesContext =
  createContext<TotalLossDependencies | null>(null);

export function createTotalLossDependencies(
  client: SupabaseClient<Database>,
): TotalLossDependencies {
  const appraisalCaseService = createAppraisalCaseService(client);
  return {
    appraisalCaseService,
    totalLossDetailsService: createTotalLossDetailsService(
      client,
      appraisalCaseService,
    ),
    totalLossInsurerResponseStorageService:
      createTotalLossInsurerResponseStorageService(client),
    totalLossReportStorageService:
      createTotalLossReportStorageService(client),
    totalLossIdentityService: createTotalLossIdentityService(client),
    vehicleLookupService: createNhtsaVpicVehicleLookupService({
      apiBaseUrl: environment.apiBaseUrl,
    }),
  };
}

export function useTotalLossDependencies() {
  return useContext(TotalLossDependenciesContext);
}
