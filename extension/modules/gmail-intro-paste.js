// ZHL Productivity Pack — Gmail Intro auto-paste
//
// Companion to sf-intro-email.js. When the LO clicks "Send Intro
// Email" on a Salesforce Opportunity page, the SF-side handler stashes
// the formatted HTML body in chrome.storage.local under
// zhlIntroPendingPaste (TTL 10 min). This script runs on the Gmail tab,
// finds the contenteditable compose body, and replaces the plain-text
// content that the compose URL filled in with the formatted HTML.
//
// Mirrors gmail-vpa-paste.js exactly; only the storage key and the
// "looks like our paste" fingerprint differ.
(function () {
  'use strict';

  const __ZHL_FEATURE_KEY = 'feature_sfIntroEmail';

  function run() {
    console.log('[ZHL Intro Auto-paste] loaded on', location.href);

    const STORAGE_KEY = 'zhlIntroPendingPaste';
    const TTL_MS      = 10 * 60 * 1000;   // 10 min — was 60s, too tight if Gmail loaded slowly
    const POLL_MS     = 100;
    const POLL_LIMIT  = 300;              // ~30 s polling for the compose body (was 20s)

    function findComposeBody() {
      const all = document.querySelectorAll('div[contenteditable="true"]');
      for (const el of all) {
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        if (aria.indexOf('message body') >= 0 ||
            aria === 'body' ||
            aria.indexOf('email body') >= 0 ||
            aria.indexOf('compose body') >= 0) {
          return el;
        }
      }
      const gmailSpecific = document.querySelector(
        'div[g_editable="true"], div.editable[contenteditable="true"]'
      );
      if (gmailSpecific) return gmailSpecific;
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

    // Intro "looks-like-our-paste" fingerprint. The HTML always contains
    // "disclosures are signed" near the top plus the "Homeowners
    // insurance" section header. Both must be present for the paste to
    // be considered intact.
    function looksLikeFormattedPaste(target) {
      try {
        if (!target) return false;
        const html = target.innerHTML || '';
        // Body always contains these two phrases — match either possible
        // apostrophe encoding (raw, &#39;, &apos;) although neither phrase
        // currently includes one. Keep the second branch for future
        // template edits that introduce one.
        const hasDisclosures = html.indexOf('disclosures are signed') >= 0;
        const hasHOI = html.indexOf('Homeowners insurance') >= 0
                    || html.indexOf('homeowners insurance') >= 0;
        return hasDisclosures && hasHOI;
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
          console.log('[ZHL Intro Auto-paste] pasted formatted body (attempt ' + attempts + ', ok=' + ok + ')');
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
              console.log('[ZHL Intro Auto-paste] verify ' + verifyTries + ': formatted content missing — re-pasting');
              doPasteInto(stillTarget, html);
            } else {
              clearInterval(verifyInterval);
              console.warn('[ZHL Intro Auto-paste] gave up after re-paste retries; clipboard fallback (Ctrl+V) still works');
              if (typeof onFail === 'function') onFail();
            }
          }, 500);
          return;
        }
        if (attempts > POLL_LIMIT) {
          clearInterval(interval);
          console.warn('[ZHL Intro Auto-paste] gave up — compose body not found within ' + (POLL_LIMIT * POLL_MS / 1000) + ' s.');
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
            console.log('[ZHL Intro Auto-paste] no pending paste in storage — plain-text URL fallback will be the final content');
            return;
          }
          const age = Date.now() - (pending.ts || 0);
          if (age > TTL_MS) {
            try { chrome.storage.local.remove([STORAGE_KEY]); } catch (_) {}
            console.warn('[ZHL Intro Auto-paste] pending paste EXPIRED (age=' + age + ' ms, TTL=' + TTL_MS + ' ms). LO will see the plain-text URL fallback. Clicking Send Intro Email again should restore the formatted draft.');
            return;
          }
          runningInThisTab = true;
          console.log('[ZHL Intro Auto-paste] pending paste found (age=' + age + ' ms, HTML length=' + (pending.html || '').length + ' bytes), running…');
          pasteIntoCompose(
            pending.html,
            function onOk() {
              try { chrome.storage.local.remove([STORAGE_KEY]); } catch (_) {}
              console.log('[ZHL Intro Auto-paste] verified formatted body — storage cleared');
            },
            function onFail() {
              runningInThisTab = false;
            }
          );
        });
      } catch (e) {
        if (!extensionContextValid()) return;
        console.warn('[ZHL Intro Auto-paste] storage read failed:', e);
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
