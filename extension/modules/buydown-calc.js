// ZHL Productivity Pack module — feature key: feature_buydownCalc
// Wraps original module body in a chrome.storage.local feature-flag check.
// If the user disables this module on the setup page the body never runs.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_buydownCalc';
  function __zhlRunModule() {
(function () {
  'use strict';

  const BUTTON_CLASS = 'zhlbd-button';
  const WRAPPER_CLASS = 'zhlbd-button-wrapper';
  const PANEL_ID = 'zhlbd-panel';
  const STYLED_CARD_SELECTOR = '[class*="StyledCard-c11n"]';

  // Only operate on the Pricing & Scenarios scenarios page. URL pattern:
  //   /loan-officer-portal/<uuid>/pricing-and-scenarios/scenarios
  function isOnScenariosPage() {
    return /\/loan-officer-portal\/[^/]+\/pricing-and-scenarios/.test(location.pathname);
  }

  // ---- parsing helpers --------------------------------------------------

  function parseMoney(s) {
    if (s == null) return NaN;
    const cleaned = String(s).replace(/[^0-9.\-]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return NaN;
    return parseFloat(cleaned);
  }

  function parsePercent(s) {
    if (s == null) return NaN;
    const cleaned = String(s).replace(/[^0-9.\-]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return NaN;
    return parseFloat(cleaned);
  }

  function fmt(n) {
    if (!isFinite(n)) return '—';
    return '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Standard amortization payment formula. Returns monthly P&I.
  function pmt(principal, annualRatePct, termMonths) {
    if (!isFinite(principal) || !isFinite(annualRatePct) || !isFinite(termMonths) || termMonths <= 0) return NaN;
    const r = (annualRatePct / 100) / 12;
    if (r <= 0) return principal / termMonths;
    return principal * r / (1 - Math.pow(1 + r, -termMonths));
  }

  // ---- card field readers ----------------------------------------------

  // Each scenario row is a <Flex> with a label <span> and a value <p>:
  //   <div Flex>
  //     <span>Total loan amount</span>
  //     <div Flex><p>$315,250.00</p></div>
  //   </div>
  // Find the span whose text matches `labelText`, walk to its row, return
  // the row's first <p> text.
  function findRowValue(card, labelText) {
    const target = labelText.replace(/\s+/g, ' ').trim().toLowerCase();
    const spans = card.querySelectorAll('span');
    for (const span of spans) {
      const t = (span.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (t !== target) continue;
      const row = span.parentElement;
      if (!row) continue;
      const p = row.querySelector('p');
      if (p) return (p.textContent || '').replace(/\s+/g, ' ').trim();
    }
    return null;
  }

  function isScenarioCard(card) {
    const text = card.textContent || '';
    return text.indexOf('Loan purpose') !== -1
      && text.indexOf('Total loan amount') !== -1
      && text.indexOf('Interest rate') !== -1;
  }

  // ZHL doesn't offer 2-1 buydowns on FHA or VA loans, so skip those cards.
  // Card titles look like "FHA 30 Yr Fixed", "VA 30 Yr Fixed", etc.
  function isFhaOrVaProgram(title) {
    return /\b(FHA|VA)\b/i.test(title || '');
  }

  function getCardTitle(card) {
    // The card title is in the first <p> matching things like "Conf 30 Yr Fixed".
    const ps = card.querySelectorAll('p');
    for (const p of ps) {
      const t = (p.textContent || '').trim();
      if (/\d{1,2}\s*Yr\s*(Fixed|ARM|FHA|VA|Jumbo)/i.test(t)) return t;
    }
    // Fallback: the first <p> in the card
    return ps.length ? (ps[0].textContent || '').trim() : 'Scenario';
  }

  function parseTermMonths(card) {
    const title = getCardTitle(card);
    const m = /(\d{1,2})\s*Yr/i.exec(title);
    if (m) return parseInt(m[1], 10) * 12;
    return 360; // default 30 yr
  }

  function readCardFields(card) {
    const loanAmount = parseMoney(findRowValue(card, 'Total loan amount'));
    const rate = parsePercent(findRowValue(card, 'Interest rate'));
    const closingCosts = parseMoney(findRowValue(card, 'Total closing costs'));
    const sellerCreditRaw = parseMoney(findRowValue(card, 'Seller credit'));
    const sellerCredit = isFinite(sellerCreditRaw) ? sellerCreditRaw : 0;

    // "Monthly P&I / PITI" row contains "$1,990.52 / $2,400.91"
    const piPiti = findRowValue(card, 'Monthly P&I / PITI');
    let pi = NaN, piti = NaN;
    if (piPiti) {
      const parts = piPiti.split('/');
      if (parts[0]) pi = parseMoney(parts[0]);
      if (parts[1]) piti = parseMoney(parts[1]);
    }

    return {
      loanAmount,
      rate,
      closingCosts,
      sellerCredit,
      pi,
      piti,
      term: parseTermMonths(card),
      title: getCardTitle(card)
    };
  }

  // ---- panel UI --------------------------------------------------------

  function track(event, props) {
    try { chrome.runtime.sendMessage({ type: 'TRACK', event, props: props || {} }); } catch (_) {}
  }

  function showPanel(card) {
    const f = readCardFields(card);
    track('buydown_calc_open');

    const existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'zhlbd-panel';

    const header = document.createElement('div');
    header.className = 'zhlbd-panel-header';
    const title = document.createElement('div');
    title.className = 'zhlbd-panel-title';
    title.textContent = '2-1 Buydown — ' + (f.title || 'Scenario');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'zhlbd-panel-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', function () { panel.remove(); });
    header.appendChild(title);
    header.appendChild(close);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'zhlbd-panel-body';

    function addRow(label, value, opts) {
      opts = opts || {};
      const row = document.createElement('div');
      row.className = 'zhlbd-row'
        + (opts.divider ? ' zhlbd-divider' : '')
        + (opts.emphasis ? ' zhlbd-emphasis' : '')
        + (opts.muted ? ' zhlbd-muted' : '');
      const lbl = document.createElement('div');
      lbl.className = 'zhlbd-label';
      lbl.textContent = label;
      const val = document.createElement('div');
      val.className = 'zhlbd-value';
      val.textContent = value;
      row.appendChild(lbl);
      row.appendChild(val);
      body.appendChild(row);
    }

    function addSubhead(text) {
      const h = document.createElement('div');
      h.className = 'zhlbd-subhead';
      h.textContent = text;
      body.appendChild(h);
    }

    if (!isFinite(f.loanAmount) || !isFinite(f.rate)) {
      addRow('Error', 'Could not read loan amount or rate from this card.');
      panel.appendChild(body);
      document.body.appendChild(panel);
      return;
    }

    // Year 1 = note rate − 2%, Year 2 = note rate − 1%, Year 3+ = note rate.
    // Clamp to 0% in case of unusually low rates.
    const y1Rate = Math.max(0, f.rate - 2);
    const y2Rate = Math.max(0, f.rate - 1);

    const fullPmt = pmt(f.loanAmount, f.rate, f.term);
    const y1Pmt = pmt(f.loanAmount, y1Rate, f.term);
    const y2Pmt = pmt(f.loanAmount, y2Rate, f.term);

    const y1Savings = (fullPmt - y1Pmt) * 12;
    const y2Savings = (fullPmt - y2Pmt) * 12;
    const buydownCost = y1Savings + y2Savings;
    const buydownPct = (buydownCost / f.loanAmount) * 100;

    // Escrow delta from card's PITI vs P&I — taxes/insurance/HOA portion.
    const escrow = (isFinite(f.piti) && isFinite(f.pi)) ? Math.max(0, f.piti - f.pi) : 0;

    addRow('Loan amount', fmt(f.loanAmount));
    addRow('Note rate (year 3+)', f.rate.toFixed(3) + '%');
    addRow('Term', (f.term / 12) + ' years');

    addSubhead('Monthly Payments');
    // Show the full payment (PITIA) for each year — P&I + the card's
    // escrow delta (taxes/insurance/HOA, derived from PITI − P&I on the
    // card). If the card didn't surface PITI, escrow is 0 and we show
    // P&I only with a note.
    const showFullPayment = escrow > 0;
    addRow(
      'Year 1 — rate ' + y1Rate.toFixed(3) + '%',
      fmt(y1Pmt + escrow) + (showFullPayment ? '' : ' P&I'),
      { emphasis: true }
    );
    addRow(
      'Year 2 — rate ' + y2Rate.toFixed(3) + '%',
      fmt(y2Pmt + escrow) + (showFullPayment ? '' : ' P&I'),
      { emphasis: true }
    );
    addRow(
      'Year 3+ — rate ' + f.rate.toFixed(3) + '%',
      fmt(fullPmt + escrow) + (showFullPayment ? '' : ' P&I'),
      { emphasis: true }
    );
    if (!showFullPayment) {
      addRow('Note', 'Card did not expose PITI — showing P&I only.', { muted: true });
    }

    addSubhead('Buydown Cost');
    addRow('Year 1 savings (12 × monthly delta)', fmt(y1Savings));
    addRow('Year 2 savings (12 × monthly delta)', fmt(y2Savings));
    addRow('Total buydown cost', fmt(buydownCost), { divider: true, emphasis: true });
    addRow('% of loan amount', isFinite(buydownPct) ? buydownPct.toFixed(2) + '%' : '—');

    if (isFinite(f.closingCosts)) {
      addSubhead('Closing Cost Impact');
      addRow('Current total closing costs', fmt(f.closingCosts));
      addRow('Current seller credit', fmt(f.sellerCredit));
      addRow('Current net closing costs', fmt(f.closingCosts - f.sellerCredit));
      addRow('+ 2-1 buydown cost', fmt(buydownCost), { divider: true });
      addRow('= New total closing costs', fmt(f.closingCosts + buydownCost), { emphasis: true });
      addRow('= New net closing costs', fmt(f.closingCosts + buydownCost - f.sellerCredit), { emphasis: true });
    }

    panel.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'zhlbd-panel-footer';
    const note = document.createElement('div');
    note.className = 'zhlbd-panel-note';
    note.innerHTML =
      '<strong>How it works:</strong> A 2-1 buydown reduces the rate by 2.000% in year 1 and ' +
      '1.000% in year 2, returning to the note rate from year 3 on. The cost equals the sum ' +
      'of monthly P&I savings × 12 across years 1 and 2 — typically pre-paid at closing or ' +
      'covered by a seller credit.';
    footer.appendChild(note);
    panel.appendChild(footer);

    document.body.appendChild(panel);
  }

  // ---- button injection -------------------------------------------------

  function injectButton(card) {
    if (!isScenarioCard(card)) return;
    const wrapperParent = card.parentElement;
    if (!wrapperParent) return;

    const existingWrapper = wrapperParent.querySelector(':scope > .' + WRAPPER_CLASS);

    // ZHL doesn't offer 2-1 buydowns on FHA / VA. If the card identifies
    // as one of those, remove any button that was already injected and
    // skip — handles cases where the title rendered after our first scan.
    if (isFhaOrVaProgram(getCardTitle(card))) {
      if (existingWrapper) existingWrapper.remove();
      return;
    }

    if (existingWrapper) return;

    const wrapper = document.createElement('div');
    wrapper.className = WRAPPER_CLASS;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BUTTON_CLASS;
    btn.textContent = 'Calc 2-1 Buydown';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      showPanel(card);
    });

    wrapper.appendChild(btn);
    wrapperParent.appendChild(wrapper);
  }

  // ---- "2-1 Buydown PDF" action-bar button ----------------------------
  //
  // Lives next to LOP's "Generate PDF" button at the bottom of the
  // Pricing & Scenarios → Scenarios review page. Disabled (with a
  // tooltip) unless at least one CONVENTIONAL scenario is currently
  // selected via its checkbox — ZHL doesn't offer 2-1 buydowns on
  // FHA / VA / USDA / Jumbo so those rule themselves out.
  //
  // On click: for each selected Conventional card, reuse the existing
  // readCardFields / pmt / computeBuydown pipeline, render the same
  // breakdown the in-page calculator shows into a print-formatted
  // HTML page in a new tab, and trigger window.print(). User picks
  // "Save as PDF" from the browser's print dialog to get a
  // borrower-friendly PDF.

  const PDF_BUTTON_ATTR = 'data-zhl-buydown-pdf-btn';
  const BRANDED_PDF_BUTTON_ATTR = 'data-zhl-buydown-pdf-branded-btn';

  function isConventionalCard(card) {
    return /\bConf\b/i.test(getCardTitle(card));
  }

  function isCardSelected(card) {
    const cb = card.querySelector('input[type="checkbox"]');
    return !!(cb && cb.checked);
  }

  function findEligibleSelectedScenarios() {
    const out = [];
    document.querySelectorAll(STYLED_CARD_SELECTOR).forEach(function (card) {
      if (!isScenarioCard(card)) return;
      if (!isCardSelected(card)) return;
      if (!isConventionalCard(card)) return;
      out.push(card);
    });
    return out;
  }

  function findGeneratePdfButton() {
    return document.querySelector('button[data-z-analytics-identifier="ScenarioPDFCreateButton"]');
  }

  // The Generate PDF button is wrapped in a TriggerText <button>; we
  // want to insert our new button into the outer Flex container as a
  // sibling of that wrapper, immediately before it. Walks up from the
  // analytics button to find the outer wrapper button, then returns
  // its parent (the Flex action bar) and the wrapper as the anchor
  // node to insert before.
  function findActionBarFor(generateBtn) {
    let anchor = generateBtn;
    let cur = generateBtn.parentElement;
    while (cur && cur !== document.body) {
      if (cur.tagName === 'BUTTON') { anchor = cur; cur = cur.parentElement; continue; }
      // The first non-button ancestor is the Flex action bar.
      return { container: cur, anchor: anchor };
    }
    return null;
  }

  function ensureBuydownPdfButton() {
    const generateBtn = findGeneratePdfButton();
    const existing = document.querySelector('[' + PDF_BUTTON_ATTR + ']');
    const existingBranded = document.querySelector('[' + BRANDED_PDF_BUTTON_ATTR + ']');
    if (!generateBtn) {
      if (existing) existing.remove();
      if (existingBranded) existingBranded.remove();
      return;
    }
    if (!existing) {
      const ab = findActionBarFor(generateBtn);
      if (!ab || !ab.container || !ab.anchor) return;
      const btn = document.createElement('button');
      btn.setAttribute(PDF_BUTTON_ATTR, '1');
      btn.type = 'button';
      btn.textContent = '2-1 Buydown PDF';
      btn.style.cssText =
        'display:inline-flex;align-items:center;justify-content:center;' +
        'background:#006aff;color:#fff;border:1px solid #006aff;' +
        'padding:8px 16px;border-radius:4px;' +
        'font:600 13px/1 Arial,Helvetica,sans-serif;cursor:pointer;' +
        'margin-right:8px;';
      btn.addEventListener('mouseenter', function () { if (!btn.disabled) btn.style.background = '#0056d2'; });
      btn.addEventListener('mouseleave', function () { btn.style.background = btn.disabled ? '#94a3b8' : '#006aff'; });
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        onBuydownPdfClick();
      });
      ab.container.insertBefore(btn, ab.anchor);
    }
    // Second button — branded borrower-facing PDF.
    let brandedBtn = document.querySelector('[' + BRANDED_PDF_BUTTON_ATTR + ']');
    if (!brandedBtn) {
      const ab = findActionBarFor(generateBtn);
      if (ab && ab.container && ab.anchor) {
        brandedBtn = document.createElement('button');
        brandedBtn.setAttribute(BRANDED_PDF_BUTTON_ATTR, '1');
        brandedBtn.type = 'button';
        brandedBtn.textContent = '2-1 Buydown PDF (Branded)';
        brandedBtn.style.cssText =
          'display:inline-flex;align-items:center;justify-content:center;' +
          'background:#006aff;color:#fff;border:1px solid #006aff;' +
          'padding:8px 16px;border-radius:4px;' +
          'font:600 13px/1 Arial,Helvetica,sans-serif;cursor:pointer;' +
          'margin-right:8px;';
        brandedBtn.addEventListener('mouseenter', function () { if (!brandedBtn.disabled) brandedBtn.style.background = '#0056d2'; });
        brandedBtn.addEventListener('mouseleave', function () { brandedBtn.style.background = brandedBtn.disabled ? '#94a3b8' : '#006aff'; });
        brandedBtn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          onBrandedBuydownPdfClick();
        });
        ab.container.insertBefore(brandedBtn, ab.anchor);
      }
    }
    updateBuydownPdfButtonState();
  }

  function updateBuydownPdfButtonState() {
    const btn = document.querySelector('[' + PDF_BUTTON_ATTR + ']');
    if (!btn) return;
    const eligible = findEligibleSelectedScenarios();
    // Mirror LOP's own Generate PDF disabled state. When a selected
    // scenario is stale ("RE-PRICE" pill in the corner), LOP disables
    // its Generate PDF — we shouldn't ship a Buydown PDF off stale
    // pricing either.
    const generateBtn = findGeneratePdfButton();
    const generateDisabled = !!generateBtn && (
      generateBtn.disabled === true ||
      generateBtn.getAttribute('aria-disabled') === 'true' ||
      // The outer TriggerText wrapper button can also carry the
      // disabled state.
      (function () {
        let p = generateBtn.parentElement;
        while (p && p !== document.body) {
          if (p.tagName === 'BUTTON' && (p.disabled === true || p.getAttribute('aria-disabled') === 'true')) return true;
          if (p.tagName !== 'BUTTON') break;
          p = p.parentElement;
        }
        return false;
      })()
    );
    const brandedBtn = document.querySelector('[' + BRANDED_PDF_BUTTON_ATTR + ']');
    function disableOne(b, reason) {
      if (!b) return;
      b.disabled = true;
      b.style.opacity = '0.55';
      b.style.background = '#94a3b8';
      b.style.borderColor = '#94a3b8';
      b.style.cursor = 'not-allowed';
      b.title = reason;
    }
    function enableOne(b, tooltip) {
      if (!b) return;
      b.disabled = false;
      b.style.opacity = '1';
      b.style.background = '#006aff';
      b.style.borderColor = '#006aff';
      b.style.cursor = 'pointer';
      b.title = tooltip;
    }
    if (eligible.length === 0) {
      const r = 'Select at least one Conventional scenario to enable. ZHL doesn\'t offer 2-1 buydowns on FHA / VA / USDA / Jumbo.';
      disableOne(btn, r);
      disableOne(brandedBtn, r);
      return;
    }
    if (generateDisabled) {
      const r = 'Re-price the selected scenario before generating a Buydown PDF — the pricing is currently stale.';
      disableOne(btn, r);
      disableOne(brandedBtn, r);
      return;
    }
    enableOne(btn, 'Generate a quick 2-1 Buydown PDF for ' + eligible.length + ' selected Conventional scenario(s).');
    enableOne(brandedBtn, 'Generate a borrower-facing branded 2-1 Buydown PDF for ' + eligible.length + ' selected Conventional scenario(s).');
  }

  function computeBuydownForCard(card) {
    const fields = readCardFields(card);
    const term = parseTermMonths(card);
    const title = getCardTitle(card);
    const y1Rate = Math.max(0, fields.rate - 2);
    const y2Rate = Math.max(0, fields.rate - 1);
    const fullPmt = pmt(fields.loanAmount, fields.rate, term);
    const y1Pmt = pmt(fields.loanAmount, y1Rate, term);
    const y2Pmt = pmt(fields.loanAmount, y2Rate, term);
    const y1Savings = (fullPmt - y1Pmt) * 12;
    const y2Savings = (fullPmt - y2Pmt) * 12;
    const buydownCost = y1Savings + y2Savings;
    const buydownPct = (buydownCost / fields.loanAmount) * 100;
    const escrow = (isFinite(fields.piti) && isFinite(fields.pi))
      ? Math.max(0, fields.piti - fields.pi) : 0;
    return {
      title: title, term: term,
      loanAmount: fields.loanAmount, rate: fields.rate,
      y1Rate: y1Rate, y2Rate: y2Rate,
      fullPmt: fullPmt, y1Pmt: y1Pmt, y2Pmt: y2Pmt,
      y1Savings: y1Savings, y2Savings: y2Savings,
      buydownCost: buydownCost, buydownPct: buydownPct,
      escrow: escrow,
      closingCosts: fields.closingCosts, sellerCredit: fields.sellerCredit,
      piti: fields.piti, pi: fields.pi
    };
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtMoneyHtml(n) {
    if (!isFinite(n)) return '&mdash;';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    return sign + '$' + abs.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function renderBuydownPdfHtml(scenarios) {
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const multi = scenarios.length > 1;
    const gridClass = multi ? 'scenarios-grid scenarios-multi' : 'scenarios-grid scenarios-single';
    let scenarioHtml = '';
    for (const s of scenarios) {
      const escrow = s.escrow || 0;
      const escrowSuffix = escrow > 0 ? '' : ' P&amp;I';
      const closingBlock = isFinite(s.closingCosts) ? (
        '<h3>Closing Cost Impact</h3>' +
        '<table>' +
          '<tr><td>Current total closing costs</td><td>' + fmtMoneyHtml(s.closingCosts) + '</td></tr>' +
          '<tr><td>Current seller credit</td><td>' + fmtMoneyHtml(s.sellerCredit) + '</td></tr>' +
          '<tr><td>Current net closing costs</td><td>' + fmtMoneyHtml(s.closingCosts - s.sellerCredit) + '</td></tr>' +
          '<tr><td>+ 2-1 buydown cost</td><td>' + fmtMoneyHtml(s.buydownCost) + '</td></tr>' +
          '<tr class="emphasis"><td>= New total closing costs</td><td>' + fmtMoneyHtml(s.closingCosts + s.buydownCost) + '</td></tr>' +
          '<tr class="emphasis"><td>= New net closing costs</td><td>' + fmtMoneyHtml(s.closingCosts + s.buydownCost - s.sellerCredit) + '</td></tr>' +
        '</table>'
      ) : '';
      scenarioHtml +=
        '<section class="scenario">' +
          '<h2>' + escapeHtml(s.title) + '</h2>' +
          '<table>' +
            '<tr><th colspan="2">Loan</th></tr>' +
            '<tr><td>Loan amount</td><td>' + fmtMoneyHtml(s.loanAmount) + '</td></tr>' +
            '<tr><td>Note rate (year 3+)</td><td>' + s.rate.toFixed(3) + '%</td></tr>' +
            '<tr><td>Term</td><td>' + (s.term / 12) + ' years</td></tr>' +
          '</table>' +
          '<h3>Monthly Payments</h3>' +
          '<table>' +
            '<tr><th>Year</th><th>Rate</th><th>Monthly payment</th></tr>' +
            '<tr><td>Year 1</td><td>' + s.y1Rate.toFixed(3) + '%</td><td>' + fmtMoneyHtml(s.y1Pmt + escrow) + escrowSuffix + '</td></tr>' +
            '<tr><td>Year 2</td><td>' + s.y2Rate.toFixed(3) + '%</td><td>' + fmtMoneyHtml(s.y2Pmt + escrow) + escrowSuffix + '</td></tr>' +
            '<tr><td>Year 3+</td><td>' + s.rate.toFixed(3) + '%</td><td>' + fmtMoneyHtml(s.fullPmt + escrow) + escrowSuffix + '</td></tr>' +
          '</table>' +
          (escrow > 0 ? '' : '<p class="note">Payments shown are P&amp;I only — taxes and insurance not included.</p>') +
          '<h3>Buydown Cost</h3>' +
          '<table>' +
            '<tr><td>Year 1 savings (12 &times; monthly delta)</td><td>' + fmtMoneyHtml(s.y1Savings) + '</td></tr>' +
            '<tr><td>Year 2 savings (12 &times; monthly delta)</td><td>' + fmtMoneyHtml(s.y2Savings) + '</td></tr>' +
            '<tr class="emphasis"><td>Total buydown cost</td><td>' + fmtMoneyHtml(s.buydownCost) + '</td></tr>' +
            '<tr><td>% of loan amount</td><td>' + (isFinite(s.buydownPct) ? s.buydownPct.toFixed(2) + '%' : '&mdash;') + '</td></tr>' +
          '</table>' +
          closingBlock +
        '</section>';
    }
    return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<title>2-1 Buydown Analysis &mdash; ' + escapeHtml(today) + '</title>' +
      '<style>' +
      // @page handles paper SIZE only. Margins come from body padding
      // below — Chrome's print dialog can override @page margin if
      // the user picks "Margins: None" in the print dialog, which
      // left earlier versions of this PDF flush against the page
      // edge. Body padding is part of the layout, so it survives
      // any Margins setting the user picks.
      '@page { size: letter; margin: 0; }' +
      // body padding handles BOTH the on-screen view of the new
      // tab AND the printed output's white-space-from-edge.
      // max-width caps the on-screen render on wide monitors so it
      // matches what gets printed.
      'body { font: 10.5pt/1.4 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1f2937; margin: 0; padding: 0.6in 0.75in; max-width: 8.5in; box-sizing: border-box; }' +
      'header { border-bottom: 3px solid #006aff; padding-bottom: 8pt; margin-bottom: 14pt; }' +
      'header h1 { margin: 0; font-size: 17pt; color: #006aff; }' +
      'header .date { color: #6b7280; font-size: 9.5pt; margin-top: 3pt; }' +
      'header .intro { color: #374151; font-size: 9.5pt; margin-top: 8pt; max-width: 5.6in; }' +
      '.scenario { page-break-inside: avoid; }' +
      '.scenario h2 { margin: 0 0 8pt; font-size: 12.5pt; background: #f3f4f6; padding: 5pt 10pt; border-left: 4pt solid #006aff; }' +
      '.scenario h3 { margin: 12pt 0 3pt; font-size: 10.5pt; color: #006aff; }' +
      '.scenario .note { font-size: 8.5pt; color: #6b7280; font-style: italic; margin: 2pt 0 4pt; }' +
      // Single-scenario layout: one centered column. Cap table width
      // so labels and values stay close instead of being flex-pushed
      // to opposite ends of the 7-inch printable area.
      '.scenarios-single .scenario { margin-bottom: 14pt; }' +
      '.scenarios-single table { width: 4.6in; max-width: 100%; border-collapse: collapse; margin: 0 0 4pt; }' +
      // Multi-scenario layout: two-column side-by-side. Uses
      // inline-block (more reliable for print pagination than CSS
      // grid in most browsers). Tighter type so each column fits.
      '.scenarios-multi { font-size: 0; /* eliminate inline-block whitespace */ }' +
      '.scenarios-multi .scenario {' +
        ' display: inline-block;' +
        ' width: calc(50% - 0.18in);' +
        ' margin-right: 0.32in;' +
        ' margin-bottom: 16pt;' +
        ' vertical-align: top;' +
        ' font-size: 9.5pt;' +
      '}' +
      '.scenarios-multi .scenario:nth-child(2n) { margin-right: 0; }' +
      '.scenarios-multi .scenario h2 { font-size: 11pt; padding: 4pt 8pt; }' +
      '.scenarios-multi .scenario h3 { margin: 10pt 0 3pt; font-size: 9.5pt; }' +
      '.scenarios-multi table { width: 100%; max-width: none; border-collapse: collapse; margin: 0 0 3pt; font-size: 9pt; }' +
      // Generic table styling applies to both layouts.
      'table { border-collapse: collapse; }' +
      'table th { font-size: 9pt; color: #6b7280; text-align: left; padding: 3pt 8pt; border-bottom: 1px solid #e5e7eb; font-weight: 600; }' +
      'table th:last-child { text-align: right; }' +
      'table td { padding: 3pt 8pt; border-bottom: 1px solid #f3f4f6; }' +
      'table td:last-child { text-align: right; font-variant-numeric: tabular-nums; }' +
      'tr.emphasis td { font-weight: 700; border-top: 1pt solid #006aff; }' +
      'footer { margin-top: 22pt; padding-top: 8pt; border-top: 1px solid #e5e7eb; font-size: 8.5pt; color: #6b7280; }' +
      '@media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }' +
      '</style></head><body>' +
      '<header>' +
        '<h1>2-1 Temporary Buydown Analysis</h1>' +
        '<div class="date">Prepared ' + escapeHtml(today) + '</div>' +
        '<div class="intro">A 2-1 temporary buydown lowers the interest rate by 2.000% in year 1 and 1.000% in year 2, returning to the full note rate in year 3 and beyond. The total buydown cost is typically funded as a closing-cost credit by the seller or builder.</div>' +
      '</header>' +
      '<div class="' + gridClass + '">' + scenarioHtml + '</div>' +
      '<footer>This worksheet is for illustration only. Final pricing, rate, and closing costs are subject to credit approval and underwriting review. Not a commitment to lend.</footer>' +
      '</body></html>';
  }

  function openBuydownPdfWindow(scenarios) {
    const html = renderBuydownPdfHtml(scenarios);
    const w = window.open('', '_blank');
    if (!w) {
      alert('Could not open print window. Please allow popups for this site and try again.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    // Wait one tick for layout/fonts, then trigger the print dialog.
    setTimeout(function () {
      try { w.focus(); w.print(); } catch (_) {}
    }, 400);
  }

  function onBuydownPdfClick() {
    // Belt-and-suspenders: if the button reports as disabled (we
    // grey it out via updateBuydownPdfButtonState whenever Generate
    // PDF is disabled / nothing eligible is selected) the click
    // handler must also bail. Disabled <button>s still fire click
    // under some keyboard paths and via JS-triggered clicks.
    const btn = document.querySelector('[' + PDF_BUTTON_ATTR + ']');
    if (btn && btn.disabled) return;
    const eligible = findEligibleSelectedScenarios();
    if (!eligible.length) return;
    const scenarios = eligible.map(computeBuydownForCard);
    track('buydown_pdf_generate', { count: scenarios.length });
    openBuydownPdfWindow(scenarios);
  }

  // Lightweight telemetry hook (matches the existing `track` calls).
  function track(event, props) {
    try { chrome.runtime.sendMessage({ type: 'TRACK', event: event, props: props || {} }); } catch (_) {}
  }

  // ---- Branded borrower-facing PDF ------------------------------------
  //
  // Mirrors Zillow's official "Loan Comparison" PDF layout: header
  // with title + ZHL wordmark + issued timestamp, centered disclaimer
  // banner, side-by-side comparison columns (one per scenario), LO
  // contact info box, and a compliance footer. Pulls the LO's name /
  // NMLS / phone / email from chrome.storage.local (filled in on the
  // setup page).

  function readLoProfile() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(['lo_name', 'lo_nmls', 'lo_phone', 'lo_email'], function (data) {
          resolve({
            name: (data && data.lo_name) || '',
            nmls: (data && data.lo_nmls) || '',
            phone: (data && data.lo_phone) || '',
            email: (data && data.lo_email) || ''
          });
        });
      } catch (_) { resolve({ name: '', nmls: '', phone: '', email: '' }); }
    });
  }

  function renderBuydownPdfHtmlBranded(scenarios, lo) {
    const now = new Date();
    const dateStr = now.toLocaleString('en-US', {
      month: 'numeric', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    }).replace(',', '');
    // Compose the comparison rows. Each row has a label + one value
    // per scenario column. Buydown-rows-only per the user's
    // selection at design time.
    function row(label, getValue, opts) {
      opts = opts || {};
      const cells = scenarios.map(function (s) {
        const v = getValue(s);
        return '<td' + (opts.emphasis ? ' class="emphasis"' : '') + '>' + (v == null ? '&mdash;' : v) + '</td>';
      }).join('');
      return '<tr' + (opts.emphasis ? ' class="emphasis"' : '') + '><th>' + label + '</th>' + cells + '</tr>';
    }
    function f(n) { return fmtMoneyHtml(n); }
    function pct(n) { return isFinite(n) ? n.toFixed(3) + '%' : '&mdash;'; }
    const includeClosing = scenarios.some(function (s) { return isFinite(s.closingCosts); });
    let rowsHtml = '';
    rowsHtml += row('Loan program', function (s) { return '<strong>' + escapeHtml(s.title) + '</strong>'; });
    rowsHtml += row('Loan amount', function (s) { return f(s.loanAmount); });
    rowsHtml += row('Term', function (s) { return (s.term / 12) + ' years'; });
    rowsHtml += row('Note rate (Year 3+)', function (s) { return pct(s.rate); });
    rowsHtml += row('Year 1 rate', function (s) { return pct(s.y1Rate); });
    rowsHtml += row('Year 2 rate', function (s) { return pct(s.y2Rate); });
    rowsHtml += row('Year 1 payment', function (s) {
      const v = s.y1Pmt + (s.escrow || 0);
      return f(v) + (s.escrow > 0 ? '' : ' P&amp;I');
    });
    rowsHtml += row('Year 2 payment', function (s) {
      const v = s.y2Pmt + (s.escrow || 0);
      return f(v) + (s.escrow > 0 ? '' : ' P&amp;I');
    });
    rowsHtml += row('Year 3+ payment', function (s) {
      const v = s.fullPmt + (s.escrow || 0);
      return f(v) + (s.escrow > 0 ? '' : ' P&amp;I');
    }, { emphasis: true });
    rowsHtml += row('Year 1 savings', function (s) { return f(s.y1Savings); });
    rowsHtml += row('Year 2 savings', function (s) { return f(s.y2Savings); });
    rowsHtml += row('Total buydown cost', function (s) { return f(s.buydownCost); }, { emphasis: true });
    rowsHtml += row('% of loan amount', function (s) { return isFinite(s.buydownPct) ? s.buydownPct.toFixed(2) + '%' : '&mdash;'; });
    if (includeClosing) {
      rowsHtml += row('Current closing costs', function (s) { return isFinite(s.closingCosts) ? f(s.closingCosts) : '&mdash;'; });
      rowsHtml += row('+ 2-1 buydown cost', function (s) { return isFinite(s.closingCosts) ? f(s.buydownCost) : '&mdash;'; });
      rowsHtml += row('New total closing costs', function (s) {
        return isFinite(s.closingCosts) ? f(s.closingCosts + s.buydownCost) : '&mdash;';
      }, { emphasis: true });
    }

    // LO contact line — only render the segments the user actually
    // filled in on the setup page.
    const loSegs = [];
    if (lo.name) loSegs.push('<strong>' + escapeHtml(lo.name) + '</strong>');
    if (lo.nmls) loSegs.push('NMLS ID# ' + escapeHtml(lo.nmls));
    if (lo.phone) loSegs.push('P ' + escapeHtml(lo.phone));
    if (lo.email) loSegs.push('E ' + escapeHtml(lo.email));
    const loLine = loSegs.length
      ? '<span class="phone-icon">☎</span> Questions? ' + loSegs.join(' &nbsp;|&nbsp; ')
      : '';
    const loBox = loLine
      ? ('<div class="lo-box">' +
          '<div class="lo-line">' + loLine + '</div>' +
          '<div class="lo-tagline">Mortgage interest rates can change daily, sometimes hourly. Contact your loan officer today!</div>' +
        '</div>')
      : '';

    return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<title>2-1 Buydown Analysis — ' + escapeHtml(dateStr) + '</title>' +
      '<style>' +
      '@page { size: letter; margin: 0; }' +
      'body { font: 10pt/1.4 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1f2937; margin: 0; padding: 0.55in 0.7in; max-width: 8.5in; box-sizing: border-box; }' +
      // Header
      '.zhl-hdr { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 8pt; border-bottom: 1.5pt solid #006aff; }' +
      '.zhl-hdr h1 { margin: 0; font-size: 18pt; color: #1f2937; font-weight: 700; }' +
      '.zhl-hdr .borrower { color: #6b7280; font-size: 10pt; margin-top: 2pt; }' +
      '.zhl-hdr .brand-block { text-align: right; }' +
      '.zhl-hdr .brand { font-size: 14pt; color: #006aff; font-weight: 700; letter-spacing: 0.2pt; }' +
      '.zhl-hdr .brand .home { color: #1f2937; font-weight: 600; }' +
      '.zhl-hdr .issued { color: #6b7280; font-size: 8.5pt; margin-top: 3pt; }' +
      // Banner
      '.banner { text-align: center; padding: 8pt 4pt 12pt; color: #374151; font-size: 10pt; }' +
      // Comparison table
      'table.cmp { width: 100%; border-collapse: collapse; margin-top: 4pt; }' +
      'table.cmp th { text-align: left; padding: 5pt 8pt; font-size: 9.5pt; font-weight: 600; color: #1f2937; }' +
      'table.cmp tr.head th { color: #1f2937; background: #f3f4f6; }' +
      'table.cmp td { padding: 5pt 8pt; font-size: 9.5pt; text-align: right; font-variant-numeric: tabular-nums; color: #1f2937; }' +
      'table.cmp tr:nth-child(even) th, table.cmp tr:nth-child(even) td { background: #f9fafb; }' +
      'table.cmp tr.emphasis th, table.cmp tr.emphasis td { font-weight: 700; color: #006aff; }' +
      'table.cmp tr.emphasis td { border-top: 1pt solid #006aff; border-bottom: 1pt solid #006aff; }' +
      'table.cmp tr.head th { font-weight: 700; }' +
      // Special handling for the first row (Loan program) — it carries the column headers
      // visually distinct from the data rows.
      'table.cmp tr:first-child th, table.cmp tr:first-child td { border-bottom: 1.5pt solid #d1d5db; padding-top: 8pt; padding-bottom: 8pt; font-size: 10pt; }' +
      // LO contact box
      '.lo-box { margin-top: 16pt; border: 1pt solid #006aff; border-radius: 4pt; padding: 10pt 14pt; text-align: center; }' +
      '.lo-box .lo-line { font-size: 10pt; color: #1f2937; }' +
      '.lo-box .lo-line strong { color: #1f2937; }' +
      '.lo-box .lo-line .phone-icon { color: #006aff; margin-right: 4pt; }' +
      '.lo-box .lo-tagline { font-size: 9pt; color: #1f2937; font-weight: 600; margin-top: 6pt; }' +
      // Compliance footer
      '.compliance { margin-top: 14pt; font-size: 7.5pt; color: #6b7280; line-height: 1.4; }' +
      '.compliance .pageno { text-align: center; margin-top: 8pt; font-size: 8.5pt; color: #1f2937; }' +
      '@media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }' +
      '</style></head><body>' +
      '<header class="zhl-hdr">' +
        '<div>' +
          '<h1>2-1 Buydown Analysis</h1>' +
          '<div class="borrower">' + scenarios.length + ' scenario' + (scenarios.length === 1 ? '' : 's') + '</div>' +
        '</div>' +
        '<div class="brand-block">' +
          '<div class="brand">Zillow<span class="home">HomeLoans</span></div>' +
          '<div class="issued">Issued ' + escapeHtml(dateStr) + '</div>' +
        '</div>' +
      '</header>' +
      '<div class="banner">Your actual rate, payment and costs could be higher: get an official loan estimate before choosing a loan.</div>' +
      '<table class="cmp">' + rowsHtml + '</table>' +
      loBox +
      '<div class="compliance">' +
        'Zillow Home Loans, LLC, NMLS # 10287 | 2600 Michelson Drive, Suite 1201, Irvine, CA 92612. An Equal Housing Lender. This is not a commitment to lend. ' +
        'About Zillow Home Loans, LLC at <a href="https://www.zillowhomeloans.com/">https://www.zillowhomeloans.com/</a> (888) 852-2212. ' +
        'Mortgage interest rates can change daily, sometimes hourly. A 2-1 temporary buydown lowers the interest rate by 2.000% in year 1 and 1.000% in year 2, returning to the full note rate in year 3 and beyond. The buydown cost is typically funded as a closing-cost credit by the seller or builder.' +
        '<div class="pageno">Page 1 of 1</div>' +
      '</div>' +
      '</body></html>';
  }

  function openBuydownPdfWindowBranded(html) {
    const w = window.open('', '_blank');
    if (!w) {
      alert('Could not open print window. Please allow popups for this site and try again.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(function () {
      try { w.focus(); w.print(); } catch (_) {}
    }, 400);
  }

  async function onBrandedBuydownPdfClick() {
    const btn = document.querySelector('[' + BRANDED_PDF_BUTTON_ATTR + ']');
    if (btn && btn.disabled) return;
    const eligible = findEligibleSelectedScenarios();
    if (!eligible.length) return;
    const scenarios = eligible.map(computeBuydownForCard);
    const lo = await readLoProfile();
    const html = renderBuydownPdfHtmlBranded(scenarios, lo);
    track('buydown_pdf_generate_branded', { count: scenarios.length });
    openBuydownPdfWindowBranded(html);
  }

  function scan() {
    if (!isOnScenariosPage()) {
      // Navigated away — clean up any stale buttons.
      document.querySelectorAll('.' + WRAPPER_CLASS).forEach(function (w) { w.remove(); });
      const panel = document.getElementById(PANEL_ID);
      if (panel) panel.remove();
      const pdfBtn = document.querySelector('[' + PDF_BUTTON_ATTR + ']');
      if (pdfBtn) pdfBtn.remove();
      const brandedBtn = document.querySelector('[' + BRANDED_PDF_BUTTON_ATTR + ']');
      if (brandedBtn) brandedBtn.remove();
      return;
    }
    document.querySelectorAll(STYLED_CARD_SELECTOR).forEach(injectButton);
    ensureBuydownPdfButton();
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      try { scan(); } catch (e) { console.error('[2-1 Buydown] scan error', e); }
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  // Selection toggle = checkbox `change` event. Hook in so the PDF
  // button's enabled state updates the instant the user (de)selects
  // a scenario instead of waiting for the MutationObserver to fire
  // on some unrelated reflow.
  document.addEventListener('change', schedule, true);
  document.addEventListener('click', function () { setTimeout(schedule, 50); }, true);
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
