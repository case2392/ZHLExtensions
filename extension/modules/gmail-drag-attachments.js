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
    return {
      mime: dlAttr.slice(0, idx1),
      filename: dlAttr.slice(idx1 + 1, idx2),
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

  // ---- Hover prefetch (event delegation, no per-chip listeners) -------
  document.addEventListener('mouseover', function (e) {
    const info = findInfoFor(e.target);
    if (!info) return;
    const entry = prefetch(info);
    // Paint a badge on the visible chip.
    let chip = e.target;
    while (chip && chip !== document.body) {
      if (chip.hasAttribute && chip.hasAttribute('download_url')) break;
      if (chip.querySelector && chip.querySelector('[download_url]')) break;
      chip = chip.parentElement;
    }
    if (chip && chip !== document.body && entry) {
      const draggable = chip.closest('[draggable="true"]') || chip;
      paintBadge(draggable, entry.state);
    }
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
      // Add a real File so external drop targets (LOP, Slack, file
      // inputs) see e.dataTransfer.files / e.dataTransfer.items as a
      // normal file drop.
      e.dataTransfer.items.add(entry.file);
      // Belt-and-suspenders: also set DownloadURL — Chrome uses this
      // for desktop / cross-window file drops as a fallback.
      try {
        e.dataTransfer.setData('DownloadURL',
          (entry.file.type || 'application/octet-stream') +
          ':' + entry.file.name + ':' + info.url);
      } catch (_) {}
      // Make sure copy is allowed.
      try { e.dataTransfer.effectAllowed = 'copy'; } catch (_) {}
      console.log('[Gmail Drag Attach] dragstart: added File ' + entry.file.name +
        ' (' + entry.file.size + ' bytes) to dataTransfer');
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

  // dragover preventDefault is required for drop to fire on the same
  // target. Only do it when there's a File AND the target is compose
  // body — so other drop UX in Gmail isn't disturbed.
  document.addEventListener('dragover', function (e) {
    if (!e.dataTransfer) return;
    const types = e.dataTransfer.types;
    let hasFile = false;
    if (types) for (let i = 0; i < types.length; i++) if (types[i] === 'Files') { hasFile = true; break; }
    if (!hasFile) return;
    if (!isComposeBody(e.target)) return;
    e.preventDefault();
  }, true);

  document.addEventListener('drop', function (e) {
    if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    const dialog = isComposeBody(e.target);
    if (!dialog) return;
    if (injectFilesIntoCompose(dialog, e.dataTransfer.files)) {
      e.preventDefault();
      e.stopPropagation();
      console.log('[Gmail Drag Attach] redirected drop to attachment input (' +
        e.dataTransfer.files.length + ' file(s))');
    }
  }, true);

  // ---- Idle scan: paint badges on chips whose URL we've already
  // fetched. Don't pre-paint anything for chips the user hasn't
  // hovered — leaves them in Gmail's natural look until prefetch.
  function paintBadgesForCached() {
    document.querySelectorAll('[download_url]').forEach(function (el) {
      const info = parseDownloadUrl(el.getAttribute('download_url'));
      if (!info) return;
      const entry = fileCache.get(info.url);
      if (!entry) return;
      const draggable = el.closest('[draggable="true"]') || el;
      paintBadge(draggable, entry.state);
    });
  }
  setInterval(paintBadgesForCached, 3000);
  paintBadgesForCached();

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
