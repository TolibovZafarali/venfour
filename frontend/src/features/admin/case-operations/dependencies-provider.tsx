import type { PropsWithChildren } from "react";

import {
  AdminCaseOperationsDependenciesContext,
  type AdminCaseOperationsDependencies,
} from "./dependencies-context";

interface AdminCaseOperationsDependenciesProviderProps
  extends PropsWithChildren {
  readonly dependencies: AdminCaseOperationsDependencies | null;
}

export function AdminCaseOperationsDependenciesProvider({
  children,
  dependencies,
}: AdminCaseOperationsDependenciesProviderProps) {
  return (
    <AdminCaseOperationsDependenciesContext.Provider value={dependencies}>
      {children}
    </AdminCaseOperationsDependenciesContext.Provider>
  );
}
