// ZHL Productivity Pack module — feature key: feature_salesforcePromotions
// Wraps original module body in a chrome.storage.local feature-flag check.
// If the user disables this module on the setup page the body never runs.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_salesforcePromotions';
  function __zhlRunModule() {
// Salesforce Lightning Lead-page tweak: when the inline flow renders a
// "Show Promotions" toggle in the on by default, flip it off automatically.
// The toggle lives ~10 nested shadow DOMs deep inside <flowruntime-toggle>.

(function () {
  'use strict';

  // Walk through nested shadow roots looking for an element matching the
  // predicate. Returns the first match (BFS) or null.
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

  function findShowPromotionsToggle() {
    return deepFind(document, (el) => {
      if (el.tagName !== 'FLOWRUNTIME-TOGGLE') return false;
      return /Show Promotions/i.test((el.textContent || '').trim());
    });
  }

  function tryTurnOff() {
    const toggle = findShowPromotionsToggle();
    if (!toggle) return false;
    const checkbox = deepFind(toggle, (el) =>
      el.tagName === 'INPUT' && el.type === 'checkbox'
    );
    if (!checkbox) return false;
    if (!checkbox.checked) return true; // already off — nothing to do; treat as handled
    const label = deepFind(toggle, (el) =>
      el.tagName === 'LABEL' && el.classList?.contains('slds-checkbox_toggle')
    );
    if (!label) return false;
    label.click();
    console.log('[Salesforce QoL] auto-disabled Show Promotions');
    return true;
  }

  // Salesforce Lightning is a SPA — switching leads doesn't reload the page.
  // Poll periodically and reset the "handled" flag when the URL changes so
  // each newly-opened lead gets the auto-disable. If the user manually
  // re-enables Show Promotions for a given lead, we leave it alone for
  // that lead (handled stays true).
  let lastLeadPath = null;
  let handledForLead = false;

  function tick() {
    const currentPath = location.pathname;
    if (currentPath !== lastLeadPath) {
      lastLeadPath = currentPath;
      handledForLead = false;
    }
    if (handledForLead) return;
    if (tryTurnOff()) handledForLead = true;
  }

  setInterval(tick, 500);
  console.log('[Salesforce QoL] loaded');
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
