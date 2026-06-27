// test/smoke.test.mjs — standalone smoke harness for the news-aggregator canvas.
//
// Boots the SDK-free kit runtime directly and drives it over real HTTP the way
// the canvas webview would. No SDK, no CLI, no network (the network-bound
// set_topic/refresh/search paths are exercised structurally, not over the wire).
// Run:  node extensions/news-aggregator/test/smoke.test.mjs
//
// Modeled on create-canvas-kit/test/http.test.mjs. Maps to the kit-sync ACs:
//   /kit/format.mjs resolves · /kit/client.mjs re-exports format + pollWhileVisible
//   · reduced-motion guard present · format helpers produce expected strings
//   · auto-refresh wired through pollWhileVisible · actions mutate shared state.

import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = join(HERE, "..");

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
    throw e;
  }
}

const get = (url, path) =>
  fetch(new URL(path, url)).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const text = (url, path) =>
  fetch(new URL(path, url)).then(async (r) => ({ status: r.status, ct: r.headers.get("content-type") || "", body: await r.text() }));
const action = (url, actionName, input) =>
  fetch(new URL("/action", url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actionName, input }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

async function main() {
  const home = await mkdtemp(join(tmpdir(), "ck-news-"));
  process.env.COPILOT_HOME = home; // isolate durable storage before importing canvas.mjs

  const { canvasConfig } = await import("../canvas.mjs");
  const { createCanvasRuntime } = await import("../canvas-kit/server.mjs");
  const fmt = await import("../canvas-kit/format.mjs");

  const runtime = createCanvasRuntime(canvasConfig);
  console.log("news-aggregator — standalone smoke tests");

  const open = await runtime.openInstance({ instanceId: "n1", input: {}, ctx: { instanceId: "n1", input: {} } });

  await test("openInstance returns a loopback url + title", () => {
    assert.match(open.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(open.title, "News Aggregator");
  });

  await test("GET /state returns the feed shape", async () => {
    const { status, body } = await get(open.url, "/state");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.articles));
    assert.ok(body.marks && typeof body.marks === "object");
  });

  await test("GET / serves the canvas html shell", async () => {
    const { status, ct, body } = await text(open.url, "/");
    assert.equal(status, 200);
    assert.match(ct, /text\/html/);
    assert.match(body, /id="app"/);
  });

  await test("AC: /kit/format.mjs import resolves and exports the helpers", async () => {
    const { status, ct, body } = await text(open.url, "/kit/format.mjs");
    assert.equal(status, 200);
    assert.match(ct, /javascript/);
    for (const fn of ["nid", "relativeTime", "compactNumber", "percent"]) {
      assert.match(body, new RegExp(`export function ${fn}\\b`), `format.mjs missing ${fn}`);
    }
  });

  await test("AC: /kit/client.mjs imports cleanly and re-exports format + pollWhileVisible", async () => {
    const { status, body } = await text(open.url, "/kit/client.mjs");
    assert.equal(status, 200);
    assert.match(body, /mountCanvas/);
    assert.match(body, /export function pollWhileVisible/);
    assert.match(body, /from "\.\/format\.mjs"/);
  });

  await test("AC: synced theme.css ships the reduced-motion guard + ck-spinner/ck-error", async () => {
    const { status, body } = await text(open.url, "/kit/theme.css");
    assert.equal(status, 200);
    assert.match(body, /prefers-reduced-motion/);
    assert.match(body, /\.ck-spinner/);
    assert.match(body, /\.ck-error/);
  });

  await test("AC: format helpers produce expected strings", () => {
    assert.equal(fmt.compactNumber(1500), (1500).toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 }));
    assert.equal(fmt.percent(1.2345), "+1.23%");
    assert.match(fmt.relativeTime(Date.now() - 5 * 60_000), /^5m ago$/);
    assert.equal(fmt.relativeTime(null), "");
    assert.ok(fmt.nid() && fmt.nid() !== fmt.nid());
  });

  await test("AC: the view adopts pollWhileVisible + relativeTime; bespoke spinner/error gone", async () => {
    const src = await readFile(join(EXT, "web", "app.mjs"), "utf8");
    assert.match(src, /pollWhileVisible/);
    assert.match(src, /relativeTime/);
    assert.doesNotMatch(src, /setInterval/);
    assert.doesNotMatch(src, /na-spin/);
    assert.doesNotMatch(src, /na-error/);
    const htmlShell = await readFile(join(EXT, "web", "index.html"), "utf8");
    assert.doesNotMatch(htmlShell, /na-spin/);
    assert.doesNotMatch(htmlShell, /na-error/);
  });

  await test("POST /action set_auto_refresh mutates shared state", async () => {
    const { status, body } = await action(open.url, "set_auto_refresh", { seconds: 60 });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const after = await get(open.url, "/state");
    assert.equal(after.body.autoRefreshSec, 60);
  });

  await test("POST /action set_view mutates shared state", async () => {
    await action(open.url, "set_view", { view: "saved" });
    const after = await get(open.url, "/state");
    assert.equal(after.body.view, "saved");
  });

  await test("state persists durably under the isolated COPILOT_HOME", async () => {
    const file = join(home, "extensions", "news-aggregator", "artifacts", "default.json");
    const saved = JSON.parse(await readFile(file, "utf8"));
    assert.equal(saved.autoRefreshSec, 60);
  });

  await test("unknown action returns 400 with a code", async () => {
    const { status, body } = await action(open.url, "nope", {});
    assert.equal(status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.code, "unknown_action");
  });

  await runtime.shutdown();
  await rm(home, { recursive: true, force: true });
  console.log(`\n${passed} checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
