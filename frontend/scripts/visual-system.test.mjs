import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const tokens = readFileSync("src/styles/app-tokens.css", "utf8");
const publicSurfaces = readFileSync("src/styles/public-surfaces.css", "utf8");

describe("workspace palette contract", () => {
  it("keeps white backgrounds and grayscale neutrals around one controlled blue accent", () => {
    const accents = { brand: "2563eb", "brand-strong": "1d4ed8" };
    for (const [name, hex] of Object.entries(accents)) expect(tokens).toContain(`--${name}: #${hex};`);
    for (const token of ["background", "card", "popover", "canvas", "report-canvas"]) {
      expect(tokens).toContain(`--${token}: #ffffff;`);
    }
    for (const [, name, hex] of tokens.matchAll(/--([\w-]+): #(\w{6});/g)) {
      if (name === "destructive") continue;
      if (name in accents) {
        expect(hex, name).toBe(accents[name]);
        continue;
      }
      expect(hex.slice(0, 2), name).toBe(hex.slice(2, 4));
      expect(hex.slice(2, 4), name).toBe(hex.slice(4, 6));
    }
    expect(tokens).not.toContain("gradient(");
  });

  it("limits every marketing surface selector to public documents", () => {
    const selectors = publicSurfaces.split("\n").filter(line => /^\s*(?:\.|\[|:root)/.test(line));
    expect(selectors.length).toBeGreaterThan(20);
    for (const selector of selectors) expect(selector).toContain(':root:not([data-visual-system="app"])');
  });

  it("keeps app feature backgrounds free of gradients and tinted literal colors", () => {
    const files = [
      ...readdirSync("src/features", { recursive: true }).filter(file => file.endsWith(".css")).map(file => `src/features/${file}`),
      "src/components/customer-workspace.css",
      "src/styles/app-components.css",
    ];
    for (const file of files) {
      const css = readFileSync(file, "utf8");
      expect(css, file).not.toMatch(/(?:linear|radial|conic)-gradient\(/);
      for (const [, background] of css.matchAll(/background(?:-color)?:\s*([^;}]+)/g)) {
        for (const [, hex] of background.matchAll(/#([\da-f]{6,8})\b/gi)) {
          expect(hex.slice(0, 2), `${file}: ${background}`).toBe(hex.slice(2, 4));
          expect(hex.slice(2, 4), `${file}: ${background}`).toBe(hex.slice(4, 6));
        }
        for (const [, red, green, blue] of background.matchAll(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/g)) {
          expect(red, `${file}: ${background}`).toBe(green);
          expect(green, `${file}: ${background}`).toBe(blue);
        }
      }
    }
  });
});
