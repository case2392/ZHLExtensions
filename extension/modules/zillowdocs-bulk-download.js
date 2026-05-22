// ZHL Productivity Pack — Zillow Docs bulk-download helper
//
// Runs on https://www.zillowdocs.com/embed/editor* alongside the
// credit-report-reader.js content script. We're triggered when the
// task-bulk-download.js operator-side flow opens this URL in a
// background tab with an armed-flag in chrome.storage.
//
// ARMED-FLAG GATE: same pattern as credit-report-reader.js. We only
// auto-click Download when the bulk-download flow armed us within
// the last 5 minutes. If the user opens a doc manually, this script
// stands down so the user can read / print / download it themselves.
//
// SILENT DOWNLOAD PATH:
// zillowdocs-download-interceptor.js (MAIN world) intercepts the
// viewer's programmatic anchor.click() and posts the blob URL back
// here. We fetch the blob, base64-encode it, and ask background.js
// to call chrome.downloads.download({ saveAs: false }) — so the file
// lands in the default Downloads folder with no "where do you want to
// save?" dialog. If the intercept doesn't fire within 8 s we fall back
// to the original click-and-wait path (file downloads normally but may
// show the dialog depending on Chrome settings).
(function () {
  'use strict';

  console.log('[ZHL Doc Downloader] loaded on', location.href);

  const ARM_WINDOW_MS = 5 * 60 * 1000;
  const ARMED_KEY = 'zhlBulkDownloadArmed';
  const INTERCEPT_TIMEOUT_MS = 8000;

  chrome.storage.local.get([ARMED_KEY], function (data) {
    const armed = data && data[ARMED_KEY];
    const age = armed && armed.armedAt ? Date.now() - armed.armedAt : Infinity;
    if (!armed || age > ARM_WINDOW_MS) {
      console.log('[ZHL Doc Downloader] Not armed (user opened this manually). Standing down.');
      return;
    }
    try { chrome.storage.local.remove([ARMED_KEY]); } catch (_) {}
    console.log('[ZHL Doc Downloader] Armed (age ' + age + 'ms, target ' +
      (armed.url || '').slice(0, 80) + '…). Starting capture.');
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
    const buttons = document.querySelectorAll('button');
    for (const b of buttons) {
      if (b.disabled) continue;
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

  // Convert a Blob to { base64, mimeType } using FileReader.
  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const result = reader.result || '';
        const comma = result.indexOf(',');
        resolve({
          base64: comma >= 0 ? result.slice(comma + 1) : result,
          mimeType: blob.type || 'application/pdf'
        });
      };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  async function startDownload(armed) {
    // Poll for the Download button (up to 30 s).
    const MAX_ATTEMPTS = 60;
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
    console.log('[ZHL Doc Downloader] Found Download button after', attempts, 'attempts.');

    // Arm the MAIN-world interceptor by setting a DOM attribute — the
    // interceptor checks this before swallowing any anchor click.
    document.documentElement.setAttribute('data-zhl-bulk-armed', '1');

    // Listen for the interceptor's postMessage (blob URL captured).
    let interceptResolve = null;
    const interceptPromise = new Promise(function (resolve) { interceptResolve = resolve; });
    function onWindowMessage(e) {
      if (e.data && e.data.__zhlDl === true) {
        window.removeEventListener('message', onWindowMessage);
        resolve(e.data);
      }
    }
    // Keep a reference so we can clean up if timeout fires first.
    function resolve(v) {
      window.removeEventListener('message', onWindowMessage);
      if (interceptResolve) { interceptResolve(v); interceptResolve = null; }
    }
    window.addEventListener('message', onWindowMessage);

    console.log('[ZHL Doc Downloader] Clicking Download button.');
    clickWithMouseEvents(downloadBtn);

    // Wait up to INTERCEPT_TIMEOUT_MS for the blob intercept.
    const interceptTimeout = new Promise(function (r) {
      setTimeout(function () { r(null); }, INTERCEPT_TIMEOUT_MS);
    });
    const intercepted = await Promise.race([interceptPromise, interceptTimeout]);
    resolve(null); // clean up listener if timeout won

    if (intercepted && intercepted.url) {
      console.log('[ZHL Doc Downloader] Blob intercepted:', intercepted.url.slice(0, 60),
        'name:', intercepted.name || '(none)');
      try {
        const response = await fetch(intercepted.url);
        if (!response.ok) throw new Error('fetch blob failed: ' + response.status);
        const blob = await response.blob();
        const { base64, mimeType } = await blobToBase64(blob);

        // Derive filename: prefer what the viewer set, fall back to docName.
        let filename = (intercepted.name || '').trim() || (armed.docName || 'document');
        if (!/\.[a-z0-9]{2,5}$/i.test(filename)) filename += '.pdf';

        console.log('[ZHL Doc Downloader] Sending', blob.size, 'bytes to background for silent download.');
        await new Promise(function (resolve) {
          try {
            chrome.runtime.sendMessage({
              type: 'ZHL_BULK_DOWNLOAD_DATA',
              base64: base64,
              mimeType: mimeType,
              filename: filename
            }, function (resp) {
              if (chrome.runtime.lastError) {
                console.warn('[ZHL Doc Downloader] sendMessage ZHL_BULK_DOWNLOAD_DATA error:',
                  chrome.runtime.lastError.message);
              } else {
                console.log('[ZHL Doc Downloader] background download result:', resp);
              }
              resolve();
            });
          } catch (e) {
            console.warn('[ZHL Doc Downloader] sendMessage threw:', e);
            resolve();
          }
        });
      } catch (e) {
        console.warn('[ZHL Doc Downloader] blob fetch/encode failed, falling back to native download:', e);
        // Blob is gone — the original native download already didn't happen
        // (we swallowed the click). Nothing left to do but report the error.
        try {
          chrome.runtime.sendMessage({
            type: 'ZHL_BULK_DOWNLOAD_TAB_DONE',
            result: { ok: false, reason: 'blob fetch failed: ' + (e && e.message || e) }
          });
        } catch (_) {}
        return;
      }
    } else {
      // Interceptor didn't fire — viewer may use a non-blob download
      // mechanism. The native download already started; just wait for it.
      console.log('[ZHL Doc Downloader] No blob intercept within ' + INTERCEPT_TIMEOUT_MS + ' ms. ' +
        'Native download should be in progress.');
      await new Promise(function (r) { setTimeout(r, 1500); });
    }

    try {
      chrome.runtime.sendMessage({
        type: 'ZHL_BULK_DOWNLOAD_TAB_DONE',
        result: { ok: true, attempts: attempts }
      });
    } catch (e) {
      console.warn('[ZHL Doc Downloader] sendMessage DONE failed:', e);
    }
  }
})();
