// extension.mjs — the ONLY file that talks to the Copilot SDK.
// It adapts the SDK canvas lifecycle onto the SDK-free kit runtime so the
// runtime can also be booted and tested standalone. Keep behavior in canvas.mjs.

import { createCanvas, joinSession, CanvasError } from "@github/copilot-sdk/extension";
import { canvasConfig } from "./canvas.mjs";
import { createCanvasRuntime, CanvasKitError } from "./canvas-kit/server.mjs";

let session = null;
let runtime = null;

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
      "The news editor",
    );
    return String(answer ?? "").trim();
  },
  askAgent: async (prompt) => session.send(String(prompt)),
};

// Synchronous in-flight guard so a double-click can't fire two model calls.
const inFlight = new Set();
const claim = (key) => (inFlight.has(key) ? false : (inFlight.add(key), true));
const release = (key) => inFlight.delete(key);

function wrapAction(name, make) {
  const def = canvasConfig.actions?.[name];
  if (def && typeof def.handler === "function") def.handler = make(def.handler);
}

// request_digest: the canvas marks the digest card "thinking" and returns a
// prompt built from the visible headlines; answer it SILENTLY with the host
// model and write the TL;DR back via set_digest. Runs in the background so the
// POST returns immediately (the spinner is the server-pushed pending state).
// Keyed per feed domain so a double-click can't fire twice.
wrapAction("request_digest", (original) => async (api) => {
  const result = await original(api);
  const fromUi = api?.ctx?.source === "ui";
  const back = { ...(api?.ctx ?? {}), source: "extension" };
  const prompt = result?.prompt;
  if (!fromUi || !prompt) return result;
  const key = `digest:${api?.ctx?.domainId ?? "default"}`;
  if (!claim(key)) return result;
  if (!session) {
    Promise.resolve()
      .then(() => runtime?.invokeFromAgent("fail_digest", { message: "No active Copilot session. Try again." }, back))
      .catch((e) => console.error(`[news-aggregator] fail_digest errored: ${e?.message ?? e}`))
      .finally(() => release(key));
    return result;
  }
  Promise.resolve()
    .then(() => host.ai(prompt))
    .then((text) => {
      if (!text) throw new Error("the editor returned an empty digest");
      return runtime.invokeFromAgent("set_digest", { text }, back);
    })
    .catch((e) => {
      console.error(`[news-aggregator] ai digest failed: ${e?.message ?? e}`);
      return runtime?.invokeFromAgent("fail_digest", { message: String(e?.message ?? e) }, back).catch(() => {});
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
// (canvas-kit 2026-06-27.1).
runtime.setHost(host);
