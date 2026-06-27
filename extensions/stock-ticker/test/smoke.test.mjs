// test/smoke.test.mjs — standalone smoke harness for the stock-ticker canvas.
//
// Boots the SDK-free kit runtime directly and drives it over real HTTP the way
// the canvas webview would. No SDK, no CLI, no network (the network-bound
// refresh_quotes path is exercised structurally, not over the wire). Run:
//   node extensions/stock-ticker/test/smoke.test.mjs
//
// Modeled on create-canvas-app/test/http.test.mjs. Maps to the kit-sync ACs:
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
  const home = await mkdtemp(join(tmpdir(), "ck-stock-"));
  process.env.COPILOT_HOME = home; // isolate durable storage before importing canvas.mjs

  const { canvasConfig } = await import("../canvas.mjs");
  const { createCanvasRuntime } = await import("../canvas-kit/server.mjs");
  const fmt = await import("../canvas-kit/format.mjs");

  const runtime = createCanvasRuntime(canvasConfig);
  console.log("stock-ticker — standalone smoke tests");

  const open = await runtime.openInstance({ instanceId: "s1", input: {}, ctx: { instanceId: "s1", input: {} } });

  await test("openInstance returns a loopback url + title", () => {
    assert.match(open.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(open.title, "Stock Ticker");
  });

  await test("GET /state returns the watchlist shape", async () => {
    const { status, body } = await get(open.url, "/state");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.symbols));
    assert.ok(body.quotes && typeof body.quotes === "object");
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

  await test("AC: synced theme.css ships the reduced-motion guard", async () => {
    const { status, body } = await text(open.url, "/kit/theme.css");
    assert.equal(status, 200);
    assert.match(body, /prefers-reduced-motion/);
  });

  await test("AC: format helpers produce expected strings", () => {
    assert.equal(fmt.compactNumber(1500), (1500).toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 }));
    assert.equal(fmt.compactNumber(null), "—");
    assert.equal(fmt.percent(1.2345), "+1.23%");
    assert.equal(fmt.percent(-2), "-2.00%");
    assert.equal(fmt.percent(null), "—");
    assert.match(fmt.relativeTime(Date.now() - 5 * 60_000), /^5m ago$/);
    assert.equal(fmt.relativeTime(null, { fallback: "never" }), "never");
    assert.ok(fmt.nid() && fmt.nid() !== fmt.nid());
  });

  await test("AC: the view adopts pollWhileVisible for visibility-gated auto-refresh", async () => {
    const src = await readFile(join(EXT, "web", "app.mjs"), "utf8");
    assert.match(src, /pollWhileVisible/);
    assert.doesNotMatch(src, /setInterval/); // hand-rolled interval removed
  });

  await test("POST /action set_range mutates shared state", async () => {
    const { status, body } = await action(open.url, "set_range", { range: "5d" });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const after = await get(open.url, "/state");
    assert.equal(after.body.range, "5d");
  });

  await test("POST /action add_symbol + remove_symbol roundtrip mutates state", async () => {
    const before = (await get(open.url, "/state")).body.symbols.map((s) => s.symbol);
    const sym = ["NVDA", "TSLA", "AMD", "INTC", "SMOKE1"].find((s) => !before.includes(s)) || "SMOKE1";
    await action(open.url, "add_symbol", { symbol: sym });
    let now = (await get(open.url, "/state")).body.symbols.map((s) => s.symbol);
    assert.ok(now.includes(sym), `expected ${sym} added`);
    await action(open.url, "remove_symbol", { symbol: sym });
    now = (await get(open.url, "/state")).body.symbols.map((s) => s.symbol);
    assert.ok(!now.includes(sym), `expected ${sym} removed`);
  });

  await test("state persists durably under the isolated COPILOT_HOME", async () => {
    const file = join(home, "extensions", "stock-ticker", "artifacts", "default.json");
    const saved = JSON.parse(await readFile(file, "utf8"));
    assert.equal(saved.range, "5d");
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
