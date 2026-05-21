// ZHL Productivity Pack module — feature key: feature_loanComparisonPdf
//
// Adds a "ZHL Loan Comparison PDF" button next to LOP's existing
// "Generate PDF" on the Pricing & Scenarios → Scenarios review
// page. Produces a borrower-facing comparison PDF (via the
// browser's native Save-as-PDF print flow) that mirrors LOP's
// standard loan-comparison output with a few requested changes:
//
//   - Shows "Seller credit" as its own line (LOP's stock PDF buries
//     it inside Cash to/from)
//   - Drops the Credit score and DTI rows (the borrower doesn't
//     need their qualifying credit pulled into a comparison
//     handout)
//   - Estimated monthly cost (PITI) and Cash (to) / from are
//     rendered noticeably larger / heavier so they pop visually as
//     the two numbers the borrower actually anchors on
//   - Adds a Page 2 with a per-scenario itemized cost summary
//     (every PITI component + closing-cost summary)
//
// Implementation: scrapes the saved-scenario cards on the
// Scenarios sub-page, reads borrower names from the right-rail loan
// header, pulls the LO contact line from chrome.storage (same
// fields the 2-1 Buydown PDF uses), composes a styled HTML
// document, opens it in a new tab and triggers window.print().
// User picks "Save as PDF" from the browser's print dialog.

(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_loanComparisonPdf';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[ZHL Loan Comparison PDF v' + VERSION + '] loaded');

  const BRANDED_PDF_BUTTON_ATTR = 'data-zhl-loan-comparison-pdf-btn';
  const STYLED_CARD_SELECTOR = '[class*="StyledCard-c11n"]';

  // ---- Helpers --------------------------------------------------

  function parseMoney(s) {
    if (s == null) return NaN;
    const t = String(s).replace(/[\$,\s]/g, '').replace(/\/yr|\/mo/gi, '');
    const neg = /^\(.+\)$/.test(t);
    const n = parseFloat(t.replace(/[()]/g, ''));
    if (!isFinite(n)) return NaN;
    return neg ? -n : n;
  }

  function parsePercent(s) {
    if (s == null) return NaN;
    const t = String(s).replace(/[%\s]/g, '');
    return parseFloat(t);
  }

  function isOnScenariosPage() {
    return /\/loan-officer-portal\//.test(location.pathname) &&
      (location.pathname.indexOf('pricing') !== -1 ||
        location.pathname.indexOf('scenario') !== -1 ||
        /Scenarios/i.test(document.body.textContent || ''));
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

  function fmtMoneyShort(n) {
    if (!isFinite(n)) return '&mdash;';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    return sign + '$' + abs.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtPctHtml(n, digits) {
    if (!isFinite(n)) return '&mdash;';
    return n.toFixed(digits == null ? 3 : digits) + '%';
  }

  // ---- Scenario-card scraping -----------------------------------

  function isScenarioCard(card) {
    const text = card.textContent || '';
    return text.indexOf('Loan purpose') !== -1
      && text.indexOf('Total loan amount') !== -1
      && text.indexOf('Interest rate') !== -1;
  }

  function isCardSelected(card) {
    const cb = card.querySelector('input[type="checkbox"][name="selectScenario"]');
    if (cb) return !!cb.checked;
    // Fallback: any unnamed checkbox on the card
    const anyCb = card.querySelector('input[type="checkbox"]');
    return !!(anyCb && anyCb.checked);
  }

  function getCardTitle(card) {
    const ps = card.querySelectorAll('p');
    for (const p of ps) {
      const t = (p.textContent || '').trim();
      if (/\d{1,2}\s*Yr\s*(Fixed|ARM|FHA|VA|Jumbo)/i.test(t)) return t;
    }
    return ps.length ? (ps[0].textContent || '').trim() : 'Scenario';
  }

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

  // Read every field we want to render. Some scenarios may not have
  // every row populated (e.g. no down payment percentage shown if
  // it's exactly 0) — every field is parsed defensively and the
  // renderer falls back to em-dash when a number is missing.
  function readScenario(card) {
    const title = getCardTitle(card);
    const loanPurpose = findRowValue(card, 'Loan purpose');
    const purchasePrice = parseMoney(findRowValue(card, 'Purchase price'));
    const downPaymentRaw = findRowValue(card, 'Down payment');
    let downPaymentAmount = NaN, downPaymentPct = NaN;
    if (downPaymentRaw) {
      // Format: "$300,000.00 / 50.000%"
      const parts = downPaymentRaw.split('/');
      if (parts[0]) downPaymentAmount = parseMoney(parts[0]);
      if (parts[1]) downPaymentPct = parsePercent(parts[1]);
    }
    const loanAmount = parseMoney(findRowValue(card, 'Total loan amount'));
    const ltv = parsePercent(findRowValue(card, 'LTV'));
    const interestRate = parsePercent(findRowValue(card, 'Interest rate'));
    const apr = parsePercent(findRowValue(card, 'APR'));
    const pointsRaw = findRowValue(card, 'Points / Price');
    let pointsPct = NaN, pointsDollar = NaN;
    if (pointsRaw) {
      const parts = pointsRaw.split('/');
      if (parts[0]) pointsPct = parsePercent(parts[0]);
      if (parts[1]) pointsDollar = parseMoney(parts[1]);
    }
    const piPitiRaw = findRowValue(card, 'Monthly P&I / PITI');
    let pi = NaN, piti = NaN;
    if (piPitiRaw) {
      const parts = piPitiRaw.split('/');
      if (parts[0]) pi = parseMoney(parts[0]);
      if (parts[1]) piti = parseMoney(parts[1]);
    }
    const closingCosts = parseMoney(findRowValue(card, 'Total closing costs'));
    const sellerCredit = parseMoney(findRowValue(card, 'Seller credit'));
    const cashToFrom = parseMoney(findRowValue(card, 'Cash (to) / from'));
    const lockPeriod = findRowValue(card, 'Lock period');

    return {
      title: title,
      loanPurpose: loanPurpose || '',
      purchasePrice: purchasePrice,
      downPaymentAmount: downPaymentAmount,
      downPaymentPct: downPaymentPct,
      loanAmount: loanAmount,
      ltv: ltv,
      interestRate: interestRate,
      apr: apr,
      pointsPct: pointsPct,
      pointsDollar: pointsDollar,
      pi: pi,
      piti: piti,
      closingCosts: closingCosts,
      sellerCredit: isFinite(sellerCredit) ? sellerCredit : 0,
      cashToFrom: cashToFrom,
      lockPeriod: lockPeriod || ''
    };
  }

  function findSelectedScenarios() {
    const out = [];
    document.querySelectorAll(STYLED_CARD_SELECTOR).forEach(function (card) {
      if (!isScenarioCard(card)) return;
      if (!isCardSelected(card)) return;
      out.push(readScenario(card));
    });
    return out;
  }

  function findAnyScenarios() {
    const out = [];
    document.querySelectorAll(STYLED_CARD_SELECTOR).forEach(function (card) {
      if (!isScenarioCard(card)) return;
      out.push(readScenario(card));
    });
    return out;
  }

  // ---- Borrower / property header scraping ----------------------

  function readBorrowerNames() {
    // The loan header line at the top right of LOP shows the
    // primary borrower's name (with co-borrower joined by &). It's
    // an <a> next to the property city/state. Fall back to scanning
    // for a node whose text matches a "First Last [& First Last]"
    // shape near the page header.
    const anchors = document.querySelectorAll('a, button, span, p');
    const re = /^[A-Z][a-z\-']+(?:\s[A-Z]\.?)?\s[A-Z][a-z\-']+(?:\s(?:&|and)\s[A-Z][a-z\-']+(?:\s[A-Z]\.?)?\s[A-Z][a-z\-']+)?$/;
    for (const el of anchors) {
      const t = (el.textContent || '').trim();
      if (!t || t.length > 80) continue;
      if (re.test(t)) return t;
    }
    return '';
  }

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

  // ---- Button injection -----------------------------------------

  function findGeneratePdfButton() {
    return document.querySelector('button[data-z-analytics-identifier="ScenarioPDFCreateButton"]');
  }

  function findActionBarFor(generateBtn) {
    let anchor = generateBtn;
    let cur = generateBtn.parentElement;
    while (cur && cur !== document.body) {
      if (cur.tagName === 'BUTTON') { anchor = cur; cur = cur.parentElement; continue; }
      return { container: cur, anchor: anchor };
    }
    return null;
  }

  function ensureLoanComparisonPdfButton() {
    const generateBtn = findGeneratePdfButton();
    const existing = document.querySelector('[' + BRANDED_PDF_BUTTON_ATTR + ']');
    if (!generateBtn) {
      if (existing) existing.remove();
      return;
    }
    let btn = existing;
    if (!btn) {
      const ab = findActionBarFor(generateBtn);
      if (ab && ab.container && ab.anchor) {
        btn = document.createElement('button');
        btn.setAttribute(BRANDED_PDF_BUTTON_ATTR, '1');
        btn.type = 'button';
        btn.textContent = 'ZHL Comparison PDF';
        // Match LOP's wrapper button box so we sit at the same
        // height. The 2-1 Buydown PDF button uses the same style.
        const cs = window.getComputedStyle(ab.anchor);
        const padLeftPx = (parseFloat(cs.paddingLeft) || 20) + 8;
        const padRightPx = (parseFloat(cs.paddingRight) || 20) + 8;
        btn.style.cssText =
          'display:inline-flex;align-items:center;justify-content:center;' +
          'background:#006aff;color:#fff;border:1px solid #006aff;' +
          'border-radius:4px;cursor:pointer;margin-right:8px;' +
          'font-family:' + (cs.fontFamily || 'Arial,Helvetica,sans-serif') + ';' +
          'font-weight:' + (cs.fontWeight || '600') + ';' +
          'font-size:' + (cs.fontSize || '14px') + ';' +
          'line-height:' + (cs.lineHeight && cs.lineHeight !== 'normal' ? cs.lineHeight : '1.2') + ';' +
          'padding:' + (cs.paddingTop || '10px') + ' ' + padRightPx + 'px ' + (cs.paddingBottom || '10px') + ' ' + padLeftPx + 'px;' +
          'min-height:' + (cs.height || '36px') + ';' +
          'box-sizing:border-box;';
        btn.title = 'Generate a ZHL Loan Comparison PDF for selected scenarios.\n\nBuilt by Justin Case. Karma appreciated 💛';
        btn.addEventListener('mouseenter', function () { if (!btn.disabled) btn.style.background = '#0056d2'; });
        btn.addEventListener('mouseleave', function () { btn.style.background = btn.disabled ? '#94a3b8' : '#006aff'; });
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          onComparisonPdfClick();
        });
        ab.container.insertBefore(btn, ab.anchor);
      }
    }
    updateButtonState();
  }

  function updateButtonState() {
    const btn = document.querySelector('[' + BRANDED_PDF_BUTTON_ATTR + ']');
    if (!btn) return;
    const selected = findSelectedScenarios();
    // Mirror LOP's Generate PDF disabled state — when the user's
    // selection is stale, we shouldn't ship a comparison off stale
    // pricing either.
    const generateBtn = findGeneratePdfButton();
    const generateDisabled = !!generateBtn && (
      generateBtn.disabled === true ||
      generateBtn.getAttribute('aria-disabled') === 'true' ||
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
    function disable(reason) {
      btn.disabled = true;
      btn.style.background = '#94a3b8';
      btn.style.borderColor = '#94a3b8';
      btn.style.cursor = 'not-allowed';
      btn.title = reason + '\n\nBuilt by Justin Case. Karma appreciated 💛';
    }
    if (generateDisabled) { disable('Update the scenarios first — LOP\'s Generate PDF is disabled (stale pricing).'); return; }
    if (!selected.length) { disable('Select one or more scenarios first.'); return; }
    btn.disabled = false;
    btn.style.background = '#006aff';
    btn.style.borderColor = '#006aff';
    btn.style.cursor = 'pointer';
    btn.title = 'Generate a ZHL Loan Comparison PDF for ' + selected.length + ' selected scenario' +
      (selected.length === 1 ? '' : 's') + '.\n\nBuilt by Justin Case. Karma appreciated 💛';
  }

  // ---- PDF rendering --------------------------------------------

  function renderComparisonHtml(scenarios, lo, borrowerName) {
    const now = new Date();
    const dateStr = now.toLocaleString('en-US', {
      month: 'numeric', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    }).replace(',', '');

    const colCount = scenarios.length + 1;
    const spacer = '<tr class="spacer"><td colspan="' + colCount + '">&nbsp;</td></tr>';

    function row(label, getValue, opts) {
      opts = opts || {};
      const cells = scenarios.map(function (s) {
        const v = getValue(s);
        const cls = opts.emphasis ? ' class="emphasis"' : (opts.big ? ' class="big"' : '');
        return '<td' + cls + '>' + (v == null ? '&mdash;' : v) + '</td>';
      }).join('');
      const trCls = opts.emphasis ? ' class="emphasis"' : (opts.big ? ' class="big"' : '');
      return '<tr' + trCls + '><th>' + label + '</th>' + cells + '</tr>';
    }

    // Header row: blank label cell, then one cell per scenario
    // showing the program name.
    let rowsHtml = '';
    rowsHtml += '<tr class="head"><th>Loan program</th>' +
      scenarios.map(function (s) {
        return '<th>' + escapeHtml(s.title) + '</th>';
      }).join('') + '</tr>';

    // --- Loan basics ---
    rowsHtml += row('Loan purpose', function (s) { return escapeHtml(s.loanPurpose) || '&mdash;'; });
    rowsHtml += row('Purchase price', function (s) { return fmtMoneyHtml(s.purchasePrice); });
    rowsHtml += row('Down payment', function (s) {
      const amt = fmtMoneyHtml(s.downPaymentAmount);
      const pct = isFinite(s.downPaymentPct) ? s.downPaymentPct.toFixed(3) + '%' : '';
      return pct ? amt + ' / ' + pct : amt;
    });
    rowsHtml += row('Total loan amount', function (s) { return fmtMoneyHtml(s.loanAmount); });
    rowsHtml += row('Loan-to-value (LTV)', function (s) { return fmtPctHtml(s.ltv); });
    rowsHtml += spacer;

    // --- Rate / APR ---
    rowsHtml += row('Interest rate', function (s) { return fmtPctHtml(s.interestRate); });
    rowsHtml += row('APR', function (s) { return fmtPctHtml(s.apr); });
    rowsHtml += row('Points / Price', function (s) {
      const pct = isFinite(s.pointsPct) ? s.pointsPct.toFixed(3) + '%' : '';
      const dol = isFinite(s.pointsDollar) ? fmtMoneyHtml(s.pointsDollar) : '';
      return pct && dol ? pct + ' / ' + dol : (pct || dol || '&mdash;');
    });
    rowsHtml += row('Lock period', function (s) { return escapeHtml(s.lockPeriod) || '&mdash;'; });
    rowsHtml += spacer;

    // --- Costs ---
    // Estimated monthly cost (PITI) and Cash (to)/from rendered
    // bigger and bolder than every other row in the table — those
    // are the two numbers the borrower actually anchors on. Seller
    // credit gets its own line so it's not buried inside cash.
    rowsHtml += row('Total closing costs', function (s) { return fmtMoneyHtml(s.closingCosts); });
    rowsHtml += row('Seller credit', function (s) { return fmtMoneyHtml(s.sellerCredit); });
    rowsHtml += row('Estimated monthly cost (PITI)', function (s) { return fmtMoneyHtml(s.piti); }, { big: true });
    rowsHtml += row('Cash (to) / from', function (s) { return fmtMoneyHtml(s.cashToFrom); }, { big: true });

    // LO contact line
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

    // ---- Page 2: per-scenario itemized cost summary --------------
    // For each scenario, render a card with: monthly cost breakdown
    // (P&I, MI, taxes, insurance, HOA, other if available) and a
    // closing-costs summary block. The PITI components beyond P&I
    // aren't broken out on the saved-scenario card, so we derive
    // taxes + insurance + MI + HOA = PITI - P&I and show that as a
    // single "Taxes, insurance, & escrows" line — labeled as such so
    // it doesn't read as misleading detail. Closing-costs summary
    // shows total + seller credit + the upfront cash impact.
    function p2Card(s) {
      const pi = isFinite(s.pi) ? s.pi : NaN;
      const piti = isFinite(s.piti) ? s.piti : NaN;
      const escrows = (isFinite(pi) && isFinite(piti)) ? Math.max(0, piti - pi) : NaN;
      const netClosing = (isFinite(s.closingCosts) ? s.closingCosts : 0) -
        (isFinite(s.sellerCredit) ? s.sellerCredit : 0);
      return (
        '<section class="p2card">' +
          '<h2>' + escapeHtml(s.title) + '</h2>' +
          '<div class="p2sub">Purchase price ' + fmtMoneyHtml(s.purchasePrice) +
            ' · Loan ' + fmtMoneyHtml(s.loanAmount) +
            ' · Rate ' + fmtPctHtml(s.interestRate) +
            ' · APR ' + fmtPctHtml(s.apr) +
          '</div>' +
          '<div class="p2grid">' +
            '<div class="p2col">' +
              '<h3>Monthly cost breakdown</h3>' +
              '<table class="p2tbl">' +
                '<tr><th>Principal &amp; interest</th><td>' + fmtMoneyHtml(pi) + '</td></tr>' +
                '<tr><th>Taxes, insurance &amp; escrows</th><td>' + fmtMoneyHtml(escrows) + '</td></tr>' +
                '<tr class="total"><th>Estimated monthly cost (PITI)</th><td>' + fmtMoneyHtml(piti) + '</td></tr>' +
              '</table>' +
            '</div>' +
            '<div class="p2col">' +
              '<h3>Closing cost summary</h3>' +
              '<table class="p2tbl">' +
                '<tr><th>Total closing costs</th><td>' + fmtMoneyHtml(s.closingCosts) + '</td></tr>' +
                '<tr><th>Seller credit</th><td>' +
                  (isFinite(s.sellerCredit) && s.sellerCredit > 0
                    ? '&minus;' + fmtMoneyHtml(s.sellerCredit)
                    : fmtMoneyHtml(s.sellerCredit)) +
                '</td></tr>' +
                '<tr><th>Net closing cost to borrower</th><td>' + fmtMoneyHtml(netClosing) + '</td></tr>' +
                '<tr><th>Down payment</th><td>' + fmtMoneyHtml(s.downPaymentAmount) + '</td></tr>' +
                '<tr class="total"><th>Cash (to) / from at closing</th><td>' + fmtMoneyHtml(s.cashToFrom) + '</td></tr>' +
              '</table>' +
            '</div>' +
          '</div>' +
          '<div class="p2foot">' +
            'Points: ' + (isFinite(s.pointsPct) ? s.pointsPct.toFixed(3) + '%' : '&mdash;') +
              (isFinite(s.pointsDollar) ? ' (' + fmtMoneyHtml(s.pointsDollar) + ')' : '') +
            ' &nbsp;·&nbsp; LTV ' + fmtPctHtml(s.ltv) +
            ' &nbsp;·&nbsp; Lock ' + escapeHtml(s.lockPeriod || '&mdash;') +
          '</div>' +
        '</section>'
      );
    }
    const page2Cards = scenarios.map(p2Card).join('');

    const borrowerLine = borrowerName
      ? '<div class="borrower">' + escapeHtml(borrowerName) + '</div>'
      : '<div class="borrower">' + scenarios.length + ' scenario' + (scenarios.length === 1 ? '' : 's') + '</div>';

    return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<title>Loan Comparison — ' + escapeHtml(dateStr) + '</title>' +
      '<style>' +
      '@page { size: letter; margin: 0; }' +
      'body { font: 10pt/1.4 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1f2937; margin: 0; padding: 0.55in 0.7in; max-width: 8.5in; box-sizing: border-box; }' +
      // Header
      '.zhl-hdr { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 8pt; border-bottom: 1.5pt solid #006aff; }' +
      '.zhl-hdr h1 { margin: 0; font-size: 18pt; color: #1f2937; font-weight: 700; }' +
      '.zhl-hdr .borrower { color: #6b7280; font-size: 10pt; margin-top: 2pt; }' +
      '.zhl-hdr .brand-block { text-align: right; }' +
      '.zhl-hdr .issued { color: #6b7280; font-size: 8.5pt; margin-top: 3pt; }' +
      // Banner
      '.banner { text-align: center; padding: 8pt 4pt 12pt; color: #374151; font-size: 10pt; }' +
      // Page 1 table
      'table.cmp { width: 100%; border-collapse: collapse; margin-top: 4pt; }' +
      'table.cmp th { text-align: left; padding: 5pt 8pt; font-size: 9.5pt; font-weight: 600; color: #1f2937; }' +
      'table.cmp tr.head th { color: #1f2937; background: #f3f4f6; font-weight: 700; font-size: 10pt; padding-top: 8pt; padding-bottom: 8pt; border-bottom: 1.5pt solid #d1d5db; text-align: left; }' +
      'table.cmp tr.head th:first-child { text-align: left; }' +
      'table.cmp td { padding: 5pt 8pt; font-size: 9.5pt; text-align: right; font-variant-numeric: tabular-nums; color: #1f2937; }' +
      'table.cmp tr:nth-child(even) th, table.cmp tr:nth-child(even) td { background: #f9fafb; }' +
      // Big rows: estimated monthly cost (PITI) and Cash (to)/from
      'table.cmp tr.big th, table.cmp tr.big td { font-size: 13pt; font-weight: 700; color: #006aff; padding-top: 8pt; padding-bottom: 8pt; border-top: 1pt solid #006aff; border-bottom: 1pt solid #006aff; background: #f5f9ff !important; }' +
      // Spacer rows
      'table.cmp tr.spacer td { background: #ffffff !important; padding: 4pt 0; border: none; height: 6pt; }' +
      // LO contact box
      '.lo-box { margin-top: 16pt; border: 1pt solid #006aff; border-radius: 4pt; padding: 10pt 14pt; text-align: center; }' +
      '.lo-box .lo-line { font-size: 10pt; color: #1f2937; }' +
      '.lo-box .lo-line strong { color: #1f2937; }' +
      '.lo-box .lo-line .phone-icon { color: #006aff; margin-right: 4pt; }' +
      '.lo-box .lo-tagline { font-size: 9pt; color: #1f2937; font-weight: 600; margin-top: 6pt; }' +
      // Compliance footer
      '.compliance { margin-top: 14pt; font-size: 7.5pt; color: #6b7280; line-height: 1.4; }' +
      // Page 2 styling
      '.page-break { page-break-before: always; }' +
      '.p2-hdr { margin-top: 0; padding-bottom: 8pt; border-bottom: 1.5pt solid #006aff; }' +
      '.p2-hdr h1 { margin: 0; font-size: 16pt; color: #1f2937; font-weight: 700; }' +
      '.p2-hdr .sub { color: #6b7280; font-size: 9.5pt; margin-top: 2pt; }' +
      '.p2card { margin-top: 14pt; border: 1pt solid #e5e7eb; border-radius: 4pt; padding: 10pt 14pt; page-break-inside: avoid; }' +
      '.p2card h2 { margin: 0; font-size: 12pt; color: #006aff; font-weight: 700; }' +
      '.p2card .p2sub { color: #6b7280; font-size: 9pt; margin-top: 2pt; margin-bottom: 8pt; }' +
      '.p2grid { display: flex; gap: 18pt; }' +
      '.p2col { flex: 1; }' +
      '.p2col h3 { margin: 0 0 4pt; font-size: 10pt; color: #1f2937; font-weight: 700; border-bottom: 1pt solid #d1d5db; padding-bottom: 3pt; }' +
      'table.p2tbl { width: 100%; border-collapse: collapse; }' +
      'table.p2tbl th { text-align: left; padding: 3pt 0; font-size: 9.5pt; font-weight: 400; color: #374151; }' +
      'table.p2tbl td { text-align: right; padding: 3pt 0; font-size: 9.5pt; font-variant-numeric: tabular-nums; color: #1f2937; }' +
      'table.p2tbl tr.total th, table.p2tbl tr.total td { font-weight: 700; color: #006aff; border-top: 1pt solid #006aff; padding-top: 5pt; margin-top: 3pt; }' +
      '.p2foot { margin-top: 8pt; font-size: 8.5pt; color: #6b7280; }' +
      '@media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }' +
      '</style></head><body>' +
      // Page 1
      '<header class="zhl-hdr">' +
        '<div>' +
          '<h1>Loan Comparison</h1>' +
          borrowerLine +
        '</div>' +
        '<div class="brand-block">' +
          '<div class="issued">Issued ' + escapeHtml(dateStr) + '</div>' +
        '</div>' +
      '</header>' +
      '<div class="banner">Your actual rate, payment and costs could be higher: get an official loan estimate before choosing a loan.</div>' +
      '<table class="cmp">' + rowsHtml + '</table>' +
      loBox +
      '<div class="compliance">' +
        'This worksheet is for illustration only — final pricing, rate, and closing costs are subject to credit approval and underwriting review. Not a commitment to lend. ' +
        'Zillow Home Loans, LLC. NMLS # 10287.' +
      '</div>' +
      // Page 2
      '<div class="page-break"></div>' +
      '<header class="p2-hdr">' +
        '<h1>Detailed cost summary</h1>' +
        '<div class="sub">' + (borrowerName ? escapeHtml(borrowerName) + ' &nbsp;·&nbsp; ' : '') + 'Issued ' + escapeHtml(dateStr) + '</div>' +
      '</header>' +
      page2Cards +
      '<div class="compliance">' +
        'Monthly cost detail is based on the saved scenario as last priced. Taxes, insurance, and escrow amounts ' +
        'are estimates and will be finalized at underwriting. Not a commitment to lend.' +
      '</div>' +
      '</body></html>';
  }

  function openPrintWindow(html) {
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

  async function onComparisonPdfClick() {
    const btn = document.querySelector('[' + BRANDED_PDF_BUTTON_ATTR + ']');
    if (btn && btn.disabled) return;
    const scenarios = findSelectedScenarios();
    if (!scenarios.length) return;
    const lo = await readLoProfile();
    const borrowerName = readBorrowerNames();
    const html = renderComparisonHtml(scenarios, lo, borrowerName);
    openPrintWindow(html);
  }

  // ---- Scan loop ------------------------------------------------

  function scan() {
    if (!isOnScenariosPage()) {
      const btn = document.querySelector('[' + BRANDED_PDF_BUTTON_ATTR + ']');
      if (btn) btn.remove();
      return;
    }
    ensureLoanComparisonPdfButton();
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      try { scan(); } catch (e) { console.error('[ZHL Loan Comparison PDF] scan error', e); }
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  // Update button state on every checkbox change (selection toggle).
  document.addEventListener('change', function (e) {
    const t = e.target;
    if (t && t.tagName === 'INPUT' && t.type === 'checkbox') schedule();
  }, true);
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
