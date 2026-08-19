import type { SupabaseClient } from "@supabase/supabase-js";
import { createContext, useContext } from "react";

import {
  createAppraisalCaseService,
  type AppraisalCaseService,
} from "@/features/cases/service";
import {
  createNhtsaVpicVehicleLookupService,
} from "@/features/total-loss/nhtsa-vpic-vehicle-lookup";
import type { VehicleLookupService } from "@/features/total-loss/vehicle-lookup-service";
import type { Database } from "@/lib/supabase/database.types";

import {
  createDiminishedValueDetailsService,
  type DiminishedValueDetailsService,
} from "./service";
import {
  createDiminishedValueDocumentStorageService,
  type DiminishedValueDocumentStorageService,
} from "./storage-service";

export interface DiminishedValueDependencies {
  readonly appraisalCaseService: AppraisalCaseService;
  readonly diminishedValueDetailsService: DiminishedValueDetailsService;
  readonly diminishedValueDocumentStorageService: DiminishedValueDocumentStorageService;
  readonly vehicleLookupService: VehicleLookupService;
}

export const DiminishedValueDependenciesContext =
  createContext<DiminishedValueDependencies | null>(null);

export function createDiminishedValueDependencies(
  client: SupabaseClient<Database>,
): DiminishedValueDependencies {
  const appraisalCaseService = createAppraisalCaseService(client);
  return {
    appraisalCaseService,
    diminishedValueDetailsService: createDiminishedValueDetailsService(
      client,
      appraisalCaseService,
    ),
    diminishedValueDocumentStorageService:
      createDiminishedValueDocumentStorageService(client),
    vehicleLookupService: createNhtsaVpicVehicleLookupService(),
  };
}

export function useDiminishedValueDependencies() {
  return useContext(DiminishedValueDependenciesContext);
}
