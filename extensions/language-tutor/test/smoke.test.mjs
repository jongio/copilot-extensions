// test/smoke.test.mjs — standalone smoke harness for the language-tutor canvas.
//
// Boots the SDK-free kit runtime directly and drives it over real HTTP the way
// the canvas webview would. No SDK, no CLI, no network. Run:
//   node extensions/language-tutor/test/smoke.test.mjs
//
// Modeled on create-canvas-app/test/http.test.mjs. Maps to the kit-sync ACs:
//   /kit/format.mjs resolves · /kit/client.mjs re-exports format helpers
//   · reduced-motion guard present · format helpers work · canvas.mjs uses the
//   kit nid · actions mutate shared state.

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
  const home = await mkdtemp(join(tmpdir(), "ck-lang-"));
  process.env.COPILOT_HOME = home; // isolate durable storage before importing canvas.mjs

  const { canvasConfig } = await import("../canvas.mjs");
  const { createCanvasRuntime } = await import("../canvas-kit/server.mjs");
  const fmt = await import("../canvas-kit/format.mjs");

  const runtime = createCanvasRuntime(canvasConfig);
  console.log("language-tutor — standalone smoke tests");

  const open = await runtime.openInstance({ instanceId: "l1", input: {}, ctx: { instanceId: "l1", input: {} } });

  await test("openInstance returns a loopback url + title", () => {
    assert.match(open.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(open.title, "Language Tutor");
  });

  await test("GET /state returns the learner profile shape", async () => {
    const { status, body } = await get(open.url, "/state");
    assert.equal(status, 200);
    assert.ok(body.profile && typeof body.profile === "object");
    assert.ok(body.courses && typeof body.courses === "object");
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

  await test("AC: synced theme.css ships the reduced-motion guard", async () => {
    const { status, body } = await text(open.url, "/kit/theme.css");
    assert.equal(status, 200);
    assert.match(body, /prefers-reduced-motion/);
  });

  await test("AC: format helpers produce expected strings", () => {
    assert.equal(fmt.compactNumber(1500), (1500).toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 }));
    assert.equal(fmt.percent(-2), "-2.00%");
    assert.match(fmt.relativeTime(Date.now() - 5 * 60_000), /^5m ago$/);
    assert.ok(fmt.nid() && fmt.nid() !== fmt.nid());
  });

  await test("AC: canvas.mjs uses the kit nid (no hand-rolled copy)", async () => {
    const src = await readFile(join(EXT, "canvas.mjs"), "utf8");
    assert.match(src, /from "\.\/canvas-kit\/format\.mjs"/);
    assert.doesNotMatch(src, /function nid\(/);
  });

  await test("POST /action set_name mutates the shared profile", async () => {
    const { status, body } = await action(open.url, "set_name", { name: "Smoke Tester" });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const after = await get(open.url, "/state");
    assert.equal(after.body.profile.name, "Smoke Tester");
  });

  await test("POST /action pick_language generates a course (kit nid path loads)", async () => {
    const { status, body } = await action(open.url, "pick_language", { language: "Spanish" });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const after = await get(open.url, "/state");
    assert.ok(Object.keys(after.body.courses).length >= 1, "expected a course to be generated");
    assert.ok(after.body.activeLanguage, "expected an active language");
  });

  await test("state persists durably under the isolated COPILOT_HOME", async () => {
    const file = join(home, "extensions", "language-tutor", "artifacts", "default.json");
    const saved = JSON.parse(await readFile(file, "utf8"));
    assert.equal(saved.profile.name, "Smoke Tester");
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
