// ZHL Productivity Pack — Credit Report Reader
//
// Runs on https://www.zillowdocs.com/embed/editor* (the page LOP
// opens in a new tab when the LO clicks the Hard or Soft credit
// score on the right rail). Finds the "CoreLogic-XXXXXXX" reference
// ID at the top of the report, posts it to the extension's
// background script, which stores it for the Copy LOP file feature
// to pick up — then closes this tab automatically.
//
// We're a small standalone script (no chrome.storage gate here)
// because the feature gate lives in the source LOP tab; if the
// LOP-side feature is disabled, the storage value just sits unread.
//
// The report sometimes renders the ID asynchronously, so we poll
// for up to ~30 seconds before giving up and leaving the user to
// copy the ID manually.
(function () {
  'use strict';

  console.log('[ZHL Credit Reader] loaded on', location.href);

  function findCoreLogicRefId() {
    // Walk all leaf elements looking for one whose text matches
    // "CoreLogic-DIGITS". The known DOM is
    //   <div class="sc-khsqcC fCVZyS">CoreLogic-117739784870000&nbsp;&nbsp;</div>
    // but class names are minified and rotate, so text matching is
    // the durable approach.
    const candidates = document.querySelectorAll('div, span, p, h1, h2, h3, h4, h5, h6');
    for (const el of candidates) {
      if (el.children.length) continue;  // leaves only — the parent's textContent would dup the match
      const txt = (el.textContent || '').replace(/ /g, ' ').trim();
      const m = /^CoreLogic-(\d+)\b/i.exec(txt);
      if (m) return m[1];
    }
    return null;
  }

  let attempts = 0;
  const MAX_ATTEMPTS = 60;  // 60 × 500ms = 30s
  const interval = setInterval(function () {
    attempts++;
    const refId = findCoreLogicRefId();
    if (refId) {
      clearInterval(interval);
      console.log('[ZHL Credit Reader] Found reference ID:', refId, '(attempt ' + attempts + ')');
      try {
        chrome.runtime.sendMessage({
          type: 'ZHL_CREDIT_REF_FOUND',
          refId: refId,
          url: location.href,
          capturedAt: Date.now()
        }, function (response) {
          console.log('[ZHL Credit Reader] Background ack:', response);
        });
      } catch (e) {
        console.warn('[ZHL Credit Reader] sendMessage failed:', e);
      }
    } else if (attempts >= MAX_ATTEMPTS) {
      clearInterval(interval);
      console.log('[ZHL Credit Reader] Gave up after', attempts, 'attempts; user will paste manually.');
    }
  }, 500);
})();
