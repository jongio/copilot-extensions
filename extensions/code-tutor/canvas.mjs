// canvas.mjs - Code Tutor canvas definition (kit config; SDK-free).
//
// Turns the *current codebase* into a personal CS course. The agent analyzes the
// repo and authors topics (algorithms, data structures, complexity, theory,
// patterns), code references, code-quality findings, and answers to questions.
// The user reads/learns, sets a reading level (ELI5 .. Wizard), marks their
// understanding, asks questions, expands code references, and requests fixes.
// Agent and UI share ONE state through the SAME action handlers.
//
// State is durable per-user and keyed by a "domain" (the codebase/project name)
// resolved from the open input, so one board == one codebase's course and the
// learner's per-topic level + understanding persist there.

import { fileURLToPath } from "node:url";
import { readFile, readdir, stat, realpath } from "node:fs/promises";
import { resolve, isAbsolute, sep, join } from "node:path";
import { userStore } from "./canvas-kit/storage.mjs";
import { nid } from "./canvas-kit/format.mjs";
import {
  conceptKeyFor,
  looksCodebaseSpecific,
  loadCache,
  saveCache,
  mutateCache,
  getCached,
  cachedLevelsFor,
  putCached,
  dropCached,
  LEGACY_LEVELS,
} from "./cache.mjs";

const EXT_NAME = "code-tutor";

// Reading-level ladder for the slider. Order matters: index == slider position.
// Fun, instantly-legible names instead of academic grade tiers:
//   eli5     - "explain like I'm 5" (anyone)
//   curious  - plain English (smart non-expert)
//   engineer - technical depth (a working dev)
//   wizard   - deep magic (the geeky end)
export const LEVELS = ["eli5", "curious", "engineer", "wizard"];
const DEFAULT_LEVEL = "engineer";

// What a topic can be filed under. Kept open-ish but enumerated so the agent
// fills a known set the view can icon/colorize.
const CATEGORIES = [
  "algorithm",
  "data-structure",
  "complexity",
  "theory",
  "pattern",
  "paradigm",
  "concurrency",
  "system",
];

// The "categorize that" ask: how well the learner understands a topic.
const STATUSES = ["new", "understood", "confused", "revisit"];

// Code-quality verdict for a finding.
const QUALITIES = ["good", "ok", "bad"];

// Lifecycle of a fix request on a finding.
const FIX_STATUSES = ["open", "requested", "done"];

function fileFor(domainId) {
  const safe = String(domainId).replace(/[^A-Za-z0-9._-]/g, "_") || "default";
  return userStore(EXT_NAME, `${safe}.json`);
}

function createInitialState(ctx) {
  return {
    domain: ctx?.input?.domain ?? "default",
    codebase: null,
    defaultLevel: DEFAULT_LEVEL,
    topics: [],
    findings: [],
    questions: [],
    refreshRequestedAt: null,
  };
}

const oneOf = (val, allowed, fallback) => (allowed.includes(val) ? val : fallback);
const str = (v) => (v == null ? "" : String(v));
const trimmed = (v) => str(v).trim();

// Normalize a free-form level (name or 0..3 index) onto the ladder.
function normLevel(v, fallback = DEFAULT_LEVEL) {
  if (v == null || v === "") return fallback;
  if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < LEVELS.length) return LEVELS[v];
  const s = String(v).toLowerCase().trim();
  if (LEVELS.includes(s)) return s;
  if (LEGACY_LEVELS[s]) return LEGACY_LEVELS[s]; // old grade names migrate forward
  // tolerate a few synonyms the agent (or a user) might use
  const alias = {
    "eli-5": "eli5",
    "explain like i'm 5": "eli5",
    kid: "eli5",
    child: "eli5",
    simple: "eli5",
    beginner: "curious",
    teen: "curious",
    layman: "curious",
    plain: "curious",
    college: "engineer",
    technical: "engineer",
    practitioner: "engineer",
    dev: "engineer",
    professional: "engineer",
    grad: "wizard",
    phd: "wizard",
    expert: "wizard",
    research: "wizard",
    deep: "wizard",
    geek: "wizard",
  };
  return alias[s] ?? fallback;
}

function normRef(r) {
  if (!r || typeof r !== "object") return null;
  const file = trimmed(r.file);
  if (!file) return null;
  const startLine = Number.isFinite(r.startLine) ? Math.max(1, r.startLine | 0) : null;
  const endLineRaw = Number.isFinite(r.endLine) ? Math.max(1, r.endLine | 0) : null;
  const endLine = endLineRaw && startLine ? Math.max(endLineRaw, startLine) : endLineRaw;
  return { file, startLine, endLine, note: trimmed(r.note) };
}

function normExplanations(obj) {
  const out = {};
  if (obj && typeof obj === "object") {
    for (const lvl of LEVELS) {
      const t = trimmed(obj[lvl]);
      if (t) out[lvl] = t;
    }
  }
  return out;
}

function findTopic(state, id) {
  return state.topics.find((t) => t.id === id) || null;
}

// A topic's concept key (explicit, else derived from its title). Used to share
// generic explanations across boards via the concept cache.
// Shared handler for the global reading-level setters (set_level + its
// back-compat alias set_default_level) so the two can't drift.
function setLevelHandler({ state, set, input }) {
  const level = normLevel(input.level, null);
  if (!level) throw new Error(`level must be one of ${LEVELS.join(", ")}`);
  set({ ...state, defaultLevel: level });
  return { status: `Reading level set to ${level}` };
}

const conceptKeyOf = (topic) => topic.conceptKey || conceptKeyFor(topic.title);

// ---- safe source reads for the "expand a code reference" feature -----------
const SNIPPET_MAX_BYTES = 2_000_000; // don't slurp huge files
const SNIPPET_MAX_LINES = 260; // cap a single returned window
const SNIPPET_PAD = 3; // context lines around the referenced range

// Is `target` the same as, or nested inside, `base`? Case-insensitive on Windows
// (so an in-root path with different drive/dir casing isn't wrongly rejected),
// case-sensitive elsewhere. `base + sep` defeats the sibling-prefix bug
// (C:\foo must not match C:\foobar).
const IS_WIN = process.platform === "win32";
function isInside(base, target) {
  let b = base;
  let t = target;
  if (IS_WIN) {
    b = b.toLowerCase();
    t = t.toLowerCase();
  }
  return t === b || t.startsWith(b + sep);
}

// Resolve a ref's file path to an absolute path that is provably inside the
// codebase root (or the process cwd when no root is set). Throws otherwise, so
// a malicious/typo'd path can't read arbitrary files off disk.
//
// Containment is UNCONDITIONAL: the resolved target must sit inside `base`
// whether the input was absolute or relative, and whether or not a root is set.
// (An earlier version exempted absolute paths in the no-root branch, which let a
// bare absolute path like C:\Users\me\.ssh\id_rsa escape entirely (CWE-22).
// NOTE: this is a LEXICAL guard; callers that actually read the file harden it
// against symlink escapes with a realpath re-check (see read_snippet).
function resolveInRoot(root, file) {
  const f = trimmed(file);
  if (!f) throw new Error("file is required");
  const base = resolve(root ? root : process.cwd());
  const target = isAbsolute(f) ? resolve(f) : resolve(base, f);
  if (!isInside(base, target)) {
    throw new Error(
      root
        ? "Refusing to read a path outside the codebase root."
        : "Refusing to read a path outside the working directory."
    );
  }
  return target;
}

// ---- code-change detection for "refresh analysis" --------------------------
// Code Tutor never re-analyzes on its own (analysis is the agent's job). Instead it
// fingerprints the code when analyzed, then compares on a timer so the UI can
// flag staleness and offer a one-click refresh the agent picks up.
const FP_IGNORE = new Set([
  ".git", "node_modules", "dist", "build", "out", ".next", ".turbo", "coverage",
  ".cache", "vendor", "target", ".venv", "__pycache__", ".idea", ".vscode", "bin", "obj",
]);

// Best-effort raw HEAD line (resolves a git worktree's gitdir pointer). Changes
// on branch switch; combined with mtimes it also reflects commits and edits.
async function gitHeadRaw(root) {
  try {
    const dotgit = join(root, ".git");
    let gitdir = dotgit;
    const st = await stat(dotgit).catch(() => null);
    if (st && !st.isDirectory()) {
      const txt = await readFile(dotgit, "utf8");
      const m = txt.match(/^gitdir:\s*(.+)$/m);
      if (m) gitdir = isAbsolute(m[1].trim()) ? m[1].trim() : resolve(root, m[1].trim());
    }
    return (await readFile(join(gitdir, "HEAD"), "utf8")).trim();
  } catch {
    return null;
  }
}

// Newest source-file mtime + file count, bounded so a huge repo can't hang us.
async function newestMtime(root, { fileCap = 6000, dirCap = 3000 } = {}) {
  let newest = 0;
  let files = 0;
  let dirs = 0;
  let partial = false;
  const stack = [root];
  while (stack.length) {
    if (files > fileCap || dirs > dirCap) {
      partial = true;
      break;
    }
    const dir = stack.pop();
    dirs++;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!FP_IGNORE.has(e.name) && !e.name.startsWith(".")) stack.push(join(dir, e.name));
      } else if (e.isFile()) {
        files++;
        try {
          const s = await stat(join(dir, e.name));
          if (s.mtimeMs > newest) newest = s.mtimeMs;
        } catch {
          /* skip unreadable entry */
        }
      }
    }
  }
  return { newest: Math.round(newest), files, partial };
}

// A compact fingerprint of the code's current state. Null when no root is set.
async function computeFingerprint(root) {
  if (!root) return null;
  const base = resolve(root);
  const [head, mt] = await Promise.all([gitHeadRaw(base), newestMtime(base)]);
  return `h:${head ?? ""}|m:${mt.newest}|n:${mt.files}${mt.partial ? "+" : ""}`;
}

// Forward-migrate a persisted board from the old 6-grade ladder to the 4-level
// ladder (and backfill fields added over time) so existing boards keep working.
function migrateLevelKey(k) {
  if (!k) return null;
  if (LEVELS.includes(k)) return k;
  return LEGACY_LEVELS[k] ?? null;
}
function remapExplanations(expl) {
  const out = {};
  for (const [k, v] of Object.entries(expl ?? {})) {
    const nk = migrateLevelKey(k);
    if (!nk || !v) continue;
    if (!out[nk] || String(v).length > String(out[nk]).length) out[nk] = v; // keep richer on collision
  }
  return out;
}
function migrateState(state) {
  if (!state || typeof state !== "object") return state;
  const topics = (state.topics ?? []).map((t) => {
    const explanations = remapExplanations(t.explanations);
    const cachedLevels = Array.from(new Set((t.cachedLevels ?? []).map(migrateLevelKey).filter(Boolean))).filter(
      (l) => explanations[l]
    );
    return {
      ...t,
      conceptKey: t.conceptKey || conceptKeyFor(t.title),
      explanations,
      cachedLevels,
      level: t.level ? migrateLevelKey(t.level) : null,
    };
  });
  const questions = (state.questions ?? []).map((q) => ({ ...q, level: q.level ? migrateLevelKey(q.level) : null }));
  return {
    ...state,
    topics,
    questions,
    defaultLevel: migrateLevelKey(state.defaultLevel) ?? DEFAULT_LEVEL,
  };
}

export const canvasConfig = {
  id: "code-tutor",
  displayName: "Code Tutor",
  description:
    "Turns the current codebase into a personal CS course: extracts the algorithms, data structures, " +
    "complexity and theory hiding in your code, explains each at an adjustable level (ELI5 → Wizard), " +
    "remembers your level and what you understand per topic, answers questions, and reviews the code's " +
    "good/ok/bad spots with a path to fix them.",
  assetsDir: fileURLToPath(new URL("./web/", import.meta.url)),

  inputSchema: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        description:
          "Which codebase/curriculum board to open (e.g. the repo or project name). " +
          "Omit for the default board.",
      },
    },
    additionalProperties: false,
  },

  resolveDomainId: (input) => (input?.domain ? String(input.domain) : "default"),

  createInitialState,
  loadState: async (domainId) => migrateState(await fileFor(domainId).load(null)),
  saveState: async (domainId, state) => fileFor(domainId).save(state),

  statusLine: (_ctx, state) => {
    const topics = state.topics ?? [];
    const got = topics.filter((t) => t.status === "understood").length;
    const issues = (state.findings ?? []).filter((f) => f.quality === "bad").length;
    const label = state.codebase?.label ? `${state.codebase.label} · ` : "";
    return `${label}${topics.length} topics · ${got} understood · ${issues} issue${issues === 1 ? "" : "s"}`;
  },

  actions: {
    // ---- agent authoring -------------------------------------------------

    set_codebase: {
      description:
        "Record metadata about the codebase being taught (call this first after analyzing the repo). " +
        "Sets the board's title card.",
      inputSchema: {
        type: "object",
        properties: {
          label: { type: "string", description: "Display name, e.g. the repo or project name." },
          root: { type: "string", description: "Absolute or repo-relative root path that was analyzed." },
          summary: { type: "string", description: "1-3 sentence overview of what the codebase does." },
          fileCount: { type: "number", description: "Approximate number of source files analyzed." },
          languages: {
            type: "array",
            description: "Primary languages/stacks detected.",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
      handler: async ({ state, set, input }) => {
        const root = trimmed(input.root) || state.codebase?.root || "";
        const codebase = {
          label: trimmed(input.label) || state.codebase?.label || "This codebase",
          root,
          summary: trimmed(input.summary) || state.codebase?.summary || "",
          fileCount: Number.isFinite(input.fileCount) ? Math.max(0, input.fileCount | 0) : state.codebase?.fileCount ?? null,
          languages: Array.isArray(input.languages)
            ? input.languages.map(trimmed).filter(Boolean)
            : state.codebase?.languages ?? [],
          scannedAt: new Date().toISOString(),
          fingerprint: await computeFingerprint(root),
        };
        // Functional set: `state` was captured BEFORE the long computeFingerprint
        // await, during which a concurrent handler (add_topic, set_level, ...) may
        // have committed. Merge into the CURRENT state so those writes aren't lost.
        // A fresh analysis clears any pending refresh request.
        set((cur) => ({ ...cur, codebase, refreshRequestedAt: null }));
        return { status: `Codebase set to "${codebase.label}"` };
      },
    },

    analysis_status: {
      description:
        "Report whether the code has changed since it was last analyzed. Recomputes the code fingerprint " +
        "(git HEAD + newest file mtime under the codebase root) and compares it to the one saved at analysis " +
        "time. The canvas polls this to show a freshness banner; the agent can call it to decide whether to " +
        "re-analyze. Read-only.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async ({ state }) => {
        const cb = state.codebase;
        const refreshRequested = !!state.refreshRequestedAt;
        if (!cb || !cb.root) {
          return { configured: false, stale: false, refreshRequested, scannedAt: cb?.scannedAt ?? null };
        }
        // A refresh is already pending; skip the (potentially expensive) full-tree
        // fingerprint walk - the banner already shows "refreshing" regardless.
        if (refreshRequested) {
          return { configured: true, stale: false, refreshRequested: true, scannedAt: cb.scannedAt ?? null, comparable: !!cb.fingerprint };
        }
        const current = await computeFingerprint(cb.root);
        const stale = !!cb.fingerprint && !!current && current !== cb.fingerprint;
        return {
          configured: true,
          stale,
          refreshRequested,
          scannedAt: cb.scannedAt ?? null,
          comparable: !!cb.fingerprint,
        };
      },
    },

    request_refresh: {
      description:
        "Flag that the learner wants the codebase re-analyzed (the canvas 'Refresh analysis' button calls " +
        "this). The agent picks it up via analysis_status, re-reads the code, and calls set_codebase again " +
        "plus add/update topics and findings (which clears the request).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: ({ state, set }) => {
        set({ ...state, refreshRequestedAt: new Date().toISOString() });
        return {
          status: "Refresh requested",
          prompt:
            "The Code Tutor canvas requested a re-analysis of this codebase. Please refresh it now: " +
            "open the Code Tutor canvas for this codebase, call analysis_status to confirm what changed, " +
            "re-read the relevant source, then call set_codebase to refresh the fingerprint and " +
            "add or update topics, code references, and findings to match the current code. " +
            "Keep existing topics' understanding/levels; only change what the code change affects.",
        };
      },
    },

    add_topic: {
      description:
        "Add a CS concept extracted from the codebase (an algorithm, data structure, complexity " +
        "result, theory, or design pattern). Include code references (file + line range) and as many " +
        "grade-level explanations as you can; missing levels can be filled later with set_explanation. " +
        "Generic (codebase-independent) explanations are saved to a shared concept library and reused " +
        "automatically - call lookup_explanation first to avoid regenerating ones already cached.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Concept name, e.g. 'Binary search' or 'LRU cache'." },
          conceptKey: {
            type: "string",
            description:
              "Canonical key for the concept's shared cache entry (e.g. 'binary-search'). " +
              "Omit to derive it from the title. Use a stable key to reuse cached explanations across repos.",
          },
          category: { type: "string", enum: CATEGORIES, description: "What kind of concept this is." },
          summary: { type: "string", description: "One-line description of the concept." },
          keyPoints: {
            type: "array",
            description: "Optional bullet takeaways.",
            items: { type: "string" },
          },
          refs: {
            type: "array",
            description: "Where this shows up in the code.",
            items: {
              type: "object",
              properties: {
                file: { type: "string", description: "Repo-relative file path." },
                startLine: { type: "number", description: "First line (1-based)." },
                endLine: { type: "number", description: "Last line (1-based)." },
                note: { type: "string", description: "Why this location matters." },
              },
              required: ["file"],
              additionalProperties: false,
            },
          },
          explanations: {
            type: "object",
            description: "Explanation text keyed by reading level.",
            properties: {
              eli5: { type: "string", description: "Explain like I'm 5 - plain analogy, no jargon." },
              curious: { type: "string", description: "Plain English for a smart non-expert." },
              engineer: { type: "string", description: "Technical depth for a working developer." },
              wizard: { type: "string", description: "Deep / theoretical - the geeky end." },
            },
            additionalProperties: false,
          },
          genericLevels: {
            type: "array",
            description:
              "Which provided levels are codebase-independent and safe to cache in the shared library. " +
              "Omit to auto-detect (levels whose text doesn't cite a specific file/line/function).",
            items: { type: "string", enum: LEVELS },
          },
        },
        required: ["title"],
        additionalProperties: false,
      },
      handler: async ({ state, set, input }) => {
        const title = trimmed(input.title);
        if (!title) throw new Error("title is required");
        const now = new Date().toISOString();
        const conceptKey = trimmed(input.conceptKey) || conceptKeyFor(title);
        const provided = normExplanations(input.explanations);

        // 1+2) Under a single cache lock: cache the generic explanations the
        // agent gave us, then auto-fill any missing level from the shared library
        // (read-after-write must see our own writes, and concurrent add_topic
        // bursts must not clobber each other - see mutateCache).
        const explicitGeneric = Array.isArray(input.genericLevels)
          ? input.genericLevels.filter((l) => LEVELS.includes(l))
          : null;
        const explanations = { ...provided };
        const cachedLevels = [];
        await mutateCache((cache) => {
          for (const lvl of LEVELS) {
            const text = provided[lvl];
            if (!text) continue;
            const isGeneric = explicitGeneric ? explicitGeneric.includes(lvl) : !looksCodebaseSpecific(text);
            if (isGeneric) putCached(cache, conceptKey, title, lvl, text);
          }
          // Auto-fill levels the agent didn't provide from the (now-updated) cache.
          for (const lvl of LEVELS) {
            if (explanations[lvl]) continue;
            const hit = getCached(cache, conceptKey, lvl);
            if (hit) {
              explanations[lvl] = hit;
              cachedLevels.push(lvl);
            }
          }
        });

        const topic = {
          id: nid(),
          title,
          conceptKey,
          category: oneOf(input.category, CATEGORIES, "theory"),
          summary: trimmed(input.summary),
          keyPoints: Array.isArray(input.keyPoints) ? input.keyPoints.map(trimmed).filter(Boolean) : [],
          refs: Array.isArray(input.refs) ? input.refs.map(normRef).filter(Boolean) : [],
          explanations,
          cachedLevels, // which levels were filled from the shared library
          level: null, // follows defaultLevel until the learner sets one
          status: "new",
          createdAt: now,
          updatedAt: now,
        };
        set((cur) => ({ ...cur, topics: [...cur.topics, topic] }));
        return {
          id: topic.id,
          conceptKey,
          reusedFromCache: cachedLevels,
          status: `Added topic "${topic.title}"${cachedLevels.length ? ` (reused ${cachedLevels.join(", ")} from the library)` : ""}`,
        };
      },
    },

    update_topic: {
      description:
        "Patch an existing topic in place WITHOUT touching the learner's progress. Use this on a refresh " +
        "to correct code references (e.g. line numbers that drifted), the summary, key points, category, " +
        "or title. Only the fields you pass are changed; status, level, explanations and cached levels are " +
        "preserved. To change explanation text use set_explanation instead.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Id of the topic to update." },
          title: { type: "string" },
          category: { type: "string", enum: CATEGORIES },
          summary: { type: "string" },
          keyPoints: { type: "array", items: { type: "string" } },
          refs: {
            type: "array",
            description: "Replaces the topic's code references entirely.",
            items: {
              type: "object",
              properties: {
                file: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
                note: { type: "string" },
              },
              required: ["file"],
              additionalProperties: false,
            },
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const topic = findTopic(state, input.id);
        if (!topic) throw new Error(`No topic with id ${input.id}`);
        const patch = { updatedAt: new Date().toISOString() };
        if (input.title !== undefined) patch.title = trimmed(input.title) || topic.title;
        if (input.category !== undefined) patch.category = oneOf(input.category, CATEGORIES, topic.category);
        if (input.summary !== undefined) patch.summary = trimmed(input.summary);
        if (input.keyPoints !== undefined)
          patch.keyPoints = Array.isArray(input.keyPoints) ? input.keyPoints.map(trimmed).filter(Boolean) : topic.keyPoints;
        if (input.refs !== undefined)
          patch.refs = Array.isArray(input.refs) ? input.refs.map(normRef).filter(Boolean) : topic.refs;
        set((cur) => ({
          ...cur,
          topics: cur.topics.map((t) => (t.id === input.id ? { ...t, ...patch } : t)),
        }));
        return { id: input.id, status: `Updated "${patch.title ?? topic.title}"` };
      },
    },

    set_explanation: {
      description:
        "Set or replace the explanation for a topic at one grade level. Use this to fill a level the " +
        "learner slid to that has no explanation yet, or to answer a level-specific request. Generic " +
        "explanations are saved to the shared concept library so other boards reuse them without an AI call.",
      inputSchema: {
        type: "object",
        properties: {
          topicId: { type: "string" },
          level: { type: "string", enum: LEVELS },
          text: { type: "string", description: "The explanation at this level. Empty clears it." },
          generic: {
            type: "boolean",
            description:
              "Force whether to cache this in the shared library. Omit to auto-detect (cache unless the " +
              "text cites a specific file/line/function in this repo).",
          },
        },
        required: ["topicId", "level", "text"],
        additionalProperties: false,
      },
      handler: async ({ state, set, input }) => {
        const level = normLevel(input.level, null);
        if (!level) throw new Error(`level must be one of ${LEVELS.join(", ")}`);
        const topic = findTopic(state, input.topicId);
        if (!topic) throw new Error(`No topic with id ${input.topicId}`);
        const text = trimmed(input.text);

        // Maintain the shared library under the cache lock: cache generic prose,
        // or drop the cached entry when the level is cleared OR re-authored as
        // codebase-specific (so the library stops serving the superseded generic
        // text to other boards - L5).
        const key = conceptKeyOf(topic);
        const shouldCache = text && (input.generic === true || (input.generic !== false && !looksCodebaseSpecific(text)));
        await mutateCache((cache) => {
          if (shouldCache) putCached(cache, key, topic.title, level, text);
          else dropCached(cache, key, level); // cleared, or now codebase-specific
        });

        set((cur) => ({
          ...cur,
          topics: cur.topics.map((t) => {
            if (t.id !== input.topicId) return t;
            const explanations = { ...t.explanations };
            if (text) explanations[level] = text;
            else delete explanations[level];
            // This level is now authored explicitly, so it's no longer "from cache".
            const cachedLevels = (t.cachedLevels ?? []).filter((l) => l !== level);
            return { ...t, explanations, cachedLevels, updatedAt: new Date().toISOString() };
          }),
        }));
        return { status: `${text ? "Set" : "Cleared"} ${level} explanation${shouldCache ? " (cached in library)" : ""}` };
      },
    },

    fill_from_cache: {
      description:
        "Try to fill a topic's explanation at a level from the shared concept library WITHOUT any AI call. " +
        "Returns { hit }. The canvas calls this before asking the tutor; the agent can use it to skip " +
        "regenerating a generic explanation that's already cached.",
      inputSchema: {
        type: "object",
        properties: {
          topicId: { type: "string" },
          level: { type: "string", enum: LEVELS },
        },
        required: ["topicId", "level"],
        additionalProperties: false,
      },
      handler: async ({ state, set, input }) => {
        const level = normLevel(input.level, null);
        if (!level) throw new Error(`level must be one of ${LEVELS.join(", ")}`);
        const topic = findTopic(state, input.topicId);
        if (!topic) throw new Error(`No topic with id ${input.topicId}`);
        const cache = await loadCache();
        const hit = getCached(cache, conceptKeyOf(topic), level);
        if (!hit) return { hit: false };
        set((cur) => ({
          ...cur,
          topics: cur.topics.map((t) =>
            t.id !== input.topicId
              ? t
              : {
                  ...t,
                  explanations: { ...t.explanations, [level]: hit },
                  cachedLevels: Array.from(new Set([...(t.cachedLevels ?? []), level])),
                  updatedAt: new Date().toISOString(),
                }
          ),
        }));
        return { hit: true, status: `Filled ${level} from the library` };
      },
    },

    read_snippet: {
      description:
        "Read the actual source lines for a code reference so the canvas can show them inline with syntax " +
        "highlighting. Resolves the path against the codebase root, returns a windowed slice around the " +
        "referenced lines. Read-only; the result is returned to the caller, not stored in board state.",
      inputSchema: {
        type: "object",
        properties: {
          file: { type: "string", description: "Repo-relative (or absolute) file path." },
          startLine: { type: "number", description: "First referenced line (1-based)." },
          endLine: { type: "number", description: "Last referenced line (1-based)." },
        },
        required: ["file"],
        additionalProperties: false,
      },
      handler: async ({ state, input }) => {
        const root = state.codebase?.root;
        const target = resolveInRoot(root, input.file);
        // Symlink hardening: the lexical guard can be defeated by a symlink that
        // lives inside the root but points outside it. Resolve real paths and
        // re-check containment before reading (small TOCTOU window accepted).
        const base = resolve(root ? root : process.cwd());
        let real = target;
        try {
          real = await realpath(target);
        } catch {
          real = target; // doesn't exist yet / not a link; readFile reports below
        }
        if (real !== target) {
          const realBase = await realpath(base).catch(() => base);
          if (!isInside(base, real) && !isInside(realBase, real)) {
            throw new Error("Refusing to read a path that resolves outside the codebase root.");
          }
        }
        let content;
        try {
          content = await readFile(real, "utf8");
        } catch (err) {
          throw new Error(
            `Couldn't read ${input.file}: ${err.code === "ENOENT" ? "file not found (is the codebase root set?)" : err.message}`
          );
        }
        if (content.length > SNIPPET_MAX_BYTES) content = content.slice(0, SNIPPET_MAX_BYTES);
        const all = content.split(/\r?\n/);
        const total = all.length;

        const start = Number.isFinite(input.startLine) ? Math.max(1, input.startLine | 0) : null;
        const end = Number.isFinite(input.endLine) ? Math.max(start || 1, input.endLine | 0) : start;

        let from = start ? Math.max(1, start - SNIPPET_PAD) : 1;
        let to = end ? Math.min(total, end + SNIPPET_PAD) : Math.min(total, from + SNIPPET_MAX_LINES - 1);
        let truncated = false;
        if (to - from + 1 > SNIPPET_MAX_LINES) {
          to = from + SNIPPET_MAX_LINES - 1;
          truncated = true;
        }

        return {
          file: input.file,
          fromLine: from,
          lines: all.slice(from - 1, to),
          focusStart: start ?? 0,
          focusEnd: end ?? 0,
          total,
          truncated,
        };
      },
    },

    add_finding: {
      description:
        "Record a code-quality observation about the codebase: a strength (good), a so-so spot (ok), " +
        "or a real problem (bad) such as a perf issue, a wrong data structure, or an incorrect/" +
        "suboptimal algorithm. Provide a fixPrompt the learner can run in a new session to fix a 'bad' one.",
      inputSchema: {
        type: "object",
        properties: {
          quality: { type: "string", enum: QUALITIES, description: "good | ok | bad." },
          title: { type: "string", description: "Short headline for the observation." },
          detail: { type: "string", description: "What it is and why it matters." },
          topicId: { type: "string", description: "Optional id of the related topic." },
          file: { type: "string", description: "Repo-relative file path." },
          startLine: { type: "number", description: "First line (1-based)." },
          endLine: { type: "number", description: "Last line (1-based)." },
          suggestion: { type: "string", description: "How it could be improved." },
          fixPrompt: {
            type: "string",
            description: "A ready-to-run prompt for a new session that would fix this (for 'bad'/'ok').",
          },
        },
        required: ["quality", "title"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const title = trimmed(input.title);
        if (!title) throw new Error("title is required");
        const ref = normRef({ file: input.file, startLine: input.startLine, endLine: input.endLine });
        const now = new Date().toISOString();
        const finding = {
          id: nid(),
          quality: oneOf(input.quality, QUALITIES, "ok"),
          title,
          detail: trimmed(input.detail),
          topicId: input.topicId && findTopic(state, input.topicId) ? input.topicId : null,
          file: ref?.file ?? "",
          startLine: ref?.startLine ?? null,
          endLine: ref?.endLine ?? null,
          suggestion: trimmed(input.suggestion),
          fixPrompt: trimmed(input.fixPrompt),
          fixStatus: "open",
          createdAt: now,
          updatedAt: now,
        };
        set({ ...state, findings: [finding, ...state.findings] });
        return { id: finding.id, status: `Added ${finding.quality} finding "${finding.title}"` };
      },
    },

    answer_question: {
      description:
        "Answer a learner question (find pending ones with list_questions). For a question that asks " +
        "to explain a topic at a level, prefer set_explanation; use this for free-form clarifications.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          answer: { type: "string" },
        },
        required: ["id", "answer"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const answer = trimmed(input.answer);
        if (!answer) throw new Error("answer is required");
        let found = false;
        const questions = state.questions.map((q) => {
          if (q.id !== input.id) return q;
          found = true;
          return { ...q, answer, answeredAt: new Date().toISOString() };
        });
        if (!found) throw new Error(`No question with id ${input.id}`);
        set({ ...state, questions });
        return { status: "Answer posted" };
      },
    },

    // ---- learner / UI (also callable by the agent) -----------------------

    set_topic_status: {
      description:
        "Set how well the learner understands a topic: 'understood', 'confused' (not understood), " +
        "'revisit' (come back later), or 'new' (unmarked).",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: STATUSES },
        },
        required: ["id", "status"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        let found = false;
        const topics = state.topics.map((t) => {
          if (t.id !== input.id) return t;
          found = true;
          return { ...t, status: oneOf(input.status, STATUSES, t.status), updatedAt: new Date().toISOString() };
        });
        if (!found) throw new Error(`No topic with id ${input.id}`);
        set({ ...state, topics });
        return { status: `Marked ${input.status}` };
      },
    },

    set_level: {
      description:
        "Set the single global reading level for the whole course (eli5, curious, engineer, wizard). " +
        "Every topic is explained at this level. The header slider calls this.",
      inputSchema: {
        type: "object",
        properties: { level: { type: "string", enum: LEVELS } },
        required: ["level"],
        additionalProperties: false,
      },
      handler: setLevelHandler,
    },

    // Back-compat alias: older UI/agents called this; it maps to set_level.
    set_default_level: {
      description: "Alias for set_level (sets the single global reading level).",
      inputSchema: {
        type: "object",
        properties: { level: { type: "string", enum: LEVELS } },
        required: ["level"],
        additionalProperties: false,
      },
      handler: setLevelHandler,
    },

    ask_question: {
      description:
        "Ask a question or request a clarification about a topic (the learner usually does this from the " +
        "canvas; it lands as a pending question the agent answers with answer_question or set_explanation).",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "The question." },
          topicId: { type: "string", description: "Optional id of the topic it's about." },
          level: { type: "string", enum: LEVELS, description: "Optional grade level the answer should target." },
        },
        required: ["text"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const text = trimmed(input.text);
        if (!text) throw new Error("text is required");
        const q = {
          id: nid(),
          text,
          topicId: input.topicId && findTopic(state, input.topicId) ? input.topicId : null,
          level: input.level ? normLevel(input.level, null) : null,
          answer: null,
          createdAt: new Date().toISOString(),
          answeredAt: null,
        };
        set({ ...state, questions: [q, ...state.questions] });
        return { id: q.id, status: "Question posted - the tutor will answer it" };
      },
    },

    set_fix_status: {
      description:
        "Update a finding's fix lifecycle: 'requested' (the learner wants a fix session), 'done', or " +
        "'open'. The canvas 'Request fix' button calls this with 'requested'; the agent can then pick it " +
        "up via list_findings and start a real fix session.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: FIX_STATUSES },
        },
        required: ["id", "status"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        let fixPrompt = "";
        let found = false;
        const findings = state.findings.map((f) => {
          if (f.id !== input.id) return f;
          found = true;
          fixPrompt = f.fixPrompt;
          return { ...f, fixStatus: oneOf(input.status, FIX_STATUSES, f.fixStatus), updatedAt: new Date().toISOString() };
        });
        if (!found) throw new Error(`No finding with id ${input.id}`);
        set({ ...state, findings });
        return { status: `Fix ${input.status}`, fixPrompt };
      },
    },

    remove_topic: {
      description: "Delete a topic from the curriculum (also removes its questions).",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const topics = state.topics.filter((t) => t.id !== input.id);
        const findings = state.findings.map((f) => (f.topicId === input.id ? { ...f, topicId: null } : f));
        const questions = state.questions.filter((q) => q.topicId !== input.id);
        set({ ...state, topics, findings, questions });
        return { removed: state.topics.length - topics.length };
      },
    },

    remove_finding: {
      description: "Delete a code-quality finding.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const findings = state.findings.filter((f) => f.id !== input.id);
        set({ ...state, findings });
        return { removed: state.findings.length - findings.length };
      },
    },

    remove_question: {
      description: "Delete a question from the board.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const questions = state.questions.filter((q) => q.id !== input.id);
        set({ ...state, questions });
        return { removed: state.questions.length - questions.length };
      },
    },

    reset: {
      description: "Clear the entire board (codebase, topics, findings, questions) back to empty.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: ({ state, set }) => {
        set({ ...createInitialState({ input: { domain: state.domain } }), defaultLevel: state.defaultLevel });
        return { status: "Board cleared" };
      },
    },

    // ---- agent read-back -------------------------------------------------

    list_topics: {
      description: "Return a text summary of the curriculum (for the agent): each topic's status and which reading-level explanations exist.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: STATUSES, description: "Filter to one understanding status." },
        },
        additionalProperties: false,
      },
      handler: ({ state, input }) => {
        let topics = state.topics;
        if (input.status) topics = topics.filter((t) => t.status === input.status);
        if (!topics.length) return { summary: "No topics yet.", count: 0 };
        const summary = topics
          .map((t) => {
            const have = LEVELS.filter((l) => t.explanations[l]);
            const missing = LEVELS.filter((l) => !t.explanations[l]);
            return (
              `- [${t.status}] ${t.title} (${t.category})\n` +
              `    summary: ${t.summary || "-"}\n` +
              `    explanations: have=${have.join(",") || "none"}; missing=${missing.join(",") || "none"}\n` +
              `    id: ${t.id}`
            );
          })
          .join("\n");
        return { count: topics.length, summary };
      },
    },

    list_questions: {
      description: "Return the learner's questions (for the agent) so it can answer them. Defaults to only-pending.",
      inputSchema: {
        type: "object",
        properties: {
          includeAnswered: { type: "boolean", description: "Include already-answered questions (default false)." },
        },
        additionalProperties: false,
      },
      handler: ({ state, input }) => {
        let qs = state.questions;
        if (!input.includeAnswered) qs = qs.filter((q) => !q.answer);
        if (!qs.length) return { summary: "No questions.", count: 0 };
        const summary = qs
          .map((q) => {
            const t = q.topicId ? findTopic(state, q.topicId) : null;
            const about = t ? ` about "${t.title}"` : "";
            const lvl = q.level ? ` @${q.level}` : "";
            const ans = q.answer ? `\n    answered: ${q.answer}` : "\n    (pending)";
            return `- ${q.text}${about}${lvl}${ans}\n    id: ${q.id}${t ? `  topicId: ${t.id}` : ""}`;
          })
          .join("\n");
        return { count: qs.length, summary };
      },
    },

    list_findings: {
      description: "Return code-quality findings (for the agent). Filter by quality or fix status; use fixStatus='requested' to pick up fixes the learner asked for.",
      inputSchema: {
        type: "object",
        properties: {
          quality: { type: "string", enum: QUALITIES },
          fixStatus: { type: "string", enum: FIX_STATUSES },
        },
        additionalProperties: false,
      },
      handler: ({ state, input }) => {
        let fs = state.findings;
        if (input.quality) fs = fs.filter((f) => f.quality === input.quality);
        if (input.fixStatus) fs = fs.filter((f) => f.fixStatus === input.fixStatus);
        if (!fs.length) return { summary: "No findings.", count: 0 };
        const summary = fs
          .map((f) => {
            const loc = f.file ? ` [${f.file}${f.startLine ? `:${f.startLine}${f.endLine ? `-${f.endLine}` : ""}` : ""}]` : "";
            const fix = f.fixPrompt ? `\n    fixPrompt: ${f.fixPrompt}` : "";
            return `- (${f.quality}/${f.fixStatus}) ${f.title}${loc}\n    ${f.detail || "-"}${fix}\n    id: ${f.id}`;
          })
          .join("\n");
        return { count: fs.length, summary };
      },
    },

    lookup_explanation: {
      description:
        "Check the shared concept library for an already-cached generic explanation BEFORE generating one. " +
        "Give a conceptKey (or a title to derive it). Returns the cached text for a level, or which levels " +
        "are cached. Use this to avoid re-asking the model for a generic explanation that already exists.",
      inputSchema: {
        type: "object",
        properties: {
          conceptKey: { type: "string", description: "Canonical concept key (e.g. 'binary-search')." },
          title: { type: "string", description: "Concept title to derive the key from if conceptKey is omitted." },
          level: { type: "string", enum: LEVELS, description: "A specific level to fetch; omit for all cached levels." },
        },
        additionalProperties: false,
      },
      handler: async ({ input }) => {
        const key = trimmed(input.conceptKey) || (input.title ? conceptKeyFor(input.title) : "");
        if (!key) throw new Error("conceptKey or title is required");
        const cache = await loadCache();
        if (input.level) {
          const level = normLevel(input.level, null);
          const text = getCached(cache, key, level);
          return { conceptKey: key, level, hit: !!text, text: text ?? null };
        }
        const have = cachedLevelsFor(cache, key);
        return { conceptKey: key, cachedLevels: have, hit: have.length > 0 };
      },
    },

    list_cache: {
      description: "List the shared concept library (for the agent): which concepts have cached generic explanations and at which levels.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => {
        const cache = await loadCache();
        const entries = Object.entries(cache.concepts ?? {});
        if (!entries.length) return { summary: "Concept library is empty.", count: 0 };
        const summary = entries
          .map(([key, c]) => `- ${c.title || key} (${key}): ${Object.keys(c.levels ?? {}).join(", ") || "none"}`)
          .join("\n");
        return { count: entries.length, summary };
      },
    },

    clear_cache: {
      description: "Remove cached explanations from the shared concept library - one concept (by conceptKey), or all of it.",
      inputSchema: {
        type: "object",
        properties: {
          conceptKey: { type: "string", description: "Concept to drop. Omit to clear the entire library." },
          level: { type: "string", enum: LEVELS, description: "Drop only this level of the concept." },
        },
        additionalProperties: false,
      },
      handler: async ({ input }) => {
        // L4: an out-of-enum level must NOT silently fall through to deleting the
        // whole concept (the kit does no schema validation). Reject it instead.
        let level = null;
        if (input.level !== undefined) {
          level = normLevel(input.level, null);
          if (!level) throw new Error(`level must be one of ${LEVELS.join(", ")}`);
        }
        if (!input.conceptKey) {
          await saveCache({ concepts: {} });
          return { status: "Cleared the entire concept library" };
        }
        const key = trimmed(input.conceptKey);
        await mutateCache((cache) => dropCached(cache, key, level));
        return { status: `Dropped ${level ? `${level} of ` : ""}${key} from the library` };
      },
    },
  },
};
