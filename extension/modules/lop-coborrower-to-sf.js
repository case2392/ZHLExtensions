// ZHL Productivity Pack module — feature key: feature_coborrowerToSf
//
// Adds an "Add Co-Borrower to Salesforce" button next to each
// co-borrower's "Resend Link" button on the LOP Full Application page.
// Clicking it reads the co-borrower's first name, last name, cell
// phone, and email, plus the primary borrower's name (to match the
// right Salesforce lead), and hands them to the background worker.
//
// The background worker finds the open Salesforce Lightning tab,
// focuses it, and asks the Salesforce-side module (sf-add-coborrower.js)
// to open New Contact and fill the form. We do NOT auto-submit — the
// LO reviews the filled modal and clicks Next/Save themselves.

(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_coborrowerToSf';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[ZHL Co-borrower→SF v' + VERSION + '] loaded');

  const BTN_ATTR = 'data-zhl-coborrower-sf-btn';
  const ZHL_TIP = 'Built by Justin Case. Karma appreciated 💛';

  function track(event, props) {
    try { chrome.runtime.sendMessage({ type: 'TRACK', event, props: props || {} }); } catch (_) {}
  }

  function isOnFullApp() {
    return /\/loan-officer-portal\//.test(location.pathname);
  }

  // Read first/last/cell/email out of a personal-info-section scope.
  function readBorrowerFromSection(section) {
    if (!section) return null;
    function val(name) {
      const inp = section.querySelector('input[name="' + name + '"]');
      return inp ? (inp.value || '').trim() : '';
    }
    return {
      first: val('first'),
      last: val('last'),
      cell: val('cellPhoneNumber'),
      email: val('email')
    };
  }

  // Borrower personal-info-section: [data-cy="personal-info-section-<idx>"].
  function sectionForIndex(idx) {
    return document.querySelector('[data-cy="personal-info-section-' + idx + '"]');
  }

  function primarySection(coIdx) {
    // Primary is any personal-info-section that ISN'T the co-borrower's.
    // Prefer index 0; fall back to the first non-co-borrower section.
    const zero = sectionForIndex('0');
    if (zero && String(coIdx) !== '0') return zero;
    const all = document.querySelectorAll('[data-cy^="personal-info-section-"]');
    for (const s of all) {
      const cy = s.getAttribute('data-cy') || '';
      if (cy !== 'personal-info-section-' + coIdx) return s;
    }
    return null;
  }

  function onClick(btn, coIdx) {
    const coSection = sectionForIndex(coIdx);
    const co = readBorrowerFromSection(coSection);
    if (!co || (!co.first && !co.last)) {
      flash(btn, 'No co-borrower name found', true);
      return;
    }
    const primSection = primarySection(coIdx);
    const prim = readBorrowerFromSection(primSection) || {};
    const primaryName = [prim.first, prim.last].filter(Boolean).join(' ').trim();

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Sending to Salesforce…';
    track('coborrower_to_sf_click', { hasEmail: !!co.email, hasCell: !!co.cell });

    let settled = false;
    const finish = function (resp) {
      if (settled) return;
      settled = true;
      btn.disabled = false;
      btn.textContent = original;
      if (resp && resp.ok) {
        flash(btn, '✓ Filled in Salesforce — review & Save', false);
      } else {
        const reason = (resp && resp.reason) || 'No matching Salesforce lead tab open';
        flash(btn, '✗ ' + reason, true);
      }
    };
    try {
      chrome.runtime.sendMessage({
        type: 'ZHL_ADD_COBORROWER_TO_SF',
        payload: {
          coborrower: co,
          primaryName: primaryName
        }
      }, function (resp) {
        if (chrome.runtime.lastError) { finish({ ok: false, reason: chrome.runtime.lastError.message }); return; }
        finish(resp);
      });
    } catch (e) {
      finish({ ok: false, reason: (e && e.message) || 'send failed' });
    }
    // Safety timeout in case the background never responds.
    setTimeout(function () { finish({ ok: false, reason: 'Timed out — is Salesforce open?' }); }, 20000);
  }

  // Transient inline status message under the button.
  function flash(btn, msg, isError) {
    let note = btn.parentElement && btn.parentElement.querySelector('[data-zhl-coborrower-sf-note]');
    if (!note) {
      note = document.createElement('div');
      note.setAttribute('data-zhl-coborrower-sf-note', '1');
      note.style.cssText = 'font:600 11px Arial,Helvetica,sans-serif;margin-top:4px;width:100%;';
      if (btn.parentElement) btn.parentElement.appendChild(note);
    }
    note.style.color = isError ? '#b91c1c' : '#15803d';
    note.textContent = msg;
    clearTimeout(note.__t);
    note.__t = setTimeout(function () { if (note) note.textContent = ''; }, 6000);
  }

  function ensureButtons() {
    if (!isOnFullApp()) return;
    // Iterate over personal-info-sections directly rather than the
    // Resend Link button. The Resend Link doesn't always render
    // (e.g. when the co-borrower's email is blank LOP hides / disables
    // it) — so anchoring on the section's own header keeps our button
    // present regardless, just disabled when prerequisites are missing.
    const sections = document.querySelectorAll('[data-cy^="personal-info-section-"]');
    sections.forEach(function (section) {
      if (section.offsetParent === null) return;
      const cy = section.getAttribute('data-cy') || '';
      const m = /personal-info-section-(\d+)/.exec(cy);
      const coIdx = m ? m[1] : null;
      if (coIdx == null) return;
      // Only mount on co-borrower sections. The header's role tag
      // ("Primary borrower" vs "Co-borrower") lives in a StyledTag
      // element near the top of the section.
      const tagSpan = section.querySelector('[class*="StyledTag"]');
      if (!tagSpan) return;
      const tagText = (tagSpan.textContent || '').toLowerCase();
      if (tagText.indexOf('co-borrower') === -1 && tagText.indexOf('coborrower') === -1) return;
      const tagWrap = tagSpan.parentElement;
      const headerFlex = tagWrap && tagWrap.parentElement;
      if (!tagWrap || !headerFlex) return;

      // Read the co-borrower's current values so we can decide
      // enabled/disabled state.
      const co = readBorrowerFromSection(section) || {};
      const missing = [];
      if (!co.first) missing.push('legal first name');
      if (!co.last) missing.push('legal last name');
      if (!co.cell && !co.email) missing.push('cell phone or email');
      const enabled = missing.length === 0;

      let btn = tagWrap.querySelector('[' + BTN_ATTR + ']');
      if (!btn) {
        btn = document.createElement('button');
        btn.setAttribute(BTN_ATTR, '1');
        btn.type = 'button';
        btn.textContent = 'Add Co-Borrower to Salesforce';
        // Mirror the Resend Link text-button feel but make it clearly ours.
        btn.style.cssText =
          'display:inline-flex;align-items:center;justify-content:center;' +
          'background:#006aff;color:#fff;border:1px solid #006aff;border-radius:4px;' +
          'cursor:pointer;font-family:Arial,Helvetica,sans-serif;font-weight:600;' +
          'font-size:12px;line-height:1.2;padding:6px 12px;margin-left:10px;' +
          'box-sizing:border-box;white-space:nowrap;flex:0 0 auto;';
        btn.addEventListener('mouseenter', function () {
          if (!btn.disabled) btn.style.background = '#0056d2';
        });
        btn.addEventListener('mouseleave', function () {
          btn.style.background = btn.disabled ? '#cbd5e1' : '#006aff';
        });
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (btn.disabled) return;
          onClick(btn, btn.dataset.zhlCoidx || coIdx);
        });
        // Placement: append at the END of the role-tag wrapper. This
        // keeps the outer header Flex (tag-wrapper + Resend Link) at
        // two children so Resend Link stays pinned at far right when
        // it's present, and appending at the END of a React-managed
        // container leaves React's child diff alone so the header
        // doesn't scramble on the next re-render.
        tagWrap.appendChild(btn);
      }

      // Track the co-borrower index in case sections reorder.
      btn.dataset.zhlCoidx = coIdx;

      // Refresh enabled / styling / tooltip on every scan so the
      // button reflects the latest form state (the LO can type a
      // missing email and it should re-enable without a refresh).
      const ZHL_TIP_BASE = 'Built by Justin Case. Karma appreciated 💛';
      if (enabled) {
        btn.disabled = false;
        btn.style.background = '#006aff';
        btn.style.borderColor = '#006aff';
        btn.style.color = '#fff';
        btn.style.cursor = 'pointer';
        btn.style.opacity = '1';
        btn.title = 'Open New Contact on the matching Salesforce lead and fill the co-borrower in.\n\n' + ZHL_TIP_BASE;
      } else {
        btn.disabled = true;
        btn.style.background = '#cbd5e1';
        btn.style.borderColor = '#cbd5e1';
        btn.style.color = '#475569';
        btn.style.cursor = 'not-allowed';
        btn.style.opacity = '0.85';
        const reason = 'Cannot send to Salesforce yet — missing: ' + missing.join(', ') + '.\n\nFill the field(s) above and the button will enable.\n\n' + ZHL_TIP_BASE;
        btn.title = reason;
      }
    });
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      try { ensureButtons(); } catch (e) { console.error('[ZHL Co-borrower→SF] scan error', e); }
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
