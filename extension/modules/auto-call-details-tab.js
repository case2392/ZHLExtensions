// ZHL Productivity Pack module — feature key: feature_autoCallDetailsTab
// Wraps original module body in a chrome.storage.local feature-flag check.
// If the user disables this module on the setup page the body never runs.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_autoCallDetailsTab';
  function __zhlRunModule() {
(function () {
  'use strict';

  // Tracks Lead ids we've already auto-switched once. Without this we'd
  // keep snapping the user back to Call Details every time they tried to
  // click Active Listening (or any other tab).
  const switchedLeads = new Set();

  function getLeadIdFromUrl() {
    const m = /\/lightning\/r\/Lead\/(\w+)\//i.exec(location.href || '');
    return m ? m[1] : null;
  }

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

  function findCallDetailsTab() {
    // Match by data-label first (the most stable Lightning tab attr),
    // then fall back to any role=tab element whose text is "Call Details".
    const byLabel = deepQuerySelectorAll(document, 'a[role="tab"][data-label="Call Details"], li[role="presentation"][title="Call Details"] a[role="tab"]');
    for (const el of byLabel) {
      if (el.offsetParent === null) continue;
      return el;
    }
    const tabs = deepQuerySelectorAll(document, '[role="tab"]');
    for (const t of tabs) {
      if (t.offsetParent === null) continue;
      const text = (t.textContent || '').replace(/\s+/g, ' ').trim();
      if (text === 'Call Details') return t;
    }
    return null;
  }

  function isAlreadyOnCallDetails(tab) {
    if (!tab) return false;
    return tab.getAttribute('aria-selected') === 'true'
      || (tab.parentElement && tab.parentElement.classList.contains('slds-is-active'));
  }

  function tryAutoSwitch() {
    const leadId = getLeadIdFromUrl();
    if (!leadId) return;
    if (switchedLeads.has(leadId)) return;

    const tab = findCallDetailsTab();
    if (!tab) return;
    if (isAlreadyOnCallDetails(tab)) {
      // Mark done — the user is already on the right tab; don't keep trying.
      switchedLeads.add(leadId);
      return;
    }

    // Click once and remember we did it for this Lead.
    switchedLeads.add(leadId);
    try { tab.click(); }
    catch (_) {
      // Synthetic click fallback
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
      tab.dispatchEvent(ev);
    }
    console.log('[Auto Call Details Tab] switched Lead', leadId, 'to Call Details');
    try { chrome.runtime.sendMessage({ type: 'TRACK', event: 'auto_call_details_switched' }); } catch (_) {}
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      try { tryAutoSwitch(); }
      catch (e) { console.warn('[Auto Call Details Tab] scan error', e); }
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // SPA navigation between Leads doesn't fire load events. Periodic scan
  // catches that — and we only act once per Lead anyway, so it's cheap.
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
