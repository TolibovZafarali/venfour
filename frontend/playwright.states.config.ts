import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "states.e2e.ts",
  outputDir: "../output/playwright/states",
  fullyParallel: true,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  use: {
    baseURL: "http://127.0.0.1:4186",
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "small-phone", use: { viewport: { width: 320, height: 740 }, hasTouch: true } },
    { name: "phone", use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 } } },
    { name: "desktop", use: { viewport: { width: 1440, height: 1100 } } },
    { name: "reduced-motion", use: { viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" } },
  ],
  webServer: {
    command: "npm run preview:workspace",
    url: "http://127.0.0.1:4186",
    reuseExistingServer: !process.env.CI,
  },
});
