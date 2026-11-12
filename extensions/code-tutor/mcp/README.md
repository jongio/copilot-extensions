# Code Tutor MCP adapter (POC)

A proof of concept that Code Tutor runs as a **Model Context Protocol server** with
an **MCP App** UI, reusing the exact same core as the canvas version. It is a second
host adapter that sits beside `extension.mjs`. Nothing in `canvas.mjs`, `canvas-kit/`,
or `web/` is rewritten.

Why this matters: "make Code Tutor work in VS Code" does not mean building a VS Code
extension. An MCP server plus an MCP App runs in VS Code, the Copilot app, the Copilot
CLI, and every other MCP host from one build. This POC shows the move is an adapter
swap, not a rewrite.

## What it proves (run the test to see all 9)

- Every `canvas.mjs` action becomes an MCP **tool**, verbatim. The `description` and
  `inputSchema` the author already wrote are the tool contract.
- `tools/call` runs the **same** `runtime.invoke` the canvas uses, mutating the same
  durable board state (`set_codebase`, `add_topic`, `set_level`, `list_topics`, ...).
- The AI layer is **MCP sampling**: `request_explanation` returns a prompt, the server
  asks the host's model over `sampling/createMessage`, and the answer is written back
  via `set_explanation`. The tutor's `ctx.ai(...)` maps onto sampling with no code
  change in `canvas.mjs`.
- The board ships as an **MCP App** UI resource (`ui://code-tutor/board`) whose controls
  call tools through a `postMessage` bridge. State is also exposed at
  `state://code-tutor/board`.

## The swap, side by side

| Concern | Canvas host (`extension.mjs`) | MCP host (`mcp/server.mjs`) |
| --- | --- | --- |
| Logic + state | `canvas.mjs` (SDK-free) | same, unchanged |
| Runtime | `canvas-kit/server.mjs` | same, unchanged |
| Actions | canvas actions over HTTP `/action` | same actions as MCP `tools/call` |
| Silent model call `ctx.ai` | `ephemeralQuery` / fast runtime | MCP `sampling/createMessage` |
| Hand a turn `ctx.askAgent` | `session.send` | returned to the driving agent |
| UI | `web/` board over HTTP + SSE | `web/` board as an MCP App over `postMessage` |
| Transport | Copilot canvas SDK | JSON-RPC 2.0 over stdio |

## Files

```
mcp/server.mjs            the MCP stdio server (the new adapter; analog of extension.mjs)
mcp/board-app.mjs         builds the board as an MCP App UI resource (postMessage bridge)
mcp/test/smoke.test.mjs   spawns the server and drives it over stdio end to end
```

## Run

```
node mcp/test/smoke.test.mjs     # the 9-check end-to-end proof
node --check mcp/server.mjs      # lint (repo house style: node --check + JSON.parse)
node mcp/server.mjs              # speak MCP on stdin/stdout (for a real host)
```

## Scope and next steps

This POC hand-rolls the minimal MCP protocol so it runs with zero dependencies and no
build, matching the rest of the repo. For production:

- Vendor `@modelcontextprotocol/sdk` the way `canvas-kit/` is vendored, for full
  protocol coverage (cancellation, progress, pagination, resource subscriptions).
- Mount the real `web/app.mjs` in the MCP App and point its `invoke()` at the bridge.
  The board components are unchanged; only the transport swaps. `board-app.mjs` marks
  the exact spot.
- Verify the target host grants **sampling**. Copilot and VS Code do; where a host does
  not, embed the Copilot SDK or a BYOK provider in the `host.ai` branch instead of the
  offline stub.
- Map `askAgent` (repo re-analysis for `request_refresh`) onto an elicitation or a
  returned instruction the driving agent runs.
