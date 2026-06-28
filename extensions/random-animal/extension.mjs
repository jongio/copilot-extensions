// extension.mjs — the ONLY file that talks to the Copilot SDK.
// It adapts the SDK canvas lifecycle onto the SDK-free kit runtime so the
// runtime can also be booted and tested standalone. Keep behavior in canvas.mjs.

import { createCanvas, joinSession, CanvasError } from "@github/copilot-sdk/extension";
import { canvasConfig } from "./canvas.mjs";
import { createCanvasRuntime, CanvasKitError } from "./canvas-kit/server.mjs";

// Session handle, set once joinSession resolves. The host wrappers close over it
// so a UI button click can reach the model for THIS Copilot session.
let session = null;
// Canvas runtime, assigned below. The background bridge references it lazily.
let runtime = null;

// How long a silent query may run before we give up and show a retry.
const AI_TIMEOUT_MS = 90_000;

function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} took too long (over ${Math.round(ms / 1000)}s). Try again.`)),
      ms,
    );
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

// ---- host AI capability (canvas-kit 2026-06-27.1) --------------------------
// Handed to the kit via runtime.setHost(...) so SDK-free canvas.mjs handlers can
// call ctx.ai(...) / ctx.askAgent(...).
//   - ai(question): a SILENT, context-free answer via the in-session
//     ephemeralQuery. Never adds a turn to the user's conversation.
//   - askAgent(prompt): hand a turn to the MAIN agent (visible, tool-capable).
const host = {
  ai: async (question) => {
    const { answer } = await withTimeout(
      session.rpc.ui.ephemeralQuery({ question: String(question) }),
      AI_TIMEOUT_MS,
      "The animal expert",
    );
    return String(answer ?? "").trim();
  },
  askAgent: async (prompt) => session.send(String(prompt)),
};

// Synchronous in-flight guard. The kit's invoke() is not serialized per domain,
// so a double-click could pass an async "already pending?" check twice and fire
// two model calls. claim() is a synchronous test-and-set keyed per unit of work.
const inFlight = new Set();
const claim = (key) => (inFlight.has(key) ? false : (inFlight.add(key), true));
const release = (key) => inFlight.delete(key);

// Wrap a canvas action's handler in place (canvas.mjs stays SDK-free; only this
// file has the SDK + session). `make` receives the original handler.
function wrapAction(name, make) {
  const def = canvasConfig.actions?.[name];
  if (def && typeof def.handler === "function") def.handler = make(def.handler);
}

// request_ai_fact: canvas marks the current animal "thinking" and returns a
// prompt; answer it SILENTLY with the host model and write the fact back via
// set_ai_fact. Runs in the background so the POST returns immediately (the
// spinner is the server-pushed pending state). Keyed by animal id so a double
// click can't fire twice and a late answer can't land on a re-rolled animal.
wrapAction("request_ai_fact", (original) => async (api) => {
  const result = await original(api);
  const fromUi = api?.ctx?.source === "ui";
  const back = { ...(api?.ctx ?? {}), source: "extension" };
  const { id, prompt } = result || {};
  if (!fromUi || !id || !prompt) return result;
  const key = `aifact:${api?.ctx?.domainId ?? "default"}:${id}`;
  if (!claim(key)) return result;
  if (!session) {
    Promise.resolve()
      .then(() => runtime?.invokeFromAgent("fail_ai_fact", { id, message: "No active Copilot session. Try again." }, back))
      .catch((e) => console.error(`[random-animal] fail_ai_fact errored: ${e?.message ?? e}`))
      .finally(() => release(key));
    return result;
  }
  Promise.resolve()
    .then(() => host.ai(prompt))
    .then((fact) => {
      if (!fact) throw new Error("the expert returned an empty fact");
      return runtime.invokeFromAgent("set_ai_fact", { id, fact }, back);
    })
    .catch((e) => {
      console.error(`[random-animal] ai fact failed: ${e?.message ?? e}`);
      return runtime?.invokeFromAgent("fail_ai_fact", { id, message: String(e?.message ?? e) }, back).catch(() => {});
    })
    .finally(() => release(key));
  return result;
});

runtime = createCanvasRuntime(canvasConfig);

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

// Expose the host model to SDK-free canvas.mjs handlers as ctx.ai / ctx.askAgent
// (canvas-kit 2026-06-27.1). The intercept above uses `host` directly; this makes
// the SAME capability available to any plain handler too.
runtime.setHost(host);
