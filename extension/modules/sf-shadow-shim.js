// ZHL Productivity Pack — Salesforce shadow-DOM shim
//
// Runs in the page's MAIN world at document_start. Patches
// Element.prototype.attachShadow so every shadow root that any
// component creates afterwards is mode:"open" rather than the
// mode:"closed" that Salesforce's Lightning Web Components default to.
// Without this shim, document.querySelectorAll never sees into the
// global search input, the disposition modal's PA Notes textarea, the
// Save button, etc. — they're all inside closed shadow roots.
//
// Safety: open shadow DOM is functionally equivalent to closed for the
// component's own code (this.shadowRoot still works). The only thing
// open mode changes is that external code can read .shadowRoot — which
// is exactly what we want for our other content scripts.
//
// This script must run BEFORE any LWC components mount, otherwise their
// pre-existing closed roots stay closed. Hence run_at: "document_start"
// and world: "MAIN" in the manifest.
(function () {
  'use strict';
  try {
    const orig = Element.prototype.attachShadow;
    if (!orig || orig.__zhlPatched) return;
    function patched(init) {
      const safeInit = Object.assign({}, init, { mode: 'open' });
      return orig.call(this, safeInit);
    }
    patched.__zhlPatched = true;
    Element.prototype.attachShadow = patched;
    // Pin a marker so the paster module can confirm the shim is live.
    try { window.__zhlShadowShimInstalled = true; } catch (_) {}
  } catch (e) {
    // Don't break the page if anything goes wrong — just leave the
    // shadow DOM closed and let the paster fall back to keyboard
    // shortcuts or fail gracefully.
    try { console.warn('[ZHL Shadow Shim] install failed', e); } catch (_) {}
  }
})();
