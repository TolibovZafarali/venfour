import { createContext, useContext } from "react";

import type { CustomerProfileService } from "./service";

export const CustomerProfileServiceContext =
  createContext<CustomerProfileService | null>(null);

export function useCustomerProfileService() {
  return useContext(CustomerProfileServiceContext);
}
