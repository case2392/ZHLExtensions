// ZHL Productivity Pack — Gmail PE auto-paste
//
// Companion to pricing-exception-workflow.js. When the LO clicks
// "Open in Gmail + copy body" on operator.zillowhomeloans.com, the
// operator-side handler stashes the formatted HTML email body in
// chrome.storage.local under zhlPePendingPaste, then opens a new
// Gmail compose URL. This script runs on the Gmail tab, detects the
// pending paste (within a 30 s TTL), finds Gmail's contenteditable
// body element, and replaces its content with the HTML — so the LO
// sees the nicely-formatted version (table + bold headers + clickable
// LOP link) without having to manually Ctrl+V.
//
// Single-use: storage is cleared before the paste fires so a second
// Gmail tab can't accidentally pick up the same payload.
(function () {
  'use strict';

  const STORAGE_KEY = 'zhlPePendingPaste';
  const TTL_MS      = 30 * 1000;

  function findComposeBody() {
    // Gmail's compose body is a div[contenteditable=true] with an
    // aria-label like "Message Body". Several other contenteditable
    // fields exist on the page (subject, recipients chip input) — we
    // pick the one whose aria-label calls out body / message.
    const all = document.querySelectorAll('div[contenteditable="true"]');
    for (const el of all) {
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      if (aria.indexOf('message body') >= 0 || aria === 'body') return el;
    }
    // Fallback: any contenteditable inside the compose dialog that is
    // larger than the recipients/subject inputs.
    const compose = document.querySelector('div[role="dialog"][aria-label*="ompose" i]');
    if (compose) {
      const eds = compose.querySelectorAll('div[contenteditable="true"]');
      for (const el of eds) {
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        if (aria.indexOf('body') >= 0) return el;
      }
    }
    return null;
  }

  function pasteIntoCompose(html) {
    let attempts = 0;
    const interval = setInterval(function () {
      attempts++;
      const target = findComposeBody();
      if (target) {
        clearInterval(interval);
        try {
          target.innerHTML = html;
          // Notify Gmail's editor so it picks up the change and re-renders
          // the From/Send button states (otherwise Send might stay disabled).
          target.dispatchEvent(new InputEvent('input',  { bubbles: true, cancelable: true, inputType: 'insertFromPaste' }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          target.focus();
          // Move the caret to the end so the user can keep typing after
          // the HTML block if they want to add a personal note.
          try {
            const range = document.createRange();
            range.selectNodeContents(target);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          } catch (_) {}
          console.log('[ZHL PE Auto-paste] pasted formatted body into Gmail compose');
        } catch (e) {
          console.warn('[ZHL PE Auto-paste] paste failed:', e);
        }
        return;
      }
      if (attempts > 80) { // ~8 s
        clearInterval(interval);
        console.warn('[ZHL PE Auto-paste] Gave up — compose body not found within 8 s.');
      }
    }, 100);
  }

  function checkAndPaste() {
    try {
      chrome.storage.local.get([STORAGE_KEY], function (data) {
        const pending = data && data[STORAGE_KEY];
        if (!pending || !pending.html) return;
        const age = Date.now() - (pending.ts || 0);
        if (age > TTL_MS) {
          try { chrome.storage.local.remove([STORAGE_KEY]); } catch (_) {}
          return;
        }
        // Clear first to prevent multi-tab races
        chrome.storage.local.remove([STORAGE_KEY], function () {
          pasteIntoCompose(pending.html);
        });
      });
    } catch (e) {
      console.warn('[ZHL PE Auto-paste] storage read failed:', e);
    }
  }

  function isComposeUrl() {
    const href = location.href || '';
    return /[?&]view=cm\b/.test(href) || /[?&]compose=/.test(href);
  }

  // On initial load, if this looks like a compose URL, queue the paste.
  if (isComposeUrl()) {
    setTimeout(checkAndPaste, 300);
  }

  // Re-trigger on subsequent URL changes (Gmail SPA navigations).
  let lastUrl = location.href;
  setInterval(function () {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isComposeUrl()) setTimeout(checkAndPaste, 300);
    }
  }, 500);
})();
