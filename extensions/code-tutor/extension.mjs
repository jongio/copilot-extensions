// extension.mjs - the ONLY file that talks to the Copilot SDK.
// It adapts the SDK canvas lifecycle onto the SDK-free kit runtime so the
// runtime can also be booted and tested standalone. Keep behavior in canvas.mjs.

import { createCanvas, joinSession, CanvasError } from "@github/copilot-sdk/extension";
import { canvasConfig } from "./canvas.mjs";
import { createCanvasRuntime, CanvasKitError } from "./canvas-kit/server.mjs";

// Session handle, set once joinSession resolves. The refresh wrapper below closes
// over it so a UI button click can inject a prompt into THIS Copilot session.
let session = null;

// Bridge the "Refresh analysis" button to the live session. The canvas runtime
// dispatches UI POST /action and agent invoke_canvas_action calls to the SAME
// handler map, but only extension.mjs has the SDK + session. So we wrap the
// request_refresh handler here: when it's invoked from the UI (ctx.source ===
// "ui") we inject the prompt it returns into the current session via
// session.send(), which starts a new turn so Copilot actually re-analyzes.
// Agent-invoked calls are left untouched to avoid a self-trigger loop, and a
// repeat click while a request is already pending does not re-send.
// (This wrapper lives only in extension.mjs; the SDK-free smoke harness imports
// canvas.mjs directly and exercises the unwrapped handler.)
const refresh = canvasConfig.actions?.request_refresh;
if (refresh && typeof refresh.handler === "function") {
  const original = refresh.handler;
  refresh.handler = async (api) => {
    const alreadyPending = !!api?.state?.refreshRequestedAt;
    const result = await original(api);
    const fromUi = api?.ctx?.source === "ui";
    const prompt = result?.prompt;
    if (fromUi && !alreadyPending && session && prompt) {
      // Fire-and-forget: starts a fresh turn in this session. Don't block the
      // UI action's HTTP response on the agent's work or its availability.
      // console.error goes to this extension's log file (deterministic signal);
      // session.log goes to the session timeline (visible to the user).
      console.error("[code-tutor] refresh: injecting prompt into session via send()");
      Promise.resolve()
        .then(() => session.log?.("Code Tutor: refreshing analysis (prompt injected into this session)", { ephemeral: true }))
        .then(() => session.send(prompt))
        .then((id) => console.error(`[code-tutor] refresh: send() ok, messageId=${id}`))
        .catch((e) => console.error(`[code-tutor] refresh: send() failed: ${e?.message ?? e}`));
    } else if (fromUi) {
      console.error(`[code-tutor] refresh: NOT injecting (alreadyPending=${alreadyPending}, hasSession=${!!session}, hasPrompt=${!!prompt})`);
    }
    return result;
  };
}

const runtime = createCanvasRuntime(canvasConfig);

function toCanvasError(err) {
  if (err instanceof CanvasError) return err;
  if (err instanceof CanvasKitError) return new CanvasError(err.code, err.message);
  return new CanvasError("action_failed", String(err?.message ?? err));
}

const canvas = createCanvas({
  id: canvasConfig.id,
  displayName: canvasConfig.displayName,
  description: canvasConfig.description,
  inputSchema: canvasConfig.inputSchema,
  actions: Object.entries(canvasConfig.actions).map(([name, def]) => ({
    name,
    description: def.description,
    inputSchema: def.inputSchema,
    handler: async (ctx) => {
      try {
        return await runtime.invokeFromAgent(ctx.actionName, ctx.input, ctx);
      } catch (err) {
        throw toCanvasError(err);
      }
    },
  })),
  open: async (ctx) => {
    try {
      return await runtime.openInstance({ instanceId: ctx.instanceId, input: ctx.input, ctx });
    } catch (err) {
      throw toCanvasError(err);
    }
  },
  onClose: async (ctx) => {
    await runtime.closeInstance(ctx.instanceId);
  },
});

session = await joinSession({ canvases: [canvas] });
