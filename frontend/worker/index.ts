const API_RESPONSE_HEADERS = new Set([
  // Representation metadata must stay with the unread upstream body. Framing
  // metadata such as Content-Length is intentionally left to the runtime.
  "accept-ranges",
  "allow",
  "content-disposition",
  "content-encoding",
  "content-language",
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
const STRIPE_WEBHOOK_PATH = "/webhooks/stripe";
const PUBLIC_ORIGIN = "https://venfour.com";
const APP_ORIGIN = "https://app.venfour.com";
const PRODUCTION_ORIGINS = new Set([PUBLIC_ORIGIN, APP_ORIGIN, "https://www.venfour.com"]);
const PUBLIC_PATHS = new Set(["/", "/contact", "/cookies", "/methodology", "/privacy", "/terms", "/refund-policy", "/referral-partners"]);

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' https:",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'self' https://challenges.cloudflare.com https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com",
  "img-src 'self' data: blob: https:",
  "manifest-src 'self'",
  "object-src 'none'",
  "script-src 'self' https://challenges.cloudflare.com https://js.stripe.com https://*.js.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "upgrade-insecure-requests",
  "worker-src 'self' blob:",
].join("; ");

export interface Env extends Omit<ProductionWorkerEnvironment, "API_ORIGIN" | "API_PROXY_SECRET"> {
  API_ORIGIN?: string;
  API_PROXY_SECRET?: string;
  STAGING_HOSTNAME?: string;
}

interface RuntimeConfiguration {
  readonly apiOrigin: URL;
  readonly apiProxySecret: string;
  readonly stagingHostname?: string;
  readonly environment: "staging" | "production";
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
  if (env.DEPLOYMENT_ENVIRONMENT === "production") {
    const apiOrigin = originOnlyHttpsUrl(env.API_ORIGIN, "The production API origin");
    if (env.STAGING_HOSTNAME || apiOrigin.hostname.includes("staging") ||
      PRODUCTION_ORIGINS.has(apiOrigin.origin)) {
      throw new RuntimeConfigurationError("The production API boundary is invalid.");
    }
    return { apiOrigin, apiProxySecret: requiredProxySecret(env.API_PROXY_SECRET), environment: "production" };
  }
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
    throw new RuntimeConfigurationError("The staging hostname is unavailable.");
  }

  return {
    apiOrigin: originOnlyHttpsUrl(env.API_ORIGIN, "The staging API origin"),
    apiProxySecret: requiredProxySecret(env.API_PROXY_SECRET),
    stagingHostname,
    environment: "staging",
  };
}

function securityHeaders(headers: Headers, indexable = false) {
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  if (indexable) headers.delete("X-Robots-Tag");
  else headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
}

function securedResponse(
  response: Response,
  cacheControl: string,
  {
    encodedBody = false,
    noStore = false,
    responseHeaders = response.headers,
    indexable = false,
  }: {
    readonly encodedBody?: boolean;
    readonly noStore?: boolean;
    readonly responseHeaders?: Headers;
    readonly indexable?: boolean;
  } = {},
) {
  const headers = new Headers(responseHeaders);
  headers.set("Cache-Control", cacheControl);
  headers.set("CDN-Cache-Control", cacheControl);
  if (noStore) {
    headers.set("Expires", "0");
    headers.set("Pragma", "no-cache");
  }
  securityHeaders(headers, indexable);
  const responseInit: ResponseInit = {
    headers,
    status: response.status,
    statusText: response.statusText,
  };
  if (encodedBody) responseInit.encodeBody = "manual";
  return new Response(response.body, responseInit);
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

function stripeWebhookMethodNotAllowedResponse() {
  const response = jsonResponse(
    405,
    "METHOD_NOT_ALLOWED",
    "This webhook endpoint requires POST.",
  );
  response.headers.set("Allow", "POST");
  return response;
}

function upstreamResponseHeaders(response: Response) {
  const headers = new Headers();
  for (const [name, value] of response.headers) {
    if (API_RESPONSE_HEADERS.has(name.toLowerCase()))
      headers.append(name, value);
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
  upstreamHeaders.set(STAGING_PROXY_HEADER_NAME, configuration.apiProxySecret);

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
      configuration.environment === "staging" ? "STAGING_API_UNAVAILABLE" : "API_UNAVAILABLE",
      configuration.environment === "staging" ? "The staging API is temporarily unavailable." : "The API is temporarily unavailable.",
    );
  }

  const responseHeaders = upstreamResponseHeaders(upstreamResponse);
  return securedResponse(upstreamResponse, "private, no-store, max-age=0", {
    encodedBody: responseHeaders.has("content-encoding"),
    noStore: true,
    responseHeaders,
  });
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

async function serveAsset(request: Request, env: Env, indexable = false) {
  const response = await env.ASSETS.fetch(request);
  const cacheControl = assetCacheControl(request, response);
  return securedResponse(response, cacheControl, {
    noStore: cacheControl.includes("no-store"),
    indexable: indexable && response.ok,
  });
}

function redirectToOrigin(url: URL, origin: string) {
  const target = new URL(origin);
  target.pathname = url.pathname;
  target.search = url.search;
  return noStoreResponse(new Response(null, { status: 308, headers: { Location: target.href } }));
}

function productionRequestOriginAllowed(request: Request, url: URL) {
  const origin = request.headers.get("origin");
  return (origin === null || origin === url.origin) && request.headers.get("sec-fetch-site") !== "cross-site";
}

async function handleProductionRequest(request: Request, env: Env, configuration: RuntimeConfiguration, dependencies: WorkerDependencies) {
  const url = new URL(request.url);
  if (url.origin !== APP_ORIGIN) {
    return jsonResponse(421, "PRODUCTION_HOST_REQUIRED", "This request is not addressed to the production application host.");
  }
  if (url.pathname === STRIPE_WEBHOOK_PATH) {
    if (request.method !== "POST") return stripeWebhookMethodNotAllowedResponse();
    return proxyToApi(request, configuration, dependencies);
  }
  if (url.pathname.startsWith("/webhooks/") || url.pathname === "/internal" || url.pathname.startsWith("/internal/")) {
    return jsonResponse(404, "NOT_FOUND", "This endpoint was not found.");
  }
  if (isApiRequest(url.pathname) || url.pathname === "/health") {
    if (!productionRequestOriginAllowed(request, url)) {
      return jsonResponse(403, "ORIGIN_NOT_ALLOWED", "This request origin is not allowed.");
    }
    return proxyToApi(request, configuration, dependencies);
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    const response = jsonResponse(405, "METHOD_NOT_ALLOWED", "This page requires GET or HEAD.");
    response.headers.set("Allow", "GET, HEAD");
    return response;
  }
  // Complete callbacks on the application origin where browser proof was created.
  if (url.pathname.replace(/\/+$/, "") === "/auth/callback") {
    const response = await serveAsset(request, env);
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
  if (url.pathname === "/robots.txt") {
    return securedResponse(new Response("User-agent: *\nDisallow: /\n", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }), "public, max-age=3600, must-revalidate");
  }
  const publicPage = PUBLIC_PATHS.has(url.pathname.replace(/\/+$/, "") || "/");
  if (publicPage && url.pathname !== "/") return redirectToOrigin(url, PUBLIC_ORIGIN);
  return serveAsset(request, env);
}

export async function handleRequest(
  request: Request,
  env: Env,
  dependencies: WorkerDependencies = defaultDependencies,
) {
  if (env.DEPLOYMENT_ENVIRONMENT === "public-site") {
    return handlePublicSiteRequest(request, env);
  }
  let configuration: RuntimeConfiguration;
  try {
    configuration = runtimeConfiguration(env);
  } catch (error) {
    if (!(error instanceof RuntimeConfigurationError)) throw error;
    return jsonResponse(
      503,
      env.DEPLOYMENT_ENVIRONMENT === "production" ? "PRODUCTION_CONFIGURATION_UNAVAILABLE" : "STAGING_CONFIGURATION_UNAVAILABLE",
      env.DEPLOYMENT_ENVIRONMENT === "production" ? "The production boundary is unavailable." : "The staging boundary is unavailable.",
    );
  }

  if (configuration.environment === "production") {
    return handleProductionRequest(request, env, configuration, dependencies);
  }

  const url = new URL(request.url);
  if (url.hostname.toLowerCase() !== configuration.stagingHostname) {
    return jsonResponse(
      421,
      "STAGING_HOST_REQUIRED",
      "This request is not addressed to the staging host.",
    );
  }

  if (url.pathname === STRIPE_WEBHOOK_PATH) {
    if (request.method !== "POST") {
      return stripeWebhookMethodNotAllowedResponse();
    }
    return proxyToApi(request, configuration, dependencies);
  }
  if (isApiRequest(url.pathname) || url.pathname === "/health") {
    return proxyToApi(request, configuration, dependencies);
  }
  return serveAsset(request, env);
}

async function handlePublicSiteRequest(request: Request, env: Env) {
  const url = new URL(request.url);
  if (![PUBLIC_ORIGIN, "https://www.venfour.com", "http://venfour.com", "http://www.venfour.com"].includes(url.origin)) {
    return jsonResponse(421, "PUBLIC_HOST_REQUIRED", "This request is not addressed to the public website.");
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse(405, "METHOD_NOT_ALLOWED", "This website accepts GET and HEAD requests only.");
  }
  if (url.protocol === "http:" || url.hostname === "www.venfour.com") return redirectToOrigin(url, PUBLIC_ORIGIN);
  if (url.pathname === "/robots.txt") {
    return securedResponse(new Response("User-agent: *\nAllow: /\n", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }), "public, max-age=3600, must-revalidate", { indexable: true });
  }
  const publicPage = PUBLIC_PATHS.has(url.pathname.replace(/\/+$/, "") || "/");
  const asset = url.pathname.startsWith("/assets/") || url.pathname === "/favicon.svg";
  if (!publicPage && !asset) {
    return noStoreResponse(new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page not found | Venfour</title><body><h1>Page not found</h1><p>This page is not available on the Venfour public website.</p><a href="/">Return to Venfour</a></body></html>', {
      status: 404, headers: { "Content-Type": "text/html; charset=utf-8" },
    }));
  }
  const response = await serveAsset(request, env, publicPage || asset);
  response.headers.set("Content-Security-Policy", [
    "default-src 'self'", "base-uri 'self'", "connect-src 'self'", "font-src 'self' data:",
    "form-action 'self'", "frame-ancestors 'none'", "frame-src 'none'", "img-src 'self' data: blob:",
    "object-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "upgrade-insecure-requests",
  ].join("; "));
  return response;
}

export default {
  fetch(request: Request, env: Env) {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
