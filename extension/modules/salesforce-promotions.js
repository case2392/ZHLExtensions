// ZHL Productivity Pack module — feature key: feature_salesforcePromotions
// Wraps original module body in a chrome.storage.local feature-flag check.
// If the user disables this module on the setup page the body never runs.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_salesforcePromotions';
  function __zhlRunModule() {
// Salesforce Lightning Lead-page tweak: when the inline flow renders a
// "Show Promotions" toggle on by default, flip it off automatically.
// The toggle lives ~10 nested shadow DOMs deep inside <flowruntime-toggle>.

(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  const TAG = '[Salesforce Promotions v' + VERSION + ']';
  console.log(TAG, 'loaded');

  // Walk through nested shadow roots collecting elements matching the
  // predicate. Returns ALL matches (BFS) so we can iterate every open
  // Lead workspace in Salesforce Console mode — Console keeps each
  // opened workspace mounted in the DOM simultaneously, so a single
  // "find first match" call only ever sees the first workspace's
  // toggle.
  function deepFindAll(root, predicate) {
    const out = [];
    const queue = [root];
    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node.querySelectorAll !== 'function') continue;
      for (const el of node.querySelectorAll('*')) {
        if (predicate(el)) out.push(el);
        if (el.shadowRoot) queue.push(el.shadowRoot);
      }
    }
    return out;
  }
  function deepFind(root, predicate) {
    const queue = [root];
    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node.querySelectorAll !== 'function') continue;
      for (const el of node.querySelectorAll('*')) {
        if (predicate(el)) return el;
        if (el.shadowRoot) queue.push(el.shadowRoot);
      }
    }
    return null;
  }

  function findAllShowPromotionsToggles() {
    return deepFindAll(document, (el) => {
      if (el.tagName !== 'FLOWRUNTIME-TOGGLE') return false;
      return /Show Promotions/i.test((el.textContent || '').trim());
    });
  }

  // Tracks toggle DOM nodes we've already handled. Switching from the
  // previous "single URL-keyed flag" approach fixed the multi-workspace
  // case — Salesforce Console mounts a separate <flowruntime-toggle>
  // node per Lead workspace, so a WeakSet keyed on the node correctly
  // handles each workspace exactly once without depending on
  // location.pathname (which can lag behind workspace switches).
  const handledToggles = new WeakSet();

  function workspaceLabelFor(toggle) {
    // Best-effort context label for log output — walk up to the
    // workspace tab container if we can find one.
    let p = toggle;
    for (let i = 0; i < 20 && p; i++) {
      const attr = p.getAttribute && (p.getAttribute('data-tabid') || p.getAttribute('data-aura-rendered-by'));
      if (attr) return attr;
      p = p.parentElement;
    }
    const m = /\/lightning\/r\/Lead\/(\w+)\//i.exec(location.href || '');
    return m ? ('Lead ' + m[1]) : 'unknown';
  }

  function tick() {
    const toggles = findAllShowPromotionsToggles();
    if (!toggles.length) return;
    for (const toggle of toggles) {
      if (handledToggles.has(toggle)) continue;
      const ctx = workspaceLabelFor(toggle);
      const checkbox = deepFind(toggle, (el) =>
        el.tagName === 'INPUT' && el.type === 'checkbox'
      );
      if (!checkbox) {
        // Toggle is in the DOM but its inner shadow root isn't fully
        // mounted yet. Skip without marking handled so we retry.
        continue;
      }
      if (!checkbox.checked) {
        // Already off — mark handled so we don't keep scanning it.
        handledToggles.add(toggle);
        console.log(TAG, 'workspace [' + ctx + '] toggle already off — marking handled, no click');
        continue;
      }
      const label = deepFind(toggle, (el) =>
        el.tagName === 'LABEL' && el.classList && el.classList.contains('slds-checkbox_toggle')
      );
      if (!label) {
        // Same as above — wait for next tick if label isn't mounted.
        continue;
      }
      handledToggles.add(toggle);
      try { label.click(); }
      catch (e) { console.warn(TAG, 'workspace [' + ctx + '] label.click() threw', e); }
      console.log(TAG, 'workspace [' + ctx + '] auto-disabled Show Promotions');
    }
  }

  setInterval(tick, 500);
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
