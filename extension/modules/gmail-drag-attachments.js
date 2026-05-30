// ZHL Productivity Pack module — feature key: feature_gmailDragAttachments
//
// Two things, one module:
//   1. Make Gmail attachments draggable as REAL FILES to external drop
//      targets (LOP upload areas, file inputs, Slack, other websites).
//   2. When a file is dropped on Gmail's compose body, route it to the
//      attachment input instead of letting Gmail inline it as HTML.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_gmailDragAttachments';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[Gmail Drag Attach v' + VERSION + '] loaded');

  const BADGE_CLASS = 'zhl-gda-badge';

  // URL-keyed cache survives Gmail's chip re-renders. The same
  // attachment URL gives us the same File object regardless of which
  // DOM element is hosting the chip at the moment.
  const fileCache = new Map(); // url -> { state, file, info, promise, b64 }

  // Cross-tab cap. base64 inflates by ~33% and chrome.runtime.sendMessage
  // is JSON-serialized in MV3, so very large attachments would blow past
  // Chrome's IPC message size limit. Phase 2 (drop on Gmail compose body)
  // is in-process and works regardless of size.
  const CROSS_TAB_MAX_BYTES = 25 * 1024 * 1024;

  // After the extension is reloaded/updated, this content script keeps
  // running but its chrome.runtime port is dead — sendMessage throws
  // "Extension context invalidated". Without a banner the cross-tab
  // drag silently breaks (Gmail looks fine, LOP just never sees a
  // Gmail drag). Detect once and post a fixed banner telling the user
  // to reload the tab.
  let contextDead = false;
  function isContextInvalidatedError(err) {
    return /Extension context invalidated|message port closed|receiving end does not exist/i.test(String(err && (err.message || err)));
  }
  function showContextDeadBanner() {
    if (document.getElementById('zhl-gda-context-dead')) return;
    const bar = document.createElement('div');
    bar.id = 'zhl-gda-context-dead';
    bar.setAttribute('style',
      'position:fixed;left:0;right:0;top:0;z-index:2147483647;' +
      'background:#b91c1c;color:#fff;padding:10px 16px;' +
      'font:600 13px/1.4 Arial,sans-serif;text-align:center;' +
      'box-shadow:0 2px 6px rgba(0,0,0,.25);');
    bar.textContent = 'ZHL Pack updated — reload this Gmail tab to re-enable cross-tab attachment drag (in-Gmail compose drag still works).';
    const close = document.createElement('button');
    close.textContent = '×';
    close.setAttribute('style',
      'background:transparent;border:none;color:#fff;font:700 18px/1 sans-serif;' +
      'margin-left:16px;cursor:pointer;');
    close.addEventListener('click', function () { bar.remove(); });
    bar.appendChild(close);
    (document.body || document.documentElement).appendChild(bar);
  }
  function markContextDead(reason) {
    if (contextDead) return;
    contextDead = true;
    console.warn('[Gmail Drag Attach] extension context invalidated — cross-tab drag disabled until tab reload.', reason || '');
    try { showContextDeadBanner(); } catch (_) {}
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () {
        const s = String(r.result || '');
        const i = s.indexOf(',');
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      r.onerror = function () { reject(r.error || new Error('read error')); };
      r.readAsDataURL(blob);
    });
  }

  // Module-scope drag state. Chrome strips JavaScript-constructed Files
  // from dataTransfer.files at drop time (a security restriction —
  // verified at runtime: dragend shows types=['Files'] but files.length=0).
  // So instead of relying on dataTransfer to carry the File across the
  // drag, we track which file is active in a module variable. Drop
  // handlers look here for the File. Works inside Gmail since both
  // dragstart and drop happen in the same content script context.
  let activeDragFile = null;
  let activeDragInfo = null;

  function parseDownloadUrl(dlAttr) {
    if (!dlAttr) return null;
    const idx1 = dlAttr.indexOf(':');
    const idx2 = dlAttr.indexOf(':', idx1 + 1);
    if (idx1 < 1 || idx2 < idx1 + 1) return null;
    let filename = dlAttr.slice(idx1 + 1, idx2);
    // Gmail URL-encodes spaces and special chars in the filename
    // portion ("W2 25.pdf" → "W2%2025.pdf"). Decode so the dropped
    // file has a sensible name.
    try { filename = decodeURIComponent(filename); } catch (_) {}
    return {
      mime: dlAttr.slice(0, idx1),
      filename: filename,
      url: dlAttr.slice(idx2 + 1)
    };
  }

  function findInfoFor(target) {
    // Walk up from the event target / hover target looking for a
    // [download_url] attribute, OR a descendant that has one.
    let el = target;
    while (el && el !== document.body) {
      if (el.hasAttribute && el.hasAttribute('download_url')) {
        return parseDownloadUrl(el.getAttribute('download_url'));
      }
      const inner = el.querySelector && el.querySelector('[download_url]');
      if (inner) return parseDownloadUrl(inner.getAttribute('download_url'));
      el = el.parentElement;
    }
    return null;
  }

  function prefetch(info) {
    if (!info || !info.url) return null;
    let entry = fileCache.get(info.url);
    if (entry && (entry.state === 'fetching' || entry.state === 'ready')) return entry;
    entry = { state: 'fetching', file: null, info: info };
    fileCache.set(info.url, entry);
    entry.promise = fetch(info.url, { credentials: 'include' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      })
      .then(function (blob) {
        const mime = info.mime || blob.type || 'application/octet-stream';
        const filename = info.filename || 'attachment';
        entry.file = new File([blob], filename, { type: mime });
        entry.state = 'ready';
        repaintAllBadgesForUrl(info.url);
        console.log('[Gmail Drag Attach] cached', filename, '(' + blob.size + ' bytes)');
        // Eagerly base64-encode for cross-tab drops. Skipped for files
        // bigger than the cap — those still work in-Gmail (Phase 2) but
        // cross-tab drag will fall back to native (which Chrome strips,
        // i.e. no-op) and print a warning at dragstart.
        if (blob.size <= CROSS_TAB_MAX_BYTES) {
          blobToBase64(blob).then(function (b64) {
            entry.b64 = b64;
          }).catch(function (err) {
            console.warn('[Gmail Drag Attach] base64 encode failed:', err);
          });
        } else {
          entry.tooBigForCrossTab = true;
        }
      })
      .catch(function (err) {
        entry.state = 'error';
        entry.error = err;
        repaintAllBadgesForUrl(info.url);
        console.warn('[Gmail Drag Attach] prefetch failed for', info.url, err);
      });
    repaintAllBadgesForUrl(info.url);
    return entry;
  }

  function badgeStateColor(state) {
    if (state === 'ready') return ['#10b981', '↓', 'Drag — file ready'];
    if (state === 'fetching') return ['#f59e0b', '…', 'Preparing for drag'];
    return ['#ef4444', '!', 'Could not prefetch — drag uses Gmail default'];
  }

  function paintBadge(chip, state) {
    let badge = chip.querySelector(':scope > .' + BADGE_CLASS);
    if (!badge) {
      badge = document.createElement('span');
      badge.className = BADGE_CLASS;
      badge.setAttribute('style',
        'position:absolute;top:3px;right:3px;width:14px;height:14px;' +
        'border-radius:50%;color:#fff;font:bold 10px/14px sans-serif;' +
        'text-align:center;pointer-events:none;z-index:1;' +
        'box-shadow:0 1px 2px rgba(0,0,0,.3)'
      );
      const cs = getComputedStyle(chip);
      if (cs.position === 'static') chip.style.position = 'relative';
      chip.appendChild(badge);
    }
    const [bg, text, title] = badgeStateColor(state);
    badge.textContent = text;
    badge.style.background = bg;
    badge.title = title + '\n\nBuilt by Justin Case. Karma appreciated 💛';
  }

  function repaintAllBadgesForUrl(url) {
    document.querySelectorAll('[download_url]').forEach(function (el) {
      const info = parseDownloadUrl(el.getAttribute('download_url'));
      if (!info || info.url !== url) return;
      const chip = el.closest('[draggable="true"]') || el;
      const entry = fileCache.get(url);
      if (entry) paintBadge(chip, entry.state);
    });
  }

  // ---- Hover prefetch is now redundant because scanAndPrefetch()
  // below eagerly fetches every chip we find, but the mouseover
  // listener still serves as a quick repaint trigger if a chip slipped
  // through the heartbeat.
  document.addEventListener('mouseover', function (e) {
    const info = findInfoFor(e.target);
    if (!info) return;
    prefetch(info);
  }, true);

  function showFetchingToast(filename) {
    let toast = document.getElementById('zhl-gda-fetching-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'zhl-gda-fetching-toast';
      toast.setAttribute('style',
        'position:fixed;top:20px;right:20px;z-index:2147483647;' +
        'background:#f59e0b;color:#fff;padding:12px 18px;' +
        'border-radius:8px;font:600 13px/1.4 Arial,sans-serif;' +
        'box-shadow:0 4px 12px rgba(0,0,0,.3);max-width:360px;');
      (document.body || document.documentElement).appendChild(toast);
    }
    toast.textContent = 'Still preparing "' + filename + '". Wait for the green ↓ badge then drag again.';
    if (toast._t) clearTimeout(toast._t);
    toast._t = setTimeout(function () { try { toast.remove(); } catch (_) {} }, 4500);
  }

  // Wait for entry.b64 to be populated (the prefetch + base64 encode
  // path is async and runs separately from the fetch promise). Polls
  // every 100ms up to maxMs (default 30s).
  function waitForB64(entry, maxMs) {
    return new Promise(function (resolve) {
      if (entry.b64 || entry.tooBigForCrossTab) { resolve(); return; }
      const start = Date.now();
      const timer = setInterval(function () {
        if (entry.b64 || entry.tooBigForCrossTab || Date.now() - start > (maxMs || 30000)) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  }

  // Send GMAIL_DRAG_START to the SW once entry is fully ready. Safe to
  // call when the current drag is already over — the SW caches the
  // file with a 60s TTL, so the user's NEXT drag attempt picks it up
  // without waiting again.
  function deferredPushToSW(entry) {
    if (!entry || !entry.promise) return;
    entry.promise.then(function () {
      if (!entry.file) return;
      return waitForB64(entry).then(function () {
        if (!entry.b64 || contextDead) return;
        try {
          chrome.runtime.sendMessage({
            type: 'GMAIL_DRAG_START',
            name: entry.file.name,
            mime: entry.file.type,
            size: entry.file.size,
            b64: entry.b64
          }, function () {
            const lastErr = chrome.runtime && chrome.runtime.lastError;
            if (lastErr) {
              if (isContextInvalidatedError(lastErr.message)) markContextDead(lastErr.message);
            } else {
              console.log('[Gmail Drag Attach] deferred SW push complete for', entry.file.name);
            }
          });
        } catch (e) {
          if (isContextInvalidatedError(e)) markContextDead(e && e.message);
        }
      });
    });
  }

  // ---- Dragstart hijack at document capture phase --------------------
  // Capture phase on the document fires BEFORE any element-level
  // capture or bubble listeners deeper in the tree, so we modify
  // dataTransfer before Gmail's own dragstart logic finalizes its
  // payload — and so we run before any later handler can call
  // preventDefault and cancel the drag.
  document.addEventListener('dragstart', function (e) {
    const info = findInfoFor(e.target);
    if (!info) return;
    const entry = prefetch(info);
    if (!entry || entry.state !== 'ready' || !entry.file) {
      console.log('[Gmail Drag Attach] dragstart but file not ready (' + (entry ? entry.state : 'no entry') + ') — scheduling deferred SW push so next drag works');
      showFetchingToast(info.filename);
      // Even though THIS drag is wasted (we can't intercept dataTransfer
      // synchronously without the file), kick off a deferred push so
      // the SW has the file by the time the user retries.
      deferredPushToSW(entry);
      return;
    }
    try {
      // Track in module scope — this is the source of truth our drop
      // handler reads. dataTransfer.files won't carry our JS File.
      activeDragFile = entry.file;
      activeDragInfo = info;
      // items.add is still needed: it sets dataTransfer.types to
      // include 'Files', which is what the LOP receiver tests for
      // when deciding whether to preventDefault dragover. Chrome may
      // strip our file at drop time and substitute Gmail's chip
      // preview thumbnail (a webp) — the LOP receiver knows to ignore
      // dataTransfer.files in favor of the SW-cached real file.
      try { e.dataTransfer.clearData(); } catch (_) {}
      e.dataTransfer.items.add(entry.file);
      try { e.dataTransfer.effectAllowed = 'copy'; } catch (_) {}
      console.log('[Gmail Drag Attach] dragstart: tracking ' + entry.file.name +
        ' (' + entry.file.size + ' bytes)');
      // Cross-tab handoff: stash the bytes in the service worker so a
      // listener on LOP (or any other host with a receiver content
      // script) can reconstruct the File and inject on drop. b64 is
      // only populated for files within the cross-tab size cap.
      if (entry.b64 && !contextDead) {
        try {
          chrome.runtime.sendMessage({
            type: 'GMAIL_DRAG_START',
            name: entry.file.name,
            mime: entry.file.type,
            size: entry.file.size,
            b64: entry.b64
          }, function (resp) {
            const lastErr = chrome.runtime && chrome.runtime.lastError;
            if (lastErr) {
              if (isContextInvalidatedError(lastErr.message)) markContextDead(lastErr.message);
              else console.warn('[Gmail Drag Attach] SW dragstart msg err:', lastErr.message);
            } else {
              console.log('[Gmail Drag Attach] SW cached file for cross-tab; b64.len=' + entry.b64.length, resp);
            }
          });
        } catch (e) {
          if (isContextInvalidatedError(e)) markContextDead(e && e.message);
          else console.warn('[Gmail Drag Attach] SW dragstart send threw:', e);
        }
      } else if (entry.tooBigForCrossTab) {
        console.warn('[Gmail Drag Attach] file > ' +
          (CROSS_TAB_MAX_BYTES / 1024 / 1024) +
          'MB — cross-tab drag disabled, in-Gmail drop still works');
      }
      // If b64 isn't ready yet (still encoding), kick it off so the
      // user gets cross-tab support on a slight delay.
      if (!entry.b64 && !entry.tooBigForCrossTab) {
        const blob = entry.file;
        blobToBase64(blob).then(function (b64) {
          entry.b64 = b64;
          if (contextDead) return;
          try {
            chrome.runtime.sendMessage({
              type: 'GMAIL_DRAG_START',
              name: entry.file.name,
              mime: entry.file.type,
              size: entry.file.size,
              b64: b64
            }, function () {
              const lastErr = chrome.runtime && chrome.runtime.lastError;
              if (lastErr && isContextInvalidatedError(lastErr.message)) markContextDead(lastErr.message);
            });
          } catch (e) {
            if (isContextInvalidatedError(e)) markContextDead(e && e.message);
          }
        }).catch(function () {});
      }
      e.stopPropagation();
      e.stopImmediatePropagation();
    } catch (err) {
      console.warn('[Gmail Drag Attach] dragstart prep failed:', err);
    }
  }, true);

  // ---- Phase 2: drop on Gmail compose body → attach as file ----------

  function isComposeBody(el) {
    if (!el || !el.closest) return null;
    const body = el.closest('div[contenteditable="true"][role="textbox"][aria-label*="Body"], div[contenteditable="true"][g_editable]');
    if (!body) return null;
    // Popup compose: closest dialog wraps the whole form.
    const dialog = body.closest('div[role="dialog"]');
    if (dialog) return dialog;
    // Inline reply: no dialog wrapper exists. Walk up to the nearest
    // ancestor that contains an <input type="file"> — that's the inline
    // compose form (Gmail's hidden file input lives next to the
    // paperclip button regardless of compose mode).
    let p = body.parentElement;
    while (p && p !== document.body) {
      if (p.querySelector('input[type="file"]')) return p;
      p = p.parentElement;
    }
    return null;
  }

  function injectFilesIntoCompose(dialog, fileList) {
    const input = dialog.querySelector('input[type="file"][name="Filedata"]') ||
                  dialog.querySelector('input[type="file"]');
    if (!input) return false;
    try {
      const dt = new DataTransfer();
      for (let i = 0; i < fileList.length; i++) dt.items.add(fileList[i]);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (e) {
      console.warn('[Gmail Drag Attach] inject failed:', e);
      return false;
    }
  }

  // dragover preventDefault is required for drop to fire. Listen on
  // window with capture phase — earlier than Gmail's listeners,
  // which sit on document or body. Without preventDefault the
  // browser cancels the drop entirely and we never see it.
  window.addEventListener('dragover', function (e) {
    if (!e.dataTransfer) return;
    const types = e.dataTransfer.types;
    let hasFile = false;
    if (types) for (let i = 0; i < types.length; i++) if (types[i] === 'Files') { hasFile = true; break; }
    if (!hasFile) return;
    if (!isComposeBody(e.target)) return;
    e.preventDefault();
  }, true);

  window.addEventListener('drop', function (e) {
    const types = e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types) : [];
    const dialog = isComposeBody(e.target);
    console.log('[Gmail Drag Attach] drop fired — composeBody=' + !!dialog,
      'activeDragFile=' + (activeDragFile ? activeDragFile.name : 'null'),
      'types=', types);
    if (!dialog) return;
    // Use the module-scope active file, NOT e.dataTransfer.files —
    // Chrome strips JS-constructed Files from dataTransfer.files at
    // drop time. Our active file IS the right binary; just route it
    // straight to the compose attachment input.
    if (!activeDragFile) {
      // Fallback: if dataTransfer.files DID survive (e.g., user
      // dragged a real OS file from outside Gmail), use that.
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        if (injectFilesIntoCompose(dialog, e.dataTransfer.files)) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          console.log('[Gmail Drag Attach] used native dataTransfer.files (' +
            e.dataTransfer.files.length + ')');
        }
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (injectFilesIntoCompose(dialog, [activeDragFile])) {
      console.log('[Gmail Drag Attach] attached ' + activeDragFile.name + ' to compose');
    } else {
      console.warn('[Gmail Drag Attach] inject failed — could not find file input on compose');
    }
  }, true);

  // dragend fires after drop. Clear the active drag tracker so a
  // stale file isn't accidentally injected on a subsequent unrelated
  // drag. Small delay ensures any in-flight drop handlers had a
  // chance to read activeDragFile first.
  window.addEventListener('dragend', function (e) {
    setTimeout(function () { activeDragFile = null; activeDragInfo = null; }, 100);
    if (!contextDead) {
      try {
        chrome.runtime.sendMessage({ type: 'GMAIL_DRAG_END' }, function () {
          const lastErr = chrome.runtime && chrome.runtime.lastError;
          if (lastErr && isContextInvalidatedError(lastErr.message)) markContextDead(lastErr.message);
        });
      } catch (e) {
        if (isContextInvalidatedError(e)) markContextDead(e && e.message);
      }
    }
    try {
      const types = e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types) : [];
      const filesLen = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files.length : 0;
      console.log('[Gmail Drag Attach] dragend — types=', types, 'files.length=', filesLen,
        'dropEffect=', e.dataTransfer && e.dataTransfer.dropEffect);
    } catch (_) {}
  }, true);

  // ---- Eager-prefetch + paint, deduped per chip wrapper -------------
  // Gmail re-uses the same download_url across multiple inner
  // elements (visible chip + invisible siblings for accessibility/
  // print/etc.). Without dedup, we'd paint a badge on each one and
  // get dots scattered around the email. Resolve every download_url
  // to its closest [draggable=true] ancestor and paint exactly one
  // badge per (URL, draggable-element) pair, only on visible chips.
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function scanAndPrefetch() {
    const seen = new Set(); // dedup by draggable-element identity
    document.querySelectorAll('[download_url]').forEach(function (el) {
      const info = parseDownloadUrl(el.getAttribute('download_url'));
      if (!info) return;
      // Eager prefetch — every chip we find, regardless of hover.
      prefetch(info);
      const draggable = el.closest('[draggable="true"]') || el;
      // Defensive: if Gmail has stopped marking chips draggable (or
      // some intermediary stripped it), force it back on so native
      // HTML5 drag will fire on user mousedown+move. Harmless if
      // already draggable.
      try {
        if (draggable.getAttribute('draggable') !== 'true') {
          draggable.setAttribute('draggable', 'true');
        }
      } catch (_) {}
      if (seen.has(draggable)) return;
      if (!isVisible(draggable)) return;
      seen.add(draggable);
      const entry = fileCache.get(info.url);
      if (entry) paintBadge(draggable, entry.state);
    });
  }
  function startScanLoop() {
    setInterval(scanAndPrefetch, 3000);
    scanAndPrefetch();
  }
  // We run at document_start so the window event listeners register
  // before Gmail's app code does. DOM scanning has to wait for the
  // page to be ready though.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startScanLoop, { once: true });
  } else {
    startScanLoop();
  }

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
