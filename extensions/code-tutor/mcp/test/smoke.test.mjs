// mcp/test/smoke.test.mjs - boots mcp/server.mjs as a child process and speaks MCP
// over stdio, exercising the full adapter: initialize, tools/list (every canvas
// action becomes a tool), tools/call (real handlers mutate real state), the
// sampling round-trip (request_explanation -> host asks OUR model -> answer is
// written back via set_explanation), and the MCP App UI resource. No SDK, no
// network, no deps.
// Run:  node mcp/test/smoke.test.mjs

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_DIR = join(HERE, "..");
const EXT = join(MCP_DIR, "..");
const SERVER = join(MCP_DIR, "server.mjs");
const CANNED = "Binary search is like finding a name in a phone book by always opening to the middle and throwing away the half that cannot contain it.";

const home = await mkdtemp(join(tmpdir(), "code-tutor-mcp-"));

let passed = 0;
async function test(label, fn) {
  try { await fn(); passed++; console.log(`  ok  ${label}`); }
  catch (e) { console.error(`FAIL  ${label}\n      ${e.message}`); process.exitCode = 1; throw e; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- minimal MCP stdio client ---------------------------------------------
const child = spawn(process.execPath, [SERVER], {
  env: { ...process.env, COPILOT_HOME: home, CODE_TUTOR_MCP_DOMAIN: "mcp" },
  stdio: ["pipe", "pipe", "pipe"],
});
child.stderr.setEncoding("utf8");
if (process.env.DEBUG) child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

let nextId = 1;
const waiting = new Map(); // id -> { resolve, reject }
let sampleCount = 0;

const writeMsg = (m) => child.stdin.write(JSON.stringify(m) + "\n");
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    writeMsg({ jsonrpc: "2.0", id, method, params });
  });
}
const notify = (method, params) => writeMsg({ jsonrpc: "2.0", method, params });

let outBuf = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  outBuf += chunk;
  let nl;
  while ((nl = outBuf.indexOf("\n")) >= 0) {
    const line = outBuf.slice(0, nl).trim();
    outBuf = outBuf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    // The server asks US (the host) to run its model. Act as the model.
    if (msg.method === "sampling/createMessage") {
      sampleCount++;
      writeMsg({
        jsonrpc: "2.0",
        id: msg.id,
        result: { role: "assistant", content: { type: "text", text: CANNED }, model: "poc-model", stopReason: "endTurn" },
      });
      continue;
    }
    const w = msg.id !== undefined ? waiting.get(msg.id) : null;
    if (w) { waiting.delete(msg.id); msg.error ? w.reject(new Error(msg.error.message)) : w.resolve(msg.result); }
  }
});

const callTool = async (name, args) => rpc("tools/call", { name, arguments: args });
async function readState() {
  const r = await rpc("resources/read", { uri: "state://code-tutor/board" });
  return JSON.parse(r.contents[0].text);
}

// Fail fast if anything hangs.
const guard = setTimeout(() => { console.error("FAIL  timed out"); try { child.kill(); } catch {} process.exit(1); }, 20000);

try {
  await test("initialize returns serverInfo + capabilities", async () => {
    const r = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: { sampling: {} }, // we are a sampling-capable host
      clientInfo: { name: "smoke", version: "0" },
    });
    assert.equal(r.serverInfo.name, "code-tutor");
    assert.ok(r.protocolVersion, "protocolVersion present");
    assert.ok(r.capabilities.tools && r.capabilities.resources, "declares tools + resources");
    notify("notifications/initialized", {});
  });

  let tools;
  await test("tools/list exposes every canvas action as a tool", async () => {
    const r = await rpc("tools/list", {});
    tools = r.tools;
    const names = new Set(tools.map((t) => t.name));
    for (const n of ["set_codebase", "add_topic", "set_level", "request_explanation", "ask_question", "list_topics", "read_snippet"]) {
      assert.ok(names.has(n), `missing tool ${n}`);
    }
    assert.ok(tools.length >= 20, `expected many tools, got ${tools.length}`);
    assert.ok(tools.every((t) => t.description && t.inputSchema), "each tool has description + inputSchema");
    assert.ok(
      tools.every((t) => t._meta?.ui?.resourceUri === "ui://code-tutor/board"),
      "each tool advertises _meta.ui.resourceUri for MCP Apps discovery"
    );
  });

  await test("tools/call set_codebase records the board title card", async () => {
    const r = await callTool("set_codebase", { label: "Demo Repo", root: EXT, summary: "A demo codebase." });
    assert.ok(!r.isError, "not an error");
    assert.match(r.structuredContent.status, /Demo Repo/);
  });

  let topicId;
  await test("tools/call add_topic creates a real topic in real state", async () => {
    const r = await callTool("add_topic", {
      title: "Binary search",
      category: "algorithm",
      summary: "Halve the search space each step.",
      refs: [{ file: "canvas.mjs", startLine: 1, endLine: 5 }],
    });
    assert.ok(!r.isError, "not an error");
    const state = await readState();
    assert.equal(state.topics.length, 1);
    assert.equal(state.topics[0].title, "Binary search");
    topicId = state.topics[0].id;
    assert.ok(topicId, "topic has an id");
  });

  await test("tools/call set_level moves the global reading level", async () => {
    const r = await callTool("set_level", { level: "eli5" });
    assert.ok(!r.isError);
    const state = await readState();
    assert.equal(state.defaultLevel, "eli5");
  });

  await test("tools/call list_topics reflects the authored topic", async () => {
    const r = await callTool("list_topics", {});
    assert.match(r.content[0].text, /Binary search/);
  });

  await test("sampling round-trip: request_explanation -> model -> set_explanation", async () => {
    const r = await callTool("request_explanation", { topicId, level: "eli5" });
    assert.ok(!r.isError, "request accepted");
    // The server fired sampling/createMessage in the background; our reader answered
    // with CANNED. Poll until the wrapper writes it back via set_explanation.
    let stored = "";
    for (let i = 0; i < 60 && !stored; i++) {
      await sleep(100);
      const state = await readState();
      stored = state.topics[0].explanations?.eli5 || "";
    }
    assert.ok(sampleCount >= 1, "server used MCP sampling");
    assert.equal(stored, CANNED, "explanation written back from the sampled answer");
  });

  await test("resources/list advertises the board + state resources", async () => {
    const r = await rpc("resources/list", {});
    const uris = new Set(r.resources.map((x) => x.uri));
    assert.ok(uris.has("ui://code-tutor/board"), "board UI resource");
    assert.ok(uris.has("state://code-tutor/board"), "state resource");
  });

  await test("resources/read board returns the MCP App wired to tools", async () => {
    const r = await rpc("resources/read", { uri: "ui://code-tutor/board" });
    const c = r.contents[0];
    assert.equal(c.mimeType, "text/html;profile=mcp-app");
    assert.match(c.text, /MCP App bridge/);
    assert.match(c.text, /ui\/initialize/);
    assert.match(c.text, /ui\/notifications\/initialized/);
    assert.match(c.text, /postMessage/);
    assert.match(c.text, /set_level/);
    assert.match(c.text, /confused/);
    assert.match(c.text, /Demo Repo/); // current state is injected into the app
    assert.match(c.text, /Binary search/);
  });

  clearTimeout(guard);
  child.stdin.end();
  await new Promise((r) => child.on("exit", r));
  console.log(`\n${passed} checks passed`);
} catch (e) {
  clearTimeout(guard);
  try { child.kill(); } catch {}
  console.error(e?.stack || e);
  process.exitCode = 1;
} finally {
  await rm(home, { recursive: true, force: true }).catch(() => {});
}
