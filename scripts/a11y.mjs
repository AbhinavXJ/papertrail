// Accessibility audit with axe-core (WCAG 2.1 A/AA) across the main screens, light and dark.
// Run after `pnpm build`: `pnpm a11y`. Fails on serious or critical violations.
import { createRequire } from "node:module";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { startServer } from "./serve.mjs";
import { findChromium } from "./chromium.mjs";

const require = createRequire(import.meta.url);
const AXE = require.resolve("axe-core/axe.min.js");
const PORT = 4380;
const BASE = `http://localhost:${PORT}`;
const server = await startServer(PORT);
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const found = new Map();

async function audit(page, screen) {
  await page.waitForTimeout(350); // let open/rise animations finish (they animate opacity)
  await page.addScriptTag({ path: AXE });
  const res = await page.evaluate(() =>
    window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] }),
  );
  for (const v of res.violations) {
    const key = `${v.id}`;
    const entry = found.get(key) ?? { impact: v.impact, help: v.help, screens: new Set(), nodes: [] };
    entry.screens.add(screen);
    for (const n of v.nodes.slice(0, 4)) entry.nodes.push(`${screen}: ${n.target.join(" ")} — ${n.failureSummary?.split("\n")[1]?.trim() ?? ""}`);
    found.set(key, entry);
  }
}

for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1360, height: 900 } });
  const p = await ctx.newPage();
  const s = (n) => `${scheme}/${n}`;
  await p.goto(BASE);
  await p.getByRole("button", { name: /Explore with sample documents/ }).waitFor();
  await audit(p, s("first-run"));
  await p.goto(`${BASE}/privacy/`);
  await audit(p, s("privacy"));
  await p.goto(BASE);
  await p.getByRole("button", { name: /Explore with sample documents/ }).click();
  await p.waitForFunction(() => document.querySelectorAll('[data-testid="doc-row"]').length >= 8, null, { timeout: 30000 });
  await p.waitForFunction(() => !document.querySelector('[data-testid="queue-item"]'), null, { timeout: 120000 });
  await audit(p, s("library-list"));
  await p.getByRole("button", { name: "Category", exact: false }).first().click();
  await audit(p, s("filter-popover"));
  await p.keyboard.press("Escape");
  await p.getByRole("button", { name: "Grid view" }).click();
  await p.waitForTimeout(500);
  await audit(p, s("library-grid"));
  await p.getByRole("button", { name: "List view" }).click();
  await p.getByRole("searchbox", { name: "Search documents" }).fill("warranty");
  await p.locator('[data-testid="search-result"]').first().waitFor();
  await audit(p, s("search-results"));
  await p.keyboard.press("Enter");
  await p.getByTestId("doc-title").waitFor();
  await p.locator('.pdf-page[data-rendered="true"]').first().waitFor({ timeout: 15000 });
  await audit(p, s("document-pdf"));
  await p.getByRole("tab", { name: /Extracted text/ }).click();
  await audit(p, s("document-text"));
  await p.getByRole("button", { name: "Delete" }).click();
  await p.getByRole("dialog").waitFor();
  await audit(p, s("delete-dialog"));
  await p.keyboard.press("Escape");
  await p.goto(`${BASE}/dates/`);
  await p.getByRole("heading", { name: "Important dates" }).waitFor();
  await audit(p, s("dates-upcoming"));
  await p.getByRole("tab", { name: "Timeline" }).click();
  await audit(p, s("dates-timeline"));
  await p.goto(`${BASE}/settings/`);
  await p.getByRole("heading", { name: "Settings" }).waitFor();
  await audit(p, s("settings"));
  await ctx.close();
}

// Password-protected PDF screens (viewer prompt + details form).
{
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE);
  const pick = p.waitForEvent("filechooser");
  await p.getByRole("button", { name: "Choose files", exact: true }).click();
  await (await pick).setFiles(join(process.cwd(), "src/test/fixtures/encrypted-aes-128.pdf"));
  await p.locator('[data-testid="doc-row"] a').first().click({ timeout: 20000 });
  await p.getByTestId("viewer-password").waitFor({ timeout: 20000 });
  await p.getByTestId("pdf-password").waitFor({ timeout: 20000 });
  await audit(p, "light/document-password");
  await ctx.close();
}

await browser.close();
server.close();

const serious = [...found.entries()].filter(([, v]) => v.impact === "serious" || v.impact === "critical");
for (const [id, v] of found) {
  console.log(`\n[${v.impact}] ${id}: ${v.help}\n  screens: ${[...v.screens].join(", ")}`);
  for (const n of v.nodes.slice(0, 6)) console.log(`   - ${n}`);
}
console.log(`\n${found.size} rule(s) violated, ${serious.length} serious/critical.`);
process.exit(serious.length ? 1 : 0);
