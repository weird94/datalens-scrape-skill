# Text that looks right on screen but scrapes as garbage

Some sites (novel readers, review and ranking sites, price pages) draw text with a custom web font that maps scrambled code points to the real glyphs. On screen it reads fine; in the DOM the characters are private-use code points (U+E000–U+F8FF) or the wrong characters.

## Spot it
- `verify.mjs` examples show boxes, empty-looking strings, or characters that don't match the screen.
- The element's computed `font-family` points to an `@font-face` with a site-hosted `.woff`/`.woff2`/`.ttf` (often a random name).
- Only digits, or only common characters, are scrambled — the rest is normal.

## Decode it
1. Download the font file the element uses (find the `@font-face` rule; one font is usually shared by the whole page).
2. List its character map (Python `fontTools`: `TTFont(path).getBestCmap()`); keep the private-use code points that appear in your data.
3. Render each glyph to an image (fontTools + Pillow; CFF fonts load more reliably saved as `.otf`) and read it with OCR or a vision model, in batches on a labelled grid.
4. Build a code-point → character map and replace in the CSV.
5. Check: no private-use characters left; no two code points decoded to the same character unless the font really has duplicates; visually similar characters (己/已/巳, 戊/戌/戍) checked by hand.

## Things to know
- The mapping is often fixed per font file but some sites rotate fonts per request or session. Load the page twice and compare font URLs before reusing a map.
- Sites that use font obfuscation often also rate-limit; stop at verification pages.
