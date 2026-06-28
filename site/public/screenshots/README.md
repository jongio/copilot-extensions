# Screenshots

Drop a screenshot per extension here and the matching card on the home page picks
it up automatically. Name each file after the extension's folder slug:

| File | Used by |
| --- | --- |
| `news-aggregator.png` | news-aggregator card |
| `stock-ticker.png` | stock-ticker card |
| `random-animal.png` | random-animal card |
| `language-tutor.png` | language-tutor card |
| `wiki-discover.png` | wiki-discover card |
| `code-tutor.png` | code-tutor card |

Until a file exists, the card shows `placeholder.svg`. PNG or JPG both work — keep
the path/extension in sync with `src/pages/index.astro` if you use something other
than `.png`. A ~16:9 image (e.g. 1280×720) looks best.
