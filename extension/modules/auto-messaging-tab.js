// ZHL Productivity Pack module — feature key: feature_autoMessagingTab
// Wraps original module body in a chrome.storage.local feature-flag check.
// If the user disables this module on the setup page the body never runs.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_autoMessagingTab';
  function __zhlRunModule() {
(function () {
  'use strict';

  // Tracks Contact ids we've already auto-switched once. Without this we'd
  // keep snapping the user back to Messaging every time they tried to
  // click Activity (or any other tab).
  const switchedContacts = new Set();

  function getContactIdFromUrl() {
    const m = /\/lightning\/r\/Contact\/(\w+)\//i.exec(location.href || '');
    return m ? m[1] : null;
  }

  function deepQuerySelectorAll(root, selector, out) {
    out = out || [];
    if (!root) return out;
    if (root.querySelectorAll) {
      root.querySelectorAll(selector).forEach((el) => out.push(el));
    }
    const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const el of all) {
      if (el.shadowRoot) deepQuerySelectorAll(el.shadowRoot, selector, out);
    }
    return out;
  }

  function findMessagingTab() {
    const byLabel = deepQuerySelectorAll(document, 'a[role="tab"][data-label="Messaging"], li[role="presentation"][title="Messaging"] a[role="tab"]');
    for (const el of byLabel) {
      if (el.offsetParent === null) continue;
      return el;
    }
    const tabs = deepQuerySelectorAll(document, '[role="tab"]');
    for (const t of tabs) {
      if (t.offsetParent === null) continue;
      const text = (t.textContent || '').replace(/\s+/g, ' ').trim();
      if (text === 'Messaging') return t;
    }
    return null;
  }

  function isAlreadyOnMessaging(tab) {
    if (!tab) return false;
    return tab.getAttribute('aria-selected') === 'true'
      || (tab.parentElement && tab.parentElement.classList.contains('slds-is-active'));
  }

  function tryAutoSwitch() {
    const contactId = getContactIdFromUrl();
    if (!contactId) return;
    if (switchedContacts.has(contactId)) return;

    const tab = findMessagingTab();
    if (!tab) return;
    if (isAlreadyOnMessaging(tab)) {
      switchedContacts.add(contactId);
      return;
    }

    switchedContacts.add(contactId);
    try { tab.click(); }
    catch (_) {
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
      tab.dispatchEvent(ev);
    }
    console.log('[Auto Messaging Tab] switched Contact', contactId, 'to Messaging');
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      try { tryAutoSwitch(); }
      catch (e) { console.warn('[Auto Messaging Tab] scan error', e); }
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  setInterval(schedule, 1000);

  schedule();
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
