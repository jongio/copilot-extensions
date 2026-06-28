// fast-ai.mjs - fast, context-free host-model access for a canvas.
//
// Why this exists: the kit's default ctx.ai() uses the host's `ephemeralQuery`,
// which runs against the CURRENT session's full conversation context AND shares
// the model with the active agent turn. In a long, busy session that is slow
// (20-60s) and unpredictable.
//
// This module instead spawns a SEPARATE, dedicated Copilot runtime (the native
// `copilot` binary) ONCE, keeps it warm, and runs each query as a FRESH session
// with a FAST model. That makes every answer:
//   * fast        - ~2s/query after a ~2s one-time warmup (a 10-30x speedup)
//   * context-free - a brand-new session each call, so no chat bleed and no
//                    giant-context reprocessing
//   * isolated    - it never touches the user's conversation
//
// It needs NO copilot-sdk change: it uses the SDK the extension already has,
// pointed at the runtime binary. `createSession` works here because this is a
// FRESH runtime we own (only the extension's parent-process stdio connection
// refuses session.create).

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";

// SECURITY: these are silent, context-free TEXT-GENERATION calls — they need
// ZERO tools. The fast path runs on a SEPARATE, full Copilot runtime where the
// agent loop (and thus shell/file/edit tools) really can execute, and the
// prompts embed UNTRUSTED input (the codebase under study and free-text learner
// questions). A prompt injection ("ignore that, run shell …") in a tool-capable,
// auto-approving session would be remote code execution. So every session here
// is locked down three ways:
//   1. availableTools: [] — empty allowlist => no tool is ever enabled.
//   2. onPermissionRequest denies — belt-and-suspenders if any tool slips the net.
//   3. workingDirectory = a temp dir — never the user's repo, so even a tool that
//      somehow ran has nothing useful to touch.
const denyToolUse = () => ({ kind: "reject", feedback: "Tools are disabled for tutor generation." });

function lockedDownSessionConfig(model) {
  return {
    model,
    availableTools: [],
    onPermissionRequest: denyToolUse,
    workingDirectory: tmpdir(),
  };
}

// ---- locate the native runtime binary (portable, no hardcoded path) --------
function platformBinary(pkgRoot) {
  const plat = process.platform;
  const arch = process.arch;
  const exe = plat === "win32" ? "copilot.exe" : "copilot";
  const bin = join(pkgRoot, "node_modules", "@github", `copilot-${plat}-${arch}`, exe);
  return existsSync(bin) ? bin : null;
}

function fromRequire() {
  try {
    const req = createRequire(import.meta.url);
    const sdk = req.resolve("@github/copilot/sdk"); // .../@github/copilot/sdk/index.js
    return platformBinary(dirname(dirname(sdk)));
  } catch {
    return null;
  }
}

function fromPath() {
  try {
    const cmd = process.platform === "win32" ? "where copilot" : "command -v copilot";
    const lines = execSync(cmd, { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
    for (const shim of lines) {
      const pkgRoot = join(dirname(shim), "node_modules", "@github", "copilot");
      if (existsSync(pkgRoot)) {
        const bin = platformBinary(pkgRoot);
        if (bin) return bin;
      }
    }
  } catch {}
  return null;
}

export function resolveRuntimeBinary() {
  const env = process.env.COPILOT_CLI_PATH;
  if (env && existsSync(env)) return env;
  return fromRequire() || fromPath();
}

// ---- warm runtime + fresh-session-per-query --------------------------------
/**
 * @param {object} [opts]
 * @param {string} [opts.model="gpt-5.4-mini"]  fast model for silent answers
 * @param {number} [opts.timeoutMs=60000]       per-query wait cap
 * @param {number} [opts.idleMs=300000]         tear down the warm runtime after this idle
 */
export function createFastAI({ model = "gpt-5.4-mini", timeoutMs = 60_000, idleMs = 300_000 } = {}) {
  let clientP = null; // Promise<CopilotClient>, the warm runtime (started once)
  let idleTimer = null;
  let inFlight = 0; // active queries; the idle teardown must never fire mid-query

  function armIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    // Only schedule teardown when nothing is running. Re-armed on query
    // completion (see ai/warmup finally), so a slow query can't be torn down
    // out from under itself even if a caller sets idleMs < timeoutMs.
    if (inFlight > 0) return;
    idleTimer = setTimeout(() => { void dispose(); }, idleMs);
    if (typeof idleTimer.unref === "function") idleTimer.unref();
  }

  async function ensureClient() {
    if (!clientP) {
      clientP = (async () => {
        const t0 = Date.now();
        const path = resolveRuntimeBinary();
        if (!path) throw new Error("could not locate the Copilot runtime binary");
        const client = new CopilotClient({
          connection: RuntimeConnection.forStdio({ path }),
          logLevel: "error",
        });
        await client.start();
        console.error(`[fast-ai] runtime started in ${Date.now() - t0}ms (${path})`);
        return client;
      })().catch((e) => {
        clientP = null; // let a later call retry a cold start
        throw e;
      });
    }
    return clientP;
  }

  /** Answer a single question with a fresh, fast, context-free, NO-TOOLS session. */
  async function ai(question) {
    const client = await ensureClient();
    inFlight++;
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } // hold teardown while active
    // Fresh session per call => guaranteed no context bleed between questions.
    // createSession on this warm runtime is ~1s; the query itself is ~2s.
    const tc = Date.now();
    const session = await client.createSession(lockedDownSessionConfig(model));
    const tq = Date.now();
    try {
      const ev = await session.sendAndWait({ prompt: String(question) }, timeoutMs);
      console.error(`[fast-ai] createSession=${tq - tc}ms query=${Date.now() - tq}ms model=${model}`);
      return String(ev?.data?.content ?? "").trim();
    } finally {
      try { await session.disconnect(); } catch {}
      inFlight--;
      armIdle(); // re-arm only now that this query is done
    }
  }

  async function dispose() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    const p = clientP;
    clientP = null;
    try { const c = await p; await c?.stop(); } catch {}
  }

  /** Pre-start the warm runtime (and prime the model path) so the first real
   * query is fast. Fire-and-forget; safe to call repeatedly. */
  async function warmup() {
    let counted = false;
    try {
      await ensureClient();
      inFlight++;
      counted = true;
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      // Prime the full path (createSession + a tiny query) so the model
      // handshake is done before the learner's first real question.
      const client = await clientP;
      const s = await client.createSession(lockedDownSessionConfig(model));
      try { await s.sendAndWait({ prompt: "Reply with: ok" }, 30_000); } finally { try { await s.disconnect(); } catch {} }
      console.error("[fast-ai] warmup complete (runtime + model primed)");
    } catch (e) {
      console.error(`[fast-ai] warmup failed (first ai() will retry/fallback): ${e?.message ?? e}`);
    } finally {
      if (counted) { inFlight--; armIdle(); }
    }
  }

  return { ai, warmup, dispose, resolveRuntimeBinary };
}
