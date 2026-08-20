import type { SupabaseClient } from "@supabase/supabase-js";
import { createContext, useContext } from "react";

import {
  createDiminishedValueDocumentStorageService,
  type DiminishedValueDocumentReadService,
} from "@/features/diminished-value/storage-service";
import type { Database } from "@/lib/supabase/database.types";

import {
  createStaffDiminishedValueCaseService,
  type StaffDiminishedValueCaseService,
} from "./service";

export interface AdminDiminishedValueDependencies {
  readonly caseService: StaffDiminishedValueCaseService;
  readonly documentService: DiminishedValueDocumentReadService;
}

export const AdminDiminishedValueDependenciesContext =
  createContext<AdminDiminishedValueDependencies | null>(null);

export function createAdminDiminishedValueDependencies(
  client: SupabaseClient<Database>,
): AdminDiminishedValueDependencies {
  const storageService = createDiminishedValueDocumentStorageService(client);
  return {
    caseService: createStaffDiminishedValueCaseService(client),
    documentService: {
      downloadDocument: storageService.downloadDocument,
      listDocuments: storageService.listDocuments,
    },
  };
}

export function useAdminDiminishedValueDependencies() {
  return useContext(AdminDiminishedValueDependenciesContext);
}
