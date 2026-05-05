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

  function showPanel(card) {
    const f = readCardFields(card);

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

  function scan() {
    if (!isOnScenariosPage()) {
      // Navigated away — clean up any stale buttons.
      document.querySelectorAll('.' + WRAPPER_CLASS).forEach(function (w) { w.remove(); });
      const panel = document.getElementById(PANEL_ID);
      if (panel) panel.remove();
      return;
    }
    document.querySelectorAll(STYLED_CARD_SELECTOR).forEach(injectButton);
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
