// mcp/server.mjs - a SECOND host adapter for Code Tutor, alongside extension.mjs.
//
// extension.mjs adapts the Copilot canvas SDK. THIS file adapts the Model Context
// Protocol. Both drive the exact same core: canvas.mjs action handlers + the
// canvas-kit runtime + the web/ board. That is the whole point of the POC - moving
// Code Tutor to VS Code (and every other MCP host) is an adapter swap, not a rewrite.
//
//   canvas.mjs (SDK-free logic)      <- unchanged, shared
//   canvas-kit/server.mjs (runtime)  <- unchanged, shared
//   web/ board                       <- served here as an MCP App UI resource
//   extension.mjs  == canvas host    |  this file == MCP host
//   ctx.ai(...)    == ephemeralQuery |  ctx.ai(...) == MCP sampling
//
// Transport: newline-delimited JSON-RPC 2.0 over stdio (the MCP stdio transport).
// stdout carries ONLY protocol messages; every log goes to stderr. Zero deps, no
// build step - same house style as the rest of the repo. A production server would
// vendor @modelcontextprotocol/sdk the way canvas-kit/ is vendored; the minimal
// hand-rolled protocol here keeps the POC instantly runnable and testable.
//
// Run:   node mcp/server.mjs        (speaks MCP on stdin/stdout)
// Test:  node mcp/test/smoke.test.mjs

import process from "node:process";
import { canvasConfig } from "../canvas.mjs";
import { createCanvasRuntime } from "../canvas-kit/server.mjs";
import { buildBoardApp } from "./board-app.mjs";

const SERVER = { name: "code-tutor", version: "0.1.0-poc" };
const PROTOCOL_VERSION = "2025-06-18"; // MCP revision this POC targets
const DOMAIN = process.env.CODE_TUTOR_MCP_DOMAIN || "mcp";
const BOARD_URI = "ui://code-tutor/board";
const STATE_URI = "state://code-tutor/board";

const runtime = createCanvasRuntime(canvasConfig);
let clientCaps = {}; // populated from initialize
let nextOutboundId = 1; // ids for server -> client requests (sampling)
const pending = new Map(); // outboundId -> { resolve, reject }

// ---- stdio JSON-RPC plumbing ----------------------------------------------
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
function reply(id, result) { send({ jsonrpc: "2.0", id, result }); }
function replyError(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }
function log(...a) { console.error("[code-tutor-mcp]", ...a); }

// Server -> client request (sampling). Resolves when the client answers by id.
function request(method, params) {
  const id = "s" + nextOutboundId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

// ---- AI layer: MCP sampling (host model), with an offline fallback ---------
// host.ai(question) -> Promise<string>. If the connected client advertised the
// `sampling` capability at initialize, we ask ITS model to answer: the user's
// Copilot model, their consent, their bill, zero model credentials here. If the
// host did not grant sampling, we degrade to a stub so the tools still work
// (verify sampling per host; a production server would embed the Copilot SDK or
// a BYOK provider in this branch instead).
const host = {
  ai: async (question) => {
    const q = String(question);
    if (!clientCaps.sampling) {
      log("no sampling capability from client; returning offline stub");
      return "[[offline: this MCP host did not grant sampling]] A concept explanation would appear here.";
    }
    const res = await request("sampling/createMessage", {
      messages: [{ role: "user", content: { type: "text", text: q } }],
      maxTokens: 1024,
      modelPreferences: { intelligencePriority: 0.6, speedPriority: 0.6 },
    });
    const text = res && res.content && res.content.type === "text" ? res.content.text : "";
    return String(text || "").trim();
  },
  // "Hand a turn to the main agent" (request_refresh needs repo-reading tools). In
  // an MCP host the driving agent already IS the tool caller, so the refresh prompt
  // is returned in the tool result for that agent to act on. A fuller build could
  // raise an elicitation. For the POC we log and no-op.
  askAgent: async (prompt) => { log("askAgent (refresh) prompt:", String(prompt).slice(0, 60), "..."); return null; },
};
runtime.setHost(host);

// ---- wrap the AI-backed actions (same pattern as extension.mjs) ------------
// canvas.mjs base handlers stay SDK-free: they mark state and return a prompt.
// Here we turn that prompt into a sampling call and write the answer back via the
// existing set_explanation / answer_question actions - the MCP analog of the
// wrapAction blocks in extension.mjs. Back-writes pin domainId so they always land
// on THIS board (invoke reads ctx.domainId directly).
const back = { domainId: DOMAIN, source: "extension" };
function wrapAction(name, make) {
  const def = canvasConfig.actions?.[name];
  if (def && typeof def.handler === "function") def.handler = make(def.handler);
}

wrapAction("request_explanation", (original) => async (api) => {
  const result = await original(api);
  const { topicId, level, prompt } = result || {};
  if (topicId && level && prompt) {
    host.ai(prompt)
      .then((text) => {
        if (!text) throw new Error("empty tutor answer");
        return runtime.invoke("set_explanation", { topicId, level, text }, back);
      })
      .catch((e) =>
        runtime.invoke("fail_explanation", { topicId, level, message: String(e?.message ?? e) }, back).catch(() => {})
      );
  }
  return result;
});

wrapAction("ask_question", (original) => async (api) => {
  const result = await original(api);
  const id = result?.id;
  if (id) {
    const state = api?.state ?? {};
    const text = String(api?.input?.text ?? "").trim();
    const topic = api?.input?.topicId ? (state.topics ?? []).find((t) => t.id === api.input.topicId) : null;
    const bits = [];
    if (state.codebase?.label) bits.push(`The learner is studying "${state.codebase.label}".`);
    if (topic?.title) bits.push(`The question is about "${topic.title}".`);
    const prompt =
      `You are a precise coding tutor. ${bits.join(" ")} Question: "${text}". ` +
      `Output ONLY the answer as 1 to 3 short paragraphs of plain prose. ` +
      `No preamble, no headings, no bullet lists, no code fences, and do not use em dashes.`;
    host.ai(prompt)
      .then((answer) => runtime.invoke("answer_question", { id, answer: answer || "The tutor returned no answer." }, back))
      .catch((e) =>
        runtime.invoke("answer_question", { id, answer: `The tutor could not answer right now: ${String(e?.message ?? e)}` }, back).catch(() => {})
      );
  }
  return result;
});

// ---- MCP method handlers ---------------------------------------------------
// Every canvas action becomes an MCP tool, verbatim - name, description, and the
// inputSchema the author already wrote are exactly the MCP tool contract.
function toolList() {
  return Object.entries(canvasConfig.actions).map(([name, def]) => ({
    name,
    description: def.description || "",
    inputSchema: def.inputSchema || { type: "object", properties: {} },
  }));
}

async function handleToolsCall(params) {
  const name = params?.name;
  const args = params?.arguments ?? {};
  const source = params?._meta?.source || "agent"; // ui = from the MCP App board
  const result = await runtime.invoke(name, args, { domainId: DOMAIN, source });
  return {
    content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }],
    structuredContent: result,
    // Point the host at the board so a tool call can offer to open the panel.
    _meta: { "ui/resourceUri": BOARD_URI },
  };
}

async function handleResourcesRead(params) {
  const uri = params?.uri;
  if (uri === BOARD_URI) {
    const state = await runtime.getState(DOMAIN);
    return { contents: [{ uri, mimeType: "text/html", text: buildBoardApp({ state, boardUri: BOARD_URI }) }] };
  }
  if (uri === STATE_URI) {
    const state = await runtime.getState(DOMAIN);
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(state) }] };
  }
  throw new Error(`unknown resource: ${uri}`);
}

async function dispatch(msg) {
  const { id, method, params } = msg;
  try {
    switch (method) {
      case "initialize":
        clientCaps = params?.capabilities || {};
        reply(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {}, resources: {} },
          serverInfo: SERVER,
          instructions:
            "Code Tutor: ask the agent to analyze a repo, then author topics and findings with these tools. " +
            "Open the board via the ui://code-tutor/board resource. Silent explanations use MCP sampling.",
        });
        break;
      case "notifications/initialized":
        break; // notification, no reply
      case "ping":
        reply(id, {});
        break;
      case "tools/list":
        reply(id, { tools: toolList() });
        break;
      case "tools/call":
        reply(id, await handleToolsCall(params));
        break;
      case "resources/list":
        reply(id, {
          resources: [
            { uri: BOARD_URI, name: "Code Tutor board", description: "The interactive tutor board (MCP App UI).", mimeType: "text/html" },
            { uri: STATE_URI, name: "Code Tutor state", description: "Current board state as JSON.", mimeType: "application/json" },
          ],
        });
        break;
      case "resources/read":
        reply(id, await handleResourcesRead(params));
        break;
      default:
        if (id !== undefined) replyError(id, -32601, `method not found: ${method}`);
    }
  } catch (e) {
    log(`error handling ${method}: ${e?.message ?? e}`);
    if (id !== undefined) {
      // Handler (business-rule) errors surface as isError tool content so the agent
      // can read them; genuine protocol errors use a JSON-RPC error.
      if (method === "tools/call") reply(id, { content: [{ type: "text", text: String(e?.message ?? e) }], isError: true });
      else replyError(id, -32603, String(e?.message ?? e));
    }
  }
}

function onMessage(msg) {
  // A message carrying `method` is an incoming request/notification. Otherwise it
  // is a RESPONSE to one of our outbound sampling requests - resolve it by id.
  if (msg.method) { dispatch(msg); return; }
  const p = msg.id !== undefined ? pending.get(msg.id) : null;
  if (!p) return;
  pending.delete(msg.id);
  if (msg.error) p.reject(new Error(msg.error.message || "sampling error"));
  else p.resolve(msg.result);
}

// ---- stdin reader (newline-delimited JSON) ---------------------------------
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { log(`bad json: ${e?.message}`); continue; }
    onMessage(msg);
  }
});
process.stdin.on("end", async () => { try { await runtime.shutdown(); } catch {} process.exit(0); });

log(`ready (domain=${DOMAIN}); ${Object.keys(canvasConfig.actions).length} tools, board at ${BOARD_URI}`);
