const API_RESPONSE_HEADERS = new Set([
  "accept-ranges",
  "allow",
  "content-disposition",
  "content-language",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
  "location",
  "retry-after",
  "vary",
  "www-authenticate",
  "x-request-id",
]);

const PROXY_REQUEST_HEADERS_TO_REMOVE = [
  "connection",
  "content-length",
  "expect",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-venfour-staging-proxy",
] as const;

const STAGING_PROXY_HEADER_NAME = "X-Venfour-Staging-Proxy";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' https:",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https:",
  "manifest-src 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "upgrade-insecure-requests",
  "worker-src 'self' blob:",
].join("; ");

export interface Env {
  API_PROXY_SECRET: string;
  ASSETS: Fetcher;
  API_ORIGIN: string;
  DEPLOYMENT_ENVIRONMENT: string;
  STAGING_HOSTNAME: string;
}

interface RuntimeConfiguration {
  readonly apiOrigin: URL;
  readonly apiProxySecret: string;
  readonly stagingHostname: string;
}

export interface WorkerDependencies {
  readonly fetch: typeof fetch;
}

const defaultDependencies: WorkerDependencies = {
  fetch: (request, init) => fetch(request, init),
};

class RuntimeConfigurationError extends Error {}

function originOnlyHttpsUrl(value: unknown, label: string) {
  if (typeof value !== "string" || value !== value.trim() || !value) {
    throw new RuntimeConfigurationError(`${label} is unavailable.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RuntimeConfigurationError(`${label} is invalid.`);
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new RuntimeConfigurationError(`${label} is invalid.`);
  }
  return parsed;
}

function requiredProxySecret(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length < 32 ||
    value.length > 512 ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 33 || codePoint > 126;
    })
  ) {
    throw new RuntimeConfigurationError(
      "The staging API proxy credential is unavailable.",
    );
  }
  return value;
}

function runtimeConfiguration(env: Env): RuntimeConfiguration {
  if (env.DEPLOYMENT_ENVIRONMENT !== "staging") {
    throw new RuntimeConfigurationError(
      "The staging deployment environment is unavailable.",
    );
  }

  const stagingHostname = env.STAGING_HOSTNAME?.trim().toLowerCase();
  if (
    !stagingHostname ||
    stagingHostname !== env.STAGING_HOSTNAME ||
    stagingHostname.includes(":") ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(stagingHostname)
  ) {
    throw new RuntimeConfigurationError(
      "The staging hostname is unavailable.",
    );
  }

  return {
    apiOrigin: originOnlyHttpsUrl(env.API_ORIGIN, "The staging API origin"),
    apiProxySecret: requiredProxySecret(env.API_PROXY_SECRET),
    stagingHostname,
  };
}

function securityHeaders(headers: Headers) {
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
}

function securedResponse(
  response: Response,
  cacheControl: string,
  { noStore = false }: { readonly noStore?: boolean } = {},
) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", cacheControl);
  headers.set("CDN-Cache-Control", cacheControl);
  if (noStore) {
    headers.set("Expires", "0");
    headers.set("Pragma", "no-cache");
  }
  securityHeaders(headers);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function noStoreResponse(response: Response) {
  return securedResponse(response, "private, no-store, max-age=0", {
    noStore: true,
  });
}

function jsonResponse(status: number, code: string, message: string) {
  return noStoreResponse(
    new Response(JSON.stringify({ error: { code, message } }), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
      status,
    }),
  );
}

function isApiRequest(pathname: string) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function upstreamResponseHeaders(response: Response) {
  const headers = new Headers();
  for (const [name, value] of response.headers) {
    if (API_RESPONSE_HEADERS.has(name.toLowerCase())) headers.append(name, value);
  }
  for (const cookie of response.headers.getSetCookie()) {
    headers.append("Set-Cookie", cookie);
  }
  return headers;
}

async function proxyToApi(
  request: Request,
  configuration: RuntimeConfiguration,
  dependencies: WorkerDependencies,
) {
  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(configuration.apiOrigin);
  upstreamUrl.pathname = incomingUrl.pathname;
  upstreamUrl.search = incomingUrl.search;

  const upstreamHeaders = new Headers(request.headers);
  for (const name of PROXY_REQUEST_HEADERS_TO_REMOVE) {
    upstreamHeaders.delete(name);
  }
  upstreamHeaders.set(
    STAGING_PROXY_HEADER_NAME,
    configuration.apiProxySecret,
  );

  const upstreamRequestInit: RequestInit & { duplex?: "half" } = {
    headers: upstreamHeaders,
    method: request.method,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    upstreamRequestInit.body = request.body;
    upstreamRequestInit.duplex = "half";
  }

  // Explicitly carrying the headers preserves Authorization, Content-Type,
  // OAuth cookies, and Cloudflare Access headers. Access itself remains the
  // perimeter policy and is intentionally not reimplemented here.
  const upstreamRequest = new Request(upstreamUrl, upstreamRequestInit);

  let upstreamResponse: Response;
  try {
    upstreamResponse = await dependencies.fetch(upstreamRequest, {
      redirect: "manual",
    });
  } catch {
    return jsonResponse(
      502,
      "STAGING_API_UNAVAILABLE",
      "The staging API is temporarily unavailable.",
    );
  }

  return noStoreResponse(
    new Response(upstreamResponse.body, {
      headers: upstreamResponseHeaders(upstreamResponse),
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
    }),
  );
}

function assetCacheControl(request: Request, response: Response) {
  if (!response.ok) return "private, no-store, max-age=0";
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/html")) {
    return "private, no-store, max-age=0";
  }

  const pathname = new URL(request.url).pathname;
  if (/^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/u.test(pathname)) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=3600, must-revalidate";
}

async function serveAsset(request: Request, env: Env) {
  const response = await env.ASSETS.fetch(request);
  const cacheControl = assetCacheControl(request, response);
  return securedResponse(response, cacheControl, {
    noStore: cacheControl.includes("no-store"),
  });
}

export async function handleRequest(
  request: Request,
  env: Env,
  dependencies: WorkerDependencies = defaultDependencies,
) {
  let configuration: RuntimeConfiguration;
  try {
    configuration = runtimeConfiguration(env);
  } catch (error) {
    if (!(error instanceof RuntimeConfigurationError)) throw error;
    return jsonResponse(
      503,
      "STAGING_CONFIGURATION_UNAVAILABLE",
      "The staging boundary is unavailable.",
    );
  }

  const url = new URL(request.url);
  if (url.hostname.toLowerCase() !== configuration.stagingHostname) {
    return jsonResponse(
      421,
      "STAGING_HOST_REQUIRED",
      "This request is not addressed to the staging host.",
    );
  }

  if (isApiRequest(url.pathname) || url.pathname === "/health") {
    return proxyToApi(request, configuration, dependencies);
  }
  return serveAsset(request, env);
}

export default {
  fetch(request: Request, env: Env) {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
