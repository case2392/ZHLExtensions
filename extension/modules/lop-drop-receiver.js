// ZHL Productivity Pack module — feature key: feature_gmailDragAttachments
//
// Cross-tab side of Phase 1. Listens on the LOP page for a drop that
// originated as a Gmail attachment drag, asks the background service
// worker for the cached bytes, reconstructs a File, and injects it into
// the closest input[type=file] under the drop target.
//
// Why this is needed: when a JS-constructed File is dragged from one
// tab to another, Chrome strips the binary at drop time — the
// destination only sees `dataTransfer.types=['Files']` with no actual
// `dataTransfer.files`. The source tab (Gmail) caches the bytes in the
// SW on dragstart, which this script pulls on drop.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_gmailDragAttachments';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[LOP Drop Receiver v' + VERSION + '] loaded at', location.href);

  // Cache the active drag's metadata for the duration of one drag
  // session. Refreshed on dragenter so we know whether to preventDefault
  // dragover (which is what enables drop). Cleared on drop or after a
  // few seconds of no drag activity.
  let cachedDrag = null;
  let lastRefreshAt = 0;

  // Mirror Gmail-side context-dead handling: after an extension
  // reload, sendMessage from this surviving content script throws.
  // Show a one-time banner so the user knows to reload the LOP tab.
  let contextDead = false;
  function isContextInvalidatedError(err) {
    return /Extension context invalidated|message port closed|receiving end does not exist/i.test(String(err && (err.message || err)));
  }
  function showContextDeadBanner() {
    if (document.getElementById('zhl-lop-context-dead')) return;
    const bar = document.createElement('div');
    bar.id = 'zhl-lop-context-dead';
    bar.setAttribute('style',
      'position:fixed;left:0;right:0;top:0;z-index:2147483647;' +
      'background:#b91c1c;color:#fff;padding:10px 16px;' +
      'font:600 13px/1.4 Arial,sans-serif;text-align:center;' +
      'box-shadow:0 2px 6px rgba(0,0,0,.25);');
    bar.textContent = 'ZHL Pack updated — reload this LOP tab to re-enable Gmail attachment drops.';
    const close = document.createElement('button');
    close.textContent = '×';
    close.setAttribute('style', 'background:transparent;border:none;color:#fff;font:700 18px/1 sans-serif;margin-left:16px;cursor:pointer;');
    close.addEventListener('click', function () { bar.remove(); });
    bar.appendChild(close);
    (document.body || document.documentElement).appendChild(bar);
  }
  function markContextDead(reason) {
    if (contextDead) return;
    contextDead = true;
    console.warn('[LOP Drop Receiver] extension context invalidated — drops disabled until tab reload.', reason || '');
    try { showContextDeadBanner(); } catch (_) {}
  }

  function refreshActiveDrag() {
    return new Promise(function (resolve) {
      if (contextDead) { resolve(null); return; }
      try {
        chrome.runtime.sendMessage({ type: 'GET_GMAIL_DRAG_FILE' }, function (resp) {
          const lastErr = chrome.runtime && chrome.runtime.lastError;
          if (lastErr) {
            if (isContextInvalidatedError(lastErr.message)) markContextDead(lastErr.message);
            resolve(null); return;
          }
          if (!resp || !resp.ok || !resp.file) { resolve(null); return; }
          resolve(resp.file);
        });
      } catch (e) {
        if (isContextInvalidatedError(e)) markContextDead(e && e.message);
        resolve(null);
      }
    });
  }

  function b64ToBlob(b64, mime) {
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }

  // Find the file input we should inject into. Strategy: walk up from
  // the drop target looking for a containing dropzone that has an
  // associated <input type=file>. Falls back to any visible file input
  // on the page, then any file input at all.
  function findFileInput(target) {
    let el = target;
    while (el && el !== document.body) {
      if (el.querySelector) {
        const direct = el.querySelector('input[type="file"]');
        if (direct) return direct;
      }
      el = el.parentElement;
    }
    // Page-level fallback. Many LOP upload widgets keep a hidden
    // input[type=file] off-screen and trigger a click on it from a
    // dropzone wrapper — assigning .files + dispatching change still
    // works.
    const all = document.querySelectorAll('input[type="file"]');
    for (const inp of all) {
      const r = inp.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return inp;
    }
    return all[0] || null;
  }

  function injectFile(input, file) {
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } catch (err) {
      console.warn('[LOP Drop Receiver] inject failed:', err);
      return false;
    }
  }

  function hasFilesType(dataTransfer) {
    if (!dataTransfer || !dataTransfer.types) return false;
    const t = dataTransfer.types;
    for (let i = 0; i < t.length; i++) if (t[i] === 'Files') return true;
    return false;
  }

  // Refresh the cached drag metadata on every dragenter, throttled.
  // We can't gate on dataTransfer.types containing 'Files' — Chrome
  // strips JS-constructed File objects from cross-tab dataTransfer
  // entirely, so a Gmail drag arriving on LOP shows up as
  // types=['text/plain'] (or just empty). The only reliable signal
  // that a Gmail drag is active is the SW cache. Throttling to 250ms
  // means a burst of nested-element dragenters costs at most one
  // sendMessage round-trip per drag.
  window.addEventListener('dragenter', function (e) {
    const types = e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types) : [];
    const filesLen = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files.length : 0;
    const now = Date.now();
    if (now - lastRefreshAt < 250) return;
    lastRefreshAt = now;
    refreshActiveDrag().then(function (drag) {
      cachedDrag = drag;
      if (drag) console.log('[LOP Drop Receiver] active Gmail drag detected:', drag.name, drag.size, 'bytes (drag types=', types, ')');
      else if (types.length || filesLen) console.log('[LOP Drop Receiver] dragenter, SW reports no Gmail drag (types=', types, 'files.length=', filesLen, ') — letting native through');
    });
  }, true);

  // dragover.preventDefault() is what allows drop to fire on this
  // target. We preventDefault whenever the SW knows about an active
  // Gmail drag (cachedDrag set) — works regardless of what
  // dataTransfer.types looks like, including the cross-tab case where
  // Chrome strips 'Files' from the type list.
  window.addEventListener('dragover', function (e) {
    if (!cachedDrag) return;
    e.preventDefault();
    if (e.dataTransfer) {
      try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
    }
  }, true);

  window.addEventListener('drop', function (e) {
    const types = e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types) : [];
    const filesLen = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files.length : 0;
    let firstFileName = '';
    if (filesLen > 0) firstFileName = e.dataTransfer.files[0].name + ' (' + e.dataTransfer.files[0].type + ')';
    console.log('[LOP Drop Receiver] drop fired: types=', types, 'files.length=', filesLen, 'firstFile=', firstFileName, 'target=', e.target && e.target.tagName, 'cachedDrag=', cachedDrag ? cachedDrag.name : 'null');
    // No hasFilesType gate here: cross-tab Gmail drags arrive on LOP
    // with types=['text/plain'] (Chrome strips the JS-File entirely).
    // The only reliable signal is the SW cache. If cachedDrag is set
    // OR the SW reports an active drag on a fresh lookup, intercept.
    // Otherwise this is something else and we let it through untouched.
    const handle = function (drag) {
      if (!drag) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const blob = b64ToBlob(drag.b64, drag.mime);
      const file = new File([blob], drag.name, { type: drag.mime });
      const input = findFileInput(e.target);
      if (!input) {
        console.warn('[LOP Drop Receiver] no file input found near drop target');
        return;
      }
      if (injectFile(input, file)) {
        console.log('[LOP Drop Receiver] injected', file.name, '(' + file.size + ' bytes,', file.type + ') into', input);
      }
      cachedDrag = null;
      try { chrome.runtime.sendMessage({ type: 'GMAIL_DRAG_END' }); } catch (_) {}
    };
    if (cachedDrag) {
      handle(cachedDrag);
      return;
    }
    // No cachedDrag — most likely a real OS file drop. Don't
    // intercept; let LOP's own drop handler run on the native files.
    // If the SW *did* have a stale Gmail drag we missed (dragenter
    // race), best-effort late inject after the fact; LOP may already
    // have begun processing the webp, but the PDF will appear in the
    // upload list alongside, which the user can keep.
    const savedTarget = e.target;
    refreshActiveDrag().then(function (drag) {
      if (!drag) return;
      const blob = b64ToBlob(drag.b64, drag.mime);
      const file = new File([blob], drag.name, { type: drag.mime });
      const input = findFileInput(savedTarget);
      if (!input || !injectFile(input, file)) return;
      console.log('[LOP Drop Receiver] late-inject', file.name, '(' + file.size + ' bytes) — LOP may also have processed the OS payload');
      cachedDrag = null;
      try { chrome.runtime.sendMessage({ type: 'GMAIL_DRAG_END' }); } catch (_) {}
    });
  }, true);
})();
  }
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([__ZHL_FEATURE_KEY], function (data) {
      if (data[__ZHL_FEATURE_KEY] === false) return;
      __zhlRunModule();
    });
  } else {
    __zhlRunModule();
  }
})();
