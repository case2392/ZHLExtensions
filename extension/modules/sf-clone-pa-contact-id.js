// ZHL Productivity Pack module — feature key: feature_cloneLeadPaContactId
//
// Salesforce Lead clone helper: when an LO clones an Unqualified Lead,
// the new lead's PA Contact ID does NOT auto-populate. The LO has to
// remember the value, click the pencil on the new lead, paste it, and
// click Save — every single time, or the new lead never syncs with
// the agent's FUB lead.
//
// This module:
//   1. Watches for clicks on the Lead Clone quick action.
//   2. Captures the source lead's PA Contact ID at click time.
//   3. Augments the clone-confirmation modal with a banner explaining
//      what's about to happen + showing the captured ID (so the LO
//      always has it visible as a manual fallback).
//   4. Stashes the ID in chrome.storage.local with a short TTL.
//   5. On the next Lead page navigation (the new clone), waits for
//      the page to render, clicks the edit pencil for PA Contact ID,
//      types the value, and clicks Save.
//   6. Shows a brief toast on the new lead confirming success / failure.
//
// Safety: skips silently if the new lead already has a PA Contact ID
// (we don't want to overwrite on a re-clone), and only fires once per
// stash (clears storage after success or after the TTL).

(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_cloneLeadPaContactId';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[ZHL Clone PA v' + VERSION + '] loaded');

  const STORAGE_KEY = '_zhl_pa_clone_pending';
  const TTL_MS = 5 * 60 * 1000;
  const BANNER_ATTR = 'data-zhl-pa-banner';
  const ZHL_TIP = 'Built by Justin Case. Karma appreciated 💛';

  // ---- shadow-DOM helpers (mirror sf-add-coborrower's recipe) ----
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
  function isVisible(el) {
    if (!el) return false;
    if (el.offsetParent !== null) return true;
    try {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (_) { return false; }
  }
  function waitFor(predicate, timeoutMs, intervalMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        let v; try { v = predicate(); } catch (_) { v = null; }
        if (v) return resolve(v);
        if (Date.now() - start >= (timeoutMs || 8000)) return resolve(null);
        setTimeout(tick, intervalMs || 120);
      };
      tick();
    });
  }
  function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function leadIdFromUrl() {
    const m = location.pathname.match(/\/Lead\/([A-Za-z0-9]{15,18})\//);
    return m ? m[1] : '';
  }
  function isOnLeadPage() { return /\/lightning\/r\/Lead\//.test(location.pathname); }

  // ---- Read the PA Contact ID off the current lead ----------------
  // CRITICAL: Lightning Console keeps inactive workspace tabs mounted
  // in the DOM but hidden. If two Lead tabs are open (source + new
  // clone), a naïve deep-query returns the FIRST matching label —
  // which can be the source tab even when we mean to read the new
  // active tab. Filter by visibility so we only ever read the active
  // workspace tab's value.
  function readPaContactId() {
    const labels = deepQuerySelectorAll(document, '.test-id__field-label, span.test-id__field-label, label');
    for (const lbl of labels) {
      const txt = (lbl.textContent || '').trim();
      if (txt !== 'PA Contact ID') continue;
      const container = lbl.closest && lbl.closest('.slds-form-element');
      if (!container) continue;
      if (!isVisible(container)) continue; // skip hidden workspace tabs
      const valEl = container.querySelector('lightning-formatted-text, .test-id__field-value, output');
      if (!valEl) continue;
      const value = (valEl.textContent || '').trim();
      if (value) return value;
    }
    return '';
  }

  // ---- Storage helpers --------------------------------------------
  function stash(record) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [STORAGE_KEY]: record }, () => resolve(true));
      } catch (_) { resolve(false); }
    });
  }
  function loadStash() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORAGE_KEY], (data) => {
          const rec = data && data[STORAGE_KEY];
          if (!rec) return resolve(null);
          if (Date.now() - (rec.stashedAt || 0) > TTL_MS) {
            chrome.storage.local.remove([STORAGE_KEY]);
            return resolve(null);
          }
          resolve(rec);
        });
      } catch (_) { resolve(null); }
    });
  }
  function clearStash() {
    try { chrome.storage.local.remove([STORAGE_KEY]); } catch (_) {}
  }

  // ---- Confirmation modal banner ----------------------------------
  function findCloneConfirmModal() {
    const cr = deepQuerySelector(document, 'c-clone-request');
    if (!cr) return null;
    // Insert at the top of the c-clone-request body so the LO sees it
    // alongside the "Are you sure..." prompt.
    return cr;
  }
  function injectBanner(modal, paId) {
    if (!modal || modal.querySelector('[' + BANNER_ATTR + ']')) return;
    const banner = document.createElement('div');
    banner.setAttribute(BANNER_ATTR, '1');
    banner.style.cssText =
      'background:#eff6ff;border-left:4px solid #006aff;border-radius:4px;' +
      'padding:9px 12px;margin:0 0 10px 0;font:12px/1.4 Arial,Helvetica,sans-serif;' +
      'color:#0b3a73;';
    const head = document.createElement('div');
    head.style.cssText = 'font-weight:700;margin-bottom:3px;';
    head.textContent = 'ZHL Extension — auto-paste on clone';
    const body = document.createElement('div');
    body.style.cssText = 'margin-bottom:5px;';
    body.textContent = 'ZHL Extension will attempt to auto-paste the PA Contact ID onto the new lead. Please verify to confirm — this is how the Agent’s FUB lead and your SF lead sync.';
    const idLine = document.createElement('div');
    idLine.style.cssText = 'background:#fff;border:1px solid #cbd5e1;border-radius:4px;' +
      'padding:5px 8px;font:600 11px/1.3 ui-monospace,Menlo,monospace;color:#0f172a;';
    idLine.textContent = 'PA Contact ID (in case the paste did not work): ' + (paId || '(none on this lead)');
    banner.appendChild(head);
    banner.appendChild(body);
    banner.appendChild(idLine);
    // Insert at the c-clone-request level — ABOVE the inner slds-grid —
    // so the banner spans the full modal width instead of being
    // constrained to the message's 9-of-12 column. Also collapse the
    // empty 3-of-12 leading column so the "Are you sure..." text
    // aligns flush left below the banner.
    const grid = modal.querySelector ? modal.querySelector(':scope > .slds-grid, .slds-grid.slds-gutters') : null;
    if (grid && grid.parentElement === modal) {
      modal.insertBefore(banner, grid);
    } else {
      modal.insertBefore(banner, modal.firstChild);
    }
    try {
      const emptyCol = modal.querySelector('.slds-col.slds-size_3-of-12');
      if (emptyCol && !(emptyCol.textContent || '').trim()) {
        emptyCol.style.display = 'none';
      }
    } catch (_) {}
  }

  // ---- Full-viewport progress overlay (matches lop-file-copy /
  //      sms-mark-all-read style) -----------------------------------
  const PROGRESS_ID = 'zhl-pa-clone-progress';
  function showProgress(text, sub) {
    let overlay = document.getElementById(PROGRESS_ID);
    if (overlay) { updateProgress(text, sub); return overlay; }
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
      'animation:zhl-pa-clone-spin 0.8s linear infinite'
    ].join(';');
    const msg = document.createElement('div');
    msg.setAttribute('data-zhl-pa-msg', '1');
    msg.textContent = text || 'Working…';
    const subEl = document.createElement('div');
    subEl.setAttribute('data-zhl-pa-sub', '1');
    subEl.style.cssText = 'font:500 12px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#6b7280;max-width:340px;';
    subEl.textContent = sub || '';
    overlay.appendChild(spinner);
    overlay.appendChild(msg);
    overlay.appendChild(subEl);
    document.body.appendChild(overlay);
    if (!document.getElementById('zhl-pa-clone-spin-style')) {
      const style = document.createElement('style');
      style.id = 'zhl-pa-clone-spin-style';
      style.textContent = '@keyframes zhl-pa-clone-spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(style);
    }
    return overlay;
  }
  function updateProgress(text, sub) {
    const overlay = document.getElementById(PROGRESS_ID);
    if (!overlay) return;
    if (text != null) {
      const m = overlay.querySelector('[data-zhl-pa-msg]');
      if (m) m.textContent = text;
    }
    if (sub != null) {
      const s = overlay.querySelector('[data-zhl-pa-sub]');
      if (s) s.textContent = sub;
    }
  }
  function hideProgress() {
    const o = document.getElementById(PROGRESS_ID);
    if (o) o.remove();
  }

  // Realistic click for Lightning buttons that don't react to a
  // bare .click() — fire pointerdown/mousedown/pointerup/mouseup
  // before the click, mirroring a real user press.
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

  // ---- Bottom-right toast for the new-lead side ------------------
  function showToast(text, isError) {
    const id = 'zhl-pa-clone-toast';
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    const t = document.createElement('div');
    t.id = id;
    t.style.cssText =
      'position:fixed;right:20px;bottom:20px;z-index:2147483647;max-width:340px;' +
      'background:' + (isError ? '#fef2f2' : '#ecfdf5') + ';' +
      'border:1px solid ' + (isError ? '#fecaca' : '#a7f3d0') + ';' +
      'border-left:4px solid ' + (isError ? '#b91c1c' : '#10b981') + ';' +
      'border-radius:6px;padding:10px 14px;' +
      'font:13px/1.4 Arial,Helvetica,sans-serif;color:#0f172a;' +
      'box-shadow:0 6px 18px rgba(0,0,0,.15);';
    t.title = ZHL_TIP;
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => { try { t.remove(); } catch (_) {} }, 5000);
  }

  // ---- Click-time capture on Clone button -------------------------
  // Capture phase so we read PA Contact ID BEFORE Salesforce starts
  // its clone routine (which can rip the source field off the page).
  document.addEventListener('click', async function (e) {
    const btn = e.target && e.target.closest && e.target.closest('button');
    if (!btn) return;
    const name = (btn.getAttribute && btn.getAttribute('name')) || '';
    const text = (btn.textContent || '').trim();
    const isClone = name === 'Lead.Clone' || (text === 'Clone' && btn.closest('[data-target-selection-name="sfdc:QuickAction.Lead.Clone"]'));
    if (!isClone) return;
    if (!isOnLeadPage()) return;
    const id = readPaContactId();
    const sourceLeadId = leadIdFromUrl();
    console.log('[ZHL Clone PA] Clone clicked. Source lead:', sourceLeadId, 'PA Contact ID:', id || '(none)');
    if (id) {
      await stash({ sourceLeadId, paContactId: id, stashedAt: Date.now() });
    } else {
      console.log('[ZHL Clone PA] No PA Contact ID on source lead; nothing to auto-paste.');
    }
    // Watch for the confirmation modal and inject the banner.
    const modal = await waitFor(findCloneConfirmModal, 4000);
    if (modal) injectBanner(modal, id);
  }, true);

  // ---- Auto-paste on the new lead ---------------------------------
  async function tryAutoPasteOnCurrentPage() {
    if (!isOnLeadPage()) return;
    const pending = await loadStash();
    if (!pending || !pending.paContactId) return;
    const currentLeadId = leadIdFromUrl();
    if (!currentLeadId) return;
    // Don't fire on the source lead itself.
    if (currentLeadId === pending.sourceLeadId) return;

    // Wait briefly for the layout to render. The PA Contact ID
    // section sits inside the details panel which can take a moment
    // after the lead navigates in.
    const pencil = await waitFor(function () {
      const btns = deepQuerySelectorAll(document, 'button[title="Edit PA Contact ID"]');
      for (const b of btns) { if (isVisible(b)) return b; }
      return null;
    }, 12000);
    if (!pencil) {
      console.warn('[ZHL Clone PA] PA Contact ID pencil not found on new lead; leaving for LO to fill manually.');
      return;
    }

    // Read current value via the same label-anchored helper. If the
    // new lead already has a PA Contact ID set, don't overwrite.
    const existing = readPaContactId();
    if (existing && existing === pending.paContactId) {
      console.log('[ZHL Clone PA] New lead already has the same PA Contact ID; nothing to do.');
      clearStash();
      return;
    }
    if (existing) {
      console.warn('[ZHL Clone PA] New lead already has a different PA Contact ID (' + existing + '); skipping auto-paste to avoid overwrite.');
      clearStash();
      return;
    }

    console.log('[ZHL Clone PA] Auto-pasting PA Contact ID', pending.paContactId, 'into new lead', currentLeadId);
    showProgress('Auto-pasting PA Contact ID…', 'Opening the field for edit on the new lead.');

    realClick(pencil);
    await wait(350);

    const input = await waitFor(function () {
      return deepQuerySelector(document, 'input[name="PA_Contact_ID__c"]');
    }, 6000);
    if (!input) {
      console.warn('[ZHL Clone PA] Edit input did not appear after pencil click.');
      hideProgress();
      showToast('PA Contact ID auto-paste failed — please paste manually: ' + pending.paContactId, true);
      return;
    }

    updateProgress('Typing value…', 'Setting the input to ' + pending.paContactId + '.');
    // Focus, set, and commit through Lightning's reactive layer.
    // The native value setter + input/change is usually enough, but
    // some Lightning inline-edits need a focus + key sequence + blur
    // before they accept the value as "dirty" and enable Save.
    try { input.focus(); } catch (_) {}
    setNativeInputValue(input, pending.paContactId);
    try {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'End', bubbles: true }));
    } catch (_) {}
    await wait(120);
    try { input.blur(); } catch (_) {}
    await wait(400);

    updateProgress('Saving…', 'Clicking the Save button on the inline edit.');
    const saveBtn = await waitFor(function () {
      const btns = deepQuerySelectorAll(document, 'button[name="SaveEdit"]');
      for (const b of btns) {
        if (!isVisible(b)) continue;
        if (b.disabled) continue;
        if ((b.getAttribute('aria-disabled') || '').toLowerCase() === 'true') continue;
        return b;
      }
      // Fallback: a brand button labeled "Save" inside the inline-edit footer.
      const brands = deepQuerySelectorAll(document, 'button.slds-button_brand');
      for (const b of brands) {
        if (!isVisible(b)) continue;
        if (b.disabled) continue;
        if ((b.textContent || '').trim() === 'Save') return b;
      }
      return null;
    }, 6000);
    if (!saveBtn) {
      console.warn('[ZHL Clone PA] Save button not found (or stayed disabled) after value set.');
      hideProgress();
      showToast('PA Contact ID was filled but Save not found — click Save manually.', true);
      return;
    }
    realClick(saveBtn);
    // Wait for the inline edit to commit — the SaveEdit button
    // disappears from the DOM (or the edit footer collapses) once
    // the save lands. Verify before clearing the stash so a failed
    // save doesn't get reported as success.
    const committed = await waitFor(function () {
      // Heuristic: if the input is gone OR the readonly value now
      // matches what we set, the save committed.
      const stillEditing = deepQuerySelector(document, 'input[name="PA_Contact_ID__c"]');
      if (!stillEditing) return true;
      const current = readPaContactId();
      if (current === pending.paContactId) return true;
      return null;
    }, 6000);

    hideProgress();
    if (committed) {
      console.log('[ZHL Clone PA] PA Contact ID saved.');
      showToast('✓ PA Contact ID auto-pasted: ' + pending.paContactId, false);
      clearStash();
    } else {
      console.warn('[ZHL Clone PA] Save click fired but the edit did not commit. Likely needs a manual Save click.');
      showToast('PA Contact ID filled but did not save — click Save to commit: ' + pending.paContactId, true);
      // Don't clear stash — the next page nav (or page reload) can
      // retry if the value still isn't there.
    }
  }

  // ---- URL change watcher (Lightning console SPA) ----------------
  // Lightning navigates via pushState — listen rather than relying
  // on full page loads. Also poll as a backstop because workspace
  // tab activation doesn't always fire popstate.
  let lastHref = location.href;
  function onUrlMaybeChanged() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    // Give Salesforce a beat to render the new lead's details panel.
    setTimeout(tryAutoPasteOnCurrentPage, 1500);
  }
  window.addEventListener('popstate', onUrlMaybeChanged);
  const origPush = history.pushState;
  history.pushState = function () {
    const r = origPush.apply(this, arguments);
    setTimeout(onUrlMaybeChanged, 0);
    return r;
  };
  setInterval(onUrlMaybeChanged, 800);

  // Initial check after load — covers the case where the user
  // refreshed and we're already on the new lead.
  setTimeout(tryAutoPasteOnCurrentPage, 2500);
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
