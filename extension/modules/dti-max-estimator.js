// ZHL Productivity Pack module — feature key: feature_dtiMaxEstimator
//
// Max-purchase-price estimator for the Pricing & Scenarios page.
//
// Reads the currently displayed pricing-results rows, parses the PITI
// and back-end DTI for each, and back-solves the purchase price that
// would push DTI to that loan program's cap. Renders inline pills
// in the Eligibility Details bar — one per loan-type group present
// in the results (Conventional / FHA / VA).
//
// Math:
//   currentTotalMonthly = piti + monthlyLiabilities
//   maxTotalMonthly     = monthlyIncome * (dtiCap / 100)
//   maxPiti             = maxTotalMonthly - monthlyLiabilities
//   pitiPerDollar       = piti / purchasePrice
//   maxPurchasePrice    = maxPiti / pitiPerDollar
//
// Linear extrapolation. P&I scales linearly with loan amount (fixed
// DP%), HOI and property tax are entered as % of PP, so taxes /
// insurance scale linearly with PP too. MI rates change with LTV
// (constant for fixed DP%) so MI stays a near-constant % of loan
// amount. Net: PITI is close to linear in PP and the estimate is
// accurate to within a percent or two — close enough to type into
// the Purchase price field and re-run pricing for the exact value.

(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_dtiMaxEstimator';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[DTI Max Estimator v' + VERSION + '] loaded');

  const PILL_ATTR = 'data-zhl-dti-max';
  const ZHL_TIP = 'Built by Justin Case. Karma appreciated 💛';

  // Per-loan-type DTI ceilings. Each is set a hair under the hard
  // cap so DU / LPA don't bounce the file on the upper boundary.
  const DTI_CAPS = {
    CONV: 49.99,
    FHA: 56.99,
    VA: 60.00
  };

  function classifyLoanType(productName) {
    const p = (productName || '').toUpperCase();
    if (/\bFHA\b/.test(p)) return 'FHA';
    if (/\bVA\b/.test(p)) return 'VA';
    // Conventional product names ZHL uses: Conf, Conf Home Ready,
    // Conf Home Poss, Conf RefiNow, Conf High Balance, Jumbo (Exp /
    // Self Employed). Match permissively.
    if (/\b(CONF|CONV|JUMBO|HOME\s*READY|HOME\s*POSS|REFINOW)\b/.test(p)) return 'CONV';
    return null;
  }

  function parseMoney(text) {
    if (!text) return NaN;
    // Strip $, commas, /yr /mo, parens (negatives), %.
    const s = String(text).replace(/[\$,]/g, '').replace(/\s|\/yr|\/mo/gi, '');
    const neg = /^\(.+\)$/.test(s);
    const n = parseFloat(s.replace(/[()]/g, ''));
    if (!isFinite(n)) return NaN;
    return neg ? -n : n;
  }

  function parseBackDti(text) {
    // Cells contain either "44.46%" or "43.12/44.46%" (front/back).
    // Use the back number (right of slash) — that's what the
    // overlay caps target.
    const t = (text || '').replace('%', '').trim();
    if (!t) return NaN;
    if (t.indexOf('/') !== -1) {
      const parts = t.split('/');
      return parseFloat(parts[parts.length - 1]);
    }
    return parseFloat(t);
  }

  // ---- Read income / liabilities from the Eligibility row -------

  function readEligibilityRow() {
    const row = findEligibilityRow();
    if (!row) return null;
    const cells = row.querySelectorAll('span, button');
    let income = NaN, liab = NaN;
    cells.forEach(function (el, idx) {
      const txt = (el.textContent || '').trim();
      if (/^Monthly income:?$/i.test(txt)) {
        const next = cells[idx + 1];
        if (next) income = parseMoney(next.textContent);
      }
      if (/^Monthly liabilities:?$/i.test(txt)) {
        const next = cells[idx + 1];
        if (next) liab = parseMoney(next.textContent);
      }
    });
    return { row: row, income: income, liabilities: liab };
  }

  function findEligibilityRow() {
    // The Eligibility Details header sits inside a labeled card.
    // The row that holds the pills is its sibling Flex with the
    // dividers. Find the "Eligibility Details" label, then walk to
    // the Flex that holds Monthly income / Credit score.
    const labels = document.querySelectorAll('span');
    for (const sp of labels) {
      if ((sp.textContent || '').trim() !== 'Eligibility Details') continue;
      // Sibling: the pills row.
      const wrap = sp.parentElement;
      if (!wrap) continue;
      // The pills row is a Flex inside the same wrapper.
      const flexes = wrap.querySelectorAll('div');
      for (const f of flexes) {
        const t = (f.textContent || '');
        if (/Monthly income/.test(t) && /Credit score/.test(t)) return f;
      }
    }
    return null;
  }

  // ---- Read pricing-results table rows --------------------------

  function readPricingRows() {
    const out = [];
    const tables = document.querySelectorAll('table[aria-label="Table of selectable rate quote options"]');
    tables.forEach(function (table) {
      const rows = table.querySelectorAll('tbody tr');
      rows.forEach(function (tr) {
        const tds = tr.querySelectorAll('td');
        if (tds.length < 8) return;
        // Header row has <p>Select</p> / <p>Loan product</p> etc.
        // Skip if first product-name cell is the header text.
        const productCell = tds[2];
        const product = (productCell && productCell.textContent || '').trim();
        if (!product || /^Loan product$/i.test(product)) return;
        const pitiText = (tds[3] && tds[3].textContent || '').trim();
        const dtiText = (tds[4] && tds[4].textContent || '').trim();
        const piti = parseMoney(pitiText);
        const dtiBack = parseBackDti(dtiText);
        if (!isFinite(piti) || piti <= 0) return;
        out.push({ product: product, piti: piti, dtiBack: dtiBack });
      });
    });
    return out;
  }

  // ---- Compute max PP per loan-type group -----------------------

  function readCurrentPurchasePrice() {
    const el = document.querySelector('input[name="purchasePrice"]');
    if (!el) return NaN;
    return parseMoney(el.value);
  }

  function computeMaxes(rows, income, liab, currentPP) {
    if (!isFinite(income) || income <= 0) return [];
    if (!isFinite(liab)) liab = 0;
    if (!isFinite(currentPP) || currentPP <= 0) return [];

    // Group by loan type, pick the row with the lowest PITI per
    // group (the most-generous product for max-PP purposes).
    const best = {};
    rows.forEach(function (r) {
      const type = classifyLoanType(r.product);
      if (!type || !DTI_CAPS.hasOwnProperty(type)) return;
      if (!best[type] || r.piti < best[type].piti) best[type] = r;
    });

    const out = [];
    Object.keys(DTI_CAPS).forEach(function (type) {
      const row = best[type];
      if (!row) return;
      const cap = DTI_CAPS[type];
      const maxTotal = income * (cap / 100);
      const maxPiti = maxTotal - liab;
      if (maxPiti <= 0) { out.push({ type: type, cap: cap, maxPP: 0, reason: 'liabilities exceed cap' }); return; }
      const pitiPerDollar = row.piti / currentPP;
      if (!isFinite(pitiPerDollar) || pitiPerDollar <= 0) return;
      const maxPP = Math.floor(maxPiti / pitiPerDollar / 1000) * 1000;
      out.push({ type: type, cap: cap, maxPP: maxPP, basedOn: row.product, basedOnPiti: row.piti });
    });
    return out;
  }

  // ---- Render pills ---------------------------------------------

  function formatPP(n) {
    if (!isFinite(n) || n <= 0) return '—';
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(2) + 'M';
    if (n >= 1000) return '$' + Math.round(n / 1000) + 'k';
    return '$' + n.toLocaleString();
  }

  function buildPill(estimate) {
    const wrap = document.createElement('div');
    wrap.setAttribute(PILL_ATTR, estimate.type);
    wrap.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'gap:8px',
      'padding:6px 14px',
      'margin-left:12px',
      'border-radius:999px',
      'background:#eef6ff',
      'border:1px solid #bfdbfe',
      'color:#1d4ed8',
      'font-size:15px',
      'font-weight:700',
      'line-height:1.5',
      'white-space:nowrap'
    ].join(';');
    wrap.title = (estimate.basedOn
      ? 'Estimated max purchase price for ' + estimate.type +
        ' at ' + estimate.cap + '% back-end DTI.\nBased on ' + estimate.basedOn +
        ' (PITI $' + estimate.basedOnPiti.toLocaleString() + ').\n' +
        'Linear extrapolation from current scenario.'
      : 'Estimated max purchase price for ' + estimate.type + ' at ' + estimate.cap + '% DTI.')
      + '\n\n' + ZHL_TIP;
    const label = document.createElement('span');
    label.textContent = 'Max ' + estimate.type + ':';
    label.style.cssText = 'color:#1e3a8a;font-weight:600;';
    const val = document.createElement('span');
    val.textContent = formatPP(estimate.maxPP) + ' @ ' + estimate.cap + '%';
    wrap.appendChild(label);
    wrap.appendChild(val);
    return wrap;
  }

  function renderPills(estimates, anchorRow) {
    // Remove old pills first (we re-render on every scan).
    document.querySelectorAll('[' + PILL_ATTR + ']').forEach(function (el) { el.remove(); });
    if (!estimates.length || !anchorRow) return;
    estimates.forEach(function (est) {
      anchorRow.appendChild(buildPill(est));
    });
  }

  // ---- Scan loop ------------------------------------------------

  function scan() {
    // Only meaningful on the pricing/scenarios sub-page.
    if (!/\/loan-officer-portal\//.test(location.pathname)) return;
    const elig = readEligibilityRow();
    if (!elig) return;
    const rows = readPricingRows();
    if (!rows.length) {
      // Pricing not run yet — clear any stale pills.
      document.querySelectorAll('[' + PILL_ATTR + ']').forEach(function (el) { el.remove(); });
      return;
    }
    const pp = readCurrentPurchasePrice();
    const estimates = computeMaxes(rows, elig.income, elig.liabilities, pp);
    renderPills(estimates, elig.row);
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      try { scan(); } catch (e) { console.warn('[DTI Max Estimator] scan error', e); }
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
