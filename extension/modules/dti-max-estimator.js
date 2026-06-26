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
    // Labels in LOP's redesigned eligibility row are <p> tags, not
    // <span>s. The old side-panel view uses <span> labels and <p>
    // values, so we accept either — the pair logic just walks the
    // flat NodeList and pairs each label with the next sibling cell.
    const cells = row.querySelectorAll('p, span, button');
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

  // Auto-expand state. We try ONE click target per scan tick (not all
  // candidates at once), so we don't accidentally toggle the section
  // open→closed→open when multiple ancestors handle the click event
  // (e.g. an inner toggle + an outer delegated handler). Reset
  // implicitly per page load since the module reloads.
  let autoExpandAttempt = 0;
  let lastSectionStateMs = 0;

  function findEligibilityLabel() {
    // Label text changed case in LOP's redesign: "Eligibility Details"
    // -> "Eligibility details". Match case-insensitively to survive
    // either spelling. Also match p/h2/h3/button in case LOP rerolls
    // the heading element type.
    const nodes = document.querySelectorAll('span, p, h1, h2, h3, h4, button, [role="button"]');
    for (const n of nodes) {
      const txt = (n.textContent || '').trim();
      if (/^eligibility details$/i.test(txt)) return n;
    }
    return null;
  }

  // Find the most likely "toggle this section" target near the label.
  // Three passes, best signal first:
  //
  //   Pass 1 — explicit ARIA/semantic: aria-expanded="false",
  //     role="button", or <button> ancestor. Definitive when present.
  //
  //   Pass 2 — cursor:pointer up the tree. This is the actual signal
  //     in styled-components / React apps that don't use semantic
  //     roles. LOP's c11n disclosure cards fall here — the header
  //     wrapper is just a styled <div> whose CSS sets cursor:pointer
  //     over the chevron+label group; the onClick handler is bound
  //     to that same wrapper.
  //
  //   Pass 3 — ancestor that contains BOTH the label AND a chevron.
  //     The c11n IconChevron* SVGs have pointer-events:none (clicks
  //     pass through to the underlying header), so clicking the SVG
  //     directly is a no-op — we must click the wrapper div instead.
  //     The closest ancestor that contains both the label text and a
  //     chevron icon is almost always that wrapper.
  //
  // Returns the label's immediate parent as a last resort.
  function findExpandTarget(labelEl) {
    if (!labelEl) return null;

    const CHEV_SEL =
      'svg[class*="Chevron" i], svg[class*="Caret" i], ' +
      'svg[data-icon*="chevron" i], svg[data-icon*="caret" i], ' +
      'i[class*="chevron" i], i[class*="caret" i]';

    // Pass 0 (highest priority for c11n disclosure cards): if the
    // label's IMMEDIATE PARENT also contains a chevron, that parent
    // is the clickable header. Confirmed by the LO pointing at the
    // exact element on the Pricing & Scenarios page:
    //   <div class="...sc-b39bca77-1 eHAYmk iBCvKQ">
    //     <svg class="...IconChevronUp...">…</svg>
    //     <span>Eligibility details</span>
    //   </div>
    // The chevron SVG has pointer-events:none (clicks pass through),
    // and there's no aria-expanded / role=button / <button> ancestor
    // — pure styled-components disclosure. So this leaf div is the
    // only correct click target on c11n surfaces.
    if (labelEl.parentElement && labelEl.parentElement.querySelector &&
        labelEl.parentElement.querySelector(CHEV_SEL)) {
      return labelEl.parentElement;
    }

    // Pass 1: explicit ARIA / semantic signals.
    let cur = labelEl;
    for (let depth = 0; depth < 12 && cur && cur !== document.body; depth++) {
      if (cur.getAttribute) {
        if (cur.getAttribute('aria-expanded') === 'false') return cur;
        if (cur.getAttribute('role') === 'button') return cur;
      }
      if (cur.tagName === 'BUTTON') return cur;
      cur = cur.parentElement;
    }

    // Pass 2: cursor:pointer.
    cur = labelEl;
    for (let depth = 0; depth < 12 && cur && cur !== document.body; depth++) {
      try {
        const cs = window.getComputedStyle(cur);
        if (cs && cs.cursor === 'pointer') return cur;
      } catch (_) {}
      cur = cur.parentElement;
    }

    // Pass 3: nearest ancestor that contains BOTH label and a chevron.
    cur = labelEl;
    for (let depth = 0; depth < 8 && cur && cur !== document.body; depth++) {
      if (cur.querySelector && cur.querySelector(CHEV_SEL)) return cur;
      cur = cur.parentElement;
    }

    return labelEl.parentElement || null;
  }

  // Full pointer/mouse event sequence. LOP's styled-component
  // collapse toggles often need the real pointer/mouse buildup —
  // a plain .click() on the inner flex fires but React's onClick
  // doesn't process it. Mirrors the helper used in the Zoho booking
  // paster for the same "kx framework" pattern.
  function fullClickSequence(el) {
    if (!el || !el.dispatchEvent) return;
    try {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const base = {
        bubbles: true, cancelable: true, composed: true, view: window,
        button: 0, buttons: 1, clientX: x, clientY: y
      };
      const types = ['pointerover','pointerenter','mouseover','mouseenter','pointerdown','mousedown','pointerup','mouseup'];
      for (const type of types) {
        try {
          const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
          el.dispatchEvent(new Ctor(type, base));
        } catch (_) {}
      }
      el.click();
    } catch (_) {
      try { el.click(); } catch (__) {}
    }
  }

  function findEligibilityRow() {
    // The Eligibility Details header sits inside a labeled card. The
    // row that holds the pills (Monthly income, Credit score,
    // Liabilities, etc.) is rendered as a sibling Flex when the
    // section is expanded. In LOP's redesigned scenarios page the
    // section is COLLAPSED by default — the pill row is not in the
    // DOM until the LO clicks the header chevron.
    const labelSpan = findEligibilityLabel();
    if (!labelSpan) return null;
    // Walk up to 10 ancestor levels from the label looking for a Flex
    // that contains both "Monthly income" and "Credit score" text.
    // Case-insensitive — LOP's redesign uses title case ("Monthly
    // Income" / "Credit Score") while the old layout used sentence
    // case. Match both.
    let cur = labelSpan;
    for (let depth = 0; depth < 10 && cur; depth++) {
      const flexes = cur.querySelectorAll ? cur.querySelectorAll('div') : [];
      for (const f of flexes) {
        const t = (f.textContent || '');
        if (/Monthly income/i.test(t) && /Credit score/i.test(t)) return f;
      }
      cur = cur.parentElement;
    }
    // Section is collapsed. Click the most likely toggle target (the
    // closest aria-expanded="false" / role=button / chevron icon).
    // One click per scan tick — multiple clicks per tick from different
    // ancestors cancel each other out (open→closed→open ends back where
    // it started). The 1.5s throttle on subsequent attempts gives LOP
    // time to animate the disclosure open before we re-evaluate; without
    // it we'd race the animation and click again before the pill row
    // mounted, closing the section we just opened.
    const now = Date.now();
    if (now - lastSectionStateMs > 1500 && autoExpandAttempt < 8) {
      const target = findExpandTarget(labelSpan);
      if (target) {
        console.log('[ZHL DTI Max Estimator] auto-expand attempt #' + autoExpandAttempt + ' on', target);
        fullClickSequence(target);
        lastSectionStateMs = now;
        autoExpandAttempt++;
      }
    }
    return null;
  }

  // ---- Read pricing-results table rows --------------------------

  // Module-level cache of the last-known SELECTED PITI per loan
  // type. Populated whenever the products panel is collapsed
  // (rendering only the selected row), and used to identify the
  // same row when the panel is expanded (where ~30 rate options
  // are visible and a naïve lowest-PITI pick would otherwise land
  // on a deep-buydown row instead of the one the LO is actually
  // pricing at). Cleared implicitly on page navigation since the
  // module reloads.
  const selectedPitiCache = {}; // { CONV: 1584.44, FHA: ..., VA: ... }

  function readPricingRows() {
    const out = [];
    const tables = document.querySelectorAll('table[aria-label="Table of selectable rate quote options"]');
    tables.forEach(function (table) {
      const trs = Array.from(table.querySelectorAll('tbody tr'));
      // Extract per-row data first so we can both (a) update the
      // selected-PITI cache when this table is collapsed to a
      // single row and (b) push the same data into the output.
      const tableRows = [];
      trs.forEach(function (tr) {
        const tds = tr.querySelectorAll('td');
        if (tds.length < 8) return;
        const productCell = tds[2];
        const product = (productCell && productCell.textContent || '').trim();
        if (!product || /^Loan product$/i.test(product)) return;
        const pitiText = (tds[3] && tds[3].textContent || '').trim();
        const dtiText = (tds[4] && tds[4].textContent || '').trim();
        const piti = parseMoney(pitiText);
        const dtiBack = parseBackDti(dtiText);
        if (!isFinite(piti) || piti <= 0) return;
        const checkbox = tr.querySelector('input[type="checkbox"], input[type="radio"]');
        const ariaSelected = tr.getAttribute && tr.getAttribute('aria-selected');
        const cls = (tr.className || '') + '';
        const isSelected =
          (checkbox && checkbox.checked) ||
          ariaSelected === 'true' ||
          /\bselected\b|\bhighlight(ed)?\b|\bis-active\b/i.test(cls);
        tableRows.push({ product: product, piti: piti, dtiBack: dtiBack, isSelected: !!isSelected });
      });
      // Collapsed view = single rendered row per table. That row is
      // by definition the LO's selected scenario. Cache its PITI
      // by loan type so we can identify the same row when the LO
      // expands the products panel.
      if (tableRows.length === 1) {
        const r = tableRows[0];
        const type = classifyLoanType(r.product);
        if (type) selectedPitiCache[type] = r.piti;
      }
      for (const r of tableRows) out.push(r);
    });
    return out;
  }

  // ---- Compute max PP per loan-type group -----------------------

  function readCurrentPurchasePrice() {
    const el = document.querySelector('input[name="purchasePrice"]');
    if (!el) return NaN;
    return parseMoney(el.value);
  }

  // Read the scenario form inputs that matter for the breakdown.
  // We decompose PITI into the components that scale linearly with
  // PP (P&I + MI, taxes-as-%, HOI-as-%) and the components that
  // don't (HOA, other monthly, tax-as-flat-$, HOI-as-flat-$). A
  // pure ratio extrapolation (the v1.27.0/.1/.2 math) overstates
  // PITI growth when HOA or fixed monthly costs are non-zero, and
  // it can also understate growth when crossing program tiers —
  // but the bigger LO-visible accuracy win is decomposing taxes
  // and insurance correctly.
  function readPricingForm() {
    const get = function (name) {
      const el = document.querySelector('input[name="' + name + '"], select[name="' + name + '"]');
      return el ? el.value : '';
    };
    const dpPct = parseFloat(get('downPayments.0.downPaymentPercent'));
    const dpAmt = parseMoney(get('downPayments.0.downPayment'));
    return {
      purchasePrice: parseMoney(get('purchasePrice')),
      // We hold DOWN PAYMENT DOLLARS fixed when extrapolating PP.
      // That matches how LOs actually run scenarios — the borrower
      // has a fixed amount of cash to put down, and the question is
      // "how much house can they afford with that $X?". Holding DP%
      // constant (v1.27.0-.3 behavior) would scale the down
      // payment up linearly with PP, hiding the fact that the loan
      // amount rises much faster when DP$ is held constant.
      downPaymentAmount: isFinite(dpAmt) ? dpAmt : 0,
      downPaymentPct: isFinite(dpPct) ? dpPct : 0,
      // Yearly taxes / HOI: LOP stores both an absolute dollar amount
      // AND a percentage of PP. If the percentage is filled, that's
      // the authoritative rate and the dollar amount scales with PP.
      // If only the dollar amount is set, treat it as a fixed bill.
      yearlyTaxesPct: parseFloat(get('taxesPercentage')) || 0,
      yearlyTaxesAmount: parseMoney(get('taxesAmount')) || 0,
      yearlyHoiPct: parseFloat(get('hoiPercentage')) || 0,
      yearlyHoiAmount: parseMoney(get('hoiAmount')) || 0,
      hoaMonthly: parseMoney(get('homeownersAssociationDues')) || 0,
      otherMonthly: parseMoney(get('otherMonthlyPayment')) || 0
    };
  }

  // 2025 conforming baseline. High-balance counties go up to
  // $1,209,750 but the rate / MI hit happens at the baseline for
  // most LOs. Used only to flag that the estimate crosses into
  // jumbo / high-balance territory where rates and MI rebase.
  const CONFORMING_LIMIT_2025 = 806500;

  function computeMaxes(rows, income, liab, currentPP) {
    if (!isFinite(income) || income <= 0) return [];
    if (!isFinite(liab)) liab = 0;
    if (!isFinite(currentPP) || currentPP <= 0) return [];

    const form = readPricingForm();
    const dpAmount = form.downPaymentAmount || 0;
    const taxRate = (form.yearlyTaxesPct || 0) / 100;
    const hoiRate = (form.yearlyHoiPct || 0) / 100;
    const hoa = form.hoaMonthly || 0;
    const other = form.otherMonthly || 0;
    // If taxes / HOI are entered as a flat dollar (no % filled), they
    // stay constant when PP changes.
    const fixedTaxMonthly = taxRate > 0 ? 0 : (form.yearlyTaxesAmount / 12);
    const fixedHoiMonthly = hoiRate > 0 ? 0 : (form.yearlyHoiAmount / 12);
    const currentLtv = ((currentPP - dpAmount) / currentPP) * 100;

    // Group by loan type and pick which row represents the LO's
    // selected scenario. Three-tier fallback:
    //   1. Match against the cached PITI from the collapsed view
    //      (most reliable — collapsed view always renders only
    //      the selected row).
    //   2. Match by row.isSelected (checkbox / aria-selected /
    //      selected class — works for some LOP layouts).
    //   3. Fall back to lowest PITI per type (original behavior).
    // Without the cache, expanding the products panel was making
    // the estimate jump by tens of thousands because the lowest
    // PITI in the expanded view is a deep-buydown rate the LO
    // isn't actually using.
    const best = {};
    Object.keys(DTI_CAPS).forEach(function (type) {
      const typeRows = rows.filter(function (r) {
        return classifyLoanType(r.product) === type;
      });
      if (typeRows.length === 0) return;
      // Tier 1: cached selected PITI
      const cached = selectedPitiCache[type];
      if (cached !== undefined) {
        const match = typeRows.find(function (r) {
          return Math.abs(r.piti - cached) < 0.01;
        });
        if (match) { best[type] = match; return; }
      }
      // Tier 2: row marked isSelected in the DOM
      const flagged = typeRows.find(function (r) { return r.isSelected; });
      if (flagged) { best[type] = flagged; return; }
      // Tier 3: lowest PITI (original behavior)
      let lowest = typeRows[0];
      for (const r of typeRows) if (r.piti < lowest.piti) lowest = r;
      best[type] = lowest;
    });

    const out = [];
    Object.keys(DTI_CAPS).forEach(function (type) {
      const row = best[type];
      if (!row) return;
      const cap = DTI_CAPS[type];
      const maxTotal = income * (cap / 100);
      const maxPiti = maxTotal - liab;
      if (maxPiti <= 0) {
        out.push({ type: type, cap: cap, maxPP: 0, reason: 'liabilities exceed cap' });
        return;
      }

      // Decompose the current PITI into its components.
      const currentMonthlyTax = taxRate > 0 ? (currentPP * taxRate / 12) : fixedTaxMonthly;
      const currentMonthlyHoi = hoiRate > 0 ? (currentPP * hoiRate / 12) : fixedHoiMonthly;
      const piPlusMi = row.piti - currentMonthlyTax - currentMonthlyHoi - hoa - other;
      if (piPlusMi <= 0) return;

      const currentLoan = currentPP - dpAmount;
      if (currentLoan <= 0) return;
      // P&I + MI scale together with loan amount at the same rate
      // and MI factor — true as long as the loan stays inside the
      // same product tier (conforming / high-balance / jumbo). We
      // flag the tier crossing below.
      const piMiPerLoanDollar = piPlusMi / currentLoan;

      // Hold DOWN PAYMENT DOLLARS fixed when projecting PP, so the
      // loan grows by every dollar of PP increase. This matches how
      // LOs run "how much house can the borrower afford" — the cash
      // available for down payment is fixed; what flexes is PP.
      //
      // newLoan(newPP)    = newPP - dpAmount
      // newPiPlusMi(newPP) = piMiPerLoanDollar * (newPP - dpAmount)
      //                    = piMiPerLoanDollar * newPP - piMiPerLoanDollar * dpAmount
      // newTax(newPP)     = (taxRate / 12) * newPP   (if taxRate > 0; else fixedTaxMonthly)
      // newHoi(newPP)     = (hoiRate / 12) * newPP   (if hoiRate > 0; else fixedHoiMonthly)
      // newPiti(newPP) = slope * newPP + intercept
      //   slope     = piMiPerLoanDollar + (taxRate + hoiRate) / 12
      //   intercept = -piMiPerLoanDollar * dpAmount + fixedTaxMonthly + fixedHoiMonthly + hoa + other
      const slope = piMiPerLoanDollar + (taxRate + hoiRate) / 12;
      const intercept = -piMiPerLoanDollar * dpAmount + fixedTaxMonthly + fixedHoiMonthly + hoa + other;
      if (slope <= 0) return;
      let maxPP = (maxPiti - intercept) / slope;
      if (!isFinite(maxPP) || maxPP <= 0) return;
      maxPP = Math.floor(maxPP / 1000) * 1000;

      // Tier-crossing flags. Linear extrapolation can't know that
      // crossing 80% LTV adds PMI (where it was previously absent),
      // or that crossing the conforming baseline reprices the loan
      // into high-balance / jumbo. Surface both so the LO knows
      // when to treat the estimate as an upper bound.
      const estLoan = maxPP - dpAmount;
      const estLtv = (estLoan / maxPP) * 100;
      const crossesConforming =
        type === 'CONV' &&
        currentLoan <= CONFORMING_LIMIT_2025 &&
        estLoan > CONFORMING_LIMIT_2025;
      const crossesPmi =
        type === 'CONV' &&
        currentLtv <= 80 &&
        estLtv > 80;

      out.push({
        type: type,
        cap: cap,
        maxPP: maxPP,
        basedOn: row.product,
        basedOnPiti: row.piti,
        estLoan: estLoan,
        estLtv: estLtv,
        crossesConforming: crossesConforming,
        crossesPmi: crossesPmi,
        breakdown: {
          piPlusMi: piPlusMi,
          monthlyTax: currentMonthlyTax,
          monthlyHoi: currentMonthlyHoi,
          hoa: hoa,
          other: other,
          taxScales: taxRate > 0,
          hoiScales: hoiRate > 0,
          dpAmount: dpAmount,
          currentLtv: currentLtv
        }
      });
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
    const flagged = estimate.crossesConforming || estimate.crossesPmi;
    wrap.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'gap:8px',
      'padding:6px 14px',
      'margin-left:12px',
      'border-radius:999px',
      'background:' + (flagged ? '#fef3c7' : '#eef6ff'),
      'border:1px solid ' + (flagged ? '#fcd34d' : '#bfdbfe'),
      'color:' + (flagged ? '#92400e' : '#1d4ed8'),
      'font-size:15px',
      'font-weight:700',
      'line-height:1.5',
      'white-space:nowrap'
    ].join(';');

    // Tooltip: breakdown of how PITI was decomposed at the current
    // PP, plus the standard "this is an estimate" warning. The
    // breakdown helps an LO sanity-check the number without having
    // to type the PP into the form and re-run pricing.
    const b = estimate.breakdown || {};
    const lines = [
      'ESTIMATED max purchase price for ' + estimate.type +
        ' at ' + estimate.cap + '% back-end DTI.',
      'Based on ' + (estimate.basedOn || '(unknown product)') +
        ' (current PITI $' + (estimate.basedOnPiti || 0).toLocaleString() + ').',
      '',
      'Assumes down payment stays at $' + Math.round(b.dpAmount || 0).toLocaleString() +
        ' (current LTV ' + (b.currentLtv || 0).toFixed(1) + '%).',
      '',
      'Breakdown of current PITI:',
      '  P&I + MI:  $' + Math.round(b.piPlusMi || 0).toLocaleString() + '/mo' +
        ' (scales with loan amount)',
      '  Taxes:     $' + Math.round(b.monthlyTax || 0).toLocaleString() + '/mo' +
        ' (' + (b.taxScales ? 'scales with PP' : 'fixed $') + ')',
      '  Insurance: $' + Math.round(b.monthlyHoi || 0).toLocaleString() + '/mo' +
        ' (' + (b.hoiScales ? 'scales with PP' : 'fixed $') + ')'
    ];
    if (b.hoa) lines.push('  HOA:       $' + Math.round(b.hoa).toLocaleString() + '/mo (fixed)');
    if (b.other) lines.push('  Other:     $' + Math.round(b.other).toLocaleString() + '/mo (fixed)');
    lines.push('');
    lines.push('Estimated loan at this PP: $' + Math.round(estimate.estLoan || 0).toLocaleString() +
      ' (LTV ' + (estimate.estLtv || 0).toFixed(1) + '%)');
    if (estimate.crossesPmi) {
      lines.push('');
      lines.push('⚠ Estimated LTV crosses 80%. PMI will kick in at the new PP and');
      lines.push('  the rate sheet may reprice. Real PITI will be higher and the');
      lines.push('  actual max purchase price LOWER than shown. Treat as upper bound.');
    }
    if (estimate.crossesConforming) {
      lines.push('');
      lines.push('⚠ Estimated loan crosses the 2025 conforming baseline ($806,500).');
      lines.push('  Rates and MI factor typically reprice into high-balance / jumbo,');
      lines.push('  so the real PITI at this PP will likely be higher and the actual');
      lines.push('  max purchase price LOWER than shown. Treat this as an upper bound.');
    }
    lines.push('');
    lines.push('⚠ Estimate only. Confirm AUS approval (DU / LPA) at the new PP before quoting.');
    lines.push('');
    lines.push(ZHL_TIP);
    wrap.title = lines.join('\n');

    const label = document.createElement('span');
    label.textContent = 'Est. max ' + estimate.type + ':';
    label.style.cssText = 'color:' + (flagged ? '#78350f' : '#1e3a8a') + ';font-weight:600;';
    const val = document.createElement('span');
    val.textContent = formatPP(estimate.maxPP) + ' @ ' + estimate.cap + '%';
    const warn = document.createElement('span');
    warn.textContent = '⚠';
    warn.style.cssText = 'color:#b45309;font-weight:700;margin-left:2px;';
    warn.title = estimate.crossesPmi
      ? 'Estimated LTV crosses 80% — PMI will kick in and real PITI will be higher. Confirm AUS approval at the new price.'
      : (estimate.crossesConforming
        ? 'Estimated loan crosses conforming limit — real PITI will likely be higher. Confirm AUS approval at the new price.'
        : 'Estimate only — confirm AUS approval (DU / LPA) at the new purchase price.');
    wrap.appendChild(label);
    wrap.appendChild(val);
    wrap.appendChild(warn);
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

  // Latch on the pricing-results signature. The pill should only
  // re-derive its number when the LO clicks "Run pricing" and the
  // result rows actually change — not when they're mid-edit on the
  // scenario form (PP, DP, taxes). If we recompute on every form
  // edit, an LO who types a new PP to test the estimate watches the
  // pill shift in real time and the number stops being a stable
  // reference. Holding the value until the next pricing run avoids
  // that. Re-renders are still allowed (DOM may have been wiped by
  // a LOP re-render), but the *value* stays put.
  let lastPricingSignature = null;
  let lastEstimates = [];
  let creditedDtiTimeSaved = false; // one credit per content-script load

  function pricingSignature(rows, income, liab) {
    // Include income / liabilities so we re-derive if the loan-level
    // numbers change (e.g. user updates declared income or pays off
    // a debt and reloads). The form-level PP / DP / taxes are
    // intentionally excluded — those should only matter when the
    // user re-runs pricing.
    const rowKey = rows.map(function (r) {
      return r.product + ':' + r.piti + ':' + r.dtiBack;
    }).join('|');
    return rowKey + '#i=' + income + '#l=' + liab;
  }

  function scan() {
    // Only meaningful on the pricing/scenarios sub-page.
    if (!/\/loan-officer-portal\//.test(location.pathname)) return;
    const elig = readEligibilityRow();
    if (!elig) return;
    const rows = readPricingRows();
    if (!rows.length) {
      // Pricing not run yet — clear any stale pills.
      document.querySelectorAll('[' + PILL_ATTR + ']').forEach(function (el) { el.remove(); });
      lastPricingSignature = null;
      lastEstimates = [];
      return;
    }
    const sig = pricingSignature(rows, elig.income, elig.liabilities);
    if (sig !== lastPricingSignature) {
      // Pricing-results rows OR income/liabilities just changed —
      // the LO ran pricing (or reloaded). Recompute and latch.
      const pp = readCurrentPurchasePrice();
      lastEstimates = computeMaxes(rows, elig.income, elig.liabilities, pp);
      // Time saved: ~5 min vs manually backing out max purchase prices
      // from PITI / DTI tables. Once per content-script load so reloads
      // don't double-count.
      if (lastEstimates.length && !creditedDtiTimeSaved && window.__zhlTimeSaved) {
        window.__zhlTimeSaved.recordAndForget('dti-max-estimator', 5);
        creditedDtiTimeSaved = true;
      }
      lastPricingSignature = sig;
    }
    // Re-render (the pill DOM may have been stripped by a LOP
    // re-render even when the value hasn't changed).
    renderPills(lastEstimates, elig.row);
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
    chrome.storage.local.get([__ZHL_FEATURE_KEY, 'zhl_kill_switch'], function (data) {
      if (data.zhl_kill_switch === true) return;
      if (data[__ZHL_FEATURE_KEY] === false) return;
      __zhlRunModule();
    });
  } else {
    __zhlRunModule();
  }
})();
