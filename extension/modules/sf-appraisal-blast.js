// ZHL Productivity Pack module — feature key: feature_appraisalBlast
//
// Salesforce side of the Appraisal Blast flow. Receives two messages
// from the background service worker:
//
//   zhlAppraisalBlast.searchLoan(loanNumber)
//     Drives the global search header, types the loan number, presses
//     Enter, waits for the result link, and returns its absolute URL
//     (normalized to the /lightning/r/Opportunity/<Id> form).
//
//   zhlAppraisalBlast.getContacts()
//     Once the Opportunity record is open, finds the "View All" link
//     for Contact Roles, opens the related-list page, and scrapes
//     { role, email } per row.
//
// Both flows progress-update the LO's Gmail tab via the background
// (zhlAppraisalBlast.sfProgress → relayed as zhlAppraisalBlast.status).

(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_appraisalBlast';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[ZHL Appraisal Blast SF v' + VERSION + '] loaded');

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) return;
    if (msg.action === 'zhlAppraisalBlast.searchLoan') {
      searchLoan(msg.loanNumber)
        .then(function (resultUrl) { sendResponse({ ok: true, resultUrl: resultUrl }); })
        .catch(function (e) { sendResponse({ ok: false, error: e.message || String(e) }); });
      return true;
    }
    if (msg.action === 'zhlAppraisalBlast.getContacts') {
      getContacts()
        .then(function (contacts) { sendResponse({ ok: true, contacts: contacts }); })
        .catch(function (e) { sendResponse({ ok: false, error: e.message || String(e) }); });
      return true;
    }
  });

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function waitFor(selOrFn, timeout, interval) {
    timeout = timeout == null ? 20000 : timeout;
    interval = interval == null ? 300 : interval;
    return new Promise(function (resolve, reject) {
      const start = Date.now();
      const t = setInterval(function () {
        try {
          const el = typeof selOrFn === 'function' ? selOrFn() : document.querySelector(selOrFn);
          if (el) { clearInterval(t); resolve(el); return; }
        } catch (e) {}
        if (Date.now() - start > timeout) {
          clearInterval(t);
          reject(new Error('Timeout waiting for element'));
        }
      }, interval);
    });
  }

  function progress(text) {
    try { chrome.runtime.sendMessage({ action: 'zhlAppraisalBlast.sfProgress', text: text }); }
    catch (e) {}
  }

  // -------- step 1: global search -> top loan record URL --------
  async function searchLoan(loanNumber) {
    progress('Opening Salesforce search…');
    const searchBtn = await waitFor(function () {
      const candidates = [
        'button.search-button[aria-label="Search"]',
        'button.search-button',
        'button[aria-label="Search Salesforce"]'
      ];
      for (const sel of candidates) { const el = document.querySelector(sel); if (el) return el; }
      return null;
    }, 15000);
    searchBtn.click();
    await sleep(500);

    const input = await waitFor(function () {
      const inputs = document.querySelectorAll('input.slds-input, input[type="search"], input[role="combobox"]');
      for (const el of inputs) {
        if (el.offsetParent !== null && el.type !== 'hidden') return el;
      }
      return null;
    }, 8000);

    progress('Searching for ' + loanNumber + '…');
    // Native setter so React/Aura registers the change
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, loanNumber);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(400);
    const evtInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
    input.dispatchEvent(new KeyboardEvent('keydown', evtInit));
    input.dispatchEvent(new KeyboardEvent('keypress', evtInit));
    input.dispatchEvent(new KeyboardEvent('keyup', evtInit));

    progress('Waiting for search results…');
    const link = await waitFor(function () {
      const links = document.querySelectorAll('a[data-refid="recordId"], a.outputLookupLink');
      for (const a of links) {
        const href = a.getAttribute('href') || '';
        // Opportunity record IDs start with 006.
        if (/\/lightning\/r\/(?:Opportunity\/)?006[A-Za-z0-9]{12,16}/.test(href)) return a;
      }
      return null;
    }, 25000);

    let href = link.getAttribute('href');
    if (href.startsWith('/')) href = location.origin + href;
    if (!/\/lightning\/r\/Opportunity\//.test(href)) {
      href = href.replace(/\/lightning\/r\/(006[A-Za-z0-9]+)/, '/lightning/r/Opportunity/$1');
    }
    return href;
  }

  // -------- step 2: on the opportunity page, click View All under Contact Roles --------
  async function getContacts() {
    progress('Finding Contact Roles…');
    const viewAll = await waitFor(function () {
      const spans = document.querySelectorAll('span.view-all-label');
      for (const s of spans) {
        const a = s.querySelector('.assistiveText');
        if (a && /contact roles/i.test(a.textContent || '')) {
          return s.closest('a, button') || s.parentElement;
        }
      }
      return null;
    }, 30000);
    viewAll.click();

    progress('Reading the contact list…');
    const contacts = await waitFor(function () {
      const emailLinks = document.querySelectorAll('a.emailuiFormattedEmail, a[href^="mailto:"]');
      if (emailLinks.length === 0) return null;
      const seen = new Set();
      const out = [];
      emailLinks.forEach(function (a) {
        const row = a.closest('tr') || a.closest('[role="row"]');
        if (!row) return;
        let role = '';
        const labeled = row.querySelector('[data-label="Role"]');
        if (labeled) role = (labeled.textContent || '').trim();
        if (!role) {
          const cells = row.querySelectorAll('td, th, [role="gridcell"]');
          // contact name | role | phone | email — role is index 1 or 2 depending on layout
          for (let i = 1; i < Math.min(cells.length, 4); i++) {
            const t = (cells[i].textContent || '').trim();
            if (t && !/^\+?\d/.test(t) && !/@/.test(t)) { role = t; break; }
          }
        }
        const emailText = (a.textContent || '').trim();
        const emailFromHref = (a.getAttribute('href') || '').replace(/^mailto:/i, '');
        const email = (emailText || emailFromHref).trim();
        const key = email.toLowerCase();
        if (email && !seen.has(key)) {
          seen.add(key);
          out.push({ role: role, email: email });
        }
      });
      // Require at least one named role to consider the table fully loaded.
      return out.length && out.some(function (x) { return x.role; }) ? out : null;
    }, 30000);

    progress('Found ' + contacts.length + ' contacts.');
    return contacts;
  }
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
