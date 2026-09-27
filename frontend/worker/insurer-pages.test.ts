import { afterEach, describe, expect, it, vi } from "vitest";
import { insurers, insurerPath, insurerMetadata, insurerDirectoryMetadata } from "../src/features/insurers/insurers";
import { handleRequest, type Env } from "./index";

const publicEnv = (fetch = vi.fn(async () => new Response("asset"))): Env => ({
  DEPLOYMENT_ENVIRONMENT: "public-site", ASSETS: { fetch } as unknown as Fetcher,
});
const pages = [
  { name: "Insurer directory", path: "/insurers", metadata: insurerDirectoryMetadata },
  ...insurers.map(insurer => ({ name: insurer.name, path: insurerPath(insurer), metadata: insurerMetadata(insurer) })),
];

afterEach(() => vi.unstubAllGlobals());

describe("public insurer routes", () => {
  it.each(pages)("serves $name as an indexable page without backend access", async ({ path }) => {
    const env = publicEnv();
    const fetch = vi.fn();
    const response = await handleRequest(new Request(`https://venfour.com${path}`), env, { fetch });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBeNull();
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["/Insurers", "/insurers/unknown", "/insurers/aaa", "/insurers/AAA-CSAA", "/insurers/aaa-csaa/extra", "/insurers/GEICO", "/insurers/state_farm", "/insurers/geico/extra", "/insurers/geico/texas"])("returns an actual non-indexable 404 for %s", async path => {
    const env = publicEnv();
    const fetch = vi.fn();
    const response = await handleRequest(new Request(`https://venfour.com${path}`), env, { fetch });
    expect(response.status).toBe(404);
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("includes the directory and each guide exactly once in the sitemap", async () => {
    const response = await handleRequest(new Request("https://venfour.com/sitemap.xml"), publicEnv());
    const sitemap = await response.text();
    for (const { path } of pages) expect(sitemap.split(`<loc>https://venfour.com${path}</loc>`)).toHaveLength(2);
    expect(sitemap).toContain("<loc>https://venfour.com/states/missouri</loc>");
    expect(sitemap).not.toContain("/insurers/unknown");
  });

  it.each(pages)("redirects application-host $name to the public host with its query", async ({ path }) => {
    const env: Env = { ...publicEnv(), DEPLOYMENT_ENVIRONMENT: "production", API_ORIGIN: "https://api.example.test", API_PROXY_SECRET: "test-proxy-secret-value-123456789" };
    const fetch = vi.fn();
    const response = await handleRequest(new Request(`https://app.venfour.com${path}/?source=link`), env, { fetch });
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(`https://venfour.com${path}/?source=link`);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(pages)("rewrites $name metadata before delivery and retains response protections", async ({ path, metadata }) => {
    const rewritten: Record<string, { text?: string; attributes?: Record<string, string>; html?: string }> = {};
    const transform = vi.fn((response: Response) => response);
    vi.stubGlobal("HTMLRewriter", class {
      on(selector: string, handler: { element: (element: unknown) => void }) {
        rewritten[selector] = {};
        handler.element({
          setInnerContent: (text: string) => { rewritten[selector].text = text; },
          setAttribute: (name: string, value: string) => { rewritten[selector].attributes = { [name]: value }; },
          append: (html: string) => { rewritten[selector].html = html; },
        });
        return this;
      }
      transform = transform;
    });
    const env = publicEnv(vi.fn(async () => new Response('<html><head><title>Venfour</title><meta name="description" content="Home"></head></html>', { headers: { "Content-Type": "text/html", "ETag": "old", "Content-Length": "100" } })));
    const response = await handleRequest(new Request(`https://venfour.com${path}/?source=link`), env);
    expect(metadata.canonical).toBe(`https://venfour.com${path}`);
    expect(rewritten.title.text).toBe(metadata.title);
    expect(rewritten['meta[name="description"]'].attributes?.content).toBe(metadata.description);
    expect(rewritten.head.html).toContain(`data-page-metadata rel="canonical" href="${metadata.canonical}"`);
    expect(rewritten.head.html).toContain(`property="og:title" content="${metadata.title.replaceAll("&", "&amp;")}"`);
    expect(rewritten.head.html).toContain(`property="og:description" content="${metadata.description.replaceAll("&", "&amp;")}"`);
    expect(rewritten.head.html).toContain(`property="og:url" content="${metadata.canonical}"`);
    expect(rewritten.head.html).not.toContain("source=link");
    expect(response.headers.get("ETag")).toBeNull();
    expect(response.headers.get("Content-Length")).toBeNull();
    expect(response.headers.get("x-robots-tag")).toBeNull();
    expect(response.headers.get("Content-Security-Policy")).toContain("connect-src 'self'");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(transform).toHaveBeenCalledOnce();
  });

  it.each([
    { name: "HEAD requests", method: "HEAD", status: 200, contentType: "text/html" },
    { name: "failed assets", method: "GET", status: 503, contentType: "text/html" },
    { name: "non-HTML assets", method: "GET", status: 200, contentType: "text/plain" },
  ])("does not rewrite $name", async ({ method, status, contentType }) => {
    const rewriter = vi.fn();
    vi.stubGlobal("HTMLRewriter", rewriter);
    const env = publicEnv(vi.fn(async () => new Response("asset", { status, headers: { "Content-Type": contentType, "ETag": "original" } })));
    const response = await handleRequest(new Request("https://venfour.com/insurers/geico", { method }), env);
    expect(response.status).toBe(status);
    expect(response.headers.get("ETag")).toBe("original");
    expect(rewriter).not.toHaveBeenCalled();
    if (status >= 400) expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });
});
