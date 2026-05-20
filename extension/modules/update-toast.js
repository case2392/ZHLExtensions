// ZHL Productivity Pack module — feature key: feature_updateToast
//
// Bottom-right toast that appears once per release on LOP / Gmail /
// Salesforce tabs so users see what's new without having to visit the
// setup page. Reads the headline for the current version from
// changelog.js (loaded as a separate script — we just look at the
// pre-baked CHANGELOG_HEADLINES below since content scripts can't
// import each other).
//
// Dismissal tracked per-version in chrome.storage.local under
// `_zhl_last_seen_version`. After the user clicks View or Dismiss the
// stored value bumps to the current version and the toast won't reshow
// until the NEXT update.
//
// Auto-dismiss after 14 seconds if untouched (still stores the version,
// so we don't pester).
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_updateToast';
  function __zhlRunModule() {
(function () {
  'use strict';

  // We can't `import` changelog.js into a content script, so the toast
  // ships with a tiny hard-coded headline map keyed by version. Keep this
  // in sync with changelog.js on every release — only headlines for
  // versions we actually want a toast on need to live here.
  const CHANGELOG_HEADLINES = {
    "1.21.2": "Mark All As Read: accurate counts, marking overlay, hidden inside threads.",
    "1.21.1": "Mark All As Read now actually opens threads + multi-workspace fixes.",
    "1.21.0": "Salesforce Messaging panel now has a Mark All As Read button.",
    "1.20.3": "Toast View button now opens reliably + Copy-addresses demo redone.",
    "1.20.2": "Update toast fixed — this is the one you're looking at now.",
    "1.20.0": "Walkthrough page added! Click View to see every feature in the pack.",
    "1.19.8": "Gmail attachments now drop on INLINE replies (not just popup composes).",
    "1.19.0": "FHA Manual UW eligibility pill + Copy addresses primary → co-borrower.",
    "1.18.0": "Branded 2-1 Buydown PDF + LO Profile auto-pull from Salesforce.",
    "1.15.0": "FHA + Non-Permanent Resident Alien warning banner.",
    "1.12.0": "FHA Collections + Disputed cumulative-cap badges."
  };

  const STORAGE_KEY = '_zhl_last_seen_version';
  const TOAST_ID = 'zhl-update-toast';
  const AUTO_DISMISS_MS = 14000;
  const VERSION = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '?';

  console.log('[Update Toast v' + VERSION + '] loaded');

  function track(event, props) {
    try { chrome.runtime.sendMessage({ type: 'TRACK', event: event, props: props || {} }); } catch (_) {}
  }

  // Only show on top-level frames — don't double-toast in nested iframes.
  if (window.top !== window.self) {
    console.log('[Update Toast] in iframe, skipping');
    return;
  }

  // Defer until DOM ready (we run at document_idle but Gmail can still
  // be assembling its shell when we fire — wait until body is there).
  function whenBodyReady(cb) {
    if (document.body) return cb();
    document.addEventListener('DOMContentLoaded', cb, { once: true });
  }

  whenBodyReady(function () {
    chrome.storage.local.get([STORAGE_KEY], function (data) {
      const last = data && data[STORAGE_KEY];
      // Same version already seen — nothing to do.
      if (last === VERSION) {
        console.log('[Update Toast] last seen version is current (' + VERSION + ') — not showing');
        return;
      }
      // No stored version: either a fresh install (handled by
      // chrome.runtime.onInstalled which stamps the key before any
      // content script runs) OR an existing user upgrading from
      // before the toast feature existed. In the latter case we
      // SHOULD show the toast. Fresh installs will have already
      // been stamped by background.js's onInstalled handler, so
      // they'll hit the early-return above and skip this branch.
      console.log('[Update Toast] showing — lastSeen=' + (last || '<none>') + ' current=' + VERSION);
      showToast(last || 'previous version');
    });
  });

  function showToast(prevVersion) {
    if (document.getElementById(TOAST_ID)) return;
    const headline = CHANGELOG_HEADLINES[VERSION] || ('Updated from v' + prevVersion + ' to v' + VERSION + '.');

    const toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.setAttribute('style', [
      'position: fixed',
      'right: 20px',
      'bottom: 20px',
      'z-index: 2147483647',
      'max-width: 360px',
      'background: #ffffff',
      'border: 1px solid #d1d5db',
      'border-left: 4px solid #0b5cab',
      'border-radius: 8px',
      'box-shadow: 0 8px 24px rgba(0,0,0,.18)',
      'padding: 14px 16px',
      'font: 13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif',
      'color: #111',
      'opacity: 0',
      'transform: translateY(8px)',
      'transition: opacity .2s, transform .2s'
    ].join(';'));

    const header = document.createElement('div');
    header.setAttribute('style', 'display:flex;align-items:center;gap:8px;margin-bottom:6px;');
    const badge = document.createElement('span');
    badge.textContent = 'NEW';
    badge.setAttribute('style', 'background:#16a34a;color:#fff;font:700 10px/1.2 Arial,sans-serif;letter-spacing:.04em;padding:2px 6px;border-radius:3px;');
    const ver = document.createElement('strong');
    ver.textContent = 'ZHL Pack v' + VERSION;
    ver.style.cssText = 'color:#0b5cab;';
    const closeX = document.createElement('button');
    closeX.textContent = '×';
    closeX.setAttribute('aria-label', 'Dismiss');
    closeX.setAttribute('style', 'margin-left:auto;background:transparent;border:none;font:400 18px/1 sans-serif;color:#6b7280;cursor:pointer;padding:0 4px;');
    closeX.addEventListener('click', function () { dismiss('x'); });
    header.appendChild(badge);
    header.appendChild(ver);
    header.appendChild(closeX);

    const body = document.createElement('div');
    body.textContent = headline;
    body.setAttribute('style', 'margin-bottom:10px;');

    const actions = document.createElement('div');
    actions.setAttribute('style', 'display:flex;gap:8px;justify-content:flex-end;');

    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.setAttribute('style', 'background:transparent;border:none;color:#6b7280;font:500 12px/1.2 Arial,sans-serif;cursor:pointer;padding:6px 10px;border-radius:4px;');
    dismissBtn.addEventListener('click', function () { dismiss('dismiss'); });

    const viewBtn = document.createElement('button');
    viewBtn.textContent = 'View what’s new';
    viewBtn.setAttribute('style', 'background:#0b5cab;border:none;color:#fff;font:600 12px/1.2 Arial,sans-serif;cursor:pointer;padding:7px 12px;border-radius:4px;');
    viewBtn.addEventListener('click', function () {
      track('update_toast_clicked', { from: prevVersion, to: VERSION });
      // Route the tab-open through the SW. Some users have uBlock /
      // privacy extensions that block content-script window.open() to
      // chrome-extension:// URLs (the same target works fine when
      // clicked from a normal anchor on the setup page). chrome.tabs
      // .create from the SW bypasses that block.
      const url = chrome.runtime.getURL('walkthrough.html?from=update_toast#whats-new');
      try {
        chrome.runtime.sendMessage({ type: 'OPEN_TAB', url: url }, function () {
          // Best-effort fallback if SW didn't respond — try direct.
          if (chrome.runtime.lastError) {
            try { window.open(url, '_blank'); } catch (_) {}
          }
        });
      } catch (_) {
        try { window.open(url, '_blank'); } catch (__) {}
      }
      stampSeen();
      removeToast();
    });

    actions.appendChild(dismissBtn);
    actions.appendChild(viewBtn);

    toast.appendChild(header);
    toast.appendChild(body);
    toast.appendChild(actions);
    toast.title = 'Built by Justin Case. Karma appreciated 💛';
    document.body.appendChild(toast);

    // Animate in.
    requestAnimationFrame(function () {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    track('update_toast_shown', { from: prevVersion, to: VERSION });

    const autoDismissTimer = setTimeout(function () { dismiss('auto'); }, AUTO_DISMISS_MS);

    function dismiss(reason) {
      clearTimeout(autoDismissTimer);
      track('update_toast_dismissed', { from: prevVersion, to: VERSION, reason: reason });
      stampSeen();
      removeToast();
    }
  }

  function stampSeen() {
    chrome.storage.local.set({ [STORAGE_KEY]: VERSION });
  }

  function removeToast() {
    const t = document.getElementById(TOAST_ID);
    if (!t) return;
    t.style.opacity = '0';
    t.style.transform = 'translateY(8px)';
    setTimeout(function () { try { t.remove(); } catch (_) {} }, 250);
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
