// ZHL Productivity Pack — Gmail VPA auto-paste
//
// Companion to sf-vpa-email.js. When the LO clicks "Send VPA Email" on a
// Salesforce Lead / Contact page, the Salesforce-side handler stashes the
// formatted HTML body in chrome.storage.local under zhlVpaPendingPaste
// (TTL 60 s). This script runs on the Gmail tab, sees the pending entry,
// finds Gmail's contenteditable compose body, and replaces the plain-
// text content that the compose URL filled in with the formatted HTML —
// so the LO sees the same nicely-formatted VPA email the original
// SFGmail extension produced, without having to Ctrl+V.
//
// Mirrors gmail-pe-paste.js exactly; only the storage key and the
// "looks like our paste" fingerprint differ.
(function () {
  'use strict';

  const __ZHL_FEATURE_KEY = 'feature_sfVpaEmail';

  function run() {
    console.log('[ZHL VPA Auto-paste] loaded on', location.href);

    const STORAGE_KEY = 'zhlVpaPendingPaste';
    const TTL_MS      = 10 * 60 * 1000;   // 10 min — was 60s, too tight if Gmail loaded slowly
    const POLL_MS     = 100;
    const POLL_LIMIT  = 300;              // ~30 s polling for the compose body (was 20s)

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

    // VPA "looks-like-our-paste" fingerprint. The HTML always contains an
    // <h1> with "Congratulations" and a "What's Next?" span. Both must be
    // present for the paste to be considered intact. Gmail may serialize
    // the apostrophe as either &#39; or the raw ' depending on the path.
    function looksLikeFormattedPaste(target) {
      try {
        if (!target) return false;
        const html = target.innerHTML || '';
        const hasCongrats   = html.indexOf('Congratulations') >= 0;
        const hasWhatsNext  = html.indexOf("What's Next") >= 0
                           || html.indexOf("What&#39;s Next") >= 0
                           || html.indexOf('What&apos;s Next') >= 0;
        return hasCongrats && hasWhatsNext;
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
          console.log('[ZHL VPA Auto-paste] pasted formatted body (attempt ' + attempts + ', ok=' + ok + ')');
          // Verify a moment later in case Gmail's URL-driven body fill landed
          // after our paste and overwrote it. Re-paste if the formatted body
          // is no longer present. Try up to 6 times across ~3 seconds.
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
              console.log('[ZHL VPA Auto-paste] verify ' + verifyTries + ': formatted content missing — re-pasting');
              doPasteInto(stillTarget, html);
            } else {
              clearInterval(verifyInterval);
              console.warn('[ZHL VPA Auto-paste] gave up after re-paste retries; clipboard fallback (Ctrl+V) still works');
              if (typeof onFail === 'function') onFail();
            }
          }, 500);
          return;
        }
        if (attempts > POLL_LIMIT) {
          clearInterval(interval);
          console.warn('[ZHL VPA Auto-paste] gave up — compose body not found within ' + (POLL_LIMIT * POLL_MS / 1000) + ' s. Clipboard fallback still works (Ctrl+V).');
          if (typeof onFail === 'function') onFail();
        }
      }, POLL_MS);
    }

    function extensionContextValid() {
      try { return !!(chrome && chrome.runtime && chrome.runtime.id); }
      catch (_) { return false; }
    }

    let runningInThisTab = false;
    function checkAndPaste() {
      if (runningInThisTab) return;
      if (!extensionContextValid()) return;
      try {
        chrome.storage.local.get([STORAGE_KEY], function (data) {
          const pending = data && data[STORAGE_KEY];
          if (!pending || !pending.html) {
            console.log('[ZHL VPA Auto-paste] no pending paste in storage — plain-text URL fallback will be the final content');
            return;
          }
          const age = Date.now() - (pending.ts || 0);
          if (age > TTL_MS) {
            try { chrome.storage.local.remove([STORAGE_KEY]); } catch (_) {}
            console.warn('[ZHL VPA Auto-paste] pending paste EXPIRED (age=' + age + ' ms, TTL=' + TTL_MS + ' ms). LO will see the plain-text URL fallback. Clicking Send VPA Email again should restore the formatted draft.');
            return;
          }
          runningInThisTab = true;
          console.log('[ZHL VPA Auto-paste] pending paste found (age=' + age + ' ms, HTML length=' + (pending.html || '').length + ' bytes), running…');
          pasteIntoCompose(
            pending.html,
            function onOk() {
              try { chrome.storage.local.remove([STORAGE_KEY]); } catch (_) {}
              console.log('[ZHL VPA Auto-paste] verified formatted body in compose — storage cleared');
            },
            function onFail() {
              // Leave storage in place so a manual reload of the compose
              // tab could still pick it up; TTL will eventually expire.
              runningInThisTab = false;
            }
          );
        });
      } catch (e) {
        if (!extensionContextValid()) return;
        console.warn('[ZHL VPA Auto-paste] storage read failed:', e);
      }
    }

    setTimeout(checkAndPaste, 300);

    let lastUrl = location.href;
    const urlWatcher = setInterval(function () {
      if (!extensionContextValid()) { clearInterval(urlWatcher); return; }
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(checkAndPaste, 300);
      }
    }, 500);
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([__ZHL_FEATURE_KEY, 'zhl_kill_switch'], function (data) {
      if (data.zhl_kill_switch === true) return;
      if (data[__ZHL_FEATURE_KEY] === false) return;
      run();
    });
  } else {
    run();
  }
})();
