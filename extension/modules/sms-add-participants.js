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
  // We work on both Lead and Opportunity pages. URL detection is the same
  // pattern; the role-extraction code path differs (Lead reads record-layout-
  // item fields, Opportunity reads the Contact Roles related list).
  function getTopUrl() {
    let href = location.href || '';
    try {
      if (window.top && window.top.location && window.top.location.href) {
        href = window.top.location.href;
      }
    } catch (_) { /* cross-origin */ }
    return href;
  }
  function isOnLeadPage()        { return /\/lightning\/r\/Lead\//i.test(getTopUrl()); }
  function isOnOpportunityPage() { return /\/lightning\/r\/Opportunity\//i.test(getTopUrl()); }
  function isOnLeadOrOpportunityPage() { return isOnLeadPage() || isOnOpportunityPage(); }

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

  // 18-char Salesforce User id of the currently-logged-in user, captured
  // from chatter/users/me by the background worker. Null until the first
  // capture finishes (~10 s after extension load). Used by getLeadOwnerInfo
  // to suppress the "Add Loan Officer" button when the LO is opening their
  // own file — they'd just be adding themselves to the SMS thread.
  let currentSfUserId = null;
  function fetchCurrentSfUserId() {
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.id) return;
      chrome.runtime.sendMessage({ type: 'GET_CURRENT_SF_USER_ID' }, function (resp) {
        if (chrome.runtime.lastError) return;
        if (resp && resp.sfUserId) currentSfUserId = String(resp.sfUserId);
      });
    } catch (_) {}
  }
  // Kick off once at load, and retry after 5 s in case the background
  // identity capture hadn't completed on the first try.
  fetchCurrentSfUserId();
  setTimeout(fetchCurrentSfUserId, 5000);

  // Two Salesforce ids compare equal if their first 15 chars match
  // (case-insensitive) — the 18-char form just adds a case-sensitive
  // checksum suffix to the 15-char form.
  function sfIdsEqual(a, b) {
    if (!a || !b) return false;
    return String(a).slice(0, 15).toLowerCase() === String(b).slice(0, 15).toLowerCase();
  }

  // The LO assigned to the file is the Salesforce User who owns the Lead
  // — shown in the "Lead Owner" record field. Useful when an assistant is
  // texting on behalf of the LO and needs to add them to the thread.
  //
  // NOTE: Lead Owner is a standard Owner field, which Salesforce often
  // renders via force-owner-id-related-list-single / force-lookup-
  // display-with-preview INSTEAD of records-record-layout-item like
  // custom lookups (Buyer's Agent, Co-Borrower) use. So we try several
  // strategies in priority order before giving up.
  let leadOwnerDiagLogged = false;
  function diagOnce(msg, payload) {
    if (leadOwnerDiagLogged) return;
    leadOwnerDiagLogged = true;
    console.log('[SMS Add Participants] LO detect:', msg, payload || '');
  }
  function getLeadOwnerInfo() {
    let item = null;

    // 1. records-record-layout-item with field-label="Lead Owner"
    // Lead pages call it "Lead Owner"; Opportunity pages call it "Loan
    // Owner" (shown in the right-rail Loan Owner section). Both map to
    // the User who owns the record. We accept either label.
    let candidates = deepQuerySelectorAll(document, 'records-record-layout-item[field-label="Lead Owner"], records-record-layout-item[field-label="Loan Owner"]');
    for (const c of candidates) { if (c.offsetParent !== null) { item = c; break; } }

    // 2. Any element with field-label="Lead Owner", "Loan Owner", or "Owner"
    if (!item) {
      candidates = deepQuerySelectorAll(document, '[field-label="Lead Owner"], [field-label="Loan Owner"], [field-label="Owner"]');
      for (const c of candidates) { if (c.offsetParent !== null) { item = c; break; } }
    }

    // 3. Walk text nodes — find a label whose text is literally "Lead
    //    Owner" or "Loan Owner", then walk up to its row container.
    if (!item) {
      const labels = deepQuerySelectorAll(document, 'span, label');
      for (const label of labels) {
        const txt = normalizeLabel(label.textContent);
        if (!/^(Lead|Loan)\s*Owner$/i.test(txt)) continue;
        if (label.offsetParent === null) continue;
        let cur = label.parentElement;
        for (let i = 0; i < 8 && cur; i++) {
          const tag = (cur.tagName || '').toLowerCase();
          const cls = (cur.className && typeof cur.className === 'string') ? cur.className : '';
          if (tag === 'records-record-layout-item' ||
              tag === 'force-owner-id-related-list-single' ||
              /slds-form-element/.test(cls) ||
              /forceListViewManager/.test(cls)) {
            item = cur;
            break;
          }
          cur = cur.parentElement;
        }
        if (item) break;
      }
    }

    if (!item) {
      diagOnce('Lead Owner row not found via any selector');
      return null;
    }

    // Find any link that points at a User record. Salesforce uses several
    // href patterns depending on the component:
    //   /lightning/r/User/<id>/view
    //   /lightning/r/User/<id>
    //   /lightning/r/<id>           (where id starts with 005 = User)
    //   /one/one.app#/sObject/<id>
    let userLink =
      deepQuerySelector(item, 'a[href*="/lightning/r/User/"]') ||
      deepQuerySelector(item, 'a[data-refid*="recordId"]') ||
      deepQuerySelector(item, 'a[href*="/lightning/r/005"]');
    if (!userLink) {
      // Last resort: ANY anchor inside the row whose href contains an id
      // starting with 005 (Salesforce User id prefix).
      const anchors = deepQuerySelectorAll(item, 'a');
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        if (/\/005[A-Za-z0-9]{12,17}/.test(href)) { userLink = a; break; }
      }
    }
    if (!userLink) {
      diagOnce('Lead Owner row found but no User link inside', { itemHtml: (item.outerHTML || '').slice(0, 300) });
      return null;
    }

    const href = userLink.getAttribute('href') || '';
    let m = /\/lightning\/r\/User\/(\w+)/.exec(href);
    if (!m) m = /\/lightning\/r\/(005[A-Za-z0-9]{12,17})/.exec(href);
    if (!m) m = /\/(005[A-Za-z0-9]{12,17})/.exec(href);
    if (!m) {
      diagOnce('User link had no parseable id', { href: href });
      return null;
    }
    const ownerId = m[1];

    // Skip the button if the LO is opening their own file. They don't
    // need a button that adds themselves to the SMS thread.
    if (currentSfUserId && sfIdsEqual(currentSfUserId, ownerId)) {
      diagOnce('Lead Owner is current user — hiding LO button', { ownerId: ownerId, currentSfUserId: currentSfUserId });
      return null;
    }

    const name = (userLink.textContent || '').replace(/\s+/g, ' ').trim();
    return { userId: ownerId, name: name };
  }

  // Strip curly / straight apostrophes for label comparison.
  function normalizeLabel(s) {
    return (s || '').replace(/[’‘']/g, '').replace(/\s+/g, ' ').trim();
  }

  // ---- Opportunity Contact Roles extraction -----------------------------
  //
  // Opportunity pages don't have a "Co-Borrower" record-layout-item field
  // like Leads do. Instead, the right rail shows a "Contact Roles (N)"
  // related list where each row has a Contact name link + a Role value
  // (Borrower / Co-Borrower / Buyer's Agent / Listing Agent / etc.).
  //
  // Strategy: find every visible "Role" value text matching one of our
  // known roles, walk up to the enclosing row container, then capture
  // the nearest Contact link inside that container.
  function getOpportunityContactRoles() {
    const out = { borrower: null, coBorrower: null, buyersAgent: null };

    // Role-name -> output-field map. Each role is matched with its visible
    // text label (case-insensitive, apostrophes optional).
    const roleMap = [
      { rx: /^Borrower$/i,                                      slot: 'borrower'    },
      { rx: /^Co[\s-]?Borrower$/i,                              slot: 'coBorrower'  },
      { rx: /^Buyer[’'`]?s?\s*Agent$/i,                         slot: 'buyersAgent' }
    ];

    // First pass: walk every leaf text span / div on the page and look for
    // role text. For each hit, climb to the nearest container that ALSO
    // contains an /lightning/r/Contact/<id>/ anchor — that anchor is the
    // contact for this role row.
    const leaves = deepQuerySelectorAll(document, 'span, div, dt, dd, lightning-formatted-text');
    for (const el of leaves) {
      if (el.children && el.children.length > 0) continue; // leaf only
      const txt = normalizeLabel(el.textContent);
      if (!txt) continue;
      let match = null;
      for (const r of roleMap) { if (r.rx.test(txt)) { match = r; break; } }
      if (!match) continue;
      if (el.offsetParent === null) continue;
      // Skip already-filled slots (first match wins, which matches the
      // visual top-to-bottom order in the Contact Roles list).
      if (out[match.slot]) continue;

      // Climb 12 levels looking for an ancestor that contains a Contact
      // link. 12 is generous — Salesforce nests record cards 5-8 deep.
      let row = el.parentElement;
      let contactLink = null;
      for (let i = 0; i < 12 && row; i++) {
        contactLink = deepQuerySelector(row, 'a[href*="/lightning/r/Contact/"]');
        if (contactLink) break;
        row = row.parentElement;
      }
      if (!contactLink) continue;
      const href = contactLink.getAttribute('href') || '';
      const m = /\/lightning\/r\/Contact\/(\w+)/.exec(href);
      if (!m) continue;
      const name = (contactLink.textContent || '').replace(/\s+/g, ' ').trim();
      out[match.slot] = { contactId: m[1], name: name };
    }

    return out;
  }

  function getBuyersAgentInfo() {
    // Phone — read from the "Buyer's Agent Phone" field on the Lead.
    // Used as fallback if the Salesforce API lookup of the agent's
    // MobilePhone fails.
    let phone = null;
    let phoneDisplay = null;
    const labels = deepQuerySelectorAll(document, 'span.test-id__field-label, .test-id__field-label, [class*="field-label"]');
    for (const label of labels) {
      const text = normalizeLabel(label.textContent);
      if (!/^Buyers\s+Agent\s+Phone$/i.test(text)) continue;
      const formElement = label.closest('.slds-form-element');
      if (!formElement) continue;
      if (formElement.offsetParent === null) continue;
      const phoneLink = deepQuerySelector(formElement, 'lightning-click-to-dial a, a[href^="javascript:"], a');
      if (!phoneLink) continue;
      const phoneText = (phoneLink.textContent || '').trim();
      const digits = phoneText.replace(/\D/g, '');
      if (digits.length >= 10) {
        phone = digits;
        phoneDisplay = phoneText;
        break;
      }
    }

    // Name + Contact id — from the separate "Buyer's Agent" record-lookup
    // field. The Contact id lets us fetch the agent's MobilePhone via the
    // background Salesforce API call (the Lead page itself only exposes
    // Phone, not Mobile, for the agent).
    let name = null;
    let contactId = null;
    const items = deepQuerySelectorAll(document, 'records-record-layout-item');
    for (const item of items) {
      const label = normalizeLabel(item.getAttribute('field-label'));
      if (label !== 'Buyers Agent') continue;
      if (item.offsetParent === null) continue;
      const link = deepQuerySelector(item, 'a[href*="/lightning/r/Contact/"]');
      if (!link) continue;
      const m = /\/lightning\/r\/Contact\/(\w+)\//.exec(link.getAttribute('href') || '');
      if (m) contactId = m[1];
      const linkName = (link.textContent || '').trim();
      if (linkName) name = linkName;
      break;
    }

    if (!phone && !contactId) return null;
    return { phone, displayText: phoneDisplay, name, contactId };
  }

  // ---- SMS panel detection ----------------------------------------------

  // Two-track panel detection. Track A: find the participant input by
  // placeholder (works whether the heading is in light DOM or shadow
  // DOM, since the input is the most distinctive element). Walk up
  // until an ancestor also contains the "New SMS Conversation" text.
  // Track B (fallback): keep the old text-first walk, in case the
  // input renders later than the heading.
  function findNewSmsPanel() {
    // Track A — input first. Skip inputs inside a utility-bar panel; we
    // only want the right-column embedded SMS panel.
    const inputs = deepQuerySelectorAll(document, 'input[placeholder*="phone or name" i]');
    for (const input of inputs) {
      if (input.offsetParent === null) continue;
      if (input.closest && input.closest('.oneUtilityBarPanel, [class*="utilityBarPanel"], [class*="UtilityBarPanel"]')) continue;
      let cur = input.parentElement;
      for (let i = 0; i < 25 && cur; i++) {
        const text = (cur.textContent || '').slice(0, 4000);
        if (/New SMS Conversation/i.test(text)) return cur;
        cur = cur.parentElement;
      }
    }
    // Track B — text-walker fallback. Same utility-bar skip.
    const textNode = deepWalkText(document, (n) =>
      n.nodeValue && /New SMS Conversation/i.test(n.nodeValue)
    );
    if (!textNode) return null;
    if (textNode.parentElement && textNode.parentElement.closest &&
        textNode.parentElement.closest('.oneUtilityBarPanel, [class*="utilityBarPanel"], [class*="UtilityBarPanel"]')) {
      return null;
    }
    let cur = textNode.parentElement;
    for (let i = 0; i < 25 && cur; i++) {
      const input = deepQuerySelector(cur, 'input[placeholder*="phone or name" i]');
      if (input) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function findSmsParticipantInput(panel) {
    return deepQuerySelector(panel, 'input[placeholder*="phone or name" i]');
  }

  // One-shot diagnostic so we can see exactly what the script can find.
  let diagDone = false;
  function dumpDiag(label) {
    try {
      const lightH3 = Array.from(document.querySelectorAll('h3'));
      const deepH3 = deepQuerySelectorAll(document, 'h3');
      const lightInputs = Array.from(document.querySelectorAll('input[placeholder*="phone or name" i]'));
      const deepInputs = deepQuerySelectorAll(document, 'input[placeholder*="phone or name" i]');
      const shadowHosts = Array.from(document.querySelectorAll('*')).filter((el) => el.shadowRoot).length;
      const innerTextHas = (document.body && document.body.innerText || '').includes('New SMS Conversation');
      const innerHTMLHas = (document.body && document.body.innerHTML || '').includes('New SMS Conversation');
      const tag = '[SMS Add Participants DIAG ' + (label || 'auto') + ']';
      // One field per line — Chrome console doesn't truncate these.
      console.log(tag, 'urlIsLead =', /\/lightning\/r\/Lead\//i.test(location.href));
      console.log(tag, 'readyState =', document.readyState);
      console.log(tag, 'lightH3Count =', lightH3.length, '| deepH3Count =', deepH3.length);
      console.log(tag, 'lightParticipantInputs =', lightInputs.length, '| deepParticipantInputs =', deepInputs.length);
      console.log(tag, 'openShadowHosts =', shadowHosts);
      console.log(tag, 'innerText has "New SMS Conversation" =', innerTextHas);
      console.log(tag, 'innerHTML has "New SMS Conversation" =', innerHTMLHas);
      console.log(tag, 'all h3 texts (light) =', lightH3.map((h) => (h.textContent || '').trim().slice(0, 80)));
      console.log(tag, 'all h3 texts (deep)  =', deepH3.map((h) => (h.textContent || '').trim().slice(0, 80)));
      // If the input is reachable, also report whether walking up from
      // it can find an ancestor whose textContent contains "New SMS
      // Conversation". That tells us if Track A would have worked.
      if (deepInputs.length) {
        const inp = deepInputs[0];
        let cur = inp.parentElement;
        let foundAt = -1;
        for (let i = 0; i < 25 && cur; i++) {
          if (/New SMS Conversation/i.test(cur.textContent || '')) { foundAt = i; break; }
          cur = cur.parentElement;
        }
        console.log(tag, 'walk-up from input found "New SMS Conversation" at depth', foundAt,
          '| visible =', !!(cur && cur.offsetParent !== null));
      }
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

  // The + button appears in c-slds-start-thread (search results), a
  // sibling of the header where our "panel" lives. Walk up from the
  // panel to its enclosing c-slds-sms-container and scope the search
  // there so we don't accidentally click the + button from an unrelated
  // panel (e.g. one in the utility bar that's also showing results).
  function findSmsContainer(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      if (cur.localName === 'c-slds-sms-container') return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function findAddButton(panel) {
    const root = findSmsContainer(panel) || panel || document;
    const direct = deepQuerySelectorAll(
      root,
      'lightning-button-icon-stateful.add-button button, .add-button button'
    );
    for (const b of direct) {
      if (b.offsetParent === null || b.disabled) continue;
      return b;
    }
    const buttons = deepQuerySelectorAll(root, 'button');
    for (const b of buttons) {
      if (b.offsetParent === null || b.disabled) continue;
      if (b.getAttribute('aria-haspopup') === 'true') continue;
      if (b.classList.contains('slds-input__icon')) continue;
      if (b.classList.contains('start-button')) continue;
      if (b.classList.contains('btn-whatsapp-pulse')) continue;
      if (b.getAttribute('title') === 'Back') continue;
      const addSvg = b.querySelector && b.querySelector('svg[data-key="add"]');
      if (addSvg) return b;
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

  // Returns either a digits-only phone string, or an object
  // { error: "...", reloadNeeded?: true } so the caller can show a
  // specific reason. reloadNeeded is set when chrome.runtime is
  // dead — the user has to reload the page (Chrome only injects
  // content scripts at navigation time, so there's no in-page
  // recovery). Callers can format their own reload-prompt copy.
  function fetchContactPhone(contactId) {
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.runtime || !chrome.runtime.id) {
          resolve({ error: 'Page reload required to access Salesforce data.', reloadNeeded: true });
          return;
        }
        chrome.runtime.sendMessage({ type: 'GET_CONTACT_PHONE', contactId }, (resp) => {
          if (chrome.runtime.lastError) {
            const lemsg = chrome.runtime.lastError.message || '';
            if (/Extension context invalidated|message port closed|receiving end does not exist/i.test(lemsg)) {
              resolve({ error: 'Page reload required to access Salesforce data.', reloadNeeded: true });
              return;
            }
            resolve({ error: lemsg || 'Background worker unreachable' });
            return;
          }
          if (!resp) { resolve({ error: 'No response from background worker' }); return; }
          if (resp.error) { resolve({ error: resp.error }); return; }
          const phone = resp.mobilePhone || resp.phone;
          if (!phone) {
            resolve({ error: `Found ${resp.sobject || 'record'} "${resp.name || contactId}" but Phone and Mobile are both empty in Salesforce.` });
            return;
          }
          resolve(String(phone).replace(/\D/g, ''));
        });
      } catch (e) {
        const msg = String(e && e.message || e);
        if (/Extension context invalidated|message port closed|receiving end does not exist/i.test(msg)) {
          resolve({ error: 'Page reload required to access Salesforce data.', reloadNeeded: true });
          return;
        }
        resolve({ error: msg });
      }
    });
  }

  // Same shape as fetchContactPhone but queries the User object — used by
  // the Add Loan Officer button to look up the Lead Owner's mobile/phone.
  function fetchUserPhone(userId) {
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.runtime || !chrome.runtime.id) {
          resolve({ error: 'Page reload required to access Salesforce data.', reloadNeeded: true });
          return;
        }
        chrome.runtime.sendMessage({ type: 'GET_USER_PHONE', userId }, (resp) => {
          if (chrome.runtime.lastError) {
            const lemsg = chrome.runtime.lastError.message || '';
            if (/Extension context invalidated|message port closed|receiving end does not exist/i.test(lemsg)) {
              resolve({ error: 'Page reload required to access Salesforce data.', reloadNeeded: true });
              return;
            }
            resolve({ error: lemsg || 'Background worker unreachable' });
            return;
          }
          if (!resp) { resolve({ error: 'No response from background worker' }); return; }
          if (resp.error) { resolve({ error: resp.error }); return; }
          const phone = resp.mobilePhone || resp.phone;
          if (!phone) {
            resolve({ error: `Found user "${resp.name || userId}" but Phone and Mobile are both empty in Salesforce.` });
            return;
          }
          resolve(String(phone).replace(/\D/g, ''));
        });
      } catch (e) {
        const msg = String(e && e.message || e);
        if (/Extension context invalidated|message port closed|receiving end does not exist/i.test(msg)) {
          resolve({ error: 'Page reload required to access Salesforce data.', reloadNeeded: true });
          return;
        }
        resolve({ error: msg });
      }
    });
  }

  // ---- Hover-preview fallback -------------------------------------------
  //
  // When the API lookup fails (stale chrome.runtime, no phone in SF, no
  // matching record, etc.) we trigger Salesforce's own hover preview on
  // the name link so the LO can SEE the phone on the same screen. Falls
  // back to a manual "Open contact page" button in case the hover trigger
  // is rejected (Salesforce occasionally ignores synthetic mouseenter
  // unless the cursor's actually nearby).
  //
  // role: 'coBorrower' | 'buyersAgent' | 'loanOfficer'
  // Returns the link element it triggered (or null if none found).
  function findRecordLinkForRole(role) {
    // On Opportunity pages, Borrower / Co-Borrower / Buyer's Agent all live
    // inside the Contact Roles related list, not in record-layout-item
    // fields. We walk the same role-text-then-climb logic we use to extract
    // the IDs in the first place, and return the matching Contact link.
    if (isOnOpportunityPage() && (role === 'borrower' || role === 'coBorrower' || role === 'buyersAgent')) {
      const rx = role === 'borrower'     ? /^Borrower$/i
              : role === 'coBorrower'    ? /^Co[\s-]?Borrower$/i
              :                            /^Buyer[’'`]?s?\s*Agent$/i;
      const leaves = deepQuerySelectorAll(document, 'span, div, dt, dd, lightning-formatted-text');
      for (const el of leaves) {
        if (el.children && el.children.length > 0) continue;
        if (el.offsetParent === null) continue;
        if (!rx.test(normalizeLabel(el.textContent))) continue;
        let row = el.parentElement;
        for (let i = 0; i < 12 && row; i++) {
          const link = deepQuerySelector(row, 'a[href*="/lightning/r/Contact/"]');
          if (link) return link;
          row = row.parentElement;
        }
      }
      // fall through to Lead-style selectors as a last resort
    }
    if (role === 'coBorrower') {
      const items = deepQuerySelectorAll(document, 'records-record-layout-item[field-label="Co-Borrower"]');
      for (const item of items) {
        if (item.offsetParent === null) continue;
        const link = deepQuerySelector(item, 'a[href*="/lightning/r/Contact/"]');
        if (link) return link;
      }
    } else if (role === 'buyersAgent') {
      const items = deepQuerySelectorAll(document, 'records-record-layout-item');
      for (const item of items) {
        if (normalizeLabel(item.getAttribute('field-label')) !== 'Buyers Agent') continue;
        if (item.offsetParent === null) continue;
        const link = deepQuerySelector(item, 'a[href*="/lightning/r/Contact/"]');
        if (link) return link;
      }
    } else if (role === 'loanOfficer') {
      // Lead Owner is rendered via force-owner-id-related-list-single — link
      // points at /lightning/r/User/<id>. Sometimes it's a plain anchor with
      // a 005-prefixed id in the href.
      const ownerHosts = deepQuerySelectorAll(document, 'force-owner-id-related-list-single, records-record-layout-item[field-label="Owner"], records-record-layout-item[field-label="Lead Owner"]');
      for (const host of ownerHosts) {
        if (host.offsetParent === null) continue;
        const link = deepQuerySelector(host, 'a[href*="/lightning/r/User/"], a[href*="/005"]');
        if (link) return link;
      }
    }
    return null;
  }

  function dispatchHover(link) {
    if (!link) return;
    try { link.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }); } catch (_) {}
    // Wait a tick so the scroll commits before SF computes the popover position.
    setTimeout(function () {
      const rect = link.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const base = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
      // Salesforce listens for a mix of pointer + mouse events; fire both.
      // Order matters — pointerenter / mouseenter before mouseover so the
      // hover-show controller's gate condition passes.
      try { link.dispatchEvent(new PointerEvent('pointerover',  base)); } catch (_) {}
      try { link.dispatchEvent(new PointerEvent('pointerenter', base)); } catch (_) {}
      try { link.dispatchEvent(new MouseEvent('mouseover',  base)); } catch (_) {}
      try { link.dispatchEvent(new MouseEvent('mouseenter', base)); } catch (_) {}
      try { link.focus(); } catch (_) {}
    }, 250);
  }

  // Inline non-blocking toast in the top-right with a manual fallback button.
  // We don't try to detect whether SF's hover preview actually appeared
  // (that's brittle); we just say "the preview is open, copy the number"
  // and offer an explicit Open-contact-page link in case synthetic hover
  // didn't take.
  function showPhoneFallbackToast(name, contactHref, role, reason) {
    // Remove any previous toast we left up.
    const existing = document.getElementById('zhl-sms-fallback-toast');
    if (existing) existing.remove();
    const t = document.createElement('div');
    t.id = 'zhl-sms-fallback-toast';
    t.style.cssText = [
      'position:fixed', 'top:80px', 'right:24px', 'z-index:2147483647',
      'max-width:340px', 'background:#fff', 'border:1px solid #d1d5db',
      'border-left:4px solid #b45309', 'border-radius:8px',
      'box-shadow:0 10px 28px rgba(0,0,0,0.2)', 'padding:12px 14px',
      'font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif',
      'color:#111'
    ].join(';');
    const safeName = String(name || 'this contact');
    t.innerHTML =
      '<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;">' +
        '<span style="font-size:18px;line-height:1;">📇</span>' +
        '<div style="flex:1;">' +
          '<div style="font-weight:700;color:#b45309;margin-bottom:2px;">Couldn\'t auto-fetch phone</div>' +
          '<div style="color:#374151;font-size:12px;">' + escapeForHtml(reason || 'API lookup failed.') + '</div>' +
        '</div>' +
        '<button type="button" id="zhl-sms-fb-x" aria-label="Dismiss" style="background:none;border:none;font:400 18px/1 sans-serif;color:#6b7280;cursor:pointer;padding:0 2px;">×</button>' +
      '</div>' +
      '<div style="color:#1f2937;margin-bottom:8px;">Opened the hover preview on <strong>' + escapeForHtml(safeName) + '</strong> — copy the mobile / phone from there.</div>' +
      (contactHref
        ? '<a id="zhl-sms-fb-open" href="' + contactHref + '" target="_blank" rel="noopener" style="display:inline-block;background:#0b5cab;color:#fff;text-decoration:none;font:600 12px Arial,sans-serif;padding:6px 10px;border-radius:4px;">If the preview didn\'t open → Open contact page ↗</a>'
        : '');
    document.body.appendChild(t);
    const xBtn = t.querySelector('#zhl-sms-fb-x');
    if (xBtn) xBtn.addEventListener('click', function () { t.remove(); });
    // Auto-dismiss after 14s so it doesn't linger forever.
    setTimeout(function () { try { t.remove(); } catch (_) {} }, 14000);
    try { chrome.runtime.sendMessage({ type: 'TRACK', event: 'sms_hover_fallback_shown', props: { role: role } }); } catch (_) {}
  }

  function escapeForHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Combined entry point: trigger hover + show the toast. Returns true if
  // we found a link to hover on (toast is shown regardless so the user
  // always has the explicit Open-contact-page fallback).
  function showHoverFallback(role, name, recordId, reason) {
    const link = findRecordLinkForRole(role);
    let href = null;
    if (link) {
      const raw = link.getAttribute('href') || '';
      href = raw.startsWith('http') ? raw : (location.origin + raw);
      dispatchHover(link);
    } else if (recordId) {
      // Build a contact / user URL from the id even if the link element is
      // somehow gone from the DOM.
      const obj = role === 'loanOfficer' ? 'User' : 'Contact';
      href = location.origin + '/lightning/r/' + obj + '/' + recordId + '/view';
    }
    showPhoneFallbackToast(name, href, role, reason);
    return !!link;
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
    btn.title = 'Built by Justin Case. Karma appreciated 💛';
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
      const fallbackPhone = leadCtx.buyersAgent.phone;
      const name = leadCtx.buyersAgent.name;
      const contactId = leadCtx.buyersAgent.contactId;
      const labelSuffix = name || leadCtx.buyersAgent.displayText || 'Add';
      const btn = makeAddButton(`Add Buyer’s Agent (${labelSuffix})`, async (b) => {
        const orig = b.textContent;
        b.disabled = true;
        // Prefer the agent's MobilePhone (fetched by Contact id via the
        // background Salesforce API). Fall back to the Lead's
        // "Buyer's Agent Phone" field if the API doesn't return one.
        let phoneToUse = null;
        let lookupError = null;
        let needsReload = false;
        if (contactId) {
          b.textContent = 'Looking up mobile…';
          const lookup = await fetchContactPhone(contactId);
          if (typeof lookup === 'string') phoneToUse = lookup;
          else if (lookup && lookup.error) {
            lookupError = lookup.error;
            if (lookup.reloadNeeded) needsReload = true;
          }
        }
        if (!phoneToUse) phoneToUse = fallbackPhone;
        if (!phoneToUse) {
          b.textContent = orig;
          b.disabled = false;
          const reason = needsReload
            ? 'This tab is stale (ZHL Pack updated in the background). Reload to re-enable auto-fetch.'
            : (lookupError || 'No phone returned from Salesforce.');
          showHoverFallback('buyersAgent', leadCtx.buyersAgent && leadCtx.buyersAgent.name, contactId, reason);
          return;
        }
        b.textContent = 'Adding…';
        const ok = await addParticipant(panel, phoneToUse);
        b.textContent = orig;
        b.disabled = false;
        try { chrome.runtime.sendMessage({ type: 'TRACK', event: 'sms_add_buyers_agent', props: { ok } }); } catch (_) {}
        if (!ok) alert('Could not add Buyer’s Agent — see console for details.');
      });
      wrapper.appendChild(btn);
    }

    // Borrower button — only injected on Opportunity pages (Leads ARE the
    // borrower, no separate button needed; the SF panel's search already
    // finds them by phone). Same lookup + hover fallback as Co-Borrower.
    if (leadCtx.borrower) {
      const id = leadCtx.borrower.contactId;
      const name = leadCtx.borrower.name;
      const btn = makeAddButton(`Add Borrower (${name})`, async (b) => {
        const orig = b.textContent;
        b.disabled = true;
        b.textContent = 'Looking up phone…';
        const lookup = await fetchContactPhone(id);
        const phone = typeof lookup === 'string' ? lookup : null;
        if (!phone) {
          b.textContent = orig;
          b.disabled = false;
          const reason = (lookup && lookup.reloadNeeded)
            ? 'This tab is stale (ZHL Pack updated in the background). Reload to re-enable auto-fetch.'
            : (lookup && lookup.error ? lookup.error : 'No phone returned from Salesforce.');
          showHoverFallback('borrower', name, id, reason);
          return;
        }
        b.textContent = 'Adding…';
        const ok = await addParticipant(panel, phone);
        b.textContent = orig;
        b.disabled = false;
        try { chrome.runtime.sendMessage({ type: 'TRACK', event: 'sms_add_borrower', props: { ok } }); } catch (_) {}
        if (!ok) alert('Could not add Borrower — see console for details.');
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
        const lookup = await fetchContactPhone(id);
        const phone = typeof lookup === 'string' ? lookup : null;
        if (!phone) {
          b.textContent = orig;
          b.disabled = false;
          const reason = (lookup && lookup.reloadNeeded)
            ? 'This tab is stale (ZHL Pack updated in the background). Reload to re-enable auto-fetch.'
            : (lookup && lookup.error ? lookup.error : 'No phone returned from Salesforce.');
          showHoverFallback('coBorrower', name, id, reason);
          return;
        }
        b.textContent = 'Adding…';
        const ok = await addParticipant(panel, phone);
        b.textContent = orig;
        b.disabled = false;
        try { chrome.runtime.sendMessage({ type: 'TRACK', event: 'sms_add_coborrower', props: { ok } }); } catch (_) {}
        if (!ok) alert('Could not add Co-Borrower — see console for details.');
      });
      wrapper.appendChild(btn);
    }

    if (leadCtx.loanOfficer) {
      const id = leadCtx.loanOfficer.userId;
      const name = leadCtx.loanOfficer.name;
      const btn = makeAddButton(`Add Loan Officer (${name})`, async (b) => {
        const orig = b.textContent;
        b.disabled = true;
        b.textContent = 'Looking up phone…';
        const lookup = await fetchUserPhone(id);
        const phone = typeof lookup === 'string' ? lookup : null;
        if (!phone) {
          b.textContent = orig;
          b.disabled = false;
          const reason = (lookup && lookup.reloadNeeded)
            ? 'This tab is stale (ZHL Pack updated in the background). Reload to re-enable auto-fetch.'
            : ((lookup && lookup.error ? lookup.error : 'No phone returned from Salesforce.') +
               ' Make sure the LO has a Phone or Mobile populated on their User record.');
          showHoverFallback('loanOfficer', name, id, reason);
          return;
        }
        b.textContent = 'Adding…';
        const ok = await addParticipant(panel, phone);
        b.textContent = orig;
        b.disabled = false;
        try { chrome.runtime.sendMessage({ type: 'TRACK', event: 'sms_add_loan_officer', props: { ok } }); } catch (_) {}
        if (!ok) alert('Could not add Loan Officer — see console for details.');
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
    if (!isOnLeadOrOpportunityPage()) {
      pruneButtons();
      debugOnce('SMS panel found but not on a Lead or Opportunity URL — current URL: ' + (location.href || ''));
      return;
    }
    const onOppty = isOnOpportunityPage();
    let ctx;
    if (onOppty) {
      const roles = getOpportunityContactRoles();
      ctx = {
        borrower:    roles.borrower,
        coBorrower:  roles.coBorrower,
        buyersAgent: roles.buyersAgent ? {
          contactId: roles.buyersAgent.contactId,
          name: roles.buyersAgent.name,
          displayText: roles.buyersAgent.name,
          phone: null
        } : null,
        loanOfficer: getLeadOwnerInfo()
      };
    } else {
      ctx = {
        borrower:    null, // Leads ARE the borrower — the Lead page already shows their phone
        coBorrower:  getCoBorrowerInfo(),
        buyersAgent: getBuyersAgentInfo(),
        loanOfficer: getLeadOwnerInfo()
      };
    }
    if (!ctx.borrower && !ctx.coBorrower && !ctx.buyersAgent && !ctx.loanOfficer) {
      pruneButtons();
      debugOnce('SMS panel found, on ' + (onOppty ? 'Opportunity' : 'Lead') + ' URL, but no Borrower / Co-Borrower / Buyer’s Agent / Owner found in the DOM yet.');
      return;
    }
    debugOnce('Injecting buttons (' + (onOppty ? 'Oppty' : 'Lead') + '). ' +
      'borrower=' + (ctx.borrower ? ctx.borrower.name : 'none') +
      ', coBorrower=' + (ctx.coBorrower ? ctx.coBorrower.name : 'none') +
      ', buyersAgent=' + (ctx.buyersAgent ? (ctx.buyersAgent.displayText || ctx.buyersAgent.name) : 'none') +
      ', loanOfficer=' + (ctx.loanOfficer ? ctx.loanOfficer.name : 'none'));
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

  // Always emit at least one diagnostic dump so we can confirm the script
  // is running even if no MutationObserver events fire. Three samples:
  // immediately, after 3s, and after 8s (gives the page time to render
  // its right-column components).
  dumpDiag('init');
  setTimeout(() => dumpDiag('+3s'), 3000);
  setTimeout(() => dumpDiag('+8s'), 8000);
  // Heartbeat every 4s — confirms the timer / event loop are alive.
  let heartbeatCount = 0;
  const heartbeatId = setInterval(() => {
    heartbeatCount++;
    if (heartbeatCount > 6) { clearInterval(heartbeatId); return; }
    schedule();
  }, 4000);
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
