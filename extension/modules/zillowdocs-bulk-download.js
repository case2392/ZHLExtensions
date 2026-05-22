// ZHL Productivity Pack — Zillow Docs bulk-download helper
//
// Runs on https://www.zillowdocs.com/embed/editor* in an armed background
// tab opened by task-bulk-download.js. Armed-flag gate: same pattern as
// credit-report-reader.js — stands down if the user opened this manually.
//
// SILENT DOWNLOAD:
// zillowdocs-download-interceptor.js (MAIN world) captures the viewer's
// download trigger and posts { blobUrl, pdfUrl, name } via postMessage.
//
// If pdfUrl is set (the original HTTPS URL from the fetch interceptor),
// background.js downloads it via chrome.downloads({ url:pdfUrl, saveAs:false })
// → file saves directly to Downloads folder with the correct name.
//
// If pdfUrl is empty (viewer didn't make a detectable fetch, or response
// wasn't PDF-typed), fall back: fetch blobUrl here, base64-encode, send
// ZHL_BULK_DOWNLOAD_DATA → background uses a data URL (may still land
// as UUID.tmp on some Windows Chrome versions, but it's the best we can do).
//
// If neither fires within 8 s, the native download already started — the
// browser may show a Save As dialog depending on user settings.
(function () {
  'use strict';

  console.log('[ZHL Doc Downloader] loaded on', location.href);

  const ARM_WINDOW_MS     = 5 * 60 * 1000;
  const ARMED_KEY         = 'zhlBulkDownloadArmed';
  const INTERCEPT_WAIT_MS = 8000;

  chrome.storage.local.get([ARMED_KEY], function (data) {
    const armed = data && data[ARMED_KEY];
    const age   = armed && armed.armedAt ? Date.now() - armed.armedAt : Infinity;
    if (!armed || age > ARM_WINDOW_MS) {
      console.log('[ZHL Doc Downloader] Not armed. Standing down.');
      return;
    }
    try { chrome.storage.local.remove([ARMED_KEY]); } catch (_) {}
    console.log('[ZHL Doc Downloader] Armed (age', age + 'ms). Starting.');
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
      if (/^download$/i.test((b.textContent || '').replace(/\s+/g, ' ').trim())) return b;
    }
    return null;
  }

  function sanitizeFilename(name) {
    return (name || 'document')
      .replace(/[/\\:*?"<>|]/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200) || 'document';
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload  = function () {
        const r = reader.result || '';
        const i = r.indexOf(',');
        resolve({ base64: i >= 0 ? r.slice(i + 1) : r, mimeType: blob.type || 'application/pdf' });
      };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  function sendMsg(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (resp) {
          if (chrome.runtime.lastError) {
            console.warn('[ZHL Doc Downloader] sendMessage error:', chrome.runtime.lastError.message);
          }
          resolve(resp || {});
        });
      } catch (e) {
        console.warn('[ZHL Doc Downloader] sendMessage threw:', e);
        resolve({});
      }
    });
  }

  async function startDownload(armed) {
    // Poll for the Download button (up to 30 s).
    let downloadBtn = null;
    for (let i = 0; i < 60; i++) {
      downloadBtn = findDownloadButton();
      if (downloadBtn) break;
      await new Promise(function (r) { setTimeout(r, 500); });
    }
    if (!downloadBtn) {
      console.warn('[ZHL Doc Downloader] Download button never appeared.');
      await sendMsg({ type: 'ZHL_BULK_DOWNLOAD_TAB_DONE', result: { ok: false, reason: 'Download button never rendered' } });
      return;
    }
    console.log('[ZHL Doc Downloader] Found Download button. Arming interceptor and clicking.');

    // Arm the MAIN-world interceptor.
    document.documentElement.setAttribute('data-zhl-bulk-armed', '1');

    // Listen for the interceptor's postMessage.
    let settle;
    const interceptPromise = new Promise(function (res) { settle = res; });
    function onMsg(e) {
      if (e.source !== window) return;
      if (e.data && e.data.__zhlDl === true) {
        window.removeEventListener('message', onMsg);
        settle(e.data);
      }
    }
    window.addEventListener('message', onMsg);

    clickWithMouseEvents(downloadBtn);

    const intercepted = await Promise.race([
      interceptPromise,
      new Promise(function (r) { setTimeout(function () { r(null); }, INTERCEPT_WAIT_MS); })
    ]);
    window.removeEventListener('message', onMsg); // clean up if timeout won

    if (intercepted) {
      console.log('[ZHL Doc Downloader] Intercepted. pdfUrl:', (intercepted.pdfUrl || '(none)').slice(0, 80),
        '| blobUrl:', (intercepted.blobUrl || '(none)').slice(0, 60));

      let rawName = (intercepted.name || '').trim() || (armed.docName || 'document');
      if (!/\.[a-z0-9]{2,5}$/i.test(rawName)) rawName += '.pdf';
      const filename = sanitizeFilename(rawName);

      if (intercepted.pdfUrl && /^https?:\/\//i.test(intercepted.pdfUrl)) {
        // ---- PREFERRED PATH: direct HTTPS download (correct filename, no TMP issue) ----
        console.log('[ZHL Doc Downloader] Using HTTPS URL path.');
        await sendMsg({
          type    : 'ZHL_BULK_DOWNLOAD_URL',
          url     : intercepted.pdfUrl,
          filename: filename
        });
      } else if (intercepted.blobUrl) {
        // ---- FALLBACK PATH: fetch blob → base64 → data URL ----
        console.log('[ZHL Doc Downloader] No HTTPS URL, falling back to blob fetch.');
        try {
          const response = await fetch(intercepted.blobUrl);
          if (!response.ok) throw new Error('blob fetch ' + response.status);
          const blob = await response.blob();
          const { base64, mimeType } = await blobToBase64(blob);
          console.log('[ZHL Doc Downloader] Sending', blob.size, 'B to background as data URL.');
          await sendMsg({ type: 'ZHL_BULK_DOWNLOAD_DATA', base64, mimeType, filename });
        } catch (e) {
          console.warn('[ZHL Doc Downloader] Blob fallback failed:', e && e.message || e);
          await sendMsg({ type: 'ZHL_BULK_DOWNLOAD_TAB_DONE', result: { ok: false, reason: 'blob fetch failed: ' + (e && e.message || e) } });
          return;
        }
      } else {
        console.warn('[ZHL Doc Downloader] Intercepted but no usable URL. Native download may have started.');
        await new Promise(function (r) { setTimeout(r, 1500); });
      }
    } else {
      // No intercept — native download already started (Save As may appear).
      console.log('[ZHL Doc Downloader] No intercept within', INTERCEPT_WAIT_MS, 'ms. Native download in progress.');
      await new Promise(function (r) { setTimeout(r, 1500); });
    }

    await sendMsg({ type: 'ZHL_BULK_DOWNLOAD_TAB_DONE', result: { ok: true } });
  }
})();
