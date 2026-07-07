// demo/seed.mjs - generate a rich Language Tutor learner profile for demos and
// screenshots without committing any generated state file.
//
// buildDemoState() returns a complete, modern learner state in memory. It reuses
// the built-in catalog for realistic course content, then marks progress,
// rewards and examples directly so screenshots are deterministic and offline.
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
import { buildCourse } from "../catalog.mjs";

const EXT_NAME = "language-tutor";
const FIXED_DAY = "2026-07-07";
const EXAMPLE_AT = "2026-07-07T09:30:00.000Z";

export const EXTENSION_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function markLesson(course, unitIndex, lessonIndex, done) {
  return {
    ...course,
    units: course.units.map((unit, ui) => ({
      ...unit,
      lessons: unit.lessons.map((lesson, li) => (ui === unitIndex && li === lessonIndex ? { ...lesson, done } : lesson)),
    })),
  };
}

export function buildDemoState({ domain = "demo" } = {}) {
  let spanish = buildCourse("Spanish");
  spanish = markLesson(spanish, 0, 0, true);
  spanish = markLesson(spanish, 1, 0, true);

  return {
    profile: {
      avatar: "🦊",
      name: domain === "demo" ? "Demo Learner" : "Language Explorer",
      xp: 245,
      level: 3,
      streak: 12,
      lastStudied: FIXED_DAY,
      hearts: 3,
      gems: 48,
      badges: [],
    },
    activeLanguage: spanish.code,
    courses: {
      [spanish.code]: spanish,
    },
    examples: {
      "es::gracias": {
        text: "Gracias por ayudarme con la lección.\nThank you for helping me with the lesson.",
        pending: false,
        error: null,
        at: EXAMPLE_AT,
      },
      "es::hola": {
        text: "Hola, Paco corre al café.\nHello, Paco runs to the cafe.",
        pending: false,
        error: null,
        at: EXAMPLE_AT,
      },
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
  return join(base, "extensions", EXT_NAME, "artifacts", `${safe}.json`);
}

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
      "Seed a Language Tutor demo profile.\n\n" +
        "  node demo/seed.mjs [--domain <name>] [--home <dir>]\n\n" +
        'Then open the canvas with input { "profile": "<name>" } (default: demo).',
    );
    return;
  }
  const file = await seedDemoBoard({ home: args.home, domain: args.domain });
  console.log(`Seeded demo profile (domain "${args.domain}") -> ${file}`);
  console.log(`Open the Language Tutor canvas with input { "profile": "${args.domain}" } to view it.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`seed failed: ${err?.message ?? err}`);
    process.exit(1);
  });
}
