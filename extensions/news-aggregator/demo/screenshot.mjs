// demo/screenshot.mjs - capture one screenshot per documented News Aggregator feature.
//
// It seeds the offline demo feed (demo/seed.mjs) into an isolated COPILOT_HOME
// under this demo folder, boots the canvas runtime over loopback HTTP, then
// drives a headless browser and writes PNGs to docs/img/. The same files are
// copied into site/public/screenshots/news-aggregator/ for the site gallery.
//
// Run:  node demo/screenshot.mjs
// Needs Playwright's chromium. If it is not installed, the script says how.

import { mkdir, rm, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { seedDemoBoard } from "./seed.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, "..");
const OUT = resolve(EXT, "docs", "img");
const SITE = resolve(EXT, "..", "..", "site", "public", "screenshots", "news-aggregator");
const HOME = resolve(HERE, ".shot-home");
const DOMAIN = "demo";

const FEATURE_SHOTS = [
  "overview",
  "topic-feed",
  "saved-items",
  "favorite-items",
  "search-history",
  "pinned-topic",
  "sort-filter",
  "ai-digest",
];

const VIEWPORT = { width: 1000, height: 1360 };
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

async function launchBrowser(chromium) {
  try {
    return await chromium.launch();
  } catch (err) {
    console.error(
      "Playwright chromium could not launch.\n" +
        "Run: npx playwright install chromium\n" +
        `Details: ${err?.message ?? err}`,
    );
    process.exit(1);
  }
}

async function waitForFeed(page) {
  await page.waitForSelector(".na-card", { timeout: 15000 });
  await page.waitForSelector(".na-digest", { timeout: 15000 });
}

async function resetView(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForFeed(page);
}

async function postAction(url, actionName, input) {
  const res = await fetch(new URL("/action", url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actionName, input }),
  });
  if (!res.ok) throw new Error(`Action ${actionName} failed with HTTP ${res.status}`);
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

// Capture the top of the page clipped to the bottom of the last matching element,
// so a sparse view (e.g. a Saved tab with one item) frames its content tightly
// instead of trailing a tall empty page (the app has a viewport-height min-height).
async function shootTop(page, name, bottomSelector, pad = 24) {
  const height = await page.evaluate(
    ({ sel, pad }) => {
      const els = Array.from(document.querySelectorAll(sel));
      if (!els.length) return null;
      const bottom = Math.max(...els.map((e) => e.getBoundingClientRect().bottom));
      return Math.ceil(bottom + pad);
    },
    { sel: bottomSelector, pad },
  );
  const clipH = Math.min(height ?? VIEWPORT.height, VIEWPORT.height);
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, clip: { x: 0, y: 0, width: VIEWPORT.width, height: clipH } });
  return path;
}

async function main() {
  const chromium = await loadChromium();
  let runtime = null;
  let browser = null;
  const shot = [];
  try {
    await rm(HOME, { recursive: true, force: true });
    process.env.COPILOT_HOME = HOME;

    await seedDemoBoard({ home: HOME, domain: DOMAIN });
    const { canvasConfig } = await import("../canvas.mjs");
    const { createCanvasRuntime } = await import("../canvas-kit/server.mjs");
    runtime = createCanvasRuntime(canvasConfig);
    browser = await launchBrowser(chromium);

    const open = await runtime.openInstance({
      instanceId: "shots",
      input: { domain: DOMAIN },
      ctx: { instanceId: "shots", input: { domain: DOMAIN } },
    });
    const url = open.url;
    await mkdir(OUT, { recursive: true });

    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: "dark" });
    const page = await ctx.newPage();
    // The card thumbnail tries a google.com favicon and only falls back to a
    // colored letter tile onError. Offline that request hangs, leaving an empty
    // box, so abort external favicon fetches to trigger the graceful fallback.
    await page.route("**/s2/favicons**", (route) => route.abort());

    await resetView(page, url);
    shot.push(await shootPage(page, "overview"));

    shot.push(await shootEl(page, ".na-list", "topic-feed"));

    await postAction(url, "set_view", { view: "saved" });
    await page.waitForSelector(".na-card", { timeout: 10000 });
    shot.push(await shootTop(page, "saved-items", ".na-card"));

    await postAction(url, "set_view", { view: "favorites" });
    await page.waitForSelector(".na-card", { timeout: 10000 });
    shot.push(await shootTop(page, "favorite-items", ".na-card"));

    await postAction(url, "set_view", { view: "feed" });
    await page.getByRole("tab", { name: "Search" }).click();
    await page.waitForSelector(".na-hist", { timeout: 10000 });
    shot.push(await shootEl(page, ".na-controls", "search-history"));

    await resetView(page, url);
    shot.push(await shootEl(page, ".na-chips", "pinned-topic"));

    await page.getByPlaceholder("Filter visible").fill("orbital");
    await page.locator(".na-toolbar select").selectOption("source");
    await page.waitForSelector(".na-card", { timeout: 10000 });
    shot.push(await shootPage(page, "sort-filter"));

    await resetView(page, url);
    shot.push(await shootEl(page, ".na-digest", "ai-digest"));

    await ctx.close();

    await mkdir(SITE, { recursive: true });
    for (const name of FEATURE_SHOTS) {
      await copyFile(join(OUT, `${name}.png`), join(SITE, `${name}.png`));
    }
    shot.push(`${SITE}\\*.png (${FEATURE_SHOTS.length} gallery images)`);

    console.log(`Wrote ${shot.length} outputs:`);
    for (const p of shot) console.log(`  ${p}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (runtime) await runtime.shutdown().catch(() => {});
    await rm(HOME, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error(`screenshot run failed: ${err?.stack ?? err}`);
  process.exit(1);
});
