import type { PropsWithChildren } from "react";

import {
  TotalLossDependenciesContext,
  type TotalLossDependencies,
} from "@/features/total-loss/dependencies-context";

interface TotalLossDependenciesProviderProps extends PropsWithChildren {
  readonly dependencies: TotalLossDependencies | null;
}

export function TotalLossDependenciesProvider({
  dependencies,
  children,
}: TotalLossDependenciesProviderProps) {
  return (
    <TotalLossDependenciesContext.Provider value={dependencies}>
      {children}
    </TotalLossDependenciesContext.Provider>
  );
}
