import type { PropsWithChildren } from "react";

import {
  AdminDiminishedValueDependenciesContext,
  type AdminDiminishedValueDependencies,
} from "./dependencies-context";

interface AdminDiminishedValueDependenciesProviderProps extends PropsWithChildren {
  readonly dependencies: AdminDiminishedValueDependencies | null;
}

export function AdminDiminishedValueDependenciesProvider({
  children,
  dependencies,
}: AdminDiminishedValueDependenciesProviderProps) {
  return (
    <AdminDiminishedValueDependenciesContext.Provider value={dependencies}>
      {children}
    </AdminDiminishedValueDependenciesContext.Provider>
  );
}
