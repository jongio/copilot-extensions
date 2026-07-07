// demo/screenshot.mjs - capture one screenshot per documented Language Tutor
// feature.
//
// It seeds a demo learner profile into an isolated COPILOT_HOME under this demo
// folder, boots the canvas runtime over loopback HTTP, then drives a headless
// browser and writes PNGs to docs/img/. The same PNGs are copied to the site
// gallery. No durable JSON state is committed.
//
// Run: node demo/screenshot.mjs
// Needs Playwright's chromium. If it is missing, the script says how.

import { mkdtemp, mkdir, rm, copyFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { seedDemoBoard } from "./seed.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, "..");
const OUT = resolve(EXT, "docs", "img");
const GALLERY = resolve(EXT, "..", "..", "site", "public", "screenshots", "language-tutor");
const DOMAIN = "demo";
const TEMP_ROOT = resolve(HERE, ".tmp-shots");

const FEATURE_SHOTS = [
  "course-overview",
  "learner-profile",
  "lesson-path",
  "flashcard-example",
  "quiz",
  "completed-lesson",
];

const VIEWPORT = { width: 1000, height: 1360 };
const SCALE = 2;
const MIN_BYTES = 3 * 1024;

async function loadChromium() {
  try {
    const { chromium } = await import("playwright");
    return chromium;
  } catch {
    chromiumHint();
    process.exit(1);
  }
}

function chromiumHint() {
  console.error(
    "This script needs Playwright's chromium.\n" +
      "  npm i -D playwright && npx playwright install chromium\n" +
      "then re-run: node demo/screenshot.mjs",
  );
}

async function launchBrowser(chromium) {
  try {
    return await chromium.launch();
  } catch (err) {
    if (/Executable doesn't exist|browserType.launch|playwright install/i.test(String(err?.message ?? err))) {
      chromiumHint();
      process.exit(1);
    }
    throw err;
  }
}

async function waitForCourse(page) {
  await page.waitForSelector(".lt-banner", { timeout: 15000 });
  await page.waitForSelector(".lt-node", { timeout: 15000 });
}

async function resetView(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForCourse(page);
  await page.waitForTimeout(250);
}

async function shootPage(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await assertShot(path);
  return path;
}

async function shootEl(page, selector, name, { hasText } = {}) {
  const loc = hasText ? page.locator(selector, { hasText }).first() : page.locator(selector).first();
  await loc.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const path = join(OUT, `${name}.png`);
  await loc.screenshot({ path });
  await assertShot(path);
  return path;
}

async function assertShot(path) {
  const s = await stat(path);
  if (s.size < MIN_BYTES) throw new Error(`screenshot looks blank: ${path} (${s.size} bytes)`);
}

async function main() {
  const chromium = await loadChromium();
  let home = null;
  let runtime = null;
  let browser = null;
  const shot = [];
  try {
    await mkdir(TEMP_ROOT, { recursive: true });
    home = await mkdtemp(join(TEMP_ROOT, "run-"));
    process.env.COPILOT_HOME = home;

    await seedDemoBoard({ home, domain: DOMAIN });
    const { canvasConfig } = await import("../canvas.mjs");
    const { createCanvasRuntime } = await import("../canvas-kit/server.mjs");
    runtime = createCanvasRuntime(canvasConfig);
    browser = await launchBrowser(chromium);

    const open = await runtime.openInstance({
      instanceId: "language-shots",
      input: { profile: DOMAIN },
      ctx: { instanceId: "language-shots", input: { profile: DOMAIN } },
    });
    const url = open.url;
    await mkdir(OUT, { recursive: true });

    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: "dark" });
    const page = await ctx.newPage();

    await resetView(page, url);
    shot.push(await shootPage(page, "course-overview"));
    shot.push(await shootEl(page, ".lt-hud", "learner-profile"));
    shot.push(await shootEl(page, ".lt-unit", "lesson-path"));

    const doneLesson = page.locator(".lt-node.lt-done", { hasText: "Greetings" }).first();
    await doneLesson.scrollIntoViewIfNeeded();
    const completedPath = join(OUT, "completed-lesson.png");
    await doneLesson.screenshot({ path: completedPath });
    await assertShot(completedPath);
    shot.push(completedPath);

    await page.locator(".lt-node", { hasText: "Courtesy" }).first().click();
    await page.waitForSelector(".lt-flash", { timeout: 10000 });
    await page.waitForSelector(".lt-example-card", { timeout: 10000 });
    await page.waitForTimeout(300);
    shot.push(await shootPage(page, "flashcard-example"));

    await page.getByRole("button", { name: /Take the quiz/i }).click();
    await page.waitForSelector(".lt-quiz-prompt", { timeout: 10000 });
    await page.waitForSelector(".lt-options", { timeout: 10000 });
    await page.waitForTimeout(300);
    shot.push(await shootPage(page, "quiz"));

    await ctx.close();

    await mkdir(GALLERY, { recursive: true });
    for (const name of FEATURE_SHOTS) {
      await copyFile(join(OUT, `${name}.png`), join(GALLERY, `${name}.png`));
    }

    console.log(`Wrote ${FEATURE_SHOTS.length} feature screenshots:`);
    for (const name of FEATURE_SHOTS) {
      const docsPath = join(OUT, `${name}.png`);
      const sitePath = join(GALLERY, `${name}.png`);
      const s = await stat(docsPath);
      console.log(`  ${docsPath} (${s.size} bytes)`);
      console.log(`  ${sitePath}`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (runtime) await runtime.shutdown().catch(() => {});
    if (home) await rm(home, { recursive: true, force: true }).catch(() => {});
    await rm(TEMP_ROOT, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error(`screenshot run failed: ${err?.stack ?? err}`);
  process.exit(1);
});
