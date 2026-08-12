export interface HealthResponse {
  status: "ok";
}

export interface CreateAnalysisResponse {
  runId: string;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  if (!value || typeof value !== "object" || !("error" in value)) {
    return false;
  }

  const error = value.error;
  if (!error || typeof error !== "object") {
    return false;
  }

  return (
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string"
  );
}
