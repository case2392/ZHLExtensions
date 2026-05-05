// Runs in the page's MAIN world at document_start so it can intercept
// Element.prototype.attachShadow BEFORE Salesforce's LWC bundle creates
// any components. Forces every shadow root the page creates to open
// mode, which lets the rest of the ZHL Productivity Pack's content
// scripts traverse them with el.shadowRoot.
//
// Notes:
// - Only runs in the page's world (set via manifest world:"MAIN"). It
//   does not have access to chrome.* APIs.
// - Idempotent — guarded by a window flag so it's safe if multiple
//   manifest entries try to install it.
// - Wrapped in try/catch so a thrown error here can never block
//   Salesforce from loading.

(function () {
  try {
    if (window.__zhlOpenShadowOverride) return;
    window.__zhlOpenShadowOverride = true;
    let shadowCount = 0;
    let firstLogged = false;
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      shadowCount++;
      if (!firstLogged) {
        firstLogged = true;
        console.log('[ZHL Open-Shadow] override active — first shadow root being created');
      }
      try {
        const newInit = init ? Object.assign({}, init, { mode: 'open' }) : { mode: 'open' };
        return orig.call(this, newInit);
      } catch (_) {
        return orig.call(this, init);
      }
    };
    // Expose a count getter so we can confirm in DevTools.
    window.__zhlShadowCount = function () { return shadowCount; };
    console.log('[ZHL Open-Shadow] override installed at document_start');
  } catch (_) { /* never block the page */ }
})();
