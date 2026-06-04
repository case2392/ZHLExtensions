// ZHL Productivity Pack module — feature key: feature_autoCallDetailsTab
// Wraps original module body in a chrome.storage.local feature-flag check.
// If the user disables this module on the setup page the body never runs.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_autoCallDetailsTab';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  const TAG = '[Auto Call Details Tab v' + VERSION + ']';
  console.log(TAG, 'loaded');

  // Tracks the Call Details tab DOM nodes we've already auto-clicked.
  // Salesforce Console keeps every open Lead workspace mounted in the
  // DOM at the same time — each workspace gets its own distinct Call
  // Details tab node — so tracking by DOM identity is the right grain.
  // Switching this from the previous URL-keyed Set to a WeakSet of nodes
  // fixed the "only works on the first Lead I open" bug, since the URL
  // doesn't always update in lockstep when you switch workspaces.
  const clickedTabs = new WeakSet();

  // Shadow-DOM-piercing query helpers, same approach as the SMS module.
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

  function findVisibleCallDetailsTabs() {
    // Match by data-label first (the most stable Lightning tab attr),
    // then fall back to any role=tab element whose text is "Call Details".
    const byLabel = deepQuerySelectorAll(document, 'a[role="tab"][data-label="Call Details"], li[role="presentation"][title="Call Details"] a[role="tab"]');
    const out = [];
    for (const el of byLabel) {
      if (el.offsetParent === null) continue;
      out.push(el);
    }
    if (!out.length) {
      // Fallback: any visible role=tab whose text is exactly "Call Details".
      const tabs = deepQuerySelectorAll(document, '[role="tab"]');
      for (const t of tabs) {
        if (t.offsetParent === null) continue;
        const text = (t.textContent || '').replace(/\s+/g, ' ').trim();
        if (text === 'Call Details') out.push(t);
      }
    }
    return out;
  }

  function isAlreadyOnCallDetails(tab) {
    if (!tab) return false;
    return tab.getAttribute('aria-selected') === 'true'
      || (tab.parentElement && tab.parentElement.classList.contains('slds-is-active'));
  }

  // Extract a human-readable identifier for the workspace this tab
  // lives in. Best-effort, for log output only — we walk up looking
  // for a Lead id in any ancestor's href / data-id / aria attributes.
  function tabContextLabel(tab) {
    let p = tab;
    for (let i = 0; i < 12 && p; i++) {
      const leadIdAttr = p.getAttribute && (p.getAttribute('data-aura-rendered-by') || p.getAttribute('data-tabid') || p.getAttribute('data-id'));
      if (leadIdAttr) return leadIdAttr;
      p = p.parentElement;
    }
    const m = /\/lightning\/r\/Lead\/(\w+)\//i.exec(location.href || '');
    return m ? ('Lead ' + m[1]) : 'unknown';
  }

  function tryAutoSwitch() {
    const tabs = findVisibleCallDetailsTabs();
    if (!tabs.length) return;
    for (const tab of tabs) {
      if (clickedTabs.has(tab)) continue;
      const ctx = tabContextLabel(tab);
      if (isAlreadyOnCallDetails(tab)) {
        clickedTabs.add(tab);
        console.log(TAG, 'workspace [' + ctx + '] already on Call Details — marking handled, no click');
        continue;
      }
      clickedTabs.add(tab);
      console.log(TAG, 'workspace [' + ctx + '] clicking Call Details tab', tab);
      try { tab.click(); }
      catch (_) {
        const ev = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        tab.dispatchEvent(ev);
      }
      try { chrome.runtime.sendMessage({ type: 'TRACK', event: 'auto_call_details_switched' }); } catch (_) {}
    }
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      try { tryAutoSwitch(); }
      catch (e) { console.warn(TAG, 'scan error', e); }
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // SPA navigation between Leads doesn't fire load events. Periodic scan
  // catches that — WeakSet of clicked tabs keeps us idempotent so even
  // rapid scans are cheap.
  setInterval(schedule, 1000);

  schedule();
})();
  }
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([__ZHL_FEATURE_KEY, 'zhl_kill_switch'], function (data) {
      if (data.zhl_kill_switch === true) return;
      if (data[__ZHL_FEATURE_KEY] === false) return;
      __zhlRunModule();
    });
  } else {
    __zhlRunModule();
  }
})();
