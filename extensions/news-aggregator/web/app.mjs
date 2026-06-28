// web/app.mjs — Preact view for the News Aggregator canvas.
//
// SHARED state (feed, marks, pinned topics, history, auto-refresh) arrives over
// /events (SSE); the agent mutates the same data through the same handlers.
// LOCAL UI state (which control tab is open, sort order, the visible-items
// filter, the pin being edited, drafts) lives in useState. Because Preact DIFFS
// the DOM (no innerHTML repaint), a live push never clobbers what you're typing.

import {
  html, mountCanvas, useState, useEffect, Icon,
  pollWhileVisible, relativeTime,
} from "/kit/client.mjs";

// Built-in topics — mirrors TOPICS in canvas.mjs (icons are view-only).
const TOPICS = [
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

// Icon palette offered when editing a pinned topic.
const ICON_PALETTE = [
  "tag", "bot", "bitcoin", "trending-up", "trophy", "gamepad-2", "film", "music",
  "rocket", "flask-conical", "heart-pulse", "leaf", "car", "plane", "utensils",
  "landmark", "shield", "smartphone", "zap", "graduation-cap", "book-open",
  "briefcase", "globe", "cpu", "newspaper", "star", "flame", "cloud-sun",
];

const REFRESH_OPTIONS = [
  { v: 0, label: "Off" },
  { v: 30, label: "30s" },
  { v: 60, label: "1m" },
  { v: 120, label: "2m" },
  { v: 300, label: "5m" },
  { v: 600, label: "10m" },
];

// relTime is now the kit's relativeTime ("just now" / "5m ago" / locale date),
// imported above — it accepts epoch ms (publishedAt) or an ISO string (lastRefresh).
function hostOf(link, fallback) {
  if (fallback) return fallback;
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
function hueFor(s) {
  let h = 0;
  for (const c of String(s || "?")) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h) % 360;
}

// Brand thumbnail: publisher favicon -> tinted letter tile. Google News exposes
// no real per-article image, so we lead with the source's own brand mark (its
// favicon), which resolves reliably; a colored initial covers the rest.
function Thumb({ source, host }) {
  const [failed, setFailed] = useState(false);
  const h = host || "";
  if (!h || failed) {
    const letter = (source || host || "?").trim().charAt(0).toUpperCase() || "?";
    return html`<div class="na-thumb">
      <div class="na-thumb-letter" style=${`background:hsl(${hueFor(source || host)} 45% 38%)`}>
        ${letter}
      </div>
    </div>`;
  }
  return html`<div class="na-thumb">
    <img
      src=${`https://www.google.com/s2/favicons?sz=128&domain=${h}`}
      alt=${source || h}
      loading="lazy"
      onError=${() => setFailed(true)}
    />
  </div>`;
}

function Favicon({ host, size = 14 }) {
  if (!host) return null;
  return html`<img
    class="na-fav-ico"
    width=${size}
    height=${size}
    src=${`https://www.google.com/s2/favicons?sz=32&domain=${host}`}
    alt=""
    onError=${(e) => (e.target.style.display = "none")}
  />`;
}

function IconAction({ name, title, pressed, cls, onClick }) {
  return html`<button
    class=${`na-iconaction ${cls || ""}`}
    title=${title}
    aria-label=${title}
    aria-pressed=${pressed ? "true" : "false"}
    onClick=${onClick}
  >
    <${Icon} name=${name} size=${16} />
  </button>`;
}

function ArticleCard({ a, mark, view, invoke }) {
  const host = hostOf(a.link, a.sourceHost);
  const saved = !!mark.saved;
  const favorite = !!mark.favorite;
  const hidden = !!mark.hidden;
  const payload = {
    id: a.id,
    title: a.title,
    link: a.link,
    source: a.source,
    sourceHost: a.sourceHost,
    publishedAt: a.publishedAt,
  };
  return html`
    <div class="ck-card na-card">
      <${Thumb} source=${a.source} host=${a.sourceHost} />
      <div class="na-body">
        <a class="na-titlelink" href=${a.link} target="_blank" rel="noopener noreferrer">
          <div class="na-title">${a.title}</div>
        </a>
        <div class="na-meta">
          <${Favicon} host=${a.sourceHost} />
          ${a.source ? html`<span class="na-source">${a.source}</span>` : null}
          ${a.publishedAt
            ? html`<span class="na-dot">·</span><span>${relativeTime(a.publishedAt)}</span>`
            : null}
          ${host && host !== a.source?.toLowerCase()
            ? html`<span class="na-dot">·</span><span>${host}</span>`
            : null}
        </div>
      </div>
      <div class="na-actions">
        <${IconAction}
          name="star"
          cls="na-act-fav"
          title=${favorite ? "Unfavorite" : "Favorite"}
          pressed=${favorite}
          onClick=${() => invoke("favorite_item", { id: a.id, article: payload })}
        />
        <${IconAction}
          name="bookmark"
          cls="na-act-save"
          title=${saved ? "Remove from saved" : "Save for later"}
          pressed=${saved}
          onClick=${() => invoke("save_item", { id: a.id, article: payload })}
        />
        ${hidden || view !== "feed"
          ? html`<${IconAction}
              name="eye"
              title="Un-hide"
              pressed=${false}
              onClick=${() => invoke("unhide_item", { id: a.id })}
            />`
          : html`<${IconAction}
              name="eye-off"
              title="Hide"
              pressed=${false}
              onClick=${() => invoke("hide_item", { id: a.id, article: payload })}
            />`}
      </div>
    </div>
  `;
}

function TopicChips({ activeId, pinned, invoke, onEdit }) {
  const [busy, setBusy] = useState(null);
  async function pick(id) {
    if (busy) return;
    setBusy(id);
    try {
      await invoke("set_topic", { topic: id });
    } catch {
    } finally {
      setBusy(null);
    }
  }
  const chip = (id, label, icon, isPin) => html`
    <button
      class=${`na-chip ${isPin ? "na-chip-pinned" : ""}`}
      role="tab"
      aria-pressed=${String(activeId === id)}
      disabled=${busy === id}
      onClick=${() => pick(id)}
    >
      <${Icon}
        name=${busy === id ? "loader-circle" : icon || "tag"}
        size=${14}
        class=${busy === id ? "ck-spinner" : ""}
      />
      <span class="na-chip-label">${label}</span>
      ${isPin
        ? html`<span
            class="na-chip-edit"
            role="button"
            title="Edit pinned topic"
            onClick=${(e) => {
              e.stopPropagation();
              onEdit(id);
            }}
          >
            <${Icon} name="pencil" size=${12} />
          </span>`
        : null}
    </button>
  `;
  return html`
    <div class="na-chips" role="tablist" aria-label="Topics">
      ${TOPICS.map((t) => chip(t.id, t.label, t.icon, false))}
      ${pinned.map((p) => chip(p.id, p.label, p.icon, true))}
    </div>
  `;
}

function PinEditor({ pin, invoke, onClose }) {
  const [label, setLabel] = useState(pin.label || "");
  const [query, setQuery] = useState(pin.query || "");
  const [icon, setIcon] = useState(pin.icon || "tag");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await invoke("update_topic", { id: pin.id, label, query, icon });
      onClose();
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      await invoke("unpin_topic", { id: pin.id });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div class="ck-card na-editor ck-col" style="gap:8px">
      <div class="ck-spread">
        <strong>Edit pinned topic</strong>
        <button class="na-iconaction" title="Close" onClick=${onClose}>
          <${Icon} name="x" size=${16} />
        </button>
      </div>
      <label class="ck-caption">Label</label>
      <input class="ck-input" value=${label} onInput=${(e) => setLabel(e.target.value)} />
      <label class="ck-caption">Search query</label>
      <input class="ck-input" value=${query} onInput=${(e) => setQuery(e.target.value)} />
      <label class="ck-caption">Icon</label>
      <div class="na-iconpicker">
        ${ICON_PALETTE.map(
          (n) => html`<button
            class="na-iconbtn"
            aria-pressed=${String(icon === n)}
            title=${n}
            onClick=${() => setIcon(n)}
          >
            <${Icon} name=${n} size=${16} />
          </button>`
        )}
      </div>
      <div class="ck-row" style="gap:8px;margin-top:4px">
        <button class="ck-btn ck-btn-primary" disabled=${busy || !query.trim()} onClick=${save}>
          <${Icon} name="check" size=${16} />Save
        </button>
        <button class="ck-btn ck-btn-danger" disabled=${busy} onClick=${remove}>
          <${Icon} name="trash-2" size=${14} />Remove
        </button>
      </div>
    </div>
  `;
}

function SearchPanel({ state, invoke }) {
  const [q, setQ] = useState(state.mode === "search" ? state.query || "" : "");
  const [busy, setBusy] = useState(false);
  const history = state.searchHistory ?? [];
  const pinnedQueries = new Set((state.pinnedTopics ?? []).map((p) => p.query.toLowerCase()));
  const currentPinned =
    state.mode === "search" && state.query && pinnedQueries.has(state.query.toLowerCase());

  async function run(query) {
    const term = (query ?? q).trim();
    if (!term || busy) return;
    setBusy(true);
    try {
      await invoke("search", { query: term });
      setQ(term);
    } catch {
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div>
      <div class="ck-row na-search">
        <input
          class="ck-input ck-grow"
          type="search"
          placeholder="Search the news… e.g. James Webb telescope"
          value=${q}
          onInput=${(e) => setQ(e.target.value)}
          onKeyDown=${(e) => {
            if (e.key === "Enter") run();
          }}
        />
        <button class="ck-btn ck-btn-primary" disabled=${!q.trim() || busy} onClick=${() => run()}>
          <${Icon}
            name=${busy ? "loader-circle" : "search"}
            size=${16}
            class=${busy ? "ck-spinner" : ""}
          />
          Search
        </button>
      </div>

      ${state.mode === "search" && state.query
        ? html`<div style="margin-bottom:8px">
            ${currentPinned
              ? html`<span class="ck-caption ck-row" style="gap:6px"
                  ><${Icon} name="pin" size=${12} />Pinned as a topic</span
                >`
              : html`<button
                  class="ck-btn ck-btn-sm"
                  onClick=${() => invoke("pin_topic", { query: state.query })}
                >
                  <${Icon} name="pin" size=${14} />Pin “${state.query}” as a topic
                </button>`}
          </div>`
        : null}

      ${history.length
        ? html`
            <div class="na-section">
              <div class="ck-spread" style="margin-bottom:6px">
                <span class="ck-caption ck-row" style="gap:6px"
                  ><${Icon} name="history" size=${12} />Recent searches</span
                >
                <button
                  class="ck-btn ck-btn-sm"
                  title="Clear history"
                  onClick=${() => invoke("remove_history", {})}
                >
                  Clear
                </button>
              </div>
              <div class="na-hist">
                ${history.map(
                  (h) => html`
                    <span class="na-pill" key=${h.query}>
                      <span class="na-pill-q" onClick=${() => run(h.query)}>${h.query}</span>
                      <button
                        title="Pin as topic"
                        onClick=${() => invoke("pin_topic", { query: h.query })}
                      >
                        <${Icon} name="pin" size=${12} />
                      </button>
                      <button
                        title="Remove"
                        onClick=${() => invoke("remove_history", { query: h.query })}
                      >
                        <${Icon} name="x" size=${12} />
                      </button>
                    </span>
                  `
                )}
              </div>
            </div>
          `
        : null}
    </div>
  `;
}

function sortList(list, sort) {
  const arr = [...list];
  if (sort === "old") arr.sort((a, b) => (a.publishedAt || 0) - (b.publishedAt || 0));
  else if (sort === "new") arr.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  else if (sort === "source")
    arr.sort((a, b) => String(a.source || "").localeCompare(String(b.source || "")));
  else if (sort === "title")
    arr.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
  return arr;
}

// Placeholder card shown while the initial feed is still loading. Mirrors the
// .na-card layout (thumb + title/meta lines) with kit ck-skeleton shimmer.
function SkeletonCard() {
  return html`<div class="ck-card na-card" aria-hidden="true">
    <div class="na-thumb ck-skeleton"></div>
    <div class="na-body" style="display:flex;flex-direction:column;gap:8px">
      <div class="ck-skeleton" style="width:92%;height:14px"></div>
      <div class="ck-skeleton" style="width:60%;height:14px"></div>
      <div class="ck-skeleton" style="width:38%;height:12px"></div>
    </div>
  </div>`;
}

// AI TL;DR of the currently visible headlines. The summary text + pending/error
// flags are SHARED state (set by the host model via set_digest); the only local
// state is a transient client-side error for a synchronous request rejection.
function Digest({ digest, lastRefresh, hasArticles, invoke }) {
  const [localErr, setLocalErr] = useState("");
  const pending = !!digest?.pending;
  const text = digest?.text;
  const error = digest?.error || localErr;
  const stale = !!(text && digest?.refreshToken && digest.refreshToken !== lastRefresh);

  async function run() {
    setLocalErr("");
    try {
      await invoke("request_digest", {});
    } catch (e) {
      setLocalErr(e?.message || "Could not summarize.");
    }
  }

  // Don't advertise the feature until there are headlines to summarize — unless a
  // digest already exists, in which case keep showing it.
  if (!hasArticles && !text && !pending && !error) return null;

  const hasBody = pending || text || error;
  return html`
    <div class="ck-card na-digest" style="margin-bottom:10px;padding:12px 14px">
      <div class="ck-spread" style=${hasBody ? "margin-bottom:8px" : ""}>
        <div class="ck-row" style="gap:6px;min-width:0">
          <${Icon} name="sparkles" size=${16} />
          <strong>AI digest</strong>
          ${digest?.label ? html`<span class="ck-caption ck-muted">${digest.label}</span>` : null}
        </div>
        <button class="ck-btn ck-btn-sm" disabled=${pending} onClick=${run} title="Summarize these headlines with AI">
          <${Icon} name=${pending ? "loader" : "sparkles"} size=${14} />
          ${pending ? "Thinking…" : text ? "Regenerate" : "Summarize"}
        </button>
      </div>
      ${pending && !text ? html`<p class="ck-muted" style="margin:0;font-size:13px">Reading the headlines…</p>` : null}
      ${text ? html`<p class="ck-muted" style="margin:0;font-size:13px;line-height:1.55">${text}</p>` : null}
      ${error && !pending ? html`<p class="ck-caption" style="margin:6px 0 0;color:var(--ck-danger,#f85149)">${error}</p>` : null}
      ${stale && !pending
        ? html`<div class="ck-caption ck-muted" style="margin-top:6px">
            <${Icon} name="info" size=${12} /> Headlines updated since this digest — regenerate for the latest.
          </div>`
        : text && digest?.at
        ? html`<div class="ck-caption ck-muted" style="margin-top:6px">Generated ${relativeTime(digest.at)}</div>`
        : null}
    </div>
  `;
}

function App({ state, invoke, connected }) {
  const [tab, setTab] = useState(null); // "topics" | "search"
  const [sort, setSort] = useState("new");
  const [filter, setFilter] = useState("");
  const [editPin, setEditPin] = useState(null);

  // Auto-load the default feed the first time this feed is opened.
  useEffect(() => {
    if (state && !state.lastRefresh && !state.error && (state.articles?.length ?? 0) === 0) {
      invoke("set_topic", { topic: state.activeId || "top" }).catch(() => {});
    }
  }, [state?.lastRefresh]);

  // Auto-refresh on an interval, but only while the canvas is visible — delegated
  // to the kit's pollWhileVisible (returns a useEffect-ready cleanup; <=0 no-ops).
  useEffect(
    () => pollWhileVisible(() => invoke("refresh", {}), state?.autoRefreshSec || 0),
    [state?.autoRefreshSec],
  );

  if (!state) return html`<p class="ck-muted">Loading…</p>`;

  const marks = state.marks ?? {};
  const pinned = state.pinnedTopics ?? [];
  const view = state.view ?? "feed";
  const activeTab = tab ?? (state.mode === "search" ? "search" : "topics");
  const editingPin = editPin ? pinned.find((p) => p.id === editPin) : null;

  // Build the visible list for the current view, then filter + sort locally.
  let base;
  if (view === "saved") base = Object.values(marks).filter((m) => m.saved);
  else if (view === "favorites") base = Object.values(marks).filter((m) => m.favorite);
  else base = (state.articles ?? []).filter((a) => !marks[a.id]?.hidden);

  const hiddenCount = (state.articles ?? []).filter((a) => marks[a.id]?.hidden).length;
  const savedCount = Object.values(marks).filter((m) => m.saved).length;
  const favCount = Object.values(marks).filter((m) => m.favorite).length;

  const f = filter.trim().toLowerCase();
  let list = f
    ? base.filter((a) =>
        `${a.title || ""} ${a.source || ""}`.toLowerCase().includes(f)
      )
    : base;
  list = sortList(list, sort);

  // True only during the initial feed load — the same window the auto-load effect
  // above fires in (no prior refresh, no error, nothing to show yet). Once set_topic
  // resolves, lastRefresh is set (or error is) and this flips false, so the skeleton
  // never sticks. Gated to the feed view so saved/favorites keep their empty states.
  const loadingFeed =
    view === "feed" && !state.lastRefresh && !state.error && list.length === 0;

  const pinActive = pinned.find((p) => p.id === state.activeId);
  const where =
    state.mode === "search"
      ? `“${state.query}”`
      : pinActive
      ? pinActive.label
      : TOPICS.find((t) => t.id === state.activeId)?.label ?? state.activeId;

  const VIEWS = [
    { id: "feed", label: "Feed", icon: "list" },
    { id: "saved", label: `Saved${savedCount ? ` (${savedCount})` : ""}`, icon: "bookmark" },
    { id: "favorites", label: `Favorites${favCount ? ` (${favCount})` : ""}`, icon: "star" },
  ];

  return html`
    <div>
      <div class="ck-spread na-head">
        <div class="ck-row" style="gap:8px">
          <${Icon} name="newspaper" size=${20} />
          <h1 style="margin:0">News Aggregator</h1>
        </div>
        <div class="ck-row" style="gap:10px">
          <label class="ck-caption ck-row" style="gap:4px" title="Auto-refresh while visible">
            <${Icon} name="refresh-cw" size=${12} />
            <select
              class="na-select"
              value=${String(state.autoRefreshSec || 0)}
              onChange=${(e) => invoke("set_auto_refresh", { seconds: Number(e.target.value) })}
            >
              ${REFRESH_OPTIONS.map(
                (o) => html`<option value=${String(o.v)}>${o.label}</option>`
              )}
            </select>
          </label>
          <span class="ck-status">
            <span class=${`ck-dot ${connected ? "ck-dot-live" : "ck-dot-off"}`}></span>
            ${connected ? "live" : "reconnecting…"}
          </span>
        </div>
      </div>

      <div class="na-controls">
        <div class="ck-spread" style="margin-bottom:8px">
          <div class="ck-tabs" role="tablist" aria-label="Mode">
            <button
              class="ck-tab"
              role="tab"
              aria-selected=${String(activeTab === "topics")}
              onClick=${() => setTab("topics")}
            >
              Topics
            </button>
            <button
              class="ck-tab"
              role="tab"
              aria-selected=${String(activeTab === "search")}
              onClick=${() => setTab("search")}
            >
              Search
            </button>
          </div>
          <button class="ck-btn ck-btn-sm" title="Refresh current feed" onClick=${() => invoke("refresh", {})}>
            <${Icon} name="refresh-cw" size=${14} />Refresh
          </button>
        </div>

        ${activeTab === "topics"
          ? html`<${TopicChips}
              activeId=${state.activeId}
              pinned=${pinned}
              invoke=${invoke}
              onEdit=${(id) => setEditPin(id)}
            />`
          : html`<${SearchPanel} state=${state} invoke=${invoke} />`}

        ${editingPin
          ? html`<${PinEditor}
              pin=${editingPin}
              invoke=${invoke}
              onClose=${() => setEditPin(null)}
            />`
          : null}
      </div>

      <div class="na-toolbar">
        <div class="ck-tabs" role="tablist" aria-label="View">
          ${VIEWS.map(
            (v) => html`
              <button
                class="ck-tab ck-row"
                style="gap:5px"
                role="tab"
                aria-selected=${String(view === v.id)}
                onClick=${() => invoke("set_view", { view: v.id })}
              >
                <${Icon} name=${v.icon} size=${13} />${v.label}
              </button>
            `
          )}
        </div>
        <div class="ck-row" style="gap:8px">
          <div class="na-filter">
            <span class="na-filter-ico"><${Icon} name="list-filter" size=${14} /></span>
            <input
              class="ck-input"
              placeholder="Filter visible…"
              value=${filter}
              onInput=${(e) => setFilter(e.target.value)}
            />
          </div>
          <select class="na-select" value=${sort} onChange=${(e) => setSort(e.target.value)}>
            <option value="new">Newest</option>
            <option value="old">Oldest</option>
            <option value="source">Source A–Z</option>
            <option value="title">Title A–Z</option>
          </select>
        </div>
      </div>

      <div class="ck-spread" style="margin:2px 0 10px">
        <span class="ck-caption">
          ${view === "feed" ? `Showing ${where} · ` : ""}${list.length} item${list.length === 1 ? "" : "s"}${f ? " (filtered)" : ""}
        </span>
        <span class="ck-row" style="gap:8px">
          ${view === "feed" && hiddenCount
            ? html`<button
                class="ck-btn ck-btn-sm"
                title="Un-hide all"
                onClick=${() => invoke("clear_hidden", {})}
              >
                <${Icon} name="eye" size=${13} />${hiddenCount} hidden
              </button>`
            : null}
          ${state.lastRefresh
            ? html`<span class="ck-caption">updated ${relativeTime(state.lastRefresh)}</span>`
            : null}
        </span>
      </div>

      ${state.error
        ? html`<div class="ck-callout ck-error" style="margin-bottom:10px">
            <${Icon} name="circle-x" size=${16} /><span>${state.error}</span>
          </div>`
        : null}

      ${view === "feed"
        ? html`<${Digest}
            digest=${state.digest}
            lastRefresh=${state.lastRefresh}
            hasArticles=${base.length > 1}
            invoke=${invoke}
          />`
        : null}

      <div class="na-list">
        ${list.length
          ? list.map(
              (a) => html`<${ArticleCard}
                key=${a.id}
                a=${a}
                mark=${marks[a.id] ?? {}}
                view=${view}
                invoke=${invoke}
              />`
            )
          : loadingFeed
          ? html`<div role="status" aria-label="Loading headlines" style="display:flex;flex-direction:column;gap:8px">
              ${Array.from({ length: 6 }, (_, i) => html`<${SkeletonCard} key=${`sk-${i}`} />`)}
            </div>`
          : !state.error
          ? html`<div class="ck-empty">
              <${Icon} name=${view === "saved" ? "bookmark" : view === "favorites" ? "star" : "newspaper"} size=${20} />
              ${view === "feed"
                ? "Pick a topic or search to load headlines."
                : view === "saved"
                ? "No saved items yet — tap the bookmark on any headline."
                : "No favorites yet — tap the star on any headline."}
            </div>`
          : null}
      </div>
    </div>
  `;
}

mountCanvas({ view: (model) => html`<${App} ...${model} />` });
