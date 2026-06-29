// test/smoke.test.mjs — standalone smoke test for the showcase site.
//
// Builds the Astro site, then drives real assertions over the static output the
// way GitHub Pages serves it. Dependency-free (Node + the bundled astro dep), no
// network, no browser. Run: npm test  (from site/), or node test/smoke.test.mjs.
//
// What it guards:
//   base path is /copilot-extensions/ everywhere · all six extensions ship cards
//   · groups render in order with code-tutor first · the lightbox markup + data
//   are present and well-formed · every card has a real screenshot on disk.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, "..");
const DIST = join(SITE, "dist");
const BASE = "/copilot-extensions/";

const EXPECTED = [
  "code-tutor",
  "language-tutor",
  "stock-ticker",
  "news-aggregator",
  "wiki-discover",
  "random-animal",
];
const GROUPS = ["Tutors", "Live &amp; discover", "Just for fun"];

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
    throw e;
  }
}

function build() {
  const res = spawnSync("npm run build", { cwd: SITE, stdio: "inherit", shell: true });
  if (res.status !== 0) throw new Error("astro build failed");
}

function main() {
  build();
  const index = join(DIST, "index.html");
  assert.ok(existsSync(index), "dist/index.html should exist after build");
  const html = readFileSync(index, "utf8");

  test("home page sets the title", () => {
    assert.match(html, /<title>Copilot Extensions by Jon Gallant<\/title>/);
  });

  test("every extension ships a card", () => {
    for (const slug of EXPECTED) {
      assert.match(html, new RegExp(`data-card[^>]*>[\\s\\S]*?${slug}`), `missing card for ${slug}`);
    }
  });

  test("groups render in order", () => {
    const titles = [...html.matchAll(/class="group-title">\s*([^<]+?)\s*</g)].map((m) => m[1]);
    assert.deepEqual(titles, GROUPS);
  });

  test("embedded data lists all six extensions, code-tutor first", () => {
    const m = html.match(/id="ext-data"[^>]*>(.*?)<\/script>/s);
    assert.ok(m, "ext-data JSON block present");
    const data = JSON.parse(m[1]);
    assert.equal(data.length, 6);
    assert.deepEqual(data.map((d) => d.slug), EXPECTED);
    for (const d of data) {
      assert.ok(d.installPrompt.includes(d.slug), "install prompt names its extension");
      assert.ok(d.href.includes(`/extensions/${d.slug}`), "github link points at the folder");
    }
  });

  test("lightbox markup is present and wired", () => {
    for (const id of ["lightbox", "lb-prev", "lb-next", "lb-close", "lb-img", "lb-title", "lb-copy", "lb-count"]) {
      assert.match(html, new RegExp(`id="${id}"`), `lightbox missing #${id}`);
    }
  });

  test("assets and links carry the project base path (not bare /)", () => {
    assert.match(html, new RegExp(`href="${BASE}favicon\\.svg"`));
    assert.match(html, new RegExp(`href="${BASE}"`)); // nav home
    assert.match(html, new RegExp(`href="${BASE}about/"`)); // nav about
    assert.match(html, new RegExp(`${BASE}screenshots/code-tutor\\.png`));
  });

  test("each extension has a real screenshot in the build", () => {
    for (const slug of EXPECTED) {
      assert.ok(existsSync(join(DIST, "screenshots", `${slug}.png`)), `dist/screenshots/${slug}.png missing`);
    }
    assert.ok(existsSync(join(DIST, "screenshots", "placeholder.svg")), "placeholder fallback missing");
  });

  test("topbar ships a theme toggle and GitHub repo link", () => {
    assert.match(html, /id="theme-toggle"/);
    assert.match(html, /href="https:\/\/github\.com\/jongio\/copilot-extensions"/);
  });

  test("about page builds with base-aware nav", () => {
    const about = join(DIST, "about", "index.html");
    assert.ok(existsSync(about), "dist/about/index.html should exist");
    assert.match(readFileSync(about, "utf8"), new RegExp(`href="${BASE}"`));
  });

  console.log(`\n${passed} checks passed`);
}

main();
