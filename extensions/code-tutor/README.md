# Code Tutor

Turns the current codebase into a personal CS course. The agent reads your repo and pulls out the algorithms, data structures, complexity results, patterns and theory hiding in the code, then teaches each one at a level you choose. You learn how your own code really works.

A GitHub Copilot App **canvas extension**: the agent and the user share the same live state through the same action handlers, and the view renders with Preact + htm and a vendored kit, with no build step and no `package.json`.

## What it does

- **Extracts CS concepts from the code** and files each under a category (algorithm, data structure, complexity, theory, pattern, paradigm, concurrency, system).
- **Adjustable reading level** with a 4-stop slider: `ELI5` (like I'm 5), `Curious` (plain English), `Engineer` (technical), `Wizard` (deep). The default level is global; every topic also remembers its own.
- **Concept library cache**: generic, codebase-independent explanations are saved once and reused across boards, so the same "ELI5 of binary search" is not regenerated every time.
- **Points at real code**: every topic and finding links to a file and line range. Click a reference to expand the actual source with language-aware syntax highlighting (read straight from disk under the codebase root).
- **Mark your understanding** per topic: Understood, Not understood, Revisit, or New. A progress ring tracks how much you have understood.
- **Ask and clarify**: ask questions per topic or globally; the agent answers in the panel.
- **Code review**: flags good / ok / bad spots (perf, wrong data structures, suboptimal algorithms). When the board knows its GitHub `owner/repo`, each issue gets a one-click **Fix in a new session** deep link (`ghapp://session/new`) that opens a dedicated Copilot session to run the fix; otherwise it copies a ready-to-run prompt for the agent to pick up.
- **Freshness tracking**: fingerprints the code (git HEAD + newest file mtime) at analysis time, re-checks on a visibility-gated timer, and shows a "code changed, refresh" banner plus an always-available Refresh button. Code Tutor never re-analyzes on its own; analysis is the agent's job, so the Refresh button injects a re-analysis prompt into the current Copilot session.

## Layout

```
extension.mjs        the ONLY file that imports the Copilot SDK (thin adapter)
canvas.mjs           canvas config: state load/save + action handlers (SDK-free)
cache.mjs            the cross-board concept library + the codebase-specific heuristic
canvas-kit/          vendored kit (copied verbatim; do not edit)
web/index.html       shell that loads /kit/theme.css, ./styles.css and ./app.mjs
web/app.mjs          the Preact view
web/highlight.mjs    dependency-free, language-aware syntax tokenizer
web/styles.css       the visual design system
test/smoke.test.mjs  boots the runtime over HTTP and exercises the actions
```

## Validate

```
node test/smoke.test.mjs
```

## Install

Copy this folder into `.github/extensions/code-tutor` (in-repo) or
`$COPILOT_HOME/extensions/code-tutor` (personal), then run `extensions_reload` and
open it with `open_canvas` (`canvasId: "code-tutor"`). Point it at a codebase by
asking Copilot to analyze the repo; it calls `set_codebase` (with a `root` so
code references resolve, and optionally `repo` as `owner/repo` to enable the
"Fix in a new session" deep links) and then authors the topics, references and
findings.

## Keeping the kit current

`canvas-kit/` is a vendored snapshot of the create-canvas-app `kit/`. Re-sync it
with the skill's `scripts/sync-kit.mjs`, and gate drift in CI with
`scripts/check-kit-freshness.mjs`.
