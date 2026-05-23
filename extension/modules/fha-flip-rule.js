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
  const PILL_ID = 'zhl-fha-flip-pill';
  const PANEL_ID = 'zhl-fha-flip-panel';
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
    // Subject Property fields only exist on the Loan and Property
    // sub-page of the Full Application — their container has id
    // "SubjectProperty". On every other LOP page (loan dashboard,
    // pricing, etc.) the section is absent. Without that anchor we
    // MUST NOT fall back to a document-wide scan — every page also
    // has borrower-residence address inputs that share the same
    // input names (addressStreet, addressCity, addressZIP, ...), so
    // a fallback would silently return the borrower's address.
    const root = document.getElementById('SubjectProperty');
    if (!root) return '';

    // Read the live React value off each input/select in the
    // Subject Property section. NOTE: we DO NOT read the
    // "Use existing address" select's option list — LOP fills that
    // dropdown with the borrower's existing addresses as suggested
    // fill-ins, not with the subject property's address. Reading
    // it (v1.26.6 behavior) was returning the borrower's mailing
    // address for users who hadn't picked an option yet.
    function readField(name) {
      const el = root.querySelector('input[name="' + name + '"], select[name="' + name + '"]');
      return el ? (el.value || '').trim() : '';
    }
    const street = readField('addressStreet');
    const unit = readField('addressUnit');
    const city = readField('addressCity');
    const state = readField('addressState');
    const zip = readField('addressZIP');
    const built = [
      street + (unit ? ' ' + unit : ''),
      city,
      [state, zip].filter(Boolean).join(' ')
    ].filter(function (s) { return s && s.trim(); }).join(', ');
    if (built && built.length > 5 && /\d/.test(built)) {
      console.log('[FHA Flip Rule] readSubjectAddress (from #SubjectProperty inputs): "' + built + '"');
      return built;
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

  // ---- Compact pill ------------------------------------------------------
  //
  // Lives under the Loan Details heading on the right rail and shows
  // the current FHA flip-rule status as a small color-coded pill.
  // Clicking it (any state) opens the full panel with inputs and the
  // detailed result. Mirrors the FHA Manual Eligible pill pattern
  // from fha-manual-eligible.js.

  function getLoanState() {
    return stateByLoan[loanKey()] || {};
  }
  function currentResult() {
    const s = getLoanState();
    const seller = parseLocalDate(s.sellerDate || '');
    const contract = parseLocalDate(s.contractDate || todayLocalDateString());
    return evaluateFlipRule(seller, contract);
  }

  function buildPill() {
    const pill = document.createElement('button');
    pill.id = PILL_ID;
    pill.type = 'button';
    pill.tabIndex = 0;
    pill.title = 'FHA 90-Day Flip Rule — click for details.\n\n' + ZHL_TIP;
    // pointer-events:auto + relative positioning + z-index together
    // make sure no inherited CSS on an LOP ancestor can suppress
    // clicks on the pill and that the pill stacks above any same-
    // parent siblings that might overlap.
    pill.style.cssText = [
      'display: inline-flex',
      'align-items: center',
      'gap: 6px',
      'margin: 8px 0 12px',
      'padding: 6px 10px',
      'border-radius: 6px',
      'border: 1px solid transparent',
      'font: 600 12px/1.2 Arial,Helvetica,sans-serif',
      'cursor: pointer',
      'box-sizing: border-box',
      'pointer-events: auto',
      'position: relative',
      'z-index: 10'
    ].join(';');
    // Per-element click handler in addition to the document-level
    // delegation below. If LOP's React strips this one, the
    // document handler still works; if React stops propagation
    // before document, this one still fires.
    function pillClick(e) {
      console.log('[FHA Flip Rule] direct pill ' + e.type + ' handler');
      e.preventDefault();
      e.stopPropagation();
      try { openPanel(); }
      catch (err) { console.error('[FHA Flip Rule] openPanel threw:', err); }
    }
    pill.addEventListener('click', pillClick);
    pill.addEventListener('mousedown', pillClick);
    // No per-pill click handler here — the document-level
    // delegation below (installed once on module load) catches the
    // click in capture phase. That survives LOP's React
    // reconciliation if/when it strips the listener off a
    // re-rendered element.
    paintPill(pill);
    return pill;
  }

  function paintPill(pill) {
    if (!pill) return;
    const result = currentResult();
    pill.innerHTML = '';
    const icon = document.createElement('span');
    icon.style.cssText = [
      'display: inline-flex',
      'align-items: center',
      'justify-content: center',
      'width: 16px', 'height: 16px',
      'border-radius: 50%',
      'font: 700 11px/1 Arial,sans-serif',
      'color: #fff',
      'flex: 0 0 auto'
    ].join(';');
    const label = document.createElement('span');
    let bg, border, fg;
    if (!result) {
      icon.textContent = '?';
      icon.style.background = '#6b7280';
      label.textContent = 'FHA Flip Rule: unknown — click to set';
      bg = '#f3f4f6'; border = '#d1d5db'; fg = '#374151';
    } else if (result.color === 'green') {
      icon.textContent = '✓';
      icon.style.background = '#16a34a';
      label.textContent = 'FHA Flip Rule: clear (' + result.days + ' days, > 180)';
      bg = '#dcfce7'; border = '#16a34a'; fg = '#14532d';
    } else if (result.color === 'amber') {
      icon.textContent = '⚠';
      icon.style.background = '#f59e0b';
      label.textContent = 'FHA Flip Rule: 91–180 days · may need 2nd appraisal';
      bg = '#fef3c7'; border = '#f59e0b'; fg = '#78350f';
    } else {
      icon.textContent = '✗';
      icon.style.background = '#dc2626';
      label.textContent = result.tier === 'invalid'
        ? 'FHA Flip Rule: dates invalid — click to fix'
        : 'FHA Flip Rule: NOT ELIGIBLE (' + result.days + ' days)';
      bg = '#fee2e2'; border = '#dc2626'; fg = '#7f1d1d';
    }
    pill.style.background = bg;
    pill.style.borderColor = border;
    pill.style.color = fg;
    pill.appendChild(icon);
    pill.appendChild(label);
  }

  // ---- Modal panel -------------------------------------------------------
  //
  // Opened by clicking the pill. Contains the property-address input,
  // the Zillow auto-fill button, the seller/contract date inputs, and
  // the full result card. Centered floating dialog with a backdrop.

  function openPanel() {
    // Time saved: ~4 min vs manually checking the FHA 90-day flip rule
    // (Zillow last-sold lookup + date arithmetic + ratio math).
    if (window.__zhlTimeSaved) window.__zhlTimeSaved.recordAndForget('fha-flip-rule', 4);
    // Close any existing instance first so re-opens refresh data.
    const existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();

    const persisted = getLoanState();
    // Pre-fill the address from persisted state or by re-reading the
    // Subject property section on each open. If both are empty, the
    // modal opens with an empty address input and the user types
    // directly into it (no separate window.prompt — that flow was
    // unreliable and made the modal feel like it "didn't open").
    // Fresh detection wins (same reasoning as scan()): older cached
    // values may have come from the borrower's residence and need to
    // be overwritten once the user is on the Subject Property page.
    const freshAddr = readSubjectAddress();
    const initialAddress = freshAddr || persisted.address || '';
    console.log('[FHA Flip Rule] openPanel; initialAddress="' + initialAddress + '"');

    // Backdrop + panel.
    const backdrop = document.createElement('div');
    backdrop.id = PANEL_ID;
    backdrop.style.cssText = [
      'position: fixed', 'inset: 0',
      'background: rgba(15,23,42,0.45)',
      'z-index: 2147483647',
      'display: flex', 'align-items: center', 'justify-content: center',
      'padding: 24px'
    ].join(';');
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) backdrop.remove();
    });

    const panel = document.createElement('div');
    panel.style.cssText = [
      'background: #fff',
      'width: 480px', 'max-width: 92vw',
      'max-height: 86vh', 'overflow-y: auto',
      'border-radius: 12px',
      'box-shadow: 0 20px 60px rgba(0,0,0,.25)',
      'font: 13px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif',
      'color: #1f2937'
    ].join(';');
    backdrop.appendChild(panel);

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:10px;padding:16px 20px 10px;border-bottom:1px solid #e5e7eb;';
    const title = document.createElement('h3');
    title.textContent = 'FHA 90-Day Property Flip Rule';
    title.style.cssText = 'margin:0;font-size:16px;color:#0b5cab;flex:1;';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.title = 'Close';
    closeBtn.style.cssText = 'background:transparent;border:none;font:400 22px/1 sans-serif;color:#6b7280;cursor:pointer;padding:0 6px;';
    closeBtn.addEventListener('click', function () { backdrop.remove(); });
    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = 'padding:14px 20px 18px;';
    panel.appendChild(body);

    function row(label) {
      const r = document.createElement('div');
      r.style.cssText = 'margin-bottom:10px;';
      const lbl = document.createElement('div');
      lbl.textContent = label;
      lbl.style.cssText = 'font:600 11px/1.2 Arial,sans-serif;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;';
      r.appendChild(lbl);
      return r;
    }

    // Property address
    const addrRow = row('Property address');
    const addrInput = document.createElement('input');
    addrInput.type = 'text';
    addrInput.placeholder = '123 Main St, City, ST 12345';
    addrInput.value = initialAddress;
    addrInput.style.cssText = 'width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:4px;font:13px Arial,sans-serif;box-sizing:border-box;';
    addrInput.addEventListener('input', function () { saveState({ address: addrInput.value }); });
    addrRow.appendChild(addrInput);
    body.appendChild(addrRow);

    // Lookup row
    const lookupRow = document.createElement('div');
    lookupRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin:-4px 0 12px;flex-wrap:wrap;';
    const lookupBtn = document.createElement('button');
    lookupBtn.type = 'button';
    lookupBtn.textContent = '🔎 Auto-fill from Zillow';
    lookupBtn.style.cssText = 'padding:6px 12px;background:#0b5cab;color:#fff;border:1px solid #0b5cab;border-radius:4px;font:600 12px/1.2 Arial,sans-serif;cursor:pointer;';
    const lookupStatus = document.createElement('span');
    lookupStatus.style.cssText = 'font:12px/1.3 Arial,sans-serif;color:#6b7280;flex:1;min-width:0;';
    const manualLink = document.createElement('a');
    manualLink.href = '#';
    manualLink.textContent = 'or open Zillow manually →';
    manualLink.style.cssText = 'font:11.5px/1.2 Arial,sans-serif;color:#0b5cab;text-decoration:underline;cursor:pointer;';
    manualLink.addEventListener('click', function (e) {
      e.preventDefault();
      const q = encodeURIComponent(addrInput.value.trim());
      if (!q) return;
      const url = 'https://www.zillow.com/homes/' + q + '_rb/';
      try { chrome.runtime.sendMessage({ type: 'OPEN_TAB', url: url }); }
      catch (_) { try { window.open(url, '_blank'); } catch (__) {} }
    });
    lookupRow.appendChild(lookupBtn);
    lookupRow.appendChild(lookupStatus);
    lookupRow.appendChild(manualLink);
    body.appendChild(lookupRow);

    // Dates side-by-side
    const datesGrid = document.createElement('div');
    datesGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:6px;';
    const sellerRow = row('Seller\'s purchase date');
    const sellerInput = document.createElement('input');
    sellerInput.type = 'date';
    sellerInput.value = persisted.sellerDate || '';
    sellerInput.style.cssText = 'width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:4px;font:13px Arial,sans-serif;box-sizing:border-box;';
    sellerInput.addEventListener('input', function () { saveState({ sellerDate: sellerInput.value }); rerender(); });
    sellerRow.appendChild(sellerInput);
    datesGrid.appendChild(sellerRow);

    const contractRow = row('Contract date');
    const contractInput = document.createElement('input');
    contractInput.type = 'date';
    contractInput.value = persisted.contractDate || todayLocalDateString();
    contractInput.style.cssText = 'width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:4px;font:13px Arial,sans-serif;box-sizing:border-box;';
    contractInput.addEventListener('input', function () { saveState({ contractDate: contractInput.value }); rerender(); });
    contractRow.appendChild(contractInput);
    datesGrid.appendChild(contractRow);
    body.appendChild(datesGrid);

    // Result placeholder
    const resultBox = document.createElement('div');
    resultBox.style.cssText = 'margin-top:12px;';
    body.appendChild(resultBox);

    // Footer
    const foot = document.createElement('div');
    foot.style.cssText = 'margin-top:14px;padding-top:10px;border-top:1px dashed #e5e7eb;font-size:11px;color:#6b7280;text-align:center;';
    foot.innerHTML = 'HUD 4000.1 II.A.1.b.iv.A · Built by <strong>Justin Case</strong> · <a href="https://zallwall.zillowgroup.com/justinca" target="_blank" rel="noopener" data-zhl-karma-link="fha-flip-rule" style="color:#0b5cab;font-weight:600;text-decoration:underline;">💛 Drop me karma</a>';
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
    body.appendChild(foot);

    function rerender() {
      const s = parseLocalDate(sellerInput.value);
      const c = parseLocalDate(contractInput.value);
      paintResult(resultBox, evaluateFlipRule(s, c));
      // Also update the pill, since changes in the panel should
      // immediately reflect in the right-rail summary.
      paintPill(document.getElementById(PILL_ID));
    }
    function saveState(patch) {
      stateByLoan[loanKey()] = Object.assign(
        stateByLoan[loanKey()] || {},
        { address: addrInput.value, sellerDate: sellerInput.value, contractDate: contractInput.value },
        patch
      );
    }

    async function runZillowLookup(silent) {
      const addr = addrInput.value.trim();
      if (!addr) {
        if (!silent) {
          lookupStatus.textContent = 'Enter an address first.';
          lookupStatus.style.color = '#b45309';
        }
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
            ? 'Zillow blocked the request (captcha). Use the manual link →'
            : ((resp && resp.error) || 'no result');
          lookupStatus.textContent = '⚠ ' + reason;
          lookupStatus.style.color = '#b45309';
          if (resp && resp.snippet) {
            console.log('[FHA Flip Rule] Zillow response snippet around "Sold":', resp.snippet);
          }
        }
      } finally {
        lookupBtn.disabled = false;
      }
    }
    lookupBtn.addEventListener('click', function () { runZillowLookup(false); });

    // Initial paint
    rerender();

    // Auto-lookup if we have an address but no seller date and
    // haven't tried yet for THIS address. Keying the gate on the
    // address (not the loan) means that if the Subject Property
    // address is later populated or corrected, we'll try again
    // instead of staying stuck on a stale "attempted" flag.
    const addrNow = addrInput.value.trim();
    if (addrNow && !persisted.sellerDate && persisted.zillowAttemptedAddress !== addrNow) {
      stateByLoan[loanKey()] = Object.assign(stateByLoan[loanKey()] || {}, { zillowAttemptedAddress: addrNow });
      setTimeout(function () { runZillowLookup(true); }, 80);
    }

    (document.body || document.documentElement).appendChild(backdrop);
    console.log('[FHA Flip Rule] panel appended to DOM');

    // If the address is empty, focus the address input so the user
    // can immediately type the property address.
    if (!addrInput.value.trim()) {
      try { addrInput.focus(); } catch (_) {}
    }
  }

  function paintResult(box, result) {
    box.innerHTML = '';
    if (!result) {
      const ref = document.createElement('div');
      ref.style.cssText = 'background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;font-size:12px;color:#374151;line-height:1.6;';
      ref.innerHTML =
        '<div style="font-weight:700;margin-bottom:6px;">Rule tiers</div>' +
        '<div>≤ 90 days: <strong style="color:#dc2626;">NOT eligible</strong> for FHA insurance.</div>' +
        '<div>91–180 days: <strong style="color:#d97706;">eligible</strong>, second appraisal may be required if resale ≥ 100% over seller\'s purchase.</div>' +
        '<div>&gt; 180 days: <strong style="color:#16a34a;">no flip restriction</strong>.</div>';
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
    card.style.cssText = 'background:' + c.bg + ';border:1px solid ' + c.border + ';color:' + c.fg + ';border-radius:6px;padding:12px 14px;';
    const t = document.createElement('div');
    t.style.cssText = 'font-weight:700;font-size:14px;margin-bottom:5px;';
    t.textContent = result.status + '  ' + result.title;
    card.appendChild(t);
    const d = document.createElement('div');
    d.style.cssText = 'font-size:12.5px;line-height:1.5;';
    d.textContent = result.detail;
    card.appendChild(d);
    const days = document.createElement('div');
    days.style.cssText = 'font-size:11.5px;margin-top:7px;opacity:.8;';
    days.textContent = result.days + ' days · tier ' + result.tier;
    card.appendChild(days);
    box.appendChild(card);
  }

  // ---- Scan loop --------------------------------------------------------

  function scan() {
    const productName = readProductName();
    const fha = isFhaProduct(productName);
    const existingPill = document.getElementById(PILL_ID);
    const existingPanel = document.getElementById(PANEL_ID);
    // Stale card-id node from older versions of this module — clean up.
    const staleCard = document.getElementById(CARD_ID);
    if (staleCard) staleCard.remove();

    if (!fha) {
      if (existingPill) existingPill.remove();
      if (existingPanel) existingPanel.remove();
      return;
    }
    if (existingPill) {
      // Keep the pill's color/text in sync with the latest state on
      // every scan tick — covers the case where the user closes the
      // panel after editing dates, or where Zillow auto-fill
      // populates the seller date asynchronously.
      paintPill(existingPill);
      return;
    }
    const host = findLoanDetailsHost();
    if (!host) return;
    const pill = buildPill();
    // Insert at the very top of the Loan Details container, right
    // after the heading. Same placement pattern as the FHA Manual
    // Eligible pill on the Credit section.
    const heading = Array.from(host.querySelectorAll('h6, h5, h4, h3')).find(function (h) {
      return (h.textContent || '').trim() === 'Loan Details';
    });
    if (heading) heading.insertAdjacentElement('afterend', pill);
    else host.insertBefore(pill, host.firstChild);
    // Diagnostic counter — if "pill injected" logs many times, LOP
    // is stripping our injection and the document-level click
    // delegation is what makes the click actually work.
    window.__zhlFlipPillInjectCount = (window.__zhlFlipPillInjectCount || 0) + 1;
    console.log('[FHA Flip Rule] pill injected on ' + productName + ' (injection #' + window.__zhlFlipPillInjectCount + ')');

    // First-time auto-lookup: if we have an address but no seller
    // date yet, kick off the Zillow scrape in the background so the
    // pill is already populated when the user clicks it. This
    // happens silently — no panel is opened.
    const persisted = getLoanState();
    // Fresh detection from #SubjectProperty wins over any cached
    // value — older versions could cache the borrower's residence
    // by mistake, so a confirmed Subject Property address must be
    // able to overwrite it. If detection returns '' (because the
    // Subject Property section isn't on the current page), keep
    // whatever the user typed manually before.
    const fresh = readSubjectAddress();
    let address;
    if (fresh) {
      if (fresh !== persisted.address) {
        // New / corrected address — drop any stale seller date and
        // zillow-attempt marker so we re-fetch for this address.
        stateByLoan[loanKey()] = Object.assign(stateByLoan[loanKey()] || {}, {
          address: fresh,
          sellerDate: undefined,
          zillowAttemptedAddress: undefined
        });
        console.log('[FHA Flip Rule] subject address updated from "' + (persisted.address || '') + '" to "' + fresh + '"');
      }
      address = fresh;
    } else {
      address = persisted.address || '';
    }
    const cur = getLoanState();
    if (address && !cur.sellerDate && cur.zillowAttemptedAddress !== address) {
      stateByLoan[loanKey()] = Object.assign(stateByLoan[loanKey()] || {}, { zillowAttemptedAddress: address, address: address });
      try {
        chrome.runtime.sendMessage({ type: 'FETCH_ZILLOW_LAST_SOLD', address: address }, function (resp) {
          if (resp && resp.ok && resp.date) {
            const iso = toIsoDate(resp.date);
            if (iso) {
              stateByLoan[loanKey()] = Object.assign(stateByLoan[loanKey()] || {}, { sellerDate: iso });
              paintPill(document.getElementById(PILL_ID));
              console.log('[FHA Flip Rule] auto-filled seller date ' + iso + ' from Zillow');
            }
          } else {
            // Surface the full diagnostic payload here so the page
            // console (not just the service-worker console) shows
            // what Zillow returned. Helps debug "still showing
            // unknown" reports without asking the user to dig
            // through chrome://extensions → service worker logs.
            console.log('[FHA Flip Rule] background Zillow lookup failed:',
              resp && resp.error,
              'finalUrl=' + (resp && resp.finalUrl),
              'htmlLen=' + (resp && resp.htmlLen),
              'blocked=' + (resp && resp.blocked));
            if (resp && resp.snippet) {
              console.log('[FHA Flip Rule] Zillow snippet around "Sold":', resp.snippet);
            }
          }
        });
      } catch (e) {
        console.warn('[FHA Flip Rule] sendMessage threw:', e);
      }
    }
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

  // Document-level capture-phase click delegation for the pill.
  // Attaching the handler to the document instead of the pill
  // survives any LOP / React re-render that strips listeners off
  // our injected button. Capture phase ensures we fire BEFORE any
  // React synthetic-event delegate higher up the tree gets a
  // chance to stop propagation. Installed exactly once for the
  // lifetime of the content script.
  function handlePillEvent(e) {
    const t = e.target;
    if (!t || !t.closest) return false;
    const pill = t.closest('#' + PILL_ID);
    if (!pill) return false;
    console.log('[FHA Flip Rule] document-delegated ' + e.type + ' on pill → opening panel');
    e.preventDefault();
    e.stopPropagation();
    try { openPanel(); }
    catch (err) {
      console.error('[FHA Flip Rule] openPanel threw:', err);
      try {
        const typed = window.prompt('FHA Flip Rule — enter the property address:');
        if (typed && typed.trim()) {
          stateByLoan[loanKey()] = Object.assign(stateByLoan[loanKey()] || {}, { address: typed.trim() });
          const p = document.getElementById(PILL_ID);
          if (p) paintPill(p);
        }
      } catch (_) {}
    }
    return true;
  }
  // Listen for multiple event types in capture phase. If the click
  // event is being consumed somewhere before reaching us, the
  // mousedown or pointerdown might still get through.
  document.addEventListener('click', handlePillEvent, true);
  document.addEventListener('mousedown', handlePillEvent, true);
  document.addEventListener('pointerdown', handlePillEvent, true);

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
