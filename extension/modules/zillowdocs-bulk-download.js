// ZHL Productivity Pack — Zillow Docs bulk-download helper
//
// Runs on https://www.zillowdocs.com/embed/editor* in an armed background
// tab opened by task-bulk-download.js.
//
// v1.37.4 STRATEGY:
//   The viewer fetches the PDF on load to display it. The MAIN-world
//   interceptor (zillowdocs-download-interceptor.js) listens to fetch / XHR
//   responses and posts the PDF's HTTPS URL via window.postMessage as soon
//   as it sees one with a PDF content-type. We grab that URL and ask
//   background.js to download it directly via chrome.downloads — NEVER
//   clicking the Download button. No click means no native download means
//   no Save As dialog.
//
// FALLBACK: if no PDF URL is announced within 20 s (unusual viewer
// architecture, on-demand fetch, etc.), we fall back to clicking the
// Download button and intercepting via the anchor hooks. That path may
// still show a Save As dialog on some configurations.
//
// ARMED-FLAG GATE: same pattern as credit-report-reader.js — stands down
// if the user opened this manually.
(function () {
  'use strict';

  console.log('[ZHL Doc Downloader] loaded on', location.href);

  const ARM_WINDOW_MS   = 5 * 60 * 1000;
  const ARMED_KEY       = 'zhlBulkDownloadArmed';
  const PDF_WAIT_MS     = 20000; // how long to wait for the fetch-captured URL

  chrome.storage.local.get([ARMED_KEY], function (data) {
    const armed = data && data[ARMED_KEY];
    const age   = armed && armed.armedAt ? Date.now() - armed.armedAt : Infinity;
    if (!armed || age > ARM_WINDOW_MS) {
      console.log('[ZHL Doc Downloader] Not armed. Standing down.');
      return;
    }
    try { chrome.storage.local.remove([ARMED_KEY]); } catch (_) {}
    // Two modes: 'fetch-blob' means fetch the PDF here and return base64
    // (used by the File System Access path on the LOP side). Anything
    // else falls through to the chrome.downloads path.
    const mode = armed.mode === 'fetch-blob' ? 'fetch-blob' : 'chrome-downloads';
    console.log('[ZHL Doc Downloader] Armed (age', age + 'ms, mode=' + mode + ').');
    run(armed, mode);
  });

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const r = reader.result || '';
        const i = r.indexOf(',');
        resolve({
          base64: i >= 0 ? r.slice(i + 1) : r,
          mimeType: blob.type || 'application/pdf'
        });
      };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  function sanitizeFilename(name) {
    return (name || 'document')
      .replace(/[/\\:*?"<>|]/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200) || 'document';
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

  // Wait for the MAIN-world interceptor to announce a PDF URL.
  // The interceptor stashes the URL on <html data-zhl-pdf-url> as soon as
  // a PDF-typed fetch response is seen — so this works whether the
  // interceptor fired BEFORE or AFTER we started listening.
  function waitForPdfUrl(timeoutMs) {
    return new Promise(function (resolve) {
      const existing = document.documentElement.getAttribute('data-zhl-pdf-url');
      if (existing) { resolve(existing); return; }
      let done = false;
      function finish(url) {
        if (done) return;
        done = true;
        clearInterval(poll);
        window.removeEventListener('message', onMsg);
        resolve(url);
      }
      function onMsg(e) {
        if (e.source !== window) return;
        if (e.data && e.data.__zhlPdfReady === true && e.data.url) finish(e.data.url);
      }
      window.addEventListener('message', onMsg);
      const poll = setInterval(function () {
        const v = document.documentElement.getAttribute('data-zhl-pdf-url');
        if (v) finish(v);
      }, 200);
      setTimeout(function () { finish(null); }, timeoutMs);
    });
  }

  // Forward diagnostic info to background so the user can see all of it
  // in one place (the service worker console). The zillowdocs tab opens
  // and closes too fast to inspect its own console.
  function diag(label, payload) {
    console.log('[ZHL Doc Downloader][diag]', label, payload);
    try { chrome.runtime.sendMessage({ type: 'ZHL_BULK_DOWNLOAD_DIAG', label: label, payload: payload, doc: location.href.slice(0, 200) }); } catch (_) {}
  }

  // Helper: fetch a URL in this tab's context (so cookies + signed-URL
  // params work) and return base64 + mime. Throws on network error.
  async function fetchAsBase64(url) {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error('fetch returned ' + response.status);
    const blob = await response.blob();
    const enc  = await blobToBase64(blob);
    return { base64: enc.base64, mimeType: enc.mimeType, bytes: blob.size };
  }

  async function run(armed, mode) {
    diag('run starting', { docName: armed.docName, taskName: armed.taskName, mode: mode, url: location.href.slice(0, 200) });
    const pdfUrl = await waitForPdfUrl(PDF_WAIT_MS);

    let rawName = (armed.docName || 'document').trim();
    if (!/\.[a-z0-9]{2,5}$/i.test(rawName)) rawName += '.pdf';
    const filename = sanitizeFilename(rawName);

    if (mode === 'fetch-blob') {
      // File System Access path: caller wants the PDF bytes, not a
      // chrome.downloads call. If we have the URL we fetch it here in
      // this tab's context (cookies + signed-URL params just work) and
      // return base64. Falls back to clicking the Download button only
      // if no URL came through.
      let urlToFetch = pdfUrl;
      if (!urlToFetch) {
        diag('No PDF URL during viewer load (fetch-blob mode), trying button click', { waitedMs: PDF_WAIT_MS });
        urlToFetch = await clickAndCaptureUrl();
      }
      if (!urlToFetch) {
        diag('Failed to capture PDF URL in fetch-blob mode', {});
        await sendMsg({ type: 'ZHL_BULK_DOWNLOAD_TAB_DONE', result: { ok: false, reason: 'could not capture PDF URL' } });
        return;
      }
      try {
        diag('fetching PDF bytes in tab', { url: urlToFetch.slice(0, 200) });
        const enc = await fetchAsBase64(urlToFetch);
        diag('fetched bytes', { size: enc.bytes, mime: enc.mimeType });
        await sendMsg({
          type: 'ZHL_BULK_DOWNLOAD_TAB_DONE',
          result: { ok: true, via: 'fetch-blob', base64: enc.base64, mimeType: enc.mimeType, suggestedFilename: filename, bytes: enc.bytes }
        });
      } catch (e) {
        diag('fetch failed in fetch-blob mode', { error: e && e.message || String(e) });
        await sendMsg({
          type: 'ZHL_BULK_DOWNLOAD_TAB_DONE',
          result: { ok: false, reason: 'fetch failed: ' + (e && e.message || e) }
        });
      }
      return;
    }

    // ---- chrome-downloads mode (legacy / fallback) ----
    if (pdfUrl) {
      diag('PDF URL captured during viewer load', { pdfUrl: pdfUrl, filename: filename });
      const resp = await sendMsg({ type: 'ZHL_BULK_DOWNLOAD_URL', url: pdfUrl, filename: filename });
      diag('background URL response', resp);
      await sendMsg({ type: 'ZHL_BULK_DOWNLOAD_TAB_DONE', result: { ok: !!(resp && resp.ok), via: 'fetch-url' } });
      return;
    }
    diag('No PDF URL during viewer load, falling back to button click', { waitedMs: PDF_WAIT_MS });
    await fallbackButtonClick(armed, filename);
  }

  // Clicks the Download button and waits up to 6s for the fetch
  // interceptor to surface a PDF URL. Returns the URL or null.
  async function clickAndCaptureUrl() {
    let btn = null;
    for (let i = 0; i < 20; i++) {
      btn = findDownloadButton();
      if (btn) break;
      await new Promise(function (r) { setTimeout(r, 500); });
    }
    if (!btn) return null;
    document.documentElement.setAttribute('data-zhl-bulk-armed', '1');
    const captured = waitForPdfUrl(6000);
    clickWithMouseEvents(btn);
    return await captured;
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

  function clickWithMouseEvents(el) {
    try {
      ['mousedown', 'mouseup', 'click'].forEach(function (type) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0 }));
      });
    } catch (_) {
      try { el.click(); } catch (_) {}
    }
  }

  async function fallbackButtonClick(armed, filename) {
    let btn = null;
    for (let i = 0; i < 20; i++) {
      btn = findDownloadButton();
      if (btn) break;
      await new Promise(function (r) { setTimeout(r, 500); });
    }
    if (!btn) {
      await sendMsg({ type: 'ZHL_BULK_DOWNLOAD_TAB_DONE', result: { ok: false, reason: 'no Download button and no PDF URL' } });
      return;
    }
    // Arm anchor intercepts, click, then wait briefly to see if intercept
    // or a delayed PDF URL fires.
    document.documentElement.setAttribute('data-zhl-bulk-armed', '1');
    const captured = waitForPdfUrl(6000);
    diag('clicking Download button', { btnTag: btn.tagName, btnTextContent: (btn.textContent || '').slice(0, 60) });
    clickWithMouseEvents(btn);
    const url = await captured;
    if (url) {
      diag('PDF URL captured after click', { url: url, filename: filename });
      const resp = await sendMsg({ type: 'ZHL_BULK_DOWNLOAD_URL', url: url, filename: filename });
      diag('background URL response', resp);
      await sendMsg({ type: 'ZHL_BULK_DOWNLOAD_TAB_DONE', result: { ok: !!(resp && resp.ok), via: 'fetch-url-after-click' } });
      return;
    }
    // Couldn't get a URL. The native download likely already started.
    diag('No PDF URL captured after click — native download in progress', {});
    await new Promise(function (r) { setTimeout(r, 1500); });
    await sendMsg({ type: 'ZHL_BULK_DOWNLOAD_TAB_DONE', result: { ok: true, via: 'native-fallback' } });
  }
})();
