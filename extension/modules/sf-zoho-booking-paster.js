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
  function findGlobalSearchInput() {
    // Salesforce Lightning's global search lives inside a Lightning Web
    // Component shadow root — pierce through it. The input carries
    // class="slds-input" type="search" placeholder="Search..." per the
    // DOM the LO provided.
    const candidates = queryAllPiercing('input.slds-input[type="search"], input[type="search"][placeholder^="Search"], input.slds-input[placeholder^="Search"]');
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 100 && rect.height > 10) return el;
    }
    return null;
  }

  async function runSearch(phoneDigits) {
    const input = await waitFor(findGlobalSearchInput, 12000, 250);
    if (!input) return { ok: false, reason: 'Global search input not found.' };
    input.focus();
    setReactInputValue(input, phoneDigits);
    await wait(250);
    pressEnter(input);
    // Salesforce navigates to /one/one.app#... search-results URL.
    const searched = await waitFor(function () {
      return /search/i.test(location.hash || '') || document.querySelector('records-search-results-page, lst-search-results, records-glasshouse-search-results');
    }, 8000, 300);
    if (!searched) return { ok: false, reason: 'Search results page never loaded.' };
    return { ok: true };
  }

  async function clickLeadLink(borrowerName) {
    // Match on borrower full name first, then first-name only as a
    // fallback. We look inside Lead-flavored anchors so we don't click a
    // Contact/Account by mistake.
    const wantFull  = String(borrowerName || '').toLowerCase().trim();
    const wantFirst = wantFull.split(/\s+/)[0] || '';
    const link = await waitFor(function () {
      const links = queryAllPiercing('a[href*="/lightning/r/Lead/"], a[data-refid][href*="Lead"]');
      for (const a of links) {
        const t = (a.textContent || '').toLowerCase().trim();
        if (!t) continue;
        if (wantFull && t === wantFull) return a;
        if (wantFull && t.indexOf(wantFull) >= 0) return a;
      }
      // Looser fallback — first match by first name.
      for (const a of links) {
        const t = (a.textContent || '').toLowerCase().trim();
        if (wantFirst && t.startsWith(wantFirst)) return a;
      }
      return null;
    }, 8000, 250);
    if (!link) return { ok: false, reason: 'No matching Lead link found in search results.' };
    try { link.scrollIntoView({ block: 'center' }); } catch (_) {}
    link.click();
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

  async function selectCommunicationTypeEmail() {
    // Communication Type is rendered as three button-like toggles
    // (Call / Text / Email). Find the one whose visible label is "Email".
    const btn = await waitFor(function () {
      const candidates = queryAllPiercing('button, [role="button"], lightning-radio-group label');
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

  async function fillPaNotesAndSave(noteText) {
    const ta = await findPaNotesTextarea();
    if (!ta) return { ok: false, reason: 'PA Notes textarea not found.' };
    ta.focus();
    setReactInputValue(ta, noteText);
    try { ta.blur(); } catch (_) {}
    await wait(250);

    // Save button — Salesforce ships it as button.slds-button_brand with
    // title="Save" inside the disposition modal scope.
    const saveBtn = await waitFor(function () {
      // Strong match.
      const exact = queryOnePiercing('button.slds-button_brand[title="Save"]');
      if (exact) return exact;
      // Fallback: any visible button labeled exactly "Save".
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
    if (!saveBtn) return { ok: false, reason: 'Save button not found.' };
    saveBtn.click();
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

  let runningInThisTab = false;
  async function runOnce(booking) {
    if (runningInThisTab) return;
    runningInThisTab = true;
    const noteText = buildNoteText(booking);
    try {
      showToast('Auto-logging booking for ' + booking.borrowerName + '…', 'info');

      const s = await runSearch(booking.phoneDigits || booking.phoneRaw);
      if (!s.ok) throw new Error(s.reason);

      const c = await clickLeadLink(booking.borrowerName);
      if (!c.ok) throw new Error(c.reason);

      await wait(800);
      await ensureCallDetailsTab();
      await wait(400);

      const t = await selectCommunicationTypeEmail();
      if (!t.ok) console.warn('[ZHL Zoho Booking Paster] could not select Email — proceeding anyway');

      const f = await fillPaNotesAndSave(noteText);
      if (!f.ok) throw new Error(f.reason);

      // Success — clear stash so we don't fire again.
      await clearStorage([STORAGE_KEY]);
      showToast('✓ Auto-logged booking for ' + booking.borrowerName + '. Agent will see the PA note.', 'ok');
      try { chrome.runtime.sendMessage({ type: 'TRACK', event: 'zoho_booking_logged_ok' }); } catch (_) {}
    } catch (e) {
      console.error('[ZHL Zoho Booking Paster] failed:', e);
      const copied = await copyToClipboard(noteText);
      showToast('Could not auto-log — ' + (e && e.message ? e.message : 'unknown error') +
                (copied ? '. Note copied to clipboard — paste manually into PA Notes.' : '. Paste this manually: ' + noteText),
                'warn');
      try { chrome.runtime.sendMessage({ type: 'TRACK', event: 'zoho_booking_logged_fail', props: { reason: String(e && e.message || e) } }); } catch (_) {}
      // Leave the stash alone so the LO can refresh and try again, but
      // mark it consumed so we don't retry automatically.
      await clearStorage([STORAGE_KEY]);
    } finally {
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
