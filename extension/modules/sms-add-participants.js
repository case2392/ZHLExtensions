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
    const items = document.querySelectorAll('records-record-layout-item[field-label="Co-Borrower"]');
    for (const item of items) {
      if (item.offsetParent === null) continue;
      const link = item.querySelector('a[href*="/lightning/r/Contact/"]');
      if (!link) continue;
      const m = /\/lightning\/r\/Contact\/(\w+)\//.exec(link.getAttribute('href') || '');
      if (!m) continue;
      const name = (link.textContent || '').trim();
      return { contactId: m[1], name };
    }
    return null;
  }

  function getBuyersAgentInfo() {
    const labels = document.querySelectorAll('span.test-id__field-label, .test-id__field-label, [class*="field-label"]');
    for (const label of labels) {
      const text = (label.textContent || '').replace(/[’‘']/g, '').trim();
      if (!/^Buyers\s+Agent\s+Phone$/i.test(text)) continue;
      const formElement = label.closest('.slds-form-element');
      if (!formElement) continue;
      if (formElement.offsetParent === null) continue;
      const phoneLink = formElement.querySelector('lightning-click-to-dial a, a[href^="javascript:"], a');
      if (!phoneLink) continue;
      const phoneText = (phoneLink.textContent || '').trim();
      const digits = phoneText.replace(/\D/g, '');
      if (digits.length >= 10) return { phone: digits, displayText: phoneText };
    }
    return null;
  }

  // ---- SMS panel detection ----------------------------------------------

  // Find the New SMS Conversation panel by walking text nodes for the
  // string "New SMS Conversation", then climbing the parent chain until
  // we land on an ancestor that also contains the participant search
  // input. Element-name agnostic — works on the utility-bar version,
  // the right-column embedded version, and anything else with the same
  // header text.
  function findNewSmsPanel() {
    const walker = document.createTreeWalker(
      document.body || document.documentElement,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
          if (!/New SMS Conversation/i.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    while (walker.nextNode()) {
      const node = walker.currentNode;
      let cur = node.parentElement;
      for (let i = 0; i < 25 && cur; i++) {
        const input = cur.querySelector && cur.querySelector('input[placeholder*="phone or name" i]');
        if (input) {
          if (cur.offsetParent === null) break;
          return cur;
        }
        cur = cur.parentElement;
      }
    }
    return null;
  }

  function findSmsParticipantInput(panel) {
    return panel.querySelector('input[placeholder*="phone or name" i]');
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

  function makeAddButton(label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BUTTON_CLASS;
    btn.textContent = label;
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
    if (panel.querySelector('.' + WRAPPER_CLASS)) return;

    const wrapper = document.createElement('div');
    wrapper.className = WRAPPER_CLASS;

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
    document.querySelectorAll('.' + WRAPPER_CLASS).forEach((w) => w.remove());
  }

  // ---- Scan loop --------------------------------------------------------

  let lastDebug = '';
  function debugOnce(msg) {
    if (msg === lastDebug) return;
    lastDebug = msg;
    console.log('[SMS Add Participants]', msg);
  }

  function scan() {
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
