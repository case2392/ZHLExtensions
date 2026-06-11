// ZHL Productivity Pack — Salesforce Zoho Booking Paster
//
// Companion to gmail-zoho-booking-watcher.js. Runs on Salesforce
// Lightning. Picks up the pending booking payload from chrome.storage.
// local under zhlPendingZohoBookingNote and performs the LO's manual
// workflow automatically:
//
//   1. Type the contact phone number into the global Salesforce search,
//      hit Enter, wait for the search-results page.
//   2. Click the matched Lead's name (the "Recommended Result" anchor or
//      the first row of the Leads table).
//   3. Wait for the Lead detail page to land on the Call Details tab.
//   4. Click Communication Type = Email (the booking arrived as email).
//   5. Fill the PA Notes textarea with the formatted note text.
//   6. Click Save.
//   7. Show success toast, clear the storage stash.
//
// Each step has its own timeout + console log so a failure surfaces a
// readable diagnostic instead of silently stranding the LO. If any step
// fails (lead not found, modal not present, etc.) we leave the stash in
// place and show a "could not auto-log — note copied to clipboard" toast
// so the LO can paste manually.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_zohoBookingAutoNote';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[ZHL Zoho Booking Paster v' + VERSION + '] loaded on', location.href);

  const STORAGE_KEY = 'zhlPendingZohoBookingNote';
  const STASH_TTL_MS = 10 * 60 * 1000;
  const TOAST_ID = 'zhl-zoho-paster-toast';

  // ---- Helpers ----------------------------------------------------
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Recursive shadow-DOM piercing query. Lightning Web Components encapsulate
  // their internals (the global search input is one — note part="input" and
  // lwc-* attributes) so document.querySelectorAll never sees them. Walk all
  // shadowRoots in the tree and try the selector against each.
  function queryAllPiercing(selector, root) {
    const results = [];
    const seen = new Set();
    function visit(node) {
      if (!node || seen.has(node)) return;
      seen.add(node);
      let matches = [];
      try { matches = node.querySelectorAll ? Array.from(node.querySelectorAll(selector)) : []; } catch (_) {}
      for (const m of matches) results.push(m);
      let all = [];
      try { all = node.querySelectorAll ? Array.from(node.querySelectorAll('*')) : []; } catch (_) {}
      for (const el of all) {
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    }
    visit(root || document);
    return results;
  }
  function queryOnePiercing(selector, root) {
    const r = queryAllPiercing(selector, root);
    return r.length ? r[0] : null;
  }
  function getStorage(keys) {
    return new Promise(function (resolve) {
      try { chrome.storage.local.get(keys, function (data) { resolve(data || {}); }); }
      catch (_) { resolve({}); }
    });
  }
  function clearStorage(keys) {
    return new Promise(function (resolve) {
      try { chrome.storage.local.remove(keys, function () { resolve(); }); }
      catch (_) { resolve(); }
    });
  }
  async function waitFor(predicate, timeoutMs, intervalMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const v = predicate();
        if (v) return v;
      } catch (_) {}
      await wait(intervalMs || 200);
    }
    return null;
  }
  function setReactInputValue(el, value) {
    try {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc  = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {}
  }
  function pressEnter(el) {
    try {
      ['keydown','keypress','keyup'].forEach(function (type) {
        el.dispatchEvent(new KeyboardEvent(type, {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
        }));
      });
    } catch (_) {}
  }

  // ---- Progress overlay ------------------------------------------
  //
  // Matches the lop-file-copy / sms-mark-all-read overlay style: a soft
  // white-veil over the whole Salesforce tab with a spinner and a
  // status line that updates as we move through each phase. Greys out
  // the page so the LO knows automation is running and can't
  // accidentally click into the search results / lead while the script
  // is still driving things.
  const PROGRESS_ID = 'zhl-zoho-booking-progress';
  function showProgress(text, sub) {
    let overlay = document.getElementById(PROGRESS_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = PROGRESS_ID;
      overlay.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
        'background:rgba(255,255,255,0.92)',
        'z-index:2147483647',
        'display:flex', 'flex-direction:column',
        'align-items:center', 'justify-content:center',
        'gap:14px',
        'font:600 15px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif',
        'color:#0b5cab', 'text-align:center',
        'pointer-events:all', 'cursor:wait',
        'padding:24px'
      ].join(';');
      const spinner = document.createElement('div');
      spinner.style.cssText = [
        'width:36px', 'height:36px',
        'border:4px solid #cfe1f5',
        'border-top-color:#006aff',
        'border-radius:50%',
        'animation:zhl-zb-spin 0.8s linear infinite'
      ].join(';');
      const msg = document.createElement('div');
      msg.setAttribute('data-zhl-zb-msg', '1');
      msg.textContent = text || 'Auto-logging booking…';
      const subEl = document.createElement('div');
      subEl.setAttribute('data-zhl-zb-sub', '1');
      subEl.style.cssText = 'font:500 12px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#6b7280;max-width:380px;';
      subEl.textContent = sub || '';
      overlay.appendChild(spinner);
      overlay.appendChild(msg);
      overlay.appendChild(subEl);
      document.body.appendChild(overlay);
      if (!document.getElementById('zhl-zb-spin-style')) {
        const style = document.createElement('style');
        style.id = 'zhl-zb-spin-style';
        style.textContent = '@keyframes zhl-zb-spin { to { transform: rotate(360deg); } }';
        document.head.appendChild(style);
      }
    } else {
      updateProgress(text, sub);
    }
    return overlay;
  }
  function updateProgress(text, sub) {
    const overlay = document.getElementById(PROGRESS_ID);
    if (!overlay) return;
    if (text != null) {
      const m = overlay.querySelector('[data-zhl-zb-msg]');
      if (m) m.textContent = text;
    }
    if (sub != null) {
      const s = overlay.querySelector('[data-zhl-zb-sub]');
      if (s) s.textContent = sub;
    }
  }
  function hideProgress() {
    const overlay = document.getElementById(PROGRESS_ID);
    if (overlay) overlay.remove();
  }

  // ---- Toast ------------------------------------------------------
  function showToast(message, kind) {
    const existing = document.getElementById(TOAST_ID);
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = TOAST_ID;
    const palettes = {
      info:  { bg: '#dbeafe', border: '#1d4ed8', text: '#1e3a8a' },
      ok:    { bg: '#dcfce7', border: '#16a34a', text: '#065f46' },
      warn:  { bg: '#fef3c7', border: '#f59e0b', text: '#78350f' },
      error: { bg: '#fee2e2', border: '#dc2626', text: '#991b1b' }
    };
    const p = palettes[kind] || palettes.info;
    el.style.cssText = [
      'position:fixed', 'top:80px', 'right:24px', 'z-index:2147483647',
      'background:' + p.bg, 'color:' + p.text, 'border:1.5px solid ' + p.border,
      'border-radius:8px', 'padding:11px 14px', 'box-shadow:0 8px 24px rgba(0,0,0,0.18)',
      'font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif',
      'max-width:380px'
    ].join(';');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () { try { el.remove(); } catch (_) {} }, 7000);
  }

  // ---- The Salesforce flow ----------------------------------------
  //
  // Per the global-header DOM the LO provided, what visually looks like
  // a "search input" at the top of Salesforce is actually a BUTTON
  // (button.search-button inside .forceSearchAssistant) — clicking it
  // opens the Search Assistant overlay where the real input lives. The
  // header is Aura (data-aura-rendered-by attributes everywhere), so
  // the button itself is in light DOM and accessible via document.
  // querySelector. The input that appears AFTER clicking may be in
  // shadow DOM, so we use the piercing helper for the second step.
  function findSearchTriggerButton() {
    // Prefer the most specific selectors first.
    const candidates = [
      '.slds-global-header__item_search button.search-button',
      '.forceSearchAssistant button.search-button',
      '.forceSearchAssistant button',
      'button.search-button[aria-label="Search"]',
      'button[aria-label="Search"]'
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return el;
      }
    }
    return null;
  }

  function findActiveSearchInput() {
    // After the trigger is clicked, the search input appears (and is
    // usually auto-focused). Try the focused element first, then a
    // piercing query for an input that looks like the global search.
    const ae = document.activeElement;
    if (ae && ae.tagName === 'INPUT') {
      const ph  = (ae.placeholder || '').toLowerCase();
      const al  = (ae.getAttribute('aria-label') || '').toLowerCase();
      const typ = (ae.getAttribute('type') || '').toLowerCase();
      if (typ === 'search' || ph.indexOf('search') >= 0 || al.indexOf('search') >= 0) return ae;
    }
    const candidates = queryAllPiercing(
      'input.slds-input[type="search"], ' +
      'input[type="search"][placeholder*="Search"], ' +
      'input[type="search"][aria-label*="Search"], ' +
      'input.slds-input[placeholder*="Search"]'
    );
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 100 && rect.height > 10) return el;
    }
    return null;
  }

  function dispatchKey(target, opts) {
    try {
      ['keydown','keypress','keyup'].forEach(function (type) {
        target.dispatchEvent(new KeyboardEvent(type, Object.assign({
          bubbles: true, cancelable: true
        }, opts)));
      });
    } catch (_) {}
  }

  // Full pointer/mouse event sequence — Salesforce's "kx" interaction
  // framework (the ripple effect on disposition buttons) relies on the
  // pointerdown/mousedown/pointerup/mouseup sequence to register a
  // click as a real selection. We dispatch the full buildup events
  // then call .click() ONCE to trigger the actual click handler. The
  // earlier version of this also dispatched a 'click' MouseEvent in
  // the mouse[] loop AND called .click() — that was firing the save
  // twice and producing duplicate disposition entries.
  function fullClickSequence(el) {
    if (!el) return;
    try { el.focus(); } catch (_) {}
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const base = {
      bubbles: true, cancelable: true, composed: true, view: window,
      button: 0, buttons: 1, clientX: x, clientY: y
    };
    // Buildup only — no 'click' here. The real click comes from
    // .click() below, which synthesizes its own click event.
    const buildup = [
      'pointerover', 'pointerenter',
      'mouseover',   'mouseenter',
      'pointerdown', 'mousedown',
      'pointerup',   'mouseup'
    ];
    for (const type of buildup) {
      try {
        const Constructor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Constructor(type, base));
      } catch (_) {}
    }
    try { el.click(); } catch (_) {}
  }

  async function runSearch(phoneDigits) {
    // Step 1: open the Search Assistant overlay. Three paths:
    //   a. Click the search button (Aura, light DOM — most reliable).
    //   b. Keyboard shortcut Ctrl+/ then Cmd+/.
    //   c. If neither lands but an input is already focused (e.g. the
    //      LO had search open), just use that.
    const trigger = findSearchTriggerButton();
    if (trigger) {
      try { trigger.click(); } catch (_) {}
      await wait(450);
    }
    // After click, the input is usually auto-focused. Probe for it.
    let input = findActiveSearchInput();
    if (!input) {
      // Belt-and-suspenders — keyboard shortcut in case the click didn't
      // land or the overlay needs a focus event to render its input.
      const opts = { key: '/', code: 'Slash', keyCode: 191, which: 191 };
      dispatchKey(document.body, Object.assign({}, opts, { ctrlKey: true }));
      await wait(250);
      input = findActiveSearchInput();
      if (!input) {
        dispatchKey(document.body, Object.assign({}, opts, { metaKey: true }));
        await wait(250);
        input = findActiveSearchInput();
      }
    }
    // One more wait+poll in case the input appears slowly.
    if (!input) {
      input = await waitFor(findActiveSearchInput, 4000, 250);
    }
    if (!input) {
      return {
        ok: false,
        reason: 'Global search input never appeared after opening the Search Assistant overlay.'
      };
    }

    input.focus();
    setReactInputValue(input, phoneDigits);
    await wait(300);

    // Submitting the search. Salesforce ignores synthetic KeyboardEvents
    // because they're isTrusted=false — the actual submit handler is gated
    // on real user events. Three submission paths in order of preference:
    //
    //   a. Press Enter on the input (works on some SF instances; harmless
    //      if it doesn't).
    //   b. Click the "Show more results for <term>" link that appears in
    //      the suggestions dropdown — this is the same action the LO takes
    //      manually and reliably navigates to the search results page.
    //   c. Press Enter on the document body as a last-ditch fallback.
    pressEnter(input);
    await wait(500);

    // Quick check — if Enter happened to work, we're already on results.
    const alreadyOnResults = await waitFor(searchResultsPageLoaded, 1200, 200);
    if (alreadyOnResults) return { ok: true };

    // Otherwise, look for the "Show more results for..." anchor and click it.
    const showMore = await waitFor(findShowMoreResultsLink, 3000, 250);
    if (showMore) {
      try { showMore.scrollIntoView({ block: 'center' }); } catch (_) {}
      try { showMore.click(); } catch (_) {}
      const ok = await waitFor(searchResultsPageLoaded, 8000, 300);
      if (ok) return { ok: true };
    }

    // Last-ditch: dispatch Enter to document.body in case there's a global
    // keydown handler waiting for it.
    pressEnter(document.body);
    const lastShot = await waitFor(searchResultsPageLoaded, 4000, 300);
    if (lastShot) return { ok: true };

    return { ok: false, reason: 'Search results page never loaded after submitting.' };
  }

  function searchResultsPageLoaded() {
    if (/search/i.test(location.hash || '')) return true;
    if (/search/i.test(location.pathname || '')) return true;
    if (queryOnePiercing('records-search-results-page, lst-search-results, records-glasshouse-search-results')) return true;
    if ((document.body.textContent || '').indexOf('We searched for') >= 0) return true;
    return false;
  }

  function findShowMoreResultsLink() {
    // Salesforce's search suggestions panel renders a "Show more results
    // for "<term>"" link/button at the top when the typed term has no
    // direct match. Find by text match across anchors, buttons, and
    // role="button" elements — both light DOM and shadow DOM.
    const candidates = queryAllPiercing('a, button, [role="button"], [role="link"], [role="option"]');
    for (const el of candidates) {
      const t = (el.textContent || '').trim();
      if (/^Show more results for/i.test(t)) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return el;
      }
    }
    return null;
  }

  async function clickLeadLink(borrowerName) {
    // Salesforce uses generic record IDs in URLs (e.g., /lightning/r/00Qa.../view),
    // not object-type prefixes — so a selector like a[href*="/lightning/r/Lead/"]
    // never matches. Record links carry data-refid="recordId" and the Aura
    // class forceOutputLookup / outputLookupLink. They also have title=
    // matching the record's display name, which is the most reliable selector.
    const wantFull  = String(borrowerName || '').toLowerCase().trim();
    const wantFirst = wantFull.split(/\s+/)[0] || '';

    const link = await waitFor(function () {
      // Strategy 1 — exact title attribute match (most reliable on Aura
      // forceOutputLookup links).
      const byTitle = queryAllPiercing('a.forceOutputLookup[title], a[data-refid="recordId"][title]');
      for (const a of byTitle) {
        const title = (a.getAttribute('title') || '').toLowerCase().trim();
        if (wantFull && title === wantFull) return a;
      }
      // Strategy 2 — textContent exact / substring match on record-link anchors.
      const recordLinks = queryAllPiercing('a.forceOutputLookup, a[data-refid="recordId"], a.outputLookupLink');
      for (const a of recordLinks) {
        const t = (a.textContent || '').toLowerCase().trim();
        if (wantFull && (t === wantFull || t.indexOf(wantFull) >= 0)) return a;
      }
      // Strategy 3 — first-name fallback.
      for (const a of recordLinks) {
        const t = (a.textContent || '').toLowerCase().trim();
        if (wantFirst && t.startsWith(wantFirst)) return a;
      }
      return null;
    }, 8000, 250);

    if (!link) return { ok: false, reason: 'No matching Lead link found in search results.' };

    // The link carries target="_blank" — without removing it, .click() opens
    // a brand-new tab instead of navigating the current SF tab. Strip it.
    try { link.removeAttribute('target'); } catch (_) {}
    try { link.scrollIntoView({ block: 'center' }); } catch (_) {}
    try { link.click(); } catch (_) {}

    // Wait for SPA navigation to the lead record. If the click somehow
    // didn't navigate (Aura swallowed it, target stripping failed in some
    // edge case, etc.), fall back to a direct location.href assignment to
    // the href the link points to — Salesforce will intercept it and route
    // via its own SPA navigation regardless.
    const navigated = await waitFor(function () {
      return location.pathname.indexOf('/lightning/r/') >= 0 ||
             (location.hash || '').indexOf('recordId') >= 0;
    }, 3500, 250);
    if (!navigated) {
      const href = link.getAttribute('href');
      if (href) {
        try {
          const fullUrl = new URL(href, location.origin).toString();
          console.log('[ZHL Zoho Booking Paster] click did not navigate — falling back to location.href =', fullUrl);
          location.href = fullUrl;
        } catch (_) {}
      }
    }
    return { ok: true };
  }

  async function ensureCallDetailsTab() {
    // The disposition form lives under the Call Details tab. It's the
    // default selected tab; if not, click it.
    const tab = await waitFor(function () {
      const candidates = queryAllPiercing('a[role="tab"], li[role="tab"] a, lightning-tab');
      for (const el of candidates) {
        const txt = (el.textContent || '').trim().toLowerCase();
        if (txt === 'call details') return el;
      }
      return null;
    }, 8000, 250);
    if (tab) {
      const active = tab.getAttribute('aria-selected') === 'true' ||
                     tab.classList.contains('slds-is-active');
      if (!active) {
        try { tab.click(); await wait(400); } catch (_) {}
      }
    }
    return { ok: true };
  }

  // Find the disposition-modal root container so we can scope subsequent
  // queries to its subtree. The Save button, Communication Type buttons,
  // My Notes editor, PA Notes textarea, and New Follow-up section are
  // all light-DOM children of this LWC and carry a "c-dispositionmodal*"
  // scoping attribute. Without this scoping we risk clicking a Save
  // button from a different form (record-edit Save, etc.) or matching
  // the Email field label in Borrower Information as the Communication
  // Type "Email" button — both of which leave the disposition unsaved.
  function findDispositionContainer() {
    // The scoping attribute is something like c-dispositionmodal_dispositionmodal
    // or c-dispositionmodallogoutcome_dispositionmodallogoutcome.
    const candidates = queryAllPiercing(
      '[c-dispositionmodal_dispositionmodal], ' +
      '[c-dispositionmodallogoutcome_dispositionmodallogoutcome]'
    );
    if (!candidates.length) return null;
    // Use the lowest common ancestor — find the highest element among
    // the candidates and look at one of its ancestors that wraps the
    // PA Notes textarea + Save button.
    const sample = candidates[0];
    // Walk up looking for an ancestor that contains both a PA Notes
    // textarea and a Save button.
    let cur = sample;
    while (cur && cur !== document.body) {
      const hasPaNotes = cur.querySelector && cur.querySelector('textarea[placeholder*="PA Notes"]');
      const hasSave    = cur.querySelector && cur.querySelector('button.slds-button_brand');
      if (hasPaNotes && hasSave) return cur;
      cur = cur.parentElement || (cur.getRootNode && cur.getRootNode().host) || null;
    }
    // Fallback — the sample itself.
    return sample;
  }

  async function selectCommunicationTypeEmail() {
    // The disposition modal's Communication Type uses three
    // <lightning-button> elements with class="button-call" /
    // "button-text" / "button-email". The currently-selected one carries
    // variant="brand" (and an inline blue background style); the rest
    // are variant="neutral". Click the host with class="button-email"
    // and verify the variant attribute flips to "brand".
    const emailHost = await waitFor(function () {
      return queryOnePiercing('lightning-button.button-email');
    }, 8000, 250);
    if (!emailHost) return { ok: false, reason: 'Email button (lightning-button.button-email) not found.' };

    const innerBtn = emailHost.querySelector && emailHost.querySelector('button');
    console.log('[ZHL Zoho Booking Paster] Communication Type Email — variant before click:', emailHost.getAttribute('variant'));

    // The "kx" ripple framework on the inner <button> needs the full
    // pointer/mouse event sequence, not just a plain .click().
    fullClickSequence(innerBtn || emailHost);
    await wait(350);

    let variant = emailHost.getAttribute('variant');
    if (variant !== 'brand') {
      // Try clicking the host directly too — some LWC button-groups
      // listen on the host, not the inner element.
      console.log('[ZHL Zoho Booking Paster] Email variant still', variant, '— trying host click');
      fullClickSequence(emailHost);
      await wait(350);
      variant = emailHost.getAttribute('variant');
    }

    if (variant !== 'brand') {
      console.warn('[ZHL Zoho Booking Paster] Communication Type Email did not visibly select (variant=', variant, '). Continuing anyway; Save will fail if Communication Type is required.');
      return { ok: false, reason: 'Email click did not flip variant to "brand" — Communication Type may still be Call.' };
    }
    console.log('[ZHL Zoho Booking Paster] Email selected (variant=brand)');
    return { ok: true };
  }

  // Wrap the original-style "find any element with text Email" path —
  // kept for the runOnce caller signature but not actually called now
  // that we have the specific selector above. Left here in case Salesforce
  // changes the class structure later.
  async function _selectCommunicationTypeEmailLegacy() {
    const btn = await waitFor(function () {
      const container = findDispositionContainer() || document;
      const candidates = Array.from(
        (container.querySelectorAll && container.querySelectorAll('button, [role="button"], lightning-radio-group label')) || []
      );
      for (const el of candidates) {
        const txt = (el.textContent || '').trim().toLowerCase();
        if (txt === 'email') {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) return el;
        }
      }
      return null;
    }, 8000, 250);
    if (!btn) return { ok: false, reason: 'Communication Type = Email button not found.' };
    try { btn.click(); } catch (_) {}
    await wait(250);
    return { ok: true };
  }

  async function findPaNotesTextarea() {
    return await waitFor(function () {
      // Most reliable: placeholder text Salesforce ships.
      const tas = queryAllPiercing('textarea.slds-textarea[placeholder*="PA Notes"], textarea[placeholder*="PA Notes"]');
      if (tas.length) return tas[0];
      // Fallback: walk the lightning-textarea components and match label text.
      const lts = queryAllPiercing('lightning-textarea');
      for (const lt of lts) {
        const label = (lt.querySelector && lt.querySelector('label')) ? lt.querySelector('label').textContent : '';
        if (/pa\s*notes/i.test(label)) {
          const inner = lt.querySelector && lt.querySelector('textarea');
          if (inner) return inner;
        }
        // Try shadowRoot label too.
        if (lt.shadowRoot) {
          const innerLabel = lt.shadowRoot.querySelector ? (lt.shadowRoot.querySelector('label') || {}).textContent || '' : '';
          if (/pa\s*notes/i.test(innerLabel)) {
            const inner = lt.shadowRoot.querySelector('textarea');
            if (inner) return inner;
          }
        }
      }
      return null;
    }, 8000, 250);
  }

  // Walk up the DOM, crossing shadow-root boundaries, to find the
  // lightning-textarea host element. LWC stores the component's reactive
  // value on the host, not the inner <textarea> — that's what we need to
  // set for the disposition modal's save handler to actually pick up.
  function findLwcHost(innerEl, hostTagName) {
    let cur = innerEl;
    const want = (hostTagName || '').toLowerCase();
    while (cur) {
      if (cur.tagName && cur.tagName.toLowerCase() === want) return cur;
      // Step up: regular parent, or across the shadow root boundary.
      let next = cur.parentElement;
      if (!next) {
        const root = (cur.getRootNode && cur.getRootNode());
        if (root && root.host) next = root.host;
      }
      if (next === cur) break;
      cur = next;
    }
    return null;
  }

  async function fillPaNotesAndSave(noteText) {
    const ta = await findPaNotesTextarea();
    if (!ta) return { ok: false, reason: 'PA Notes textarea not found.' };

    // Bring the textarea into view so the LO can see what's happening,
    // especially while we're still ironing out the flow.
    try { ta.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
    await wait(200);

    // 1. Set the LWC host's reactive `value` property. This is the most
    //    reliable way to drive a <lightning-textarea> — synthetic input
    //    events on the inner <textarea> sometimes get ignored by LWC's
    //    reactivity, but setting the host property propagates the value
    //    into the component's state AND into the inner textarea via the
    //    component's own re-render.
    const host = findLwcHost(ta, 'lightning-textarea');
    if (host) {
      try { host.value = noteText; } catch (_) {}
    }

    // 2. Focus + select existing content + execCommand('insertText'). This
    //    drives the browser's native input pipeline which fires the same
    //    events a real user typing would fire (all with isTrusted=false
    //    because they're still synthetic, but with the right shape).
    ta.focus();
    try {
      ta.setSelectionRange(0, (ta.value || '').length);
    } catch (_) {}
    let viaExec = false;
    try { viaExec = document.execCommand('insertText', false, noteText); } catch (_) {}

    // 3. Fallback: React-trusted writer if execCommand didn't take.
    if (!viaExec && ta.value !== noteText) {
      try {
        const proto = HTMLTextAreaElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(ta, noteText);
        else ta.value = noteText;
      } catch (_) {}
    }

    // 4. Dispatch input + change with composed:true so they cross shadow
    //    boundaries — important because LWC's listeners may live on the
    //    host or higher up the tree, outside the textarea's shadow root.
    try {
      ta.dispatchEvent(new InputEvent('input', {
        bubbles: true, composed: true, inputType: 'insertText', data: noteText
      }));
      ta.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    } catch (_) {}

    try { ta.blur(); } catch (_) {}
    await wait(500);

    // 5. Verify the value actually stuck. If not (LWC re-rendered with
    //    its empty internal state, or our writes lost the race), retry
    //    the write up to 3 times with progressively longer waits.
    let attempt = 0;
    while (ta.value !== noteText && attempt < 3) {
      attempt++;
      console.warn('[ZHL Zoho Booking Paster] PA Notes value missing on verify (attempt ' + attempt + ').', {
        wanted: noteText,
        got: ta.value,
        hostValue: host && host.value
      });
      if (host) { try { host.value = noteText; } catch (_) {} }
      ta.focus();
      try { ta.setSelectionRange(0, (ta.value || '').length); } catch (_) {}
      try { document.execCommand('insertText', false, noteText); } catch (_) {}
      try {
        ta.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: noteText }));
        ta.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      } catch (_) {}
      await wait(400 + attempt * 200);
    }
    if (ta.value !== noteText) {
      console.error('[ZHL Zoho Booking Paster] PA Notes value still did not stick after 3 retries — giving up on PA Notes commit and proceeding to Save anyway.', {
        wanted: noteText,
        got: ta.value,
        hostValue: host && host.value
      });
    } else {
      console.log('[ZHL Zoho Booking Paster] PA Notes value committed:', noteText);
    }

    // Save button — scope to the disposition-modal container so we don't
    // accidentally click a different Save (record-edit Save, follow-up
    // Save, etc.). The disposition Save carries the LWC scoping
    // attribute c-dispositionmodal_dispositionmodal on the same button.
    const saveBtn = await waitFor(function () {
      // Strongest match: button with the LWC scoping attribute.
      const scoped = queryAllPiercing(
        'button.slds-button_brand[title="Save"][c-dispositionmodal_dispositionmodal], ' +
        'button.slds-button_brand[c-dispositionmodal_dispositionmodal], ' +
        'button[c-dispositionmodal_dispositionmodal][title="Save"]'
      );
      for (const b of scoped) {
        const rect = b.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return b;
      }
      // Fallback: any Save button INSIDE the disposition container.
      const container = findDispositionContainer();
      if (container) {
        const inside = container.querySelectorAll && container.querySelectorAll('button.slds-button_brand[title="Save"], button.slds-button_brand');
        if (inside) {
          for (const b of inside) {
            const t = (b.textContent || '').trim();
            if (t !== 'Save') continue;
            const rect = b.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) return b;
          }
        }
      }
      // Last-resort fallback: any visible Save button anywhere.
      const all = queryAllPiercing('button');
      for (const b of all) {
        const t = (b.textContent || '').trim();
        if (t !== 'Save') continue;
        const rect = b.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        return b;
      }
      return null;
    }, 5000, 250);
    if (!saveBtn) return { ok: false, reason: 'Save button not found inside disposition modal.' };

    // Save verification. The disposition modal's own <c-disposition-note-history>
    // section does NOT reflect newly-saved notes — they go to a different
    // panel on the lead. So the v1.63.10 row-count check was always going
    // to time out. Instead: snapshot the PA Notes textarea value before
    // clicking Save, then wait for it to CLEAR. On a successful save
    // Salesforce resets the form, which empties the textarea — that's a
    // reliable in-page signal that the save round-tripped through the
    // backend. A success toast also fires; we accept either signal.
    const paNotesValueBeforeSave = ta.value || '';

    console.log('[ZHL Zoho Booking Paster] clicking disposition Save button:', saveBtn, 'PA Notes value at click time:', JSON.stringify(paNotesValueBeforeSave));
    try { saveBtn.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
    await wait(300);
    fullClickSequence(saveBtn);

    // Wait for the form reset (textarea clears) OR a success toast — up
    // to 10 seconds. Salesforce's save POST + form-reset re-render
    // usually takes 1-3s; allow generous headroom.
    const savedOk = await waitFor(function () {
      // Signal A — PA Notes textarea cleared. Only counts if the textarea
      // HAD content before save (so an already-empty textarea doesn't
      // false-positive as success).
      try {
        const currentVal = ta.value || '';
        if (paNotesValueBeforeSave && currentVal === '') return 'pa-notes-cleared';
      } catch (_) {}
      // Signal B — Salesforce success toast. Filter out error/validation
      // toasts so we don't false-positive on those.
      const toasts = queryAllPiercing('.slds-notify_toast, .toastMessage, .slds-notify--toast, [role="alert"]');
      for (const tEl of toasts) {
        const txt = (tEl.textContent || '').trim().toLowerCase();
        if (!txt || txt.length < 4) continue;
        if (/error|fail|invalid|required|missing/i.test(txt)) continue;
        if (/saved|success|created|logged|added/i.test(txt)) return 'sf-toast';
      }
      return null;
    }, 10000, 300);

    if (!savedOk) {
      console.warn('[ZHL Zoho Booking Paster] save verification failed.', {
        paNotesBefore: paNotesValueBeforeSave,
        paNotesNow: ta.value
      });
      return {
        ok: false,
        reason: 'Save was clicked but no confirmation appeared within 10 seconds — PA Notes textarea did not clear and no success toast fired. Most likely cause: Communication Type not actually set to Email, or LWC reactive state still showed empty PA Notes when Save fired. Paste the note manually for now.'
      };
    }
    console.log('[ZHL Zoho Booking Paster] save confirmed by:', savedOk);
    return { ok: true };
  }

  function buildNoteText(booking) {
    return (booking.borrowerFirst || booking.borrowerName) +
           ' scheduled an appointment with me for ' +
           booking.friendlyTime + ' on ' + booking.friendlyDate + '.';
  }

  async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (_) { return false; }
  }

  // Wait for the disposition modal to be FULLY hydrated by LWC — not
  // just present in the DOM, but mounted with event listeners wired up.
  // The classic failure mode (and almost certainly the cause of the
  // intermittent "it worked once" the LO is seeing) is interacting
  // with the lightning-button / lightning-textarea / save button while
  // LWC is still in the middle of its first render: the elements
  // exist, but our clicks/value sets land before the component is
  // listening. Wait for all three critical elements to be present
  // AND visible together, then add a 1.5s settle buffer to let LWC
  // finish wiring up its reactive system.
  async function waitForDispositionReady() {
    const result = await waitFor(function () {
      const emailBtn = queryOnePiercing('lightning-button.button-email');
      const paNotes  = queryOnePiercing('textarea[placeholder*="PA Notes"]');
      const saveBtn  = queryOnePiercing('button.slds-button_brand[title="Save"][c-dispositionmodal_dispositionmodal]');
      if (!emailBtn || !paNotes || !saveBtn) return null;
      const rE = emailBtn.getBoundingClientRect();
      const rP = paNotes.getBoundingClientRect();
      const rS = saveBtn.getBoundingClientRect();
      if (rE.width === 0 || rP.width === 0 || rS.width === 0) return null;
      // Confirm the Save button isn't disabled (which would mean the
      // form isn't fully wired yet).
      if (saveBtn.disabled || saveBtn.getAttribute('aria-disabled') === 'true') return null;
      return true;
    }, 30000, 400);
    if (!result) return false;
    // Settle buffer — let LWC finish hooking up internal listeners
    // before we start dispatching synthetic events.
    await wait(1500);
    return true;
  }

  let runningInThisTab = false;
  async function runOnce(booking) {
    if (runningInThisTab) return;
    runningInThisTab = true;
    const noteText = buildNoteText(booking);
    try {
      showProgress(
        'Auto-logging booking for ' + booking.borrowerName,
        'Searching Salesforce by contact phone…'
      );

      const s = await runSearch(booking.phoneDigits || booking.phoneRaw);
      if (!s.ok) throw new Error(s.reason);

      updateProgress(null, 'Opening lead record…');
      const c = await clickLeadLink(booking.borrowerName);
      if (!c.ok) throw new Error(c.reason);

      updateProgress(null, 'Waiting for the disposition modal to finish loading…');
      const ready = await waitForDispositionReady();
      if (!ready) throw new Error('Disposition modal did not finish loading within 30 seconds (Communication Type / PA Notes / Save not all present and visible).');

      updateProgress(null, 'Opening Call Details tab…');
      await ensureCallDetailsTab();
      await wait(500);

      updateProgress(null, 'Setting Communication Type to Email…');
      const t = await selectCommunicationTypeEmail();
      if (!t.ok) {
        // Halt instead of proceeding — saving with the wrong Communication
        // Type (or with the form in an invalid state) is exactly how we
        // ended up with a "Saved" toast and no actual disposition.
        throw new Error('Communication Type could not be set to Email (variant did not flip to "brand"). ' + (t.reason || ''));
      }
      await wait(500);

      updateProgress(null, 'Filling PA Notes and saving…');
      const f = await fillPaNotesAndSave(noteText);
      if (!f.ok) throw new Error(f.reason);

      // Success — clear stash so we don't fire again.
      await clearStorage([STORAGE_KEY]);
      hideProgress();
      showToast('✓ Auto-logged booking for ' + booking.borrowerName + '. Agent will see the PA note.', 'ok');
      try { chrome.runtime.sendMessage({ type: 'TRACK', event: 'zoho_booking_logged_ok' }); } catch (_) {}
    } catch (e) {
      console.error('[ZHL Zoho Booking Paster] failed:', e);
      hideProgress();
      const copied = await copyToClipboard(noteText);
      showToast('Could not auto-log — ' + (e && e.message ? e.message : 'unknown error') +
                (copied ? '. Note copied to clipboard — paste manually into PA Notes.' : '. Paste this manually: ' + noteText),
                'warn');
      try { chrome.runtime.sendMessage({ type: 'TRACK', event: 'zoho_booking_logged_fail', props: { reason: String(e && e.message || e) } }); } catch (_) {}
      // Leave the stash alone so the LO can refresh and try again, but
      // mark it consumed so we don't retry automatically.
      await clearStorage([STORAGE_KEY]);
    } finally {
      hideProgress();
      runningInThisTab = false;
    }
  }

  async function checkPending() {
    const data = await getStorage([STORAGE_KEY]);
    const pending = data && data[STORAGE_KEY];
    if (!pending || !pending.ts) return;
    const age = Date.now() - pending.ts;
    if (age > STASH_TTL_MS) {
      console.log('[ZHL Zoho Booking Paster] pending stash expired (age=' + age + ' ms)');
      await clearStorage([STORAGE_KEY]);
      return;
    }
    runOnce(pending);
  }

  // Initial check + on URL change.
  setTimeout(checkPending, 1200);
  let lastUrl = location.href;
  setInterval(function () {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(checkPending, 1200);
    }
  }, 800);

  // Wake-up from the service worker — when the SW focuses an existing
  // Salesforce tab (instead of opening a new one), the URL doesn't change
  // so the polling above wouldn't notice the new pending stash. This
  // listener triggers a check immediately on tab activation.
  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === 'ZHL_BOOKING_CHECK_PENDING') {
        console.log('[ZHL Zoho Booking Paster] wake-up message received');
        setTimeout(checkPending, 300);
      }
    });
  } catch (_) {}
})();
  }
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([__ZHL_FEATURE_KEY, 'zhl_kill_switch'], function (data) {
      if (data.zhl_kill_switch === true) return;
      if (data[__ZHL_FEATURE_KEY] === false) return;
      __zhlRunModule();
    });
  } else {
    __zhlRunModule();
  }
})();
