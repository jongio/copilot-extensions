// demo/seed.mjs - generate a fully-populated Random Animal board for demos and
// screenshots WITHOUT bundling any state file in the extension.
//
// buildDemoState() returns a complete board in memory. Nothing here is written
// to disk unless you run this file as a CLI, which seeds the board into the
// runtime artifacts store.
//
// Launch demo mode:
//   node demo/seed.mjs                 # writes <COPILOT_HOME>/extensions/random-animal/artifacts/demo.json
//   node demo/seed.mjs --domain demo   # pick the board domain (default: demo)
//   node demo/seed.mjs --home <dir>    # pick the COPILOT_HOME root (default: $COPILOT_HOME or ~/.copilot)
// then open the canvas with input { domain: "demo" }.

import { mkdir, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const EXTENSION_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ROLLED = "2026-01-14T09:00:00.000Z";

const CURRENT = {
  id: "demo-current-otter",
  emoji: "🦦",
  name: "Otter",
  fact: "Sea otters hold hands while sleeping so they don't drift apart.",
  rolledAt: ROLLED,
  aiFact:
    "Sea otters tuck favorite rocks into loose underarm skin pockets and use them as tools to crack open shellfish.",
  aiFactPending: false,
  aiFactError: null,
};

const HISTORY = [
  {
    id: "demo-history-dolphin",
    emoji: "🐬",
    name: "Dolphin",
    fact: "Dolphins sleep with one eye open.",
    rolledAt: "2026-01-14T08:55:00.000Z",
  },
  {
    id: "demo-history-owl",
    emoji: "🦉",
    name: "Owl",
    fact: "Owls can rotate their heads up to 270 degrees.",
    rolledAt: "2026-01-14T08:50:00.000Z",
  },
  {
    id: "demo-history-panda",
    emoji: "🐼",
    name: "Panda",
    fact: "A newborn panda is about the size of a stick of butter.",
    rolledAt: "2026-01-14T08:45:00.000Z",
  },
  {
    id: "demo-history-flamingo",
    emoji: "🦩",
    name: "Flamingo",
    fact: "Flamingos are born white and turn pink from their diet.",
    rolledAt: "2026-01-14T08:40:00.000Z",
  },
  {
    id: "demo-history-shark",
    emoji: "🦈",
    name: "Shark",
    fact: "Sharks have been around longer than trees.",
    rolledAt: "2026-01-14T08:35:00.000Z",
  },
  {
    id: "demo-history-bee",
    emoji: "🐝",
    name: "Bee",
    fact: "Bees can recognize human faces.",
    rolledAt: "2026-01-14T08:30:00.000Z",
  },
];

/**
 * Build a complete Random Animal board in memory. No disk I/O.
 * @param {object} [opts]
 * @param {string} [opts.domain] board domain/key (default: "demo")
 * @returns {object} a board state ready to serialize into the artifacts store
 */
export function buildDemoState({ domain = "demo" } = {}) {
  void domain;
  return {
    current: { ...CURRENT },
    history: HISTORY.map((animal) => ({ ...animal })),
  };
}

// ---- CLI: seed the demo board into the runtime artifacts store ---------------

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
  return join(base, "extensions", "random-animal", "artifacts", `${safe}.json`);
}

/**
 * Write a demo board to <home>/extensions/random-animal/artifacts/<domain>.json,
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
      "Seed a Random Animal demo board.\n\n" +
        "  node demo/seed.mjs [--domain <name>] [--home <dir>]\n\n" +
        'Then open the canvas with input { domain: "<name>" } (default: demo).',
    );
    return;
  }
  const file = await seedDemoBoard({ home: args.home, domain: args.domain });
  console.log(`Seeded demo board (domain "${args.domain}") -> ${file}`);
  console.log(`Open the Random Animal canvas with input { "domain": "${args.domain}" } to view it.`);
}

// Run main() only when executed directly, not when imported.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`seed failed: ${err?.message ?? err}`);
    process.exit(1);
  });
}
