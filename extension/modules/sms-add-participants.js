// ZHL Productivity Pack module — feature key: feature_smsAddParticipants
// Wraps original module body in a chrome.storage.local feature-flag check.
// If the user disables this module on the setup page the body never runs.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_smsAddParticipants';
  function __zhlRunModule() {
(function () {
  'use strict';

  const BUTTON_CLASS = 'zhlap-add-button';
  const WRAPPER_CLASS = 'zhlap-buttons-wrapper';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[SMS Add Participants v' + VERSION + '] loaded in', location.href);

  // ---- Shadow-DOM-piercing helpers --------------------------------------
  // Lightning Web Components on lightning.force.com use real shadow DOM.
  // document.querySelector / TreeWalker on document.body don't see inside
  // shadow roots, so anything injected by an LWC (the SMS panel header,
  // the participant input, the record fields) is invisible without these.

  function deepQuerySelector(root, selector) {
    if (!root) return null;
    if (root.querySelector) {
      const direct = root.querySelector(selector);
      if (direct) return direct;
    }
    const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const el of all) {
      if (el.shadowRoot) {
        const result = deepQuerySelector(el.shadowRoot, selector);
        if (result) return result;
      }
    }
    return null;
  }

  function deepQuerySelectorAll(root, selector, out) {
    out = out || [];
    if (!root) return out;
    if (root.querySelectorAll) {
      root.querySelectorAll(selector).forEach((el) => out.push(el));
    }
    const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const el of all) {
      if (el.shadowRoot) deepQuerySelectorAll(el.shadowRoot, selector, out);
    }
    return out;
  }

  function deepWalkText(root, predicate) {
    if (!root) return null;
    if (root.nodeType !== undefined) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (predicate(node)) return node;
      }
    }
    const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const el of all) {
      if (el.shadowRoot) {
        const result = deepWalkText(el.shadowRoot, predicate);
        if (result) return result;
      }
    }
    return null;
  }

  // ---- Lead page detection ----------------------------------------------

  // Don't require finding a flexipage-record-home — the embedded SMS panel
  // can sit inside the Lead's right-column tabs and the page structure
  // varies. Trust the URL for "are we on a Lead?", then read the fields
  // from anywhere on the page.
  function isOnLeadPage() {
    let href = location.href || '';
    try {
      if (window.top && window.top.location && window.top.location.href) {
        href = window.top.location.href;
      }
    } catch (_) { /* cross-origin */ }
    return /\/lightning\/r\/Lead\//i.test(href);
  }

  function getCoBorrowerInfo() {
    const items = deepQuerySelectorAll(document, 'records-record-layout-item[field-label="Co-Borrower"]');
    for (const item of items) {
      if (item.offsetParent === null) continue;
      const link = deepQuerySelector(item, 'a[href*="/lightning/r/Contact/"]');
      if (!link) continue;
      const m = /\/lightning\/r\/Contact\/(\w+)\//.exec(link.getAttribute('href') || '');
      if (!m) continue;
      const name = (link.textContent || '').trim();
      return { contactId: m[1], name };
    }
    return null;
  }

  function getBuyersAgentInfo() {
    const labels = deepQuerySelectorAll(document, 'span.test-id__field-label, .test-id__field-label, [class*="field-label"]');
    for (const label of labels) {
      const text = (label.textContent || '').replace(/[’‘']/g, '').trim();
      if (!/^Buyers\s+Agent\s+Phone$/i.test(text)) continue;
      // closest() works within the same shadow root.
      const formElement = label.closest('.slds-form-element');
      if (!formElement) continue;
      if (formElement.offsetParent === null) continue;
      const phoneLink = deepQuerySelector(formElement, 'lightning-click-to-dial a, a[href^="javascript:"], a');
      if (!phoneLink) continue;
      const phoneText = (phoneLink.textContent || '').trim();
      const digits = phoneText.replace(/\D/g, '');
      if (digits.length >= 10) return { phone: digits, displayText: phoneText };
    }
    return null;
  }

  // ---- SMS panel detection ----------------------------------------------

  // Two-track panel detection. Track A: find the participant input by
  // placeholder (works whether the heading is in light DOM or shadow
  // DOM, since the input is the most distinctive element). Walk up
  // until an ancestor also contains the "New SMS Conversation" text.
  // Track B (fallback): keep the old text-first walk, in case the
  // input renders later than the heading.
  function findNewSmsPanel() {
    // Track A — input first.
    const inputs = deepQuerySelectorAll(document, 'input[placeholder*="phone or name" i]');
    for (const input of inputs) {
      if (input.offsetParent === null) continue;
      let cur = input.parentElement;
      for (let i = 0; i < 25 && cur; i++) {
        const text = (cur.textContent || '').slice(0, 4000);
        if (/New SMS Conversation/i.test(text)) {
          if (cur.offsetParent === null) break;
          return cur;
        }
        cur = cur.parentElement;
      }
    }
    // Track B — text first.
    const textNode = deepWalkText(document, (n) =>
      n.nodeValue && /New SMS Conversation/i.test(n.nodeValue)
    );
    if (!textNode) return null;
    let cur = textNode.parentElement;
    for (let i = 0; i < 25 && cur; i++) {
      const input = deepQuerySelector(cur, 'input[placeholder*="phone or name" i]');
      if (input) {
        if (cur.offsetParent === null) break;
        return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  function findSmsParticipantInput(panel) {
    return deepQuerySelector(panel, 'input[placeholder*="phone or name" i]');
  }

  // One-shot diagnostic so we can see exactly what the script can find.
  let diagDone = false;
  function dumpDiag() {
    if (diagDone) return;
    diagDone = true;
    try {
      const lightH3 = Array.from(document.querySelectorAll('h3'));
      const deepH3 = deepQuerySelectorAll(document, 'h3');
      const lightInputs = document.querySelectorAll('input[placeholder*="phone or name" i]').length;
      const deepInputs = deepQuerySelectorAll(document, 'input[placeholder*="phone or name" i]').length;
      const shadowHosts = Array.from(document.querySelectorAll('*')).filter((el) => el.shadowRoot).length;
      const innerTextHas = (document.body.innerText || '').includes('New SMS Conversation');
      const innerHTMLHas = (document.body.innerHTML || '').includes('New SMS Conversation');
      console.log('[SMS Add Participants DIAG]', {
        urlIsLead: /\/lightning\/r\/Lead\//i.test(location.href),
        lightH3Count: lightH3.length,
        deepH3Count: deepH3.length,
        lightH3Texts: lightH3.slice(0, 8).map((h) => (h.textContent || '').slice(0, 60)),
        deepH3Texts: deepH3.slice(0, 12).map((h) => (h.textContent || '').slice(0, 60)),
        lightParticipantInputs: lightInputs,
        deepParticipantInputs: deepInputs,
        openShadowHosts: shadowHosts,
        innerTextHasNewSMS: innerTextHas,
        innerHTMLHasNewSMS: innerHTMLHas
      });
    } catch (e) {
      console.warn('[SMS Add Participants DIAG] failed', e);
    }
  }

  // ---- Adding a participant programmatically ----------------------------

  function setNativeInputValue(input, value) {
    const proto = Object.getPrototypeOf(input);
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
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
        let v;
        try { v = predicate(); } catch (_) { v = null; }
        if (v) return resolve(v);
        if (Date.now() - start >= (timeoutMs || 5000)) return resolve(null);
        setTimeout(tick, intervalMs || 80);
      };
      tick();
    });
  }

  // Same shape as the Open SMS module's add-button finder: prefer a
  // class-based match, then fall back to label/aria heuristics.
  function findAddButton(panel) {
    const direct = panel.querySelector(
      'lightning-button-icon-stateful.add-button button, .add-button button'
    );
    if (direct && direct.offsetParent !== null && !direct.disabled) return direct;

    const buttons = Array.from(panel.querySelectorAll('button'));
    for (const b of buttons) {
      if (b.offsetParent === null || b.disabled) continue;
      if (b.getAttribute('aria-haspopup') === 'true') continue;
      if (b.classList.contains('slds-input__icon')) continue;
      if (b.classList.contains('start-button')) continue;
      if (b.classList.contains('btn-whatsapp-pulse')) continue; // Start
      if (b.getAttribute('title') === 'Back') continue;
      if (b.classList.contains('slds-button_icon-border')) return b;
    }
    for (const b of buttons) {
      if (b.offsetParent === null || b.disabled) continue;
      const label = (b.textContent || '').trim();
      const title = (b.getAttribute('title') || '').trim();
      const aria = (b.getAttribute('aria-label') || '').trim();
      if (label === '+' || title === '+' || /^add(\s+participant)?$/i.test(aria) || /^add$/i.test(title)) return b;
    }
    return null;
  }

  async function addParticipant(panel, phoneDigits) {
    const input = findSmsParticipantInput(panel);
    if (!input) return false;
    input.focus();
    setNativeInputValue(input, phoneDigits);
    await new Promise((r) => setTimeout(r, 400));
    const addBtn = await waitFor(() => findAddButton(panel), 5000);
    if (!addBtn) {
      console.warn('[SMS Add Participants] + button not found after typing');
      return false;
    }
    realClick(addBtn);
    return true;
  }

  // ---- Co-Borrower phone lookup via background worker -------------------

  function fetchContactPhone(contactId) {
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.runtime || !chrome.runtime.id) {
          resolve(null);
          return;
        }
        chrome.runtime.sendMessage({ type: 'GET_CONTACT_PHONE', contactId }, (resp) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          if (!resp || !resp.ok) { resolve(null); return; }
          const phone = resp.mobilePhone || resp.phone;
          if (!phone) { resolve(null); return; }
          resolve(String(phone).replace(/\D/g, ''));
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  // ---- Button injection -------------------------------------------------

  // Inline styles so the buttons render correctly even when injected into
  // an LWC shadow root (where our content_scripts CSS file doesn't apply).
  const BTN_STYLE_BASE =
    'display: inline-flex;' +
    'align-items: center;' +
    'padding: 4px 12px;' +
    'margin: 2px;' +
    'font-size: 12px;' +
    'line-height: 16px;' +
    'font-weight: 600;' +
    'color: #ffffff;' +
    'background-color: #1589ee;' +
    'border: 1px solid #0070d2;' +
    'border-radius: 12px;' +
    'cursor: pointer;' +
    'font-family: inherit;' +
    'white-space: nowrap;';

  const WRAPPER_STYLE =
    'display: flex;' +
    'flex-wrap: wrap;' +
    'gap: 6px;' +
    'padding: 8px 12px;' +
    'width: 100%;' +
    'box-sizing: border-box;';

  function makeAddButton(label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BUTTON_CLASS;
    btn.textContent = label;
    btn.setAttribute('style', BTN_STYLE_BASE);
    btn.addEventListener('mouseenter', () => { btn.style.backgroundColor = '#0070d2'; });
    btn.addEventListener('mouseleave', () => { btn.style.backgroundColor = '#1589ee'; });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(btn);
    });
    return btn;
  }

  function injectButtons(panel, leadCtx) {
    const input = findSmsParticipantInput(panel);
    if (!input) return;

    // Already injected anywhere in this panel? skip.
    if (deepQuerySelector(panel, '.' + WRAPPER_CLASS)) return;

    const wrapper = document.createElement('div');
    wrapper.className = WRAPPER_CLASS;
    wrapper.setAttribute('style', WRAPPER_STYLE);

    if (leadCtx.buyersAgent) {
      const phone = leadCtx.buyersAgent.phone;
      const display = leadCtx.buyersAgent.displayText;
      const btn = makeAddButton(`Add Buyer’s Agent (${display})`, async (b) => {
        const orig = b.textContent;
        b.disabled = true;
        b.textContent = 'Adding…';
        const ok = await addParticipant(panel, phone);
        b.textContent = orig;
        b.disabled = false;
        if (!ok) alert('Could not add Buyer’s Agent — see console for details.');
      });
      wrapper.appendChild(btn);
    }

    if (leadCtx.coBorrower) {
      const id = leadCtx.coBorrower.contactId;
      const name = leadCtx.coBorrower.name;
      const btn = makeAddButton(`Add Co-Borrower (${name})`, async (b) => {
        const orig = b.textContent;
        b.disabled = true;
        b.textContent = 'Looking up phone…';
        const phone = await fetchContactPhone(id);
        if (!phone) {
          b.textContent = orig;
          b.disabled = false;
          alert('Could not find a phone number for the Co-Borrower in Salesforce.');
          return;
        }
        b.textContent = 'Adding…';
        const ok = await addParticipant(panel, phone);
        b.textContent = orig;
        b.disabled = false;
        if (!ok) alert('Could not add Co-Borrower — see console for details.');
      });
      wrapper.appendChild(btn);
    }

    if (!wrapper.firstChild) return;

    // Insertion strategy: prefer the input's containing div so the buttons
    // sit immediately under the search input. Fall back to the panel's
    // container if needed.
    const inputContainer = input.closest('lightning-layout-item') || input.parentElement;
    if (inputContainer && inputContainer.parentElement) {
      inputContainer.insertAdjacentElement('afterend', wrapper);
    } else {
      panel.appendChild(wrapper);
    }
  }

  function pruneButtons() {
    deepQuerySelectorAll(document, '.' + WRAPPER_CLASS).forEach((w) => w.remove());
  }

  // ---- Scan loop --------------------------------------------------------

  let lastDebug = '';
  function debugOnce(msg) {
    if (msg === lastDebug) return;
    lastDebug = msg;
    console.log('[SMS Add Participants]', msg);
  }

  let scanCount = 0;
  function scan() {
    scanCount++;
    // After ~3 seconds of failing to find the panel, dump the diagnostic
    // once so we can see what's actually visible to the script.
    if (scanCount > 15 && !diagDone) dumpDiag();

    const panel = findNewSmsPanel();
    if (!panel) {
      pruneButtons();
      debugOnce('No "New SMS Conversation" panel visible right now (this log will print again only when the state changes).');
      return;
    }
    if (!isOnLeadPage()) {
      pruneButtons();
      debugOnce('SMS panel found but not on a Lead URL — current URL: ' + (location.href || ''));
      return;
    }
    const ctx = {
      coBorrower: getCoBorrowerInfo(),
      buyersAgent: getBuyersAgentInfo()
    };
    if (!ctx.coBorrower && !ctx.buyersAgent) {
      pruneButtons();
      debugOnce('SMS panel found, on Lead URL, but neither Co-Borrower link nor Buyer’s Agent Phone found in the DOM yet.');
      return;
    }
    debugOnce('Injecting buttons. coBorrower=' + (ctx.coBorrower ? ctx.coBorrower.name : 'none') +
      ', buyersAgent=' + (ctx.buyersAgent ? ctx.buyersAgent.displayText : 'none'));
    injectButtons(panel, ctx);
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      try { scan(); } catch (e) { console.error('[SMS Add Participants] scan error', e); }
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  schedule();
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
