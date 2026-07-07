# Screenshots

Two things live here, both consumed by the home page (`src/pages/index.astro`):

1. A **card + hero image** per extension, named after the extension's folder slug
   (e.g. `code-tutor.png`). The card grid and the lightbox hero use it.
2. An optional **per-extension gallery folder**, named after the slug (e.g.
   `code-tutor/`), holding one image per feature. When it exists, that extension's
   lightbox shows the images as a thumbnail gallery with captions. Captions and
   order live in `src/pages/index.astro` (the `shots` list). Without a folder, the
   lightbox just shows the single hero.

| Path | Used by |
| --- | --- |
| `code-tutor.png` | code-tutor card + hero |
| `code-tutor/*.png` | code-tutor lightbox gallery |
| `language-tutor.png` | language-tutor card + hero |
| `stock-ticker.png` | stock-ticker card + hero |
| `news-aggregator.png` | news-aggregator card + hero |
| `wiki-discover.png` | wiki-discover card + hero |
| `random-animal.png` | random-animal card + hero |

Until a slug's image exists, the card shows `placeholder.svg`. PNG or JPG both
work. A ~16:9 image (e.g. 1280x720) looks best for the card.

Code Tutor's images are generated, not hand-captured: run
`node extensions/code-tutor/demo/screenshot.mjs`, which writes the hero
(`code-tutor.png`) and the gallery (`code-tutor/*.png`) here.
