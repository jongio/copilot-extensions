// test/smoke.test.mjs - boots this canvas's runtime over loopback HTTP and
// exercises the Code Tutor actions, the 4-level ladder, the legacy-level
// migration, and the shared concept cache. No SDK, no network.
// Run:  node test/smoke.test.mjs   (or via scripts/run-tests.mjs)

import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, mkdir, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = join(HERE, "..");

const home = await mkdtemp(join(tmpdir(), "code-tutor-smoke-"));
process.env.COPILOT_HOME = home; // isolate durable storage before importing canvas.mjs

// Seed a LEGACY (6-grade) board so we can prove forward-migration on load.
const artifactsDir = join(home, "extensions", "code-tutor", "artifacts");
await mkdir(artifactsDir, { recursive: true });
await writeFile(
  join(artifactsDir, "legacy.json"),
  JSON.stringify({
    domain: "legacy",
    defaultLevel: "undergrad",
    codebase: null,
    findings: [],
    questions: [{ id: "q0", text: "old?", topicId: "t0", level: "doctorate", answer: null }],
    topics: [
      {
        id: "t0",
        title: "Old Topic",
        category: "theory",
        summary: "",
        status: "new",
        level: "graduate",
        explanations: { elementary: "kid words", undergrad: "college words", doctorate: "phd words" },
      },
    ],
  })
);

const { canvasConfig } = await import("../canvas.mjs");
const { createCanvasRuntime } = await import("../canvas-kit/server.mjs");
const fmt = await import("../canvas-kit/format.mjs");
const cacheMod = await import("../cache.mjs");
const runtime = createCanvasRuntime(canvasConfig);

let passed = 0;
async function test(label, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${label}`);
  } catch (e) {
    console.error(`FAIL  ${label}\n      ${e.message}`);
    process.exitCode = 1;
    throw e;
  }
}
const post = (url, actionName, input) =>
  fetch(new URL("/action", url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actionName, input }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
const getState = (url) => fetch(new URL("/state", url)).then((r) => r.json());
const text = (url, path) =>
  fetch(new URL(path, url)).then(async (r) => ({ status: r.status, ct: r.headers.get("content-type") || "", body: await r.text() }));

try {
  const open = await runtime.openInstance({
    instanceId: "smoke",
    input: { domain: "smoke" },
    ctx: { instanceId: "smoke", input: { domain: "smoke" } },
  });

  await test("opens on a loopback url + title", () => {
    assert.match(open.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(open.title, "Code Tutor");
  });

  await test("GET / serves the html shell", async () => {
    const { status, ct, body } = await text(open.url, "/");
    assert.equal(status, 200);
    assert.match(ct, /text\/html/);
    assert.match(body, /id="app"/);
  });

  await test("GET /state starts empty with the 'engineer' default level", async () => {
    const s = await getState(open.url);
    assert.deepEqual(s.topics, []);
    assert.deepEqual(s.findings, []);
    assert.equal(s.codebase, null);
    assert.equal(s.defaultLevel, "engineer");
  });

  await test("AC: kit theme ships the reduced-motion guard", async () => {
    const { status, body } = await text(open.url, "/kit/theme.css");
    assert.equal(status, 200);
    assert.match(body, /prefers-reduced-motion/);
  });

  await test("AC: canvas.mjs uses the kit nid (no hand-rolled copy)", async () => {
    const src = await readFile(join(EXT, "canvas.mjs"), "utf8");
    assert.match(src, /from "\.\/canvas-kit\/format\.mjs"/);
    assert.doesNotMatch(src, /function nid\(/);
  });

  await test("AC: format helpers produce expected strings", () => {
    assert.match(fmt.relativeTime(Date.now() - 5 * 60_000), /^5m ago$/);
    assert.ok(fmt.nid() && fmt.nid() !== fmt.nid());
  });

  await test("cache heuristic: generic text caches, codebase-specific does not", () => {
    assert.equal(cacheMod.looksCodebaseSpecific("Guess the middle, then go left or right."), false);
    assert.equal(cacheMod.looksCodebaseSpecific("See locate() in app.mjs:58 for the scan."), true);
    assert.equal(cacheMod.conceptKeyFor("Binary Search!"), "binary-search");
  });

  await test("set_codebase records the board's title card", async () => {
    const { body } = await post(open.url, "set_codebase", { label: "demo-repo", fileCount: 12, languages: ["JavaScript"] });
    assert.equal(body.ok, true);
    const s = await getState(open.url);
    assert.equal(s.codebase.label, "demo-repo");
    assert.equal(s.codebase.fileCount, 12);
  });

  await test("set_codebase stores a valid owner/repo and ignores an invalid one", async () => {
    // A valid full name is recorded so findings can offer a session deep link.
    await post(open.url, "set_codebase", { repo: "jongio/copilot-extensions" });
    assert.equal((await getState(open.url)).codebase.repo, "jongio/copilot-extensions");
    // A malformed repo must NOT overwrite the good one (lenient fallback), so a
    // bad value never reaches buildSessionDeepLink and yields a dead link.
    await post(open.url, "set_codebase", { repo: "not a repo/../x" });
    assert.equal((await getState(open.url)).codebase.repo, "jongio/copilot-extensions");
  });

  let topicId;
  await test("add_topic caches the generic eli5 level + auto-detects it", async () => {
    const { body } = await post(open.url, "add_topic", {
      title: "Linear search",
      category: "algorithm",
      summary: "Scan items one by one.",
      refs: [{ file: "src/find.js", startLine: 3, endLine: 9 }],
      explanations: {
        eli5: "Look through a box of toys one at a time until you find the one you want.",
        engineer: "Walk the array; worst case touches every element, so it is O(n). See find.js:3.",
      },
    });
    assert.equal(body.ok, true);
    topicId = body.result.id;
    assert.equal(body.result.conceptKey, "linear-search");
    const s = await getState(open.url);
    const t = s.topics[0];
    assert.equal(t.conceptKey, "linear-search");
    assert.equal(t.level, null);
    assert.ok(t.explanations.eli5);
    assert.ok(t.explanations.engineer);
  });

  await test("lookup_explanation finds the cached generic level, not the specific one", async () => {
    const hit = await post(open.url, "lookup_explanation", { title: "Linear search", level: "eli5" });
    assert.equal(hit.body.result.hit, true);
    assert.match(hit.body.result.text, /box of toys/);
    // 'engineer' text cited find.js:3 -> codebase-specific -> NOT cached
    const miss = await post(open.url, "lookup_explanation", { conceptKey: "linear-search", level: "engineer" });
    assert.equal(miss.body.result.hit, false);
  });

  await test("a NEW topic for the same concept auto-fills eli5 from the library (no AI)", async () => {
    const { body } = await post(open.url, "add_topic", { title: "Linear Search", category: "algorithm" });
    assert.equal(body.ok, true);
    assert.deepEqual(body.result.reusedFromCache, ["eli5"]);
    const s = await getState(open.url);
    const t = s.topics.find((x) => x.id === body.result.id);
    assert.match(t.explanations.eli5, /box of toys/);
    assert.ok(t.cachedLevels.includes("eli5"));
  });

  await test("set_explanation with generic text caches; specific text does not", async () => {
    await post(open.url, "set_explanation", { topicId, level: "curious", text: "It just checks each item in turn." });
    await post(open.url, "set_explanation", { topicId, level: "wizard", text: "In this repo, see locate() at canvas.mjs:58." });
    const curious = await post(open.url, "lookup_explanation", { conceptKey: "linear-search", level: "curious" });
    const wizard = await post(open.url, "lookup_explanation", { conceptKey: "linear-search", level: "wizard" });
    assert.equal(curious.body.result.hit, true);
    assert.equal(wizard.body.result.hit, false);
  });

  await test("fill_from_cache hits for a cached level and misses otherwise", async () => {
    const { body } = await post(open.url, "add_topic", { title: "linear-search topic", conceptKey: "linear-search" });
    const id = body.result.id;
    const hit = await post(open.url, "fill_from_cache", { topicId: id, level: "curious" });
    assert.equal(hit.body.result.hit, true);
    const miss = await post(open.url, "fill_from_cache", { topicId: id, level: "wizard" });
    assert.equal(miss.body.result.hit, false);
  });

  await test("list_cache reports the concept library", async () => {
    const { body } = await post(open.url, "list_cache", {});
    assert.ok(body.result.count >= 1);
    assert.match(body.result.summary, /linear-search/);
  });

  await test("set_topic_status persists per topic", async () => {
    await post(open.url, "set_topic_status", { id: topicId, status: "understood" });
    const s = await getState(open.url);
    const t = s.topics.find((x) => x.id === topicId);
    assert.equal(t.status, "understood");
  });

  await test("update_topic patches refs/summary while preserving progress", async () => {
    await post(open.url, "update_topic", {
      id: topicId,
      summary: "Updated summary.",
      refs: [{ file: "src/find.js", startLine: 40, endLine: 55, note: "moved" }],
    });
    const t = (await getState(open.url)).topics.find((x) => x.id === topicId);
    assert.equal(t.summary, "Updated summary.");
    assert.equal(t.refs[0].startLine, 40);
    assert.equal(t.refs[0].endLine, 55);
    assert.equal(t.status, "understood"); // progress preserved
    assert.ok(t.explanations.eli5); // explanations preserved
  });

  await test("set_level sets the single global reading level", async () => {
    await post(open.url, "set_level", { level: "curious" });
    assert.equal((await getState(open.url)).defaultLevel, "curious");
  });

  await test("set_default_level alias still works", async () => {
    await post(open.url, "set_default_level", { level: "wizard" });
    assert.equal((await getState(open.url)).defaultLevel, "wizard");
    await post(open.url, "set_level", { level: "engineer" }); // restore
  });

  await test("add_finding + set_fix_status round-trips a fix request", async () => {
    const add = await post(open.url, "add_finding", {
      quality: "bad",
      title: "O(n^2) dedupe",
      file: "src/u.js",
      startLine: 1,
      fixPrompt: "Use a Set.",
    });
    const id = add.body.result.id;
    const req = await post(open.url, "set_fix_status", { id, status: "requested" });
    assert.equal(req.body.result.fixPrompt, "Use a Set.");
    const picked = await post(open.url, "list_findings", { fixStatus: "requested" });
    assert.equal(picked.body.result.count, 1);
  });

  await test("ask_question + answer_question round-trips", async () => {
    const ask = await post(open.url, "ask_question", { topicId, level: "curious", text: "why O(n)?" });
    const qid = ask.body.result.id;
    await post(open.url, "answer_question", { id: qid, answer: "you may touch every element." });
    const s = await getState(open.url);
    assert.equal(s.questions.find((q) => q.id === qid).answer, "you may touch every element.");
  });

  // ---- request_explanation flow (canvas -> session model bridge) -----------
  await test("request_explanation marks the level pending and returns a prompt", async () => {
    const r = await post(open.url, "request_explanation", { topicId, level: "eli5" });
    assert.equal(r.status, 200);
    assert.equal(r.body.result.topicId, topicId);
    assert.equal(r.body.result.level, "eli5");
    assert.ok(/explain/i.test(r.body.result.prompt), "returns an explain prompt for the host");
    const s = await getState(open.url);
    const t = s.topics.find((x) => x.id === topicId);
    assert.equal(t.explaining?.level, "eli5", "the level is flagged as being explained");
  });

  await test("set_explanation clears the pending explaining marker for that level", async () => {
    await post(open.url, "request_explanation", { topicId, level: "eli5" });
    await post(open.url, "set_explanation", { topicId, level: "eli5", text: "It checks each item one by one." });
    const s = await getState(open.url);
    const t = s.topics.find((x) => x.id === topicId);
    assert.equal(t.explaining, null, "explaining is cleared once the answer lands");
    assert.equal(t.explanations.eli5, "It checks each item one by one.");
  });

  await test("fail_explanation clears pending and records a retryable error", async () => {
    await post(open.url, "request_explanation", { topicId, level: "wizard" });
    await post(open.url, "fail_explanation", { topicId, level: "wizard", message: "no session" });
    const s = await getState(open.url);
    const t = s.topics.find((x) => x.id === topicId);
    assert.equal(t.explaining, null);
    assert.equal(t.explainError?.level, "wizard");
    assert.equal(t.explainError?.message, "no session");
  });

  // ---- read_snippet (expand a code reference) ------------------------------
  await test("read_snippet returns windowed source lines within the codebase root", async () => {
    await post(open.url, "set_codebase", { label: "demo-repo", root: EXT }); // EXT contains canvas.mjs
    const { body } = await post(open.url, "read_snippet", { file: "canvas.mjs", startLine: 1, endLine: 2 });
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.result.lines) && body.result.lines.length > 0);
    assert.equal(body.result.focusStart, 1);
    assert.equal(body.result.fromLine, 1); // start - pad, clamped to 1
    assert.match(body.result.lines.join("\n"), /canvas\.mjs/);
  });

  await test("read_snippet refuses to escape the codebase root", async () => {
    const { body } = await post(open.url, "read_snippet", { file: "../../../../etc/passwd" });
    assert.equal(body.ok, false);
    assert.match(body.message, /outside the codebase root/);
  });

  await test("SEC: read_snippet refuses an ABSOLUTE path outside the root (root set)", async () => {
    // root is EXT here; an absolute path elsewhere must be rejected.
    const outside = process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd";
    const { body } = await post(open.url, "read_snippet", { file: outside });
    assert.equal(body.ok, false);
    assert.match(body.message, /outside the codebase root/);
  });

  await test("SEC: read_snippet refuses an absolute path when NO root is configured", async () => {
    // Regression for the asymmetric-guard arbitrary-file-read: a board with
    // codebase=null (no root) must NOT read a bare absolute path.
    const noRoot = await runtime.openInstance({
      instanceId: "noroot",
      input: { domain: "noroot" },
      ctx: { instanceId: "noroot", input: { domain: "noroot" } },
    });
    const st = await getState(noRoot.url);
    assert.equal(st.codebase, null, "expected no codebase root on a fresh board");
    const outside = process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd";
    const { body } = await post(noRoot.url, "read_snippet", { file: outside });
    assert.equal(body.ok, false);
    assert.match(body.message, /outside the working directory/);
  });

  // ---- analysis freshness + refresh ----------------------------------------
  await test("set_codebase stores a fingerprint; analysis_status reports fresh", async () => {
    const s = await getState(open.url);
    assert.ok(s.codebase.fingerprint, "expected a fingerprint after analyzing a real root");
    const { body } = await post(open.url, "analysis_status", {});
    assert.equal(body.result.configured, true);
    assert.equal(body.result.comparable, true);
    assert.equal(body.result.stale, false); // just analyzed, nothing changed
    assert.equal(body.result.refreshRequested, false);
  });

  await test("request_refresh flags the board; set_codebase clears it", async () => {
    const req = await post(open.url, "request_refresh", {});
    assert.equal(req.body.ok, true);
    assert.match(req.body.result.prompt, /refresh|re-analy/i);
    assert.ok((await getState(open.url)).refreshRequestedAt);
    assert.equal((await post(open.url, "analysis_status", {})).body.result.refreshRequested, true);

    await post(open.url, "set_codebase", { root: EXT }); // a fresh analysis clears the request
    assert.equal((await getState(open.url)).refreshRequestedAt, null);
  });

  await test("no em dashes in author-facing strings", async () => {
    for (const f of ["canvas.mjs", "cache.mjs", "web/app.mjs", "web/styles.css", "web/highlight.mjs"]) {
      const src = await readFile(join(EXT, f), "utf8");
      assert.ok(!src.includes("\u2014"), `${f} should contain no em dashes`);
    }
  });

  await test("update_topic on a missing id throws (surfaced as ok:false)", async () => {
    const { body } = await post(open.url, "update_topic", { id: "does-not-exist", summary: "x" });
    assert.equal(body.ok, false);
    assert.match(body.message, /No topic with id/);
  });

  await test("clear_cache with an out-of-enum level is rejected (does NOT nuke the concept)", async () => {
    const { body } = await post(open.url, "clear_cache", { conceptKey: "linear-search", level: "bogus" });
    assert.equal(body.ok, false);
    // The kit's schema validation rejects the out-of-enum level (its message names
    // the allowed values); the handler's own guard would say the same thing.
    assert.match(body.message, /must be one of/);
    // the concept's cached levels survive the rejected call
    const after = await post(open.url, "lookup_explanation", { conceptKey: "linear-search" });
    assert.ok(after.body.result.cachedLevels.length > 0, "concept must not be deleted by a bad level");
  });

  await test("CONCURRENCY: set_codebase mid-fingerprint does not clobber a concurrent add_topic (H2)", async () => {
    const c = await runtime.openInstance({
      instanceId: "race-h2",
      input: { domain: "race-h2" },
      ctx: { instanceId: "race-h2", input: { domain: "race-h2" } },
    });
    // Fire both without awaiting between them: set_codebase has a long await
    // (computeFingerprint walks the repo); add_topic commits during that window.
    const a = post(c.url, "set_codebase", { label: "racer", root: EXT });
    const b = post(c.url, "add_topic", { title: "Concurrent Topic", category: "theory" });
    await Promise.all([a, b]);
    const s = await getState(c.url);
    assert.equal(s.codebase.label, "racer");
    assert.ok(
      s.topics.some((t) => t.title === "Concurrent Topic"),
      "the concurrently-added topic must survive set_codebase's functional merge"
    );
  });

  await test("CONCURRENCY: concurrent add_topic caches both concepts (M2 shared-cache race)", async () => {
    const c = await runtime.openInstance({
      instanceId: "race-m2",
      input: { domain: "race-m2" },
      ctx: { instanceId: "race-m2", input: { domain: "race-m2" } },
    });
    await Promise.all([
      post(c.url, "add_topic", { title: "Merge Sort", conceptKey: "merge-sort", explanations: { eli5: "Split, sort halves, merge them back." } }),
      post(c.url, "add_topic", { title: "Quick Sort", conceptKey: "quick-sort", explanations: { eli5: "Pick a pivot, put smaller left, bigger right." } }),
    ]);
    const a = await post(c.url, "lookup_explanation", { conceptKey: "merge-sort", level: "eli5" });
    const b = await post(c.url, "lookup_explanation", { conceptKey: "quick-sort", level: "eli5" });
    assert.equal(a.body.result.hit, true, "merge-sort must still be cached");
    assert.equal(b.body.result.hit, true, "quick-sort must still be cached (not clobbered by the other writer)");
  });

  await test("remove_topic detaches findings and drops its questions", async () => {
    const c = await runtime.openInstance({
      instanceId: "rm",
      input: { domain: "rm" },
      ctx: { instanceId: "rm", input: { domain: "rm" } },
    });
    const t = (await post(c.url, "add_topic", { title: "Doomed", category: "theory" })).body.result.id;
    await post(c.url, "add_finding", { quality: "ok", title: "linked", topicId: t });
    await post(c.url, "ask_question", { topicId: t, text: "q?" });
    await post(c.url, "remove_topic", { id: t });
    const s = await getState(c.url);
    assert.ok(!s.topics.some((x) => x.id === t), "topic removed");
    assert.ok(!s.questions.some((q) => q.topicId === t), "its questions removed");
    assert.equal(s.findings[0].topicId, null, "its findings detached, not deleted");
  });

  await test("remove_finding and remove_question delete their items", async () => {
    const c = await runtime.openInstance({
      instanceId: "rm2",
      input: { domain: "rm2" },
      ctx: { instanceId: "rm2", input: { domain: "rm2" } },
    });
    const fid = (await post(c.url, "add_finding", { quality: "bad", title: "kill me" })).body.result.id;
    const qid = (await post(c.url, "ask_question", { text: "kill me too" })).body.result.id;
    assert.equal((await post(c.url, "remove_finding", { id: fid })).body.result.removed, 1);
    assert.equal((await post(c.url, "remove_question", { id: qid })).body.result.removed, 1);
    const s = await getState(c.url);
    assert.equal(s.findings.length, 0);
    assert.equal(s.questions.length, 0);
  });

  await test("reset clears the board but preserves domain and level", async () => {
    const c = await runtime.openInstance({
      instanceId: "rst",
      input: { domain: "rst" },
      ctx: { instanceId: "rst", input: { domain: "rst" } },
    });
    await post(c.url, "set_level", { level: "wizard" });
    await post(c.url, "add_topic", { title: "Temp", category: "theory" });
    await post(c.url, "set_codebase", { label: "temp", root: EXT });
    await post(c.url, "reset", {});
    const s = await getState(c.url);
    assert.deepEqual(s.topics, []);
    assert.deepEqual(s.findings, []);
    assert.deepEqual(s.questions, []);
    assert.equal(s.codebase, null);
    assert.equal(s.domain, "rst", "domain preserved");
    assert.equal(s.defaultLevel, "wizard", "reading level preserved across reset");
  });

  // ---- no-domain open falls back to the most recent NON-EMPTY board -------
  await test("opening with no domain resolves to the most recent non-empty board", async () => {
    const f = join(artifactsDir, "zzz-recent.json");
    await writeFile(
      f,
      JSON.stringify({
        domain: "zzz-recent",
        defaultLevel: "engineer",
        codebase: { label: "Recent Repo" },
        findings: [],
        questions: [],
        topics: [{ id: "rt", title: "Recent Topic", category: "theory", summary: "", status: "new", explanations: {} }],
      })
    );
    // An EMPTY board written even more recently must NOT win (this is the bug a
    // prior no-domain open caused: it leaves an empty default.json as newest).
    const emptyNewer = join(artifactsDir, "default.json");
    await writeFile(emptyNewer, JSON.stringify({ domain: "default", defaultLevel: "engineer", codebase: null, findings: [], questions: [], topics: [] }));
    const recent = new Date(Date.now() + 60000);
    const newer = new Date(Date.now() + 120000);
    await utimes(f, recent, recent);
    await utimes(emptyNewer, newer, newer); // newer, but empty -> skipped

    const anon = await runtime.openInstance({
      instanceId: "anon",
      input: {},
      ctx: { instanceId: "anon", input: {} },
    });
    const s = await getState(anon.url);
    assert.equal(s.domain, "zzz-recent", "no-domain open picks the newest non-empty board, skipping empty default");
    assert.ok(s.topics.some((t) => t.title === "Recent Topic"), "loads that board's topics");
  });

  // ---- legacy migration on a separate, pre-seeded board --------------------
  await test("legacy 6-grade board migrates to the 4-level ladder on open", async () => {
    const legacy = await runtime.openInstance({
      instanceId: "legacy",
      input: { domain: "legacy" },
      ctx: { instanceId: "legacy", input: { domain: "legacy" } },
    });
    const s = await getState(legacy.url);
    assert.equal(s.defaultLevel, "engineer"); // undergrad -> engineer
    const t = s.topics[0];
    assert.equal(t.level, "wizard"); // graduate -> wizard
    assert.equal(t.conceptKey, "old-topic"); // backfilled
    assert.equal(t.explanations.eli5, "kid words"); // elementary -> eli5
    assert.equal(t.explanations.engineer, "college words"); // undergrad -> engineer
    assert.equal(t.explanations.wizard, "phd words"); // doctorate -> wizard
    assert.equal(s.questions[0].level, "wizard"); // doctorate -> wizard
  });

  await test("unknown action returns 400 with a code", async () => {
    const { status, body } = await post(open.url, "nope", {});
    assert.equal(status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.code, "unknown_action");
  });
} finally {
  await runtime.shutdown();
  await rm(home, { recursive: true, force: true });
}

console.log(`\n${passed} checks passed`);
