# Chrome Web Store listing assets — ZHL Productivity Pack

Everything in this folder maps to a specific field on the Chrome Web
Store listing form. Upload / paste them as marked below.

## What goes where

| Form field | File in this folder | Notes |
| --- | --- | --- |
| Short description (132-char card blurb) | `description-short.txt` | Already in the extension's `manifest.json` too — Chrome reads it from there automatically. Field on the form is a paste-in mirror. |
| Detailed description (long body) | `description-long.md` | Paste the whole file. Markdown bullets render as plain bullets on the listing. |
| Store icon (128×128 PNG) | `icon-128.png` | Same artwork the extension ships with at `extension/icons/icon128.png`. |
| Screenshot 1 (1280×800) | `screenshot-1-setup-page.png` | Setup page — shows feature toggles + LO Profile. The "30+ shortcuts in one place" pitch. |
| Screenshot 2 (1280×800) | `screenshot-2-appraisal-blast.png` | A Gmail compose with the formatted "🎉 Congratulations!" body + equity highlight box. Most visually appealing. |
| Screenshot 3 (1280×800) | `screenshot-3-meeting-reminder.png` | Reminder pop-up over the Gmail inbox showing two due meetings with Join + Snooze + Dismiss. |
| Screenshot 4 (1280×800) | `screenshot-4-loan-comparison-pdf.png` | Borrower-facing Loan Comparison print preview with PITIA + Cash to Close rows in ZHL blue. |
| Screenshot 5 (1280×800) | `screenshot-5-pricing-exception.png` | Pricing Exception Workflow modal — auto-computed PE $ / points + generated email preview. |
| Small Promo Tile (440×280) | `promo-tile-small-440x280.png` | Optional. ZHL navy branding + feature chips. |
| Marquee Promo Tile (1400×560) | `promo-tile-marquee-1400x560.png` | Optional. Featured-section banner. |
| Support URL | `support-url.txt` | GitHub Issues page — accepts bug reports and feature requests. |

## Upload order on the form

1. **Product details → Description** — paste `description-long.md`.
2. **Graphics → Store icon** — upload `icon-128.png`.
3. **Graphics → Screenshots** — upload `screenshot-1` through `screenshot-5` in order.
4. **Graphics → Promotional images** (optional) — upload both promo tiles.
5. **Privacy / additional fields → Support URL** — paste contents of `support-url.txt`.

## Editing the visuals

Each PNG in this folder has a matching `.svg` source in
`svg-sources/`. To tweak any of them:

1. Edit the `.svg` in any vector editor (or a plain text editor — they
   are hand-authored SVG, no binary baggage).
2. Re-run `./build.sh` from this folder. It uses the pre-installed
   Chromium to re-render every SVG to PNG at its declared `viewBox`
   dimensions.

The build script handles `width`/`height` derivation, transparent
backgrounds, and exact pixel sizing — no flags to remember.

## What these are vs. what Google probably expects

The five screenshots in this folder are **stylized mockups** I built
from SVG so the listing has consistent, on-brand imagery. They
accurately portray what the extension does (every UI element shown
exists in the real extension), but they aren't raw screen captures.

That's a normal, accepted pattern for Chrome Web Store listings —
most polished listings use designed mockups rather than messy raw
screenshots. If you'd rather replace them with real screenshots,
just drop your captures into this folder using the same filenames
and they'll override these for the upload step.

Built by Justin Case. Karma appreciated 💛
