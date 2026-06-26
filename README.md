# github-extensions

Jon's collection of **GitHub Copilot canvas extensions** — interactive side-panel apps
for the GitHub Copilot app.

## Install one

You install canvases from inside Copilot — just ask the agent:

> **install the stock-ticker canvas from jongio/github-extensions/extensions/stock-ticker**

Copilot fetches the folder into `~/.copilot/extensions/`, reloads, and the canvas is ready.
Then:

> **open stock ticker**

That's it — no clone, no CLI, no build step.

## Extensions

| Extension | What it is |
| --- | --- |
| [`stock-ticker`](extensions/stock-ticker) | A personalized live stock watchlist canvas — shared between you and the agent, with live quotes and sparklines. |

Each lives in its own folder under [`extensions/`](extensions) and is fully self-contained
(`extension.mjs` + its `canvas-kit/` + `web/` + `copilot-extension.json`), so any one installs
on its own.

## Scope

Ask for **user** scope (default — `~/.copilot/extensions/<name>/`, just for you) or **project**
scope (`./.github/extensions/<name>/`, committed and shared with a repo's team). If you don't
say, Copilot installs to user scope.

## Building your own

These are built with [`create-canvas-kit`](https://github.com/jongio/create-canvas-kit) — a
Copilot skill that scaffolds a canvas (Preact + htm, Octicons, no build step). To add one here:
generate it with the kit, drop the folder under `extensions/`, add a row to the table above, and
it's installable the same way. See the kit's [**Ship it**](https://github.com/jongio/create-canvas-kit#ship-it)
section for the round trip.

## Repository layout

```
github-extensions/
├─ extensions/                 # the canvases, one self-contained folder each
│  └─ stock-ticker/
├─ scripts/
│  └─ validate-extensions.mjs  # structure check (run in CI)
└─ .github/workflows/
   └─ validate.yml
```

Validate locally with `node scripts/validate-extensions.mjs`.

## License

MIT © Jon Gallant
