import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { states, statePath, stateFromPath, findState, footerStates } from "./states";
import { stateMapPaths, stateMapViewBoxes } from "./map-paths";
import { routeAudience } from "@/app/site-boundary";

describe("state catalog", () => {
  it("matches the existing nationwide jurisdictions without publishing their policy records", () => {
    const config = JSON.parse(readFileSync("../venfour/data/nationwide_product_v1.json", "utf8"));
    expect(states.map(({ code, name }) => ({ code, name }))).toEqual(config.jurisdictions.map(({ code, name }: { code: string; name: string }) => ({ code, name })));
    expect(states).toHaveLength(51);
    expect(new Set(states.map(state => state.slug)).size).toBe(51);
    expect(Object.keys(stateMapPaths).sort()).toEqual(states.map(state => state.code).sort());
  });

  it.each(states)("resolves $name and exposes it as a public route with geography", state => {
    expect(stateFromPath(statePath(state))).toBe(state);
    expect(stateFromPath(`${statePath(state)}/`)).toBe(state);
    expect(routeAudience(statePath(state))).toBe("public");
    expect(stateMapPaths[state.code]).toMatch(/^M[\d.,LZM-]+Z$/);
    const [x, y, width, height] = stateMapViewBoxes[state.code].split(" ").map(Number);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    for (const point of stateMapPaths[state.code].matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)) {
      expect(Number(point[1])).toBeGreaterThan(x);
      expect(Number(point[1])).toBeLessThan(x + width);
      expect(Number(point[2])).toBeGreaterThan(y);
      expect(Number(point[2])).toBeLessThan(y + height);
    }
  });

  it.each(["/states", "/states/", "/states/unknown", "/states/Missouri", "/states/missouri/extra", "/states/puerto-rico"])("does not register unsupported path %s", path => {
    expect(stateFromPath(path)).toBeUndefined();
  });

  it("selects ten valid footer destinations", () => {
    expect(footerStates).toHaveLength(10);
    expect(footerStates.map(state => state.code)).toContain("MO");
    expect(findState("district-of-columbia")?.code).toBe("DC");
  });
});
