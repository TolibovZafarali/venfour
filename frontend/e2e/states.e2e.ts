import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // All data and service calls come from the existing fictional workspace.
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.addInitScript(() => localStorage.setItem("venfour.cookie-consent", JSON.stringify({ version: 2, essential: true, analytics: false, advertising: false, source: "reject-non-essential", savedAt: new Date().toISOString() })));
});

test("map scales without overflow and every state has usable geography", async ({ page }, testInfo) => {
  await page.goto("/#states");
  const section = page.locator("#states");
  await expect(section).toBeFocused();
  const map = page.getByRole("group", { name: "United States map" });
  await expect(map.getByRole("link")).toHaveCount(51);
  const sizes = await map.locator("path").evaluateAll(paths => paths.map(path => {
    const box = (path as SVGPathElement).getBBox();
    return { width: box.width, height: box.height };
  }));
  expect(sizes.every(size => size.width > 0 && size.height > 0)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(section.getByRole("combobox")).toHaveCount(0);
  await expect(section.getByText(/Alaska and Hawaii shown as insets/)).toHaveCount(0);
  await expect(section.getByText("Find your state", { exact: true })).toHaveCount(0);
  await expect(section.getByText("Select a state on the map.", { exact: true })).toHaveCount(0);
  await expect(section.getByText("All 50 states. And D.C.")).toHaveCSS("color", "rgb(0, 78, 235)");
  await expect(section).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(section).toHaveCSS("border-top-width", "0px");
  await expect(section).toHaveCSS("border-bottom-width", "0px");
  await expect(section.getByRole("heading", { name: "Nationwide support. Local clarity." })).toHaveCSS("text-align", "center");
  const headingBox = (await section.locator("h2").boundingBox())!;
  const sectionBox = (await section.boundingBox())!;
  expect(Math.abs(headingBox.x + headingBox.width / 2 - sectionBox.x - sectionBox.width / 2)).toBeLessThan(1);
  expect(await section.evaluate(element => element.parentElement === document.querySelector("#example")?.parentElement && element.parentElement === document.querySelector("#faq")?.parentElement)).toBe(true);
  await section.screenshot({ path: testInfo.outputPath("map.png") });
  const guide = section.getByRole("link", { name: "Washington, D.C." });
  expect((await guide.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await guide.click();
  await expect(page).toHaveURL(/\/states\/district-of-columbia$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("District of Columbia");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("state-page.png"), fullPage: true });
});

test("map supports native keyboard and pointer navigation with visible feedback", async ({ page }, testInfo) => {
  await page.goto("/#states");
  const map = page.getByRole("group", { name: "United States map" });
  const alaska = map.getByRole("link", { name: "Alaska", exact: true });
  await alaska.focus();
  await expect(map.locator("..")).not.toHaveAttribute("data-scroll-reveal");
  await expect(map.locator("..")).toHaveCSS("opacity", "1");
  await expect(page.locator(".states-map__caption")).toContainText("Alaska");
  await expect(alaska).toHaveCSS("fill", "rgb(21, 94, 239)");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/states\/alaska$/);
  await page.goto("/#states");
  await expect(page.locator("#states")).toBeFocused();
  const missouri = map.getByRole("link", { name: "Missouri", exact: true });
  await missouri.hover();
  await expect(page.locator(".states-map__caption")).toContainText("Missouri");
  await expect(missouri).toHaveCSS("fill", "rgb(21, 94, 239)");
  await page.screenshot({ path: testInfo.outputPath("hover-map.png") });
  await missouri.click();
  await expect(page).toHaveURL(/\/states\/missouri$/);
  await expect(page).toHaveTitle("Missouri Total-Loss Guide & Valuation Review | Venfour");
});

test("map elements follow the shared scroll entrance and reduced-motion behavior", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#states");
  const targets = section.locator("[data-home-entrance]");
  await expect(targets).toHaveCount(5);
  const reducedMotion = await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  for (const target of await targets.all()) {
    if (reducedMotion) {
      await expect(target).not.toHaveAttribute("data-scroll-reveal");
      await expect(target).toHaveCSS("opacity", "1");
    } else {
      await expect(target).toHaveAttribute("data-scroll-reveal", "pending");
      await expect(target).toHaveCSS("opacity", "0");
    }
  }

  const visual = section.locator('[data-home-entrance="visual"]');
  await page.mouse.wheel(0, (await visual.boundingBox())!.y - 200);
  if (!reducedMotion) {
    await expect(visual).toHaveAttribute("data-scroll-reveal", "entering");
    await expect(visual).toHaveCSS("animation-name", "scroll-opacity-enter, scroll-focus-enter");
    await expect(visual).toHaveCSS("animation-delay", "0.16s, 0.16s");
  }
  await expect(visual).not.toHaveAttribute("data-scroll-reveal");
  await section.locator(".states-map__caption").scrollIntoViewIfNeeded();
  for (const target of await targets.all()) {
    await expect(target).not.toHaveAttribute("data-scroll-reveal");
    await expect(target).toHaveCSS("opacity", "1");
  }
  await page.mouse.wheel(0, -600);
  await expect(section.locator("[data-scroll-reveal]")).toHaveCount(0);
});

test("footer returns cleanly to the map, including repeated homepage use", async ({ page }, testInfo) => {
  await page.goto("/states/new-york");
  const footer = page.getByRole("navigation", { name: "Footer states" });
  await expect(page.getByRole("navigation", { name: "Footer navigation", exact: true }).getByRole("navigation", { name: "Footer states" })).toBeVisible();
  await expect(footer.getByRole("link")).toHaveCount(11);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator(".public-footer").screenshot({ path: testInfo.outputPath("footer.png") });
  await footer.getByRole("link", { name: "All states", exact: true }).click();
  await expect(page.locator("#states")).toBeFocused();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(async () => Math.round((await page.locator("#states").boundingBox())!.y)).toBeLessThan(150);
  await footer.getByRole("link", { name: "All states", exact: true }).click();
  await expect(page.locator("#states")).toBeFocused();
  await expect.poll(async () => Math.round((await page.locator("#states").boundingBox())!.y)).toBeLessThan(150);
});

test("Missouri guide remains readable across viewport sizes and motion preferences", async ({ page }, testInfo) => {
  await page.goto("/states/missouri");
  const article = page.getByRole("article");
  await expect(article.getByRole("heading", { level: 1 })).toHaveText("Understand your total-loss offer in Missouri.");
  await expect(page).toHaveTitle("Missouri Total-Loss Guide & Valuation Review | Venfour");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Understand Missouri total-loss valuations, deductions, replacement-vehicle tax allowances, and your options. Start with Venfour’s free preliminary valuation.");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://venfour.com/states/missouri");
  for (const name of ["How is your vehicle’s value determined?", "Missouri rules worth understanding", "What to do if the offer seems low", "How Venfour helps", "Common questions"]) {
    await expect(article.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
  }
  const table = article.getByRole("table");
  await expect(table.getByRole("columnheader")).toHaveCount(2);
  await expect(table.getByRole("row")).toHaveCount(5);
  for (const detail of ["Vehicle details", "Mileage and condition", "Comparable vehicles", "Adjustments"]) {
    await expect(table.getByText(detail, { exact: true })).toBeVisible();
  }
  await expect(article.getByText(/If your policy includes an appraisal clause/)).toBeVisible();
  await expect(article.locator("details:not([open])")).toHaveCount(0);
  await expect(article.locator("blockquote")).toContainText("Could you review this and explain whether it changes the vehicle value?");
  await expect(article.getByRole("link", { name: "Start my free valuation" })).toHaveCount(2);
  await expect(article.locator('a[href="https://dor.mo.gov/faq/motor-vehicle/titling-registration.html#q13"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await table.locator("th, td").evaluateAll(cells => cells.every(cell => {
    const box = cell.getBoundingClientRect();
    return box.left >= 0 && box.right <= window.innerWidth && cell.scrollWidth <= cell.clientWidth;
  }))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("missouri-hero.png") });
  await page.screenshot({ path: testInfo.outputPath("missouri-guide.png"), fullPage: true });
  await table.screenshot({ path: testInfo.outputPath("missouri-checklist.png") });
});

test("Missouri’s CTA supports keyboard access and preserves the current intake entry", async ({ page }) => {
  await page.goto("/states/missouri");
  const article = page.getByRole("article");
  const actions = article.getByRole("link", { name: "Start my free valuation" });
  await expect(actions).toHaveCount(2);
  for (const action of await actions.all()) await expect(action).toHaveAttribute("href", "/start?service=total-loss");
  await article.getByRole("link", { name: "All states", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(actions.first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/start\?service=total-loss$/);
  await expect(page.getByRole("heading", { name: "Start with a free valuation." })).toBeVisible();
  await expect(page.getByText("Vehicle registration state", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Policy issued state", { exact: true })).toHaveCount(0);
  await page.goto("/states/missouri");
  await actions.last().click();
  await expect(page).toHaveURL(/\/start\?service=total-loss$/);
});
