import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import type { RouterProviderProps } from "react-router";

interface AppProviderProps {
  queryClient: QueryClient;
  router: RouterProviderProps["router"];
}

export function AppProvider({ queryClient, router }: AppProviderProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
