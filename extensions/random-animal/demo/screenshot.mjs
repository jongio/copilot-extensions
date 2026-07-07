// demo/screenshot.mjs - capture one screenshot per documented Random Animal feature.
//
// It seeds the demo board (demo/seed.mjs) into an isolated COPILOT_HOME under
// this demo folder, boots the canvas runtime over loopback HTTP exactly like the
// smoke test, then drives a headless browser through each feature and writes PNGs
// to docs/img/.
//
// No state data is committed: the board is generated at runtime in a scratch dir
// that is removed on exit. Only the PNGs are written into the repo.
//
// Run:  node demo/screenshot.mjs
// Needs Playwright's chromium. If it isn't installed, the script says how.

import { mkdir, rm, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { seedDemoBoard } from "./seed.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, "..");
const OUT = resolve(EXT, "docs", "img");
const SITE = resolve(EXT, "..", "..", "site", "public", "screenshots");
const GALLERY = resolve(SITE, "random-animal");
const DOMAIN = "demo";

// The feature shots, in the order the site gallery presents them.
const FEATURE_SHOTS = [
  "overview",
  "current-animal",
  "ai-fun-fact",
  "roll-history",
];

// A dark, retina-ish panel sized like a generous side panel so text stays crisp.
const VIEWPORT = { width: 1000, height: 1200 };
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

// Wait for the animal card to paint. We wait on a concrete selector rather than
// "networkidle": the canvas holds an open SSE stream, so the network never goes idle.
async function waitForBoard(page) {
  await page.waitForSelector(".animal-card", { timeout: 15000 });
  await page.waitForSelector(".history-item", { timeout: 15000 });
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
  await loc.waitFor({ timeout: 10000 });
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
    home = resolve(HERE, `.shot-home-${process.pid}-${Date.now()}`);
    await rm(home, { recursive: true, force: true });
    await mkdir(home, { recursive: true });
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
    const page = await ctx.newPage();

    // 1) Overview - the whole seeded board with current animal and history.
    await resetView(page, url);
    shot.push(await shootPage(page, "overview"));

    // 2) Current animal - emoji, name, and bundled fun fact with bounce styling.
    shot.push(await shootEl(page, ".animal-card", "current-animal"));

    // 3) Tell me more - the pre-filled AI fact, captured without a live model call.
    shot.push(await shootEl(page, ".animal-card .ck-card", "ai-fun-fact", { hasText: "AI fun fact" }));

    // 4) Roll history - prior animals and facts.
    shot.push(await shootEl(page, ".history-item", "roll-history", { hasText: "Dolphin" }));

    // Publish the feature shots into the site gallery so the lightbox can show them.
    await mkdir(GALLERY, { recursive: true });
    for (const name of FEATURE_SHOTS) {
      await copyFile(join(OUT, `${name}.png`), join(GALLERY, `${name}.png`));
    }
    shot.push(`${GALLERY}\\*.png (${FEATURE_SHOTS.length} gallery images)`);

    console.log(`Wrote ${shot.length} outputs:`);
    for (const p of shot) console.log(`  ${p}`);
  } finally {
    // Guard each teardown independently so a failing close cannot leak the scratch dir.
    if (browser) await browser.close().catch(() => {});
    if (runtime) await runtime.shutdown().catch(() => {});
    if (home) await rm(home, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error(`screenshot run failed: ${err?.stack ?? err}`);
  process.exit(1);
});
