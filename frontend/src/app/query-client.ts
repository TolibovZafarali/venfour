import { QueryClient } from "@tanstack/react-query";

interface QueryClientOptions {
  retry?: boolean | number;
}

export function createAppQueryClient({ retry = 1 }: QueryClientOptions = {}) {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  });
}
