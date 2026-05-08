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
    const types = e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types) : [];
    const filesLen = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files.length : 0;
    if (!hasFilesType(e.dataTransfer)) {
      // Helpful diagnostic: even non-Files drags reach us. If you see
      // *no* dragenter log on LOP at all, the cursor never made it
      // into the LOP window during the drag.
      if (types.length) console.log('[LOP Drop Receiver] dragenter (non-File): types=', types);
      return;
    }
    console.log('[LOP Drop Receiver] dragenter w/ Files: types=', types, 'files.length=', filesLen, 'target=', e.target && e.target.tagName);
    const now = Date.now();
    if (now - lastRefreshAt < 250) return;
    lastRefreshAt = now;
    refreshActiveDrag().then(function (drag) {
      cachedDrag = drag;
      if (drag) console.log('[LOP Drop Receiver] active Gmail drag detected:', drag.name, drag.size, 'bytes');
      else console.log('[LOP Drop Receiver] SW reports no active Gmail drag (this drop is probably a native OS file)');
    });
  }, true);

  // dragover.preventDefault() is what allows drop to fire. We always
  // call it when a Files-type drag is in progress, regardless of
  // whether cachedDrag is set yet — the SW lookup on dragenter is
  // async, so cachedDrag may not be populated by the time dragover
  // fires. preventDefault() on dragover doesn't break native OS file
  // drops (LOP's own dropzone handlers also call preventDefault on
  // dragover); it just guarantees that drop events fire so our drop
  // handler can decide whether to inject from the SW cache or let the
  // native file through.
  window.addEventListener('dragover', function (e) {
    if (!hasFilesType(e.dataTransfer)) return;
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
    if (!hasFilesType(e.dataTransfer)) return;
    // Important: when dragging across tabs, Chrome populates
    // dataTransfer.files with the drag IMAGE (a webp screenshot of the
    // source element — e.g. "0.webp") rather than our intended File.
    // So we can't use files.length > 0 as the "this is a real OS drop,
    // skip" signal. Instead: if the SW has an active Gmail drag, we
    // ALWAYS intercept and replace whatever Chrome put in
    // dataTransfer.files with our reconstructed PDF. If no active
    // Gmail drag, we let the native drop proceed untouched (real OS
    // file drops still work).
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
