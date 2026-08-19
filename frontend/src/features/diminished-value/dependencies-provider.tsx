import type { PropsWithChildren } from "react";

import {
  DiminishedValueDependenciesContext,
  type DiminishedValueDependencies,
} from "./dependencies-context";

interface DiminishedValueDependenciesProviderProps extends PropsWithChildren {
  readonly dependencies: DiminishedValueDependencies | null;
}

export function DiminishedValueDependenciesProvider({
  dependencies,
  children,
}: DiminishedValueDependenciesProviderProps) {
  return (
    <DiminishedValueDependenciesContext.Provider value={dependencies}>
      {children}
    </DiminishedValueDependenciesContext.Provider>
  );
}
