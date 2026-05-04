// ZHL Productivity Pack module — feature key: feature_callerId
// Wraps original module body in a chrome.storage.local feature-flag check.
// If the user disables this module on the setup page the body never runs.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_callerId';
  function __zhlRunModule() {
// Runs in the Salesforce page and inside the Genesys widget iframe (all_frames: true).
// Watches for phone-number-bearing DOM nodes, asks the background worker to look them
// up in Salesforce, and annotates the node with the matched record name.

(() => {
  // Only run inside iframes. The Genesys widget is rendered inside a Visualforce
  // iframe; the top-level Salesforce page contains its own tel: links (Lead phone,
  // DNC widget, etc.) that we must not annotate.
  if (window.top === window.self) {
    console.log("[CallerID] skipping top-level frame", location.href);
    return;
  }

  // Diagnostic: confirms the script actually loaded in this frame and which version.
  // If the version logged here is older than the manifest.json on disk, Chrome is
  // serving a stale build — go to chrome://extensions and click the reload icon
  // on the extension's card.
  const VERSION = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || "?";
  console.log(`[CallerID v${VERSION}] content script loaded in`, location.href);

  const PHONE_RE = /(?:tel:)?\+?1?[\s().-]*(\d{3})[\s().-]*(\d{3})[\s().-]*(\d{4})/;
  const ANNOTATED_ATTR = "data-callerid-name";
  const BADGE_CLASS = "callerid-badge";

  function extractTenDigit(text) {
    if (!text) return null;
    const m = String(text).match(PHONE_RE);
    if (!m) return null;
    return m[1] + m[2] + m[3];
  }

  function annotate(el, name) {
    if (!el) return;
    if (el.getAttribute(ANNOTATED_ATTR) === name) return;
    el.setAttribute(ANNOTATED_ATTR, name);
    let badge = el.querySelector(":scope > ." + BADGE_CLASS);
    if (!badge) {
      badge = document.createElement("span");
      badge.className = BADGE_CLASS;
      badge.style.cssText =
        "display:inline-block;margin-left:6px;padding:1px 6px;border-radius:8px;" +
        "background:#0b5cab;color:#fff;font-size:11px;font-weight:600;line-height:14px;" +
        "vertical-align:middle;font-family:Arial,Helvetica,sans-serif;white-space:nowrap;";
      el.appendChild(badge);
    }
    badge.textContent = name;
    badge.title = `Salesforce match: ${name}`;
  }

  const inFlight = new Map(); // phone -> Promise<match|null>

  function lookup(phone) {
    if (inFlight.has(phone)) return inFlight.get(phone);
    const p = new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "LOOKUP_PHONE", phone }, (resp) => {
          if (chrome.runtime.lastError) {
            console.warn("[CallerID] sendMessage error:", chrome.runtime.lastError.message);
            resolve(null);
            return;
          }
          if (!resp || !resp.ok) {
            if (resp && resp.error) console.warn("[CallerID] lookup error:", resp.error);
            resolve(null);
            return;
          }
          resolve(resp.match || null);
        });
      } catch (e) {
        console.warn("[CallerID] sendMessage threw:", e);
        resolve(null);
      }
    });
    inFlight.set(phone, p);
    // Re-allow after 60s so retries can pick up new data.
    setTimeout(() => inFlight.delete(phone), 60000);
    return p;
  }

  // ---- DOM scanning ----------------------------------------------------------

  // Skip text nodes that aren't worth annotating: Genesys repeats the active
  // call's number in a "New Interaction: +1..." footer; one badge in the green
  // active-call box is enough.
  const SKIP_TEXT_RE = /new interaction\s*:/i;

  // Walks up to the row container so we can dedupe one badge per row per phone
  // number. Voicemail rows render both `+13195050388` and `+1 319-505-0388`,
  // which would otherwise both get annotated.
  function findRowContainer(el) {
    return (
      el.closest(
        "li, [role='listitem'], [role='row']," +
          " .interactions, .interaction-selection, .center-container," +
          " [class*='conversation-summary'], [class*='conversation-item']," +
          " [class*='interaction-summary'], [class*='interaction-list-item']," +
          " [class*='history-item'], [class*='inbox-item']," +
          " [class*='new-interaction']"
      ) || el.parentElement
    );
  }

  // For the inbox / call-history list, find every text node containing a phone number
  // and annotate its row container. We dedupe per (row container, phone).
  function scanTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        if (SKIP_TEXT_RE.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        if (!PHONE_RE.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.classList && parent.classList.contains(BADGE_CLASS)) return NodeFilter.FILTER_REJECT;
        if (parent.closest("." + BADGE_CLASS)) return NodeFilter.FILTER_REJECT;
        // Skip Genesys notification / toast banners — these are transient
        // status messages ("Failed to save…", etc.) and don't need a badge.
        if (parent.closest(".notification-container, .notification-message, .alert, .toast, [class*='notification'], [class*='Notification'], [class*='toast'], [class*='Toast']")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    // Per-scan dedupe: row -> Set<phone>. Combined with the persistent
    // data-callerid-phone-<phone> marker on the row this prevents double badging.
    const annotatedThisScan = new WeakMap();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const phone = extractTenDigit(node.nodeValue);
      if (!phone) continue;
      const textParent = node.parentElement;
      if (!textParent) continue;
      const row = findRowContainer(textParent);
      if (!row) continue;
      const phonesAttr = `data-callerid-phone-${phone}`;
      if (row.hasAttribute(phonesAttr)) continue;
      let phones = annotatedThisScan.get(row);
      if (!phones) {
        phones = new Set();
        annotatedThisScan.set(row, phones);
      }
      if (phones.has(phone)) continue;
      phones.add(phone);
      lookup(phone).then((m) => {
        if (m && m.name) {
          row.setAttribute(phonesAttr, "1");
          annotate(textParent, m.name);
        }
      });
    }
  }

  let scheduled = false;
  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      try {
        scanTextNodes(document.body || document.documentElement);
      } catch (e) {
        console.warn("[CallerID] scan failed", e);
      }
    }, 200);
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  // Also scan periodically as a safety net for frameworks that mutate via canvas/shadow.
  setInterval(scheduleScan, 3000);
  scheduleScan();
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
