// demo/seed.mjs - generate a rich, fully-populated Stock Ticker watchlist for demos and
// screenshots WITHOUT bundling any market data file in the extension.
//
// buildDemoState() returns a complete, modern watchlist in memory. Nothing here
// is written to disk unless you run this file as a CLI, which seeds the board
// into the runtime artifacts store.
//
// Launch demo mode:
//   node demo/seed.mjs                 # writes <COPILOT_HOME>/extensions/stock-ticker/artifacts/demo.json
//   node demo/seed.mjs --domain demo   # pick the watchlist domain (default: demo)
//   node demo/seed.mjs --home <dir>    # pick the COPILOT_HOME root (default: $COPILOT_HOME or ~/.copilot)
// then open the canvas with input { domain: "demo" }.

import { mkdir, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const EXTENSION_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ADDED = "2026-07-07T13:30:00.000Z";
const REFRESHED = "2026-07-07T17:00:00.000Z";
const MARKET_TIME = Date.parse("2026-07-07T16:00:00.000Z");
const FETCHED = Date.parse(REFRESHED);

const WATCHLIST = [
  { symbol: "NVDA", alias: "AI bellwether", addedAt: ADDED },
  { symbol: "MSFT", alias: "", addedAt: "2026-07-07T13:31:00.000Z" },
  { symbol: "AAPL", alias: "", addedAt: "2026-07-07T13:32:00.000Z" },
  { symbol: "AMZN", alias: "Retail cloud", addedAt: "2026-07-07T13:33:00.000Z" },
  { symbol: "GOOGL", alias: "", addedAt: "2026-07-07T13:34:00.000Z" },
  { symbol: "TSLA", alias: "Momentum watch", addedAt: "2026-07-07T13:35:00.000Z" },
];

const QUOTES = {
  NVDA: quote({
    symbol: "NVDA",
    name: "NVIDIA Corporation",
    exchange: "NasdaqGS",
    price: 142.64,
    prevClose: 138.92,
    dayLow: 139.88,
    dayHigh: 143.72,
    week52Low: 86.62,
    week52High: 153.13,
    volume: 48231500,
    spark: [136.8, 137.4, 138.1, 137.9, 139.0, 139.8, 140.6, 141.2, 140.9, 141.7, 142.1, 142.6, 142.4, 142.9, 143.2, 142.64],
  }),
  MSFT: quote({
    symbol: "MSFT",
    name: "Microsoft Corporation",
    exchange: "NasdaqGS",
    price: 504.18,
    prevClose: 497.76,
    dayLow: 498.4,
    dayHigh: 506.25,
    week52Low: 385.58,
    week52High: 513.37,
    volume: 23187000,
    spark: [492.9, 494.1, 495.5, 496.2, 497.0, 498.6, 500.2, 499.7, 501.1, 502.9, 503.4, 504.0, 503.6, 504.8, 505.3, 504.18],
  }),
  AAPL: quote({
    symbol: "AAPL",
    name: "Apple Inc.",
    exchange: "NasdaqGS",
    price: 214.37,
    prevClose: 216.05,
    dayLow: 212.81,
    dayHigh: 217.18,
    week52Low: 164.08,
    week52High: 237.49,
    volume: 60422000,
    spark: [218.2, 217.6, 216.8, 217.1, 216.0, 215.4, 214.9, 215.2, 214.3, 213.7, 214.1, 213.6, 214.0, 214.5, 214.2, 214.37],
  }),
  AMZN: quote({
    symbol: "AMZN",
    name: "Amazon.com, Inc.",
    exchange: "NasdaqGS",
    price: 226.91,
    prevClose: 224.12,
    dayLow: 223.55,
    dayHigh: 228.34,
    week52Low: 151.61,
    week52High: 233.0,
    volume: 35984000,
    spark: [220.7, 221.3, 222.1, 222.9, 223.5, 224.4, 224.1, 225.0, 225.8, 226.4, 225.9, 226.8, 227.2, 226.6, 227.1, 226.91],
  }),
  GOOGL: quote({
    symbol: "GOOGL",
    name: "Alphabet Inc.",
    exchange: "NasdaqGS",
    price: 196.28,
    prevClose: 198.74,
    dayLow: 194.95,
    dayHigh: 199.21,
    week52Low: 130.67,
    week52High: 207.05,
    volume: 28765000,
    spark: [200.1, 199.4, 198.8, 198.1, 197.5, 197.9, 197.0, 196.5, 195.9, 196.2, 195.7, 196.0, 196.4, 195.8, 196.1, 196.28],
  }),
  TSLA: quote({
    symbol: "TSLA",
    name: "Tesla, Inc.",
    exchange: "NasdaqGS",
    price: 318.44,
    prevClose: 322.81,
    dayLow: 314.2,
    dayHigh: 326.5,
    week52Low: 138.8,
    week52High: 414.5,
    volume: 91245000,
    spark: [329.2, 327.4, 325.1, 323.6, 324.4, 322.0, 320.7, 321.2, 319.6, 317.9, 318.5, 316.8, 317.4, 318.1, 317.7, 318.44],
  }),
};

function quote(input) {
  const change = Number((input.price - input.prevClose).toFixed(2));
  const changePct = Number(((change / input.prevClose) * 100).toFixed(4));
  return {
    symbol: input.symbol,
    name: input.name,
    exchange: input.exchange,
    currency: "USD",
    price: input.price,
    prevClose: input.prevClose,
    change,
    changePct,
    dayHigh: input.dayHigh,
    dayLow: input.dayLow,
    week52High: input.week52High,
    week52Low: input.week52Low,
    volume: input.volume,
    marketTime: MARKET_TIME,
    spark: input.spark,
    error: null,
    fetchedAt: FETCHED,
  };
}

/**
 * Build a complete Stock Ticker demo state in memory. No disk I/O.
 * @param {object} [opts]
 * @param {string} [opts.domain] watchlist domain/key (default: "demo")
 * @returns {object} a watchlist state ready to serialize into the artifacts store
 */
export function buildDemoState({ domain = "demo" } = {}) {
  return {
    domain,
    symbols: WATCHLIST.map((s) => ({ ...s })),
    quotes: Object.fromEntries(Object.entries(QUOTES).map(([symbol, q]) => [symbol, { ...q, spark: [...q.spark] }])),
    range: "5d",
    lastRefresh: REFRESHED,
    aiSummary: {
      text:
        "Mega-cap tech is mixed but constructive, with NVIDIA and Microsoft leading the tape while Apple, Alphabet, and Tesla lag. The watchlist has a growth tilt today: cloud and AI names are carrying the gains, while consumer hardware and higher-beta autos are softer.",
      pending: false,
      error: null,
      at: "2026-07-07T17:02:00.000Z",
    },
  };
}

// ---- CLI: seed the demo watchlist into the runtime artifacts store ------------

function parseArgs(argv) {
  const out = { home: null, domain: "demo" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--home") out.home = argv[++i] ?? null;
    else if (a === "--domain") out.domain = argv[++i] ?? "demo";
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function artifactPath(home, domain) {
  const base = home || process.env.COPILOT_HOME || join(homedir(), ".copilot");
  const safe = String(domain).replace(/[^A-Za-z0-9._-]/g, "_") || "demo";
  return join(base, "extensions", "stock-ticker", "artifacts", `${safe}.json`);
}

/**
 * Write a demo watchlist to <home>/extensions/stock-ticker/artifacts/<domain>.json,
 * using the same write-temp-then-atomic-rename discipline as the kit's storage.
 * @returns {Promise<string>} the file path written
 */
export async function seedDemoBoard({ home = null, domain = "demo" } = {}) {
  const file = artifactPath(home, domain);
  const state = buildDemoState({ domain });
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await rename(tmp, file);
  return file;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Seed a Stock Ticker demo watchlist.\n\n" +
        "  node demo/seed.mjs [--domain <name>] [--home <dir>]\n\n" +
        'Then open the canvas with input { domain: "<name>" } (default: demo).',
    );
    return;
  }
  const file = await seedDemoBoard({ home: args.home, domain: args.domain });
  console.log(`Seeded demo watchlist (domain "${args.domain}") -> ${file}`);
  console.log(`Open the Stock Ticker canvas with input { "domain": "${args.domain}" } to view it.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`seed failed: ${err?.message ?? err}`);
    process.exit(1);
  });
}
