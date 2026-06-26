# github-extensions

Jon's collection of **GitHub Copilot extensions** for the GitHub Copilot app. Most are
**canvas extensions** — interactive side-panel apps — but the collection isn't limited to
canvases: an extension can also just contribute agent tools or hooks with no UI at all.

## Install one

You install extensions from inside Copilot — just ask the agent:

> **install the stock-ticker canvas from jongio/github-extensions/extensions/stock-ticker**

Copilot fetches the folder into `~/.copilot/extensions/`, reloads, and it's ready. For a
canvas, then:

> **open stock ticker**

That's it — no clone, no CLI, no build step.

## Extensions

| Extension | Type | What it is |
| --- | --- | --- |
| [`stock-ticker`](extensions/stock-ticker) | Canvas | A personalized live stock watchlist — shared between you and the agent, with live quotes and sparklines. |

Each lives in its own folder under [`extensions/`](extensions) and is fully self-contained
(its `extension.mjs` plus whatever it needs — for a canvas that's `canvas-kit/` + `web/` +
`copilot-extension.json`), so any one installs on its own.

## Scope

Ask for **user** scope (default — `~/.copilot/extensions/<name>/`, just for you) or **project**
scope (`./.github/extensions/<name>/`, committed and shared with a repo's team). If you don't
say, Copilot installs to user scope.

## Building your own

Canvas extensions are built with [`create-canvas-kit`](https://github.com/jongio/create-canvas-kit) —
a Copilot skill that scaffolds a canvas (Preact + htm, Octicons, no build step). To add one here:
generate it with the kit, drop the folder under `extensions/`, add a row to the table above, and
it's installable the same way. See the kit's [**Ship it**](https://github.com/jongio/create-canvas-kit#ship-it)
section for the round trip.

Non-canvas extensions are just an `extension.mjs` that contributes tools or hooks — drop the
folder under `extensions/` and add a row with its type.

## Repository layout

```
github-extensions/
├─ extensions/                 # the extensions, one self-contained folder each
│  └─ stock-ticker/
├─ scripts/
│  └─ validate-extensions.mjs  # structure check (run in CI)
└─ .github/workflows/
   └─ validate.yml
```

Validate locally with `node scripts/validate-extensions.mjs`.

## License

MIT © Jon Gallant
