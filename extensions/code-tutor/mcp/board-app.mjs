// mcp/board-app.mjs - builds the Code Tutor board as an MCP App UI resource.
//
// In the canvas host the SAME board is web/app.mjs (Preact + htm) talking to the
// runtime over HTTP (fetch /action, SSE /state). An MCP App instead runs in a
// sandboxed iframe and talks to the host over postMessage. The board's contract
// is already transport-agnostic: it only needs `state` + `invoke(action, input)`.
// So the production move is a transport swap (mount web/app.mjs, point its
// invoke() at the bridge below), NOT a UI rewrite.
//
// For the POC this returns a small, self-contained, dependency-free board so the
// resource is real and demonstrably calls tools through the MCP App bridge. It
// renders the codebase title, a progress readout, the 4-stop level slider, and
// the topic list with per-topic status buttons. Every control routes through
// callTool(...) -> postMessage -> host -> our MCP server -> the same canvas.mjs
// handler. The comment marked PRODUCTION shows where web/app.mjs slots in.

/**
 * @param {object} opts
 * @param {object} opts.state     current board state (from runtime.getState)
 * @param {string} opts.boardUri  the ui:// resource uri, echoed for host round-trips
 * @returns {string} a self-contained HTML document (the MCP App)
 */
export function buildBoardApp({ state, boardUri }) {
  const json = JSON.stringify(state ?? {}).replace(/</g, "\\u003c");
  const uri = JSON.stringify(String(boardUri || "ui://code-tutor/board"));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Code Tutor</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; background: #0d1117; color: #e6edf3; }
  .wrap { padding: 16px; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .muted { color: #8b949e; }
  .slider { display: flex; gap: 6px; margin: 12px 0; }
  .slider button { flex: 1; padding: 6px 4px; border: 1px solid #30363d; background: #161b22; color: #e6edf3; border-radius: 6px; cursor: pointer; }
  .slider button[aria-pressed="true"] { background: #1f6feb; border-color: #1f6feb; }
  .topic { border: 1px solid #30363d; border-radius: 8px; padding: 12px; margin: 8px 0; background: #161b22; }
  .topic h2 { font-size: 14px; margin: 0 0 4px; }
  .cat { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #8b949e; }
  .status { display: flex; gap: 6px; margin-top: 8px; }
  .status button { padding: 4px 8px; border: 1px solid #30363d; background: #0d1117; color: #e6edf3; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .status button[aria-pressed="true"] { background: #238636; border-color: #238636; }
  .ring { font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<div id="app" class="wrap"><p class="muted">Loading curriculum...</p></div>
<script type="module">
  // ---- MCP App bridge -----------------------------------------------------
  // Complete the MCP Apps ui/initialize handshake before issuing resource reads
  // or tool calls. After each tool completion (or resource update notification),
  // re-read state://code-tutor/board so agent/background changes appear live.
  const BOARD_URI = ${uri};
  const STATE_URI = "state://code-tutor/board";
  let state = ${json};
  let seq = 1;
  let hostReady = false;
  const pendingCalls = [];
  const inFlightTools = new Set();

  function post(msg) {
    try { window.parent.postMessage(msg, "*"); } catch {}
  }

  function requestState() {
    post({ jsonrpc: "2.0", id: "app-state-" + (seq++), method: "resources/read", params: { uri: STATE_URI } });
  }

  function sendToolCall(name, args) {
    const id = "app-" + (seq++);
    inFlightTools.add(id);
    post({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args, _meta: { source: "ui", resourceUri: BOARD_URI } } });
    return id;
  }

  function callTool(name, args) {
    if (!hostReady) {
      pendingCalls.push([name, args]);
      return null;
    }
    return sendToolCall(name, args);
  }

  // Host pushes new state, initialization acknowledgement, or tool/resource results.
  window.addEventListener("message", (e) => {
    if (e.source && e.source !== window.parent) return;
    const m = e.data || {};
    if (m.id === "app-init" && m.result && !hostReady) {
      hostReady = true;
      post({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
      while (pendingCalls.length) {
        const [n, a] = pendingCalls.shift();
        sendToolCall(n, a);
      }
      requestState();
      return;
    }
    if (m.id && inFlightTools.has(m.id)) {
      inFlightTools.delete(m.id);
      requestState();
    }
    if (m.method === "notifications/resources/updated" || m.method === "ui/notifications/tool-result") {
      requestState();
    }
    if (m.type === "state" && m.state) { applyState(m.state); }
    if (m.result && m.result.contents) {
      const c = m.result.contents.find((x) => (x.mimeType || "").includes("json"));
      if (c && c.text) { try { applyState(JSON.parse(c.text)); } catch {} }
    }
  });

  const LEVELS = ["eli5", "curious", "engineer", "wizard"];
  const LEVEL_LABEL = { eli5: "ELI5", curious: "Curious", engineer: "Engineer", wizard: "Wizard" };
  const STATUSES = [["understood", "Understood"], ["confused", "Not yet"], ["revisit", "Revisit"]];

  let lastHtml = "";
  function applyState(nextState) {
    if (!nextState || typeof nextState !== "object") return;
    if (JSON.stringify(nextState) === JSON.stringify(state)) return;
    state = nextState;
    render();
  }

  function setLevel(level) {
    state = { ...state, defaultLevel: level };  // optimistic
    callTool("set_level", { level });
    render();
  }
  function setStatus(id, status) {
    state = { ...state, topics: (state.topics || []).map((t) => t.id === id ? { ...t, status } : t) };
    callTool("set_topic_status", { id, status });
    render();
  }
  window.__tutor = { setLevel, setStatus };  // onclick hooks

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function jsCall(fn, ...args) { return esc(fn + "(" + args.map((a) => JSON.stringify(a)).join(",") + ")"); }

  function render() {
    const topics = state.topics || [];
    const level = state.defaultLevel || "engineer";
    const understood = topics.filter((t) => t.status === "understood").length;
    const label = (state.codebase && state.codebase.label) || "This codebase";
    const slider = LEVELS.map((l) =>
      '<button data-focus-key="' + esc("level:" + l) + '" aria-pressed="' + (l === level) + '" onclick="' + jsCall("__tutor.setLevel", l) + '">' + LEVEL_LABEL[l] + "</button>"
    ).join("");
    const list = topics.length
      ? topics.map((t) => {
          const tid = String(t.id ?? "");
          const expl = (t.explanations && t.explanations[level]) || "";
          const status = STATUSES.map(([s, lbl]) =>
            '<button data-focus-key="' + esc("status:" + tid + ":" + s) + '" aria-pressed="' + (t.status === s) + '" onclick="' + jsCall("__tutor.setStatus", tid, s) + '">' + lbl + "</button>"
          ).join("");
          return (
            '<div class="topic"><div class="cat">' + esc(t.category || "concept") + "</div>" +
            "<h2>" + esc(t.title) + "</h2>" +
            '<p class="muted">' + esc(expl || t.summary || "No explanation at this level yet.") + "</p>" +
            '<div class="status">' + status + "</div></div>"
          );
        }).join("")
      : '<p class="muted">No topics yet. Ask Copilot to analyze the repo (it calls set_codebase + add_topic).</p>';
    const html =
      "<h1>" + esc(label) + "</h1>" +
      '<div class="muted ring">' + understood + " / " + topics.length + " understood</div>" +
      '<div class="slider">' + slider + "</div>" + list;
    if (html === lastHtml) return;
    const appEl = document.getElementById("app");
    const activeKey = document.activeElement && appEl.contains(document.activeElement)
      ? document.activeElement.getAttribute("data-focus-key")
      : null;
    lastHtml = html;
    appEl.innerHTML = html;
    if (activeKey) {
      const nextFocus = Array.from(appEl.querySelectorAll("[data-focus-key]")).find(
        (el) => el.getAttribute("data-focus-key") === activeKey
      );
      if (nextFocus && typeof nextFocus.focus === "function") nextFocus.focus();
    }
  }

  // PRODUCTION: replace render()/callTool wiring above with a mount of the real
  // web/app.mjs, passing it { state, invoke: (a, i) => callTool(a, i) }. The board
  // components (TopicCard, ReviewTab, ...) are unchanged; only the transport swaps.
  render();
  // Initiate the MCP Apps handshake; once the host replies, we send
  // ui/notifications/initialized and read state://code-tutor/board.
  post({
    jsonrpc: "2.0",
    id: "app-init",
    method: "ui/initialize",
    params: {
      protocolVersion: "2025-06-18",
      appInfo: { name: "code-tutor-board", version: "0.1.0-poc" },
      appCapabilities: {},
    },
  });
  setInterval(() => { if (hostReady) requestState(); }, 2500);
</script>
</body>
</html>`;
}
