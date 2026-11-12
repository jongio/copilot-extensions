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
  // Post an MCP-shaped tools/call up to the host. The host routes it to this
  // server's tools/call handler (the same runtime.invoke the canvas uses), then
  // pushes fresh state back. In a bare iframe (no host) we still update an
  // optimistic local copy so the panel stays interactive for the demo.
  const BOARD_URI = ${uri};
  let state = ${json};
  let seq = 1;
  function callTool(name, args) {
    const id = "app-" + (seq++);
    try { window.parent.postMessage({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args, _meta: { source: "ui", resourceUri: BOARD_URI } } }, "*"); } catch {}
    return id;
  }
  // Host pushes new state (or a resources/read result) back down to us.
  window.addEventListener("message", (e) => {
    const m = e.data || {};
    if (m.type === "state" && m.state) { state = m.state; render(); }
    if (m.result && m.result.contents) {
      const c = m.result.contents.find((x) => (x.mimeType || "").includes("json"));
      if (c && c.text) { try { state = JSON.parse(c.text); render(); } catch {} }
    }
  });

  const LEVELS = ["eli5", "curious", "engineer", "wizard"];
  const LEVEL_LABEL = { eli5: "ELI5", curious: "Curious", engineer: "Engineer", wizard: "Wizard" };
  const STATUSES = [["understood", "Understood"], ["not-understood", "Not yet"], ["revisit", "Revisit"]];

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

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function render() {
    const topics = state.topics || [];
    const level = state.defaultLevel || "engineer";
    const understood = topics.filter((t) => t.status === "understood").length;
    const label = (state.codebase && state.codebase.label) || "This codebase";
    const slider = LEVELS.map((l) =>
      '<button aria-pressed="' + (l === level) + '" onclick="__tutor.setLevel(\\'' + l + '\\')">' + LEVEL_LABEL[l] + "</button>"
    ).join("");
    const list = topics.length
      ? topics.map((t) => {
          const expl = (t.explanations && t.explanations[level]) || "";
          const status = STATUSES.map(([s, lbl]) =>
            '<button aria-pressed="' + (t.status === s) + '" onclick="__tutor.setStatus(\\'' + esc(t.id) + '\\',\\'' + s + '\\')">' + lbl + "</button>"
          ).join("");
          return (
            '<div class="topic"><div class="cat">' + esc(t.category || "concept") + "</div>" +
            "<h2>" + esc(t.title) + "</h2>" +
            '<p class="muted">' + esc(expl || t.summary || "No explanation at this level yet.") + "</p>" +
            '<div class="status">' + status + "</div></div>"
          );
        }).join("")
      : '<p class="muted">No topics yet. Ask Copilot to analyze the repo (it calls set_codebase + add_topic).</p>';
    document.getElementById("app").innerHTML =
      "<h1>" + esc(label) + "</h1>" +
      '<div class="muted ring">' + understood + " / " + topics.length + " understood</div>" +
      '<div class="slider">' + slider + "</div>" + list;
  }

  // PRODUCTION: replace render()/callTool wiring above with a mount of the real
  // web/app.mjs, passing it { state, invoke: (a, i) => callTool(a, i) }. The board
  // components (TopicCard, ReviewTab, ...) are unchanged; only the transport swaps.
  render();
  // Ask the host for the freshest state on open (no-op in a bare iframe).
  try { window.parent.postMessage({ jsonrpc: "2.0", id: "app-open", method: "resources/read", params: { uri: "state://code-tutor/board" } }, "*"); } catch {}
</script>
</body>
</html>`;
}
