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
  // section. Find the wrapping div that contains the field labels —
  // NOT just the footer that holds Cancel + Add (those two buttons
  // live in their own row inside the form, so the smallest common
  // ancestor of them is just the footer, which doesn't include the
  // labels). We require the ancestor to contain the canonical
  // "Address type" and "Street address" label text so we know we got
  // the whole form.
  function findOpenForm(destSection) {
    const buttons = destSection.querySelectorAll('button');
    for (const b of buttons) {
      const t = (b.textContent || '').trim().toLowerCase();
      if (t !== 'add' && t !== 'save') continue;
      let p = b.parentElement;
      for (let depth = 0; depth < 14 && p && p !== destSection; depth++) {
        const text = (p.textContent || '').toLowerCase();
        if (text.indexOf('address type') !== -1 && text.indexOf('street address') !== -1) {
          return p;
        }
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

  function norm(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

  // Strip the trailing markers c11n adds to required / help-iconed labels
  // so "Address type *" / "Mailing same as current address ?" become
  // "Address type" / "Mailing same as current address" for matching.
  function cleanLabel(s) {
    return String(s || '').trim().replace(/[\s*?]+$/g, '').trim();
  }

  // Find the label element that matches `labelText` (string === or regex).
  // Only inspects single-line label-like elements (label/span/p/headings)
  // because divs typically wrap the label AND its control, so their
  // textContent is the label + the field value.
  function findLabel(form, labelText) {
    const matcher = typeof labelText === 'string'
      ? function (t) { return cleanLabel(t) === labelText; }
      : function (t) { return labelText.test(t); };
    const all = form.querySelectorAll('label, span, p, h4, h5, h6');
    for (const el of all) {
      const txt = (el.textContent || '').trim();
      if (!txt || !matcher(txt)) continue;
      return el;
    }
    return null;
  }

  // From a label element, walk up at most `depth` levels and return the
  // first descendant of any of the requested tag/role types.
  function controlNear(labelEl, predicate, maxDepth) {
    let p = labelEl ? labelEl.parentElement : null;
    for (let d = 0; d < (maxDepth || 4) && p; d++) {
      const all = p.querySelectorAll('*');
      for (const el of all) {
        if (predicate(el)) return el;
      }
      p = p.parentElement;
    }
    return null;
  }

  function findCheckboxByLabel(form, labelRegex) {
    const lbl = findLabel(form, labelRegex);
    if (!lbl) return null;
    return controlNear(lbl, function (el) {
      return el.tagName === 'INPUT' && el.type === 'checkbox';
    });
  }

  function findTextInputByLabel(form, labelText) {
    const lbl = findLabel(form, labelText);
    if (!lbl) return null;
    return controlNear(lbl, function (el) {
      return el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'tel' || el.type === 'date' || el.type === '');
    });
  }

  function findSubmitButton(form) {
    const buttons = form.querySelectorAll('button');
    for (const b of buttons) {
      const t = (b.textContent || '').trim().toLowerCase();
      if (t === 'add' || t === 'save') return b;
    }
    return null;
  }

  // ---- Dropdown handling (native + custom) --------------------------------

  // Set a dropdown field by its label and the option's visible text.
  // Tries native <select> first, then falls back to a custom React
  // dropdown (button[aria-haspopup] / [role="combobox"]).
  async function setDropdownByLabel(form, labelText, optionText, opts) {
    opts = opts || {};
    const lbl = findLabel(form, labelText);
    if (!lbl) {
      console.warn('  [dropdown] label not found:', labelText);
      return false;
    }
    console.log('  [dropdown] label found:', labelText);

    // Walk up to find a native select OR a dropdown trigger.
    let p = lbl.parentElement;
    for (let d = 0; d < 5 && p; d++) {
      const native = p.querySelector('select');
      if (native) {
        console.log('  [dropdown] native <select> found near "' + labelText + '"');
        const want = norm(optionText);
        let value = null;
        for (const o of native.options) {
          const t = norm(o.text);
          if (t === want) { value = o.value; break; }
        }
        if (value == null) {
          for (const o of native.options) {
            const t = norm(o.text);
            if (t.indexOf(want) === 0 || t.indexOf(want) !== -1) { value = o.value; break; }
          }
        }
        if (value == null) {
          console.warn('  [dropdown] no native option for "' + optionText + '" — available:',
            Array.from(native.options).map(function (o) { return o.text; }));
          return false;
        }
        return setReactSelectValue(native, value);
      }
      // Custom React dropdown trigger detection. Constellation uses
      // button[aria-haspopup="listbox"] (or "true") with a chevron.
      const trigger = p.querySelector(
        'button[aria-haspopup="listbox"], button[aria-haspopup="true"], [role="combobox"], button[aria-expanded]'
      );
      if (trigger && p.contains(trigger) && trigger !== lbl) {
        console.log('  [dropdown] custom trigger found near "' + labelText + '":', trigger.tagName, trigger.textContent && trigger.textContent.trim().slice(0, 40));
        return await pickCustomOption(trigger, optionText, opts);
      }
      p = p.parentElement;
    }
    console.warn('  [dropdown] no control found near label "' + labelText + '"');
    return false;
  }

  async function pickCustomOption(trigger, optionText, opts) {
    opts = opts || {};
    try { trigger.click(); } catch (e) { console.warn('  [dropdown] trigger.click() threw', e); }
    await wait(180);
    const want = norm(optionText);
    const start = Date.now();
    const optionSelectors = [
      '[role="option"]',
      'li[role="option"]',
      '[role="listbox"] [role="option"]',
      '[role="menu"] [role="menuitem"]',
      'li[role="menuitem"]'
    ];
    while (Date.now() - start < 2500) {
      for (const sel of optionSelectors) {
        const all = document.querySelectorAll(sel);
        for (const o of all) {
          if (o.offsetParent === null && o.getClientRects().length === 0) continue;
          const t = norm(o.textContent);
          let match = (t === want);
          if (!match && opts.startsWith) match = (t.indexOf(want) === 0);
          if (!match && opts.includes) match = (t.indexOf(want) !== -1);
          if (match) {
            console.log('  [dropdown] clicking custom option:', t);
            try { o.click(); } catch (e) { console.warn('  [dropdown] option.click() threw', e); }
            await wait(150);
            return true;
          }
        }
      }
      await wait(80);
    }
    // Timed out — log what's visible so the user can paste back.
    const visible = [];
    optionSelectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (o) {
        if (o.offsetParent === null) return;
        const t = (o.textContent || '').trim();
        if (t) visible.push(sel + ' → "' + t + '"');
      });
    });
    console.warn('  [dropdown] timed out waiting for option matching "' + optionText + '"; visible options:', visible);
    // Close any open popover by pressing Escape so the next iteration isn't blocked.
    try {
      document.activeElement && document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.body.click();
    } catch (_) {}
    return false;
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

  // ---- Per-address copy ---------------------------------------------------

  async function copyOneAddress(destSection, addr, idx, total) {
    console.group('[Address Copy] ' + (idx + 1) + '/' + total + ' — ' + addr.addressLine);
    try {
      console.log('source:', addr);
      const addBtn = destSection.querySelector('button[data-cy="add-entity-button"]');
      if (!addBtn) { console.warn('Add address button not found'); return false; }
      console.log('clicking Add address button…');
      addBtn.click();
      const form = await waitForForm(destSection);
      if (!form) { console.warn('Add address form never opened within 3s'); return false; }
      console.log('form opened:', form);
      // Give React a tick to mount form children (dropdown triggers etc.)
      await wait(250);

      // 1. Address type ----------------------------------------------------
      console.log('step 1: Address type →', addr.type === 'previous' ? 'Previous address' : 'Current address');
      const typeWant = addr.type === 'previous' ? 'Previous address' : 'Current address';
      const okType = await setDropdownByLabel(form, 'Address type', typeWant, { startsWith: true });
      if (!okType) console.warn('  → address type set failed');
      await wait(200);

      // 2. Mailing same as current/previous --------------------------------
      if (addr.isMailingSame) {
        console.log('step 2: ticking "Mailing same as current/previous" checkbox');
        const cb = findCheckboxByLabel(form, /mailing\s+same\s+as/i);
        if (!cb) console.warn('  → mailing checkbox not found');
        else if (cb.checked) console.log('  → already checked, skipping');
        else { cb.click(); await wait(120); }
      } else {
        console.log('step 2: skipped (source row had no "Mailing" in its type)');
      }

      // 3. Use existing address — the heavy lifter -------------------------
      console.log('step 3: Use existing address →', addr.addressLine);
      const okExisting = await setDropdownByLabel(form, 'Use existing address', addr.addressLine, { includes: true });
      if (!okExisting) {
        console.warn('  → Use existing address pick failed; canceling this form so we don\'t save partial data');
        const cancel = Array.from(form.querySelectorAll('button')).find(function (b) {
          return (b.textContent || '').trim().toLowerCase() === 'cancel';
        });
        if (cancel) cancel.click();
        await waitForFormClose(destSection, 2000);
        return false;
      }
      await wait(350); // let LOP populate street/city/state/zip/country

      // 4. Housing type ----------------------------------------------------
      if (addr.housing) {
        console.log('step 4: Housing type →', addr.housing);
        const okHousing = await setDropdownByLabel(form, 'Housing type', addr.housing, { startsWith: true });
        if (!okHousing) console.warn('  → housing type set failed');
      }
      await wait(150);

      // 5. Move in date ----------------------------------------------------
      const moveInDate = normalizeDate(addr.moveIn);
      console.log('step 5: Move in date →', moveInDate);
      const moveInInput = findTextInputByLabel(form, 'Move in date');
      if (!moveInInput) console.warn('  → move-in date input not found');
      else if (moveInDate) {
        const ok = setReactInputValue(moveInInput, moveInDate);
        console.log('  → move-in set ' + (ok ? 'ok' : 'FAILED') + ' (final value: "' + moveInInput.value + '")');
      }

      // 6. Move out date (Previous addresses only) -------------------------
      if (addr.type === 'previous' && addr.moveOut && !/present/i.test(addr.moveOut)) {
        const moveOutDate = normalizeDate(addr.moveOut);
        console.log('step 6: Move out date →', moveOutDate);
        const moveOutInput = findTextInputByLabel(form, 'Move out date');
        if (!moveOutInput) console.warn('  → move-out date input not found');
        else {
          const ok = setReactInputValue(moveOutInput, moveOutDate);
          console.log('  → move-out set ' + (ok ? 'ok' : 'FAILED') + ' (final value: "' + moveOutInput.value + '")');
        }
      } else {
        console.log('step 6: skipped (Current address or "Present" move-out)');
      }

      // 7. Submit ----------------------------------------------------------
      await wait(300);
      const submit = findSubmitButton(form);
      if (!submit) { console.warn('step 7: submit (Add/Save) button not found'); return false; }
      const disabled = submit.disabled || submit.getAttribute('aria-disabled') === 'true';
      if (disabled) {
        // Validation failed — dump the form's current state for debugging.
        console.warn('step 7: submit button is DISABLED — form did not validate. State dump:');
        dumpFormState(form);
        return false;
      }
      console.log('step 7: clicking submit (' + (submit.textContent || '').trim() + ')');
      submit.click();
      const closed = await waitForFormClose(destSection);
      if (!closed) console.warn('  → form did not close after submit (4s); LOP may have rejected it silently');
      await wait(400); // let LOP re-render the table
      console.log('done.');
      return true;
    } finally {
      console.groupEnd();
    }
  }

  // Debug helper — pretty-prints what's filled and what's blank in the form.
  function dumpFormState(form) {
    const fields = ['Address type', 'Use existing address', 'Street address', 'Unit', 'City', 'State', 'Zip code', 'Country', 'Housing type', 'Move in date', 'Move out date'];
    fields.forEach(function (lbl) {
      const lblEl = findLabel(form, lbl);
      if (!lblEl) { console.warn('  ·', lbl, '→ label not found'); return; }
      // Look at the closest input / select / button next to the label.
      const ctrl = controlNear(lblEl, function (el) {
        return el.tagName === 'INPUT' || el.tagName === 'SELECT' ||
               (el.tagName === 'BUTTON' && el.getAttribute('aria-haspopup'));
      });
      if (!ctrl) { console.warn('  ·', lbl, '→ no control near label'); return; }
      const val = ctrl.tagName === 'BUTTON'
        ? (ctrl.textContent || '').trim()
        : (ctrl.value || '');
      console.warn('  ·', lbl, '→', '"' + val + '"', ctrl);
    });
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
