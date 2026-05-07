# Screenshots for the Chrome Web Store listing

Three SVG mockups (1280×800) ready to render to PNG and upload. Or use them as visual guides for taking real screenshots — real screenshots are usually more compelling, but the mockups are reviewer-acceptable on their own.

## Files

| File | What it shows |
|---|---|
| `01-setup-page.svg` | The setup page card grid — 6 of the 11 modules visible with their toggle states. |
| `02-scenario-sort.svg` | Pricing & Scenarios with the sort toolbar at top, 6 cards in rate-ascending order, "Calc 2-1 Buydown" buttons under each card, the assigned-to-loan card highlighted in green. |
| `03-caller-id-sms.svg` | Side-by-side: Caller ID badge on a Genesys active call card (left), and the SMS Quick-Add Participants Add Buyer's Agent / Add Co-Borrower buttons (right). |

## Convert SVG → PNG

The Web Store accepts PNG. Easiest:

**Option A — using a browser** (no install):
1. Open the `.svg` file in Chrome.
2. Right-click → "Save image as…" — but Chrome won't render at 1280×800 by default. Better:
3. Use https://cloudconvert.com/svg-to-png — drop the file, set dimensions to 1280×800, download.

**Option B — using `rsvg-convert`** (Mac: `brew install librsvg`; Linux: `apt install librsvg2-bin`):
```bash
cd docs/web-store/screenshots
for f in *.svg; do
  rsvg-convert -w 1280 -h 800 "$f" -o "${f%.svg}.png"
done
```

**Option C — Inkscape** (cross-platform):
```bash
inkscape --export-type=png --export-width=1280 --export-height=800 *.svg
```

## Upload

In the Web Store dashboard listing form → Screenshots section → upload all three PNGs. Order matters; the first one is the listing's "hero" image. Suggested order:
1. `01-setup-page.png` — gives reviewers the "what is this" overview.
2. `02-scenario-sort.png` — shows the most-used active feature.
3. `03-caller-id-sms.png` — shows two more features in real product context.

## Replacing with real screenshots (optional, recommended)

If you want sharper credibility, take real screenshots:

1. Open the extension's setup page, full window, 1280×800. Use Chrome's DevTools device toolbar to lock the viewport. Capture.
2. Open a Pricing & Scenarios page on a sample loan. Click Rate ↑ once. Capture full page.
3. Open Genesys with an active test call + a Salesforce SMS thread side by side. Capture both windows.

Crop each to 1280×800. PNG. Upload these instead of the SVG renders.
