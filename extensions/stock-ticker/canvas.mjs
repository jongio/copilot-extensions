// canvas.mjs — Stock Ticker canvas definition (kit config; SDK-free).
//
// A shared, personalized stock watchlist: the agent and the user read/write the
// SAME state through the SAME action handlers. State is durable per-user and
// keyed by a "domain" resolved from the open input (defaults to "default"), so
// you can keep separate lists (e.g. "tech", "energy") and open the same one in
// multiple panels in sync.
//
// Live quotes come from the public Yahoo Finance chart endpoint (no API key).
// All network I/O happens here, server-side, so the browser view stays a pure
// renderer that only calls invoke("refresh_quotes").

import { fileURLToPath } from "node:url";
import { userStore } from "./canvas-kit/storage.mjs";

const EXT_NAME = "stock-ticker";

const RANGES = {
  "1d": { range: "1d", interval: "5m" },
  "5d": { range: "5d", interval: "30m" },
  "1mo": { range: "1mo", interval: "1d" },
};

const DEFAULT_SYMBOLS = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN"];

const SPARK_POINTS = 40; // downsample sparkline to keep state small

function fileFor(domainId) {
  const safe = String(domainId).replace(/[^A-Za-z0-9._-]/g, "_") || "default";
  return userStore(EXT_NAME, `${safe}.json`);
}

function normSymbol(raw) {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function num(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}

// Downsample an array of numbers to at most `n` evenly spaced, finite points.
function downsample(values, n = SPARK_POINTS) {
  const clean = (values ?? []).filter((v) => typeof v === "number" && isFinite(v));
  if (clean.length <= n) return clean;
  const step = (clean.length - 1) / (n - 1);
  const out = [];
  for (let i = 0; i < n; i++) out.push(clean[Math.round(i * step)]);
  return out;
}

// Fetch one chart window from Yahoo Finance, returning { meta, closes }.
async function fetchChart(symbol, rangeKey) {
  const { range, interval } = RANGES[rangeKey] ?? RANGES["1d"];
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${interval}&range=${range}`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result?.meta) {
    const msg = json?.chart?.error?.description || "no data";
    throw new Error(msg);
  }
  return { meta: result.meta, closes: result.indicators?.quote?.[0]?.close ?? [] };
}

// Fetch one symbol's live quote + sparkline.
//
// The day's change is ALWAYS computed from the canonical 1d window so it stays a
// true daily move regardless of the selected sparkline range. When the user
// picks a longer sparkline window (5d/1mo) we fetch that separately just for the
// line; if it fails we fall back to the 1d intraday spark.
async function fetchQuote(symbol, rangeKey) {
  const day = await fetchChart(symbol, "1d");
  const m = day.meta;
  const price = num(m.regularMarketPrice);
  const prev = num(m.chartPreviousClose) ?? num(m.previousClose);
  if (price == null) throw new Error("no price");

  let spark = downsample(day.closes);
  if (rangeKey && rangeKey !== "1d") {
    try {
      const win = await fetchChart(symbol, rangeKey);
      const ds = downsample(win.closes);
      if (ds.length > 1) spark = ds;
    } catch {
      /* keep the 1d intraday spark */
    }
  }

  const change = prev != null ? price - prev : null;
  const changePct = prev ? (change / prev) * 100 : null;

  return {
    symbol: m.symbol || symbol,
    name: m.longName || m.shortName || symbol,
    exchange: m.fullExchangeName || m.exchangeName || "",
    currency: m.currency || "USD",
    price,
    prevClose: prev ?? null,
    change,
    changePct,
    dayHigh: num(m.regularMarketDayHigh),
    dayLow: num(m.regularMarketDayLow),
    week52High: num(m.fiftyTwoWeekHigh),
    week52Low: num(m.fiftyTwoWeekLow),
    volume: num(m.regularMarketVolume),
    marketTime: m.regularMarketTime ? m.regularMarketTime * 1000 : null,
    spark,
    error: null,
  };
}

export const canvasConfig = {
  id: "stock-ticker",
  displayName: "Stock Ticker",
  description:
    "A personalized live stock watchlist. The agent and user share the same list: " +
    "add or remove symbols, set custom aliases, switch the sparkline range, and refresh " +
    "live quotes (price, change, day and 52-week range, volume). Stays in sync live.",
  assetsDir: fileURLToPath(new URL("./web/", import.meta.url)),

  inputSchema: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        description:
          "Which watchlist to open (e.g. 'tech', 'energy'). Omit for the default list.",
      },
    },
    additionalProperties: false,
  },

  resolveDomainId: (input) => (input?.domain ? String(input.domain) : "default"),

  createInitialState: (ctx) => ({
    domain: ctx?.input?.domain ?? "default",
    symbols: DEFAULT_SYMBOLS.map((s) => ({
      symbol: s,
      alias: "",
      addedAt: new Date().toISOString(),
    })),
    quotes: {},
    range: "1d",
    lastRefresh: null,
  }),

  loadState: async (domainId) => fileFor(domainId).load(null),
  saveState: async (domainId, state) => fileFor(domainId).save(state),

  statusLine: (_ctx, state) => {
    const n = state.symbols?.length ?? 0;
    const up = Object.values(state.quotes ?? {}).filter((q) => (q?.change ?? 0) > 0).length;
    const down = Object.values(state.quotes ?? {}).filter((q) => (q?.change ?? 0) < 0).length;
    return `${n} symbol${n === 1 ? "" : "s"} · ${up}\u25B2 ${down}\u25BC`;
  },

  actions: {
    add_symbol: {
      description:
        "Add a ticker symbol to the watchlist (e.g. AAPL, MSFT, BTC-USD, ^GSPC). " +
        "Optionally give it a custom display alias.",
      inputSchema: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Ticker symbol, e.g. AAPL." },
          alias: {
            type: "string",
            description: "Optional custom label shown instead of the symbol.",
          },
        },
        required: ["symbol"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const symbol = normSymbol(input.symbol);
        if (!symbol) throw new Error("symbol is required");
        if (state.symbols.some((s) => s.symbol === symbol)) {
          throw new Error(`${symbol} is already on the watchlist`);
        }
        const entry = {
          symbol,
          alias: input.alias ? String(input.alias).trim() : "",
          addedAt: new Date().toISOString(),
        };
        set({ ...state, symbols: [...state.symbols, entry] });
        return { symbol, status: `Added ${symbol}` };
      },
    },

    remove_symbol: {
      description: "Remove a ticker symbol from the watchlist.",
      inputSchema: {
        type: "object",
        properties: { symbol: { type: "string" } },
        required: ["symbol"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const symbol = normSymbol(input.symbol);
        const symbols = state.symbols.filter((s) => s.symbol !== symbol);
        if (symbols.length === state.symbols.length) {
          throw new Error(`${symbol} is not on the watchlist`);
        }
        const quotes = { ...state.quotes };
        delete quotes[symbol];
        set({ ...state, symbols, quotes });
        return { removed: symbol };
      },
    },

    set_alias: {
      description: "Set or clear the custom display alias for a symbol.",
      inputSchema: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          alias: { type: "string", description: "New label. Pass empty to clear." },
        },
        required: ["symbol"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const symbol = normSymbol(input.symbol);
        let found = false;
        const symbols = state.symbols.map((s) => {
          if (s.symbol !== symbol) return s;
          found = true;
          return { ...s, alias: input.alias ? String(input.alias).trim() : "" };
        });
        if (!found) throw new Error(`${symbol} is not on the watchlist`);
        set({ ...state, symbols });
        return { ok: true, symbol };
      },
    },

    reorder_symbols: {
      description:
        "Reorder the watchlist. Pass the full set of symbols in the desired display " +
        "order; any symbols you omit keep their current relative order at the end.",
      inputSchema: {
        type: "object",
        properties: {
          order: {
            type: "array",
            items: { type: "string" },
            description: "Symbols in the desired top-to-bottom order.",
          },
        },
        required: ["order"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const order = (input.order ?? []).map(normSymbol).filter(Boolean);
        const bySym = new Map(state.symbols.map((s) => [s.symbol, s]));
        const seen = new Set();
        const next = [];
        for (const sym of order) {
          const entry = bySym.get(sym);
          if (entry && !seen.has(sym)) {
            next.push(entry);
            seen.add(sym);
          }
        }
        for (const s of state.symbols) {
          if (!seen.has(s.symbol)) {
            next.push(s);
            seen.add(s.symbol);
          }
        }
        set({ ...state, symbols: next });
        return { ok: true, order: next.map((s) => s.symbol) };
      },
    },

    set_range: {
      description: "Set the sparkline time window for all symbols (1d, 5d, or 1mo).",
      inputSchema: {
        type: "object",
        properties: { range: { type: "string", enum: Object.keys(RANGES) } },
        required: ["range"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const range = RANGES[input.range] ? input.range : "1d";
        set({ ...state, range });
        return { range };
      },
    },

    refresh_quotes: {
      description:
        "Fetch the latest live quote and sparkline for every symbol on the watchlist " +
        "and update the canvas. Returns a short summary.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async ({ state, set }) => {
        const rangeKey = state.range ?? "1d";
        const symbols = state.symbols.map((s) => s.symbol);
        if (!symbols.length) {
          set({ ...state, lastRefresh: new Date().toISOString() });
          return { summary: "Watchlist is empty.", count: 0 };
        }

        const settled = await Promise.allSettled(
          symbols.map((s) => fetchQuote(s, rangeKey))
        );

        const quotes = { ...state.quotes };
        let ok = 0;
        let failed = 0;
        settled.forEach((r, i) => {
          const symbol = symbols[i];
          if (r.status === "fulfilled") {
            quotes[symbol] = { ...r.value, fetchedAt: Date.now() };
            ok++;
          } else {
            quotes[symbol] = {
              ...(quotes[symbol] || { symbol }),
              error: String(r.reason?.message ?? r.reason ?? "fetch failed"),
              fetchedAt: Date.now(),
            };
            failed++;
          }
        });

        set({ ...state, quotes, lastRefresh: new Date().toISOString() });
        return {
          count: symbols.length,
          ok,
          failed,
          summary:
            `Refreshed ${ok}/${symbols.length} quote${symbols.length === 1 ? "" : "s"}` +
            (failed ? ` (${failed} failed)` : ""),
        };
      },
    },

    list_quotes: {
      description:
        "Return a text summary of the current watchlist and last-known quotes (for the agent).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: ({ state }) => {
        if (!state.symbols.length) return { summary: "Watchlist is empty.", count: 0 };
        const lines = state.symbols.map((s) => {
          const q = state.quotes?.[s.symbol];
          const label = s.alias ? `${s.alias} (${s.symbol})` : s.symbol;
          if (!q || q.price == null) {
            return `- ${label}: ${q?.error ? `error: ${q.error}` : "no quote yet"}`;
          }
          const arrow = (q.change ?? 0) > 0 ? "\u25B2" : (q.change ?? 0) < 0 ? "\u25BC" : "\u2022";
          const pct =
            q.changePct != null
              ? `${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%`
              : "";
          return `- ${label}: ${q.price.toFixed(2)} ${q.currency} ${arrow} ${pct}`;
        });
        return {
          count: state.symbols.length,
          lastRefresh: state.lastRefresh,
          summary: lines.join("\n"),
        };
      },
    },
  },
};
