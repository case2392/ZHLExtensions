# ZHL Productivity Pack — v1.60.0 (archived release)

This folder is a frozen snapshot of the extension at **version 1.60.0**,
extracted from git commit `2c8352f` ("v1.60.0: remote kill switch") for
Zillow Home Loans' review ahead of the Chrome Web Store publish.

## What's here

The `extension/` subfolder is the complete, loadable extension exactly as
it stood at v1.60.0 — manifest, background service worker, all module
content scripts, setup/walkthrough pages, icons, and images. Nothing has
been added or modified; it's a verbatim copy of the v1.60.0 tree.

## How to load it

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `release-1.60.0/extension` folder

`manifest.json` will report `"version": "1.60.0"`.

## Note

This is an archival copy for review only. Active development continues on
the main extension at the repository root (`extension/`), which is well
ahead of 1.60.0. If you need a different version snapshot, ask and it can
be extracted from the corresponding git tag/commit the same way.
