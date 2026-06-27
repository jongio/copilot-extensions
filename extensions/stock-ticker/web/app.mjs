// web/app.mjs — Preact view for the Stock Ticker canvas.
//
// Two kinds of state, deliberately separated:
//   * SHARED domain state (symbols + quotes) arrives over /events (SSE) and is
//     the same data the agent mutates. mountCanvas re-renders on every push.
//   * LOCAL UI state (the add-symbol draft, sort, filter, auto-refresh cadence,
//     inline alias edit) lives in Preact useState. Because Preact DIFFS the DOM
//     instead of replacing innerHTML, a live state push does NOT clobber the
//     text you're typing or move your caret.
//
// All network I/O lives server-side in canvas.mjs. The view never fetches a
// quote itself — it only calls invoke("refresh_quotes") and renders the result.

import {
  html, mountCanvas, useState, useEffect, Icon,
  pollWhileVisible, compactNumber, relativeTime, percent,
} from "/kit/client.mjs";

const SORTS = [
  { id: "watchlist", label: "List" },
  { id: "change", label: "% Change" },
  { id: "price", label: "Price" },
  { id: "symbol", label: "A–Z" },
];
const FILTERS = ["all", "gainers", "losers"];
const RANGES = ["1d", "5d", "1mo"];
const AUTO = [
  { secs: 0, label: "Off" },
  { secs: 15, label: "15s" },
  { secs: 30, label: "30s" },
  { secs: 60, label: "60s" },
];

// ---- formatting -----------------------------------------------------------
function fmtPrice(v, cur) {
  if (v == null) return "—";
  const digits = Math.abs(v) < 1 ? 4 : 2;
  const s = v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return cur ? html`${s}<span class="st-cur">${cur}</span>` : s;
}
function fmtNum(v) {
  if (v == null) return "—";
  const digits = Math.abs(v) < 1 ? 4 : 2;
  return v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtSigned(v) {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${fmtNum(v)}`;
}
// % change, compact volume, and relative "updated" time now come from the kit:
//   fmtPct  -> percent        (signed, 2-digit, "—" fallback — identical output)
//   fmtVol  -> compactNumber  (compact notation, 2-digit, "—" fallback)
//   fmtTime -> relativeTime   (shows staleness, e.g. "5m ago", "never" when unset)
// fmtNum/fmtSigned/fmtPrice stay local — variable-precision + currency span have
// no kit equivalent.

function dir(change) {
  return change > 0 ? "up" : change < 0 ? "down" : "flat";
}
function chgClass(change) {
  return change > 0 ? "st-pos" : change < 0 ? "st-neg" : "st-neu";
}
function chgIcon(change) {
  return change > 0 ? "trending-up" : change < 0 ? "trending-down" : "minus";
}

// ---- sparkline ------------------------------------------------------------
function Sparkline({ values, change }) {
  const pts = (values ?? []).filter((v) => typeof v === "number" && isFinite(v));
  if (pts.length < 2) return html`<div class="st-spark"></div>`;
  const W = 100, H = 40, pad = 3;
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = max - min || 1;
  const stepX = (W - pad * 2) / (pts.length - 1);
  const coords = pts.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (H - pad * 2) * (1 - (v - min) / span);
    return [x, y];
  });
  const line = coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${pad},${H - pad} ${line} ${(W - pad).toFixed(2)},${H - pad}`;
  const stroke = change > 0 ? "var(--ck-success)" : change < 0 ? "var(--ck-danger)" : "var(--ck-muted)";
  const id = `g${Math.abs(min * 1000 | 0)}${pts.length}`;
  return html`
    <svg class="st-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id=${id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color=${stroke} stop-opacity="0.28" />
          <stop offset="100%" stop-color=${stroke} stop-opacity="0" />
        </linearGradient>
      </defs>
      <polygon points=${area} fill=${`url(#${id})`} stroke="none" />
      <polyline points=${line} fill="none" stroke=${stroke} stroke-width="1.5"
        stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
    </svg>
  `;
}

// ---- ticker tape ----------------------------------------------------------
function TapeItem({ row }) {
  const q = row.q;
  const label = row.alias || row.symbol;
  if (!q || q.price == null) {
    return html`<span class="st-tape-item ${q?.error ? "st-fade" : ""}">
      <span class="st-tape-sym">${label}</span>
      <span class="ck-muted">${q?.error ? "err" : "…"}</span>
    </span>`;
  }
  return html`<span class="st-tape-item">
    <span class="st-tape-sym">${label}</span>
    <span class="st-tape-px">${fmtNum(q.price)}</span>
    <span class=${`st-chg ${chgClass(q.change)}`}>
      <${Icon} name=${chgIcon(q.change)} size=${12} />${percent(q.changePct)}
    </span>
  </span>`;
}

function TickerTape({ rows }) {
  const priced = rows.filter((r) => r.q && r.q.price != null);
  if (!priced.length) return null;
  const loop = [...priced, ...priced]; // duplicate for a seamless marquee
  return html`
    <div class="st-tape" role="marquee" aria-label="Live ticker tape">
      <div class="st-tape-track">
        ${loop.map((row, i) => html`<${TapeItem} key=${i} row=${row} />`)}
      </div>
    </div>
  `;
}

// ---- add control ----------------------------------------------------------
function AddSymbol({ invoke, onAdded }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function add() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr("");
    try {
      await invoke("add_symbol", { symbol: t });
      setText("");
      onAdded?.();
    } catch (e) {
      setErr(e?.message || "could not add");
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div class="ck-row st-add-wrap" style="gap:6px">
      <input
        class="ck-input st-add"
        placeholder="Add symbol (AAPL, BTC-USD…)"
        value=${text}
        spellcheck="false"
        onInput=${(e) => setText(e.target.value)}
        onKeyDown=${(e) => { if (e.key === "Enter") add(); }}
      />
      <button class="ck-btn ck-btn-primary" disabled=${!text.trim() || busy} onClick=${add}>
        <${Icon} name="plus" size=${16} />Add
      </button>
      ${err ? html`<span class="ck-caption st-neg">${err}</span>` : null}
    </div>
  `;
}

// ---- one quote card -------------------------------------------------------
function QuoteCard({ row, invoke, dnd }) {
  const q = row.q;
  const [editing, setEditing] = useState(false);
  const [alias, setAlias] = useState(row.alias || "");

  async function saveAlias() {
    await invoke("set_alias", { symbol: row.symbol, alias: alias.trim() });
    setEditing(false);
  }

  // Drag-and-drop reordering. Only the whole card is draggable (gated on dnd.enabled
  // and not while editing the alias, so text selection in the input still works).
  const dragEnabled = !!dnd?.enabled && !editing;
  const dragCls = `${dnd?.dragging ? " st-dragging" : ""}${dnd?.over ? " st-drag-over" : ""}`;
  const dragProps = dnd?.enabled
    ? {
        draggable: dragEnabled,
        onDragStart: (e) => {
          if (!dragEnabled) return;
          e.dataTransfer.effectAllowed = "move";
          try { e.dataTransfer.setData("text/plain", row.symbol); } catch {}
          dnd.onStart(row.symbol);
        },
        onDragEnter: (e) => { e.preventDefault(); dnd.onEnter(row.symbol); },
        onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; },
        onDrop: (e) => { e.preventDefault(); dnd.onDrop(row.symbol); },
        onDragEnd: () => dnd.onEnd(),
      }
    : {};

  const grip = dnd?.enabled
    ? html`<span class="st-grip" title="Drag to reorder" aria-hidden="true">
        <${Icon} name="grip-vertical" size=${16} />
      </span>`
    : null;

  if (!q || q.price == null) {
    return html`
      <div class=${`ck-card st-card ${q?.error ? "st-err" : "st-flat"}${dragCls}`} ...${dragProps}>
        <div class="ck-spread st-card-top">
          <div class="ck-row" style="gap:6px;min-width:0">
            ${grip}
            <div>
              <div class="st-sym">${row.alias || row.symbol}</div>
              ${row.alias ? html`<div class="st-ex ck-muted">${row.symbol}</div>` : null}
            </div>
          </div>
          <button class="ck-btn ck-btn-sm ck-btn-danger" title="Remove"
            onClick=${() => invoke("remove_symbol", { symbol: row.symbol })}>
            <${Icon} name="trash-2" size=${14} />
          </button>
        </div>
        <div class="ck-row" style="gap:6px">
          ${q?.error
            ? html`<${Icon} name="triangle-alert" size=${14} /><span class="ck-caption">${q.error}</span>`
            : html`<span class="ck-caption ck-muted">Loading quote…</span>`}
        </div>
      </div>
    `;
  }

  const d = dir(q.change);
  return html`
    <div class=${`ck-card st-card st-${d}${dragCls}`} ...${dragProps}>
      <div class="ck-spread st-card-top">
        <div class="ck-row" style="gap:6px;min-width:0">
          ${grip}
          <div style="min-width:0">
            <div class="ck-row" style="gap:6px">
              <span class="st-sym">${row.alias || q.symbol}</span>
              ${q.exchange ? html`<span class="st-ex ck-muted">${q.exchange}</span>` : null}
            </div>
            <div class="st-name ck-muted" title=${q.name}>${row.alias ? `${q.symbol} · ${q.name}` : q.name}</div>
          </div>
        </div>
        <div class="ck-row st-card-actions">
          <button class="ck-btn ck-btn-sm" title="Edit label" onClick=${() => { setAlias(row.alias || ""); setEditing((v) => !v); }}>
            <${Icon} name="pencil" size=${13} />
          </button>
          <button class="ck-btn ck-btn-sm ck-btn-danger" title="Remove"
            onClick=${() => invoke("remove_symbol", { symbol: row.symbol })}>
            <${Icon} name="trash-2" size=${13} />
          </button>
        </div>
      </div>

      ${editing
        ? html`<div class="ck-row" style="gap:6px">
            <input class="ck-input st-alias-in" placeholder="Custom label" value=${alias}
              onInput=${(e) => setAlias(e.target.value)}
              onKeyDown=${(e) => { if (e.key === "Enter") saveAlias(); if (e.key === "Escape") setEditing(false); }} />
            <button class="ck-btn ck-btn-sm ck-btn-primary" onClick=${saveAlias}>Save</button>
            <button class="ck-btn ck-btn-sm" onClick=${() => setEditing(false)}>Cancel</button>
          </div>`
        : null}

      <div class="ck-spread" style="align-items:flex-end">
        <div class="st-price">${fmtPrice(q.price, q.currency)}</div>
        <div class=${`st-chg ${chgClass(q.change)}`}>
          <${Icon} name=${chgIcon(q.change)} size=${16} />
          ${fmtSigned(q.change)} (${percent(q.changePct)})
        </div>
      </div>

      <${Sparkline} values=${q.spark} change=${q.change} />

      <div class="st-stats">
        <div class="st-stat"><span class="st-stat-k">Day</span><span class="st-stat-v">${fmtNum(q.dayLow)}–${fmtNum(q.dayHigh)}</span></div>
        <div class="st-stat"><span class="st-stat-k">Vol</span><span class="st-stat-v">${compactNumber(q.volume)}</span></div>
        <div class="st-stat"><span class="st-stat-k">52w</span><span class="st-stat-v">${fmtNum(q.week52Low)}–${fmtNum(q.week52High)}</span></div>
        <div class="st-stat"><span class="st-stat-k">Prev</span><span class="st-stat-v">${fmtNum(q.prevClose)}</span></div>
      </div>
    </div>
  `;
}

// ---- app ------------------------------------------------------------------
function App({ state, invoke, connected }) {
  const [sort, setSort] = useState("watchlist");
  const [filter, setFilter] = useState("all");
  const [autoSecs, setAutoSecs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dragSym, setDragSym] = useState(null);
  const [overSym, setOverSym] = useState(null);

  // Auto-refresh loop. Delegated to the kit's pollWhileVisible so a backgrounded
  // panel stops polling Yahoo (it returns a useEffect-ready cleanup; autoSecs<=0
  // is a no-op). invoke is stable across renders.
  useEffect(() => { invoke("refresh_quotes").catch(() => {}); }, []);
  useEffect(
    () => pollWhileVisible(() => invoke("refresh_quotes"), autoSecs),
    [autoSecs],
  );

  if (!state) return html`<p class="ck-muted">Loading…</p>`;

  const quotes = state.quotes ?? {};
  const range = state.range ?? "1d";
  let rows = (state.symbols ?? []).map((s) => ({ ...s, q: quotes[s.symbol] }));

  if (filter === "gainers") rows = rows.filter((r) => (r.q?.changePct ?? 0) > 0);
  else if (filter === "losers") rows = rows.filter((r) => (r.q?.changePct ?? 0) < 0);

  const tapeRows = (state.symbols ?? []).map((s) => ({ ...s, q: quotes[s.symbol] }));

  if (sort === "symbol") rows = [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol));
  else if (sort === "price") rows = [...rows].sort((a, b) => (b.q?.price ?? -Infinity) - (a.q?.price ?? -Infinity));
  else if (sort === "change") rows = [...rows].sort((a, b) => (b.q?.changePct ?? -Infinity) - (a.q?.changePct ?? -Infinity));

  const gainers = tapeRows.filter((r) => (r.q?.changePct ?? 0) > 0).length;
  const losers = tapeRows.filter((r) => (r.q?.changePct ?? 0) < 0).length;

  async function manualRefresh() {
    setBusy(true);
    try { await invoke("refresh_quotes"); } finally { setBusy(false); }
  }

  // Drag-and-drop is only meaningful in unsorted, unfiltered "List" view — when a
  // sort or filter is active the on-screen order isn't the stored order.
  const dndEnabled = sort === "watchlist" && filter === "all";

  function reorderTo(targetSym) {
    const from = dragSym;
    setDragSym(null);
    setOverSym(null);
    if (!from || from === targetSym) return;
    const order = (state.symbols ?? []).map((s) => s.symbol);
    const fromIdx = order.indexOf(from);
    if (fromIdx < 0) return;
    order.splice(fromIdx, 1);
    let insertIdx = order.indexOf(targetSym);
    if (insertIdx < 0) insertIdx = order.length;
    order.splice(insertIdx, 0, from);
    invoke("reorder_symbols", { order }).catch(() => {});
  }

  const dndFor = (sym) => ({
    enabled: dndEnabled,
    dragging: dragSym === sym,
    over: overSym === sym && dragSym !== sym,
    onStart: (s) => setDragSym(s),
    onEnter: (s) => setOverSym((cur) => (cur === s ? cur : s)),
    onEnd: () => { setDragSym(null); setOverSym(null); },
    onDrop: (s) => reorderTo(s),
  });

  return html`
    <div>
      <div class="ck-spread st-head">
        <div class="ck-row" style="gap:8px">
          <${Icon} name="chart-no-axes-combined" size=${20} />
          <h1 style="margin:0">Stock Ticker</h1>
          <span class="ck-caption">${gainers}▲ · ${losers}▼</span>
        </div>
        <span class="ck-status">
          <span class=${`ck-dot ${connected ? "ck-dot-live" : "ck-dot-off"}`}></span>
          ${connected ? "live" : "reconnecting…"}
        </span>
      </div>

      <${TickerTape} rows=${tapeRows} />

      <div class="ck-spread st-controls">
        <${AddSymbol} invoke=${invoke} onAdded=${manualRefresh} />
        <div class="ck-row" style="gap:8px">
          <button class="ck-btn" disabled=${busy} onClick=${manualRefresh} title="Refresh quotes now">
            <${Icon} name="refresh-cw" size=${14} />${busy ? "Refreshing…" : "Refresh"}
          </button>
          <select class="ck-select" style="width:auto" value=${String(autoSecs)}
            onChange=${(e) => setAutoSecs(Number(e.target.value))} title="Auto-refresh">
            ${AUTO.map((a) => html`<option value=${String(a.secs)}>Auto: ${a.label}</option>`)}
          </select>
        </div>
      </div>

      <div class="ck-spread st-sub" style="margin-bottom:12px">
        <div class="ck-row" style="gap:10px;flex-wrap:wrap">
          <div class="ck-tabs" role="tablist" aria-label="Filter">
            ${FILTERS.map((f) => html`
              <button class="ck-tab" role="tab" aria-selected=${String(filter === f)} onClick=${() => setFilter(f)}>${f}</button>
            `)}
          </div>
          <div class="ck-tabs" role="tablist" aria-label="Sort">
            ${SORTS.map((s) => html`
              <button class="ck-tab" role="tab" aria-selected=${String(sort === s.id)} onClick=${() => setSort(s.id)}>${s.label}</button>
            `)}
          </div>
          <div class="ck-tabs" role="tablist" aria-label="Sparkline range">
            ${RANGES.map((r) => html`
              <button class="ck-tab" role="tab" aria-selected=${String(range === r)}
                onClick=${() => invoke("set_range", { range: r }).then(manualRefresh)}>${r}</button>
            `)}
          </div>
        </div>
        <span class="ck-caption">
          ${dndEnabled
            ? html`<span class="st-hint"><${Icon} name="grip-vertical" size=${12} />Drag to reorder · </span>`
            : null}
          Updated ${relativeTime(state.lastRefresh, { fallback: "never" })}
        </span>
      </div>

      <div class="st-grid">
        ${rows.length
          ? rows.map((row) => html`<${QuoteCard} key=${row.symbol} row=${row} invoke=${invoke} dnd=${dndFor(row.symbol)} />`)
          : html`<div class="ck-empty">
              <${Icon} name="search" size=${20} />
              ${(state.symbols ?? []).length ? `No ${filter} right now.` : "Watchlist is empty — add a symbol to start."}
            </div>`}
      </div>
    </div>
  `;
}

mountCanvas({ view: (model) => html`<${App} ...${model} />` });
