// cache.mjs - a cross-board "concept library" so generic explanations are
// authored by the AI once and reused forever (SDK-free; safe to unit-test).
//
// Why: an explanation like "linear search, explained for a 5-year-old" is
// codebase-independent - the same words work in any repo. Regenerating it on
// every board wastes an AI round-trip. This module persists generic
// explanations keyed by (conceptKey, level) in ONE shared file, separate from
// the per-board state, so any board can fill a known concept's generic levels
// instantly with no AI call.
//
// Codebase-SPECIFIC explanations (ones that cite a file, a line, or a function
// in this repo) are deliberately NOT cached - `looksCodebaseSpecific` is the
// heuristic that keeps repo-specific prose out of the shared library.

import { userStore } from "./canvas-kit/storage.mjs";

const EXT_NAME = "code-tutor";
const CACHE_FILE = "_concept-cache.json";
const store = userStore(EXT_NAME, CACHE_FILE);

// Old 6-grade ladder -> new 4-level ladder. Exported so canvas.mjs shares one
// source of truth when migrating board state + normalizing agent input.
export const LEGACY_LEVELS = {
  elementary: "eli5",
  middle: "curious",
  high: "curious",
  undergrad: "engineer",
  graduate: "wizard",
  doctorate: "wizard",
};

/** Normalize a concept title into a stable, shareable key (e.g. "Binary Search!" -> "binary-search"). */
export function conceptKeyFor(s) {
  return (
    String(s ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "concept"
  );
}

/**
 * Heuristic: does this explanation reference *this specific codebase* (a file,
 * a line number, a function/method call, or a camelCase/PascalCase identifier)
 * rather than the concept in general? Such text must not enter the shared cache.
 *
 * Default is to treat text as GENERIC (cacheable) unless one of these positive
 * signals fires. The signals are deliberately broad (any code-shaped token marks
 * the text specific) to keep repo-specific prose out of the cross-board library;
 * callers that know better can still force caching via an explicit `generic` flag.
 */
export function looksCodebaseSpecific(text) {
  const t = String(text ?? "");
  return (
    /\.(mjs|cjs|js|ts|jsx|tsx|py|go|rs|rb|java|kt|c|cc|cpp|h|hpp|cs|php|swift|scala|json|ya?ml|toml|css|scss|html?)\b/i.test(t) ||
    /:\d{1,6}\b/.test(t) ||
    /\b[A-Za-z_]\w*\([^)]*\)/.test(t) || // a foo() / foo(args) call reference
    /\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b/.test(t) || // a camelCase identifier (locate, handleRefresh)
    /\b[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*\b/.test(t) || // a PascalCase type (CanvasKitError)
    /\b(this (?:code|repo|repository|codebase|project|file|module|function|class)|in the codebase|in this repo|in this file)\b/i.test(t)
  );
}

export async function loadCache() {
  const c = await store.load(null);
  return migrateCache(c && c.concepts ? c : { concepts: {} });
}

// Serialize read-modify-write of the SHARED concept-cache file within this
// process. Without it, concurrent writers (e.g. the agent bursting add_topic
// during analysis) each load the same snapshot and the last saveCache wins,
// silently dropping the others' entries. `fn` receives the freshly-loaded cache,
// may mutate AND read it, and its return value is forwarded to the caller.
// (Cross-process races on the same file across sessions are out of scope; this
// guards the common in-process burst.)
let cacheChain = Promise.resolve();
export function mutateCache(fn) {
  const run = cacheChain.then(async () => {
    const cache = await loadCache();
    const result = await fn(cache);
    await saveCache(cache);
    return result;
  });
  cacheChain = run.then(
    () => {},
    () => {}
  );
  return run;
}

// Remap any legacy grade-level keys in cached concepts onto the 4-level ladder.
// Keeps the longer text when two old levels collapse to the same new one.
function migrateCache(cache) {
  for (const key of Object.keys(cache.concepts ?? {})) {
    const levels = cache.concepts[key].levels ?? {};
    let changed = false;
    const out = {};
    for (const [k, entry] of Object.entries(levels)) {
      const nk = LEGACY_LEVELS[k] ?? k;
      if (nk !== k) changed = true;
      if (!out[nk] || String(entry?.text ?? "").length > String(out[nk]?.text ?? "").length) out[nk] = entry;
    }
    if (changed) cache.concepts[key].levels = out;
  }
  return cache;
}

export async function saveCache(cache) {
  await store.save(cache && cache.concepts ? cache : { concepts: {} });
}

/** Read one cached explanation, or null on a miss. */
export function getCached(cache, key, level) {
  return cache?.concepts?.[key]?.levels?.[level]?.text ?? null;
}

/** Which levels are cached for a concept key. */
export function cachedLevelsFor(cache, key) {
  const levels = cache?.concepts?.[key]?.levels;
  return levels ? Object.keys(levels) : [];
}

/** Write one explanation into the cache (mutates + returns the cache object). */
export function putCached(cache, key, title, level, text) {
  const c = cache && cache.concepts ? cache : { concepts: {} };
  const concept = c.concepts[key] || (c.concepts[key] = { title: title || key, levels: {} });
  if (title) concept.title = title;
  concept.levels[level] = { text, updatedAt: new Date().toISOString() };
  return c;
}

/** Remove a concept (or one of its levels) from the cache. */
export function dropCached(cache, key, level) {
  if (!cache?.concepts?.[key]) return cache;
  if (level) {
    delete cache.concepts[key].levels?.[level];
    if (!Object.keys(cache.concepts[key].levels ?? {}).length) delete cache.concepts[key];
  } else {
    delete cache.concepts[key];
  }
  return cache;
}
