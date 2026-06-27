// test/smoke.test.mjs — standalone smoke harness for the random-animal canvas.
//
// Boots the SDK-free kit runtime directly and drives it over real HTTP the way
// the canvas webview would. No SDK, no CLI, no network. Run:
//   node extensions/random-animal/test/smoke.test.mjs
//
// Modeled on create-canvas-kit/test/http.test.mjs. Maps to the kit-sync ACs:
//   /kit/format.mjs resolves · /kit/client.mjs re-exports format helpers
//   · reduced-motion guard now present (was missing) · format helpers work
//   · canvas.mjs uses the kit nid · roll mutates shared state.

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
  const home = await mkdtemp(join(tmpdir(), "ck-animal-"));
  process.env.COPILOT_HOME = home; // isolate durable storage before importing canvas.mjs

  const { canvasConfig } = await import("../canvas.mjs");
  const { createCanvasRuntime } = await import("../canvas-kit/server.mjs");
  const fmt = await import("../canvas-kit/format.mjs");

  const runtime = createCanvasRuntime(canvasConfig);
  console.log("random-animal — standalone smoke tests");

  const open = await runtime.openInstance({ instanceId: "a1", input: {}, ctx: { instanceId: "a1", input: {} } });

  await test("openInstance returns a loopback url + title", () => {
    assert.match(open.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(open.title, "Random Animal");
  });

  await test("GET /state starts with no current animal", async () => {
    const { status, body } = await get(open.url, "/state");
    assert.equal(status, 200);
    assert.equal(body.current, null);
    assert.deepEqual(body.history, []);
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

  await test("AC: /kit/client.mjs imports cleanly and re-exports format helpers", async () => {
    const { status, body } = await text(open.url, "/kit/client.mjs");
    assert.equal(status, 200);
    assert.match(body, /mountCanvas/);
    assert.match(body, /from "\.\/format\.mjs"/);
  });

  await test("AC: synced theme.css adds the reduced-motion guard (was missing here)", async () => {
    const { status, body } = await text(open.url, "/kit/theme.css");
    assert.equal(status, 200);
    assert.match(body, /prefers-reduced-motion/);
  });

  await test("AC: format helpers produce expected strings", () => {
    assert.match(fmt.relativeTime(Date.now() - 5 * 60_000), /^5m ago$/);
    assert.equal(fmt.relativeTime(null), "");
    assert.ok(fmt.nid() && fmt.nid() !== fmt.nid());
  });

  await test("AC: canvas.mjs uses the kit nid (no hand-rolled copy)", async () => {
    const src = await readFile(join(EXT, "canvas.mjs"), "utf8");
    assert.match(src, /from "\.\/canvas-kit\/format\.mjs"/);
    assert.doesNotMatch(src, /function nid\(/);
    const view = await readFile(join(EXT, "web", "app.mjs"), "utf8");
    assert.match(view, /relativeTime/); // history renders "rolled X ago"
  });

  await test("POST /action roll mutates shared state with a kit-nid id + rolledAt", async () => {
    const { status, body } = await action(open.url, "roll", {});
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const after = await get(open.url, "/state");
    assert.ok(after.body.current, "expected a current animal after roll");
    assert.ok(after.body.current.id, "expected a generated id");
    assert.match(after.body.current.rolledAt, /^\d{4}-\d{2}-\d{2}T/); // ISO timestamp for relativeTime
    // relativeTime should render the captured rolledAt as a fresh "ago" string
    assert.match(fmt.relativeTime(after.body.current.rolledAt), /just now|m ago|h ago/);
  });

  await test("second roll pushes the prior animal into history", async () => {
    await action(open.url, "roll", {});
    const after = await get(open.url, "/state");
    assert.ok(after.body.history.length >= 1, "expected history to grow");
    assert.ok(after.body.history[0].id, "history entries carry an id");
  });

  await test("POST /action clear_history empties history", async () => {
    await action(open.url, "clear_history", {});
    const after = await get(open.url, "/state");
    assert.deepEqual(after.body.history, []);
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
