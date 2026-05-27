// ZHL Productivity Pack module — feature key: feature_pricingResultsPrint
//
// Adds a "Print Buyer Worksheet" button into each LTV section header on
// LOP's eligibility / pricing-results table (the big rate-shop table
// the LO scrolls through to pick a rate). The button takes whichever
// rows the LO has checked in that section and opens a new tab with a
// borrower-facing handout — one scenario per page, Zillow-blue branded,
// laid out as a single readable column instead of the dense rate-shop
// table. The LO picks "Save as PDF" or sends straight to their printer
// from the browser's print dialog.
//
// What's on the handout:
//   - Brand bar + borrower name (if scrapable) + LO contact line
//   - Big two-up block: Monthly Payment and Cash to Close
//   - Loan details list: purchase price, down payment, loan amount,
//     interest rate, points, closing costs, breakeven, DTI hidden
//     (the borrower doesn't need their qualifying ratios on a handout)
//   - Footer with date generated + "rates can change daily" disclaimer
//
// Reads (best-effort) the page-level eligibility header (monthly
// income, credit score, AMI 80%, est. max amounts) for additional
// context on the handout. Falls back silently when a field is missing.

(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_pricingResultsPrint';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[ZHL Pricing Results Print v' + VERSION + '] loaded');

  const SECTION_BUTTON_ATTR = 'data-zhl-pricing-print-btn';
  const SECTION_HEADER_ATTR = 'data-zhl-pricing-print-hdr';

  function track(event, props) {
    try { chrome.runtime.sendMessage({ type: 'TRACK', event, props: props || {} }); } catch (_) {}
  }

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
    const m = /(-?\d+(?:\.\d+)?)/.exec(String(s));
    return m ? parseFloat(m[1]) : NaN;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtMoney(n) {
    if (!isFinite(n)) return '—';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    return sign + '$' + abs.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtMoneyShort(n) {
    if (!isFinite(n)) return '—';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    return sign + '$' + abs.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtPct(n, digits) {
    if (!isFinite(n)) return '—';
    return n.toFixed(digits == null ? 3 : digits) + '%';
  }

  function isOnPricingResultsPage() {
    if (!/\/loan-officer-portal\//.test(location.pathname)) return false;
    // The page-results table consistently has a row with this
    // data-cy somewhere — we use it to confirm we're on the right view
    // before bothering to scan headers.
    return !!document.querySelector('input[data-cy="pricing-results-row-checkbox"]');
  }

  // ---- Section discovery ----------------------------------------
  //
  // LOP renders each LTV / down-payment block as a separate card with
  // a header that says "<n>% Down Payment | <n>% LTV" on the left and
  // "Base Loan Amount: $<amount>" on the right, then the pricing table
  // below. We anchor on the header text and walk up to the smallest
  // ancestor that ALSO contains a pricing-results row checkbox — that
  // ancestor IS the section.

  const SECTION_TITLE_RE = /\d+(?:\.\d+)?\s*%\s*Down\s*Payment/i;
  const BASE_LOAN_RE     = /Base\s+Loan\s+Amount/i;

  function findSectionHeaderEls() {
    // Find every leaf-ish element whose direct text matches the
    // section-title pattern. Walk up to find the header CONTAINER
    // (the bar that also contains the Base Loan Amount label).
    const candidates = [];
    const all = document.querySelectorAll('div, span, p, h1, h2, h3, h4');
    all.forEach(function (el) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!SECTION_TITLE_RE.test(t)) return;
      // Skip elements that are clearly too high in the tree — we
      // want the narrow header row, not the whole page.
      if (t.length > 200) return;
      candidates.push(el);
    });
    // For each title element, walk up to find the smallest ancestor
    // that contains BOTH the section title AND the "Base Loan Amount"
    // label — that's the header BAR. We reject ancestors that also
    // contain pricing-results checkboxes (those would be the wrapper
    // that includes the table itself, so appending a button there
    // would land it below the table rather than in the header).
    const collected = new Set();
    candidates.forEach(function (el) {
      let cur = el;
      while (cur && cur !== document.body) {
        const text = (cur.textContent || '').replace(/\s+/g, ' ').trim();
        if (BASE_LOAN_RE.test(text)) {
          if (cur.querySelector('input[data-cy="pricing-results-row-checkbox"]')) return;
          collected.add(cur);
          return;
        }
        cur = cur.parentElement;
      }
    });
    // The walk-up may yield several NESTED ancestors per section
    // (each wrapper between the title element and the section card
    // could pass the test). Keep only the INNERMOST — drop any
    // element that contains another element from the same set.
    const arr = Array.from(collected);
    return arr.filter(function (h) {
      for (const other of arr) {
        if (other !== h && h.contains(other)) return false;
      }
      return true;
    });
  }

  function findSectionContainer(headerEl) {
    // The "section" is the smallest ancestor of the header that ALSO
    // contains pricing-results row checkboxes — i.e. the wrapper that
    // holds both the header bar AND the table below it.
    let cur = headerEl;
    while (cur && cur !== document.body) {
      if (cur.querySelector('input[data-cy="pricing-results-row-checkbox"]')) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function parseSectionMeta(headerEl) {
    const text = (headerEl.textContent || '').replace(/\s+/g, ' ').trim();
    const dpMatch = /(\d+(?:\.\d+)?)\s*%\s*Down\s*Payment/i.exec(text);
    const ltvMatch = /(\d+(?:\.\d+)?)\s*%\s*LTV/i.exec(text);
    const baseMatch = /Base\s+Loan\s+Amount[:\s]*\$?\s*([\d,]+(?:\.\d+)?)/i.exec(text);
    return {
      downPaymentPct: dpMatch ? parseFloat(dpMatch[1]) : NaN,
      ltvPct: ltvMatch ? parseFloat(ltvMatch[1]) : NaN,
      baseLoanAmount: baseMatch ? parseFloat(baseMatch[1].replace(/,/g, '')) : NaN
    };
  }

  // ---- Row scraping ---------------------------------------------

  function readRow(tr) {
    const tds = tr.querySelectorAll('td');
    if (tds.length < 11) return null;
    // Skip header-style rows (no checkbox).
    const cb = tr.querySelector('input[data-cy="pricing-results-row-checkbox"]');
    if (!cb) return null;
    // Cell layout: [0]chevron [1]checkbox [2]loan product [3]PITI
    //              [4]DTI [5]rate [6]points [7]price$ [8]breakeven
    //              [9]closing costs [10]cash to/from
    function txt(i) { return ((tds[i] && tds[i].textContent) || '').replace(/\s+/g, ' ').trim(); }
    const product = txt(2);
    const piti = parseMoney(txt(3));
    const dtiRaw = txt(4);
    const rate = parsePercent(txt(5));
    const pointsPct = parsePercent(txt(6));
    const priceDollar = parseMoney(txt(7));
    const breakeven = txt(8);
    const closing = parseMoney(txt(9));
    const cash = parseMoney(txt(10));
    return {
      checked: !!cb.checked,
      product: product,
      piti: piti,
      dti: dtiRaw,
      rate: rate,
      pointsPct: pointsPct,
      priceDollar: priceDollar,
      breakeven: breakeven,
      closingCosts: closing,
      cashToFrom: cash
    };
  }

  function readSelectedRows(sectionEl) {
    const rows = [];
    sectionEl.querySelectorAll('tr').forEach(function (tr) {
      const r = readRow(tr);
      if (r && r.checked) rows.push(r);
    });
    return rows;
  }

  function countSelectedRows(sectionEl) {
    let n = 0;
    sectionEl.querySelectorAll('input[data-cy="pricing-results-row-checkbox"]').forEach(function (cb) {
      if (cb.checked) n++;
    });
    return n;
  }

  // ---- Page-level scraping --------------------------------------

  function readEligibilityHeader() {
    // The eligibility bar sits at the top of the page with text like
    // "Monthly liabilities: $1,120.00 | Monthly income: $8,039.59 | AMI 80%: $90,800 | Credit score: 696".
    // We scrape it by text-pattern matching against the whole body
    // textContent. This is best-effort — missing fields fall through
    // and just don't render on the handout.
    const body = (document.body && document.body.textContent) || '';
    function pick(re) { const m = re.exec(body); return m ? m[1] : ''; }
    return {
      monthlyLiabilities: pick(/Monthly\s+liabilities[:\s]*\$?\s*([\d,]+(?:\.\d+)?)/i),
      monthlyIncome:      pick(/Monthly\s+income[:\s]*\$?\s*([\d,]+(?:\.\d+)?)/i),
      ami80:              pick(/AMI\s*80\s*%[:\s]*\$?\s*([\d,]+(?:\.\d+)?)/i),
      creditScore:        pick(/Credit\s+score[:\s]*(\d{3})/i)
    };
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

  // ---- Worksheet rendering --------------------------------------
  //
  // Layout: 3 scenarios per page, stacked vertically. Each page repeats
  // the same page-level header (loan-program-agnostic info that applies
  // to every scenario in this LTV section — purchase price, down
  // payment, loan amount — plus the LO contact box) and the same
  // footer (timestamp + disclaimer). The per-scenario block focuses
  // on the numbers that differ row-to-row: rate, points, monthly,
  // closing costs, cash to close, breakeven.

  const SCENARIOS_PER_PAGE = 3;

  function renderWorksheetHtml(scenarios, sectionMeta, eligibility, lo) {
    const now = new Date();
    const dateStr = now.toLocaleString('en-US', {
      month: 'numeric', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    }).replace(',', '');

    // Purchase price ≈ base_loan / (1 - dp%/100). Best-effort — for
    // FHA the base loan already includes UFMIP financed, so this
    // approximation is slightly off for FHA but stays in the right
    // ballpark for a buyer handout.
    function estimatedPurchasePrice(meta) {
      if (!isFinite(meta.baseLoanAmount) || !isFinite(meta.downPaymentPct)) return NaN;
      const dp = meta.downPaymentPct / 100;
      if (dp >= 1) return NaN;
      return meta.baseLoanAmount / (1 - dp);
    }
    function estimatedDownPayment(meta, purchasePrice) {
      if (!isFinite(purchasePrice) || !isFinite(meta.downPaymentPct)) return NaN;
      return purchasePrice * (meta.downPaymentPct / 100);
    }

    const purchasePrice = estimatedPurchasePrice(sectionMeta);
    const downPaymentAmt = estimatedDownPayment(sectionMeta, purchasePrice);

    // Plain-English points line — same rule as the v1.49.7 layout.
    function pointsLine(s) {
      if (!isFinite(s.pointsPct)) return '—';
      const pctStr = (s.pointsPct >= 0 ? '+' : '') + s.pointsPct.toFixed(3) + '%';
      const dollarStr = isFinite(s.priceDollar) ? fmtMoney(Math.abs(s.priceDollar)) : '';
      if (s.pointsPct < 0) {
        return pctStr + (dollarStr ? ' (lender credit ' + dollarStr + ')' : ' (lender credit)');
      }
      if (s.pointsPct > 0) {
        return pctStr + (dollarStr ? ' (cost ' + dollarStr + ')' : ' (cost)');
      }
      return 'Par pricing';
    }

    function breakevenLine(s) {
      if (!s.breakeven) return '—';
      if (/^\(/.test(s.breakeven)) return '—'; // (45) Months → lender credit path
      if (/^0\s*Months?$/i.test(s.breakeven)) return '—';
      return s.breakeven;
    }

    function scenarioBlock(s, idx) {
      return (
        '<article class="sc">' +
          '<header class="sc-hdr">' +
            '<div class="sc-hdr-left">' +
              '<span class="sc-num">Option ' + (idx + 1) + '</span>' +
              '<span class="sc-program">' + escapeHtml(s.product || 'Loan') + '</span>' +
            '</div>' +
            '<div class="sc-rate">' + (isFinite(s.rate) ? fmtPct(s.rate, 3) : '—') + '</div>' +
          '</header>' +
          '<div class="sc-big">' +
            '<div class="sc-big-cell">' +
              '<div class="sc-big-label">Monthly payment</div>' +
              '<div class="sc-big-value">' + fmtMoney(s.piti) + '</div>' +
            '</div>' +
            '<div class="sc-big-cell">' +
              '<div class="sc-big-label">Cash to close</div>' +
              '<div class="sc-big-value">' + fmtMoney(s.cashToFrom) + '</div>' +
            '</div>' +
          '</div>' +
          '<table class="sc-details">' +
            '<tr>' +
              '<th>Points</th><td>' + escapeHtml(pointsLine(s)) + '</td>' +
              '<th>Closing costs</th><td>' + fmtMoney(s.closingCosts) + '</td>' +
            '</tr>' +
            '<tr>' +
              '<th>Breakeven <span class="muted">(vs. par)</span></th><td>' + escapeHtml(breakevenLine(s)) + '</td>' +
              '<th></th><td></td>' +
            '</tr>' +
          '</table>' +
        '</article>'
      );
    }

    // Chunk scenarios into pages of SCENARIOS_PER_PAGE.
    const pageChunks = [];
    for (let i = 0; i < scenarios.length; i += SCENARIOS_PER_PAGE) {
      pageChunks.push(scenarios.slice(i, i + SCENARIOS_PER_PAGE));
    }

    const sectionInfoBits = [];
    if (isFinite(purchasePrice))            sectionInfoBits.push('Purchase price ~' + fmtMoneyShort(purchasePrice));
    if (isFinite(downPaymentAmt))           sectionInfoBits.push('Down payment ' + fmtMoneyShort(downPaymentAmt) +
      (isFinite(sectionMeta.downPaymentPct) ? ' (' + sectionMeta.downPaymentPct.toFixed(2).replace(/\.?0+$/, '') + '%)' : ''));
    if (isFinite(sectionMeta.baseLoanAmount)) sectionInfoBits.push('Loan amount ' + fmtMoneyShort(sectionMeta.baseLoanAmount));
    if (isFinite(sectionMeta.ltvPct))         sectionInfoBits.push(sectionMeta.ltvPct.toFixed(3).replace(/\.?0+$/, '') + '% LTV');

    const loBits = [];
    if (lo.nmls)  loBits.push('NMLS #' + escapeHtml(lo.nmls));
    if (lo.phone) loBits.push(escapeHtml(lo.phone));
    if (lo.email) loBits.push(escapeHtml(lo.email));

    function pageHtml(scs, pageIdx, totalPages) {
      return (
        '<section class="page">' +
          '<header class="page-hdr">' +
            '<div class="brand-bar"></div>' +
            '<div class="hdr-row">' +
              '<div class="hdr-left">' +
                '<div class="eyebrow">Mortgage Rate Worksheet' +
                  (totalPages > 1 ? ' &nbsp;·&nbsp; Page ' + (pageIdx + 1) + ' of ' + totalPages : '') +
                '</div>' +
                '<h1>Rate Options</h1>' +
                (sectionInfoBits.length
                  ? '<div class="hdr-sub">' + sectionInfoBits.map(escapeHtml).join(' &nbsp;·&nbsp; ') + '</div>'
                  : '') +
              '</div>' +
              (lo.name || loBits.length
                ? '<div class="hdr-right lo-box">' +
                    '<div class="lo-eyebrow">Your loan officer</div>' +
                    '<div class="lo-name">' + escapeHtml(lo.name || '') + '</div>' +
                    (loBits.length ? '<div class="lo-meta">' + loBits.join(' &nbsp;|&nbsp; ') + '</div>' : '') +
                  '</div>'
                : '') +
            '</div>' +
          '</header>' +
          '<div class="scenarios">' +
            scs.map(function (s, j) { return scenarioBlock(s, pageIdx * SCENARIOS_PER_PAGE + j); }).join('') +
          '</div>' +
          '<footer class="page-foot">' +
            '<div>Generated ' + escapeHtml(dateStr) + '</div>' +
            '<div class="disclaimer">' +
              'Estimated figures based on current pricing. Mortgage interest rates can change daily — ' +
              'sometimes hourly. Final numbers will be confirmed in your Loan Estimate. Not a commitment to lend.' +
            '</div>' +
          '</footer>' +
        '</section>'
      );
    }

    const pagesHtml = pageChunks.map(function (scs, i) {
      return pageHtml(scs, i, pageChunks.length);
    }).join('');

    const css = (
      '@page { size: letter; margin: 0; }' +
      'html, body { margin: 0; padding: 0; background: #f1f5f9; color: #0f172a;' +
      ' font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; }' +
      '.page { box-sizing: border-box; width: 8.5in; min-height: 11in; padding: 0.5in 0.55in 0.45in;' +
      ' background: #fff; margin: 0 auto 14px; page-break-after: always;' +
      ' display: flex; flex-direction: column; position: relative; }' +
      '.page:last-child { page-break-after: auto; }' +
      '.brand-bar { position: absolute; top: 0; left: 0; right: 0; height: 6px; background: #006aff; }' +
      '.page-hdr { padding-top: 4px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0; }' +
      '.hdr-row { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }' +
      '.eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;' +
      ' color: #006aff; margin-bottom: 4px; }' +
      '.hdr-left h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.01em; color: #0f172a; }' +
      '.hdr-sub { margin-top: 4px; font-size: 12px; color: #475569; }' +
      '.lo-box { text-align: right; font-size: 11px; color: #475569; max-width: 3.2in; }' +
      '.lo-eyebrow { font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;' +
      ' color: #006aff; }' +
      '.lo-name { margin-top: 2px; font-size: 13px; font-weight: 700; color: #0f172a; }' +
      '.lo-meta { margin-top: 2px; font-size: 11px; color: #475569; }' +
      '.scenarios { display: flex; flex-direction: column; gap: 12px; margin-top: 14px; }' +
      '.sc { border: 1px solid #cbd5e1; border-left: 4px solid #006aff; border-radius: 8px;' +
      ' padding: 12px 14px; page-break-inside: avoid; }' +
      '.sc-hdr { display: flex; justify-content: space-between; align-items: baseline;' +
      ' padding-bottom: 8px; border-bottom: 1px solid #e2e8f0; margin-bottom: 10px; }' +
      '.sc-hdr-left { display: flex; align-items: baseline; gap: 10px; }' +
      '.sc-num { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;' +
      ' color: #006aff; background: #e0eaff; padding: 3px 8px; border-radius: 999px; }' +
      '.sc-program { font-size: 15px; font-weight: 700; color: #0f172a; }' +
      '.sc-rate { font-size: 26px; font-weight: 700; color: #006aff; letter-spacing: -0.02em; }' +
      '.sc-big { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }' +
      '.sc-big-cell { background: #f0f6ff; border-radius: 6px; padding: 8px 12px; }' +
      '.sc-big-label { font-size: 9px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;' +
      ' color: #475569; }' +
      '.sc-big-value { margin-top: 2px; font-size: 22px; font-weight: 700; color: #006aff;' +
      ' letter-spacing: -0.02em; }' +
      '.sc-details { width: 100%; border-collapse: collapse; }' +
      '.sc-details th { text-align: left; font-weight: 500; color: #475569; font-size: 11px;' +
      ' padding: 4px 8px 4px 0; width: 22%; vertical-align: top; }' +
      '.sc-details td { text-align: left; font-weight: 600; color: #0f172a; font-size: 12px;' +
      ' padding: 4px 16px 4px 0; width: 28%; vertical-align: top; }' +
      '.sc-details .muted { color: #94a3b8; font-weight: 400; font-size: 10px; }' +
      '.page-foot { margin-top: auto; padding-top: 10px; border-top: 1px solid #e2e8f0;' +
      ' font-size: 9px; color: #64748b; line-height: 1.5; }' +
      '.page-foot .disclaimer { margin-top: 2px; }' +
      '@media print { html, body { background: #fff; } .page { margin: 0; box-shadow: none; } }'
    );

    const titleSuffix = isFinite(sectionMeta.downPaymentPct)
      ? sectionMeta.downPaymentPct.toFixed(2).replace(/\.?0+$/, '') + '% Down'
      : 'Worksheet';

    return (
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<title>Rate Worksheet — ' + escapeHtml(titleSuffix) + '</title>' +
      '<style>' + css + '</style></head>' +
      '<body>' + pagesHtml +
      '<script>window.addEventListener("load", function(){ setTimeout(function(){ window.print(); }, 250); });<\/script>' +
      '</body></html>'
    );
  }

  // ---- Click handler --------------------------------------------

  async function onPrintClick(sectionEl, headerEl) {
    const rows = readSelectedRows(sectionEl);
    if (!rows.length) return;
    const sectionMeta = parseSectionMeta(headerEl);
    const eligibility = readEligibilityHeader();
    const lo = await readLoProfile();
    const html = renderWorksheetHtml(rows, sectionMeta, eligibility, lo);
    const win = window.open('about:blank', '_blank');
    if (!win) {
      alert('ZHL Buyer Worksheet: please allow popups for this site.');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    track('pricing_results_print', {
      rows: rows.length,
      downPaymentPct: sectionMeta.downPaymentPct,
      ltvPct: sectionMeta.ltvPct
    });
    // Record time saved: each handout would otherwise be a hand-typed
    // comparison sheet / verbal walkthrough — credit 3 min per
    // scenario printed (low end of LO estimate for assembling the
    // numbers, formatting, and emailing).
    try {
      if (window.__zhlTimeSaved && window.__zhlTimeSaved.recordAndForget) {
        window.__zhlTimeSaved.recordAndForget('pricing-results-print', rows.length * 3);
      }
    } catch (_) {}
  }

  // ---- Button injection -----------------------------------------

  function ensureSectionButtons() {
    const headers = findSectionHeaderEls();
    // Tag known headers and remove buttons whose header is gone (LOP
    // re-renders the table on filter / repricing).
    const liveHeaderSet = new Set(headers);
    document.querySelectorAll('[' + SECTION_BUTTON_ATTR + ']').forEach(function (btn) {
      const owner = btn.__zhlOwnerHeader;
      if (!owner || !liveHeaderSet.has(owner) || !document.body.contains(owner)) {
        btn.remove();
      }
    });
    headers.forEach(function (headerEl) {
      const sectionEl = findSectionContainer(headerEl);
      if (!sectionEl) return;
      let btn = headerEl.querySelector('[' + SECTION_BUTTON_ATTR + ']');
      if (!btn) {
        btn = document.createElement('button');
        btn.setAttribute(SECTION_BUTTON_ATTR, '1');
        btn.type = 'button';
        btn.style.cssText =
          'display:inline-flex;align-items:center;justify-content:center;gap:6px;' +
          'background:#006aff;color:#fff;border:1px solid #006aff;border-radius:4px;' +
          'cursor:pointer;font-family:Arial,Helvetica,sans-serif;font-weight:600;' +
          'font-size:12px;line-height:1.2;padding:6px 12px;margin-left:12px;' +
          'box-sizing:border-box;white-space:nowrap;';
        btn.addEventListener('mouseenter', function () { if (!btn.disabled) btn.style.background = '#0056d2'; });
        btn.addEventListener('mouseleave', function () { btn.style.background = btn.disabled ? '#94a3b8' : '#006aff'; });
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (btn.disabled) return;
          onPrintClick(sectionEl, headerEl).catch(function (err) {
            console.error('[ZHL Pricing Results Print] click error', err);
          });
        });
        btn.__zhlOwnerHeader = headerEl;
        headerEl.setAttribute(SECTION_HEADER_ATTR, '1');
        // Inject near the "Base Loan Amount" label so it sits at the
        // far right of the section header bar. We append to the
        // header container directly — flexbox layouts handle the
        // positioning consistently across LOP's React render variants.
        headerEl.appendChild(btn);
      }
      const n = countSelectedRows(sectionEl);
      const baseLabel = '📄 Print Buyer Worksheet';
      if (n > 0) {
        btn.disabled = false;
        btn.style.background = '#006aff';
        btn.style.borderColor = '#006aff';
        btn.style.cursor = 'pointer';
        btn.textContent = baseLabel + ' (' + n + ')';
        btn.title = 'Print a borrower-facing worksheet for the ' + n + ' selected row' +
          (n === 1 ? '' : 's') + ' in this section.\n\nBuilt by Justin Case. Karma appreciated 💛';
      } else {
        btn.disabled = true;
        btn.style.background = '#94a3b8';
        btn.style.borderColor = '#94a3b8';
        btn.style.cursor = 'not-allowed';
        btn.textContent = baseLabel;
        btn.title = 'Check one or more rows in this section first.\n\nBuilt by Justin Case. Karma appreciated 💛';
      }
    });
  }

  // ---- Scheduler -------------------------------------------------

  function scan() {
    if (!isOnPricingResultsPage()) {
      document.querySelectorAll('[' + SECTION_BUTTON_ATTR + ']').forEach(function (b) { b.remove(); });
      return;
    }
    ensureSectionButtons();
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      try { scan(); } catch (e) { console.error('[ZHL Pricing Results Print] scan error', e); }
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
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
