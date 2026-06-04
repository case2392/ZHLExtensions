// ZHL Productivity Pack module — feature key: feature_fhaManualEligible
//
// Reads the Credit section on LOP's full-application page, computes the
// "qualifying" middle credit score (middle of the three bureau scores
// per borrower; the LOWER middle when there are multiple borrowers),
// and pins a pill under the "Credit" heading saying either
//   ✓ FHA Manual Eligible  (green)  when the qualifying score is ≥ 640
//   ✗ FHA Manual Ineligible (red)   when the qualifying score is < 640
//
// 640 is ZHL's manual-UW floor. Below 640 the file can't be manually
// downgraded to a Refer regardless of FHA's published 580 minimum.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_fhaManualEligible';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[FHA Manual Eligible v' + VERSION + '] loaded');

  const BADGE_ID = 'zhl-fha-manual-elig-badge';
  const ANALYZE_BTN_ID = 'zhl-fha-manual-analyze-btn';
  const ANALYZER_PANEL_ID = 'zhl-fha-manual-analyzer-panel';
  const ZHL_TIP = 'Built by Justin Case. Karma appreciated 💛';
  const MIN_SCORE = 640;
  const MAX_DTI = 50;
  // VA manual-underwrite floor (ZHL): min score 660, max DTI 43%.
  const VA_MIN_SCORE = 660;
  const VA_MAX_DTI = 43;
  // Reference links surfaced on the VA manual-confirmation rows.
  const ZHL_VA_MATRIX_URL = 'https://zhl.highspot.com/items/61117b5a34d6be5da10154b0#1';
  // Direct VA Lender's Handbook Chapter 4 (Credit Underwriting).
  const VA_HANDBOOK_CH4_URL = 'https://www.knowva.ebenefits.va.gov/system/templates/selfservice/va_ssnew/help/customer/locale/en-US/portal/554400000001018/content/554400000314662/VA-Pamphlet-VAP26-7-Chapter-04-Credit-Underwriting';

  // The full Manual Underwriting guideline block surfaced in the badge
  // tooltip so the user can confirm fit without leaving the page.
  // Sourced from ZHL's published FHA Manual UW matrix.
  const GUIDELINES = [
    'MANUAL UNDERWRITES',
    '',
    '• All aggregators, except PHH and Mr. Cooper, require a minimum Credit Score of 640. PHH Requires >= 680 Credit Score. Mr. Cooper does not permit manual underwrites.',
    '• Manual Underwrites, max 50%. (Eligible Investors: Amerihome, PennyMac, PHH)',
    '',
    'Reserves: 1-2 Units = 1 month\'s PITIA; 3-4 Units = 3 months.',
    '',
    'Maximum Debt to Income Ratio Requirements with Manual Underwrite:',
    '',
    '  • 31/43 : No Compensating Factors. (33/45 for Energy Efficient Homes as defined by the 4000.1)',
    '',
    '  • 37/47: ONE (1) compensating factor:',
    '     ○ Verified and documented cash reserves - 3 months 1-2 units; 6 months 3-4 units',
    '     ○ Minimal increase in housing payment - the lower of $100 or 5%.',
    '     ○ Residual Income - follow VA calculations',
    '',
    '  • 40/40: No Discretionary Debt. (All accounts paid in full or paid in full monthly for 6 months or more)',
    '',
    '  • 40/50: TWO (2) compensating factors:',
    '     ○ Verified and documented cash reserves - 3 months 1-2 units; 6 months 3-4 units',
    '     ○ Minimal increase in housing payment - the lower of $100 or 5%.',
    '     ○ Significant additional income not reflected in effective income; or',
    '     ○ Residual Income - follow VA calculations',
    '',
    '• Manual underwritten files have maximum front and back end ratios. See 4000.1 II.A.5.viii for current guidelines and compensating factors.',
    '   HUD Handbook 4000.1',
    '• Residual Income is calculated using VA tables found in VA Handbook, Chapter 4, section 9',
    '   VA Handbook, Chapter 4',
    '',
    'NOTE: Compensating factors may only be used to exceed front end ratio limits. Manual UW\'s still have a max back end ratio.'
  ].join('\n');

  // VA manual-UW guideline block (Non-IRRRL). Intentionally omits
  // investor-specific credit-score overlays per ZHL — 660 is the floor.
  const VA_GUIDELINES = [
    'VA MANUAL UNDERWRITE (Non-IRRRL)',
    '',
    '• Minimum credit score for manual underwrite: 660.',
    '• Maximum DTI ratio: 43%.',
    '• Residual income must meet the VA table (VA Handbook Ch. 4, §9).',
    '   If DTI > 41%, residual income must be at least 120% of the table requirement.',
    '• Must meet all requirements of VA Handbook Chapter 4 and be eligible for guaranty by VA.',
    '• Submit through LPA or DU; a copy of the findings (incl. "Refer" / "Manual Downgrade") must be in the file.',
    '',
    '   VA Handbook, Chapter 4'
  ].join('\n');

  // Which manual-UW program applies, based on the right-rail Product
  // name. VA loans get the VA pill + VA analyzer; everything else
  // (FHA, and Conv by default) uses the FHA path as before.
  function getProductType() {
    const txt = findRightRailValueText('Product name') || '';
    if (/\bVA\b/i.test(txt)) return 'va';
    if (/\bFHA\b/i.test(txt)) return 'fha';
    return 'other';
  }
  function currentProgram() {
    if (getProductType() === 'va') {
      return { key: 'va', label: 'VA', minScore: VA_MIN_SCORE, maxDti: VA_MAX_DTI, guidelines: VA_GUIDELINES };
    }
    return { key: 'fha', label: 'FHA', minScore: MIN_SCORE, maxDti: MAX_DTI, guidelines: GUIDELINES };
  }

  function isFullApplicationPage() {
    return location.pathname.indexOf('/loan-officer-portal/') !== -1
      && /\/full-application(\/|$|\?)/.test(location.pathname + location.search);
  }

  // Find the Credit section container by walking up from the <h6>Credit
  // heading on the right rail. The container also holds the per-borrower
  // [data-cy="<Name>"] blocks and the Choose action dropdown.
  function findCreditSection() {
    const headings = document.querySelectorAll('h6');
    for (const h of headings) {
      if ((h.textContent || '').trim() === 'Credit') {
        return h.parentElement;
      }
    }
    return null;
  }

  // From a borrower's Hard row, extract the three bureau scores (any
  // numeric span; "-" / em-dash entries are dropped). Returns a list
  // of integers 300–850 ordered by DOM, length 0..3.
  function readBureauScores(borrowerEl) {
    // Prefer Hard (the canonical pulled scores). Fall back to Soft if
    // Hard is absent (some pre-application files only have soft pulls).
    const hard = borrowerEl.querySelector('[data-cy="Hard"]');
    const soft = borrowerEl.querySelector('[data-cy="Soft"]');
    const grid = hard || soft;
    if (!grid) return [];
    const scores = [];
    grid.querySelectorAll('span').forEach(function (s) {
      const txt = (s.textContent || '').trim();
      if (!/^\d{3}$/.test(txt)) return;
      const n = parseInt(txt, 10);
      if (n >= 300 && n <= 850) scores.push(n);
    });
    return scores;
  }

  // Standard mortgage middle-score rule:
  //   3 scores → median
  //   2 scores → lower of the two
  //   1 score  → that score
  //   0 scores → null
  function middleScoreOf(scores) {
    if (!scores || !scores.length) return null;
    const sorted = scores.slice().sort(function (a, b) { return a - b; });
    if (sorted.length >= 3) return sorted[1];
    if (sorted.length === 2) return sorted[0];
    return sorted[0];
  }

  // For multiple borrowers FHA uses the LOWEST middle score across
  // borrowers as the qualifying score. Returns { score, borrower } or
  // null if no borrower had a usable score.
  function computeQualifyingScore(creditSection) {
    const borrowerEls = creditSection.querySelectorAll('[data-cy]');
    let best = null; // best = lowest-middle wins (FHA rule)
    borrowerEls.forEach(function (el) {
      const name = el.getAttribute('data-cy') || '';
      // Skip the inner Soft/Hard grids — only consume the outer
      // per-borrower blocks. The borrower block holds the Soft/Hard
      // grids as descendants.
      if (name === 'Soft' || name === 'Hard') return;
      if (!el.querySelector('[data-cy="Soft"]') && !el.querySelector('[data-cy="Hard"]')) return;
      const mid = middleScoreOf(readBureauScores(el));
      if (mid == null) return;
      if (!best || mid < best.score) {
        best = { score: mid, borrower: name };
      }
    });
    return best;
  }

  function ensureBadge(creditSection, result) {
    let badge = document.getElementById(BADGE_ID);
    if (!badge) {
      // Wrapper holds the pill + Analyze button on a single row.
      const wrap = document.createElement('div');
      wrap.id = BADGE_ID + '-wrap';
      wrap.style.cssText =
        'display:flex;align-items:center;gap:8px;flex-wrap:wrap;' +
        'margin:8px 0 12px;';

      badge = document.createElement('div');
      badge.id = BADGE_ID;
      badge.style.cssText =
        'display:flex;align-items:center;gap:6px;' +
        'padding:6px 10px;' +
        'border-radius:6px;border:1px solid transparent;' +
        'font:600 12px/1.2 Arial,Helvetica,sans-serif;' +
        'box-sizing:border-box;';
      wrap.appendChild(badge);

      const analyzeBtn = document.createElement('button');
      analyzeBtn.id = ANALYZE_BTN_ID;
      analyzeBtn.type = 'button';
      analyzeBtn.textContent = 'Analyze Manual UW';
      analyzeBtn.title = 'Walk through every Manual Underwrite check on this file and show ✓ / ✗ for each.\n\n' + ZHL_TIP;
      analyzeBtn.style.cssText =
        'padding:6px 10px;background:#0b5cab;color:#fff;' +
        'border:1px solid #0b5cab;border-radius:6px;' +
        'font:600 12px/1.2 Arial,Helvetica,sans-serif;cursor:pointer;';
      analyzeBtn.addEventListener('mouseenter', function () { analyzeBtn.style.background = '#084a8c'; });
      analyzeBtn.addEventListener('mouseleave', function () { analyzeBtn.style.background = '#0b5cab'; });
      analyzeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openAnalyzerPanel();
      });
      wrap.appendChild(analyzeBtn);

      // Insert immediately after the "Credit" h6 so it sits between
      // the heading and the per-borrower rows.
      const h6 = Array.from(creditSection.querySelectorAll('h6')).find(function (h) {
        return (h.textContent || '').trim() === 'Credit';
      });
      if (h6 && h6.parentElement === creditSection) {
        h6.insertAdjacentElement('afterend', wrap);
      } else {
        creditSection.insertBefore(wrap, creditSection.firstChild);
      }
    }
    paintBadge(badge, result);
  }

  function paintBadge(badge, result) {
    const prog = currentProgram();
    if (!result) {
      badge.style.background = '#f3f4f6';
      badge.style.borderColor = '#d1d5db';
      badge.style.color = '#374151';
      badge.textContent = 'No credit pulled yet — ' + prog.label + ' eligibility unknown';
      badge.title = prog.guidelines + '\n\n' + ZHL_TIP;
      return;
    }
    const eligible = result.score >= prog.minScore;
    badge.innerHTML = '';
    const icon = document.createElement('span');
    icon.textContent = eligible ? '✓' : '✗';
    icon.style.cssText =
      'display:inline-flex;align-items:center;justify-content:center;' +
      'width:16px;height:16px;border-radius:50%;' +
      'font-size:11px;font-weight:700;' +
      'background:' + (eligible ? '#16a34a' : '#dc2626') + ';color:#fff;flex:0 0 auto;';
    const label = document.createElement('span');
    label.textContent = eligible ? (prog.label + ' Manual Eligible') : (prog.label + ' Manual Ineligible');
    const score = document.createElement('span');
    score.textContent = '— mid ' + result.score;
    score.style.cssText = 'font-weight:500;opacity:0.85;';
    badge.appendChild(icon);
    badge.appendChild(label);
    badge.appendChild(score);
    if (eligible) {
      badge.style.background = '#dcfce7';
      badge.style.borderColor = '#16a34a';
      badge.style.color = '#14532d';
    } else {
      badge.style.background = '#fee2e2';
      badge.style.borderColor = '#dc2626';
      badge.style.color = '#7f1d1d';
    }
    const summary = eligible
      ? 'Qualifying middle score ' + result.score + ' meets ZHL\'s ' + prog.label + ' Manual UW floor of ' + prog.minScore + '.'
      : 'Qualifying middle score ' + result.score + ' is below ZHL\'s ' + prog.label + ' Manual UW floor of ' + prog.minScore + '.';
    // FHA-only investor overlay note (PHH 680 / Mr. Cooper). VA has no
    // such investor credit-score language per ZHL.
    const overlayNote = (prog.key === 'fha' && eligible && result.score < 680)
      ? '\n\nHeads up: PHH requires ≥ 680, so this file is eligible at Amerihome / PennyMac but NOT at PHH. Mr. Cooper does not allow manual UW at any score.'
      : '';
    badge.title =
      summary +
      '\nQualifying borrower: ' + result.borrower +
      '\n(Middle of the three bureau scores per borrower; LOWER middle when there are multiple borrowers.)' +
      overlayNote +
      '\n\n' + prog.guidelines +
      '\n\n' + ZHL_TIP;
  }

  function removeBadge() {
    const wrap = document.getElementById(BADGE_ID + '-wrap');
    if (wrap) wrap.remove();
    const b = document.getElementById(BADGE_ID);
    if (b) b.remove();
    const panel = document.getElementById(ANALYZER_PANEL_ID);
    if (panel) panel.remove();
  }

  // ============================================================
  //  Manual UW Analyzer panel
  // ============================================================

  // Persisted user-checks across panel re-opens for the same loan
  // session. Keyed off the URL path (loan id) so switching to a
  // different loan resets.
  const manualChecksByLoan = {};

  function loanKey() {
    const m = /\/loan-officer-portal\/([^/]+)\//.exec(location.pathname);
    return m ? m[1] : location.pathname;
  }

  // ---- Right-rail / page data scraping helpers ---------------------------

  function normText(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function parseMoney(s) {
    if (s == null) return null;
    const cleaned = String(s).replace(/[^0-9.\-]/g, '');
    if (!cleaned || cleaned === '.' || cleaned === '-') return null;
    const n = parseFloat(cleaned);
    return isFinite(n) ? n : null;
  }
  function parsePercents(s) {
    if (!s) return [];
    const matches = String(s).match(/(\d+(?:\.\d+)?)\s*%/g) || [];
    return matches.map(function (m) { return parseFloat(m); });
  }

  // Find the value for a labeled row on the right-rail Eligibility /
  // Loan Details summary. Looks for an element whose text equals the
  // label, then captures the next sibling / parent-remainder text.
  function findRightRailValueText(label) {
    const want = normText(label);
    const all = document.querySelectorAll('div, span, td, dt, dd, li, label, p');
    for (const el of all) {
      if (normText(el.textContent) !== want) continue;
      // Walk siblings until we find non-empty text content.
      let sib = el.nextElementSibling;
      while (sib && !sib.textContent.trim()) sib = sib.nextElementSibling;
      if (sib && sib.textContent.trim()) return sib.textContent;
      // Fallback: parent's text minus the label's text.
      if (el.parentElement) {
        const parentTxt = el.parentElement.textContent || '';
        const leftover = parentTxt.replace(el.textContent || '', '').trim();
        if (leftover) return leftover;
      }
    }
    return null;
  }

  function findRightRailNumber(label) {
    const txt = findRightRailValueText(label);
    return parseMoney(txt);
  }

  function getDTI() {
    // The right rail's DTI row shows "27.58% / 29.63%" — front-end /
    // back-end. Capture both numbers; lower one is front, higher is back.
    const txt = findRightRailValueText('DTI');
    if (!txt) return { front: null, back: null };
    const pcts = parsePercents(txt);
    if (!pcts.length) return { front: null, back: null };
    if (pcts.length === 1) return { front: pcts[0], back: pcts[0] };
    const front = Math.min(pcts[0], pcts[1]);
    const back = Math.max(pcts[0], pcts[1]);
    return { front: front, back: back };
  }

  function getCurrentRent() {
    // Walk the addresses table for the primary borrower's "Current"
    // row and return its Rent/mo cell. addresses-section-0 = primary.
    const section = document.querySelector('[data-cy="address-section-0"]');
    if (!section) return null;
    const rows = section.querySelectorAll('tbody tr');
    for (const tr of rows) {
      const cells = tr.querySelectorAll('td');
      if (cells.length < 7) continue;
      const type = (cells[1].textContent || '').toLowerCase();
      if (type.indexOf('current') === -1) continue;
      const housing = (cells[3].textContent || '').toLowerCase();
      if (housing.indexOf('own') !== -1) {
        // Owned — there's no rent. Caller can decide what to do with that.
        return { type: 'own', amount: 0 };
      }
      const rent = parseMoney(cells[6].textContent);
      if (rent != null && rent > 0) return { type: 'rent', amount: rent };
    }
    return null;
  }

  function getNumberOfUnits() {
    // Subject Property → Number of units. The label varies a bit; try
    // a few candidates. Default to "1-2" when unknown (vast majority).
    const candidates = ['Number of units', 'Units', '# of units', 'Number of Units'];
    for (const c of candidates) {
      const v = findRightRailNumber(c) || parseFloat(findRightRailValueText(c) || '');
      if (v && isFinite(v)) {
        const n = Math.round(v);
        if (n >= 1 && n <= 4) return n;
      }
    }
    return null; // unknown
  }

  // ---- Tier evaluation ---------------------------------------------------

  function evaluateRatioTiers(dti) {
    // Returns ratio-tier eligibility purely from front/back DTI. Each
    // tier also requires zero-or-more compensating factors which we
    // evaluate separately and combine in renderRecommendation.
    if (dti.front == null || dti.back == null) {
      return { tier31: null, tier37: null, tier40_40: null, tier40_50: null };
    }
    return {
      tier31: dti.front <= 31 && dti.back <= 43,
      tier37: dti.front <= 37 && dti.back <= 47,
      tier40_40: dti.back <= 40, // requires no discretionary debt (manual check)
      tier40_50: dti.front <= 40 && dti.back <= 50
    };
  }

  // ---- Panel rendering ---------------------------------------------------

  function openAnalyzerPanel() {
    // Close any existing instance first so re-clicking the button
    // refreshes the data.
    const existing = document.getElementById(ANALYZER_PANEL_ID);
    if (existing) existing.remove();

    // Gather everything from the page in one read pass.
    const creditSec = findCreditSection();
    const scoreResult = creditSec ? computeQualifyingScore(creditSec) : null;
    const dti = getDTI();
    const piti = findRightRailNumber('Monthly PITI') || findRightRailNumber('PITI');
    const monthlyIncome = findRightRailNumber('Monthly income');
    const totalAssets = findRightRailNumber('Total assets') || findRightRailNumber('Total Assets');
    // "Cash (to) / from" is the borrower's net cash position at
    // closing — positive when they're BRINGING money to closing
    // (purchase: down payment + closing costs − credits), negative
    // when they're getting cash back (cash-out refi). Subtracting
    // it from Total assets yields the reserves actually available
    // AFTER closing, which is what FHA's 3-mo / 6-mo reserve rule
    // measures.
    const cashToClose = findRightRailNumber('Cash (to) / from') ||
                        findRightRailNumber('Cash to close') ||
                        findRightRailNumber('Cash to / from');
    const monthlyLiabilities = findRightRailNumber('Monthly liabilities') || findRightRailNumber('Monthly debts');
    const rent = getCurrentRent();
    const units = getNumberOfUnits();

    const data = {
      score: scoreResult ? scoreResult.score : null,
      qualifyingBorrower: scoreResult ? scoreResult.borrower : null,
      dti: dti,
      piti: piti,
      monthlyIncome: monthlyIncome,
      totalAssets: totalAssets,
      cashToClose: cashToClose,
      monthlyLiabilities: monthlyLiabilities,
      rent: rent,
      units: units
    };

    const persisted = manualChecksByLoan[loanKey()] || {};
    const state = {
      data: data,
      manualChecks: {
        addlIncome: !!persisted.addlIncome,
        residualIncomeVA: !!persisted.residualIncomeVA,
        noDiscretionaryDebt: !!persisted.noDiscretionaryDebt,
        energyEfficient: !!persisted.energyEfficient,
        // VA-path manual confirmations (Chapter 4 breakdown + guaranty)
        vaAus: !!persisted.vaAus,
        vaCredit: !!persisted.vaCredit,
        vaMtgHistory: !!persisted.vaMtgHistory,
        vaSeasoning: !!persisted.vaSeasoning,
        vaIncome: !!persisted.vaIncome,
        vaGuaranty: !!persisted.vaGuaranty
      }
    };

    const panel = renderPanel(state);
    // Time saved: ~10 min vs manually walking the manual-UW matrix +
    // residual tables + Chapter 4 / Handbook 4000.1 conditions by hand.
    if (window.__zhlTimeSaved) {
      const slot = document.createElement('div');
      slot.style.cssText = 'padding:0 16px 14px;';
      panel.appendChild(slot);
      const mins = 10;
      const tool = currentProgram().key === 'va' ? 'va-manual-eligible' : 'fha-manual-eligible';
      window.__zhlTimeSaved.record(tool, mins).then(function (r) {
        slot.innerHTML = window.__zhlTimeSaved.renderHtml(mins, r.userTotal, r.globalTotal);
      });
    }
    document.body.appendChild(panel);
  }

  function renderPanel(state) {
    const panel = document.createElement('div');
    panel.id = ANALYZER_PANEL_ID;
    panel.style.cssText = [
      'position: fixed', 'top: 50%', 'left: 50%',
      'transform: translate(-50%, -50%)',
      'width: 580px', 'max-width: 92vw',
      'max-height: 86vh', 'overflow-y: auto',
      'background: #fff', 'border: 1px solid #d1d5db',
      'border-radius: 12px',
      'box-shadow: 0 20px 60px rgba(0,0,0,.25)',
      'z-index: 2147483647',
      'font: 13px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif',
      'color: #111'
    ].join(';');

    // ---- Header ----
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:10px;padding:16px 20px 10px;border-bottom:1px solid #e5e7eb;';
    const title = document.createElement('h3');
    title.textContent = currentProgram().label + ' Manual Underwrite Analysis';
    title.style.cssText = 'margin:0;font-size:16px;color:#0b5cab;flex:1;';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.title = 'Close';
    closeBtn.style.cssText = 'background:transparent;border:none;font:400 22px/1 sans-serif;color:#6b7280;cursor:pointer;padding:0 6px;';
    closeBtn.addEventListener('click', function () { panel.remove(); });
    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = 'padding:14px 20px 18px;';
    panel.appendChild(body);

    function rerender() {
      body.innerHTML = '';
      buildBody(body, state, rerender);
    }
    rerender();

    return panel;
  }

  function buildBody(body, state, rerender) {
    // VA loans use a flat 660 / 43% / residual-income model — no FHA
    // ratio tiers or compensating factors. Branch early.
    if (currentProgram().key === 'va') { buildVaBody(body, state, rerender); return; }

    const d = state.data;
    const dti = d.dti;
    const dtiTiers = evaluateRatioTiers(dti);

    // ---- Up-front: compute every compensating factor so tier rows
    // and the recommendation use the same numbers, and so toggling a
    // manual check propagates to the tier indicators on re-render. ----
    const m = state.manualChecks;

    // Cash reserves (auto). Subtract the cash needed to close from
    // Total assets so we're measuring post-closing reserves. A
    // borrower with $30k in assets but $28k cash-to-close has only
    // ~$2k left for reserves — not the full $30k.
    const cashToClose = (d.cashToClose != null && isFinite(d.cashToClose)) ? d.cashToClose : 0;
    const reservesAvailable = (d.totalAssets != null)
      ? Math.max(0, d.totalAssets - cashToClose) : null;
    const reservesMonths = (reservesAvailable != null && d.piti && d.piti > 0)
      ? (reservesAvailable / d.piti) : null;
    const reservesNeeded = (d.units != null && d.units >= 3) ? 6 : 3;
    const reservesOk = reservesMonths != null && reservesMonths >= reservesNeeded;

    // Minimal increase in housing payment (auto).
    let payIncreaseOk = false;
    let payIncreaseDetail = 'Need current rent on the Addresses section + PITI to evaluate';
    let payIncreaseIndeterminate = true;
    if (d.rent && d.rent.type === 'rent' && d.rent.amount > 0 && d.piti != null) {
      const allowed = Math.min(100, d.rent.amount * 0.05);
      const delta = d.piti - d.rent.amount;
      payIncreaseOk = delta <= allowed;
      payIncreaseIndeterminate = false;
      payIncreaseDetail = 'Current rent $' + fmtMoney(d.rent.amount) + ' → PITI $' + fmtMoney(d.piti) +
        ' = ' + (delta >= 0 ? '+$' : '−$') + fmtMoney(Math.abs(delta)) +
        ' (rule allows ≤ $' + allowed.toFixed(2) + ')';
    } else if (d.rent && d.rent.type === 'own') {
      payIncreaseDetail = 'Currently owns — minimal-increase rule does not apply (compare against current mortgage manually)';
    }

    // Residual income (auto via the VA Calc module's exposed API).
    // The va-calc.js content script publishes window.ZHL_VA_CALC_API
    // which we call into here so users don't have to manually click
    // through the VA Residual Income Calc panel first.
    let residualResult = null;
    try {
      if (window.ZHL_VA_CALC_API && typeof window.ZHL_VA_CALC_API.computeResidualForPage === 'function') {
        residualResult = window.ZHL_VA_CALC_API.computeResidualForPage();
      }
    } catch (e) { console.warn('[FHA Analyzer] residual API call threw', e); }
    const residualAuto = residualResult && typeof residualResult.passes === 'boolean';
    const residualOk = residualAuto ? !!residualResult.passes : !!m.residualIncomeVA;

    // Manual factors that don't have an auto-detection path.
    const addlIncomeOk = !!m.addlIncome;
    const noDiscretionaryDebtOk = !!m.noDiscretionaryDebt;

    // Verified comp-factor count, used for the 37/47 (need 1) and
    // 40/50 (need 2) tier indicators and the final recommendation.
    const verifiedCFs = [];
    if (reservesOk) verifiedCFs.push('Cash reserves');
    if (payIncreaseOk) verifiedCFs.push('Minimal increase in housing payment');
    if (addlIncomeOk) verifiedCFs.push('Significant additional income');
    if (residualOk) verifiedCFs.push('Residual income (VA tables)');

    // Per-tier final eligibility — DTI gate AND any required
    // compensating-factor count or manual gate.
    const tiers = {
      tier31:     dtiTiers.tier31,
      tier37:     dtiTiers.tier37 === null ? null : (dtiTiers.tier37 && verifiedCFs.length >= 1),
      tier40_40:  dtiTiers.tier40_40 === null ? null : (dtiTiers.tier40_40 && noDiscretionaryDebtOk),
      tier40_50:  dtiTiers.tier40_50 === null ? null : (dtiTiers.tier40_50 && verifiedCFs.length >= 2)
    };

    // ---- Top summary line ----
    const summary = document.createElement('div');
    summary.style.cssText = 'margin-bottom:14px;color:#374151;font-size:12.5px;';
    const parts = [];
    if (d.score) parts.push('Mid score <strong>' + d.score + '</strong>' + (d.qualifyingBorrower ? ' (' + d.qualifyingBorrower + ')' : ''));
    if (dti.front != null && dti.back != null) parts.push('DTI <strong>' + dti.front.toFixed(2) + '% / ' + dti.back.toFixed(2) + '%</strong>');
    if (d.piti != null) parts.push('PITI <strong>$' + fmtMoney(d.piti) + '</strong>');
    if (d.totalAssets != null) parts.push('Assets <strong>$' + fmtMoney(d.totalAssets) + '</strong>');
    summary.innerHTML = parts.join(' &middot; ') || 'No data found on this page.';
    body.appendChild(summary);

    // ---- Eligibility section ----
    addH(body, 'Eligibility');
    addCheck(body, {
      ok: d.score != null && d.score >= MIN_SCORE,
      label: 'Minimum credit score ≥ ' + MIN_SCORE,
      detail: d.score != null
        ? ('Qualifying mid: ' + d.score + (d.score >= MIN_SCORE ? ' (passes)' : ' (below floor)'))
        : 'No credit pulled yet'
    });
    addCheck(body, {
      ok: dti.back != null && dti.back <= MAX_DTI,
      label: 'Maximum DTI ≤ ' + MAX_DTI + '%',
      detail: dti.back != null
        ? ('Back-end DTI: ' + dti.back.toFixed(2) + '%' + (dti.back <= MAX_DTI ? ' (passes)' : ' (over the cap)'))
        : 'DTI not available — re-price the scenario'
    });

    // ---- Ratio tier evaluation ----
    addH(body, 'Ratio tier eligibility');
    addCheck(body, {
      ok: tiers.tier31 === true,
      indeterminate: tiers.tier31 === null,
      label: '31 / 43 — No compensating factors required',
      detail: dti.front != null
        ? ('Your DTI: ' + dti.front.toFixed(2) + '% / ' + dti.back.toFixed(2) + '%' +
           (tiers.tier31 ? ' — fits' : ' — exceeds 31/43'))
        : 'DTI not available'
    });
    // 37/47: passes only if DTI fits AND ≥1 verified comp factor.
    addCheck(body, {
      ok: tiers.tier37 === true,
      indeterminate: tiers.tier37 === null || (dtiTiers.tier37 === true && verifiedCFs.length < 1),
      label: '37 / 47 — Requires ONE compensating factor',
      detail: dtiTiers.tier37 === null
        ? 'DTI not available'
        : (dtiTiers.tier37
           ? ('Your DTI: ' + dti.front.toFixed(2) + '% / ' + dti.back.toFixed(2) + '% — fits. Comp factors verified: ' + verifiedCFs.length + ' / 1')
           : ('Your DTI: ' + dti.front.toFixed(2) + '% / ' + dti.back.toFixed(2) + '% — exceeds 37/47'))
    });
    // 40/40: passes only if DTI fits AND user confirmed no discretionary debt.
    addCheck(body, {
      ok: tiers.tier40_40 === true,
      indeterminate: tiers.tier40_40 === null || (dtiTiers.tier40_40 === true && !noDiscretionaryDebtOk),
      label: '40 / 40 — Requires NO discretionary debt',
      detail: dtiTiers.tier40_40 === null
        ? 'DTI not available'
        : (dtiTiers.tier40_40
           ? ('Back-end ≤ 40%: yes. No-discretionary-debt confirmation: ' + (noDiscretionaryDebtOk ? 'confirmed' : 'unchecked (toggle the box below)'))
           : ('Back-end ' + dti.back.toFixed(2) + '% — exceeds 40%'))
    });
    // 40/50: passes only if DTI fits AND ≥2 verified comp factors.
    addCheck(body, {
      ok: tiers.tier40_50 === true,
      indeterminate: tiers.tier40_50 === null || (dtiTiers.tier40_50 === true && verifiedCFs.length < 2),
      label: '40 / 50 — Requires TWO compensating factors',
      detail: dtiTiers.tier40_50 === null
        ? 'DTI not available'
        : (dtiTiers.tier40_50
           ? ('Your DTI: ' + dti.front.toFixed(2) + '% / ' + dti.back.toFixed(2) + '% — fits. Comp factors verified: ' + verifiedCFs.length + ' / 2')
           : ('Your DTI: ' + dti.front.toFixed(2) + '% / ' + dti.back.toFixed(2) + '% — exceeds 40/50'))
    });

    // ---- Compensating factors ----
    addH(body, 'Compensating factors');

    addCheck(body, {
      ok: reservesOk,
      indeterminate: reservesMonths == null,
      label: 'Cash reserves — ' + reservesNeeded + '+ months PITIA' + (d.units != null ? ' (' + d.units + '-unit)' : ' (1–2 units assumed)'),
      detail: reservesMonths != null
        ? ('Assets $' + fmtMoney(d.totalAssets) +
           (cashToClose ? ' − cash to close $' + fmtMoney(cashToClose) + ' = $' + fmtMoney(reservesAvailable) : '') +
           ' ÷ PITI $' + fmtMoney(d.piti) + ' = ' + reservesMonths.toFixed(1) + ' months')
        : 'Need both Total assets and Monthly PITI on this page to evaluate'
    });

    addCheck(body, {
      ok: payIncreaseOk,
      indeterminate: payIncreaseIndeterminate && !payIncreaseOk,
      label: 'Minimal increase in housing payment (≤ lower of $100 or 5%)',
      detail: payIncreaseDetail
    });

    // Residual income — auto if VA Calc API is available, manual fallback otherwise.
    if (residualAuto) {
      addCheck(body, {
        ok: residualResult.passes,
        label: 'Residual income — VA tables' + (residualResult.dtiOver41 ? ' (DTI > 41% → 120% bump)' : ''),
        detail: 'Computed residual: $' + fmtMoney(residualResult.residualIncome) +
          ' vs requirement $' + fmtMoney(residualResult.requirementEffective) +
          ' (' + (residualResult.region || 'unknown region') + ', family of ' + (residualResult.familySize || '?') + ')'
      });
    } else {
      addManualCheck(body, state, 'residualIncomeVA',
        'Residual income — follow VA calculations',
        'VA Calc auto-evaluation unavailable — run the VA Residual Income Calc on the Liabilities section and tick this box if it passes.',
        rerender);
    }

    // Pure-manual factors (no automation possible).
    addManualCheck(body, state, 'addlIncome',
      'Significant additional income not reflected in effective income',
      'Auto-detection not possible — verify from "Other income" or VOE notes.', rerender);
    addManualCheck(body, state, 'noDiscretionaryDebt',
      'No discretionary debt (required for 40/40 tier)',
      'All accounts are paid in full OR have been paid in full monthly for 6+ months.', rerender);
    addManualCheck(body, state, 'energyEfficient',
      'Energy Efficient Home (bumps 31/43 → 33/45)',
      'Property meets HUD\'s EEH standards per 4000.1.', rerender);

    // ---- Recommendation ----
    renderRecommendation(body, state, tiers, verifiedCFs, noDiscretionaryDebtOk);

    // ---- Footer ----
    const foot = document.createElement('div');
    foot.style.cssText = 'margin-top:18px;padding-top:12px;border-top:1px dashed #e5e7eb;font-size:11.5px;color:#6b7280;text-align:center;';
    foot.innerHTML = 'Reference: HUD Handbook 4000.1 II.A.5.viii &nbsp;·&nbsp; ' +
      '<a href="https://zallwall.zillowgroup.com/justinca" target="_blank" rel="noopener" style="color:#0b5cab;font-weight:600;text-decoration:underline;" data-zhl-karma-link="fha-manual-analyzer">💛 Drop me karma</a>';
    body.appendChild(foot);
  }

  // ---- VA manual-UW body -------------------------------------------------
  function buildVaBody(body, state, rerender) {
    const d = state.data;
    const dti = d.dti;

    // Residual income (auto via the VA Calc module's exposed API).
    let residualResult = null;
    try {
      if (window.ZHL_VA_CALC_API && typeof window.ZHL_VA_CALC_API.computeResidualForPage === 'function') {
        residualResult = window.ZHL_VA_CALC_API.computeResidualForPage();
      }
    } catch (e) { console.warn('[VA Analyzer] residual API call threw', e); }
    const residualAuto = residualResult && typeof residualResult.passes === 'boolean';
    const residualOk = residualAuto ? !!residualResult.passes : !!state.manualChecks.residualIncomeVA;

    // ---- Top summary line ----
    const summary = document.createElement('div');
    summary.style.cssText = 'margin-bottom:14px;color:#374151;font-size:12.5px;';
    const parts = [];
    if (d.score) parts.push('Mid score <strong>' + d.score + '</strong>' + (d.qualifyingBorrower ? ' (' + d.qualifyingBorrower + ')' : ''));
    if (dti.back != null) parts.push('Back-end DTI <strong>' + dti.back.toFixed(2) + '%</strong>');
    if (d.piti != null) parts.push('PITI <strong>$' + fmtMoney(d.piti) + '</strong>');
    summary.innerHTML = parts.join(' &middot; ') || 'No data found on this page.';
    body.appendChild(summary);

    // ---- Eligibility ----
    addH(body, 'Eligibility');
    const scoreOk = d.score != null && d.score >= VA_MIN_SCORE;
    addCheck(body, {
      ok: scoreOk,
      label: 'Minimum credit score ≥ ' + VA_MIN_SCORE,
      detail: d.score != null
        ? ('Qualifying mid: ' + d.score + (scoreOk ? ' (passes)' : ' (below floor)'))
        : 'No credit pulled yet'
    });
    const dtiOk = dti.back != null && dti.back <= VA_MAX_DTI;
    addCheck(body, {
      ok: dtiOk,
      label: 'Maximum DTI ≤ ' + VA_MAX_DTI + '%',
      detail: dti.back != null
        ? ('Back-end DTI: ' + dti.back.toFixed(2) + '%' + (dtiOk ? ' (passes)' : ' (over the 43% manual cap)'))
        : 'DTI not available — re-price the scenario'
    });

    // ---- Residual income ----
    addH(body, 'Residual income');
    if (residualAuto) {
      addCheck(body, {
        ok: residualResult.passes,
        label: 'Residual income — VA tables' + (residualResult.dtiOver41 ? ' (DTI > 41% → 120% bump)' : ''),
        detail: 'Computed residual: $' + fmtMoney(residualResult.residualIncome) +
          ' vs requirement $' + fmtMoney(residualResult.requirementEffective) +
          ' (' + (residualResult.region || 'unknown region') + ', family of ' + (residualResult.familySize || '?') + ')'
      });
    } else {
      addManualCheck(body, state, 'residualIncomeVA',
        'Residual income meets the VA table',
        'VA Calc auto-evaluation unavailable — run the VA Residual Income Calc on the Liabilities section and tick this box if it passes.',
        rerender);
    }

    // ---- VA Handbook Ch. 4 requirements (broken out) ----
    addH(body, 'VA Handbook Ch. 4 requirements');

    // 1. AUS findings — best-effort auto-detect (Refer / Manual Downgrade).
    const ausText = detectAusManualFindings();
    let ausOk;
    if (ausText) {
      ausOk = true;
      addCheck(body, {
        ok: true,
        label: 'AUS run (DU/LPA) with Refer / Manual Downgrade findings',
        detail: 'Detected on the page: "' + ausText + '". Keep a copy of the findings in the eFolder.'
      });
    } else {
      ausOk = !!state.manualChecks.vaAus;
      addVaManualCheck(body, state, 'vaAus',
        'AUS run (DU/LPA) — findings in file ("Refer" / "Manual Downgrade")',
        'Couldn\'t auto-detect an AUS recommendation on the page. Submit through DU or LPA — manual UW requires a "Refer" or a manual downgrade — and save the findings to the eFolder.',
        rerender,
        'How to verify: Run DU or LPA. A "Refer", "Refer/Eligible", or manual downgrade is required to manually underwrite. Confirm the AUS findings PDF is in the eFolder.');
    }

    // 2. Satisfactory credit.
    const creditConfirmed = !!state.manualChecks.vaCredit;
    addVaManualCheck(body, state, 'vaCredit',
      'Satisfactory credit per Ch. 4',
      'No unresolved derogatory credit; collections / judgments / charge-offs addressed per VA HB Ch. 4.',
      rerender,
      'How to verify: Review the credit report. Outstanding judgments must be paid or in a documented repayment plan; collections/charge-offs evaluated per Ch. 4. No major unresolved derogatory items.');

    // 3. Mortgage / rental history (1×30×12).
    const mtgConfirmed = !!state.manualChecks.vaMtgHistory;
    addVaManualCheck(body, state, 'vaMtgHistory',
      'Acceptable mortgage / rental history (1×30×12)',
      'No more than one 30-day late in the last 12 months of housing payments.',
      rerender,
      'How to verify: Check the VOM/VOR or the credit report\'s housing tradeline for the last 12 months. More than one 30-day late (1×30×12) generally fails and requires a downgrade.');

    // 4. Bankruptcy / foreclosure / short-sale seasoning.
    const seasoningConfirmed = !!state.manualChecks.vaSeasoning;
    addVaManualCheck(body, state, 'vaSeasoning',
      'Bankruptcy / foreclosure / short-sale seasoning met',
      'Required seasoning since any BK, foreclosure, or short sale has elapsed with re-established credit.',
      rerender,
      'How to verify: Confirm seasoning per Ch. 4 — e.g. Ch. 7 BK ≥ 2 yrs, Ch. 13 ≥ 12 mo of on-time payments, foreclosure ≥ 2 yrs — with re-established satisfactory credit since.');

    // 5. Stable & reliable income.
    const incomeConfirmed = !!state.manualChecks.vaIncome;
    addVaManualCheck(body, state, 'vaIncome',
      'Stable & reliable income verified (2-yr history / VOE)',
      'Two-year employment/income history (or acceptable gap explanation) with likely continuance.',
      rerender,
      'How to verify: Review paystubs, W-2s, and the VOE for a 2-year history and likelihood of continuance. Document any employment gaps > 30 days.');

    // ---- VA guaranty ----
    addH(body, 'VA guaranty');
    const guarantyConfirmed = !!state.manualChecks.vaGuaranty;
    addVaManualCheck(body, state, 'vaGuaranty',
      'Loan is eligible for guaranty by VA',
      'Entitlement (COE), occupancy, and program parameters confirmed.',
      rerender,
      'How to verify: Confirm the COE shows available entitlement, the veteran will occupy as a primary residence, and the loan meets VA program parameters so it\'s eligible for guaranty.');

    const allManualOk = ausOk && creditConfirmed && mtgConfirmed &&
      seasoningConfirmed && incomeConfirmed && guarantyConfirmed;

    // ---- Recommendation ----
    renderVaRecommendation(body, {
      score: d.score,
      dtiBack: dti.back,
      scoreOk: scoreOk,
      dtiOk: dtiOk,
      residualOk: residualOk,
      manualOk: allManualOk
    });

    // ---- Footer ----
    const foot = document.createElement('div');
    foot.style.cssText = 'margin-top:18px;padding-top:12px;border-top:1px dashed #e5e7eb;font-size:11.5px;color:#6b7280;text-align:center;';
    foot.innerHTML = 'Reference: VA Handbook Ch. 4 &nbsp;·&nbsp; ZHL VA Eligibility Matrix (Non-IRRRL) &nbsp;·&nbsp; ' +
      '<a href="https://zallwall.zillowgroup.com/justinca" target="_blank" rel="noopener" style="color:#0b5cab;font-weight:600;text-decoration:underline;" data-zhl-karma-link="va-manual-analyzer">💛 Drop me karma</a>';
    body.appendChild(foot);
  }

  function renderVaRecommendation(body, r) {
    const box = document.createElement('div');
    box.style.cssText = 'margin-top:16px;padding:12px 14px;border-radius:8px;border:1px solid;';
    function lay(title, detail, color) {
      box.style.background = color.bg;
      box.style.borderColor = color.border;
      box.style.color = color.fg;
      const t = document.createElement('div');
      t.style.cssText = 'font-weight:700;font-size:14px;margin-bottom:6px;';
      t.textContent = title;
      const dEl = document.createElement('div');
      dEl.style.cssText = 'font-size:12.5px;line-height:1.5;';
      dEl.innerHTML = detail;
      box.appendChild(t);
      box.appendChild(dEl);
    }
    const RED = { bg: '#fee2e2', border: '#dc2626', fg: '#7f1d1d' };
    const AMBER = { bg: '#fef3c7', border: '#f59e0b', fg: '#78350f' };
    const GREEN = { bg: '#dcfce7', border: '#16a34a', fg: '#14532d' };

    if (!r.scoreOk) {
      lay('✗ Does NOT qualify for VA Manual UW',
        'Qualifying middle score is below the ' + VA_MIN_SCORE + ' minimum (' + (r.score != null ? r.score : 'unknown') + ').', RED);
    } else if (!r.dtiOk) {
      lay('✗ Does NOT qualify for VA Manual UW',
        'Back-end DTI ' + (r.dtiBack != null ? r.dtiBack.toFixed(2) + '%' : 'unknown') + ' exceeds the ' + VA_MAX_DTI + '% manual-UW cap.', RED);
    } else if (!r.residualOk) {
      lay('⚠ Residual income not met',
        'Score and DTI pass, but residual income must meet the VA table (≥ 120% of the requirement when DTI > 41%). Run the VA Residual Income Calc, then re-check.', AMBER);
    } else if (!r.manualOk) {
      lay('⚠ Confirm the manual items',
        'Score ≥ ' + VA_MIN_SCORE + ', DTI ≤ ' + VA_MAX_DTI + '%, and residual income all pass. Confirm the VA Handbook Ch. 4 requirements and VA guaranty eligibility above to complete.', AMBER);
    } else {
      lay('✓ Qualifies for VA Manual UW',
        'Score ≥ ' + VA_MIN_SCORE + ', DTI ≤ ' + VA_MAX_DTI + '%, residual income meets the VA table, and the manual VA requirements are confirmed.', GREEN);
    }
    body.appendChild(box);
  }

  function renderRecommendation(body, state, tiers, verifiedCFs, noDiscretionaryDebtOk) {
    const d = state.data;
    const dti = d.dti;
    // Hard gates first.
    const scoreOk = d.score != null && d.score >= MIN_SCORE;
    const dtiOk = dti.back != null && dti.back <= MAX_DTI;

    const box = document.createElement('div');
    box.style.cssText = 'margin-top:16px;padding:12px 14px;border-radius:8px;border:1px solid;';

    function lay(title, detail, color) {
      box.style.background = color.bg;
      box.style.borderColor = color.border;
      box.style.color = color.fg;
      const t = document.createElement('div');
      t.style.cssText = 'font-weight:700;font-size:14px;margin-bottom:6px;';
      t.textContent = title;
      const dEl = document.createElement('div');
      dEl.style.cssText = 'font-size:12.5px;line-height:1.5;';
      dEl.innerHTML = detail;
      box.appendChild(t);
      box.appendChild(dEl);
    }

    if (!scoreOk) {
      lay('✗ Does NOT qualify for FHA Manual UW',
        'Qualifying middle score is below the 640 minimum (' + (d.score != null ? d.score : 'unknown') + ').',
        { bg: '#fee2e2', border: '#dc2626', fg: '#7f1d1d' });
    } else if (!dtiOk) {
      lay('✗ Does NOT qualify for FHA Manual UW',
        'Back-end DTI ' + (dti.back != null ? dti.back.toFixed(2) + '%' : 'unknown') + ' exceeds the 50% cap.',
        { bg: '#fee2e2', border: '#dc2626', fg: '#7f1d1d' });
    } else {
      // Pick the strongest tier that's satisfied. `tiers` already
      // incorporates the DTI fit + comp-factor count, so a `true`
      // value means "fully qualifies under this tier".
      let chosen = null;
      if (tiers.tier31 === true) chosen = { name: '31 / 43', factors: [] };
      else if (tiers.tier37 === true) chosen = { name: '37 / 47', factors: verifiedCFs.slice(0, 1) };
      else if (tiers.tier40_40 === true) chosen = { name: '40 / 40', factors: ['No discretionary debt confirmed'] };
      else if (tiers.tier40_50 === true) chosen = { name: '40 / 50', factors: verifiedCFs.slice(0, 2) };

      if (chosen) {
        const factorLine = chosen.factors.length
          ? 'Comp factors satisfied: <strong>' + chosen.factors.join('</strong>, <strong>') + '</strong>'
          : 'No compensating factors required.';
        lay('✓ Qualifies for FHA Manual UW under tier ' + chosen.name,
          factorLine, { bg: '#dcfce7', border: '#16a34a', fg: '#14532d' });
      } else {
        // DTI fits some tier but the gates aren't met yet — tell the
        // user exactly which gate they're short on.
        const need = [];
        // Note: tiers here are post-gate, so tier37 === false could
        // mean either DTI doesn't fit OR comp factors are short. We
        // can distinguish by checking the underlying dtiTiers... but
        // re-evaluate via dti directly to avoid threading state.
        const dtiFit37 = dti.front != null && dti.front <= 37 && dti.back <= 47;
        const dtiFit40_40 = dti.back != null && dti.back <= 40;
        const dtiFit40_50 = dti.front != null && dti.front <= 40 && dti.back <= 50;
        if (dtiFit37 && verifiedCFs.length < 1) need.push('Tier 37/47 needs 1 compensating factor (you have ' + verifiedCFs.length + ').');
        if (dtiFit40_40 && !noDiscretionaryDebtOk) need.push('Tier 40/40 needs confirmation of no discretionary debt — toggle it above.');
        if (dtiFit40_50 && verifiedCFs.length < 2) need.push('Tier 40/50 needs 2 compensating factors (you have ' + verifiedCFs.length + ').');
        if (!dtiFit37 && !dtiFit40_40 && !dtiFit40_50) need.push('DTI exceeds every Manual UW ratio tier.');
        lay('⚠ Likely does NOT qualify — see what\'s missing',
          (need.length ? need.join('<br>') : 'See the checks above.'),
          { bg: '#fef3c7', border: '#f59e0b', fg: '#78350f' });
      }
    }
    body.appendChild(box);
  }

  // ---- UI primitives ------------------------------------------------------

  function addH(parent, text) {
    const h = document.createElement('div');
    h.textContent = text;
    h.style.cssText = 'font:700 11.5px/1.2 Arial,sans-serif;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin:14px 0 6px;';
    parent.appendChild(h);
  }
  function addCheck(parent, opts) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;padding:8px 10px;border-radius:6px;background:#f9fafb;margin-bottom:4px;';
    const icon = document.createElement('span');
    icon.style.cssText = 'flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;font:700 12px/1 Arial,sans-serif;color:#fff;margin-top:1px;';
    if (opts.indeterminate) {
      icon.textContent = '?';
      icon.style.background = '#9ca3af';
    } else if (opts.ok) {
      icon.textContent = '✓';
      icon.style.background = '#16a34a';
    } else {
      icon.textContent = '✗';
      icon.style.background = '#dc2626';
    }
    const txt = document.createElement('div');
    txt.style.flex = '1';
    const t1 = document.createElement('div');
    t1.textContent = opts.label;
    t1.style.cssText = 'font-weight:600;color:#1f2937;';
    const t2 = document.createElement('div');
    t2.innerHTML = opts.detail || '';
    t2.style.cssText = 'font-size:12px;color:#6b7280;margin-top:2px;';
    txt.appendChild(t1);
    txt.appendChild(t2);
    row.appendChild(icon);
    row.appendChild(txt);
    parent.appendChild(row);
  }
  function addManualCheck(parent, state, key, label, detail, rerender) {
    const checked = !!state.manualChecks[key];
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;gap:10px;padding:8px 10px;border-radius:6px;background:#f9fafb;margin-bottom:4px;cursor:pointer;align-items:flex-start;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.style.cssText = 'margin-top:4px;flex:0 0 auto;width:16px;height:16px;cursor:pointer;';
    cb.addEventListener('change', function () {
      state.manualChecks[key] = cb.checked;
      // Persist for this loan session so re-opening the panel keeps
      // the user's selections.
      manualChecksByLoan[loanKey()] = Object.assign({}, manualChecksByLoan[loanKey()] || {}, state.manualChecks);
      rerender();
    });
    const txt = document.createElement('div');
    txt.style.flex = '1';
    const t1 = document.createElement('div');
    t1.textContent = label;
    t1.style.cssText = 'font-weight:600;color:#1f2937;';
    const t2 = document.createElement('div');
    t2.textContent = detail;
    t2.style.cssText = 'font-size:12px;color:#6b7280;margin-top:2px;';
    const t3 = document.createElement('div');
    t3.textContent = checked ? '✓ Confirmed' : 'Tap to confirm';
    t3.style.cssText = 'font-size:11px;font-weight:700;color:' + (checked ? '#16a34a' : '#0b5cab') + ';margin-top:3px;';
    txt.appendChild(t1);
    txt.appendChild(t2);
    txt.appendChild(t3);
    row.appendChild(cb);
    row.appendChild(txt);
    parent.appendChild(row);
  }
  function fmtMoney(n) {
    if (n == null || !isFinite(n)) return '?';
    return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // Best-effort read of the AUS recommendation anywhere on the page.
  // Manual UW requires a "Refer" or a manual downgrade. Returns the
  // matched finding text, or null when none is detectable.
  function detectAusManualFindings() {
    const body = (document.body && document.body.textContent) || '';
    const re = /Refer\s*(?:\/|\s*with\s+Caution|\s)\s*(?:Eligible|Ineligible)?|Manual\s+Downgrade/i;
    const m = re.exec(body);
    if (!m) return null;
    return m[0].replace(/\s+/g, ' ').trim();
  }

  // VA manual-confirmation row: a div (not a <label>) so the reference
  // links don't toggle the checkbox. Shows a how-to-verify tooltip and
  // inline ZHL Matrix + VA HB Ch. 4 links.
  function addVaManualCheck(parent, state, key, label, detail, rerender, tooltip) {
    const checked = !!state.manualChecks[key];
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;padding:8px 10px;border-radius:6px;background:#f9fafb;margin-bottom:4px;align-items:flex-start;';
    if (tooltip) row.title = tooltip;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.style.cssText = 'margin-top:4px;flex:0 0 auto;width:16px;height:16px;cursor:pointer;';
    const toggle = function () {
      state.manualChecks[key] = cb.checked;
      manualChecksByLoan[loanKey()] = Object.assign({}, manualChecksByLoan[loanKey()] || {}, state.manualChecks);
      rerender();
    };
    cb.addEventListener('change', toggle);

    const txt = document.createElement('div');
    txt.style.flex = '1';
    const t1 = document.createElement('div');
    t1.textContent = label;
    t1.style.cssText = 'font-weight:600;color:#1f2937;cursor:pointer;';
    // Clicking the label text toggles the checkbox (the row isn't a
    // <label>, so we wire it manually — links below stay independent).
    t1.addEventListener('click', function () { cb.checked = !cb.checked; toggle(); });
    const t2 = document.createElement('div');
    t2.textContent = detail;
    t2.style.cssText = 'font-size:12px;color:#6b7280;margin-top:2px;';

    // Reference links — open in a new tab; stop propagation so they
    // never toggle the row.
    const linksWrap = document.createElement('div');
    linksWrap.style.cssText = 'margin-top:4px;display:flex;gap:14px;flex-wrap:wrap;';
    function addLink(text, url) {
      if (!url) return;
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = text;
      a.style.cssText = 'font-size:11px;font-weight:600;color:#0b5cab;text-decoration:underline;';
      a.addEventListener('click', function (e) { e.stopPropagation(); });
      linksWrap.appendChild(a);
    }
    addLink('📄 ZHL VA Matrix', ZHL_VA_MATRIX_URL);
    addLink('📖 VA HB Ch. 4', VA_HANDBOOK_CH4_URL);

    const t3 = document.createElement('div');
    t3.textContent = checked ? '✓ Confirmed' : 'Tap the box or label to confirm';
    t3.style.cssText = 'font-size:11px;font-weight:700;color:' + (checked ? '#16a34a' : '#0b5cab') + ';margin-top:4px;';

    txt.appendChild(t1);
    txt.appendChild(t2);
    if (linksWrap.children.length) txt.appendChild(linksWrap);
    txt.appendChild(t3);
    row.appendChild(cb);
    row.appendChild(txt);
    parent.appendChild(row);
  }

  function scan() {
    if (!isFullApplicationPage()) { removeBadge(); return; }
    const sec = findCreditSection();
    if (!sec) { removeBadge(); return; }
    const result = computeQualifyingScore(sec);
    ensureBadge(sec, result);
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      try { scan(); } catch (e) { console.warn('[FHA Manual Eligible] scan error', e); }
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
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
