// demo/screenshot.mjs - capture one screenshot per documented Stock Ticker feature.
//
// It seeds the in-memory demo watchlist (demo/seed.mjs) into a throwaway
// COPILOT_HOME, boots the canvas runtime over loopback HTTP exactly like the
// smoke test, then drives a headless browser through each feature and writes
// PNGs to docs/img/.
//
// No data is committed: the watchlist is generated at runtime in a temp dir that
// is removed on exit. Only the PNGs are written into the repo.
//
// Run:  node demo/screenshot.mjs
// Needs Playwright's chromium. If it isn't installed, the script says how.

import { mkdtemp, mkdir, rm, copyFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { seedDemoBoard } from "./seed.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, "..");
const OUT = resolve(EXT, "docs", "img");
const GALLERY = resolve(EXT, "..", "..", "site", "public", "screenshots", "stock-ticker");
const DOMAIN = "demo";

const FEATURE_SHOTS = [
  "overview",
  "ticker-tape",
  "watchlist-quotes",
  "custom-aliases",
  "sparkline-range",
  "ai-summary",
  "filters-sorting",
];

const VIEWPORT = { width: 1000, height: 1280 };
const SCALE = 2;

async function loadChromium() {
  try {
    const { chromium } = await import("playwright");
    return chromium;
  } catch {
    console.error(
      "This script needs Playwright's chromium.\n" +
        "  npm i -D playwright && npx playwright install chromium\n" +
        "then re-run: node demo/screenshot.mjs",
    );
    process.exit(1);
  }
}

async function waitForBoard(page) {
  await page.waitForSelector(".st-card", { timeout: 15000 });
  await page.waitForSelector(".st-ai", { timeout: 15000 });
}

async function blockQuoteRefresh(context) {
  await context.route("**/action", async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.continue();
    try {
      const body = JSON.parse(req.postData() || "{}");
      if (body.actionName === "refresh_quotes") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, result: { count: 0, ok: 0, failed: 0, summary: "Demo quotes are preloaded." } }),
        });
      }
    } catch {
      // Let malformed requests reach the runtime so it can surface the error.
    }
    return route.continue();
  });
}

async function resetView(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForBoard(page);
}

async function shootPage(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function shootEl(page, selector, name, { hasText } = {}) {
  const loc = hasText ? page.locator(selector, { hasText }).first() : page.locator(selector).first();
  await loc.scrollIntoViewIfNeeded();
  const path = join(OUT, `${name}.png`);
  await loc.screenshot({ path });
  return path;
}

async function main() {
  const chromium = await loadChromium();
  let home = null;
  let runtime = null;
  let browser = null;
  const shot = [];
  try {
    home = await mkdtemp(join(HERE, ".shots-"));
    process.env.COPILOT_HOME = home;

    await seedDemoBoard({ home, domain: DOMAIN });
    const { canvasConfig } = await import("../canvas.mjs");
    const { createCanvasRuntime } = await import("../canvas-kit/server.mjs");
    runtime = createCanvasRuntime(canvasConfig);
    browser = await chromium.launch();

    const open = await runtime.openInstance({
      instanceId: "shots",
      input: { domain: DOMAIN },
      ctx: { instanceId: "shots", input: { domain: DOMAIN } },
    });
    const url = open.url;
    await mkdir(OUT, { recursive: true });

    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: "dark" });
    await blockQuoteRefresh(ctx);
    const page = await ctx.newPage();

    // 1) Overview - the whole watchlist with live status, controls, summary, and cards.
    await resetView(page, url);
    shot.push(await shootPage(page, "overview"));

    // 2) Ticker tape - compact live quote strip across the top.
    shot.push(await shootEl(page, ".st-tape", "ticker-tape"));

    // 3) Watchlist quotes - seeded price, change, day range, 52-week range, volume, and sparklines.
    shot.push(await shootEl(page, ".st-grid", "watchlist-quotes"));

    // 4) Custom aliases - a card showing a human label while preserving the symbol.
    shot.push(await shootEl(page, ".st-card", "custom-aliases", { hasText: "AI bellwether" }));

    // 5) Sparkline range - controls show the seeded 5d range selected.
    shot.push(await shootEl(page, ".st-sub", "sparkline-range"));

    // 6) AI market summary - prefilled prose, generated timestamp, and refresh control.
    shot.push(await shootEl(page, ".st-ai", "ai-summary"));

    // 7) Filters and sorting - select gainers and percent change to show local UI filtering.
    await page.getByRole("tab", { name: "gainers" }).click();
    await page.getByRole("tab", { name: "% Change" }).click();
    await page.waitForSelector(".st-card", { timeout: 10000 });
    shot.push(await shootPage(page, "filters-sorting"));
    await ctx.close();

    await mkdir(GALLERY, { recursive: true });
    for (const name of FEATURE_SHOTS) {
      await copyFile(join(OUT, `${name}.png`), join(GALLERY, `${name}.png`));
    }

    console.log(`Wrote ${FEATURE_SHOTS.length} feature screenshots:`);
    for (const name of FEATURE_SHOTS) {
      const docsPath = join(OUT, `${name}.png`);
      const sitePath = join(GALLERY, `${name}.png`);
      const docsSize = (await stat(docsPath)).size;
      const siteSize = (await stat(sitePath)).size;
      console.log(`  ${docsPath} (${docsSize} bytes)`);
      console.log(`  ${sitePath} (${siteSize} bytes)`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (runtime) await runtime.shutdown().catch(() => {});
    if (home) await rm(home, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error(`screenshot run failed: ${err?.stack ?? err}`);
  process.exit(1);
});
