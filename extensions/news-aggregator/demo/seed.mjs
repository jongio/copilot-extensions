// demo/seed.mjs - generate a rich, offline News Aggregator board for demos and
// screenshots without committing any state JSON.
//
// buildDemoState() returns a complete modern feed in memory. The CLI writes it to
// <COPILOT_HOME>/extensions/news-aggregator/artifacts/<domain>.json using the same
// write-temp-then-atomic-rename discipline as the kit storage.
//
// Launch demo mode:
//   node demo/seed.mjs
//   node demo/seed.mjs --domain demo
//   node demo/seed.mjs --home <dir>
// then open the canvas with input { domain: "demo" }.

import { mkdir, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const EXTENSION_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const REFRESHED = "2026-07-07T16:45:00.000Z";
const DIGEST_AT = "2026-07-07T16:46:30.000Z";
const SAVED_AT = "2026-07-07T16:47:00.000Z";
const FAVORITED_AT = "2026-07-07T16:47:30.000Z";
const HIDDEN_AT = "2026-07-07T16:48:00.000Z";

const ARTICLES = [
  {
    id: "demo-a-orbit-ai",
    title: "Open orbital lab uses AI scheduler to cut satellite idle time",
    link: "https://example.com/news/open-orbital-lab-ai-scheduler",
    source: "Tech Ledger",
    sourceHost: "techledger.example",
    publishedAt: Date.parse("2026-07-07T16:10:00.000Z"),
  },
  {
    id: "demo-a-chip-cooling",
    title: "New liquid cooling design lets compact AI chips train longer",
    link: "https://example.com/news/liquid-cooling-ai-chips",
    source: "Silicon Daily",
    sourceHost: "silicondaily.example",
    publishedAt: Date.parse("2026-07-07T15:42:00.000Z"),
  },
  {
    id: "demo-a-rural-broadband",
    title: "Rural broadband grants fund open source network monitors",
    link: "https://example.com/news/rural-broadband-open-source-monitors",
    source: "Civic Wire",
    sourceHost: "civicwire.example",
    publishedAt: Date.parse("2026-07-07T15:15:00.000Z"),
  },
  {
    id: "demo-a-robot-warehouse",
    title: "Warehouse robot fleet adds safety model for shared aisles",
    link: "https://example.com/news/warehouse-robot-safety-model",
    source: "Automation Review",
    sourceHost: "automationreview.example",
    publishedAt: Date.parse("2026-07-07T14:58:00.000Z"),
  },
  {
    id: "demo-a-climate-grid",
    title: "Climate startup predicts grid stress from rooftop solar swings",
    link: "https://example.com/news/climate-startup-grid-stress-solar",
    source: "Energy Signal",
    sourceHost: "energysignal.example",
    publishedAt: Date.parse("2026-07-07T14:31:00.000Z"),
  },
  {
    id: "demo-a-developer-tools",
    title: "Developer tools team ships local replay for flaky cloud jobs",
    link: "https://example.com/news/local-replay-flaky-cloud-jobs",
    source: "DevOps Journal",
    sourceHost: "devopsjournal.example",
    publishedAt: Date.parse("2026-07-07T14:07:00.000Z"),
  },
  {
    id: "demo-a-health-wearable",
    title: "Health wearable study finds better alerts with on-device models",
    link: "https://example.com/news/health-wearable-on-device-models",
    source: "Health Byte",
    sourceHost: "healthbyte.example",
    publishedAt: Date.parse("2026-07-07T13:38:00.000Z"),
  },
  {
    id: "demo-a-space-sensors",
    title: "Space sensors spot tiny debris before it reaches crew capsules",
    link: "https://example.com/news/space-sensors-debris-capsules",
    source: "Orbit Times",
    sourceHost: "orbittimes.example",
    publishedAt: Date.parse("2026-07-07T13:12:00.000Z"),
  },
];

function articleById(id) {
  return ARTICLES.find((a) => a.id === id);
}

function markFor(id, flags) {
  const a = articleById(id);
  return { id, title: a.title, link: a.link, source: a.source, sourceHost: a.sourceHost, publishedAt: a.publishedAt, ...flags };
}

/**
 * Build a complete News Aggregator demo state in memory. No disk I/O.
 * @param {object} [opts]
 * @param {string} [opts.domain] feed domain/key (default: "demo")
 * @returns {object} a feed state ready to serialize into the artifacts store
 */
export function buildDemoState({ domain = "demo" } = {}) {
  return {
    domain,
    activeId: "technology",
    mode: "topic",
    query: "",
    articles: ARTICLES.map((a) => ({ ...a })),
    error: null,
    lastRefresh: REFRESHED,
    view: "feed",
    autoRefreshSec: 60,
    marks: {
      "demo-a-orbit-ai": markFor("demo-a-orbit-ai", { saved: true, savedAt: SAVED_AT }),
      "demo-a-chip-cooling": markFor("demo-a-chip-cooling", { favorite: true, favoritedAt: FAVORITED_AT }),
      "demo-a-space-sensors": markFor("demo-a-space-sensors", { hidden: true, hiddenAt: HIDDEN_AT }),
    },
    searchHistory: [
      { query: "AI chip cooling", at: "2026-07-07T16:30:00.000Z" },
      { query: "orbital debris sensors", at: "2026-07-07T16:12:00.000Z" },
      { query: "open source network monitors", at: "2026-07-07T15:55:00.000Z" },
      { query: "climate grid forecasting", at: "2026-07-07T15:20:00.000Z" },
    ],
    pinnedTopics: [
      {
        id: "pin_demo_ai_chips",
        label: "AI Chips",
        query: "AI chip cooling",
        icon: "cpu",
        createdAt: "2026-07-07T16:32:00.000Z",
      },
    ],
    digest: {
      text:
        "Technology headlines are centered on practical AI infrastructure: faster chip cooling, safer robot operations, and local tools for cloud reliability. The most important story is the orbital lab scheduler, which shows AI moving from demos into operational systems that save real capacity.",
      pending: false,
      error: null,
      label: "Technology",
      at: DIGEST_AT,
      refreshToken: REFRESHED,
    },
  };
}

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
  return join(base, "extensions", "news-aggregator", "artifacts", `${safe}.json`);
}

/**
 * Write a demo feed to <home>/extensions/news-aggregator/artifacts/<domain>.json.
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
      "Seed a News Aggregator demo feed.\n\n" +
        "  node demo/seed.mjs [--domain <name>] [--home <dir>]\n\n" +
        'Then open the News Aggregator canvas with input { domain: "<name>" }.',
    );
    return;
  }
  const file = await seedDemoBoard({ home: args.home, domain: args.domain });
  console.log(`Seeded demo feed (domain "${args.domain}") -> ${file}`);
  console.log(`Open the News Aggregator canvas with input { "domain": "${args.domain}" } to view it.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`seed failed: ${err?.message ?? err}`);
    process.exit(1);
  });
}
