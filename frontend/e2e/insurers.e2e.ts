import { expect, test } from "@playwright/test";
import { insurers, insurerDirectoryMetadata, insurerMetadata, insurerPath } from "../src/features/insurers/insurers";
import { stateMetadata, states } from "../src/features/states/states";

test.beforeEach(async ({ page }) => {
  // Keep browser checks inside the fictional workspace and block external calls.
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.addInitScript(() => localStorage.setItem("venfour.cookie-consent", JSON.stringify({ version: 2, essential: true, analytics: false, advertising: false, source: "reject-non-essential", savedAt: new Date().toISOString() })));
});

test("directory and footer expose all eight guides without overflow", async ({ page }, testInfo) => {
  await page.goto("/insurers");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page).toHaveTitle(insurerDirectoryMetadata.title);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", insurerDirectoryMetadata.canonical);
  const main = page.getByRole("main");
  const paths = await main.locator('a[href^="/insurers/"]').evaluateAll(links => links.map(link => link.getAttribute("href")));
  expect(paths).toEqual([...insurers].sort((a, b) => a.name.localeCompare(b.name)).map(insurerPath));
  await expect(main.getByRole("searchbox")).toHaveCount(0);
  await expect(main.getByRole("combobox")).toHaveCount(0);
  const footer = page.getByRole("navigation", { name: "Footer insurance companies" });
  await expect(footer.getByRole("link")).toHaveCount(9);
  const expectedColumns = page.viewportSize()!.width >= 1280 ? 5 : page.viewportSize()!.width >= 640 ? 3 : 2;
  expect(await page.getByRole("navigation", { name: "Footer navigation", exact: true }).evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(expectedColumns);
  for (const insurer of insurers) {
    const link = footer.getByRole("link", { name: insurer.name, exact: true });
    await expect(link).toHaveAttribute("href", insurerPath(insurer));
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("insurer-directory.png"), fullPage: true });
  const allstate = footer.getByRole("link", { name: "Allstate", exact: true });
  await allstate.focus();
  await expect(allstate).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Understand your Allstate total-loss offer.");
  await expect(page).toHaveURL(/\/insurers\/allstate$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test("Liberty Mutual guide supports readable tables, keyboard sections, and the existing intake", async ({ page }, testInfo) => {
  await page.goto("/insurers/liberty-mutual");
  const article = page.getByRole("article");
  await expect(article.getByRole("heading", { level: 1 })).toHaveText("Understand your Liberty Mutual total-loss offer.");
  await expect(article.locator("details:not([open])")).toHaveCount(0);
  const table = article.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(5);
  expect(await table.locator("th, td").evaluateAll(cells => cells.every(cell => cell.scrollWidth <= cell.clientWidth))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const contents = article.getByRole("navigation", { name: "On this page" });
  await expect(contents.getByRole("link")).toHaveCount(5);
  await contents.getByRole("link", { name: "Common questions", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(article.locator("#liberty-mutual-faq-title")).toBeFocused();
  await expect(article.locator("#liberty-mutual-faq-title")).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("liberty-mutual-hero.png") });
  await page.screenshot({ path: testInfo.outputPath("liberty-mutual-guide.png"), fullPage: true });
  const actions = article.getByRole("link", { name: "Start my free valuation" });
  await expect(actions).toHaveCount(2);
  for (const action of await actions.all()) await expect(action).toHaveAttribute("href", "/start?service=total-loss");
  await article.getByRole("link", { name: "All insurer guides", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(actions.first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/start\?service=total-loss$/);
  await expect(page.getByRole("heading", { name: "Start with a free valuation." })).toBeVisible();
});

test("deep section links focus the selected heading on first load", async ({ page }) => {
  await page.goto("/insurers/state-farm#state-farm-review-title");
  const heading = page.locator("#state-farm-review-title");
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
});

for (const insurer of insurers) {
  test(`${insurer.name} guide renders with its own metadata and sources`, async ({ page }, testInfo) => {
    test.skip(!["small-phone", "desktop"].includes(testInfo.project.name), "The representative guide covers the full viewport matrix.");
    await page.goto(insurerPath(insurer));
    const article = page.getByRole("article");
    await expect(article.getByRole("heading", { level: 1 })).toHaveText(`Understand your ${insurer.name} total-loss offer.`);
    await expect(page).toHaveTitle(insurerMetadata(insurer).title);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", insurerMetadata(insurer).description);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", insurerMetadata(insurer).canonical);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", insurerMetadata(insurer).canonical);
    await expect(article.locator("time")).toHaveAttribute("datetime", /\d{4}-\d{2}-\d{2}/);
    expect(await article.locator('a[href^="https://"]').count()).toBeGreaterThan(0);
    await expect(article.getByRole("link", { name: "Start my free valuation" })).toHaveCount(2);
    expect(await article.getByRole("table").locator("th, td").evaluateAll(cells => cells.every(cell => cell.scrollWidth <= cell.clientWidth))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${insurer.slug}-guide.png`), fullPage: true });
  });
}

test("navigation replaces insurer sources and metadata and clears them on ordinary pages", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Metadata behavior is independent of viewport.");
  await page.goto("/insurers/geico?source=example");
  await expect(page.getByRole("article").getByRole("heading", { level: 1 })).toContainText("GEICO");
  await page.getByRole("navigation", { name: "Footer insurance companies" }).getByRole("link", { name: "State Farm", exact: true }).click();
  await expect(page.getByRole("article").getByRole("heading", { level: 1 })).toContainText("State Farm");
  await expect(page.locator("#geico-documents-title")).toHaveCount(0);
  await expect(page.getByRole("article").locator('a[href*="geico.com"]')).toHaveCount(0);
  await expect(page).toHaveTitle(insurerMetadata(insurers.find(insurer => insurer.slug === "state-farm")!).title);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  await page.getByRole("navigation", { name: "Footer states" }).getByRole("link", { name: "Missouri", exact: true }).click();
  await expect(page.getByRole("article").getByRole("heading", { level: 1 })).toContainText("Missouri");
  await expect(page.locator("#state-farm-documents-title")).toHaveCount(0);
  await expect(page).toHaveTitle(stateMetadata(states.find(state => state.code === "MO")!).title);
  await page.getByRole("link", { name: "How we review reports", exact: true }).click();
  await expect(page).toHaveTitle("Total-Loss Review Methodology | Venfour");
  await expect(page.locator("[data-page-metadata]")).toHaveCount(0);
});

test("homepage and directory do not download unvisited insurer guides", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Content loading is independent of viewport.");
  const requestedGuides = new Set<string>();
  page.on("request", request => {
    const match = new URL(request.url()).pathname.match(/\/features\/insurers\/guides\/([^/]+)\.ts$/);
    if (match) requestedGuides.add(match[1]);
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect([...requestedGuides]).toEqual([]);
  await page.getByRole("navigation", { name: "Footer insurance companies" }).getByRole("link", { name: /All insurer guides/ }).click();
  await expect(page).toHaveURL(/\/insurers$/);
  expect([...requestedGuides]).toEqual([]);
  await page.getByRole("main").locator('a[href="/insurers/geico"]').click();
  await expect(page.getByRole("article").getByRole("heading", { level: 1 })).toContainText("GEICO");
  expect([...requestedGuides]).toEqual(["geico"]);
  await page.getByRole("navigation", { name: "Footer insurance companies" }).getByRole("link", { name: "State Farm", exact: true }).click();
  await expect(page.getByRole("article").getByRole("heading", { level: 1 })).toContainText("State Farm");
  expect([...requestedGuides].sort()).toEqual(["geico", "state-farm"]);
});

test("failed guide downloads recover through the existing retry button", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Download recovery is independent of viewport.");
  let failDownload = true;
  await page.route("**/features/insurers/guides/state-farm.ts*", route => failDownload ? route.abort() : route.continue());
  await page.goto("/insurers/state-farm");
  await expect(page.getByRole("alert")).toContainText("We couldn’t display this page.");
  await expect(page.getByRole("article")).toHaveCount(0);
  failDownload = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("article").getByRole("heading", { level: 1 })).toHaveText("Understand your State Farm total-loss offer.");
});

test("unknown, uppercase, and nested insurer paths show the not-found page", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Route rejection is independent of viewport.");
  for (const path of ["/insurers/not-an-insurer", "/insurers/GEICO", "/insurers/state-farm/extra"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  }
});
