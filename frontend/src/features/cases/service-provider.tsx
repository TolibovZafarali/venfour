import type { PropsWithChildren } from "react";

import type { AppraisalCaseService } from "@/features/cases/service";
import { AppraisalCaseServiceContext } from "@/features/cases/service-context";

interface AppraisalCaseServiceProviderProps extends PropsWithChildren {
  readonly service: AppraisalCaseService | null;
}

export function AppraisalCaseServiceProvider({
  children,
  service,
}: AppraisalCaseServiceProviderProps) {
  return (
    <AppraisalCaseServiceContext.Provider value={service}>
      {children}
    </AppraisalCaseServiceContext.Provider>
  );
}
