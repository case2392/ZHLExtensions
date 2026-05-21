// ZHL Productivity Pack module — feature key: feature_fhaFlipRule
//
// FHA 90-Day Property Flip Rule checker. Per HUD Handbook 4000.1
// II.A.1.b.iv.A, FHA is not eligible to insure a mortgage when the
// contract of sale date is within 90 days of the seller's
// acquisition date. From 91–180 days, the file is eligible but
// requires a second appraisal if the resale price is ≥ 100% over
// the seller's purchase price. Beyond 180 days, no flip
// requirements apply.
//
// Injects a small card on the right rail under Loan Details with:
//   - Property address (pre-filled from the LOP loan)
//   - Seller's purchase date (manual entry — user looks up via the
//     "Look up on Zillow" shortcut button)
//   - Contract date (defaults to today, editable)
//   - Check button → result card with ✓ / ⚠ / ✗
//
// Card only renders when the loan's product is FHA.

(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_fhaFlipRule';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[FHA Flip Rule v' + VERSION + '] loaded');

  const CARD_ID = 'zhl-fha-flip-rule';
  const ZHL_TIP = 'Built by Justin Case. Karma appreciated 💛';

  // Persist user input across re-renders of the right rail (LOP
  // re-renders this section frequently). Keyed by loan id from URL.
  const stateByLoan = {};

  function loanKey() {
    const m = /\/loan-officer-portal\/([^/]+)\//.exec(location.pathname);
    return m ? m[1] : location.pathname;
  }

  // ---- FHA detection (mirrors fha-npr-warning.js) -----------------------

  function readProductName() {
    const spans = document.querySelectorAll('span');
    for (const sp of spans) {
      if ((sp.textContent || '').trim() !== 'Product name') continue;
      const cell = sp.parentElement;
      if (!cell) continue;
      const p = cell.querySelector('p');
      if (p) return (p.textContent || '').trim();
    }
    return '';
  }
  function isFhaProduct(name) {
    return /\bFHA\b/i.test(name || '');
  }

  // ---- Subject-property address scrape ----------------------------------

  function readSubjectAddress() {
    // Priority 1: the "Use existing address" select on the Subject
    // property section. LOP populates this dropdown with the loan's
    // property address as a non-selectable option even when the
    // individual street/city/state inputs are empty. The first real
    // option (after the "Select" placeholder) carries the full
    // formatted address.
    const existingSelect = document.querySelector('select[data-cy="select-existing-address"]');
    if (existingSelect) {
      for (const opt of existingSelect.options) {
        const v = (opt.value || '').trim();
        if (!v) continue;
        if (/^select$/i.test(v)) continue;
        // The value is the full "1707 Chatham Ridge Circle 108,
        // Charlotte, NC 28273" formatted string we want.
        if (v.length > 5 && /[A-Za-z]/.test(v) && /\d/.test(v)) return v;
      }
    }

    // Priority 2: build from the individual address inputs in the
    // Subject property section. Some loans have the street/city/state
    // populated even when the existing-address dropdown is blank.
    function readInput(name) {
      const el = document.querySelector('input[name="' + name + '"], select[name="' + name + '"]');
      return el ? (el.value || '').trim() : '';
    }
    const street = readInput('addressStreet');
    const unit = readInput('addressUnit');
    const city = readInput('addressCity');
    const state = readInput('addressState');
    const zip = readInput('addressZIP');
    const built = [
      street + (unit ? ' ' + unit : ''),
      city,
      [state, zip].filter(Boolean).join(' ')
    ].filter(function (s) { return s && s.trim(); }).join(', ');
    if (built && built.length > 5 && /\d/.test(built)) return built;

    // Priority 3: legacy label-walk fallback (older LOP layouts).
    const labels = ['Property address', 'Subject property', 'Subject address', 'Address'];
    for (const label of labels) {
      const els = document.querySelectorAll('span, dt, label, div');
      for (const el of els) {
        if ((el.textContent || '').trim() !== label) continue;
        const cell = el.parentElement;
        if (!cell) continue;
        const candidate = cell.querySelector('p, dd, .value, span:not(:first-child)');
        if (candidate) {
          const t = (candidate.textContent || '').trim();
          if (t && t.length > 5) return t;
        }
      }
    }
    return '';
  }

  // ---- Right-rail Loan Details host detection ---------------------------

  function findLoanDetailsHost() {
    // Look for the "Loan Details" heading on the right rail; we'll
    // inject our card right after the surrounding container.
    const headings = document.querySelectorAll('h6, h5, h4, h3');
    for (const h of headings) {
      if ((h.textContent || '').trim() === 'Loan Details') {
        // Walk up to a sensible block — the heading's parent
        // usually wraps the whole loan-details list.
        return h.parentElement;
      }
    }
    return null;
  }

  // ---- Date math --------------------------------------------------------

  function parseLocalDate(s) {
    // Accepts MM/DD/YYYY (LOP convention) and YYYY-MM-DD (native
    // <input type="date"> value format). Returns a Date at local
    // midnight or null.
    if (!s) return null;
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s).trim());
    if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s).trim());
    if (m) return new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    return null;
  }
  function daysBetween(a, b) {
    if (!a || !b) return null;
    return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
  }
  // Normalize Zillow's various date shapes to YYYY-MM-DD so it can
  // be assigned directly to <input type="date">.
  function toIsoDate(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
    if (m) return m[3] + '-' + String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');
    // ISO timestamp like "2025-08-15T00:00:00Z"
    m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    if (m) return m[1];
    return '';
  }

  function todayLocalDateString() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  function evaluateFlipRule(sellerDate, contractDate) {
    const days = daysBetween(sellerDate, contractDate);
    if (days == null) return null;
    if (days < 0) {
      return {
        days: days,
        tier: 'invalid',
        status: '✗',
        color: 'red',
        title: 'Contract date is BEFORE seller acquisition — check your inputs',
        detail: 'Seller can\'t have acquired the property after the contract date. Verify the dates.'
      };
    }
    if (days <= 90) {
      return {
        days: days,
        tier: '≤90 days',
        status: '✗',
        color: 'red',
        title: 'NOT ELIGIBLE for FHA — flip rule violated',
        detail: 'Contract date is within 90 days of seller\'s acquisition (' + days + ' days). FHA cannot insure this mortgage. Wait until day 91+ or switch to a non-FHA product.'
      };
    }
    if (days <= 180) {
      return {
        days: days,
        tier: '91–180 days',
        status: '⚠',
        color: 'amber',
        title: 'Eligible — but second appraisal may be required',
        detail: 'Resale falls in the 91–180 day window (' + days + ' days). FHA requires a SECOND appraisal if the resale price is ≥ 100% over the seller\'s purchase price. Confirm with the appraiser / UW before order.'
      };
    }
    return {
      days: days,
      tier: '>180 days',
      status: '✓',
      color: 'green',
      title: 'Eligible — no flip-rule restriction',
      detail: 'Resale is ' + days + ' days after seller\'s acquisition. No additional flip-rule requirements apply.'
    };
  }

  // ---- Card rendering ---------------------------------------------------

  function buildCard() {
    const persisted = stateByLoan[loanKey()] || {};

    const wrap = document.createElement('div');
    wrap.id = CARD_ID;
    wrap.style.cssText = [
      'margin-top: 14px',
      'padding: 12px 14px',
      'background: #ffffff',
      'border: 1px solid #d1d5db',
      'border-left: 4px solid #0b5cab',
      'border-radius: 8px',
      'font: 12.5px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif',
      'color: #1f2937'
    ].join(';');

    const h = document.createElement('div');
    h.style.cssText = 'font:700 13px/1.2 Arial,sans-serif;color:#0b5cab;margin-bottom:8px;';
    h.textContent = 'FHA 90-Day Flip Rule';
    h.title = 'HUD 4000.1 II.A.1.b.iv.A — FHA is not eligible to insure a mortgage when the contract of sale is within 90 days of the seller\'s acquisition date.\n\n' + ZHL_TIP;
    wrap.appendChild(h);

    function row(label) {
      const r = document.createElement('div');
      r.style.cssText = 'margin-bottom:8px;';
      const lbl = document.createElement('div');
      lbl.textContent = label;
      lbl.style.cssText = 'font:600 11px/1.2 Arial,sans-serif;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px;';
      r.appendChild(lbl);
      return r;
    }

    // Property address — auto-read from LOP's Subject property
    // section. If nothing's there yet, prompt the user the FIRST
    // time the card mounts on this loan; thereafter we let them
    // type into the input directly.
    let initialAddress = persisted.address || readSubjectAddress() || '';
    if (!initialAddress && !persisted.promptedForAddress) {
      try {
        const typed = window.prompt(
          'No subject property address on this loan yet.\n\nEnter the property address to check the FHA 90-Day Flip Rule:',
          ''
        );
        if (typed && typed.trim()) initialAddress = typed.trim();
      } catch (_) { /* prompt blocked — fall back to manual input */ }
      // Remember we asked so we don't keep popping the prompt on
      // every panel re-render.
      stateByLoan[loanKey()] = Object.assign(stateByLoan[loanKey()] || {}, { promptedForAddress: true });
    }

    const addrRow = row('Property address');
    const addrInput = document.createElement('input');
    addrInput.type = 'text';
    addrInput.placeholder = '123 Main St, City, ST 12345';
    addrInput.value = initialAddress;
    addrInput.style.cssText = 'width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:4px;font:13px Arial,sans-serif;box-sizing:border-box;';
    addrInput.addEventListener('input', function () { saveState({ address: addrInput.value }); });
    addrRow.appendChild(addrInput);
    wrap.appendChild(addrRow);

    // Lookup row: a button that triggers the SW's Zillow scrape and
    // a status indicator that reports the outcome.
    const lookupRow = document.createElement('div');
    lookupRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin:-2px 0 8px;';
    const lookupBtn = document.createElement('button');
    lookupBtn.type = 'button';
    lookupBtn.textContent = '🔎 Auto-fill from Zillow';
    lookupBtn.title = 'Fetches Zillow\'s listing for this address and fills the Seller\'s purchase date from the price history.';
    lookupBtn.style.cssText = 'padding:5px 10px;background:#0b5cab;color:#fff;border:1px solid #0b5cab;border-radius:4px;font:600 11.5px/1.2 Arial,sans-serif;cursor:pointer;';
    const lookupStatus = document.createElement('span');
    lookupStatus.style.cssText = 'font:11.5px/1.3 Arial,sans-serif;color:#6b7280;flex:1;';
    lookupRow.appendChild(lookupBtn);
    lookupRow.appendChild(lookupStatus);
    wrap.appendChild(lookupRow);

    async function runZillowLookup(silent) {
      const addr = addrInput.value.trim();
      if (!addr) {
        if (!silent) lookupStatus.textContent = 'Enter an address first.';
        return;
      }
      lookupBtn.disabled = true;
      lookupStatus.textContent = 'Looking up on Zillow…';
      lookupStatus.style.color = '#6b7280';
      try {
        const resp = await new Promise(function (resolve) {
          try {
            chrome.runtime.sendMessage({ type: 'FETCH_ZILLOW_LAST_SOLD', address: addr }, function (r) {
              const lastErr = chrome.runtime && chrome.runtime.lastError;
              if (lastErr) resolve({ ok: false, error: lastErr.message });
              else resolve(r || { ok: false, error: 'no response' });
            });
          } catch (e) { resolve({ ok: false, error: String(e && e.message || e) }); }
        });
        if (resp && resp.ok && resp.date) {
          const iso = toIsoDate(resp.date);
          if (iso) {
            sellerInput.value = iso;
            saveState({ sellerDate: iso });
            rerender();
            lookupStatus.textContent = '✓ Last sold ' + iso + ' (Zillow)';
            lookupStatus.style.color = '#15803d';
          } else {
            lookupStatus.textContent = '⚠ Got "' + resp.date + '" from Zillow but couldn\'t parse — enter manually.';
            lookupStatus.style.color = '#b45309';
          }
        } else {
          const reason = (resp && resp.blocked)
            ? 'Zillow blocked the request (captcha). Try the manual link below.'
            : ((resp && resp.error) || 'no result');
          lookupStatus.textContent = '⚠ ' + reason;
          lookupStatus.style.color = '#b45309';
        }
      } finally {
        lookupBtn.disabled = false;
      }
    }
    lookupBtn.addEventListener('click', function () { runZillowLookup(false); });

    // Fallback manual link (opens Zillow in a new tab) for when the
    // auto-scrape gets blocked. Same href the original card had.
    const manualLink = document.createElement('a');
    manualLink.href = '#';
    manualLink.textContent = 'or open Zillow manually';
    manualLink.style.cssText = 'font:11px/1.2 Arial,sans-serif;color:#0b5cab;text-decoration:underline;cursor:pointer;display:inline-block;margin:-4px 0 8px;';
    manualLink.addEventListener('click', function (e) {
      e.preventDefault();
      const q = encodeURIComponent(addrInput.value.trim());
      if (!q) return;
      const url = 'https://www.zillow.com/homes/' + q + '_rb/';
      try {
        chrome.runtime.sendMessage({ type: 'OPEN_TAB', url: url });
      } catch (_) {
        try { window.open(url, '_blank'); } catch (__) {}
      }
    });
    wrap.appendChild(manualLink);

    // Seller's purchase date
    const sellerRow = row('Seller\'s purchase date');
    const sellerInput = document.createElement('input');
    sellerInput.type = 'date';
    sellerInput.value = persisted.sellerDate || '';
    sellerInput.style.cssText = 'width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:4px;font:13px Arial,sans-serif;box-sizing:border-box;';
    sellerInput.addEventListener('input', function () { saveState({ sellerDate: sellerInput.value }); rerender(); });
    sellerRow.appendChild(sellerInput);
    wrap.appendChild(sellerRow);

    // Contract date (defaults to today)
    const contractRow = row('Contract date');
    const contractInput = document.createElement('input');
    contractInput.type = 'date';
    contractInput.value = persisted.contractDate || todayLocalDateString();
    contractInput.style.cssText = 'width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:4px;font:13px Arial,sans-serif;box-sizing:border-box;';
    contractInput.addEventListener('input', function () { saveState({ contractDate: contractInput.value }); rerender(); });
    contractRow.appendChild(contractInput);
    wrap.appendChild(contractRow);

    // Result placeholder
    const resultBox = document.createElement('div');
    resultBox.style.cssText = 'margin-top:10px;';
    wrap.appendChild(resultBox);

    // Karma footer
    const foot = document.createElement('div');
    foot.style.cssText = 'margin-top:10px;padding-top:8px;border-top:1px dashed #e5e7eb;font-size:10.5px;color:#6b7280;text-align:center;';
    foot.innerHTML = 'Built by <strong>Justin Case</strong> · <a href="https://zallwall.zillowgroup.com/justinca" target="_blank" rel="noopener" data-zhl-karma-link="fha-flip-rule" style="color:#0b5cab;font-weight:600;text-decoration:underline;">💛 Drop me karma</a>';
    foot.querySelector('a').addEventListener('click', function (e) {
      e.preventDefault();
      const url = 'https://zallwall.zillowgroup.com/justinca';
      try {
        chrome.runtime.sendMessage({ type: 'OPEN_TAB', url: url });
        chrome.runtime.sendMessage({ type: 'TRACK', event: 'karma_link_clicked', props: { source: 'fha-flip-rule' } });
      } catch (_) {
        try { window.open(url, '_blank'); } catch (__) {}
      }
    });
    wrap.appendChild(foot);

    function rerender() {
      const s = parseLocalDate(sellerInput.value);
      const c = parseLocalDate(contractInput.value);
      paintResult(resultBox, evaluateFlipRule(s, c));
    }
    function saveState(patch) {
      stateByLoan[loanKey()] = Object.assign(
        stateByLoan[loanKey()] || {},
        { address: addrInput.value, sellerDate: sellerInput.value, contractDate: contractInput.value },
        patch
      );
    }

    // Initial paint if data is already there
    rerender();

    // Auto-trigger the Zillow lookup the FIRST time the card mounts
    // on this loan when we have an address but no seller date yet.
    // Skip if the user already has a date stored (avoid wasted calls
    // on re-mounts when LOP re-renders the right rail).
    if (addrInput.value.trim() && !persisted.sellerDate && !persisted.zillowAttempted) {
      stateByLoan[loanKey()] = Object.assign(stateByLoan[loanKey()] || {}, { zillowAttempted: true });
      // Defer slightly so the card paints before the network call.
      setTimeout(function () { runZillowLookup(true); }, 100);
    }

    return wrap;
  }

  function paintResult(box, result) {
    box.innerHTML = '';
    if (!result) {
      // No data yet — show a quick reference of the rule tiers so
      // the card has something useful even before the user enters
      // dates.
      const ref = document.createElement('div');
      ref.style.cssText = 'background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;font-size:11.5px;color:#374151;line-height:1.5;';
      ref.innerHTML =
        '<div style="font-weight:600;margin-bottom:4px;">Rule tiers</div>' +
        '<div>≤ 90 days: <strong style="color:#dc2626;">NOT eligible</strong></div>' +
        '<div>91–180 days: <strong style="color:#d97706;">eligible, may need 2nd appraisal</strong></div>' +
        '<div>&gt; 180 days: <strong style="color:#16a34a;">no flip restriction</strong></div>';
      box.appendChild(ref);
      return;
    }
    const colorMap = {
      red:   { bg: '#fee2e2', border: '#dc2626', fg: '#7f1d1d' },
      amber: { bg: '#fef3c7', border: '#f59e0b', fg: '#78350f' },
      green: { bg: '#dcfce7', border: '#16a34a', fg: '#14532d' }
    };
    const c = colorMap[result.color] || colorMap.amber;
    const card = document.createElement('div');
    card.style.cssText = 'background:' + c.bg + ';border:1px solid ' + c.border + ';color:' + c.fg + ';border-radius:6px;padding:10px 12px;';
    const t = document.createElement('div');
    t.style.cssText = 'font-weight:700;font-size:13px;margin-bottom:4px;';
    t.textContent = result.status + '  ' + result.title;
    card.appendChild(t);
    const d = document.createElement('div');
    d.style.cssText = 'font-size:12px;line-height:1.45;';
    d.textContent = result.detail;
    card.appendChild(d);
    const days = document.createElement('div');
    days.style.cssText = 'font-size:11px;margin-top:6px;opacity:.8;';
    days.textContent = result.days + ' days · tier ' + result.tier;
    card.appendChild(days);
    box.appendChild(card);
  }

  // ---- Scan loop --------------------------------------------------------

  function scan() {
    const productName = readProductName();
    const fha = isFhaProduct(productName);
    const existing = document.getElementById(CARD_ID);
    if (!fha) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return; // already injected; the card manages its own state
    const host = findLoanDetailsHost();
    if (!host) return;
    const card = buildCard();
    // Insert after the loan details container (sibling), so we end
    // up directly below it on the right rail.
    if (host.parentElement) {
      host.parentElement.insertBefore(card, host.nextSibling);
    } else {
      host.appendChild(card);
    }
    console.log('[FHA Flip Rule] card injected on ' + productName);
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      try { scan(); } catch (e) { console.warn('[FHA Flip Rule] scan error', e); }
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
