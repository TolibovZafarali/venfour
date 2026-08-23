import type { PropsWithChildren } from "react";

import type { CustomerProfileService } from "./service";
import { CustomerProfileServiceContext } from "./service-context";

interface CustomerProfileServiceProviderProps extends PropsWithChildren {
  readonly service: CustomerProfileService | null;
}

export function CustomerProfileServiceProvider({
  children,
  service,
}: CustomerProfileServiceProviderProps) {
  return (
    <CustomerProfileServiceContext.Provider value={service}>
      {children}
    </CustomerProfileServiceContext.Provider>
  );
}
