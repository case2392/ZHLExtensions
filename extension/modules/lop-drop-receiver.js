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

  function refreshActiveDrag() {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: 'GET_GMAIL_DRAG_FILE' }, function (resp) {
          if (chrome.runtime.lastError) { resolve(null); return; }
          if (!resp || !resp.ok || !resp.file) { resolve(null); return; }
          resolve(resp.file);
        });
      } catch (_) { resolve(null); }
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

  // Refresh the cached drag metadata on dragenter so dragover knows
  // whether to preventDefault. Throttled to once per ~250ms so a
  // burst of dragenter events from nested elements doesn't spam the SW.
  window.addEventListener('dragenter', function (e) {
    if (!hasFilesType(e.dataTransfer)) return;
    const now = Date.now();
    if (now - lastRefreshAt < 250) return;
    lastRefreshAt = now;
    refreshActiveDrag().then(function (drag) {
      cachedDrag = drag;
      if (drag) console.log('[LOP Drop Receiver] active Gmail drag detected:', drag.name, drag.size, 'bytes');
    });
  }, true);

  // dragover.preventDefault() is what allows drop to fire. We only
  // call it when we have a confirmed Gmail drag — leaves native OS
  // file drops untouched (they'd handle preventDefault themselves on
  // their target dropzones).
  window.addEventListener('dragover', function (e) {
    if (!hasFilesType(e.dataTransfer)) return;
    if (!cachedDrag) return;
    e.preventDefault();
    if (e.dataTransfer) {
      try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
    }
  }, true);

  window.addEventListener('drop', function (e) {
    if (!hasFilesType(e.dataTransfer)) return;
    // If a real OS file is being dropped, dataTransfer.files will be
    // populated — let LOP's own handler take it. We only step in when
    // dataTransfer.files is empty (the Gmail-stripped case).
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) return;
    // Last-chance refresh in case dragenter never fired (rare).
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
        console.log('[LOP Drop Receiver] injected', file.name, '(' + file.size + ' bytes) into', input);
      }
      cachedDrag = null;
      try { chrome.runtime.sendMessage({ type: 'GMAIL_DRAG_END' }); } catch (_) {}
    };
    if (cachedDrag) {
      handle(cachedDrag);
    } else {
      // Synchronous SW message can't be done here — drop handler must
      // call preventDefault before returning to count. Best effort:
      // refresh and handle async; if no drag, nothing happens.
      refreshActiveDrag().then(handle);
    }
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
