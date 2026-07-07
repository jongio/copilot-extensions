// demo/seed.mjs - generate a rich, fully-populated Code Tutor board for demos and
// screenshots WITHOUT bundling any data file in the extension.
//
// buildDemoState() returns a complete, modern board in memory. The demo teaches
// concepts using the canvas kit's OWN source, so every code reference resolves
// wherever the extension is installed: codebase.root is the extension directory
// and each ref path is relative to it. Nothing here is written to disk unless you
// run this file as a CLI, which seeds the board into the runtime artifacts store.
//
// Launch demo mode:
//   node demo/seed.mjs                 # writes <COPILOT_HOME>/extensions/code-tutor/artifacts/demo.json
//   node demo/seed.mjs --domain demo   # pick the board domain (default: demo)
//   node demo/seed.mjs --home <dir>    # pick the COPILOT_HOME root (default: $COPILOT_HOME or ~/.copilot)
// then open the canvas with input { domain: "demo" }.

import { mkdir, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

// The Code Tutor extension directory (this file lives in <ext>/demo/). Used as the
// codebase root so refs into the kit's own files resolve anywhere it's installed.
export const EXTENSION_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Fixed timestamps so the generated board (and the screenshots taken from it) are
// stable across runs. The one exception is the pending question's createdAt, which
// is stamped "now" on purpose (see buildDemoState) so its "thinking" timer reads a
// small, believable number instead of years.
const CREATED = "2026-01-14T09:00:00.000Z";
const SCANNED = "2026-01-15T10:00:00.000Z";

// Each topic teaches a real concept found in the kit's own code, one per category
// so the demo exercises every icon/color the view knows. Explanations are written
// as self-contained prose at each reading level. One topic intentionally omits the
// "wizard" level so the "Get this explanation" call-to-action is visible.
const TOPICS = [
  {
    id: "demo-t-algorithm",
    title: "Windowed range slicing",
    conceptKey: "windowed-range-slicing",
    category: "algorithm",
    summary: "Return only the lines around a reference, padded and capped, instead of a whole file.",
    keyPoints: [
      "Clamp the focus range to the file bounds, then pad by a fixed margin.",
      "Cap the window so an enormous file can never blow up the payload.",
    ],
    refs: [
      { file: "canvas.mjs", startLine: 906, endLine: 925, note: "read_snippet computes a padded, capped line window around the referenced range." },
    ],
    status: "understood",
    level: null,
    explanations: {
      eli5: "Imagine a giant book but you only photocopy the page someone pointed at, plus one page on each side. You never haul the whole book around.",
      curious: "Instead of sending an entire source file to the UI, the code takes just the referenced lines, adds a few lines of context on each side, and stops at a maximum. You get readable context without the weight of the whole file.",
      engineer: "read_snippet clamps [startLine, endLine] to [1, total], pads by SNIPPET_PAD, then truncates to SNIPPET_MAX_LINES. The result carries fromLine plus focusStart/focusEnd so the client can highlight the exact referenced span inside the padded window.",
      wizard: "It is a bounded projection over a line-indexed sequence: O(window) output regardless of file size, with an explicit truncation flag so the consumer can distinguish a complete slice from a capped one. Padding is symmetric but re-clamped, so focus ranges near the file edges degrade gracefully rather than reading out of bounds.",
    },
    cachedLevels: [],
  },
  {
    id: "demo-t-data-structure",
    title: "A Set as an in-flight guard",
    conceptKey: "set-in-flight-guard",
    category: "data-structure",
    summary: "One shared Set turns 'is this work already running?' into a synchronous test-and-set.",
    keyPoints: [
      "claim() adds a key and reports whether it won the race.",
      "The check happens before the first await, so a double-click can't slip through.",
    ],
    refs: [
      { file: "extension.mjs", startLine: 74, endLine: 76, note: "inFlight Set plus claim()/release() dedupe concurrent UI clicks." },
    ],
    status: "understood",
    level: null,
    explanations: {
      eli5: "It's like a single 'occupied' sign on a bathroom door. The first person flips it and goes in; anyone else sees the sign and waits.",
      curious: "A Set remembers which jobs are currently running by a key. Before starting a job, the code tries to add the key: if it was already there, someone else is doing it, so this click quietly gives up. That stops the same button firing twice.",
      engineer: "inFlight is a Set<string>; claim(key) is has? false : (add, true) - a synchronous test-and-set executed before any await, so two near-simultaneous POSTs can't both pass an async 'already pending?' check. release(key) deletes it in a finally.",
      wizard: "It is a lightweight mutual-exclusion primitive keyed per unit of work. Because JavaScript is single-threaded up to the first await, the add is atomic with respect to other microtasks, giving lock-free dedupe without a real lock as long as the claim precedes suspension.",
    },
    cachedLevels: ["eli5"],
  },
  {
    id: "demo-t-complexity",
    title: "O(n) find vs O(1) lookup",
    conceptKey: "linear-find-vs-map",
    category: "complexity",
    summary: "A per-action Array.find is linear; an id-keyed Map would be constant time.",
    keyPoints: [
      "findTopic scans the whole array every call.",
      "Fine when n is tiny; the wrong shape once it isn't.",
    ],
    refs: [
      { file: "canvas.mjs", startLine: 194, endLine: 195, note: "findTopic does an Array.find over all topics on every action." },
    ],
    status: "revisit",
    level: null,
    explanations: {
      eli5: "Finding a friend by walking past every seat in the theater takes longer the bigger the theater. Assigned seat numbers let you go straight there.",
      curious: "Looking something up by scanning a list gets slower as the list grows. Keeping a lookup table keyed by id stays fast no matter how big it gets. Here the list is short, so scanning is fine, but it's the classic trade-off.",
      engineer: "findTopic is O(n) per call and several handlers call it per action, so worst case is O(handlers * n). For small curricula that's invisible; at scale a Map<id, topic> maintained alongside the array makes it O(1) lookups.",
      wizard: "This is the amortized-vs-worst-case argument for choosing an index. The linear scan has no setup cost but linear query cost; a hash index trades O(n) build and O(n) memory for O(1) expected queries. The right choice is a function of query frequency and n, which is exactly why it stays a scan here.",
    },
    cachedLevels: [],
  },
  {
    id: "demo-t-theory",
    title: "Content fingerprints for change detection",
    conceptKey: "content-fingerprint",
    category: "theory",
    summary: "Summarize the code into a small fingerprint, then compare fingerprints to detect drift.",
    keyPoints: [
      "git HEAD plus newest file mtime plus a file count is a cheap signature.",
      "A changed fingerprint means 'the code moved, offer a refresh'.",
    ],
    refs: [
      { file: "canvas.mjs", startLine: 321, endLine: 343, note: "computeFingerprint builds a compact signature of the codebase." },
    ],
    status: "understood",
    level: null,
    explanations: {
      eli5: "Like taking a quick photo of your messy desk. Later you glance at a new photo: if it looks different, something moved.",
      curious: "Rather than re-reading every file to see if code changed, the tutor reduces the codebase to a short fingerprint (things like the git commit and the newest file time). If a fresh fingerprint differs from the saved one, it knows the code changed and shows a refresh nudge.",
      engineer: "computeFingerprint concatenates a git HEAD ref, the newest mtime under the root, and a file count into a compact string. analysis_status recomputes it and compares to the value saved at analysis time; inequality flips the 'stale' banner without any content diff.",
      wizard: "It is a cheap collision-tolerant digest chosen for change DETECTION, not integrity: false negatives (a change the signature misses) are the design risk, traded away for near-zero cost. Because it is compared only against its own prior value, adversarial collision resistance is unnecessary - monotonic sensitivity to ordinary edits is enough.",
    },
    cachedLevels: [],
  },
  {
    id: "demo-t-pattern",
    title: "Publish/subscribe over Server-Sent Events",
    conceptKey: "pub-sub-sse",
    category: "pattern",
    summary: "The server pushes state; the client is a pure subscriber that re-renders on each frame.",
    keyPoints: [
      "One EventSource stream; every push replaces state.",
      "The client never polls for state - it reacts.",
    ],
    refs: [
      { file: "canvas-kit/client.mjs", startLine: 133, endLine: 151, note: "connect() subscribes to ./events and re-renders on each pushed frame." },
    ],
    status: "new",
    level: null,
    explanations: {
      eli5: "Like a group chat: the teacher posts once and everyone's phone buzzes with the same message. Nobody keeps asking 'anything new yet?'.",
      curious: "The browser opens one long-lived connection and just listens. Whenever the server has new state it pushes it down that connection, and the page redraws. This is the publish/subscribe idea: publishers send, subscribers react.",
      engineer: "connect() opens an EventSource('./events'); onmessage parses each frame, replaces local state, and calls rerender(). It's one-way server->client push, so multiple open panels stay in sync from a single source of truth without client polling.",
      wizard: "SSE gives an ordered, auto-reconnecting, text/event-stream channel - a strictly weaker but simpler contract than WebSockets for unidirectional fan-out. The invariant is last-writer-wins on a full-state frame, which sidesteps operational-transform/CRDT complexity at the cost of sending whole snapshots.",
    },
    cachedLevels: ["eli5", "curious"],
  },
  {
    id: "demo-t-paradigm",
    title: "Immutability and structural sharing",
    conceptKey: "immutability-structural-sharing",
    category: "paradigm",
    summary: "Never mutate state in place; spread a new object so unchanged parts are shared.",
    keyPoints: [
      "Functional set((cur) => ({ ...cur, ... })) merges into the latest state.",
      "Reads that raced a long await don't get clobbered.",
    ],
    refs: [
      { file: "canvas.mjs", startLine: 456, endLine: 460, note: "Functional set() spreads the CURRENT state so a concurrent write isn't lost." },
    ],
    status: "confused",
    level: null,
    explanations: {
      eli5: "Instead of scribbling on your drawing, you trace a fresh copy and change only the one part. The old drawing stays safe.",
      curious: "The code never edits state in place. It makes a new object copied from the current one and changes just the field it needs. That way, if something else updated state while a slow task was running, the update isn't accidentally erased.",
      engineer: "set((cur) => ({ ...cur, codebase, refreshRequestedAt: null })) reads the CURRENT state at commit time rather than a value captured before an await. Spreading shares the untouched sub-objects by reference (structural sharing) and avoids lost updates from interleaved handlers.",
      wizard: "Persistent-data-structure discipline: each update yields a new root while sharing unchanged children, so old references stay valid snapshots. The functional updater linearizes concurrent mutations at commit time, which is what actually prevents the read-modify-write hazard a captured-state closure would create.",
    },
    cachedLevels: [],
  },
  {
    id: "demo-t-concurrency",
    title: "Visibility-gated polling",
    conceptKey: "visibility-gated-polling",
    category: "concurrency",
    summary: "Only tick while the panel is visible, and never let a slow tick overlap the next.",
    keyPoints: [
      "Skip the interval entirely when the document is hidden.",
      "An inFlight flag stops ticks from stacking.",
    ],
    refs: [
      { file: "canvas-kit/client.mjs", startLine: 68, endLine: 85, note: "pollWhileVisible gates on visibility and guards against overlapping ticks." },
    ],
    status: "new",
    level: null,
    explanations: {
      eli5: "A robot that waters plants only when you're home, and won't start a new watering until the last one finishes.",
      curious: "The auto-refresh timer does nothing while the panel is hidden, so a background tab stops hammering the server. And if one refresh is slow, the next tick waits instead of piling on top of it.",
      engineer: "pollWhileVisible returns a cleanup so it drops into a useEffect. Each run checks document.visibilityState and an inFlight boolean; a hidden panel or an outstanding tick short-circuits, so there's no request pile-up and no wasted work off-screen.",
      wizard: "It is a self-clocking guard around an interval: the visibility predicate sheds load under backgrounding, and the single-flight latch enforces at-most-one-in-flight, converting a naive fixed-rate poller into an adaptive one whose effective rate collapses to zero when unobserved.",
    },
    cachedLevels: [],
  },
  {
    id: "demo-t-system",
    title: "Sticky-on-scroll without IntersectionObserver",
    conceptKey: "sticky-scroll-no-io",
    category: "system",
    summary: "A capture-phase scroll listener plus rAF-throttled measurement, not a viewport observer.",
    keyPoints: [
      "A viewport-rooted IntersectionObserver misfires inside a scrolling webview container.",
      "Capture phase catches scroll on any ancestor; rAF throttles the layout read.",
    ],
    refs: [
      { file: "web/app.mjs", startLine: 929, endLine: 958, note: "Capture-phase scroll + getBoundingClientRect + requestAnimationFrame; the comment explains why not IntersectionObserver." },
    ],
    status: "new",
    level: null,
    // Intentionally missing the "wizard" level so the "Get this explanation" CTA shows.
    explanations: {
      eli5: "A little flag under the big controls. When it slides off the top, a small copy of the controls sticks to the top so you never lose them.",
      curious: "As you scroll, the code watches an invisible marker below the full control bar. When the marker reaches the top, it pins a compact bar. It measures once per animation frame so scrolling stays smooth.",
      engineer: "A capture-phase, passive scroll listener schedules one requestAnimationFrame measurement that reads sentinel.getBoundingClientRect().top and sets a 'stuck' flag when it's <= 0. An IntersectionObserver is avoided because a viewport-rooted IO never fires when the canvas scrolls an inner container, and a 1px target is fragile under fractional device-pixel ratios.",
    },
    cachedLevels: [],
  },
];

// Code-quality findings: strengths (good), so-so spots (ok), and a real problem (bad).
// One finding is already marked "requested" so the demo shows the fix lifecycle, and
// because the board sets a repo, "bad"/"requested" findings render the "Fix in a new
// session" deep link.
const FINDINGS = [
  {
    id: "demo-f-good-diff",
    quality: "good",
    title: "Diffing render loop preserves focus and caret",
    detail: "rerender() goes through Preact's render() rather than assigning innerHTML, so an incoming state push patches only changed nodes. That's the reason a live update never eats text you're typing or jumps your cursor.",
    topicId: "demo-t-pattern",
    file: "canvas-kit/client.mjs",
    startLine: 121,
    endLine: 123,
    suggestion: "",
    fixPrompt: "",
    fixStatus: "open",
  },
  {
    id: "demo-f-good-poll",
    quality: "good",
    title: "Polling is visibility-gated and won't stack ticks",
    detail: "pollWhileVisible skips work while the panel is hidden and uses an inFlight guard so a slow tick can't overlap the next. Cheap, correct defenses against wasted work and request pile-up.",
    topicId: "demo-t-concurrency",
    file: "canvas-kit/client.mjs",
    startLine: 68,
    endLine: 85,
    suggestion: "",
    fixPrompt: "",
    fixStatus: "open",
  },
  {
    id: "demo-f-ok-find",
    quality: "ok",
    title: "findTopic is a linear O(n) scan called per action",
    detail: "Several handlers call findTopic, an Array.find over all topics. n is tiny here so it's not a real problem, but it's a repeated lookup-by-id over an unindexed array.",
    topicId: "demo-t-complexity",
    file: "canvas.mjs",
    startLine: 194,
    endLine: 195,
    suggestion: "If topic counts ever grow large, maintain a Map<id, topic> alongside the array; otherwise accept the O(n) since curricula are small.",
    fixPrompt: "In extensions/code-tutor/canvas.mjs, add a Map<id, topic> index kept in sync with the topics array and have findTopic consult it in O(1). Preserve behavior and keep the smoke test green.",
    fixStatus: "open",
  },
  {
    id: "demo-f-ok-save",
    quality: "ok",
    title: "State save rewrites the whole JSON file on every action",
    detail: "save() serializes and writes the entire state document on every mutation, with no debouncing. For a human-paced tutor that's fine, but under rapid programmatic updates it's write amplification.",
    topicId: "demo-t-paradigm",
    file: "canvas-kit/storage.mjs",
    startLine: 34,
    endLine: 42,
    suggestion: "Debounce or coalesce writes (e.g. within ~250ms) so a burst of mutations collapses into one disk write.",
    fixPrompt: "In extensions/code-tutor/canvas-kit/storage.mjs, add debounced/coalesced writes to save() so a burst of mutations results in one disk write without losing the final state. Keep the load() contract and add a test.",
    fixStatus: "open",
  },
  {
    id: "demo-f-bad-syncfs",
    quality: "bad",
    title: "latestDomain() does synchronous fs in a loop",
    detail: "latestDomain() calls readdirSync, then readFileSync + statSync for every board file, on the open path. With many boards this blocks the event loop during a UI open, delaying first paint.",
    topicId: "demo-t-complexity",
    file: "canvas.mjs",
    startLine: 95,
    endLine: 120,
    suggestion: "Read directory entries and files asynchronously (fs/promises) and stat concurrently, or cache the most-recent-board result and invalidate on save.",
    fixPrompt: "In extensions/code-tutor/canvas.mjs, make latestDomain() asynchronous: use fs/promises, read candidate boards concurrently, and avoid blocking the event loop on the open path. Preserve the 'newest non-empty board' semantics and keep the smoke test green.",
    fixStatus: "requested",
  },
];

// A couple of learner questions: one already answered, one still pending (so the
// "Waiting for the tutor" state is visible).
const QUESTIONS = [
  {
    id: "demo-q-answered",
    text: "Why use Preact's render() instead of setting innerHTML?",
    topicId: "demo-t-pattern",
    level: "curious",
    answer: "Setting innerHTML throws away and rebuilds the DOM on every update, which loses focus, selection, and scroll position and is slower. Preact's render() diffs the new virtual tree against the live DOM and patches only what changed, so an incoming state push leaves the node you're typing in untouched.",
    answeredAt: SCANNED,
  },
  {
    id: "demo-q-pending",
    text: "Could the client miss an SSE frame while the tab is backgrounded?",
    topicId: "demo-t-pattern",
    level: "engineer",
    answer: null,
    answeredAt: null,
  },
];

/**
 * Build a complete, modern Code Tutor board in memory. No disk I/O.
 * @param {object} [opts]
 * @param {string} [opts.root]   codebase root the refs resolve against (default: the extension dir)
 * @param {string} [opts.repo]   GitHub owner/repo so findings show "Fix in a new session" (default: jongio/copilot-extensions)
 * @param {string} [opts.domain] board domain/key (default: "demo")
 * @returns {object} a board state ready to serialize into the artifacts store
 */
export function buildDemoState({ root = EXTENSION_DIR, repo = "jongio/copilot-extensions", domain = "demo" } = {}) {
  const stamp = (o) => ({ ...o, createdAt: CREATED, updatedAt: SCANNED });
  return {
    domain,
    defaultLevel: "curious",
    codebase: {
      label: "Code Tutor (demo)",
      root,
      repo,
      summary:
        "A guided tour of the Code Tutor canvas itself: the concepts, data structures, and design decisions " +
        "in its own kit. Every code reference points at real source in this extension, so snippets resolve anywhere.",
      fileCount: 22,
      languages: ["JavaScript (ESM)", "Preact/htm", "Node.js"],
      scannedAt: SCANNED,
      // Empty so analysis_status reports "not comparable" instead of "stale": the
      // overview/hero stay clean, and the dedicated freshness shot triggers the
      // banner explicitly via request_refresh.
      fingerprint: "",
    },
    topics: TOPICS.map(stamp),
    findings: FINDINGS.map(stamp),
    // Answered questions keep the fixed timestamp; the pending one is stamped "now"
    // so its "the tutor is thinking" timer reads a small, believable number.
    questions: QUESTIONS.map((q) => ({ ...q, createdAt: q.answer ? CREATED : new Date().toISOString() })),
    refreshRequestedAt: null,
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
  return join(base, "extensions", "code-tutor", "artifacts", `${safe}.json`);
}

/**
 * Write a demo board to <home>/extensions/code-tutor/artifacts/<domain>.json,
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
      "Seed a Code Tutor demo board.\n\n" +
        "  node demo/seed.mjs [--domain <name>] [--home <dir>]\n\n" +
        'Then open the canvas with input { domain: "<name>" } (default: demo).',
    );
    return;
  }
  const file = await seedDemoBoard({ home: args.home, domain: args.domain });
  console.log(`Seeded demo board (domain "${args.domain}") -> ${file}`);
  console.log(`Open the Code Tutor canvas with input { "domain": "${args.domain}" } to view it.`);
}

// Run main() only when executed directly, not when imported.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`seed failed: ${err?.message ?? err}`);
    process.exit(1);
  });
}
