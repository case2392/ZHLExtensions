// ZHL Productivity Pack — Credit Report Reader
//
// Runs on https://www.zillowdocs.com/embed/editor* (the page LOP
// opens in a new tab when the LO clicks the Hard or Soft credit
// score on the right rail). Finds the "CoreLogic-XXXXXXX" reference
// ID at the top of the report, posts it to the extension's
// background script, which stores it for the Copy LOP file feature
// to pick up — then closes this tab automatically.
//
// ARMED-FLAG GATE: we only run when the Copy LOP file feature
// armed us via chrome.storage just before clicking Hard/Soft. That
// way, when the user opens a credit report MANUALLY (outside our
// Stage flow), this script stands down and never closes their tab.
// Without this gate v1.31.0/.1 was eating every credit-report tab
// the user opened.
//
// The report sometimes renders the ID asynchronously, so we poll
// for up to ~30 seconds before giving up and leaving the user to
// copy the ID manually.
(function () {
  'use strict';

  console.log('[ZHL Credit Reader] loaded on', location.href);

  // Bail unless we were armed within the last 60 seconds by the
  // Copy LOP file Stage flow.
  const ARM_WINDOW_MS = 60 * 1000;
  chrome.storage.local.get(['zhlCreditCaptureArmed'], function (data) {
    const armed = data && data.zhlCreditCaptureArmed;
    const age = armed && armed.armedAt ? Date.now() - armed.armedAt : Infinity;
    if (!armed || age > ARM_WINDOW_MS) {
      console.log('[ZHL Credit Reader] Not armed (user opened this manually). Standing down.');
      return;
    }
    // Clear the flag immediately so a second tab opened by the
    // user within the window doesn't also get auto-closed.
    try { chrome.storage.local.remove(['zhlCreditCaptureArmed']); } catch (_) {}
    console.log('[ZHL Credit Reader] Armed by Copy LOP Stage flow (age ' + age + 'ms). Starting capture.');
    startCapture();
  });


  function startCapture() {
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
  }  // end startCapture
})();
