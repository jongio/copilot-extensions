# Screenshots

Drop a screenshot per extension here and the matching card on the home page picks
it up automatically. Name each file after the extension's folder slug:

| File | Used by |
| --- | --- |
| `pr-statusline.png` | pr-statusline card, lightbox, and annotated visual guide |
| `issue-statusline.png` | issue-statusline card, lightbox, and annotated visual guide |
| `subagent-statusline.png` | subagent-statusline card, lightbox, and annotated visual guide |
| `statusline-composed-terminal.png` | Composed PR + Issue + Subagent 3-type overview diagram |
| `crops/*.png` | Up-close 2x-zoomed token and pill screenshots for the statusline breakdown cards |
| `news-aggregator.png` | news-aggregator card |
| `stock-ticker.png` | stock-ticker card |
| `random-animal.png` | random-animal card |
| `language-tutor.png` | language-tutor card |
| `wiki-discover.png` | wiki-discover card |
| `code-tutor.png` | code-tutor card |

Until a file exists, the card shows `placeholder.svg`. PNG or JPG both work — keep
the path/extension in sync with `src/pages/index.astro` if you use something other
than `.png`. A ~16:9 image (e.g. 1280×720) looks best.
