import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRequest, type Env } from "./index";
import { states, statePath, stateMetadata } from "../src/features/states/states";

const publicEnv = (fetch = vi.fn(async () => new Response("asset"))): Env => ({
  DEPLOYMENT_ENVIRONMENT: "public-site", ASSETS: { fetch } as unknown as Fetcher,
});

afterEach(() => vi.unstubAllGlobals());

describe("public state routes", () => {
  it.each(states)("serves $name without backend access", async state => {
    const env = publicEnv();
    const fetch = vi.fn();
    const response = await handleRequest(new Request(`https://venfour.com${statePath(state)}`), env, { fetch });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBeNull();
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["/states", "/states/", "/states/not-a-state", "/states/Missouri", "/states/missouri/more", "/states/puerto-rico"])("returns an actual 404 for %s", async path => {
    const env = publicEnv();
    const response = await handleRequest(new Request(`https://venfour.com${path}`), env);
    expect(response.status).toBe(404);
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("includes all canonical state URLs exactly once in the existing sitemap", async () => {
    const response = await handleRequest(new Request("https://venfour.com/sitemap.xml"), publicEnv());
    const sitemap = await response.text();
    for (const state of states) expect(sitemap.split(`<loc>https://venfour.com${statePath(state)}</loc>`)).toHaveLength(2);
    expect(sitemap).toContain("<loc>https://venfour.com/</loc>");
    expect(sitemap).toContain("<loc>https://venfour.com/privacy</loc>");
    expect(sitemap).not.toContain("<loc>https://venfour.com/states</loc>");
  });

  it.each(["/states/missouri", "/states/district-of-columbia/"])("redirects application-host %s to the public host", async path => {
    const env: Env = { ...publicEnv(), DEPLOYMENT_ENVIRONMENT: "production", API_ORIGIN: "https://api.example.test", API_PROXY_SECRET: "test-proxy-secret-value-123456789" };
    const response = await handleRequest(new Request(`https://app.venfour.com${path}?source=link`), env);
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(`https://venfour.com${path}?source=link`);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("rewrites state HTML metadata before it reaches crawlers while retaining response protections", async () => {
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
    const response = await handleRequest(new Request("https://venfour.com/states/missouri/?source=link"), env);
    const metadata = stateMetadata(states.find(state => state.code === "MO")!);
    expect(rewritten.title.text).toBe(metadata.title);
    expect(rewritten['meta[name="description"]'].attributes?.content).toBe(metadata.description);
    expect(rewritten.head.html).toContain(`rel="canonical" href="${metadata.canonical}"`);
    expect(rewritten.head.html).toContain('property="og:title"');
    expect(rewritten.head.html).toContain('property="og:description"');
    expect(rewritten.head.html).not.toContain("source=link");
    expect(response.headers.get("ETag")).toBeNull();
    expect(response.headers.get("Content-Length")).toBeNull();
    expect(response.headers.get("Content-Security-Policy")).toContain("connect-src 'self'");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(transform).toHaveBeenCalledOnce();
  });
});
