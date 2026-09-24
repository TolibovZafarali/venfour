import { matchRoutes } from "react-router";
import { describe, expect, it } from "vitest";
import { appRoutes } from "@/app/router";
import { categories, screens, screenHref } from "./catalog";
import { scenarios, scenarioPath } from "./state";

describe("current screen catalog", () => {
  it("keeps unique screen IDs and exposes every customer scenario", () => {
    expect(new Set(screens.map(screen => screen.id)).size).toBe(screens.length);
    expect(new Set(categories.map(category => category.id)).size).toBe(categories.length);
    for (const [phase] of scenarios) {
      expect(screens.some(screen => screen.phase === phase || screen.path === `/_local/workspace?state=${phase}`), phase).toBe(true);
    }
  });

  it.each(screens.filter(screen => screen.id !== "not-found"))("$id targets an existing screen", screen => {
    const url = new URL(screen.path, "http://localhost");
    if (url.pathname === "/_local/businesses") return;
    const phase = scenarios.find(([id]) => id === url.searchParams.get("state"));
    const target = phase && url.pathname === "/_local/workspace" ? scenarioPath(phase[0]) : screen.path;
    const matches = matchRoutes(appRoutes, new URL(target, "http://localhost").pathname);
    expect(matches?.length, target).toBeGreaterThan(0);
    expect(matches?.at(-1)?.route.path, target).not.toBe("*");
  });

  it("resets customer examples while preserving dedicated preview runtimes", () => {
    for (const id of ["home", "find-review", "public-sign-in", "start", "workspace"]) {
      expect(screenHref(screens.find(screen => screen.id === id)!)).toBe(`/_local/workspace?screen=${id}`);
    }
    for (const id of ["entry", "admin-emails", "business-earnings"]) {
      const screen = screens.find(screen => screen.id === id)!;
      expect(screenHref(screen)).toBe(screen.path);
    }
  });
});
