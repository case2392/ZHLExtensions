# Store icon

Three files in this folder:

| File | Size | Use |
|---|---|---|
| `store-icon.svg` | scalable | The source. Re-render at any size. |
| `store-icon.png` | 128×128 | **Upload this** as the Web Store "Store icon" field. |
| `store-icon-440.png` | 440×440 | Optional — if you want to use it as the "Marquee promo tile" or for any internal promotional use. |

## Where to upload it

In the Chrome Web Store dashboard, on your item's listing page:

1. Find the **"Store icon"** field (top of the form, next to the item name).
2. Click upload, choose `store-icon.png` (the 128×128 file).
3. Save.

This is the icon shown in the Web Store search results, on your listing page, and as the "this is what you're installing" preview. It's separate from the toolbar icon (the in-Chrome icon that shows next to the address bar) — that one stays as `extension/icons/icon128.png` unchanged.

## Want the in-product toolbar icon updated to match too?

Right now the toolbar icon (`extension/icons/icon128.png`) is the simpler flat blue Z. The Store icon is the polished gradient version with the lightning badge. They're consistent (same brand) but visually distinct.

If you want them to match, just say the word and I'll re-render the SVG at 16×16, 48×48, 128×128 and replace the `extension/icons/` files. Personally I'd leave the toolbar icon as-is — the simpler flat version reads better at 16px in the address bar, and the more detailed version is appropriate for the bigger Web Store spot.

## Re-rendering at other sizes

The SVG is the source. Render at any size:

**Online (no install):** https://cloudconvert.com/svg-to-png — drop the SVG, set width/height, download.

**With Python (cairosvg):**
```bash
pip install cairosvg
python3 -c "import cairosvg; cairosvg.svg2png(url='store-icon.svg', write_to='store-icon-256.png', output_width=256, output_height=256)"
```

**With ImageMagick or Inkscape:** standard `convert` / `inkscape --export-type=png` flags.
