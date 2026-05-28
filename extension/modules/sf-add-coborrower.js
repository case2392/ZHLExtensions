// ZHL Productivity Pack module — feature key: feature_coborrowerToSf
//
// Salesforce side of the "Add Co-Borrower to Salesforce" flow. Listens
// for a ZHL_SF_ADD_COBORROWER message (relayed by the background worker
// from the LOP Full Application page), verifies the open Lead matches
// the primary borrower, then opens New Contact and fills First name,
// Last name, Phone, Email, and Role = Co-Borrower. Company auto-fills
// from first/last. We stop there — the LO reviews and clicks Next/Save.
//
// Runs on Salesforce Lightning. SF nests everything in shadow DOM, but
// inject-open-shadow.js forces all roots open at document_start so the
// deep-query helpers below can traverse them.

(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_coborrowerToSf';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[ZHL SF Add Co-borrower v' + VERSION + '] loaded');

  // ---- deep shadow-DOM helpers (same recipe as sms-add-participants) ----
  function deepQuerySelector(root, selector) {
    if (!root) return null;
    if (root.querySelector) {
      const direct = root.querySelector(selector);
      if (direct) return direct;
    }
    const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const el of all) {
      if (el.shadowRoot) {
        const r = deepQuerySelector(el.shadowRoot, selector);
        if (r) return r;
      }
    }
    return null;
  }
  function deepQuerySelectorAll(root, selector, out) {
    out = out || [];
    if (!root) return out;
    if (root.querySelectorAll) root.querySelectorAll(selector).forEach((el) => out.push(el));
    const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const el of all) { if (el.shadowRoot) deepQuerySelectorAll(el.shadowRoot, selector, out); }
    return out;
  }

  function setNativeInputValue(input, value) {
    const proto = Object.getPrototypeOf(input);
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function setNativeSelectValue(sel, value) {
    const proto = Object.getPrototypeOf(sel);
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(sel, value);
    else sel.value = value;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function realClick(el) {
    try {
      const opts = { bubbles: true, cancelable: true, composed: true, view: window };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
    } catch (_) {}
    try { el.click(); } catch (_) {}
  }
  function waitFor(predicate, timeoutMs, intervalMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        let v; try { v = predicate(); } catch (_) { v = null; }
        if (v) return resolve(v);
        if (Date.now() - start >= (timeoutMs || 5000)) return resolve(null);
        setTimeout(tick, intervalMs || 80);
      };
      tick();
    });
  }
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

  // ---- Lead-match check -------------------------------------------------
  // Confirm the open Lead is the borrower we expect before touching the
  // form. We require BOTH the first and last name of the primary
  // borrower to appear in the page's lead-header region. Loose on
  // formatting (case, middle names) but strict enough that we won't
  // fill the wrong lead.
  function leadMatches(primaryName) {
    const target = norm(primaryName);
    if (!target) return false;
    const parts = target.split(' ').filter(Boolean);
    if (parts.length < 2) return false;
    const first = parts[0], last = parts[parts.length - 1];
    const hit = function (s) {
      const txt = norm(s);
      return txt && txt.indexOf(first) !== -1 && txt.indexOf(last) !== -1;
    };
    // 1. VISIBLE record header / highlights (the active console tab).
    //    A Lightning console keeps inactive lead tabs mounted but
    //    hidden, so scope to visible nodes to match the ACTIVE lead.
    const headers = deepQuerySelectorAll(document,
      'records-highlights2, records-highlights-details-item, lightning-formatted-text, ' +
      'h1, .slds-page-header, .slds-page-header__title, .entityNameTitle, .uiOutputText');
    for (const el of headers) {
      if (!isVisible(el)) continue;
      if (hit(el.textContent)) return true;
    }
    // 2. The active console workspace tab title ("<Name> | Lead").
    const tabs = deepQuerySelectorAll(document,
      '[role="tab"][aria-selected="true"], lightning-tab-bar a[title], a.tabHeader, [data-tab-name]');
    for (const el of tabs) {
      if (!isVisible(el)) continue;
      const title = (el.getAttribute && (el.getAttribute('title') || el.getAttribute('data-tab-name'))) || el.textContent;
      if (hit(title)) return true;
    }
    // 3. document.title fallback ("<Name> | Lead | Salesforce").
    if (hit(document.title)) return true;
    return false;
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.offsetParent !== null) return true; // fast path
    // offsetParent is null for position:fixed and some shadow hosts even
    // when visible — fall back to a box-size check.
    try {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (_) { return false; }
  }

  // ---- New Contact flow -------------------------------------------------
  function findNewContactButton() {
    // Prefer a VISIBLE button — in a console, hidden tabs keep their own
    // New Contact button mounted, and we must click the active one.
    const named = deepQuerySelectorAll(document, 'button[name="Lead.New_Contact"]');
    for (const b of named) { if (isVisible(b)) return b; }
    if (named.length) return named[0];
    const btns = deepQuerySelectorAll(document, 'button');
    for (const b of btns) {
      if (!isVisible(b)) continue;
      if (norm(b.textContent) === 'new contact') return b;
    }
    return null;
  }

  function findModalFirstName() {
    return deepQuerySelector(document, 'input[name="First_Name"]');
  }

  async function fillContactForm(co) {
    const firstInput = await waitFor(findModalFirstName, 8000);
    if (!firstInput) return { ok: false, reason: 'New Contact form did not open' };

    // First / Last by name.
    setNativeInputValue(firstInput, co.first || '');
    const lastInput = deepQuerySelector(document, 'input[name="Last_Name"]');
    if (lastInput) setNativeInputValue(lastInput, co.last || '');

    // Phone: the flowruntime-phone block's tel input (no stable name).
    if (co.cell) {
      const phoneWrap = deepQuerySelector(document, 'flowruntime-phone');
      const phoneInput = phoneWrap ? deepQuerySelector(phoneWrap, 'input') : null;
      if (phoneInput) setNativeInputValue(phoneInput, co.cell);
    }

    // Email: the flowruntime-email block's input.
    if (co.email) {
      const emailWrap = deepQuerySelector(document, 'flowruntime-email');
      const emailInput = emailWrap ? deepQuerySelector(emailWrap, 'input') : null;
      if (emailInput) setNativeInputValue(emailInput, co.email);
    }

    // Role → Co-Borrower (value "var_CoBorrower").
    const roleSelect = deepQuerySelector(document, 'select[name="ContactRole"]');
    if (roleSelect) {
      const opt = Array.prototype.find.call(roleSelect.options || [], function (o) {
        return o.value === 'var_CoBorrower' || norm(o.textContent) === 'co-borrower';
      });
      if (opt) setNativeSelectValue(roleSelect, opt.value);
    }

    // Company auto-fills off first/last — leave it. Re-poke last name's
    // input/change so the flow's auto-fill listener definitely fires.
    if (lastInput) {
      lastInput.dispatchEvent(new Event('input', { bubbles: true }));
      lastInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    return { ok: true };
  }

  async function handleAddCoborrower(payload) {
    const co = (payload && payload.coborrower) || {};
    const primaryName = (payload && payload.primaryName) || '';

    if (!leadMatches(primaryName)) {
      return { matched: false, ok: false, reason: 'This Salesforce tab is not ' + (primaryName || 'the borrower') };
    }

    const newBtn = findNewContactButton();
    if (!newBtn) return { matched: true, ok: false, reason: 'New Contact button not found on this lead' };

    // If the modal is already open (user clicked it), skip the click.
    if (!findModalFirstName()) {
      realClick(newBtn);
    }
    const result = await fillContactForm(co);
    return Object.assign({ matched: true }, result);
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'ZHL_SF_ADD_COBORROWER') return false;
    handleAddCoborrower(msg.payload).then(sendResponse).catch(function (e) {
      sendResponse({ matched: false, ok: false, reason: (e && e.message) || 'fill error' });
    });
    return true; // async response
  });
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
