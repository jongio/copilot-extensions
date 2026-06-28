// canvas.mjs — Language Tutor canvas definition (kit config; SDK-free).
//
// A gamified language tutor. The agent and the user read/write the SAME state
// through the SAME action handlers. State is durable per-user and keyed by a
// "profile" domain resolved from the open input (defaults to "default"), so the
// agent and every open panel share one learner profile and one set of courses.

import { fileURLToPath } from "node:url";
import { userStore } from "./canvas-kit/storage.mjs";
import { nid } from "./canvas-kit/format.mjs";
import { CanvasKitError } from "./canvas-kit/server.mjs";
import { buildCourse, catalogLanguages, resolveLanguageKey } from "./catalog.mjs";

const EXT_NAME = "language-tutor";

const XP_PER_LEVEL = 100;
const XP_PER_LESSON = 20;
const XP_PER_CORRECT = 5;
const GEMS_PER_LESSON = 5;
const MAX_HEARTS = 5;
const REFILL_COST = 15;

function fileFor(domainId) {
  const safe = String(domainId).replace(/[^A-Za-z0-9._-]/g, "_") || "default";
  return userStore(EXT_NAME, `${safe}.json`);
}

function levelFor(xp) {
  return Math.floor(xp / XP_PER_LEVEL) + 1;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function freshProfile() {
  return {
    avatar: "🦊",
    name: "Explorer",
    xp: 0,
    level: 1,
    streak: 0,
    lastStudied: null,
    hearts: MAX_HEARTS,
    gems: 20,
    badges: [],
  };
}

function createInitialState() {
  return {
    profile: freshProfile(),
    activeLanguage: null,
    courses: {},
    examples: {}, // `${code}::${word}` -> { text, pending, error, at } — AI usage examples
  };
}

// Stable key for an AI usage example: language code + the target word/phrase, so
// an example survives reloads and is shared across every lesson that word is in.
function exampleKey(code, word) {
  return `${String(code ?? "")}::${String(word ?? "").trim().toLowerCase()}`;
}

// Find a course + unit + lesson, tolerating missing pieces.
function locate(state, unitId, lessonId) {
  for (const course of Object.values(state.courses)) {
    for (const unit of course.units) {
      for (const lesson of unit.lessons) {
        if (lesson.id === lessonId && (!unitId || unit.id === unitId)) {
          return { course, unit, lesson };
        }
      }
    }
  }
  return null;
}

function totalLearned(course) {
  let n = 0;
  for (const u of course.units) for (const l of u.lessons) if (l.done) n += l.cards.length;
  return n;
}

export const canvasConfig = {
  id: "language-tutor",
  displayName: "Language Tutor",
  description:
    "Pick a language and the canvas spins up a gamified course — flashcards, " +
    "quizzes, XP, levels, streaks, hearts, gems, mascots and confetti. You and " +
    "the agent share one learner profile and the same set of courses.",
  assetsDir: fileURLToPath(new URL("./web/", import.meta.url)),

  inputSchema: {
    type: "object",
    properties: {
      profile: {
        type: "string",
        description: "Which learner profile to open (e.g. a person's name). Omit for the default profile.",
      },
    },
    additionalProperties: false,
  },

  resolveDomainId: (input) => (input?.profile ? String(input.profile) : "default"),

  createInitialState,
  loadState: async (domainId) => fileFor(domainId).load(null),
  saveState: async (domainId, state) => fileFor(domainId).save(state),

  statusLine: (_ctx, state) => {
    const p = state.profile ?? freshProfile();
    const langs = Object.keys(state.courses ?? {}).length;
    return `Lv.${p.level} · ${p.xp} XP · 🔥${p.streak} · ${langs} language${langs === 1 ? "" : "s"}`;
  },

  actions: {
    pick_language: {
      description:
        "Pick a language to learn (e.g. 'Spanish', 'French', 'Japanese'). Generates a course " +
        "for it if one doesn't exist yet and makes it the active language. Curated languages: " +
        "Spanish, French, Japanese, German, Italian, Portuguese, Korean. Any other language gets " +
        "a starter course you can fill in with add_unit.",
      inputSchema: {
        type: "object",
        properties: {
          language: { type: "string", description: "Language name or code to learn." },
        },
        required: ["language"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const raw = String(input.language ?? "").trim();
        if (!raw) throw new Error("language is required");
        const course = buildCourse(raw);
        const courses = { ...state.courses };
        const existed = !!courses[course.code];
        if (!existed) courses[course.code] = course;
        set({ ...state, courses, activeLanguage: course.code });
        return {
          status: existed
            ? `Switched to ${courses[course.code].name} ${courses[course.code].flag}`
            : `Generated a ${course.name} course ${course.flag} — say hi to ${course.mascot} ${course.mascotName}!`,
          code: course.code,
          mascot: courses[course.code].mascot,
        };
      },
    },

    set_avatar: {
      description: "Set the learner's avatar to an emoji.",
      inputSchema: {
        type: "object",
        properties: { avatar: { type: "string", description: "An emoji to use as the avatar." } },
        required: ["avatar"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const avatar = String(input.avatar ?? "").trim() || "🦊";
        set({ ...state, profile: { ...state.profile, avatar } });
        return { status: `Avatar set to ${avatar}` };
      },
    },

    set_name: {
      description: "Set the learner's display name.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const name = String(input.name ?? "").trim().slice(0, 40) || "Explorer";
        set({ ...state, profile: { ...state.profile, name } });
        return { status: `Name set to ${name}` };
      },
    },

    complete_lesson: {
      description:
        "Mark a lesson complete and award XP, gems, a streak bump and a refilled heart. " +
        "The quiz UI calls this when the learner finishes; the agent can call it too.",
      inputSchema: {
        type: "object",
        properties: {
          lessonId: { type: "string", description: "Id of the lesson that was completed." },
          unitId: { type: "string", description: "Optional id of the lesson's unit." },
          correct: { type: "number", description: "Number of quiz answers correct (for bonus XP)." },
          total: { type: "number", description: "Total quiz questions." },
        },
        required: ["lessonId"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const found = locate(state, input.unitId, input.lessonId);
        if (!found) throw new Error(`No lesson with id ${input.lessonId}`);
        const { course, unit, lesson } = found;

        const correct = Number.isFinite(input.correct) ? Math.max(0, input.correct | 0) : lesson.cards.length;
        const alreadyDone = lesson.done;

        // XP: base + per-correct bonus; replays earn a smaller, non-zero reward.
        const base = alreadyDone ? Math.round(XP_PER_LESSON / 2) : XP_PER_LESSON;
        const gained = base + correct * XP_PER_CORRECT;

        const profile = { ...state.profile };
        const prevLevel = profile.level;
        profile.xp += gained;
        profile.level = levelFor(profile.xp);

        // Streak: bump once per calendar day.
        const today = todayStr();
        if (profile.lastStudied !== today) {
          const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
          profile.streak = profile.lastStudied === y ? profile.streak + 1 : 1;
          profile.lastStudied = today;
        }

        if (!alreadyDone) profile.gems += GEMS_PER_LESSON;
        profile.hearts = Math.min(MAX_HEARTS, profile.hearts + 1);

        const leveledUp = profile.level > prevLevel;

        // Mark lesson done.
        const courses = { ...state.courses };
        courses[course.code] = {
          ...course,
          units: course.units.map((u) =>
            u.id !== unit.id
              ? u
              : { ...u, lessons: u.lessons.map((l) => (l.id === lesson.id ? { ...l, done: true } : l)) }
          ),
        };

        // Badge for finishing a whole course.
        const allDone = courses[course.code].units.every((u) => u.lessons.every((l) => l.done));
        if (allDone && !profile.badges.includes(course.code)) {
          profile.badges = [...profile.badges, course.code];
        }

        set({ ...state, profile, courses });
        return {
          status: `${course.cheer || "Nice!"} +${gained} XP${leveledUp ? ` · level up to ${profile.level}! 🎉` : ""}`,
          xp: profile.xp,
          level: profile.level,
          leveledUp,
          streak: profile.streak,
          courseComplete: allDone,
        };
      },
    },

    lose_heart: {
      description: "Lose a heart (the quiz UI calls this on a wrong answer).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: ({ state, set }) => {
        const hearts = Math.max(0, (state.profile.hearts ?? 0) - 1);
        set({ ...state, profile: { ...state.profile, hearts } });
        return { hearts };
      },
    },

    refill_hearts: {
      description: `Refill hearts to full by spending ${REFILL_COST} gems.`,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: ({ state, set }) => {
        const p = state.profile;
        if (p.hearts >= MAX_HEARTS) return { status: "Hearts already full ❤️", hearts: p.hearts };
        if ((p.gems ?? 0) < REFILL_COST) {
          throw new Error(`Need ${REFILL_COST} gems to refill (you have ${p.gems ?? 0}).`);
        }
        set({ ...state, profile: { ...p, hearts: MAX_HEARTS, gems: p.gems - REFILL_COST } });
        return { status: "Hearts refilled to full ❤️❤️❤️❤️❤️", hearts: MAX_HEARTS };
      },
    },

    add_unit: {
      description:
        "Author a custom unit of lessons for a language's course (great for filling in a " +
        "scaffolded course or extending a curated one). Each lesson is a set of flashcards.",
      inputSchema: {
        type: "object",
        properties: {
          language: { type: "string", description: "Language name or code the unit belongs to." },
          title: { type: "string", description: "Unit title, e.g. 'Family'." },
          emoji: { type: "string", description: "Unit emoji." },
          lessons: {
            type: "array",
            description: "Lessons in this unit.",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                emoji: { type: "string" },
                cards: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      front: { type: "string", description: "Target-language word/phrase." },
                      back: { type: "string", description: "English meaning." },
                      emoji: { type: "string" },
                      pron: { type: "string", description: "Pronunciation hint." },
                    },
                    required: ["front", "back"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["title", "cards"],
              additionalProperties: false,
            },
          },
        },
        required: ["language", "title", "lessons"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const raw = String(input.language ?? "").trim();
        if (!raw) throw new Error("language is required");

        const courses = { ...state.courses };
        // Find an existing course (by code or resolved key), else create one.
        let code = courses[raw] ? raw : null;
        if (!code) {
          const key = resolveLanguageKey(raw);
          if (key && courses[key]) code = key;
        }
        if (!code) {
          const fresh = buildCourse(raw);
          // Drop the placeholder scaffold unit if present.
          if (fresh.custom) fresh.units = [];
          courses[fresh.code] = fresh;
          code = fresh.code;
        }
        const course = courses[code];

        const uid = `${code}-u${nid()}`;
        const unit = {
          id: uid,
          title: String(input.title).trim() || "Unit",
          emoji: String(input.emoji ?? "📘").trim() || "📘",
          lessons: (input.lessons ?? []).map((l, li) => ({
            id: `${uid}-l${li + 1}`,
            title: String(l.title ?? `Lesson ${li + 1}`).trim(),
            emoji: String(l.emoji ?? "📄").trim() || "📄",
            done: false,
            cards: (l.cards ?? []).map((card) => ({
              front: String(card.front ?? "").trim(),
              back: String(card.back ?? "").trim(),
              emoji: String(card.emoji ?? "✨").trim() || "✨",
              pron: String(card.pron ?? "").trim(),
            })).filter((card) => card.front && card.back),
          })).filter((l) => l.cards.length),
        };
        if (!unit.lessons.length) throw new Error("add_unit needs at least one lesson with cards");

        courses[code] = { ...course, units: [...course.units, unit] };
        set({ ...state, courses, activeLanguage: state.activeLanguage ?? code });
        const lessonCount = unit.lessons.length;
        return {
          status: `Added "${unit.title}" to ${course.name} (${lessonCount} lesson${lessonCount === 1 ? "" : "s"})`,
          unitId: uid,
        };
      },
    },

    reset_progress: {
      description: "Reset the entire learner profile and all courses back to a clean slate.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: ({ set }) => {
        set(createInitialState());
        return { status: "Progress reset — fresh start! 🌱" };
      },
    },

    // ---- AI usage example (canvas-kit 2026-06-27.1 host model) -------------
    // request_example marks a flashcard's word "thinking" and returns a prompt;
    // extension.mjs answers it SILENTLY with the host model (ctx.ai) and writes
    // the example sentence (+ translation) back via set_example — no turn is
    // added to the chat. Keyed by language + word so it is shared across lessons.
    request_example: {
      description: "Ask the AI for a natural example sentence using a flashcard's word, with a translation.",
      inputSchema: {
        type: "object",
        properties: {
          word: { type: "string", description: "The target-language word/phrase (card front)." },
          back: { type: "string", description: "Optional English meaning (card back) for context." },
          code: { type: "string", description: "Language code. Defaults to the active language." },
        },
        required: ["word"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const word = String(input?.word ?? "").trim();
        if (!word) throw new CanvasKitError("no_word", "No word to build an example from.");
        const code = String(input?.code ?? state.activeLanguage ?? "").trim();
        const course = state.courses?.[code];
        const langName = course?.name || code || "the target language";
        const key = exampleKey(code, word);
        const examples = { ...(state.examples ?? {}) };
        examples[key] = { ...(examples[key] ?? {}), pending: true, error: null };
        set({ ...state, examples });
        const back = String(input?.back ?? "").trim();
        const meaning = back ? ` (it means "${back}")` : "";
        const prompt =
          `You are a friendly ${langName} tutor. ` +
          `Use the ${langName} word or phrase "${word}"${meaning} in ONE short, natural example sentence. ` +
          `Then give its English translation. ` +
          `Output ONLY two lines: first the ${langName} sentence, then its English translation. ` +
          `No labels, no preamble, no quotes, no pronunciation guide, and do not use em dashes.`;
        return { key, word, code, prompt };
      },
    },

    set_example: {
      description: "Store an AI-generated usage example for a word (write-back from the host model).",
      inputSchema: {
        type: "object",
        properties: { key: { type: "string" }, text: { type: "string" } },
        required: ["key", "text"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const key = String(input?.key ?? "");
        const text = String(input?.text ?? "").trim();
        if (!key || !text) return { empty: true };
        const examples = { ...(state.examples ?? {}) };
        examples[key] = { text, pending: false, error: null, at: new Date().toISOString() };
        set({ ...state, examples });
        return { ok: true };
      },
    },

    fail_example: {
      description: "Record that an AI example could not be generated (clears the pending spinner).",
      inputSchema: {
        type: "object",
        properties: { key: { type: "string" }, message: { type: "string" } },
        required: ["key"],
        additionalProperties: false,
      },
      handler: ({ state, set, input }) => {
        const key = String(input?.key ?? "");
        if (!key) return { ok: true };
        const examples = { ...(state.examples ?? {}) };
        examples[key] = {
          ...(examples[key] ?? {}),
          pending: false,
          error: String(input?.message ?? "Could not generate an example."),
        };
        set({ ...state, examples });
        return { ok: true };
      },
    },

    get_progress: {
      description: "Return a text summary of the learner's progress (for the agent).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: ({ state }) => {
        const p = state.profile ?? freshProfile();
        const lines = [
          `${p.avatar} ${p.name} — Level ${p.level} (${p.xp} XP) · 🔥 ${p.streak}-day streak · ❤️ ${p.hearts}/${MAX_HEARTS} · 💎 ${p.gems}`,
        ];
        const courses = Object.values(state.courses ?? {});
        if (!courses.length) {
          lines.push("No languages started yet.");
        } else {
          for (const co of courses) {
            const lessons = co.units.flatMap((u) => u.lessons);
            const done = lessons.filter((l) => l.done).length;
            const active = co.code === state.activeLanguage ? " (active)" : "";
            lines.push(`${co.flag} ${co.name}${active}: ${done}/${lessons.length} lessons · ${totalLearned(co)} words learned`);
          }
        }
        return { summary: lines.join("\n"), level: p.level, xp: p.xp, streak: p.streak };
      },
    },

    catalog: {
      description: "List the curated languages available to learn out of the box.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: () => {
        const langs = catalogLanguages();
        return {
          count: langs.length,
          summary: langs.map((l) => `${l.flag} ${l.name} — ${l.mascot} ${l.mascotName}`).join("\n"),
          languages: langs,
        };
      },
    },
  },
};
