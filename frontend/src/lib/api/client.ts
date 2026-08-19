import { isApiErrorResponse } from "@/lib/api/contracts";

interface ApiClientOptions {
  baseUrl: string;
  fetchImplementation?: typeof fetch;
}

interface AuthenticatedRequestOptions {
  readonly accessToken: string;
  readonly signal?: AbortSignal;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function buildRequestUrl(baseUrl: string, path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (baseUrl) {
    return `${baseUrl}${normalizedPath}`;
  }

  const origin =
    typeof window === "undefined" ? "http://localhost" : window.location.origin;
  return new URL(normalizedPath, origin).toString();
}

export function createApiClient({
  baseUrl,
  fetchImplementation,
}: ApiClientOptions) {
  function authenticatedHeaders(accessToken: string) {
    if (!accessToken.trim()) {
      throw new Error("An access token is required for this API request.");
    }

    return {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    };
  }

  async function request<T>(path: string, init: RequestInit): Promise<T> {
    const executeRequest = fetchImplementation ?? globalThis.fetch;
    const response = await executeRequest(buildRequestUrl(baseUrl, path), init);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError("The API returned an invalid JSON response.", 502);
    }

    if (!response.ok) {
      if (isApiErrorResponse(payload)) {
        throw new ApiError(
          payload.error.message,
          response.status,
          payload.error.code,
        );
      }
      throw new ApiError("The API request failed.", response.status);
    }

    return payload as T;
  }

  return {
    async get<T>(path: string, signal?: AbortSignal): Promise<T> {
      return request<T>(path, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal,
      });
    },

    async getAuthenticated<T>(
      path: string,
      { accessToken, signal }: AuthenticatedRequestOptions,
    ): Promise<T> {
      return request<T>(path, {
        method: "GET",
        headers: authenticatedHeaders(accessToken),
        signal,
      });
    },

    async postAuthenticated<T>(
      path: string,
      { accessToken, signal }: AuthenticatedRequestOptions,
    ): Promise<T> {
      return request<T>(path, {
        method: "POST",
        headers: authenticatedHeaders(accessToken),
        signal,
      });
    },

    async postForm<T>(path: string, body: FormData): Promise<T> {
      return request<T>(path, {
        method: "POST",
        headers: { Accept: "application/json" },
        body,
      });
    },
  };
}
