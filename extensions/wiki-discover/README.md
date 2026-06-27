# Wiki Discover

A "for you" random Wikipedia reader. Thumbs up or down each article and the
canvas learns a per-topic preference model, then re-ranks a pool of random
articles so the feed leans toward the topics you like.

A GitHub Copilot App **canvas extension** generated with the `create-canvas-app`
skill. The agent and the user share the same live state through the same action
handlers; the view renders with Preact + htm and a vendored kit — no build step,
no `package.json`.

## How it works

1. **`next_article`** pulls a pool of random articles from the Wikipedia
   MediaWiki API (`generator=random`) — title, summary, short description, and
   thumbnail — whenever the on-screen card is empty or the candidate queue runs
   low. The fetch lives in the action handler (server-side, with an
   `AbortSignal.timeout`); the view only triggers it.
2. **`rate`** thumbs an article up or down. Each article is tokenized from its
   description + title (stopwords dropped); a thumbs-up nudges those topic
   weights `+1`, a thumbs-down `-1` (clamped so no single topic runs away).
3. The candidate pool is **scored** against the learned weights
   (`score = Σ weights[token]`) and re-ranked on every rating, so the very next
   article — and the "Up next" preview — reflect your latest taste. "Up next"
   shows each card's match score, making the learning visible.

State is durable per **profile** (a personal taste model) under
`$COPILOT_HOME/extensions/wiki-discover/artifacts/<profile>.json`.

## Layout

```
extension.mjs        the ONLY file that imports the Copilot SDK (thin adapter)
canvas.mjs           recommender: Wikipedia fetch + tokenizer + weight model + actions
canvas-kit/          vendored kit (copied verbatim; do not edit)
web/index.html       shell that loads /kit/theme.css and ./app.mjs
web/app.mjs          Preact view: hero card, profile strip, up-next preview
test/smoke.test.mjs  boots the runtime over HTTP and exercises the actions
```

## Actions (agent + UI share every one)

| Action | What it does |
| --- | --- |
| `next_article` | Refill + re-rank the pool and put the best unseen match on screen. |
| `rate` | `{ value: "up" \| "down", article? }` — train the model on the current (or a supplied) article and advance. |
| `skip` | Move on without training. |
| `set_lang` | Switch the Wikipedia language edition (`en`, `es`, `simple`, …). |
| `reset_preferences` | Forget all learned weights and history. |
| `list_recommendations` | Text summary of the current article + top learned topics (for the agent). |

## Validate

```
node test/smoke.test.mjs
```

The learning path is covered offline by rating explicit article payloads; one
case exercises a live `next_article`.

## Install

This repo loads every folder in `extensions/`. After changes, run
`extensions_reload` and open it with `open_canvas` (`canvasId: "wiki-discover"`).

## Keeping the kit current

`canvas-kit/` is a vendored snapshot of the create-canvas-app `kit/`. Re-sync it
with the skill's `scripts/sync-kit.mjs`, and gate drift with
`scripts/check-kit-freshness.mjs`.
