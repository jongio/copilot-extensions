// canvas.mjs — News Aggregator canvas definition (kit config; SDK-free).
//
// A shared, live news feed. The agent and the user read/write the SAME state
// through the SAME action handlers. Pick a topic OR run a free-text search;
// headlines are fetched server-side from Google News RSS (no API key) and stream
// into the canvas as cards. State is durable per-user and keyed by a "domain"
// resolved from the open input (default), so separate feeds ("work", "sports")
// stay isolated and open in many panels in sync.
//
// Beyond the feed, users (and the agent) can: save items for later, favorite
// them, hide them; keep a search history; pin a search as a custom topic chip
// with an auto-chosen icon (editable); and auto-refresh on an interval. All of
// that lives in durable shared state here; the browser view is a pure renderer.

import { fileURLToPath } from "node:url";
import { userStore } from "./canvas-kit/storage.mjs";

const EXT_NAME = "news-aggregator";

// Google News RSS. `top` is the home feed; every other id is a section topic.
const GN_BASE = "https://news.google.com/rss";
const GN_LOCALE = "hl=en-US&gl=US&ceid=US:en";

// Built-in topics, in display order. `id` doubles as the Google News topic
// section id (uppercased) for everything except the synthetic `top` feed.
export const TOPICS = [
  { id: "top", label: "Top stories", icon: "newspaper" },
  { id: "world", label: "World", icon: "globe" },
  { id: "nation", label: "U.S.", icon: "flag" },
  { id: "business", label: "Business", icon: "trending-up" },
  { id: "technology", label: "Technology", icon: "cpu" },
  { id: "science", label: "Science", icon: "atom" },
  { id: "health", label: "Health", icon: "heart-pulse" },
  { id: "sports", label: "Sports", icon: "trophy" },
  { id: "entertainment", label: "Entertainment", icon: "film" },
];
const BUILTIN_IDS = new Set(TOPICS.map((t) => t.id));
const labelForTopic = (id) => TOPICS.find((t) => t.id === id)?.label ?? id;

const MAX_ARTICLES = 50;
const MAX_HISTORY = 15;

// ---- auto icon for a pinned search --------------------------------------
// First matching rule wins; falls back to a neutral tag. Every icon name is
// verified to exist in the vendored Lucide set the view renders with.
const ICON_RULES = [
  [/(^|\W)(ai|artificial intelligence|machine learning|llm|gpt|chatgpt|openai|neural|deep learning)(\W|$)/i, "bot"],
  [/robot|robotics|drone|automation/i, "bot"],
  [/crypto|bitcoin|\bbtc\b|ethereum|\beth\b|blockchain|web3|\bnft/i, "bitcoin"],
  [/stock|market|nasdaq|\bdow\b|earnings|economy|inflation|finance|trading|investor/i, "trending-up"],
  [/football|soccer|\bnfl\b|\bnba\b|basketball|baseball|\bmlb\b|tennis|golf|olympic|hockey|\bnhl\b|sport|cricket/i, "trophy"],
  [/game|gaming|gamer|xbox|playstation|\bps5\b|nintendo|steam|esports/i, "gamepad-2"],
  [/movie|film|cinema|hollywood|box office|oscars|netflix|streaming|tv show/i, "film"],
  [/music|song|album|concert|tour|spotify|band|singer/i, "music"],
  [/space|nasa|spacex|rocket|mars|moon|astronaut|galaxy|cosmos|asteroid|telescope|webb|hubble|observatory|satellite/i, "rocket"],
  [/science|physics|biology|chemistry|genome|quantum|research|laborator/i, "flask-conical"],
  [/health|medical|medicine|covid|vaccine|disease|cancer|hospital|wellness|fitness/i, "heart-pulse"],
  [/climate|environment|warming|carbon|sustainab|wildfire|ecology|emissions/i, "leaf"],
  [/weather|storm|hurricane|forecast|tornado|temperature/i, "cloud-sun"],
  [/\bcar\b|cars|auto|automotive|\bev\b|electric vehicle|tesla|vehicle/i, "car"],
  [/travel|flight|airline|airport|tourism|vacation|hotel/i, "plane"],
  [/food|recipe|restaurant|cooking|\bchef\b|cuisine|dining/i, "utensils"],
  [/politic|election|government|senate|congress|president|parliament|\bpolicy\b|\bvote/i, "landmark"],
  [/\bwar\b|military|defense|\barmy\b|\bnavy\b|conflict|missile|troops/i, "shield"],
  [/phone|iphone|android|smartphone|mobile|gadget|\b5g\b/i, "smartphone"],
  [/apple|ipad|macbook|\bios\b|\bmac\b/i, "apple"],
  [/security|hack|cyber|breach|malware|ransomware|phishing/i, "shield-alert"],
  [/energy|\boil\b|\bgas\b|solar|nuclear|power grid|electricity|renewable/i, "zap"],
  [/education|school|university|college|student|teacher|campus/i, "graduation-cap"],
  [/\bbook\b|books|novel|author|literature|publishing/i, "book-open"],
  [/\bart\b|arts|design|museum|gallery|painting|exhibit/i, "palette"],
  [/business|startup|company|corporate|\bipo\b|merger|\bceo\b|enterprise/i, "briefcase"],
  [/\blaw\b|court|legal|justice|lawsuit|supreme court|\btrial\b/i, "scale"],
  [/real estate|housing|property|mortgage|home prices|\brent\b/i, "house"],
  [/fashion|style|clothing|designer|runway|apparel/i, "shirt"],
  [/crime|police|shooting|arrest|homicide/i, "siren"],
  [/\bworld\b|global|international|foreign|geopolit/i, "globe"],
  [/tech|technology|software|hardware|silicon valley|developer|coding|programming/i, "cpu"],
  [/\bpet\b|\bdog\b|\bcat\b|animal|wildlife/i, "dog"],
  [/internet|\bweb\b|wifi|network|broadband/i, "wifi"],
];
export function iconForQuery(q) {
  const s = String(q || "");
  for (const [re, icon] of ICON_RULES) if (re.test(s)) return icon;
  return "tag";
}

function fileFor(domainId) {
  const safe = String(domainId).replace(/[^A-Za-z0-9._-]/g, "_") || "default";
  return userStore(EXT_NAME, `${safe}.json`);
}

function topicUrl(id) {
  if (id === "top") return `${GN_BASE}?${GN_LOCALE}`;
  return `${GN_BASE}/headlines/section/topic/${encodeURIComponent(
    String(id).toUpperCase()
  )}?${GN_LOCALE}`;
}
function searchUrl(query) {
  return `${GN_BASE}/search?q=${encodeURIComponent(query)}&${GN_LOCALE}`;
}

const normQuery = (q) => String(q || "").trim().toLowerCase().replace(/\s+/g, " ");
function titleCase(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
function pinId(query) {
  const s = normQuery(query);
  let h = 0;
  for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) | 0;
  return `pin_${(h >>> 0).toString(36)}`;
}

// ---- tiny, dependency-free RSS parsing -----------------------------------
function stripCdata(s) {
  return s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/m, "$1");
}
function decodeEntities(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
function tagText(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? decodeEntities(stripCdata(m[1])).trim() : "";
}
function articleId(link, i) {
  let h = 0;
  const s = String(link || i);
  for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) | 0;
  return `a${(h >>> 0).toString(36)}`;
}
function hostFromUrl(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function parseFeed(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  let i = 0;
  while ((m = re.exec(xml)) && items.length < MAX_ARTICLES) {
    const block = m[1];
    let title = tagText(block, "title");
    const link = tagText(block, "link");
    const pub = tagText(block, "pubDate");

    // <source url="https://www.bbc.com">BBC</source>
    const srcM = block.match(/<source[^>]*\burl="([^"]+)"[^>]*>([\s\S]*?)<\/source>/i);
    const source = srcM ? decodeEntities(srcM[2]).trim() : tagText(block, "source");
    const sourceHost = srcM ? hostFromUrl(srcM[1]) : "";

    if (source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, -(source.length + 3)).trim();
    }
    if (!title) continue;

    const ts = pub ? Date.parse(pub) : NaN;
    items.push({
      id: articleId(link, i++),
      title,
      link,
      source: source || "",
      sourceHost,
      publishedAt: Number.isNaN(ts) ? null : ts,
    });
  }
  return items;
}

async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text());
}

// Resolve + fetch the selection (built-in topic, pinned search, or free search)
// and fold the result into state. One fetch path shared by set_topic / search /
// refresh, so behavior is identical however it's triggered.
async function loadSelection(base, set, { activeId, query }) {
  let id = activeId ?? null;
  let url;
  let mode = "topic";
  let effQuery = "";
  let label = "";

  if (id && BUILTIN_IDS.has(id)) {
    url = topicUrl(id);
    label = labelForTopic(id);
  } else if (id && id.startsWith("pin_")) {
    const pin = (base.pinnedTopics ?? []).find((p) => p.id === id);
    if (pin) {
      url = searchUrl(pin.query);
      effQuery = pin.query;
      label = pin.label;
    } else {
      id = "top";
      url = topicUrl("top");
      label = labelForTopic("top");
    }
  } else {
    effQuery = String(query ?? "").trim();
    if (effQuery) {
      id = null;
      mode = "search";
      url = searchUrl(effQuery);
      label = `“${effQuery}”`;
    } else {
      id = "top";
      url = topicUrl("top");
      label = labelForTopic("top");
    }
  }

  try {
    const articles = await fetchFeed(url);
    set({
      ...base,
      activeId: id,
      mode,
      query: effQuery,
      articles,
      error: articles.length ? null : "No headlines found.",
      lastRefresh: new Date().toISOString(),
    });
    return {
      activeId: id,
      mode,
      query: effQuery || undefined,
      count: articles.length,
      summary: `Loaded ${articles.length} headline(s) — ${label}.`,
    };
  } catch (err) {
    const error = `Couldn't load headlines: ${String(err?.message ?? err)}`;
    set({ ...base, activeId: id, mode, query: effQuery, error, lastRefresh: new Date().toISOString() });
    throw new Error(error);
  }
}

// ---- per-article marks (saved / favorite / hidden) -----------------------
function pickMeta(a) {
  if (!a) return {};
  const out = {};
  for (const k of ["title", "link", "source", "sourceHost", "publishedAt"]) {
    if (a[k] !== undefined) out[k] = a[k];
  }
  return out;
}
function findArticle(state, id) {
  return (state.articles ?? []).find((a) => a.id === id) || null;
}
function setMark(state, id, patch, article) {
  const marks = { ...(state.marks ?? {}) };
  const meta = pickMeta(article || findArticle(state, id) || marks[id]);
  const next = { id, ...meta, ...(marks[id] ?? {}), ...patch };
  // Drop a mark once it carries no flags, to keep the store tidy.
  if (!next.saved && !next.favorite && !next.hidden) {
    delete marks[id];
  } else {
    marks[id] = next;
  }
  return { ...state, marks };
}

export const canvasConfig = {
  id: "news-aggregator",
  displayName: "News Aggregator",
  description:
    "A shared, live news feed. The agent and you share the same aggregator: pick a " +
    "topic (Top stories, World, Business, Technology, Science, Health, Sports, …) or " +
    "run a free-text search, and headlines stream in as cards. Save items for later, " +
    "favorite or hide them, keep a search history, pin searches as custom topics, sort " +
    "and filter the list, and auto-refresh. Stays in sync live.",
  assetsDir: fileURLToPath(new URL("./web/", import.meta.url)),

  inputSchema: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        description: "Which feed to open (e.g. 'work', 'sports'). Omit for the default feed.",
      },
    },
    additionalProperties: false,
  },

  resolveDomainId: (input) => (input?.domain ? String(input.domain) : "default"),

  createInitialState: (ctx) => ({
    domain: ctx?.input?.domain ?? "default",
    activeId: "top", // built-in id | "pin_*" | null (free search)
    mode: "topic", // "topic" | "search"
    query: "",
    articles: [],
    error: null,
    lastRefresh: null,
    view: "feed", // "feed" | "saved" | "favorites"
    autoRefreshSec: 0, // 0 = off
    marks: {}, // id -> { id,title,link,source,sourceHost,publishedAt, saved,favorite,hidden, ...At }
    searchHistory: [], // [{ query, at }]
    pinnedTopics: [], // [{ id,label,query,icon,createdAt }]
  }),

  loadState: async (domainId) => fileFor(domainId).load(null),
  saveState: async (domainId, state) => fileFor(domainId).save(state),

  statusLine: (_ctx, state) => {
    const pin = (state.pinnedTopics ?? []).find((p) => p.id === state.activeId);
    const where =
      state.mode === "search"
        ? `“${state.query || "search"}”`
        : pin
        ? pin.label
        : labelForTopic(state.activeId);
    const n = (state.articles ?? []).length;
    const saved = Object.values(state.marks ?? {}).filter((m) => m.saved).length;
    return `${where} · ${n} headline${n === 1 ? "" : "s"}${saved ? ` · ${saved} saved` : ""}`;
  },

  actions: {
    set_topic: {
      description:
        "Select a topic and load its latest headlines. Built-in topics: top, world, " +
        "nation, business, technology, science, health, sports, entertainment. You may " +
        "also pass a pinned topic id (pin_…).",
      inputSchema: {
        type: "object",
        properties: { topic: { type: "string", description: "Topic id (built-in or pin_…)." } },
        required: ["topic"],
        additionalProperties: false,
      },
      handler: async ({ state, set, input }) => {
        const t = String(input.topic ?? "").trim();
        const isBuiltin = BUILTIN_IDS.has(t);
        const isPin = t.startsWith("pin_") && (state.pinnedTopics ?? []).some((p) => p.id === t);
        if (!isBuiltin && !isPin) {
          throw new Error(`Unknown topic "${t}". Built-in: ${[...BUILTIN_IDS].join(", ")}`);
        }
        return loadSelection(state, set, { activeId: t });
      },
    },

    search: {
      description:
        'Run a free-text news search and load matching headlines (e.g. "James Webb ' +
        'telescope"). The query is also added to the search history.',
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Free-text search query." } },
        required: ["query"],
        additionalProperties: false,
      },
      handler: async ({ state, set, input }) => {
        const query = String(input.query ?? "").trim();
        if (!query) throw new Error("query is required");
        const history = [
          { query, at: new Date().toISOString() },
          ...(state.searchHistory ?? []).filter((h) => normQuery(h.query) !== normQuery(query)),
        ].slice(0, MAX_HISTORY);
        return loadSelection({ ...state, searchHistory: history }, set, { activeId: null, query });
      },
    },

    refresh: {
      description: "Re-fetch the current feed (selected topic, pinned topic, or last search).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async ({ state, set }) =>
        loadSelection(state, set, { activeId: state.activeId, query: state.query }),
    },

    set_view: {
      description: "Switch the visible list between the live feed, saved items, and favorites.",
      inputSchema: {
        type: "object",
        properties: { view: { type: "string", enum: ["feed", "saved", "favorites"] } },
        required: ["view"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const view = ["feed", "saved", "favorites"].includes(input.view) ? input.view : "feed";
        set({ ...state, view });
        return { view };
      },
    },

    set_auto_refresh: {
      description:
        "Set the auto-refresh interval in seconds (0 disables it). The view only " +
        "refreshes while the canvas is visible.",
      inputSchema: {
        type: "object",
        properties: { seconds: { type: "number", description: "Interval seconds; 0 = off." } },
        required: ["seconds"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        let s = Number(input.seconds);
        if (!Number.isFinite(s) || s < 0) s = 0;
        s = Math.min(3600, Math.round(s));
        set({ ...state, autoRefreshSec: s });
        return { autoRefreshSec: s };
      },
    },

    save_item: {
      description: "Toggle whether an article is saved for later.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" }, article: { type: "object" } },
        required: ["id"],
        additionalProperties: true,
      },
      handler: ({ state, set, input }) => {
        const cur = state.marks?.[input.id];
        const saved = !cur?.saved;
        set(setMark(state, input.id, { saved, savedAt: saved ? new Date().toISOString() : null }, input.article));
        return { id: input.id, saved };
      },
    },

    favorite_item: {
      description: "Toggle whether an article is favorited.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" }, article: { type: "object" } },
        required: ["id"],
        additionalProperties: true,
      },
      handler: ({ state, set, input }) => {
        const cur = state.marks?.[input.id];
        const favorite = !cur?.favorite;
        set(setMark(state, input.id, { favorite, favoritedAt: favorite ? new Date().toISOString() : null }, input.article));
        return { id: input.id, favorite };
      },
    },

    hide_item: {
      description: "Hide an article so it no longer shows in the feed.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" }, article: { type: "object" } },
        required: ["id"],
        additionalProperties: true,
      },
      handler: ({ state, set, input }) => {
        set(setMark(state, input.id, { hidden: true, hiddenAt: new Date().toISOString() }, input.article));
        return { id: input.id, hidden: true };
      },
    },

    unhide_item: {
      description: "Un-hide a previously hidden article.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        set(setMark(state, input.id, { hidden: false, hiddenAt: null }));
        return { id: input.id, hidden: false };
      },
    },

    clear_hidden: {
      description: "Un-hide all hidden articles.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: ({ state, set }) => {
        const marks = {};
        let cleared = 0;
        for (const [id, m] of Object.entries(state.marks ?? {})) {
          if (m.hidden) {
            cleared++;
            const next = { ...m, hidden: false, hiddenAt: null };
            if (next.saved || next.favorite) marks[id] = next;
          } else {
            marks[id] = m;
          }
        }
        set({ ...state, marks });
        return { cleared };
      },
    },

    pin_topic: {
      description:
        "Pin a search as a custom topic chip. With no query, pins the current search. " +
        "An icon is auto-chosen from the query unless you pass one.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search to pin. Omit to pin the current search." },
          label: { type: "string", description: "Optional display label (defaults to the query)." },
          icon: { type: "string", description: "Optional Lucide icon name (auto-chosen if omitted)." },
        },
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const query = String(input.query ?? state.query ?? "").trim();
        if (!query) throw new Error("No query to pin.");
        const id = pinId(query);
        const exists = (state.pinnedTopics ?? []).some((p) => p.id === id);
        if (exists) return { id, already: true };
        const pin = {
          id,
          label: input.label ? String(input.label).trim() : titleCase(query),
          query,
          icon: input.icon ? String(input.icon) : iconForQuery(query),
          createdAt: new Date().toISOString(),
        };
        set({ ...state, pinnedTopics: [...(state.pinnedTopics ?? []), pin] });
        return { id, label: pin.label, icon: pin.icon };
      },
    },

    update_topic: {
      description: "Edit a pinned topic's label, query, and/or icon.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          query: { type: "string" },
          icon: { type: "string" },
        },
        required: ["id"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        let found = false;
        const pinnedTopics = (state.pinnedTopics ?? []).map((p) => {
          if (p.id !== input.id) return p;
          found = true;
          return {
            ...p,
            label: input.label !== undefined ? String(input.label).trim() || p.label : p.label,
            query: input.query !== undefined ? String(input.query).trim() || p.query : p.query,
            icon: input.icon !== undefined ? String(input.icon) || p.icon : p.icon,
          };
        });
        if (!found) throw new Error(`No pinned topic ${input.id}`);
        const active = pinnedTopics.find((p) => p.id === input.id);
        set({ ...state, pinnedTopics });
        return { id: input.id, label: active.label, query: active.query, icon: active.icon };
      },
    },

    unpin_topic: {
      description: "Remove a pinned custom topic.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const pinnedTopics = (state.pinnedTopics ?? []).filter((p) => p.id !== input.id);
        const patch = { ...state, pinnedTopics };
        if (state.activeId === input.id) {
          patch.activeId = "top";
        }
        set(patch);
        return { removed: input.id };
      },
    },

    remove_history: {
      description: "Remove one query from the search history (omit to clear all).",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        if (input.query == null) {
          set({ ...state, searchHistory: [] });
          return { cleared: true };
        }
        const searchHistory = (state.searchHistory ?? []).filter(
          (h) => normQuery(h.query) !== normQuery(input.query)
        );
        set({ ...state, searchHistory });
        return { remaining: searchHistory.length };
      },
    },

    list_articles: {
      description:
        "Return a text summary of the headlines currently loaded (or the saved / " +
        "favorite list). For the agent.",
      inputSchema: {
        type: "object",
        properties: { which: { type: "string", enum: ["visible", "saved", "favorites"] } },
        additionalProperties: false,
      },
      handler: ({ state, input }) => {
        const which = input.which ?? "visible";
        let items;
        if (which === "saved") items = Object.values(state.marks ?? {}).filter((m) => m.saved);
        else if (which === "favorites")
          items = Object.values(state.marks ?? {}).filter((m) => m.favorite);
        else items = (state.articles ?? []).filter((a) => !state.marks?.[a.id]?.hidden);
        if (!items.length) return { count: 0, summary: `No ${which} headlines.` };
        const summary = items
          .map((a, i) => `${i + 1}. ${a.title}${a.source ? ` — ${a.source}` : ""}\n   ${a.link}`)
          .join("\n");
        return { count: items.length, which, lastRefresh: state.lastRefresh, summary };
      },
    },
  },
};
