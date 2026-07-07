// extension.mjs - the ONLY file that talks to the Copilot SDK.
// It adapts the SDK canvas lifecycle onto the SDK-free kit runtime so the
// runtime can also be booted and tested standalone. Keep behavior in canvas.mjs.

import { createCanvas, joinSession, CanvasError } from "@github/copilot-sdk/extension";
import { canvasConfig } from "./canvas.mjs";
import { createCanvasRuntime, CanvasKitError } from "./canvas-kit/server.mjs";

// Session handle, set once joinSession resolves. The wrappers below close over
// it so a UI button click can reach the model for THIS Copilot session.
let session = null;
// Canvas runtime, assigned below. Background bridges reference it lazily (they
// only run on a later UI click, by which point it is initialized).
let runtime = null;

// How long a silent tutor query may run before we give up and show a retry.
// Normal answers land well inside this; the cap is for true stalls.
const AI_TIMEOUT_MS = 90_000;

// ---- host AI capability (canvas-kit host model: ai + askAgent) -------------
// Two ways to reach the model. Both are handed to the kit via runtime.setHost(...)
// so SDK-free canvas.mjs handlers can call ctx.ai(...) / ctx.askAgent(...).
//
//  - ai(question): a SILENT answer via the in-session ephemeralQuery. It never
//    adds a turn to the user's conversation. It DOES run against the ambient
//    conversation context, so canvas.mjs frames each prompt as a self-contained
//    instruction ("You are a tutor. Output ONLY ...") to avoid context bleed.
//  - askAgent(prompt): hand a turn to the MAIN agent (visible, tool-capable).
//    Used by request_refresh, which needs the agent to re-read the repo.
const host = {
  ai: async (question) => {
    const { answer } = await withTimeout(
      session.rpc.ui.ephemeralQuery({ question: String(question) }),
      AI_TIMEOUT_MS,
      "The tutor",
    );
    return String(answer ?? "").trim();
  },
  askAgent: async (prompt) => session.send(String(prompt)),
};

function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} took too long (over ${Math.round(ms / 1000)}s) — the session may be busy. Try again.`)),
      ms,
    );
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

// Aim guidance for a free-form answer at the learner's chosen reading level.
const ANSWER_LEVEL_GUIDE = {
  eli5: "Explain like I'm 5: a plain everyday analogy, zero jargon.",
  curious: "Plain English for a smart non-expert; define any term you use.",
  engineer: "Technical depth for a working developer; be precise.",
  wizard: "Deep and theoretical; assume an expert reader.",
};

// Wrap a canvas action's handler in place (canvas.mjs stays SDK-free; only this
// file has the SDK + session). `make` receives the original handler.
function wrapAction(name, make) {
  const def = canvasConfig.actions?.[name];
  if (def && typeof def.handler === "function") def.handler = make(def.handler);
}

// Synchronous in-flight guard. The kit's invoke() is not serialized per domain,
// so two near-simultaneous UI POSTs (a double-click) can both pass an
// async-read "already pending?" check and each fire a duplicate model/agent
// call. claim() is a synchronous test-and-set on a shared Set: the first caller
// wins and the second bails until release() is called. Keyed per logical unit
// of work (domain / topic+level) so unrelated work isn't blocked.
const inFlight = new Set();
const claim = (key) => (inFlight.has(key) ? false : (inFlight.add(key), true));
const release = (key) => inFlight.delete(key);

// (1) Refresh: hand a re-analysis prompt to the MAIN agent (askAgent / send).
// This one MUST stay on the agent loop: re-reading the repo needs the agent's
// tools, which a silent ai() query does not have. The agent picks it up,
// re-reads code, and calls set_codebase (which clears the pending flag).
wrapAction("request_refresh", (original) => async (api) => {
  const fromUi = api?.ctx?.source === "ui";
  const domainId = api?.ctx?.domainId ?? "default";
  const alreadyPending = !!api?.state?.refreshRequestedAt;
  // Claim synchronously BEFORE the first await so a concurrent double-click
  // can't also pass the guard. Combined with `alreadyPending` (which covers the
  // sequential case once `original` commits refreshRequestedAt), this dedupes
  // both bursts and repeats.
  const claimed = fromUi && !alreadyPending && claim(`refresh:${domainId}`);
  const result = await original(api);
  const prompt = result?.prompt;
  if (claimed && session && prompt) {
    console.error("[code-tutor] refresh: handing prompt to the main agent via askAgent");
    Promise.resolve()
      .then(() => session.log?.("Code Tutor: refreshing analysis (prompt handed to the agent)", { ephemeral: true }))
      .then(() => host.askAgent(prompt))
      .then((id) => console.error(`[code-tutor] refresh: askAgent ok, messageId=${id}`))
      .catch((e) => console.error(`[code-tutor] refresh: askAgent failed: ${e?.message ?? e}`))
      .finally(() => release(`refresh:${domainId}`));
  } else {
    if (claimed) release(`refresh:${domainId}`); // claimed but not dispatched
    if (fromUi) {
      console.error(`[code-tutor] refresh: NOT injecting (alreadyPending=${alreadyPending}, hasSession=${!!session}, hasPrompt=${!!prompt})`);
    }
  }
  return result;
});

// (2) Explanation: generate it SILENTLY with the host model (ai / ephemeralQuery)
// and write it straight back via set_explanation. Unlike a chat send, this does
// NOT add a turn to the conversation, so the tutor fills the card without
// spamming the chat. The UI POST already set an "explaining" spinner; on success
// set_explanation clears it, on failure fail_explanation shows retry. We reuse
// the request's ctx (instanceId/domainId) so the write-back lands on the SAME
// board, then run it in the background so the POST returns immediately (and the
// spinner is visible while the silent query runs).
wrapAction("request_explanation", (original) => async (api) => {
  const fromUi = api?.ctx?.source === "ui";
  const domainId = api?.ctx?.domainId ?? "default";
  // Claim per topic+level BEFORE the first await so a double-click can't fire
  // two silent ai() calls for the same explanation.
  const reqKey = `explain:${domainId}:${api?.input?.topicId}:${api?.input?.level}`;
  const claimed = fromUi && claim(reqKey);
  const result = await original(api);
  const back = { ...(api?.ctx ?? {}), source: "extension" };
  const { topicId, level, prompt } = result || {};
  if (fromUi && !claimed) {
    // A concurrent request for this exact topic+level is already in flight.
    console.error(`[code-tutor] explain: deduped concurrent request topic=${topicId} level=${level}`);
    return result;
  }
  if (fromUi && topicId && level && prompt) {
    if (!session) {
      console.error("[code-tutor] explain: no session; marking failed");
      Promise.resolve()
        .then(() => runtime?.invokeFromAgent("fail_explanation", { topicId, level, message: "No active Copilot session to answer right now. Ask in chat, or try again." }, back))
        .catch((e) => console.error(`[code-tutor] explain: fail_explanation errored: ${e?.message ?? e}`))
        .finally(() => release(reqKey));
    } else {
      console.error(`[code-tutor] explain: silent ai() topic=${topicId} level=${level}`);
      Promise.resolve()
        .then(() => host.ai(prompt))
        .then((text) => {
          if (!text) throw new Error("the tutor returned an empty answer");
          return runtime.invokeFromAgent("set_explanation", { topicId, level, text }, back);
        })
        .then(() => console.error(`[code-tutor] explain: stored topic=${topicId} level=${level}`))
        .catch((e) => {
          console.error(`[code-tutor] explain: failed: ${e?.message ?? e}`);
          return runtime
            ?.invokeFromAgent("fail_explanation", { topicId, level, message: String(e?.message ?? e) }, back)
            .catch(() => {});
        })
        .finally(() => release(reqKey));
    }
  } else if (claimed) {
    release(reqKey); // claimed but the handler returned nothing dispatchable
  }
  return result;
});

// (3) Chat: when the learner asks the tutor a question from the canvas, answer
// it SILENTLY with the host model and post the answer back via answer_question.
// This turns the question box into a real, self-contained tutor chat: the
// answer appears in-canvas without needing the main agent to be watching, and
// without polluting the conversation. The pending question (answer == null)
// shows the "Waiting for the tutor…" spinner until the write-back lands.
wrapAction("ask_question", (original) => async (api) => {
  const result = await original(api);
  const fromUi = api?.ctx?.source === "ui";
  const back = { ...(api?.ctx ?? {}), source: "extension" };
  const id = result?.id;
  if (fromUi && id) {
    if (!session) {
      // Mirror request_explanation's no-session path: resolve the pending
      // question with an error answer so the card doesn't spin forever.
      console.error(`[code-tutor] chat: no session; marking question id=${id} unanswerable`);
      Promise.resolve()
        .then(() =>
          runtime?.invokeFromAgent(
            "answer_question",
            { id, answer: "No active Copilot session to answer right now. Ask in chat, or try again." },
            back,
          ),
        )
        .catch((e) => console.error(`[code-tutor] chat: answer_question(no-session) errored: ${e?.message ?? e}`));
      return result;
    }
    const state = api?.state ?? {};
    const text = String(api?.input?.text ?? "").trim();
    const level = api?.input?.level ?? state.defaultLevel ?? null;
    const topic = api?.input?.topicId ? (state.topics ?? []).find((t) => t.id === api.input.topicId) : null;

    const bits = [];
    if (state.codebase?.label) bits.push(`The learner is studying the codebase "${state.codebase.label}".`);
    if (state.codebase?.summary) bits.push(`Overview: ${state.codebase.summary}.`);
    if (topic?.title) bits.push(`The question is about the concept "${topic.title}"${topic.summary ? `: ${topic.summary}` : ""}.`);
    const levelGuide = (level && ANSWER_LEVEL_GUIDE[level]) || "";

    const prompt =
      `You are a friendly, precise coding tutor answering a learner's question. ` +
      `${bits.join(" ")} ${levelGuide} ` +
      `Question: "${text}". ` +
      `Output ONLY the answer as 1 to 3 short paragraphs of plain prose. ` +
      `No preamble, no headings, no bullet lists, no code fences, and do not use em dashes.`;

    console.error(`[code-tutor] chat: silent ai() answering question id=${id}`);
    Promise.resolve()
      .then(() => host.ai(prompt))
      .then((answer) => {
        if (!answer) throw new Error("the tutor returned an empty answer");
        return runtime.invokeFromAgent("answer_question", { id, answer }, back);
      })
      .then(() => console.error(`[code-tutor] chat: answered question id=${id}`))
      .catch((e) => {
        console.error(`[code-tutor] chat: failed id=${id}: ${e?.message ?? e}`);
        return runtime
          ?.invokeFromAgent("answer_question", { id, answer: `The tutor could not answer right now: ${String(e?.message ?? e)}` }, back)
          .catch(() => {});
      });
  }
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

// Expose the host model to SDK-free canvas.mjs handlers as ctx.ai / ctx.askAgent.
// The intercepts above use `host` directly; this makes the SAME capability
// available to any plain handler too (via the kit's runtime.setHost host model).
runtime.setHost(host);
