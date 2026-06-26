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
  // Modern Genesys Cloud utility-bar widget renders inline in the top
  // Salesforce frame (no iframe), so we have to allow the top frame too.
  // To avoid annotating Salesforce's own page-level phone fields (Phone,
  // Mobile, Work Phone on the record) we restrict the top-frame scan to
  // utility-bar panels and Genesys-branded containers — see getScanRoots.
  // In iframes (legacy Visualforce-embedded Genesys), scan the whole frame.
  const IS_TOP_FRAME = window.top === window.self;

  // As of mid-2026 Genesys Cloud renders caller-ID names natively in the
  // Salesforce Lightning EMBEDDED widget (the openctiSoftPhone iframe whose
  // src is apps.*.pure.cloud / apps.*.mypurecloud.*). They have NOT shipped
  // that to the STANDALONE Genesys CRM (the same URL opened directly in a
  // top-level tab). Without this guard our badges duplicate Genesys's own
  // labels everywhere inside the Lightning widget (call history,
  // voicemails, active interactions). Detection: sub-frame + Genesys host
  // == the embedded widget. The standalone CRM has window.top === self so
  // it falls through and keeps running (Genesys's native feature isn't
  // there yet on that surface).
  const GENESYS_HOSTS_RE = /(?:^|\.)(?:mypurecloud\.(?:com|ie|de|com\.au|jp)|pure\.cloud)$/i;
  if (!IS_TOP_FRAME && GENESYS_HOSTS_RE.test(location.hostname)) {
    console.log('[CallerID] Lightning-embedded Genesys widget detected — skipping (Genesys provides native caller ID here)');
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
    badge.title = `Salesforce match: ${name}\n\nBuilt by Justin Case. Karma appreciated 💛`;
  }

  const inFlight = new Map(); // phone -> Promise<match|null>

  // Reloading the extension (or it auto-updating) invalidates the content
  // script's connection to the background worker. chrome.runtime.sendMessage
  // then throws "Extension context invalidated" forever after. Track that
  // state, stop the observer + interval, and quietly resolve null instead
  // of spamming the error log.
  let extensionDead = false;
  function isExtensionAlive() {
    try { return !!(chrome.runtime && chrome.runtime.id); }
    catch (_) { return false; }
  }
  function isContextInvalidatedError(msg) {
    return /Extension context invalidated|message port closed|receiving end does not exist/i.test(String(msg || ''));
  }
  function markExtensionDead() {
    if (extensionDead) return;
    extensionDead = true;
    try { observer && observer.disconnect(); } catch (_) {}
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
  }

  function lookup(phone) {
    if (extensionDead) return Promise.resolve(null);
    if (inFlight.has(phone)) return inFlight.get(phone);
    if (!isExtensionAlive()) {
      markExtensionDead();
      return Promise.resolve(null);
    }
    const p = new Promise((resolve) => {
      try {
        console.log("[CallerID] lookup →", phone);
        chrome.runtime.sendMessage({ type: "LOOKUP_PHONE", phone }, (resp) => {
          const lastErr = chrome.runtime && chrome.runtime.lastError;
          if (lastErr) {
            if (isContextInvalidatedError(lastErr.message)) markExtensionDead();
            else console.warn("[CallerID] sendMessage error:", lastErr.message);
            resolve(null);
            return;
          }
          if (!resp || !resp.ok) {
            if (resp && resp.error) console.warn("[CallerID] lookup error:", resp.error);
            else console.warn("[CallerID] lookup got no ok response for", phone, resp);
            resolve(null);
            return;
          }
          // Telemetry is now fired from the background's lookupPhone ONLY
          // when a real Salesforce query happens (cache misses), with the
          // page hostname attached. Cache hits no longer fire telemetry,
          // so the no_match volume drops by ~5x compared to the old
          // per-content-script-call tracking.
          if (resp.match) {
            console.log("[CallerID] match for", phone, "→", resp.match.sobject, resp.match.id, resp.match.name);
          } else {
            console.log("[CallerID] no match for", phone);
          }
          resolve(resp.match || null);
        });
      } catch (e) {
        if (isContextInvalidatedError(e && e.message)) markExtensionDead();
        else console.warn("[CallerID] sendMessage threw:", e);
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
        // Skip Genesys's transient notification toasts ("Failed to save…",
        // etc.) which sit inside .notification-container, and Salesforce
        // page-level toasts. Tightened: previous matches on bare .alert /
        // .toast / [class*='alert'] also caught Genesys's active-call
        // card (whose class contains "alert"), so the active-call number
        // never got a badge. Now we anchor on container classes that
        // truly identify the toast layer.
        if (parent.closest(".notification-container, [class*='notification-container'], [class*='NotificationContainer'], [class*='toast-container'], [class*='ToastContainer'], [class*='oneToastContainer']")) return NodeFilter.FILTER_REJECT;
        // Skip Salesforce Messaging / Conversation components. The
        // user already sees the contact's name throughout the
        // messaging UI (participants list, conversation header,
        // phone-number autocomplete dropdown), so re-badging the
        // phone numbers there is redundant and visually noisy. Class
        // / tag patterns observed:
        //   - oneConvoApp, convoMessenger, convo-conversation-app
        //   - messaging-conversation, conversationViewport
        //   - lightning-conversation-toolkit-host (Lightning host)
        //   - data-component-id="convo*" on Lightning components
        if (parent.closest(
          "[class*='oneConvoApp'], [class*='convoMessenger']," +
          " [class*='convo-conversation'], [class*='conversation-app']," +
          " [class*='messaging-conversation'], [class*='conversationViewport']," +
          " [class*='lightning-conversation'], lightning-conversation-toolkit-host," +
          " [data-component-id*='convo' i], [data-aura-class*='convo' i]"
        )) return NodeFilter.FILTER_REJECT;
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

  // In the top Salesforce frame, only scan inside utility-bar panels and
  // Genesys-branded containers. This keeps badges out of Salesforce's own
  // record fields (Phone, Mobile, Work Phone) where they'd be redundant.
  const TOP_FRAME_ROOTS_SELECTOR = [
    "div.oneUtilityBarPanel",
    "div[data-aura-class*='utilityBar']",
    "div[class*='utilityBar']",
    "[class*='purecloud']",
    "[class*='Purecloud']",
    "[class*='PureCloud']",
    "[class*='genesys']",
    "[class*='Genesys']",
    "[id*='purecloud']",
    "[id*='genesys']"
  ].join(", ");

  function getScanRoots() {
    if (!IS_TOP_FRAME) return [document.body || document.documentElement];
    const roots = document.querySelectorAll(TOP_FRAME_ROOTS_SELECTOR);
    return roots.length ? Array.from(roots) : [];
  }

  let scheduled = false;
  function scheduleScan() {
    if (extensionDead) return;
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      if (extensionDead) return;
      try {
        for (const root of getScanRoots()) scanTextNodes(root);
      } catch (e) {
        console.warn("[CallerID] scan failed", e);
      }
    }, 200);
  }

  // Forward-declared up top so markExtensionDead can disconnect / clear them.
  var observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  // Also scan periodically as a safety net for frameworks that mutate via canvas/shadow.
  var intervalId = setInterval(scheduleScan, 3000);
  scheduleScan();
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
