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
    console.log('[ZHL Doc Downloader] Armed (age', age + 'ms). Waiting for PDF URL from viewer load.');
    run(armed);
  });

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

  async function run(armed) {
    diag('run starting', { docName: armed.docName, taskName: armed.taskName, url: location.href.slice(0, 200) });
    const pdfUrl = await waitForPdfUrl(PDF_WAIT_MS);

    let rawName = (armed.docName || 'document').trim();
    if (!/\.[a-z0-9]{2,5}$/i.test(rawName)) rawName += '.pdf';
    const filename = sanitizeFilename(rawName);

    if (pdfUrl) {
      diag('PDF URL captured during viewer load', { pdfUrl: pdfUrl, filename: filename });
      const resp = await sendMsg({ type: 'ZHL_BULK_DOWNLOAD_URL', url: pdfUrl, filename: filename });
      diag('background URL response', resp);
      await sendMsg({ type: 'ZHL_BULK_DOWNLOAD_TAB_DONE', result: { ok: !!(resp && resp.ok), via: 'fetch-url' } });
      return;
    }

    // Fallback: no PDF URL came in during viewer load. Try clicking the
    // Download button and let the anchor intercepts do their thing.
    diag('No PDF URL during viewer load, falling back to button click', { waitedMs: PDF_WAIT_MS });
    await fallbackButtonClick(armed, filename);
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
