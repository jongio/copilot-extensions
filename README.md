# copilot-extensions

Jon's collection of **GitHub Copilot extensions** — they work in both the **GitHub Copilot
app** and the **Copilot CLI**, which load extensions from the same place. Most are **canvas
extensions** (interactive side-panel apps, app-only since the CLI has no panel), but the
collection isn't limited to canvases: an extension can also just contribute agent tools or
hooks with no UI at all, and those run anywhere Copilot does.

## Install one

You install extensions from inside Copilot — in the app or the CLI, just ask the agent:

> **install the stock-ticker canvas from jongio/copilot-extensions/extensions/stock-ticker**

Copilot fetches the folder into `~/.copilot/extensions/`, reloads, and it's ready. For a
canvas, then (in the app):

> **open stock ticker**

That's it — no clone, no CLI flags, no build step.

## Extensions

| Extension | Type | What it is |
| --- | --- | --- |
| [`news-aggregator`](extensions/news-aggregator) | Canvas | Pick a topic or free-text search and get a live, shared news feed (Google News, no API key). Save/favorite/hide items, search history, pin searches as custom topics with auto-picked icons, sort & filter, and visible-only auto-refresh. |
| [`stock-ticker`](extensions/stock-ticker) | Canvas | A personalized live stock watchlist — shared between you and the agent, with live quotes and sparklines. |
| [`random-animal`](extensions/random-animal) | Canvas | Roll the dice to discover a random animal and a fun fact — with bounce-in animations, floating emojis, and roll history. |
| [`language-tutor`](extensions/language-tutor) | Canvas | Pick a language and a gamified course appears — flashcards, quizzes, XP, levels, streaks, hearts, gems, mascots and confetti. You and the agent share one learner profile. |

Each lives in its own folder under [`extensions/`](extensions) and is fully self-contained
(its `extension.mjs` plus whatever it needs — for a canvas that's `canvas-kit/` + `web/` +
`copilot-extension.json`), so any one installs on its own.

## Scope

Ask for **user** scope (default — `~/.copilot/extensions/<name>/`, just for you) or **project**
scope (`./.github/extensions/<name>/`, committed and shared with a repo's team). If you don't
say, Copilot installs to user scope.

## Building your own

Canvas extensions are built with [`create-canvas-kit`](https://github.com/jongio/skills/tree/main/skills/create-canvas-kit) —
a Copilot skill (in [`jongio/skills`](https://github.com/jongio/skills)) that scaffolds a canvas
(Preact + htm, Octicons, no build step). To add one here: generate it with the kit, drop the folder
under `extensions/`, add a row to the table above, and it's installable the same way. See the kit's
[**Ship it**](https://github.com/jongio/skills/blob/main/skills/create-canvas-kit/README.md#ship-it)
section for the round trip.

Non-canvas extensions are just an `extension.mjs` that contributes tools or hooks — drop the
folder under `extensions/` and add a row with its type.

## Repository layout

```
copilot-extensions/
├─ extensions/                 # the extensions, one self-contained folder each
│  ├─ news-aggregator/         # …each with a test/smoke.test.mjs
│  ├─ stock-ticker/
│  ├─ random-animal/
│  └─ language-tutor/
├─ scripts/
│  ├─ validate-extensions.mjs  # structure check (run in CI)
│  └─ run-tests.mjs            # runs every extension's smoke test
└─ .github/workflows/
   └─ validate.yml
```

Validate locally with `node scripts/validate-extensions.mjs`, and run the smoke
tests with `node scripts/run-tests.mjs` (each boots its canvas's kit runtime over
loopback HTTP — no SDK, no network). CI runs the structure check.

## License

MIT © Jon Gallant
