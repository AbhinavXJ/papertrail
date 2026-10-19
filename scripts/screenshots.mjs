// Captures screenshots of the main screens for visual review (run `pnpm build` first).
// Usage: node scripts/screenshots.mjs [outDir]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { startServer } from "./serve.mjs";
import { findChromium } from "./chromium.mjs";

const OUT = process.argv[2] ?? "test-results/screens";
const PORT = 4330;
const BASE = `http://localhost:${PORT}`;
mkdirSync(OUT, { recursive: true });

const server = await startServer(PORT);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const problems = [];

async function shoot(context, name, fn) {
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && problems.push(`${name}: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`${name}: ${e.message}`));
  await fn(page);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
  await page.close();
}

for (const [label, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
]) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: label === "mobile" ? 2 : 1 });
  await shoot(context, `${label}-01-first-run`, async (p) => {
    await p.goto(BASE);
    await p.getByText("Your documents.").waitFor();
  });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && problems.push(`${label}: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`${label}: ${e.message}`));
  await page.goto(BASE);
  await page.getByRole("button", { name: /Explore with sample documents/ }).click();
  await page.getByText("Sample workspace.").waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="doc-row"]').length >= 8, null, { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="queue-item"][data-phase="processing"], [data-testid="queue-item"][data-phase="queued"]'), null, { timeout: 120000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, `${label}-02-library.png`) });
  await page.getByRole("searchbox", { name: "Search documents" }).fill("security deposit");
  await page.locator('[data-testid="search-result"]').first().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${label}-03-search.png`) });
  await page.keyboard.press("Enter");
  await page.getByTestId("doc-title").waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, `${label}-04-document.png`) });
  if (label === "mobile") {
    await page.getByRole("tab", { name: "Details" }).click();
    await page.locator('[data-testid="details-panel"]').waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, `${label}-04b-details.png`) });
  }
  await page.getByRole("tab", { name: /Extracted text/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, `${label}-05-text.png`) });
  await page.goto(`${BASE}/dates/`);
  await page.getByRole("heading", { name: "Important dates" }).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, `${label}-06-dates.png`) });
  await page.goto(`${BASE}/settings/`);
  await page.getByRole("heading", { name: "Settings" }).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, `${label}-07-settings.png`) });
  await page.goto(BASE);
  await page.locator('[data-testid="doc-row"]').first().waitFor();
  await page.getByRole("button", { name: "Grid view" }).click().catch(() => undefined);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, `${label}-08-grid.png`) });
  await page.getByRole("button", { name: "List view" }).click().catch(() => undefined);
  await page.goto(`${BASE}/privacy/`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, `${label}-09-privacy.png`) });
  await context.close();
}

await browser.close();
server.close();
console.log(problems.length ? `Console problems:\n${problems.join("\n")}` : "No console errors.");
console.log(`Screenshots in ${OUT}`);
