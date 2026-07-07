// demo/screenshot.mjs - capture one screenshot per documented Code Tutor feature.
//
// It seeds the in-memory demo board (demo/seed.mjs) into a throwaway COPILOT_HOME,
// boots the canvas runtime over loopback HTTP exactly like the smoke test, then
// drives a headless browser through each feature and writes PNGs to docs/img/.
// The marketing-site hero (site/public/screenshots/code-tutor.png) is refreshed too.
//
// No data is committed: the board is generated at runtime in a temp dir that is
// removed on exit. Only the PNGs are written into the repo.
//
// Run:  node demo/screenshot.mjs
// Needs Playwright's chromium. If it isn't installed, the script says how.

import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { seedDemoBoard } from "./seed.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, ".."); // extensions/code-tutor
const OUT = resolve(EXT, "docs", "img"); // per-feature screenshots embedded in the README
const SITE = resolve(EXT, "..", "..", "site", "public", "screenshots"); // marketing site assets
const HERO = resolve(SITE, "code-tutor.png"); // site card image
const GALLERY = resolve(SITE, "code-tutor"); // per-feature gallery shown in the site lightbox
const DOMAIN = "demo";

// The feature shots, in the order the README and the site gallery present them.
// Kept here so the copy-to-site step and any future consumer share one list.
const FEATURE_SHOTS = [
  "overview",
  "reading-levels",
  "concept-cache",
  "categories",
  "code-reference",
  "mark-understanding",
  "ask-clarify",
  "code-review",
  "freshness",
];

// A dark, retina-ish panel sized like a generous side panel so text stays crisp.
const VIEWPORT = { width: 1000, height: 1360 };
const HERO_VIEWPORT = { width: 1280, height: 720 };
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

// Wait for the curriculum to paint (state fetched + first topic rendered). We wait
// on a concrete selector rather than "networkidle": the canvas holds an open SSE
// stream (client.mjs), so the network never goes idle.
async function waitForBoard(page) {
  await page.waitForSelector(".cs-topic", { timeout: 15000 });
}

// Expand a topic by its visible title and wait for its body to render.
async function expandTopic(page, title) {
  const head = page.locator(".cs-topic-head", { hasText: title }).first();
  await head.scrollIntoViewIfNeeded();
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  await page.locator(".cs-topic", { hasText: title }).locator(".cs-topic-body").first().waitFor();
}

// Collapse everything (client-only expand state) by reloading the page.
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
    home = await mkdtemp(join(tmpdir(), "code-tutor-shots-"));
    process.env.COPILOT_HOME = home; // isolate durable storage before importing canvas.mjs

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

    // 1) Overview - the whole Learn board (header, level slider, topic list).
    await resetView(page, url);
    shot.push(await shootPage(page, "overview"));

    // 2) Reading-level slider.
    shot.push(await shootEl(page, ".cs-level", "reading-levels"));

    // 3) Category filing + progress filters toolbar.
    shot.push(await shootEl(page, ".cs-toolbar", "categories"));

    // 4) Points at real code - expand a topic and its code reference.
    await expandTopic(page, "Windowed range slicing");
    const ref = page.locator(".cs-ref").first();
    const refHead = ref.locator(".cs-ref-head");
    if ((await refHead.getAttribute("aria-expanded")) !== "true") await refHead.click();
    await ref.locator(".cs-code").waitFor({ timeout: 10000 });
    shot.push(await shootEl(page, ".cs-ref", "code-reference"));

    // 5) Mark your understanding - the per-topic status row.
    shot.push(await shootEl(page, ".cs-status-row", "mark-understanding"));

    // 6) Ask & clarify - a topic's Q&A with an answered and a pending question.
    // The pattern topic also has a cached "curious" explanation, so it doubles as
    // the concept-library-cache shot (the "reused from the concept library" badge).
    await resetView(page, url);
    await expandTopic(page, "Publish/subscribe over Server-Sent Events");
    const cacheBlock = page.locator(".cs-from-cache").first().locator("xpath=..");
    await cacheBlock.scrollIntoViewIfNeeded();
    const ccPath = join(OUT, "concept-cache.png");
    await cacheBlock.screenshot({ path: ccPath });
    shot.push(ccPath);
    shot.push(await shootEl(page, ".cs-qa", "ask-clarify"));

    // 7) Code review - the findings tab with good/ok/bad and Fix-in-a-new-session.
    await resetView(page, url);
    await page.getByRole("tab", { name: "Code review" }).click();
    await page.waitForSelector(".cs-finding-title", { timeout: 10000 });
    shot.push(await shootPage(page, "code-review"));

    // Hero - a 16:9 top-of-panel shot for the marketing site card. Captured BEFORE
    // the freshness step so the board is still in its clean, unmutated state.
    const heroCtx = await browser.newContext({ viewport: HERO_VIEWPORT, deviceScaleFactor: SCALE, colorScheme: "dark" });
    const heroPage = await heroCtx.newPage();
    await heroPage.goto(url, { waitUntil: "domcontentloaded" });
    await waitForBoard(heroPage);
    await mkdir(dirname(HERO), { recursive: true });
    await heroPage.screenshot({ path: HERO });
    shot.push(HERO);
    await heroCtx.close();

    // 8) Freshness tracking - trigger the refresh banner, then capture it. LAST,
    // because request_refresh mutates the board (sets refreshRequestedAt).
    await resetView(page, url);
    await fetch(new URL("/action", url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionName: "request_refresh", input: {} }),
    });
    await page.waitForSelector(".cs-fresh", { timeout: 10000 });
    shot.push(await shootEl(page, ".cs-fresh", "freshness"));
    await ctx.close();

    // Publish the feature shots into the site gallery so the lightbox can show
    // them. The README reads them from docs/img/; the site reads its own copy
    // from public/screenshots/code-tutor/ (Astro only serves from public/).
    await mkdir(GALLERY, { recursive: true });
    for (const name of FEATURE_SHOTS) {
      await copyFile(join(OUT, `${name}.png`), join(GALLERY, `${name}.png`));
    }
    shot.push(`${GALLERY}\\*.png (${FEATURE_SHOTS.length} gallery images)`);

    console.log(`Wrote ${shot.length} outputs:`);
    for (const p of shot) console.log(`  ${p}`);
  } finally {
    // Guard each teardown independently so a failing close can't leak the temp dir.
    if (browser) await browser.close().catch(() => {});
    if (runtime) await runtime.shutdown().catch(() => {});
    if (home) await rm(home, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error(`screenshot run failed: ${err?.stack ?? err}`);
  process.exit(1);
});
