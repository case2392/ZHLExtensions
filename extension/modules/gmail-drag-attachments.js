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
  const fileCache = new Map(); // url -> { state, file, info, promise }

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
    badge.title = title;
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

  // ---- Dragstart hijack at document capture phase --------------------
  // Capture phase on the document fires BEFORE any element-level
  // capture or bubble listeners deeper in the tree, so we modify
  // dataTransfer before Gmail's own dragstart logic finalizes its
  // payload.
  document.addEventListener('dragstart', function (e) {
    const info = findInfoFor(e.target);
    if (!info) return;
    const entry = prefetch(info);
    if (!entry || entry.state !== 'ready' || !entry.file) {
      console.log('[Gmail Drag Attach] dragstart but file not ready (' + (entry ? entry.state : 'no entry') + ')');
      return;
    }
    try {
      // Wipe Gmail's pre-populated payload first. The previous version
      // also called setData('DownloadURL', ...) but that left a string
      // payload that some drop handlers (Gmail's compose body, etc.)
      // read FIRST and treat as text, ignoring our actual File. Now
      // we leave only the File on the dataTransfer.
      try { e.dataTransfer.clearData(); } catch (_) {}
      e.dataTransfer.items.add(entry.file);
      try { e.dataTransfer.effectAllowed = 'copy'; } catch (_) {}
      console.log('[Gmail Drag Attach] dragstart: added File ' + entry.file.name +
        ' (' + entry.file.size + ' bytes) to dataTransfer');
      try {
        const t = e.dataTransfer.types ? Array.from(e.dataTransfer.types) : [];
        const fc = e.dataTransfer.files ? e.dataTransfer.files.length : 0;
        console.log('[Gmail Drag Attach] post-add types=', t, 'files.length=', fc);
      } catch (_) {}
      // Stop propagation so Gmail's own dragstart listener doesn't
      // reset the dataTransfer or re-add its HTML payload.
      e.stopPropagation();
      e.stopImmediatePropagation();
    } catch (err) {
      console.warn('[Gmail Drag Attach] items.add failed:', err);
    }
  }, true);

  // ---- Phase 2: drop on Gmail compose body → attach as file ----------

  function isComposeBody(el) {
    if (!el || !el.closest) return null;
    const body = el.closest('div[contenteditable="true"][role="textbox"][aria-label*="Body"], div[contenteditable="true"][g_editable]');
    if (!body) return null;
    return body.closest('div[role="dialog"]');
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
    const filesLen = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files.length : 0;
    console.log('[Gmail Drag Attach] drop fired — target=', e.target,
      'files.length=', filesLen, 'types=', types);
    if (!filesLen) {
      // No File on the dataTransfer — log what's there so we can
      // figure out what the drop target would have read instead.
      try {
        types.forEach(function (t) {
          try { console.log('[Gmail Drag Attach]   type ' + t + ' →', e.dataTransfer.getData(t)); } catch (_) {}
        });
      } catch (_) {}
      return;
    }
    const dialog = isComposeBody(e.target);
    if (!dialog) {
      console.log('[Gmail Drag Attach] drop is not on compose body — leaving for browser default');
      return;
    }
    // Stop the event NOW so Gmail's own compose-body drop handler
    // (which inserts as inline HTML) never gets to run.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (injectFilesIntoCompose(dialog, e.dataTransfer.files)) {
      console.log('[Gmail Drag Attach] redirected drop to attachment input (' +
        filesLen + ' file(s))');
    } else {
      console.warn('[Gmail Drag Attach] inject failed — could not find file input on compose');
    }
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
      if (seen.has(draggable)) return;
      if (!isVisible(draggable)) return;
      seen.add(draggable);
      const entry = fileCache.get(info.url);
      if (entry) paintBadge(draggable, entry.state);
    });
  }
  setInterval(scanAndPrefetch, 3000);
  scanAndPrefetch();

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
