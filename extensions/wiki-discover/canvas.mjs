// canvas.mjs — Wiki Discover canvas definition (data template; kit config; SDK-free).
//
// A "for you" random Wikipedia reader with TWO preference signals:
//   1. Explicit INTERESTS the user picks (curated list) or free-form types. These
//      both seed the ranking (a strong match bonus) AND steer fetching — when set,
//      candidates are pulled from Wikipedia search on those terms, not just random.
//   2. Implicit FEEDBACK: each article gets thumbs up / "meh" / not-for-me, which
//      nudges a per-topic weight model (up = +1, meh = small −, down = −1).
//
// Articles are pulled as a candidate POOL, scored against interests + weights, and
// the highest-scoring unseen one is surfaced next. The agent and the user share the
// same state and the same handlers.
//
// Where things live:
//   * fetch() goes in the HANDLER/helper here — NEVER in the view.
//   * always set a timeout (AbortSignal.timeout) so a slow upstream can't hang.
//   * rating/interest edits are SYNCHRONOUS and offline-testable; only next_article
//     touches the network (the view triggers it on load and when the queue runs low).

import { fileURLToPath } from "node:url";
import { userStore } from "./canvas-kit/storage.mjs";

const EXT_NAME = "wiki-discover";

// How many random candidates to pull per network refill. Wikipedia has millions
// of articles, so a pool of this size almost always contains unseen entries.
const POOL_SIZE = 12;
// Per interest search query, how many topical results to pull.
const SEARCH_SIZE = 10;
// How many of the user's interests to query on a single refill (sampled), so a
// long interest list stays fast and varied.
const SEARCH_INTERESTS = 3;
// CirrusSearch query-independent ranking profile. "wsum_inclinks_pv" keeps
// results on-topic while weighting by incoming links + page views, so topic
// searches surface POPULAR articles (not obscure stubs). The stronger
// "popular_*" profiles drift off-topic, so we deliberately avoid them.
const SEARCH_PROFILE = "wsum_inclinks_pv";
// Refill the candidate pool once it drops below this many entries.
const QUEUE_MIN = 4;
// Cap the dedupe + history lists so durable state can't grow without bound.
const SEEN_CAP = 800;
const HISTORY_CAP = 200;
const MAX_INTERESTS = 40;

// Bonus added to an article's score for each explicit interest it matches. Set
// well above a single thumbs-up so chosen interests clearly dominate ranking.
const INTEREST_MATCH = 3;

// Feedback deltas. "meh" is a GENTLE negative — the user doesn't dislike it, they
// just aren't that interested — so it nudges far less than a real thumbs-down.
const DELTAS = { up: 1, meh: -0.34, down: -1 };

function fileFor(profileId) {
  const safe = String(profileId).replace(/[^A-Za-z0-9._-]/g, "_") || "default";
  return userStore(EXT_NAME, `${safe}.json`);
}

// --- preference model -------------------------------------------------------

// Common English words that carry no topical signal — dropped before learning.
const STOPWORDS = new Set(
  ("the a an and or but of to in on at for with from by as is are was were be been being this that these those " +
    "it its he she they them his her their our your my we you who whom which what when where why how " +
    "not no nor so than then there here over under into out up down off above below between among also more most " +
    "such only own same too very can will just should now about after before during while because each " +
    "other some any all both few many one two three first second new old known used including various within")
    .split(/\s+/),
);

// Turn free text into deduped, lowercased, significant tokens. The Wikipedia
// `description` field (e.g. "species of plant", "American politician") is the
// strongest topical signal; titles add a little more. We keep it small so a
// single article doesn't flood the model with noise.
function tokenize(text, limit = 10) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text || "").toLowerCase().split(/[^a-z0-9]+/)) {
    const tok = raw.trim();
    if (tok.length < 3 || tok.length > 24) continue;
    if (STOPWORDS.has(tok)) continue;
    if (/^\d+$/.test(tok)) continue; // bare years/numbers aren't a topic
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
    if (out.length >= limit) break;
  }
  return out;
}

// Significant tokens for an article: description tokens lead (best signal),
// padded with a couple of title tokens.
function tokensFor(article) {
  if (Array.isArray(article?.tokens) && article.tokens.length) return article.tokens;
  const desc = tokenize(article?.description, 8);
  const title = tokenize(article?.title, 6);
  const merged = [];
  const seen = new Set();
  for (const t of [...desc, ...title]) {
    if (seen.has(t)) continue;
    seen.add(t);
    merged.push(t);
    if (merged.length >= 10) break;
  }
  return merged;
}

function normalizeInterest(raw) {
  return String(raw || "").replace(/\s+/g, " ").trim().slice(0, 40);
}

// Which of the user's interests an article matches: an interest hits when its
// whole phrase appears in the article text, or any of its tokens is one of the
// article's significant tokens.
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function interestMatches(article, interests) {
  if (!interests || !interests.length) return [];
  const text = `${article.title || ""} ${article.description || ""} ${article.extract || ""}`.toLowerCase();
  const artTokens = new Set(tokensFor(article));
  const matched = [];
  for (const it of interests) {
    const phrase = String(it).toLowerCase().trim();
    if (phrase.length < 2) continue;
    const toks = tokenize(phrase, 6);
    // Whole-phrase match uses word boundaries so a short interest ("UK", "AI")
    // counts without matching substrings inside unrelated words (e.g. "us" in
    // "house"), which a bare `includes` would do.
    const phraseHit = new RegExp(`\\b${escapeRegExp(phrase)}\\b`).test(text);
    if (phraseHit || toks.some((t) => artTokens.has(t))) matched.push(it);
  }
  return matched;
}

// How well an article matches everything we know: explicit interests (big bonus)
// plus the implicitly-learned token weights.
function scoreArticle(article, weights, interests) {
  const w = weights || {};
  let s = 0;
  for (const t of tokensFor(article)) s += w[t] || 0;
  s += interestMatches(article, interests).length * INTEREST_MATCH;
  return Math.round(s * 100) / 100;
}

function dedupeById(list) {
  const seen = new Set();
  const out = [];
  for (const a of list) {
    if (!a || a.id == null || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

// Re-rank a candidate pool against the latest interests + weights, dropping
// anything already seen or currently on screen. Each entry is annotated with its
// score and the interests it matched (for the view). Highest match first.
function rankQueue(queue, weights, excludeIds, interests) {
  const exclude = excludeIds instanceof Set ? excludeIds : new Set(excludeIds || []);
  return dedupeById(queue)
    .filter((a) => !exclude.has(a.id))
    .map((a) => ({
      ...a,
      tokens: tokensFor(a),
      matched: interestMatches(a, interests),
      score: scoreArticle(a, weights, interests),
    }))
    .sort((a, b) => b.score - a.score);
}

// --- wikipedia source -------------------------------------------------------

function langCode(lang) {
  return /^[a-z-]{2,12}$/.test(String(lang)) ? String(lang) : "en";
}

const COMMON_PARAMS = {
  prop: "extracts|description|pageimages|info|pageprops",
  ppprop: "disambiguation",
  exintro: "1",
  explaintext: "1",
  exchars: "420",
  piprop: "thumbnail",
  pithumbsize: "240",
  inprop: "url",
  format: "json",
  origin: "*",
};

function randomEndpoint(lang) {
  const params = new URLSearchParams({
    ...COMMON_PARAMS,
    action: "query",
    generator: "random",
    grnnamespace: "0",
    grnlimit: String(POOL_SIZE),
  });
  return `https://${langCode(lang)}.wikipedia.org/w/api.php?${params.toString()}`;
}

function searchEndpoint(lang, term) {
  const params = new URLSearchParams({
    ...COMMON_PARAMS,
    action: "query",
    generator: "search",
    gsrsearch: String(term),
    gsrnamespace: "0",
    gsrlimit: String(SEARCH_SIZE),
    gsrqiprofile: SEARCH_PROFILE, // rank topical results by popularity (views + inlinks)
    gsroffset: String(Math.floor(Math.random() * 10)), // a little variety across refills
  });
  return `https://${langCode(lang)}.wikipedia.org/w/api.php?${params.toString()}`;
}

function isDisambiguation(p) {
  if (p?.pageprops && "disambiguation" in p.pageprops) return true;
  return /\(disambiguation\)/i.test(String(p?.title || ""));
}

function mapPages(data, lang) {
  const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
  return pages
    .filter((p) => p && p.title && (p.extract || p.description) && !isDisambiguation(p))
    .map((p) => {
      const article = {
        id: String(p.pageid),
        title: String(p.title),
        description: p.description ? String(p.description) : "",
        extract: String(p.extract || "").trim(),
        url: String(
          p.fullurl || p.canonicalurl || `https://${langCode(lang)}.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
        ),
        thumbnail: p.thumbnail?.source ? String(p.thumbnail.source) : "",
        lang: String(lang),
      };
      article.tokens = tokensFor(article);
      return article;
    });
}

function sample(arr, n) {
  const copy = [...(arr || [])];
  const out = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  return out;
}

async function fetchJson(url) {
  // Server-side fetch of a source WE control (Wikipedia). Treat the returned
  // text as untrusted: it is only ever rendered as TEXT in the view, never HTML.
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "copilot-canvas-wiki-discover/1.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Build the candidate pool. With interests set, pull POPULAR topical articles by
// searching a sample of them (ranked by views + incoming links) — no random
// filler, so the feed stays on-topic. Without interests, fall back to random
// discovery. A thin interest result is topped up with a random batch so the
// queue never starves.
async function fetchCandidates(lang, interests) {
  const hasInterests = Array.isArray(interests) && interests.length > 0;
  const urls = hasInterests
    ? sample(interests, SEARCH_INTERESTS).map((term) => searchEndpoint(lang, term))
    : [randomEndpoint(lang)];

  const settled = await Promise.allSettled(urls.map(fetchJson));
  const ok = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (!ok.length) {
    const firstErr = settled.find((r) => r.status === "rejected");
    throw new Error(firstErr ? String(firstErr.reason?.message ?? firstErr.reason) : "no data");
  }

  let all = [];
  for (const data of ok) all.push(...mapPages(data, lang));
  all = dedupeById(all);

  if (hasInterests && all.length < QUEUE_MIN) {
    try {
      all = dedupeById([...all, ...mapPages(await fetchJson(randomEndpoint(lang)), lang)]);
    } catch {
      /* random top-up is best-effort */
    }
  }
  return all;
}

// Article images, via the REST media-list endpoint. Returns the in-article
// content images (filtered to gallery images) with their captions and a
// ready-to-use thumbnail URL — much cleaner than the raw `prop=images` list.
const MAX_IMAGES = 8;

function mediaEndpoint(lang, title) {
  const t = encodeURIComponent(String(title).replace(/ /g, "_"));
  return `https://${langCode(lang)}.wikipedia.org/api/rest_v1/page/media-list/${t}`;
}

function mapMedia(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const out = [];
  const seen = new Set();
  for (const it of items) {
    if (it?.type !== "image" || it.showInGallery === false) continue;
    const best = Array.isArray(it.srcset) ? it.srcset[0] : null;
    if (!best?.src) continue;
    const src = best.src.startsWith("//") ? `https:${best.src}` : String(best.src);
    // Defense-in-depth: only accept https image URLs so a hostile media-list
    // entry can't smuggle a javascript:/data: scheme into the gallery <img>/<a>.
    if (!src.startsWith("https://")) continue;
    if (seen.has(src)) continue;
    seen.add(src);
    out.push({ src, caption: it.caption?.text ? String(it.caption.text) : "" });
    if (out.length >= MAX_IMAGES) break;
  }
  return out;
}

async function fetchImages(lang, title) {
  return mapMedia(await fetchJson(mediaEndpoint(lang, title)));
}

export const canvasConfig = {
  id: "wiki-discover",
  displayName: "Wiki Discover",
  description:
    "Discover Wikipedia articles tuned to you: pick interests to get popular articles on " +
    "those topics, or thumbs up / meh / down each one, and it learns what you'll find interesting.",
  assetsDir: fileURLToPath(new URL("./web/", import.meta.url)),

  // Personal preference profile (keyed by identity, not topic): two people with
  // different `profile`s build independent taste models.
  inputSchema: {
    type: "object",
    properties: {
      profile: {
        type: "string",
        description: "Personal reading profile to open. Omit for the default profile.",
      },
    },
    additionalProperties: false,
  },

  resolveDomainId: (input) => (input?.profile ? String(input.profile) : "default"),

  createInitialState: (ctx) => ({
    profile: ctx?.input?.profile ?? "default",
    lang: "en",
    interests: [],
    current: null,
    queue: [],
    liked: [],
    disliked: [],
    seenIds: [],
    weights: {},
    stats: { rated: 0, liked: 0, meh: 0, disliked: 0 },
    error: null,
    lastRefresh: null,
  }),

  // Backfill any fields added in newer versions so a profile saved by an older
  // build can't leave a handler reading `undefined.some(...)`.
  loadState: async (domainId) => {
    const saved = await fileFor(domainId).load(null);
    if (!saved) return null;
    return {
      lang: "en",
      interests: [],
      current: null,
      queue: [],
      liked: [],
      disliked: [],
      seenIds: [],
      weights: {},
      error: null,
      lastRefresh: null,
      ...saved,
      stats: { rated: 0, liked: 0, meh: 0, disliked: 0, ...(saved.stats || {}) },
    };
  },
  saveState: async (domainId, state) => fileFor(domainId).save(state),

  statusLine: (_ctx, state) => {
    const interests = state.interests?.length ?? 0;
    const liked = state.stats?.liked ?? 0;
    return `${interests} interest${interests === 1 ? "" : "s"} · ${liked} liked`;
  },

  actions: {
    // Network action: refill the candidate pool when it runs low (random +
    // interest searches), re-rank it against interests + weights, and make sure
    // something is on screen.
    next_article: {
      description:
        "Pull fresh Wikipedia articles when needed (random plus searches on your " +
        "interests), rank them by interests and learned preferences, and put the best " +
        "unseen match on screen.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async ({ state, set }) => {
        const lang = state.lang; // capture before await
        const interests = state.interests; // capture before await
        const needFetch = !state.current || state.queue.length < QUEUE_MIN;

        let fresh = [];
        if (needFetch) {
          try {
            fresh = await fetchCandidates(lang, interests);
          } catch (err) {
            const error = `Couldn't load articles: ${String(err?.message ?? err)}`;
            set((cur) =>
              cur.lang !== lang ? cur : { ...cur, error, lastRefresh: new Date().toISOString() },
            );
            return { ok: false, error };
          }
        }

        // Merge fresh results into the LATEST state and re-rank everything with
        // the current interests + weights so a concurrent rate() isn't clobbered.
        set((cur) => {
          if (cur.lang !== lang) return cur; // language changed mid-fetch — drop
          const exclude = new Set(cur.seenIds);
          if (cur.current) exclude.add(cur.current.id);
          const ranked = rankQueue([...cur.queue, ...fresh], cur.weights, exclude, cur.interests);
          let current = cur.current;
          let seenIds = cur.seenIds;
          let queue = ranked;
          if (!current) {
            current = ranked[0] || null;
            queue = ranked.slice(1);
            if (current) seenIds = [...cur.seenIds, current.id].slice(-SEEN_CAP);
          }
          return {
            ...cur,
            current,
            queue,
            seenIds,
            error: current || fresh.length ? null : "No new articles found — try again.",
            lastRefresh: new Date().toISOString(),
          };
        });
        return { ok: true };
      },
    },

    // React to the current (or an explicitly supplied) article and advance:
    //   up   = like  (+1 to its topics)
    //   meh  = not that interested (a gentle −, far less than a dislike)
    //   down = not for me (−1)
    // additionalProperties is true so the agent/UI can hand over a whole article
    // object (the rich-payload pattern) rather than just a scalar.
    rate: {
      description:
        "React to an article to train the recommender: 'up' (like), 'meh' (not that " +
        "interested — a gentle nudge down, not a dislike), or 'down' (not for me). " +
        "Rates the current article by default, or an explicit { article } payload.",
      inputSchema: {
        type: "object",
        properties: {
          value: {
            type: "string",
            enum: ["up", "meh", "down"],
            description: "up = like, meh = indifferent (slight negative), down = dislike.",
          },
          article: {
            type: "object",
            description: "Optional article to rate instead of the current one (needs at least a title).",
          },
        },
        required: ["value"],
        additionalProperties: true,
      },
      handler: ({ state, set, input }) => {
        const value = input.value;
        if (value !== "up" && value !== "meh" && value !== "down") {
          throw new Error("value must be 'up', 'meh', or 'down'.");
        }
        const article = input.article || state.current;
        if (!article || !article.title) throw new Error("No article to rate.");

        const delta = DELTAS[value];
        const tokens = tokensFor(article);
        const id = String(article.id ?? article.title);
        const title = String(article.title);
        const now = new Date().toISOString();
        const entry = { id, title, url: article.url ? String(article.url) : "", ts: now };

        set((cur) => {
          const weights = { ...cur.weights };
          for (const t of tokens) {
            const next = (weights[t] || 0) + delta;
            const rounded = Math.round(next * 100) / 100;
            if (rounded === 0) delete weights[t];
            else weights[t] = Math.max(-8, Math.min(12, rounded)); // clamp so one topic can't run away
          }

          // Only the clear sentiments keep a history entry; "meh" is faint.
          const liked =
            value === "up"
              ? [entry, ...cur.liked.filter((e) => e.id !== id)].slice(0, HISTORY_CAP)
              : cur.liked.filter((e) => e.id !== id);
          const disliked =
            value === "down"
              ? [entry, ...cur.disliked.filter((e) => e.id !== id)].slice(0, HISTORY_CAP)
              : cur.disliked.filter((e) => e.id !== id);

          // The on-screen card matches when its id OR title equals the rated
          // article — the agent may rate "the current one" by title without a
          // pageid. Seed both ids into seen so a title-only rating can't resurface
          // the same card.
          const wasCurrent = !!cur.current && (String(cur.current.id) === id || String(cur.current.title) === title);
          const toSee = wasCurrent && cur.current ? [id, String(cur.current.id)] : [id];
          const seenIds = [...new Set([...cur.seenIds, ...toSee])].slice(-SEEN_CAP);

          // Re-rank the remaining queue with the freshly-updated weights and pull
          // the next best card if we just rated the on-screen article.
          const ranked = rankQueue(cur.queue, weights, new Set(seenIds), cur.interests);
          const current = wasCurrent ? ranked[0] || null : cur.current;
          const queue = wasCurrent ? ranked.slice(current ? 1 : 0) : ranked;

          // Keep counts truthful: liked/disliked mirror the deduped history arrays
          // (re-rating can't inflate them, and changing sentiment moves the count);
          // meh has no history, so it's a running tally of meh reactions.
          const stats = {
            rated: (cur.stats?.rated || 0) + 1,
            liked: liked.length,
            disliked: disliked.length,
            meh: (cur.stats?.meh || 0) + (value === "meh" ? 1 : 0),
          };

          return { ...cur, weights, liked, disliked, seenIds, current, queue, stats };
        });

        return { value, title, learnedFrom: tokens };
      },
    },

    // Skip the current article without training the model — just move on. Kept
    // for the agent; the UI uses the three sentiment buttons instead.
    skip: {
      description: "Skip the current article without rating it.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: ({ state, set }) => {
        if (!state.current) throw new Error("No article to skip.");
        set((cur) => {
          if (!cur.current) return cur;
          const id = cur.current.id;
          const seenIds = cur.seenIds.includes(id) ? cur.seenIds : [...cur.seenIds, id].slice(-SEEN_CAP);
          const ranked = rankQueue(cur.queue, cur.weights, new Set(seenIds), cur.interests);
          const current = ranked[0] || null;
          const queue = ranked.slice(current ? 1 : 0);
          return { ...cur, current, queue, seenIds };
        });
        return { ok: true };
      },
    },

    // Lazily fetch the images that appear in the current article (via the REST
    // media-list endpoint) and attach them for the gallery. Images are a nicety,
    // so a failure is swallowed into an empty list — never a surfaced error. The
    // view triggers this once per displayed article.
    load_images: {
      description: "Fetch the images from the current Wikipedia article for the gallery.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async ({ state, set }) => {
        const cur = state.current;
        if (!cur || cur.imagesLoaded) return { ok: true, count: cur?.images?.length ?? 0 };
        const id = cur.id;
        try {
          const images = await fetchImages(cur.lang || state.lang, cur.title);
          set((s) => {
            if (!s.current || String(s.current.id) !== String(id)) return s; // advanced past it
            return { ...s, current: { ...s.current, images, imagesLoaded: true } };
          });
          return { ok: true, count: images.length };
        } catch (err) {
          // Images are a nicety — don't surface a hard error. Flag imagesError
          // (without imagesLoaded) so the view can retry a transient blip a bounded
          // number of times instead of permanently hiding the gallery.
          set((s) => {
            if (!s.current || String(s.current.id) !== String(id)) return s;
            return { ...s, current: { ...s.current, imagesError: true } };
          });
          return { ok: true, count: 0, error: String(err?.message ?? err) };
        }
      },
    },

    // --- explicit interests ---------------------------------------------------

    add_interest: {
      description: "Add a topic, region, or theme you're interested in (boosts and steers the feed).",
      inputSchema: {
        type: "object",
        properties: { interest: { type: "string", description: "A topic/place/person, e.g. 'astronomy' or 'ancient Rome'." } },
        required: ["interest"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const label = normalizeInterest(input.interest);
        if (!label) throw new Error("interest is required");
        if (state.interests.some((i) => i.toLowerCase() === label.toLowerCase())) {
          return { interests: state.interests, added: false };
        }
        if (state.interests.length >= MAX_INTERESTS) throw new Error(`Too many interests (max ${MAX_INTERESTS}).`);
        set((cur) => {
          const interests = [...cur.interests, label];
          // Re-annotate the on-screen card and clear the queue so the next refill
          // pulls articles related to the new interest.
          const current = cur.current ? { ...cur.current, matched: interestMatches(cur.current, interests) } : cur.current;
          return { ...cur, interests, current, queue: [], error: null };
        });
        return { interests: [...state.interests, label], added: true };
      },
    },

    remove_interest: {
      description: "Remove one of your interests.",
      inputSchema: {
        type: "object",
        properties: { interest: { type: "string" } },
        required: ["interest"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const label = String(input.interest || "").trim().toLowerCase();
        let removed = false;
        set((cur) => {
          const interests = cur.interests.filter((i) => i.toLowerCase() !== label);
          if (interests.length === cur.interests.length) return cur; // nothing removed — keep the queue
          removed = true;
          const current = cur.current ? { ...cur.current, matched: interestMatches(cur.current, interests) } : cur.current;
          return { ...cur, interests, current, queue: [] };
        });
        return { ok: true, removed };
      },
    },

    set_interests: {
      description: "Replace the whole interests list at once.",
      inputSchema: {
        type: "object",
        properties: {
          interests: { type: "array", items: { type: "string" }, description: "Topics/places/themes to follow." },
        },
        required: ["interests"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const raw = Array.isArray(input.interests) ? input.interests : [];
        const out = [];
        const seen = new Set();
        for (const r of raw) {
          const label = normalizeInterest(r);
          if (!label || seen.has(label.toLowerCase())) continue;
          seen.add(label.toLowerCase());
          out.push(label);
          if (out.length >= MAX_INTERESTS) break;
        }
        set((cur) => {
          const current = cur.current ? { ...cur.current, matched: interestMatches(cur.current, out) } : cur.current;
          return { ...cur, interests: out, current, queue: [], error: null };
        });
        return { interests: out };
      },
    },

    // Switch the Wikipedia language edition; clears the on-screen card and pool
    // so the next refill pulls from the new edition. Interests are preserved.
    set_lang: {
      description: "Change the Wikipedia language edition (e.g. 'en', 'es', 'fr', 'de', 'simple').",
      inputSchema: {
        type: "object",
        properties: { lang: { type: "string", description: "Wikipedia language code." } },
        required: ["lang"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const lang = String(input.lang || "").trim().toLowerCase();
        if (!/^[a-z-]{2,12}$/.test(lang)) {
          throw new Error("lang must be a Wikipedia language code like 'en' or 'es'.");
        }
        set({ ...state, lang, current: null, queue: [], error: null });
        return { lang };
      },
    },

    // Forget learned feedback weights + like/dislike history. Interests are an
    // explicit choice and are intentionally preserved.
    reset_preferences: {
      description: "Forget all learned feedback (keeps your chosen interests). Clears like/dislike history.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: ({ state, set }) => {
        set({
          ...state,
          weights: {},
          liked: [],
          disliked: [],
          stats: { rated: 0, liked: 0, meh: 0, disliked: 0 },
        });
        return { ok: true };
      },
    },

    // Agent-facing summary: interests, what's on screen, and learned topics.
    list_recommendations: {
      description:
        "Summarize the chosen interests, the current article, and the topics the recommender has learned (for the agent).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: ({ state }) => {
        const learned = Object.entries(state.weights || {})
          .filter(([, v]) => v > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([t]) => t);
        const lines = [];
        lines.push(state.interests.length ? `Interests: ${state.interests.join(", ")}.` : "No interests set.");
        if (state.current) {
          lines.push(
            `On screen: ${state.current.title}${state.current.description ? ` — ${state.current.description}` : ""}`,
          );
        } else {
          lines.push("On screen: (nothing loaded yet)");
        }
        lines.push(`Liked ${state.stats?.liked ?? 0} · meh ${state.stats?.meh ?? 0} · disliked ${state.stats?.disliked ?? 0}.`);
        lines.push(learned.length ? `Learned topics: ${learned.join(", ")}.` : "No topics learned yet.");
        return { count: learned.length, interests: state.interests, learnedTopics: learned, summary: lines.join("\n") };
      },
    },
  },
};
