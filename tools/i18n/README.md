# Simplified Chinese localization

The game's text is English and was never routed through a string table, so the translation is applied at display time instead of rewriting every call site.

## How it works at runtime

- `src/i18n/index.ts` picks the language (`?lang=zh|en`, then the `sfh3.lang` value saved by the Options page, then the browser language), loads the dictionary and exposes `tr()`. The English UI never loads the dictionary and behaves exactly as before.
- `src/i18n/pixi.ts` hooks Pixi `Text`: assigning `text` goes through `tr()`, the font list gets a Chinese font appended, and Chinese text may wrap between any two characters (with the usual line-start/line-end punctuation rules).
  - Code that compares a label with its English source should use `srcText(t)` instead of `t.text`.
  - Player-supplied text (names, chat, map titles) should be wrapped with `rawText(t)` so it is never translated.
- `src/i18n/dom.ts` translates text nodes and `title` / `placeholder` / `aria-label` attributes in the map editor and the HTML overlays (MutationObserver). Elements with `data-raw` are skipped.
- `src/i18n/runs.ts` re-lays out the Tips and Credits pages. Those pages come from Flash static text, one word per fragment positioned by coordinates, so translating word by word would produce fragments. Fragments are regrouped into lines and, when a paragraph matches a dictionary entry, replaced by one wrapped Chinese paragraph. A `|` in the translation marks the gap the original left for an inline icon.
- `src/i18n/zh.json` maps English source text to Chinese. Entries containing `{0}` `{1}` are templates; the captured arguments are translated again if they are known strings. Entries differing only in case share one translation.
- Fonts (`public/fonts/zh/`, SIL OFL 1.1, licences alongside): ZCOOL QingKe HuangYou for the display faces (Xoireqe, QTypeSquare BlackMajuscles) and Noto Sans SC Regular/Bold for the rest. They are subset to the characters the translation uses, about 170 KB each. **After editing `zh.json`, rebuild them**, otherwise new characters fall back to a system font:

  ```sh
  python tools/i18n/subset_fonts.py <ZCOOLQingKeHuangYou-Regular.ttf> <NotoSansSC-VF.ttf>
  ```

  This needs `fontTools` and `brotli` (`pip install fonttools brotli`). The download locations are in the script header.

To find strings that were missed, switch to Chinese and run `sfh3I18n.missing()` in the browser console; it lists English that was displayed but is not in the dictionary.

The Options page has a language button. It reloads the page, because screens and fonts are built once per language.

## Where the translations came from

`zh.json` is the source of truth now; small fixes can be made directly in it. The first version was produced like this, which is also how to add a large batch of new strings:

1. `node tools/i18n/extract.mjs <catalog.json>` extracts displayable English from `src/` and `src/assets/*.json` with the TypeScript AST. Template literals and `+` concatenations become `{0}` templates, each entry with its source location.
2. `node tools/i18n/batches.mjs <catalog.json> <dir> 150` splits the catalog into batches by source file.
3. Translate and polish each batch following `tools/i18n/glossary.md` (terminology and style rules for Chinese).
4. `node tools/i18n/check.mjs <catalog.json> <drafts-dir> --glossary=tools/i18n/glossary.md` checks missing entries, placeholders, newlines, surrounding whitespace and terminology. `split-issues.mjs` splits the findings per batch for the polishing pass.
5. Corrections go into an `*.ids.json` file (`{ "<catalog id>": "中文" }`) or an `{ "English": "中文" }` file; `tools/i18n/review/extras.json` holds the extra entries used for the first version.
6. `node tools/i18n/build-dict.mjs <catalog.json> <drafts-dir> [fixes.ids.json] [extras.json]` writes `src/i18n/zh.json`.

Catalog ids follow source order, so they change when the code does. To add strings later, re-extract, translate only what `zh.json` does not already contain, and merge into the existing file instead of regenerating it from old `*.ids.json` files.

## Not done yet

- English baked into images: the top tabs, panel headings (PRIMARY WEAPON, GRAPHICS, ...), the large buttons, DAY / FUNDS in the bottom bar, the tutorial pictures. These have to be re-rendered from the original SWF with the text replaced.
- Messages sent by the multiplayer server are only translated where the client recognises the text.
