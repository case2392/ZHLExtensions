// ZHL Productivity Pack — Zillow Docs bulk-download helper
//
// Runs on https://www.zillowdocs.com/embed/editor* alongside the
// credit-report-reader.js content script. We're triggered when the
// task-bulk-download.js operator-side flow opens this URL in a
// background tab with an armed-flag in chrome.storage. We wait for
// the viewer's Download button to render, click it (full mouse-event
// sequence so React's onClick handler fires), wait briefly for the
// download to start, then signal back to background.js — which
// closes our tab and resolves the outer flow's promise.
//
// ARMED-FLAG GATE: same pattern as credit-report-reader.js. We only
// auto-click Download when the bulk-download flow armed us within
// the last 5 minutes. If the user opens a doc manually, this script
// stands down so the user can read / print / download it themselves.
(function () {
  'use strict';

  console.log('[ZHL Doc Downloader] loaded on', location.href);

  const ARM_WINDOW_MS = 5 * 60 * 1000;
  const ARMED_KEY = 'zhlBulkDownloadArmed';

  chrome.storage.local.get([ARMED_KEY], function (data) {
    const armed = data && data[ARMED_KEY];
    const age = armed && armed.armedAt ? Date.now() - armed.armedAt : Infinity;
    if (!armed || age > ARM_WINDOW_MS) {
      console.log('[ZHL Doc Downloader] Not armed (user opened this manually). Standing down.');
      return;
    }
    // Clear the flag immediately so subsequent manual opens don't
    // get auto-downloaded.
    try { chrome.storage.local.remove([ARMED_KEY]); } catch (_) {}
    console.log('[ZHL Doc Downloader] Armed by Task Bulk Download flow (age ' + age + 'ms, target ' + (armed.url || '').slice(0, 80) + '…). Starting capture.');
    startDownload(armed);
  });

  function clickWithMouseEvents(el) {
    try {
      ['mousedown', 'mouseup', 'click'].forEach(function (type) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0 }));
      });
    } catch (_) {
      try { el.click(); } catch (_) {}
    }
  }

  function findDownloadButton() {
    // The Download button is a <button> with text "Download" and a
    // <title>Download</title> in its inner SVG. Class names are
    // minified and rotate, so text-matching is the durable approach.
    const buttons = document.querySelectorAll('button');
    for (const b of buttons) {
      if (b.disabled) continue;
      // Prefer the button whose SVG <title> says Download — that's
      // the icon button at the top right of the viewer. Fall back
      // to text match if the title scheme changes.
      const svgTitle = b.querySelector('svg title');
      if (svgTitle && /^\s*download\s*$/i.test(svgTitle.textContent || '')) return b;
    }
    for (const b of buttons) {
      if (b.disabled) continue;
      const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^download$/i.test(t)) return b;
    }
    return null;
  }

  async function startDownload(armed) {
    const MAX_ATTEMPTS = 60;  // 60 × 500ms = 30s
    let attempts = 0;
    let downloadBtn = null;
    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      downloadBtn = findDownloadButton();
      if (downloadBtn) break;
      await new Promise(function (r) { setTimeout(r, 500); });
    }
    if (!downloadBtn) {
      console.warn('[ZHL Doc Downloader] Download button never appeared after', attempts, 'attempts.');
      try {
        chrome.runtime.sendMessage({
          type: 'ZHL_BULK_DOWNLOAD_TAB_DONE',
          result: { ok: false, reason: 'Download button never rendered' }
        });
      } catch (_) {}
      return;
    }
    console.log('[ZHL Doc Downloader] Found Download button after', attempts, 'attempts. Clicking.');
    clickWithMouseEvents(downloadBtn);
    // Give the download a moment to start before we ask the
    // background to close us. Without this beat, closing the tab
    // can interrupt the in-flight Blob fetch the viewer triggers.
    await new Promise(function (r) { setTimeout(r, 1500); });
    try {
      chrome.runtime.sendMessage({
        type: 'ZHL_BULK_DOWNLOAD_TAB_DONE',
        result: { ok: true, attempts: attempts }
      });
    } catch (e) {
      console.warn('[ZHL Doc Downloader] sendMessage failed:', e);
    }
  }
})();
