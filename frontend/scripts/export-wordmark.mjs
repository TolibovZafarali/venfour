import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const source = new URL("../../assets/brand/venfour-wordmark.svg", import.meta.url);
const destination = new URL("../public/assets/brand/venfour-wordmark.png", import.meta.url);
const svg = await readFile(source, "utf8");
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({ deviceScaleFactor: 3 });
  await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
  await mkdir(new URL(".", destination), { recursive: true });
  await page.locator("svg").screenshot({ path: fileURLToPath(destination), omitBackground: true });
  console.log(`Exported ${fileURLToPath(destination)}`);
} finally {
  await browser.close();
}
