// ZHL Productivity Pack — Gmail PE auto-paste
//
// Companion to pricing-exception-workflow.js. When the LO clicks
// "Open in Gmail" on the operator side, the operator-side handler stashes
// the formatted HTML email body in chrome.storage.local under
// zhlPePendingPaste. This script runs on the Gmail tab, sees the pending
// entry (TTL 30 s), finds Gmail's contenteditable body, and replaces its
// content with the formatted HTML — so the LO sees the same nicely-
// formatted version that "Copy body" produces, without having to Ctrl+V.
//
// Single-use: storage is cleared before the paste fires so a second Gmail
// tab can't accidentally pick up the same payload.
(function () {
  'use strict';

  console.log('[ZHL PE Auto-paste] loaded on', location.href);

  const STORAGE_KEY = 'zhlPePendingPaste';
  const TTL_MS      = 60 * 1000;
  const POLL_MS     = 100;
  const POLL_LIMIT  = 200; // ~20 s total polling for the compose body

  // Multiple fallback strategies for finding Gmail's compose body, because
  // Gmail keeps changing the markup. Returns the first hit, in priority
  // order:
  //   1. aria-label including "message body" / "body" / "email body"
  //   2. Gmail-specific div[g_editable=true] / div.editable[contenteditable]
  //   3. The largest contenteditable on the page (size threshold prevents
  //      matching recipient chip inputs / subject line)
  function findComposeBody() {
    const all = document.querySelectorAll('div[contenteditable="true"]');
    // 1. aria-label match
    for (const el of all) {
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      if (aria.indexOf('message body') >= 0 ||
          aria === 'body' ||
          aria.indexOf('email body') >= 0 ||
          aria.indexOf('compose body') >= 0) {
        return el;
      }
    }
    // 2. Gmail-specific attribute / class
    const gmailSpecific = document.querySelector(
      'div[g_editable="true"], div.editable[contenteditable="true"]'
    );
    if (gmailSpecific) return gmailSpecific;
    // 3. Largest contenteditable above a size threshold
    let largest = null;
    let largestArea = 0;
    for (const el of all) {
      try {
        const rect = el.getBoundingClientRect();
        const area = rect.width * rect.height;
        // Filter out small fields (recipient chip inputs ~30px tall,
        // subject line ~30px tall). The body is typically 200+ px tall.
        if (area > 8000 && area > largestArea) {
          largestArea = area;
          largest = el;
        }
      } catch (_) {}
    }
    return largest;
  }

  function placeCaretAtEnd(el) {
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
  }

  function doPasteInto(target, html) {
    try {
      target.focus();
      try {
        const range = document.createRange();
        range.selectNodeContents(target);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (_) {}
      let ok = false;
      try { ok = document.execCommand('insertHTML', false, html); } catch (_) {}
      if (!ok) {
        try { target.innerHTML = html; ok = true; } catch (_) {}
      }
      try {
        target.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertFromPaste' }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (_) {}
      placeCaretAtEnd(target);
      return ok;
    } catch (_) { return false; }
  }

  // Returns a stable "fingerprint" of the body's content: the table tag count
  // and presence of "PE request" text. We use this to detect when Gmail
  // overwrites our HTML paste with the plain &body= text (no <table>, no
  // formatting) — which can happen if Gmail's URL-driven body fill races our
  // paste and lands last.
  function looksLikeFormattedPaste(target) {
    try {
      if (!target) return false;
      const html = target.innerHTML || '';
      // Our formatted body always contains the comparison <table>.
      return html.indexOf('<table') >= 0 && html.indexOf('Pricing comparison') >= 0;
    } catch (_) { return false; }
  }

  function pasteIntoCompose(html, onSuccess, onFail) {
    let attempts = 0;
    let pasted = false;
    const interval = setInterval(function () {
      attempts++;
      const target = findComposeBody();
      if (target && !pasted) {
        clearInterval(interval);
        pasted = true;
        const ok = doPasteInto(target, html);
        console.log('[ZHL PE Auto-paste] pasted formatted body (attempt ' + attempts + ', ok=' + ok + ')');
        // Verify a moment later in case Gmail's URL-driven body fill landed
        // after our paste and overwrote it. Re-paste if the formatted table
        // is no longer present. Try up to 3 times across ~3 seconds.
        let verifyTries = 0;
        const verifyInterval = setInterval(function () {
          verifyTries++;
          const stillTarget = findComposeBody();
          if (!stillTarget) return;
          if (looksLikeFormattedPaste(stillTarget)) {
            clearInterval(verifyInterval);
            if (typeof onSuccess === 'function') onSuccess();
            return;
          }
          if (verifyTries <= 6) {
            console.log('[ZHL PE Auto-paste] verify ' + verifyTries + ': formatted content missing — re-pasting');
            doPasteInto(stillTarget, html);
          } else {
            clearInterval(verifyInterval);
            console.warn('[ZHL PE Auto-paste] gave up after re-paste retries; clipboard fallback (Ctrl+V) still works');
            if (typeof onFail === 'function') onFail();
          }
        }, 500);
        return;
      }
      if (attempts > POLL_LIMIT) {
        clearInterval(interval);
        console.warn('[ZHL PE Auto-paste] gave up — compose body not found within ' + (POLL_LIMIT * POLL_MS / 1000) + ' s. Clipboard fallback still works (Ctrl+V).');
        if (typeof onFail === 'function') onFail();
      }
    }, POLL_MS);
  }

  let runningInThisTab = false;
  function checkAndPaste() {
    if (runningInThisTab) return; // dedupe within this tab
    try {
      chrome.storage.local.get([STORAGE_KEY], function (data) {
        const pending = data && data[STORAGE_KEY];
        if (!pending || !pending.html) return;
        const age = Date.now() - (pending.ts || 0);
        if (age > TTL_MS) {
          try { chrome.storage.local.remove([STORAGE_KEY]); } catch (_) {}
          console.log('[ZHL PE Auto-paste] pending paste expired (age=' + age + ' ms)');
          return;
        }
        // Mark in-flight in this tab BEFORE clearing storage so re-entry
        // from the URL-change watcher is a no-op. Only clear storage on
        // verified success — otherwise leave it for a retry / Ctrl+V.
        runningInThisTab = true;
        console.log('[ZHL PE Auto-paste] pending paste found (age=' + age + ' ms), running…');
        pasteIntoCompose(
          pending.html,
          function onOk() {
            try { chrome.storage.local.remove([STORAGE_KEY]); } catch (_) {}
            console.log('[ZHL PE Auto-paste] verified formatted body in compose — storage cleared');
          },
          function onFail() {
            // Leave storage in place so a manual reload of the compose tab
            // could still pick it up; the TTL will eventually expire it.
            runningInThisTab = false;
          }
        );
      });
    } catch (e) {
      console.warn('[ZHL PE Auto-paste] storage read failed:', e);
    }
  }

  // No URL gate. Gmail redirects the operator-side URL (strips view=cm,
  // adds /u/0/, etc.), so gating on view=cm was missing all real PE
  // submissions. The 30 s TTL + single-use clear keeps this safe.
  setTimeout(checkAndPaste, 300);

  // Re-check on SPA URL changes (e.g. user navigates from inbox to compose).
  let lastUrl = location.href;
  setInterval(function () {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(checkAndPaste, 300);
    }
  }, 500);
})();
