import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { updatePublicSessionHint, usePublicSessionHint } from "./public-session-hint";

const originalUrl = window.location.href;
const browserEnvironment = globalThis as typeof globalThis & {
  jsdom: {
    reconfigure(options: { url: string }): void;
    cookieJar: {
      getCookiesSync(url: string): Array<{ key: string; value: string; domain: string; path: string; secure: boolean; sameSite: string; maxAge: number }>;
      removeAllCookiesSync(): void;
    };
  };
};

afterEach(() => {
  vi.useRealTimers();
  browserEnvironment.jsdom.cookieJar.removeAllCookiesSync();
  browserEnvironment.jsdom.reconfigure({ url: originalUrl });
});

describe("public navigation session hint", () => {
  it("writes only a short-lived boolean visible on both public hosts", () => {
    browserEnvironment.jsdom.reconfigure({ url: "https://app.venfour.com/app" });
    localStorage.setItem("private-session", "origin-only-token");
    updatePublicSessionHint(true);

    for (const origin of ["https://venfour.com", "https://www.venfour.com"]) {
      expect(browserEnvironment.jsdom.cookieJar.getCookiesSync(origin)).toEqual([
        expect.objectContaining({
          key: "venfour.app-session", value: "1", domain: "venfour.com",
          path: "/", secure: true, sameSite: "lax", maxAge: 900,
        }),
      ]);
    }
    expect(localStorage.getItem("private-session")).toBe("origin-only-token");
    expect(document.cookie).toBe("venfour.app-session=1");

    browserEnvironment.jsdom.reconfigure({ url: "https://venfour.com" });
    const { result } = renderHook(usePublicSessionHint);
    expect(result.current).toBe(true);
  });

  it.each([
    "https://venfour.com", "https://www.venfour.com", "https://partners.venfour.com", "https://staging.venfour.com",
    "http://app.venfour.com", "https://app.venfour.com.example", "http://localhost:5173",
  ])("does not let %s write or clear the app hint", origin => {
    browserEnvironment.jsdom.reconfigure({ url: "https://app.venfour.com" });
    updatePublicSessionHint(true);
    browserEnvironment.jsdom.reconfigure({ url: origin });
    const writeCookie = vi.spyOn(document, "cookie", "set");
    updatePublicSessionHint(false);
    updatePublicSessionHint(true);
    expect(writeCookie).not.toHaveBeenCalled();
    expect(browserEnvironment.jsdom.cookieJar.getCookiesSync("https://venfour.com")[0]?.value).toBe("1");
  });

  it("clears the public hint when the app no longer has a permanent session", () => {
    browserEnvironment.jsdom.reconfigure({ url: "https://app.venfour.com" });
    updatePublicSessionHint(true);
    updatePublicSessionHint(false);
    expect(browserEnvironment.jsdom.cookieJar.getCookiesSync("https://venfour.com")).toEqual([]);
  });

  it("ignores the hint on the application, staging and local hosts", () => {
    browserEnvironment.jsdom.reconfigure({ url: "https://app.venfour.com" });
    updatePublicSessionHint(true);
    for (const origin of ["https://app.venfour.com", "https://staging.venfour.com", "http://localhost:5173"]) {
      browserEnvironment.jsdom.reconfigure({ url: origin });
      const view = renderHook(usePublicSessionHint);
      expect(view.result.current).toBe(false);
      view.unmount();
    }
  });

  it("updates an open public page after sign-out and rejects malformed values", () => {
    browserEnvironment.jsdom.reconfigure({ url: "https://app.venfour.com" });
    updatePublicSessionHint(true);
    browserEnvironment.jsdom.reconfigure({ url: "https://venfour.com" });
    const { result } = renderHook(usePublicSessionHint);
    expect(result.current).toBe(true);
    document.cookie = "venfour.app-session=invalid; Domain=venfour.com; Path=/; Secure";
    act(() => window.dispatchEvent(new Event("focus")));
    expect(result.current).toBe(false);
    document.cookie = "venfour.app-session=1; Domain=venfour.com; Path=/; Secure";
    act(() => window.dispatchEvent(new Event("pageshow")));
    expect(result.current).toBe(true);
    document.cookie = "venfour.app-session=; Domain=venfour.com; Path=/; Secure; Max-Age=0";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current).toBe(false);
  });

  it("notices browser cookie expiration on the next public refresh without rewriting it", () => {
    vi.useFakeTimers();
    browserEnvironment.jsdom.reconfigure({ url: "https://app.venfour.com" });
    updatePublicSessionHint(true);
    browserEnvironment.jsdom.reconfigure({ url: "https://venfour.com" });
    const { result } = renderHook(usePublicSessionHint);
    expect(result.current).toBe(true);
    document.cookie = "venfour.app-session=; Domain=venfour.com; Path=/; Secure; Max-Age=0";
    const writeCookie = vi.spyOn(document, "cookie", "set");
    act(() => vi.advanceTimersByTime(30_000));
    expect(result.current).toBe(false);
    expect(writeCookie).not.toHaveBeenCalled();
  });

  it("keeps authentication independent of unavailable cookies", () => {
    browserEnvironment.jsdom.reconfigure({ url: "https://app.venfour.com" });
    vi.spyOn(document, "cookie", "set").mockImplementation(() => { throw new Error("Cookies are unavailable."); });
    expect(() => updatePublicSessionHint(true)).not.toThrow();
    expect(() => updatePublicSessionHint(false)).not.toThrow();
    browserEnvironment.jsdom.reconfigure({ url: "https://venfour.com" });
    vi.spyOn(document, "cookie", "get").mockImplementation(() => { throw new Error("Cookies are unavailable."); });
    expect(renderHook(usePublicSessionHint).result.current).toBe(false);
  });
});
