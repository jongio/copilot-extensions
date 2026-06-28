// web/app.mjs — Preact view for the Language Tutor canvas.
//
// SHARED state (profile + courses) arrives over /events (SSE); the agent mutates
// the same data through the same handlers. LOCAL view state (which screen we're
// on, the current card/quiz, the avatar picker, the celebration overlay) lives
// in useState. Because Preact DIFFS the DOM, agent pushes never reset the screen
// you're on or the answer you're mid-tap on.

import { html, mountCanvas, useState, Icon } from "/kit/client.mjs";

const MAX_HEARTS = 5;
const AVATARS = ["🦊", "🐼", "🐸", "🐱", "🐶", "🦉", "🐯", "🐵", "🦄", "🐲", "🐨", "🐝", "🦔", "🦦", "🐧", "🦁", "🐰", "🐢"];
const CONFETTI = ["🎉", "🎊", "⭐", "✨", "🌟", "💫", "🥳", "🏆", "💎", "❤️"];

// ---- helpers ---------------------------------------------------------------

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function activeCourse(state) {
  return state?.activeLanguage ? state.courses?.[state.activeLanguage] : null;
}

function flatLessons(course) {
  return course.units.flatMap((u) => u.lessons.map((l) => ({ unit: u, lesson: l })));
}

function unlockedSet(course) {
  const ids = new Set();
  const flat = course.units.flatMap((u) => u.lessons);
  flat.forEach((l, i) => {
    if (i === 0 || l.done || flat[i - 1].done) ids.add(l.id);
  });
  return ids;
}

function courseProgress(course) {
  const all = course.units.flatMap((u) => u.lessons);
  const done = all.filter((l) => l.done).length;
  return { done, total: all.length, pct: all.length ? Math.round((done / all.length) * 100) : 0 };
}

function buildQuiz(course, lesson) {
  const fronts = [...new Set(course.units.flatMap((u) => u.lessons).flatMap((l) => l.cards).map((c) => c.front))];
  return shuffle(
    lesson.cards.map((card) => {
      const distractors = shuffle(fronts.filter((f) => f !== card.front)).slice(0, 3);
      return { back: card.back, emoji: card.emoji, answer: card.front, options: shuffle([card.front, ...distractors]) };
    })
  );
}

function makeConfetti(mascot) {
  const pool = [...CONFETTI, mascot];
  return Array.from({ length: 40 }, (_, i) => ({
    key: i,
    emoji: pool[Math.floor(Math.random() * pool.length)],
    left: Math.random() * 100,
    delay: Math.random() * 0.8,
    dur: 1.8 + Math.random() * 1.6,
    size: 16 + Math.random() * 18,
  }));
}

// ---- HUD -------------------------------------------------------------------

function Hud({ profile, invoke, onAvatar, connected }) {
  const p = profile;
  const xpInLevel = p.xp % 100;
  const hearts = "❤️".repeat(Math.max(0, p.hearts)) + "🤍".repeat(Math.max(0, MAX_HEARTS - p.hearts));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.name);

  async function commit() {
    setEditing(false);
    const n = draft.trim();
    if (n && n !== p.name) await invoke("set_name", { name: n });
  }

  return html`
    <div class="lt-hud">
      <div class="lt-avatar" title="Change avatar" onClick=${onAvatar}>${p.avatar}</div>
      <div class="lt-hud-main">
        <div class="lt-hud-name">
          ${editing
            ? html`<input class="ck-input" style="height:24px;padding:1px 6px;max-width:140px"
                value=${draft} autofocus
                onInput=${(e) => setDraft(e.target.value)}
                onKeyDown=${(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
                onBlur=${commit} />`
            : html`<span style="cursor:text" title="Click to rename"
                onClick=${() => { setDraft(p.name); setEditing(true); }}>${p.name}</span>`}
          <span class="lt-lvl">LV ${p.level}</span>
        </div>
        <div class="lt-xpbar"><div class="lt-xpfill" style=${`width:${xpInLevel}%`}></div></div>
        <div class="lt-xpcap">${xpInLevel}/100 XP to level ${p.level + 1}</div>
      </div>
      <div class="lt-stats">
        <div class="lt-stat"><b>🔥${p.streak}</b><span>streak</span></div>
        <div class="lt-stat">
          <span class="lt-hearts">${hearts}</span>
          <button class="lt-refill" disabled=${p.hearts >= MAX_HEARTS || p.gems < 15}
            title="Refill hearts for 15 gems"
            onClick=${() => invoke("refill_hearts").catch(() => {})}>refill</button>
        </div>
        <div class="lt-stat"><b>💎${p.gems}</b><span>gems</span></div>
      </div>
    </div>
  `;
}

function AvatarPicker({ invoke, onClose }) {
  return html`
    <div class="lt-avatar-pop">
      ${AVATARS.map(
        (a) => html`<button class="lt-avatar-opt" key=${a}
          onClick=${async () => { await invoke("set_avatar", { avatar: a }); onClose(); }}>${a}</button>`
      )}
    </div>
  `;
}

// ---- language picker -------------------------------------------------------

const CATALOG_CARDS = [
  { code: "es", name: "Spanish", flag: "🇪🇸", mascot: "🦊", who: "Paco the Fox", accent: "#f4b740", blurb: "Churros, verbs and chaos." },
  { code: "fr", name: "French", flag: "🇫🇷", mascot: "🐸", who: "Margot the Frog", accent: "#6ea8fe", blurb: "Croissants & conjugations." },
  { code: "ja", name: "Japanese", flag: "🇯🇵", mascot: "🐱", who: "Tama the Cat", accent: "#ff7eb6", blurb: "Naps on the kana." },
  { code: "de", name: "German", flag: "🇩🇪", mascot: "🦅", who: "Adler the Eagle", accent: "#f6c177", blurb: "Pretzels & long nouns." },
  { code: "it", name: "Italian", flag: "🇮🇹", mascot: "🐺", who: "Lupo the Wolf", accent: "#85c46b", blurb: "Pasta and rolled R's." },
  { code: "pt", name: "Portuguese", flag: "🇧🇷", mascot: "🦜", who: "Zé the Parrot", accent: "#3fb950", blurb: "Samba & brigadeiros." },
  { code: "ko", name: "Korean", flag: "🇰🇷", mascot: "🐯", who: "Horangi the Tiger", accent: "#bd93f9", blurb: "Hangul & kimchi." },
];

function LanguagePicker({ invoke, onClose, hasCourses }) {
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);

  async function pick(language) {
    if (busy) return;
    setBusy(true);
    try { await invoke("pick_language", { language }); onClose?.(); }
    finally { setBusy(false); }
  }

  return html`
    <div>
      <div class="lt-hero">
        <h1>🌍 Pick your language</h1>
        <div class="lt-sub">Choose a guide and a course appears — instantly.</div>
      </div>
      <div class="lt-pick-grid">
        ${CATALOG_CARDS.map(
          (c) => html`
            <button class="lt-pick" key=${c.code} style=${`--lt-card-accent:${c.accent}`} disabled=${busy}
              onClick=${() => pick(c.name)}>
              <div class="lt-pick-mascot">${c.mascot}</div>
              <div class="lt-pick-flag">${c.flag}</div>
              <div class="lt-pick-name">${c.name}</div>
              <div class="lt-pick-who">${c.who}</div>
              <div class="lt-pick-blurb">${c.blurb}</div>
            </button>
          `
        )}
      </div>
      <div class="lt-custom-row">
        <input class="ck-input" placeholder="…or type any language (Dutch, Hindi, Swahili)"
          value=${custom} disabled=${busy}
          onInput=${(e) => setCustom(e.target.value)}
          onKeyDown=${(e) => { if (e.key === "Enter" && custom.trim()) pick(custom.trim()); }} />
        <button class="ck-btn ck-btn-primary" disabled=${!custom.trim() || busy} onClick=${() => pick(custom.trim())}>
          <${Icon} name="sparkles" size=${16} />Go
        </button>
      </div>
      ${hasCourses
        ? html`<div style="margin-top:12px;text-align:center">
            <button class="lt-back" onClick=${onClose}><${Icon} name="arrow-left" size=${14} />Back to my course</button>
          </div>`
        : null}
    </div>
  `;
}

// ---- active course (home) --------------------------------------------------

function CourseHome({ course, invoke, onOpenLesson, onChange }) {
  const prog = courseProgress(course);
  const unlocked = unlockedSet(course);

  return html`
    <div>
      <div class="lt-banner">
        <div class="lt-banner-mascot">${course.mascot}</div>
        <div class="lt-banner-info">
          <div class="lt-banner-title">${course.flag} ${course.name}</div>
          <div class="lt-banner-who">${course.mascot} ${course.mascotName}</div>
          <div class="lt-banner-blurb">${course.blurb}</div>
          <div class="lt-progress"><i style=${`width:${prog.pct}%`}></i></div>
          <div class="lt-xpcap">${prog.done}/${prog.total} lessons complete</div>
        </div>
      </div>

      <div class="ck-spread" style="margin-bottom:10px">
        <button class="lt-back" onClick=${onChange}><${Icon} name="globe" size=${14} />Change language</button>
      </div>

      ${course.units.length
        ? course.units.map(
            (u) => html`
              <div class="lt-unit" key=${u.id}>
                <div class="lt-unit-head">
                  <span class="lt-u-emoji">${u.emoji}</span>
                  <h3>${u.title}</h3>
                  <span class="lt-u-count">${u.lessons.filter((l) => l.done).length}/${u.lessons.length}</span>
                </div>
                <div class="lt-path">
                  ${u.lessons.map((l) => {
                    const isUnlocked = unlocked.has(l.id);
                    const cls = l.done ? "lt-done" : isUnlocked ? "lt-available" : "lt-locked";
                    const badge = l.done ? "✅" : isUnlocked ? l.emoji : "🔒";
                    return html`
                      <button class=${`lt-node ${cls}`} key=${l.id}
                        disabled=${!isUnlocked}
                        onClick=${() => isUnlocked && onOpenLesson(u, l)}>
                        <span class="lt-node-badge">${badge}</span>
                        <span class="lt-node-main">
                          <span class="lt-node-title">${l.title}</span>
                          <span class="lt-node-sub">${l.cards.length} word${l.cards.length === 1 ? "" : "s"}${l.done ? " · learned" : ""}</span>
                        </span>
                        <span class="lt-node-go">${l.done ? "review" : isUnlocked ? "start ▶" : ""}</span>
                      </button>
                    `;
                  })}
                </div>
              </div>
            `
          )
        : html`<div class="ck-empty">
            <${Icon} name="sparkles" size=${20} />
            No lessons yet — ask the agent: “add a unit of ${course.name} words”.
          </div>`}
    </div>
  `;
}

// ---- study (flashcards) ----------------------------------------------------

function StudyScreen({ course, unit, lesson, examples, invoke, onBack, onQuiz }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = lesson.cards[Math.min(idx, lesson.cards.length - 1)];

  function go(delta) {
    const next = Math.min(Math.max(0, idx + delta), lesson.cards.length - 1);
    setIdx(next);
    setFlipped(false);
  }

  const exKey = `${course.code}::${String(card.front || "").toLowerCase()}`;
  const ex = examples?.[exKey];
  const exPending = !!ex?.pending;
  const exLines = ex?.text ? ex.text.split("\n").map((s) => s.trim()).filter(Boolean) : [];

  return html`
    <div>
      <div class="lt-screen-head">
        <button class="lt-back" onClick=${onBack}><${Icon} name="arrow-left" size=${14} />Back</button>
        <h2>${unit.emoji} ${lesson.title}</h2>
        <span class="ck-grow"></span>
        <span class="ck-caption">${idx + 1}/${lesson.cards.length}</span>
      </div>

      <div class=${`lt-flash ${flipped ? "flipped" : ""}`} onClick=${() => setFlipped((f) => !f)}>
        <div class="lt-flash-inner">
          <div class="lt-face">
            <span class="lt-card-label">${course.name}</span>
            <span class="lt-card-emoji">${card.emoji}</span>
            <span class="lt-card-word">${card.front}</span>
            ${card.pron ? html`<span class="lt-card-pron">“${card.pron}”</span>` : null}
          </div>
          <div class="lt-face lt-face-back">
            <span class="lt-card-label">Meaning</span>
            <span class="lt-card-emoji">${card.emoji}</span>
            <span class="lt-card-word">${card.back}</span>
          </div>
        </div>
      </div>
      <div class="lt-flip-hint">👆 tap the card to flip</div>

      <div class="lt-example">
        ${exLines.length
          ? html`<div class="ck-card lt-example-card" style="padding:10px 12px">
              <div class="ck-row" style="gap:6px;margin-bottom:4px">
                <${Icon} name="sparkles" size=${14} />
                <strong style="font-size:12px;text-transform:uppercase;letter-spacing:.04em">AI example</strong>
              </div>
              <div class="lt-example-target" style="font-weight:600">${exLines[0]}</div>
              ${exLines[1] ? html`<div class="ck-muted" style="font-size:13px;margin-top:2px">${exLines.slice(1).join(" ")}</div>` : null}
            </div>`
          : null}
        ${exPending
          ? html`<div class="ck-muted ck-row" style="justify-content:center;gap:6px;font-size:12px;margin-top:6px">
              <${Icon} name="loader" size=${14} /> Writing an example…
            </div>`
          : null}
        ${ex?.error && !exPending
          ? html`<div class="ck-caption" style="text-align:center;margin-top:6px;color:var(--ck-danger,#f85149)">${ex.error}</div>`
          : null}
        <div style="text-align:center;margin-top:8px">
          <button
            class="ck-btn ck-btn-sm"
            disabled=${exPending}
            onClick=${() => invoke("request_example", { word: card.front, back: card.back, code: course.code }).catch(() => {})}
          >
            <${Icon} name="sparkles" size=${14} />
            ${exPending ? "Thinking…" : exLines.length ? "Another example" : "AI example"}
          </button>
        </div>
      </div>

      <div class="lt-dots">
        ${lesson.cards.map((_, i) => html`<span key=${i} class=${`lt-dot ${i === idx ? "on" : i < idx ? "seen" : ""}`}></span>`)}
      </div>

      <div class="lt-row-controls">
        <button class="ck-btn" disabled=${idx === 0} onClick=${() => go(-1)}>
          <${Icon} name="arrow-left" size=${16} />Prev
        </button>
        <button class="ck-btn" disabled=${idx >= lesson.cards.length - 1} onClick=${() => go(1)}>
          Next<${Icon} name="arrow-right" size=${16} />
        </button>
        <span class="ck-grow"></span>
        <button class="ck-btn ck-btn-primary" onClick=${onQuiz}>
          <${Icon} name="zap" size=${16} />Take the quiz
        </button>
      </div>
    </div>
  `;
}

// ---- quiz ------------------------------------------------------------------

function QuizScreen({ course, unit, lesson, profile, invoke, onBack, onFinish }) {
  const [questions] = useState(() => buildQuiz(course, lesson));
  const [qi, setQi] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [choice, setChoice] = useState(null);

  if (profile.hearts <= 0) {
    return html`
      <div>
        <div class="lt-screen-head">
          <button class="lt-back" onClick=${onBack}><${Icon} name="arrow-left" size=${14} />Back</button>
          <h2>${course.mascot} Out of hearts</h2>
        </div>
        <div class="ck-card lt-out-of-hearts">
          <div class="lt-big">💔</div>
          <h3>You're out of hearts!</h3>
          <p class="ck-muted">Refill to keep quizzing — or head back and study some more.</p>
          <div class="lt-row-controls" style="justify-content:center;margin-top:10px">
            <button class="ck-btn ck-btn-primary" disabled=${profile.gems < 15}
              onClick=${() => invoke("refill_hearts").catch(() => {})}>
              <${Icon} name="heart" size=${16} />Refill (💎15)
            </button>
            <button class="ck-btn" onClick=${onBack}>Study instead</button>
          </div>
        </div>
      </div>
    `;
  }

  const q = questions[qi];

  function answer(opt) {
    if (choice) return;
    const right = opt === q.answer;
    const nextCorrect = correct + (right ? 1 : 0);
    setChoice(opt);
    setCorrect(nextCorrect);
    if (!right) invoke("lose_heart").catch(() => {});
    setTimeout(() => {
      if (qi + 1 >= questions.length) {
        onFinish({ unitId: unit.id, lessonId: lesson.id, correct: nextCorrect, total: questions.length });
      } else {
        setQi(qi + 1);
        setChoice(null);
      }
    }, 850);
  }

  return html`
    <div>
      <div class="lt-screen-head">
        <button class="lt-back" onClick=${onBack}><${Icon} name="arrow-left" size=${14} />Back</button>
        <h2>${unit.emoji} ${lesson.title} quiz</h2>
        <span class="ck-grow"></span>
        <span class="lt-hearts">${"❤️".repeat(Math.max(0, profile.hearts))}</span>
      </div>

      <div class="lt-quiz-prompt">
        <div class="lt-q-emoji">${q.emoji}</div>
        <div class="lt-q-text">${q.back}</div>
        <div class="lt-q-hint">Tap the ${course.name} word</div>
      </div>

      <div class="lt-options">
        ${q.options.map((opt) => {
          let cls = "lt-opt";
          if (choice) {
            if (opt === q.answer) cls += " correct";
            else if (opt === choice) cls += " wrong";
          }
          return html`<button class=${cls} key=${opt} disabled=${!!choice} onClick=${() => answer(opt)}>${opt}</button>`;
        })}
      </div>

      <div class="lt-quiz-foot">
        <span class="lt-quiz-prog">Question ${qi + 1} of ${questions.length} · ${correct} correct</span>
      </div>
    </div>
  `;
}

// ---- celebration -----------------------------------------------------------

function Celebration({ data, onClose }) {
  return html`
    <div>
      <div class="lt-confetti">
        ${data.confetti.map(
          (c) => html`<span key=${c.key} style=${`left:${c.left}%;font-size:${c.size}px;animation-delay:${c.delay}s;animation-duration:${c.dur}s`}>${c.emoji}</span>`
        )}
      </div>
      <div class="lt-celebrate" onClick=${onClose}>
        <div class="lt-celebrate-card">
          <div class="lt-celebrate-mascot">${data.mascot}</div>
          <h2>${data.title}</h2>
          <div class="lt-celebrate-xp">${data.xp}</div>
          <div class="lt-celebrate-sub">${data.sub}</div>
          <div class="lt-celebrate-sub" style="margin-top:12px">tap to continue ✨</div>
        </div>
      </div>
    </div>
  `;
}

// ---- app -------------------------------------------------------------------

function App({ state, invoke, connected }) {
  const [mode, setMode] = useState("home"); // home | study | quiz
  const [sel, setSel] = useState(null); // { unitId, lessonId }
  const [picking, setPicking] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [celebrate, setCelebrate] = useState(null);

  if (!state || !state.profile) return html`<p class="ck-muted">Loading your quest…</p>`;

  const profile = { hearts: MAX_HEARTS, gems: 0, streak: 0, level: 1, xp: 0, name: "Explorer", avatar: "🦊", ...state.profile };
  const course = activeCourse(state);
  const hasCourses = Object.keys(state.courses ?? {}).length > 0;

  // Resolve current selection against live state (so lesson.done updates flow in).
  let selUnit = null, selLesson = null;
  if (sel && course) {
    for (const u of course.units) {
      for (const l of u.lessons) if (l.id === sel.lessonId) { selUnit = u; selLesson = l; }
    }
  }
  if (mode !== "home" && (!selUnit || !selLesson)) {
    // selection vanished (reset / language switch) — bail home.
    if (mode !== "home") setTimeout(() => setMode("home"), 0);
  }

  function openLesson(u, l) {
    setSel({ unitId: u.id, lessonId: l.id });
    setMode("study");
  }

  async function finishQuiz(payload) {
    let res;
    try {
      res = await invoke("complete_lesson", payload);
    } catch {
      res = { status: "Lesson complete!" };
    }
    setMode("home");
    setSel(null);
    setCelebrate({
      mascot: course?.mascot ?? "🎉",
      title: res?.leveledUp ? `Level ${res.level}! 🎉` : res?.courseComplete ? "Course complete! 🏆" : (course?.cheer || "Lesson complete!"),
      xp: res?.status ?? "Great work!",
      sub: res?.courseComplete ? `You finished ${course?.name}! ${course?.flag ?? ""}` : `${payload.correct}/${payload.total} correct`,
      confetti: makeConfetti(course?.mascot ?? "⭐"),
    });
    setTimeout(() => setCelebrate(null), 5000);
  }

  const showPicker = !hasCourses || !course || picking;

  return html`
    <div>
      <${Hud} profile=${profile} invoke=${invoke} connected=${connected}
        onAvatar=${() => setAvatarOpen((v) => !v)} />
      ${avatarOpen ? html`<${AvatarPicker} invoke=${invoke} onClose=${() => setAvatarOpen(false)} />` : null}

      <div class="ck-spread" style="margin:-6px 0 12px">
        <span></span>
        <span class="lt-live">
          <span class=${`ck-dot ${connected ? "ck-dot-live" : "ck-dot-off"}`}></span>
          ${connected ? "live" : "reconnecting…"}
        </span>
      </div>

      ${showPicker
        ? html`<${LanguagePicker} invoke=${invoke} hasCourses=${hasCourses}
            onClose=${() => setPicking(false)} />`
        : mode === "study" && selLesson
          ? html`<${StudyScreen} course=${course} unit=${selUnit} lesson=${selLesson} examples=${state.examples ?? {}} invoke=${invoke}
              onBack=${() => { setMode("home"); setSel(null); }}
              onQuiz=${() => setMode("quiz")} />`
          : mode === "quiz" && selLesson
            ? html`<${QuizScreen} course=${course} unit=${selUnit} lesson=${selLesson} profile=${profile} invoke=${invoke}
                onBack=${() => setMode("study")} onFinish=${finishQuiz} />`
            : html`<${CourseHome} course=${course} invoke=${invoke}
                onOpenLesson=${openLesson} onChange=${() => setPicking(true)} />`}

      ${celebrate ? html`<${Celebration} data=${celebrate} onClose=${() => setCelebrate(null)} />` : null}
    </div>
  `;
}

mountCanvas({ view: (model) => html`<${App} ...${model} />` });
