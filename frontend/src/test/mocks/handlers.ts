import { http, HttpResponse } from "msw";

import type { HealthResponse } from "@/lib/api/contracts";

export const handlers = [
  http.get("*/health", () =>
    HttpResponse.json<HealthResponse>({ status: "ok" }),
  ),
];
