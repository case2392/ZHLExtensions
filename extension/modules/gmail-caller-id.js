// ZHL Productivity Pack module — feature key: feature_gmailCallerId
//
// Adds Caller ID badging to Switchboard "Do Not Reply: Incoming
// Text Message from <phone>" emails in Gmail. The phone number
// lives in the subject heading; we extract it, ask the background
// worker to look it up in Salesforce (same LOOKUP_PHONE message
// path the existing Salesforce-side Caller ID uses), and append a
// blue pill with the matched contact's name.
//
// Only annotates subjects that start with "Do Not Reply: Incoming
// Text Message from" — every other email is ignored.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_gmailCallerId';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[Gmail Caller ID v' + VERSION + '] loaded');

  const BADGE_CLASS = 'zhl-gmail-callerid-badge';
  const ANNOTATED_ATTR = 'data-zhl-gmail-callerid';
  // Switchboard's "Do Not Reply" emails come in two flavors:
  //   1. Phone is in the Salesforce Contact's Mobile field →
  //      subject is "Incoming Text Message from <Name> <phone>".
  //      No gap to fill; the name is already visible.
  //   2. Phone is in the Phone or Work Phone field →
  //      subject is "Incoming Text Message from <phone>" only.
  //      We badge these.
  // The regex anchors the captured group to ONLY a phone-number
  // shape so it skips case 1 entirely.
  const SUBJECT_PHONE_ONLY_RE = /^\s*Do\s+Not\s+Reply\s*:\s*Incoming\s+Text\s+Message\s+from\s+(\+?1?[\s().\-]*\d{3}[\s().\-]*\d{3}[\s().\-]*\d{4})\s*$/i;
  const PHONE_RE = /(?:tel:)?\+?1?[\s().-]*(\d{3})[\s().-]*(\d{3})[\s().-]*(\d{4})/;

  function extractTenDigit(text) {
    if (!text) return null;
    const m = String(text).match(PHONE_RE);
    if (!m) return null;
    return m[1] + m[2] + m[3];
  }

  let extensionDead = false;
  function lookup(phone) {
    if (extensionDead) return Promise.resolve(null);
    return new Promise(function (resolve) {
      try {
        if (!chrome || !chrome.runtime || !chrome.runtime.id) {
          extensionDead = true;
          resolve(null);
          return;
        }
        chrome.runtime.sendMessage({ type: 'LOOKUP_PHONE', phone: phone }, function (resp) {
          const lastErr = chrome.runtime && chrome.runtime.lastError;
          if (lastErr) {
            if (/Extension context invalidated|message port closed|receiving end does not exist/i.test(lastErr.message || '')) {
              extensionDead = true;
            }
            resolve(null);
            return;
          }
          if (!resp || !resp.ok) { resolve(null); return; }
          resolve(resp.match || null);
        });
      } catch (e) {
        if (/Extension context invalidated|message port closed|receiving end does not exist/i.test(String(e && e.message || e))) {
          extensionDead = true;
        }
        resolve(null);
      }
    });
  }

  function annotate(subjectEl, name) {
    if (!subjectEl) return;
    if (subjectEl.getAttribute(ANNOTATED_ATTR) === name) return;
    subjectEl.setAttribute(ANNOTATED_ATTR, name);
    let badge = subjectEl.querySelector(':scope > .' + BADGE_CLASS);
    if (!badge) {
      badge = document.createElement('span');
      badge.className = BADGE_CLASS;
      // Same visual as the Salesforce/Genesys badge for cross-app
      // consistency (.callerid-badge in modules/caller-id.js).
      badge.style.cssText =
        'display:inline-block;margin-left:8px;padding:1px 8px;' +
        'border-radius:10px;background:#0b5cab;color:#fff;' +
        'font-size:12px;font-weight:600;line-height:16px;' +
        'vertical-align:middle;font-family:Arial,Helvetica,sans-serif;' +
        'white-space:nowrap;';
      subjectEl.appendChild(badge);
    }
    badge.textContent = name;
    badge.title = 'Salesforce match: ' + name;
  }

  function scan() {
    if (extensionDead) return;
    // Gmail renders the open email's subject in an <h2 class="hP">.
    // It rerenders the node when navigating threads, so we re-scan
    // on each MutationObserver tick.
    const subjects = document.querySelectorAll('h2.hP');
    for (const h of subjects) {
      // Use only the text node text, not nested badge text.
      let raw = '';
      for (const n of h.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) raw += n.nodeValue;
      }
      raw = (raw || h.textContent || '').trim();
      const m = SUBJECT_PHONE_ONLY_RE.exec(raw);
      if (!m) continue;
      const phone = extractTenDigit(m[1]);
      if (!phone) continue;
      // Skip if already annotated (data attribute matches result).
      if (h.querySelector(':scope > .' + BADGE_CLASS)) continue;
      lookup(phone).then(function (match) {
        if (match && match.name) annotate(h, match.name);
      });
    }
  }

  let scheduled = false;
  function schedule() {
    if (scheduled || extensionDead) return;
    scheduled = true;
    setTimeout(function () { scheduled = false; try { scan(); } catch (e) { console.warn('[Gmail Caller ID] scan error', e); } }, 200);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true, subtree: true, characterData: true
  });
  setInterval(schedule, 3000);
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
