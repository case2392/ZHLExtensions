// ZHL Productivity Pack module — feature key: feature_gmailDragAttachments
//
// Two things, one module:
//   1. Make Gmail attachments draggable as REAL FILES to external drop
//      targets (LOP upload areas, file inputs, Slack, other websites).
//      Gmail by default drags an HTML payload with no File object, so
//      external drop zones ignore the drop entirely. We pre-fetch the
//      attachment binary on hover and inject a real File into the
//      dataTransfer at dragstart so the receiver sees a normal file
//      drop.
//
//   2. When a user drops a real-file (an attachment) onto Gmail's
//      compose contenteditable body, route it to the compose's
//      attachment input instead of letting Gmail inline it as an
//      image. So forwarding a Gmail attachment to a new compose works
//      like Outlook used to.
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
  const ATTACHED_ATTR = 'data-zhl-gda';

  // chip element → { state, file, info, promise }
  // state: 'idle' | 'fetching' | 'ready' | 'error'
  const cache = new WeakMap();

  // ---------------------------------------------------------------------
  // Phase 1: turn Gmail attachment drags into real-file drags.
  // ---------------------------------------------------------------------

  // Gmail attachment chips put their download metadata on the link
  // element via the `download_url` attribute, formatted as
  //   "mime/type:filename:url".
  // Parsing that gives us everything we need to fetch + reconstruct
  // the file.
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

  function getChipInfo(el) {
    const dl = el.getAttribute && el.getAttribute('download_url');
    const fromDl = parseDownloadUrl(dl);
    if (fromDl) return fromDl;
    // Fallback: <a> with href + download attribute (newer Gmail UI).
    const a = el.matches('a') ? el : el.querySelector && el.querySelector('a[href]');
    if (a) {
      const href = a.getAttribute('href');
      const dlName = a.getAttribute('download') || '';
      if (href && dlName) {
        return { url: href, filename: dlName, mime: '' };
      }
    }
    return null;
  }

  function isAttachmentCandidate(el) {
    // Anything carrying a download_url is the attachment chip's link.
    if (el.hasAttribute && el.hasAttribute('download_url')) return true;
    // Some Gmail builds put the drag handler on a wrapping div with no
    // download_url — but they always contain a child link with one.
    if (el.querySelector && el.querySelector('[download_url]')) return true;
    return false;
  }

  function prefetch(chip) {
    let entry = cache.get(chip);
    if (entry && (entry.state === 'fetching' || entry.state === 'ready')) return entry;
    const info = getChipInfo(chip) || (function () {
      const inner = chip.querySelector && chip.querySelector('[download_url]');
      return inner ? getChipInfo(inner) : null;
    })();
    if (!info) return null;
    entry = { state: 'fetching', file: null, info: info, promise: null };
    cache.set(chip, entry);
    paintBadge(chip, 'fetching');
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
        paintBadge(chip, 'ready');
      })
      .catch(function (err) {
        entry.state = 'error';
        entry.error = err;
        paintBadge(chip, 'error');
        console.warn('[Gmail Drag Attach] prefetch failed:', err);
      });
    return entry;
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
      // Make sure the chip can host an absolute-positioned child.
      const cs = getComputedStyle(chip);
      if (cs.position === 'static') chip.style.position = 'relative';
      chip.appendChild(badge);
    }
    if (state === 'ready') {
      badge.textContent = '↓';
      badge.style.background = '#10b981';
      badge.title = 'Drag — file ready';
    } else if (state === 'fetching') {
      badge.textContent = '…';
      badge.style.background = '#f59e0b';
      badge.title = 'Preparing for drag';
    } else if (state === 'error') {
      badge.textContent = '!';
      badge.style.background = '#ef4444';
      badge.title = 'Could not prefetch — drag uses Gmail default';
    }
  }

  function attachToChip(chip) {
    if (chip.hasAttribute(ATTACHED_ATTR)) return;
    chip.setAttribute(ATTACHED_ATTR, '1');

    chip.addEventListener('mouseenter', function () {
      prefetch(chip);
    });
    // Capture-phase dragstart so we run before Gmail's own handler.
    // We don't preventDefault — Gmail still sets text/html etc. for
    // its own internal drops. We just append our File so external
    // drop targets see it as a real file.
    chip.addEventListener('dragstart', function (e) {
      let entry = cache.get(chip);
      if (!entry) entry = prefetch(chip);
      if (!entry || entry.state !== 'ready' || !entry.file) {
        // Fall back to Gmail's default. Future drags after the prefetch
        // resolves will work.
        return;
      }
      try {
        e.dataTransfer.items.add(entry.file);
        if (e.dataTransfer.effectAllowed === 'all' || !e.dataTransfer.effectAllowed) {
          e.dataTransfer.effectAllowed = 'copyMove';
        }
      } catch (err) {
        console.warn('[Gmail Drag Attach] items.add failed:', err);
      }
    }, true);
  }

  function scan() {
    // Most Gmail attachment chips have an inner element with
    // download_url. Walk every such element and attach handlers to
    // the closest draggable wrapper (or the element itself).
    const dlNodes = document.querySelectorAll('[download_url]');
    dlNodes.forEach(function (el) {
      // Walk up to the nearest [draggable=true] for the actual drag
      // target. Gmail typically sets draggable on the chip wrapper.
      let chip = el.closest('[draggable="true"]') || el.parentElement || el;
      attachToChip(chip);
      // Also attach to the element itself in case it's the draggable.
      if (chip !== el) attachToChip(el);
    });
  }

  // Heartbeat + MutationObserver: Gmail re-renders chips often.
  const obs = new MutationObserver(function () { scan(); });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  scan();
  setInterval(scan, 2000);

  // ---------------------------------------------------------------------
  // Phase 2: when a real file is dropped on Gmail's compose body,
  // route it to the compose attachment input instead of letting Gmail
  // inline it as an image / HTML.
  // ---------------------------------------------------------------------

  function isComposeBody(el) {
    if (!el || !el.closest) return null;
    const body = el.closest('div[contenteditable="true"][role="textbox"][aria-label*="Body"], div[contenteditable="true"][g_editable]');
    if (!body) return null;
    const dialog = body.closest('div[role="dialog"]');
    return dialog || null;
  }

  function findComposeFileInput(dialog) {
    return dialog.querySelector('input[type="file"][name="Filedata"]') ||
           dialog.querySelector('input[type="file"]');
  }

  function injectFilesIntoCompose(dialog, fileList) {
    const input = findComposeFileInput(dialog);
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

  // Capture-phase drop listener. We only intercept when the drop has
  // a File AND the target is the compose contenteditable body — so
  // typing / paste / image-url drops are unaffected.
  document.addEventListener('drop', function (e) {
    if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    const dialog = isComposeBody(e.target);
    if (!dialog) return;
    if (injectFilesIntoCompose(dialog, e.dataTransfer.files)) {
      e.preventDefault();
      e.stopPropagation();
      console.log('[Gmail Drag Attach] redirected drop to attachment input (' + e.dataTransfer.files.length + ' file(s))');
    }
  }, true);
  document.addEventListener('dragover', function (e) {
    if (!e.dataTransfer) return;
    // dragover must call preventDefault on the same target for drop to fire.
    // We only do this when a File is being dragged onto compose body.
    const types = e.dataTransfer.types;
    let hasFile = false;
    if (types) for (let i = 0; i < types.length; i++) if (types[i] === 'Files') { hasFile = true; break; }
    if (!hasFile) return;
    if (!isComposeBody(e.target)) return;
    e.preventDefault();
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
