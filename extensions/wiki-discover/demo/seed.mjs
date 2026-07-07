// demo/seed.mjs - generate a rich Wiki Discover profile for demos and screenshots.
//
// buildDemoState() returns a complete profile in memory. Nothing is written to
// disk unless this file is run as a CLI, which seeds the profile into the canvas
// runtime artifacts store.
//
// Launch demo mode:
//   node demo/seed.mjs
//   node demo/seed.mjs --domain demo
//   node demo/seed.mjs --home <dir>
// then open the canvas with input { profile: "demo" }.

import { mkdir, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const EXTENSION_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const REFRESHED = "2026-01-15T10:00:00.000Z";
const HISTORY_TS = "2026-01-15T09:42:00.000Z";

const CURRENT = {
  id: "demo-algorithmic-gardens",
  title: "Islamic geometric patterns",
  description: "mathematical decorative art",
  summary: "Geometric pattern traditions connect art, symmetry, and mathematics across architecture and craft.",
  extract:
    "Islamic geometric patterns are designs built from repeated circles, squares, stars, and polygons. They appear in architecture, manuscripts, tiles, and textiles, where symmetry and careful construction create complex art from simple shapes.",
  url: "https://en.wikipedia.org/wiki/Islamic_geometric_patterns",
  thumbnail: "",
  lang: "en",
  tokens: ["mathematical", "decorative", "art", "geometric", "patterns", "symmetry", "architecture"],
  matched: ["Mathematics", "Architecture"],
  score: 11.5,
  aiSummary:
    "This article connects math and visual design, showing how simple repeated shapes become rich patterns in architecture, tiles, manuscripts, and textiles.",
  aiSummaryPending: false,
  aiSummaryError: null,
  images: [],
  imagesLoaded: true,
};

const QUEUE = [
  {
    id: "demo-james-webb",
    title: "James Webb Space Telescope",
    description: "space observatory",
    extract: "A large infrared space telescope used to study distant galaxies, stars, and exoplanets.",
    url: "https://en.wikipedia.org/wiki/James_Webb_Space_Telescope",
    thumbnail: "",
    lang: "en",
    tokens: ["space", "observatory", "astronomy", "telescope", "galaxies"],
    matched: ["Astronomy", "Space exploration"],
    score: 13.25,
  },
  {
    id: "demo-roman-concrete",
    title: "Roman concrete",
    description: "ancient building material",
    extract: "A durable material used in Roman architecture and infrastructure.",
    url: "https://en.wikipedia.org/wiki/Roman_concrete",
    thumbnail: "",
    lang: "en",
    tokens: ["ancient", "building", "material", "roman", "architecture"],
    matched: ["Ancient Rome", "Architecture"],
    score: 10.75,
  },
  {
    id: "demo-bioluminescence",
    title: "Bioluminescence",
    description: "production and emission of light by living organisms",
    extract: "Light made by living organisms, including many marine animals and fungi.",
    url: "https://en.wikipedia.org/wiki/Bioluminescence",
    thumbnail: "",
    lang: "en",
    tokens: ["production", "emission", "light", "living", "organisms", "biology", "oceans"],
    matched: ["Biology", "Oceans"],
    score: 7.5,
  },
  {
    id: "demo-ukiyo-e",
    title: "Ukiyo-e",
    description: "genre of Japanese art",
    extract: "A Japanese printmaking and painting tradition that influenced modern visual culture.",
    url: "https://en.wikipedia.org/wiki/Ukiyo-e",
    thumbnail: "",
    lang: "en",
    tokens: ["genre", "japanese", "art", "painting", "culture"],
    matched: ["Japan", "Painting"],
    score: 5.6,
  },
  {
    id: "demo-transfer-window",
    title: "Transfer window",
    description: "sports administration period",
    extract: "A period when professional sports teams can transfer players.",
    url: "https://en.wikipedia.org/wiki/Transfer_window",
    thumbnail: "",
    lang: "en",
    tokens: ["sports", "administration", "period", "football"],
    matched: [],
    score: -2.25,
  },
];

const WEIGHTS = {
  astronomy: 4.25,
  space: 3.5,
  architecture: 2.75,
  mathematics: 2.5,
  biology: 1.5,
  art: 1.1,
  celebrity: -2,
  football: -1.5,
  politics: -1.25,
};

const LIKED = [
  { id: "demo-orion-nebula", title: "Orion Nebula", url: "https://en.wikipedia.org/wiki/Orion_Nebula", ts: HISTORY_TS },
  { id: "demo-pantheon", title: "Pantheon, Rome", url: "https://en.wikipedia.org/wiki/Pantheon,_Rome", ts: HISTORY_TS },
];

const DISLIKED = [
  { id: "demo-reality-tv", title: "Reality television", url: "https://en.wikipedia.org/wiki/Reality_television", ts: HISTORY_TS },
];

/**
 * Build a complete Wiki Discover demo profile in memory. No disk I/O.
 * @param {object} [opts]
 * @param {string} [opts.domain] profile key, default "demo"
 * @returns {object} a profile state ready to serialize into the artifacts store
 */
export function buildDemoState({ domain = "demo" } = {}) {
  return {
    profile: domain,
    lang: "en",
    interests: ["Astronomy", "Architecture", "Ancient Rome", "Mathematics", "Biology", "Japan"],
    current: { ...CURRENT },
    queue: QUEUE.map((item) => ({ ...item })),
    liked: LIKED.map((item) => ({ ...item })),
    disliked: DISLIKED.map((item) => ({ ...item })),
    seenIds: ["demo-orion-nebula", "demo-pantheon", "demo-reality-tv", CURRENT.id],
    weights: { ...WEIGHTS },
    stats: { rated: 7, liked: 2, meh: 2, disliked: 1 },
    error: null,
    lastRefresh: REFRESHED,
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
  return join(base, "extensions", "wiki-discover", "artifacts", `${safe}.json`);
}

/**
 * Write a demo profile to <home>/extensions/wiki-discover/artifacts/<domain>.json
 * using write-temp-then-atomic-rename.
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
      "Seed a Wiki Discover demo profile.\n\n" +
        "  node demo/seed.mjs [--domain <name>] [--home <dir>]\n\n" +
        'Then open the canvas with input { "profile": "<name>" } (default: demo).',
    );
    return;
  }
  const file = await seedDemoBoard({ home: args.home, domain: args.domain });
  console.log(`Seeded demo profile (domain "${args.domain}") -> ${file}`);
  console.log(`Open the Wiki Discover canvas with input { "profile": "${args.domain}" } to view it.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`seed failed: ${err?.message ?? err}`);
    process.exit(1);
  });
}
