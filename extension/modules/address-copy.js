// ZHL Productivity Pack module — feature key: feature_copyAddresses
//
// Adds a "Copy addresses from primary" button next to each empty
// co-borrower's "Add address" button on the LOP full-application page.
// Clicking it walks every address on the primary borrower's list and
// re-adds it for the co-borrower, leaning on LOP's own "Use existing
// address" dropdown to fill street/city/state/zip/country, then driving
// the four fields LOP leaves blank: address type, mailing-same-as
// checkbox, housing type, and the move-in / move-out dates.
//
// Idempotency: the button only renders when the destination section has
// zero addresses. If the destination already has any row, the button is
// suppressed so we never silently append duplicates.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_copyAddresses';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[Address Copy v' + VERSION + '] loaded');

  const COPY_BUTTON_ATTR = 'data-zhl-copy-addresses';
  const ZHL_TIP = 'Built by Justin Case. Karma appreciated 💛';

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function isOnFullApplicationPage() {
    return /\/loan-officer-portal\/[^/]+\/full-application(\/|$|\?)/.test(location.pathname);
  }

  // ---- Source parsing -----------------------------------------------------

  function parseAddressesFromSection(section) {
    const addresses = [];
    const table = section.querySelector('table[aria-label="Table for addresses"]');
    if (!table) return addresses;
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(function (tr) {
      const cells = tr.querySelectorAll('td');
      if (cells.length < 7) return; // summary / empty-state row
      const type = (cells[1].textContent || '').trim();
      const addressLine = (cells[2].textContent || '').trim();
      const housing = (cells[3].textContent || '').trim();
      const moveIn = (cells[4].textContent || '').trim();
      const moveOut = (cells[5].textContent || '').trim();
      const rent = (cells[6].textContent || '').trim();
      if (!addressLine) return;
      const lowerType = type.toLowerCase();
      addresses.push({
        type: /previous/.test(lowerType) ? 'previous' : 'current',
        isMailingSame: /mailing/.test(lowerType),
        addressLine: addressLine,
        housing: housing,
        moveIn: moveIn,
        moveOut: moveOut,
        rent: rent
      });
    });
    return addresses;
  }

  function isSectionEmpty(section) {
    const table = section.querySelector('table[aria-label="Table for addresses"]');
    if (!table) return true;
    const dataRows = Array.from(table.querySelectorAll('tbody tr')).filter(function (tr) {
      const cells = tr.querySelectorAll('td');
      if (cells.length < 7) return false;
      return (cells[2].textContent || '').trim() !== '';
    });
    return dataRows.length === 0;
  }

  // ---- Form discovery -----------------------------------------------------

  // After clicking Add address, the edit form is appended inside the
  // section. Identify it as the closest descendant that contains a
  // Cancel button AND an Add or Save button at its footer.
  function findOpenForm(destSection) {
    const buttons = destSection.querySelectorAll('button');
    for (const b of buttons) {
      const t = (b.textContent || '').trim().toLowerCase();
      if (t !== 'add' && t !== 'save') continue;
      let p = b.parentElement;
      for (let depth = 0; depth < 8 && p && p !== destSection; depth++) {
        const cancel = Array.from(p.querySelectorAll('button')).find(function (x) {
          return (x.textContent || '').trim().toLowerCase() === 'cancel';
        });
        if (cancel) return p;
        p = p.parentElement;
      }
    }
    return null;
  }

  async function waitForForm(destSection, maxMs) {
    const start = Date.now();
    const max = maxMs || 3000;
    while (Date.now() - start < max) {
      const f = findOpenForm(destSection);
      if (f) return f;
      await wait(80);
    }
    return null;
  }

  async function waitForFormClose(destSection, maxMs) {
    const start = Date.now();
    const max = maxMs || 4000;
    while (Date.now() - start < max) {
      if (!findOpenForm(destSection)) return true;
      await wait(80);
    }
    return false;
  }

  // ---- Field finders ------------------------------------------------------

  // Walk descendants of `form`, find an element whose text content trims
  // to `labelText` (or matches the regex), then return the next form
  // control of `tag` within the same wrapper group.
  function findFieldByLabel(form, labelText, tag) {
    const matcher = typeof labelText === 'string'
      ? function (txt) { return txt === labelText; }
      : function (txt) { return labelText.test(txt); };
    const all = form.querySelectorAll('label, span, div, h4, h5, h6, p');
    for (const lbl of all) {
      // textContent matches if THIS node's own text (ignoring nested
      // text) equals the label. We approximate by checking the trimmed
      // textContent — labels are short single-line elements.
      const txt = (lbl.textContent || '').trim();
      if (!txt || !matcher(txt)) continue;
      // Look within the immediate ancestor wrappers for the control.
      let p = lbl.parentElement;
      for (let depth = 0; depth < 4 && p; depth++) {
        const found = p.querySelector(tag);
        if (found) return found;
        p = p.parentElement;
      }
    }
    return null;
  }

  function findCheckboxByLabel(form, labelRegex) {
    const all = form.querySelectorAll('label, span, div');
    for (const el of all) {
      const txt = (el.textContent || '').trim();
      if (!txt || !labelRegex.test(txt)) continue;
      // Check the label itself and its ancestors for a checkbox.
      let p = el;
      for (let depth = 0; depth < 4 && p; depth++) {
        const cb = p.querySelector('input[type="checkbox"]');
        if (cb) return cb;
        p = p.parentElement;
      }
    }
    return null;
  }

  function findSubmitButton(form) {
    const buttons = form.querySelectorAll('button');
    for (const b of buttons) {
      const t = (b.textContent || '').trim().toLowerCase();
      if (t === 'add' || t === 'save') return b;
    }
    return null;
  }

  // ---- React-aware setters ------------------------------------------------

  function setReactInputValue(input, value) {
    if (!input) return false;
    let viaExec = false;
    try {
      input.focus();
      try { input.setSelectionRange(0, (input.value || '').length); }
      catch (_) { try { input.select(); } catch (__) {} }
      viaExec = document.execCommand && document.execCommand('insertText', false, String(value));
    } catch (_) { viaExec = false; }
    if (!viaExec || String(input.value) !== String(value)) {
      const proto = Object.getPrototypeOf(input);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(input, value);
      else input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    return String(input.value) === String(value);
  }

  function setReactSelectValue(select, value) {
    if (!select) return false;
    if (String(select.value) === String(value)) return true;
    const proto = Object.getPrototypeOf(select);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    try {
      if (desc && desc.set) desc.set.call(select, value);
      else select.value = value;
    } catch (_) { select.value = value; }
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.dispatchEvent(new Event('blur', { bubbles: true }));
    return String(select.value) === String(value);
  }

  // Match a <select>'s option by visible text (case-insensitive, trims
  // surrounding whitespace, normalizes internal whitespace). Returns
  // the option's value attribute so we can pass it to setReactSelectValue.
  function findOptionValueByText(select, targetText, opts) {
    opts = opts || {};
    const want = String(targetText).trim().replace(/\s+/g, ' ').toLowerCase();
    for (const o of select.options) {
      const t = (o.text || '').trim().replace(/\s+/g, ' ').toLowerCase();
      if (!t) continue;
      if (opts.startsWith) {
        if (t.indexOf(want) === 0) return o.value;
      } else if (opts.includes) {
        if (t.indexOf(want) !== -1) return o.value;
      } else {
        if (t === want) return o.value;
      }
    }
    return null;
  }

  // ---- Per-address copy ---------------------------------------------------

  async function copyOneAddress(destSection, addr, idx, total) {
    console.group('[Address Copy] ' + (idx + 1) + '/' + total + ' — ' + addr.addressLine);
    try {
      const addBtn = destSection.querySelector('button[data-cy="add-entity-button"]');
      if (!addBtn) { console.warn('Add address button not found'); return false; }
      addBtn.click();
      const form = await waitForForm(destSection);
      if (!form) { console.warn('Add address form never opened'); return false; }

      // 1. Address type
      const typeSel = findFieldByLabel(form, 'Address type', 'select');
      if (typeSel) {
        const wantText = addr.type === 'previous' ? 'previous address' : 'current address';
        const v = findOptionValueByText(typeSel, wantText) ||
                  findOptionValueByText(typeSel, addr.type, { startsWith: true });
        if (v != null) setReactSelectValue(typeSel, v);
        else console.warn('Address type option not found for', addr.type);
      } else {
        console.warn('Address type select not found');
      }
      await wait(120);

      // 2. Mailing same as current/previous — only when the source row
      //    had "Mailing" in its type. Use the checkbox's current state
      //    to decide whether to click.
      if (addr.isMailingSame) {
        const cb = findCheckboxByLabel(form, /mailing\s+same\s+as/i);
        if (cb && !cb.checked) {
          cb.click();
          await wait(80);
        }
      }

      // 3. Use existing address — picks our source's full address line.
      //    This is the heavy lifter: LOP populates street / city / state
      //    / zip / country in one shot, none of which we'd otherwise be
      //    able to drive without poking the State and Country dropdowns.
      const existingSel = findFieldByLabel(form, /^Use existing address$/, 'select');
      if (existingSel) {
        let v = findOptionValueByText(existingSel, addr.addressLine);
        if (v == null) {
          // Some option strings include "(Current)" / "(Previous)" suffixes.
          v = findOptionValueByText(existingSel, addr.addressLine, { startsWith: true }) ||
              findOptionValueByText(existingSel, addr.addressLine, { includes: true });
        }
        if (v != null) {
          setReactSelectValue(existingSel, v);
          await wait(200);
        } else {
          console.warn('Use existing address option not found for', addr.addressLine);
          console.warn('Available options:', Array.from(existingSel.options).map(function (o) { return o.text; }));
          // Cancel this form rather than save partial data.
          const cancel = Array.from(form.querySelectorAll('button')).find(function (b) {
            return (b.textContent || '').trim().toLowerCase() === 'cancel';
          });
          if (cancel) cancel.click();
          return false;
        }
      } else {
        console.warn('Use existing address select not found');
      }

      // 4. Housing type — source shows "Own" / "Rent" / "Live rent free".
      const housingSel = findFieldByLabel(form, 'Housing type', 'select');
      if (housingSel && addr.housing) {
        const v = findOptionValueByText(housingSel, addr.housing);
        if (v != null) setReactSelectValue(housingSel, v);
        else console.warn('Housing type option not found for', addr.housing);
      }
      await wait(80);

      // 5. Move in date (always present)
      const moveInInput = findFieldByLabel(form, 'Move in date', 'input');
      if (moveInInput && addr.moveIn) {
        setReactInputValue(moveInInput, normalizeDate(addr.moveIn));
      }

      // 6. Move out date (Previous addresses only)
      if (addr.type === 'previous' && addr.moveOut && !/present/i.test(addr.moveOut)) {
        const moveOutInput = findFieldByLabel(form, 'Move out date', 'input');
        if (moveOutInput) setReactInputValue(moveOutInput, normalizeDate(addr.moveOut));
      }

      // 7. Submit
      await wait(200);
      const submit = findSubmitButton(form);
      if (!submit) { console.warn('Submit button not found'); return false; }
      if (submit.disabled || submit.getAttribute('aria-disabled') === 'true') {
        console.warn('Submit button is disabled — form likely failed validation. Check fields above.');
        return false;
      }
      submit.click();
      const closed = await waitForFormClose(destSection);
      if (!closed) console.warn('Form did not close after Save — borrower may still be open.');
      await wait(300); // let LOP re-render the table
      return true;
    } finally {
      console.groupEnd();
    }
  }

  // LOP's date inputs accept "M/D/YYYY" as displayed but want
  // "MM/DD/YYYY" when typed via the input. Normalize so "1/1/2025"
  // becomes "01/01/2025" and "9/1/2020" becomes "09/01/2020".
  function normalizeDate(s) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s).trim());
    if (!m) return s;
    const mm = m[1].padStart(2, '0');
    const dd = m[2].padStart(2, '0');
    return mm + '/' + dd + '/' + m[3];
  }

  // ---- Whole-section copy ------------------------------------------------

  async function copyAllAddresses(sourceSection, destSection, btn) {
    const addrs = parseAddressesFromSection(sourceSection);
    if (!addrs.length) { alert('No addresses on the primary borrower to copy.'); return; }
    if (!confirm('Copy ' + addrs.length + ' address(es) from the primary borrower to this co-borrower?')) return;

    const origText = btn.textContent;
    btn.disabled = true;
    let ok = 0, fail = 0;
    console.group('[Address Copy] run — ' + addrs.length + ' address(es)');
    try {
      for (let i = 0; i < addrs.length; i++) {
        btn.textContent = 'Copying ' + (i + 1) + '/' + addrs.length + '…';
        const success = await copyOneAddress(destSection, addrs[i], i, addrs.length);
        if (success) ok++; else fail++;
        if (fail && fail >= 2) {
          console.warn('Bailing after 2 consecutive failures — likely a structural mismatch.');
          break;
        }
      }
    } catch (e) {
      console.error('[Address Copy] run failed:', e);
      alert('Address copy error: ' + (e && e.message || e));
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
      console.log('[Address Copy] done. ok=' + ok + ' failed=' + fail);
      console.groupEnd();
    }

    try {
      chrome.runtime.sendMessage({
        type: 'TRACK',
        event: 'address_copy_run',
        props: { requested: addrs.length, ok: ok, failed: fail }
      });
    } catch (_) {}

    if (fail) {
      alert('Copied ' + ok + ' of ' + addrs.length + ' addresses. ' + fail + ' failed — see browser console (F12 → Console).');
    }
  }

  // ---- Button injection / scan -------------------------------------------

  function injectButton(destSection, sourceSection) {
    if (destSection.querySelector('[' + COPY_BUTTON_ATTR + ']')) return;
    const addBtn = destSection.querySelector('button[data-cy="add-entity-button"]');
    if (!addBtn) return;
    const btn = document.createElement('button');
    btn.setAttribute(COPY_BUTTON_ATTR, '1');
    btn.type = 'button';
    btn.textContent = 'Copy addresses from primary';
    btn.title = 'Copy every address from the primary borrower\'s list into this co-borrower\'s list.\nUses LOP\'s "Use existing address" picker to avoid retyping street/city/state/zip.\n\n' + ZHL_TIP;
    btn.style.cssText =
      'margin-left:12px;padding:6px 14px;' +
      'background:#006aff;color:#fff;border:1px solid #006aff;' +
      'border-radius:4px;font:600 13px/1 Arial,sans-serif;cursor:pointer;';
    btn.addEventListener('mouseenter', function () { if (!btn.disabled) btn.style.background = '#0056d2'; });
    btn.addEventListener('mouseleave', function () { btn.style.background = btn.disabled ? '#94a3b8' : '#006aff'; });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      copyAllAddresses(sourceSection, destSection, btn);
    });
    addBtn.insertAdjacentElement('afterend', btn);
  }

  function removeAllButtons() {
    document.querySelectorAll('[' + COPY_BUTTON_ATTR + ']').forEach(function (b) { b.remove(); });
  }

  function scan() {
    if (!isOnFullApplicationPage()) { removeAllButtons(); return; }
    const sections = document.querySelectorAll('[data-cy^="address-section-"]');
    if (sections.length < 2) { removeAllButtons(); return; }
    const primary = sections[0];
    if (isSectionEmpty(primary)) { removeAllButtons(); return; }
    for (let i = 1; i < sections.length; i++) {
      const dest = sections[i];
      if (isSectionEmpty(dest)) {
        injectButton(dest, primary);
      } else {
        const stale = dest.querySelector('[' + COPY_BUTTON_ATTR + ']');
        if (stale) stale.remove();
      }
    }
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      try { scan(); } catch (e) { console.warn('[Address Copy] scan error', e); }
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(schedule, 2000);
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
