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

  // ---- Lead page detection ----------------------------------------------

  // The active Lead record container is the visible flexipage-record-home
  // whose own highlights panel icon is standard:lead.
  function findActiveLead() {
    const candidates = document.querySelectorAll(
      'flexipage-record-home, [data-aura-class*="forceRecordLayout"]'
    );
    for (const c of candidates) {
      if (c.offsetParent === null) continue;
      const r = c.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const icon = c.querySelector('records-highlights2 lightning-icon[icon-name="standard:lead"]');
      if (icon) return c;
    }
    return null;
  }

  // Co-Borrower is a related-record lookup — the phone isn't on the Lead
  // page, but the link to the Contact is. Pull the Contact id; the phone
  // gets fetched on demand via the background worker.
  function getCoBorrowerInfo(leadContainer) {
    const items = leadContainer.querySelectorAll('records-record-layout-item');
    for (const item of items) {
      const label = item.getAttribute('field-label') || '';
      if (label !== 'Co-Borrower') continue;
      const link = item.querySelector('a[href*="/lightning/r/Contact/"]');
      if (!link) return null;
      const m = /\/lightning\/r\/Contact\/(\w+)\//.exec(link.getAttribute('href') || '');
      if (!m) return null;
      const name = (link.textContent || '').trim();
      return { contactId: m[1], name };
    }
    return null;
  }

  // Buyer's Agent Phone IS rendered on the Lead page as plain text.
  function getBuyersAgentInfo(leadContainer) {
    const labels = leadContainer.querySelectorAll('span.test-id__field-label, .test-id__field-label');
    for (const label of labels) {
      const text = (label.textContent || '').replace(/[’']/g, "").trim();
      if (!/^Buyers\s+Agent\s+Phone$/i.test(text)) continue;
      const formElement = label.closest('.slds-form-element');
      if (!formElement) continue;
      const phoneLink = formElement.querySelector('lightning-click-to-dial a, a[href^="javascript:"], a');
      if (!phoneLink) continue;
      const phoneText = (phoneLink.textContent || '').trim();
      const digits = phoneText.replace(/\D/g, '');
      if (digits.length >= 10) return { phone: digits, displayText: phoneText };
    }
    return null;
  }

  // ---- SMS panel detection ----------------------------------------------

  // The Salesforce Messaging utility renders the New SMS view inside a
  // c-slds-sms-container with a header reading "New SMS Conversation".
  function findNewSmsPanel() {
    const containers = document.querySelectorAll('c-slds-sms-container');
    for (const c of containers) {
      if (c.offsetParent === null) continue;
      const headers = c.querySelectorAll('h3');
      for (const h of headers) {
        if (/New SMS Conversation/i.test(h.textContent || '')) return c;
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

    // Insert as a sibling layout-item right after the search input. If we
    // can't find a layout-item ancestor (different Salesforce versions),
    // fall back to inserting after the input's closest div.
    const layoutItem = input.closest('lightning-layout-item') || input.closest('div');
    if (!layoutItem || !layoutItem.parentElement) return;
    if (layoutItem.parentElement.querySelector(':scope > .' + WRAPPER_CLASS)) return;

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
    layoutItem.insertAdjacentElement('afterend', wrapper);
  }

  function pruneButtons() {
    document.querySelectorAll('.' + WRAPPER_CLASS).forEach((w) => w.remove());
  }

  // ---- Scan loop --------------------------------------------------------

  function scan() {
    const panel = findNewSmsPanel();
    if (!panel) { pruneButtons(); return; }
    const lead = findActiveLead();
    if (!lead) { pruneButtons(); return; }
    const ctx = {
      coBorrower: getCoBorrowerInfo(lead),
      buyersAgent: getBuyersAgentInfo(lead)
    };
    if (!ctx.coBorrower && !ctx.buyersAgent) { pruneButtons(); return; }
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
