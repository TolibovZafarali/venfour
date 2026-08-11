import { queryOptions, useQuery } from "@tanstack/react-query";

import { getHealth } from "@/features/system/api/get-health";

export function healthQueryOptions() {
  return queryOptions({
    queryKey: ["system", "health"],
    queryFn: ({ signal }) => getHealth(signal),
  });
}

export function useHealthQuery() {
  return useQuery(healthQueryOptions());
}
