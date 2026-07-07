// demo/screenshot.mjs - capture one screenshot per Wiki Discover feature.
//
// It seeds the demo profile into an isolated COPILOT_HOME inside this demo folder,
// boots the canvas runtime over loopback HTTP, then drives a headless browser and
// writes PNGs to docs/img/. The same feature shots are copied into the site
// gallery folder.
//
// Run:  node demo/screenshot.mjs
// Needs Playwright's chromium. If it is not installed, the script says how.

import { mkdtemp, mkdir, rm, copyFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { seedDemoBoard } from "./seed.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, "..");
const OUT = resolve(EXT, "docs", "img");
const GALLERY = resolve(EXT, "..", "..", "site", "public", "screenshots", "wiki-discover");
const DOMAIN = "demo";

const FEATURE_SHOTS = [
  "overview",
  "article-card",
  "ai-tldr",
  "preference-profile",
  "up-next",
  "sentiment-controls",
];

const VIEWPORT = { width: 1000, height: 1320 };
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

async function launchChromium(chromium) {
  try {
    return await chromium.launch();
  } catch (err) {
    console.error(
      "Chromium is not installed for Playwright.\n" +
        "  npx playwright install chromium\n" +
        "then re-run: node demo/screenshot.mjs\n" +
        String(err?.message ?? err),
    );
    process.exit(1);
  }
}

async function waitForBoard(page) {
  await page.waitForSelector(".wd-article .wd-title", { timeout: 15000 });
  await page.waitForSelector(".wd-next-item", { timeout: 15000 });
}

async function resetView(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForBoard(page);
}

async function openTunePanel(page) {
  const bar = page.locator(".wd-tunebar").first();
  if ((await bar.getAttribute("aria-expanded")) !== "true") await bar.click();
  await page.waitForSelector(".wd-tune-body", { timeout: 10000 });
}

async function shootPage(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function shootEl(page, selector, name) {
  const loc = page.locator(selector).first();
  await loc.scrollIntoViewIfNeeded();
  const path = join(OUT, `${name}.png`);
  await loc.screenshot({ path });
  return path;
}

async function sizeOf(path) {
  return (await stat(path)).size;
}

async function main() {
  const chromium = await loadChromium();
  let home = null;
  let runtime = null;
  let browser = null;
  const shot = [];
  try {
    home = await mkdtemp(join(HERE, ".tmp-shots-"));
    process.env.COPILOT_HOME = home;

    await seedDemoBoard({ home, domain: DOMAIN });
    const { canvasConfig } = await import("../canvas.mjs");
    const { createCanvasRuntime } = await import("../canvas-kit/server.mjs");
    runtime = createCanvasRuntime(canvasConfig);
    browser = await launchChromium(chromium);

    const open = await runtime.openInstance({
      instanceId: "shots",
      input: { profile: DOMAIN },
      ctx: { instanceId: "shots", input: { profile: DOMAIN } },
    });
    const url = open.url;
    await mkdir(OUT, { recursive: true });
    await mkdir(GALLERY, { recursive: true });

    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: "dark" });
    const page = await ctx.newPage();

    await resetView(page, url);
    shot.push(await shootPage(page, "overview"));
    shot.push(await shootEl(page, ".wd-article", "article-card"));
    shot.push(await shootEl(page, ".wd-tldr-card", "ai-tldr"));

    await openTunePanel(page);
    shot.push(await shootEl(page, ".wd-tune", "preference-profile"));

    shot.push(await shootEl(page, ".wd-next-list", "up-next"));
    shot.push(await shootEl(page, ".wd-actionbar", "sentiment-controls"));

    for (const name of FEATURE_SHOTS) {
      await copyFile(join(OUT, `${name}.png`), join(GALLERY, `${name}.png`));
    }

    console.log(`Wrote ${shot.length} screenshots:`);
    for (const p of shot) console.log(`  ${p} (${await sizeOf(p)} bytes)`);
    console.log(`Copied gallery screenshots to ${GALLERY}`);
    await ctx.close();
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
