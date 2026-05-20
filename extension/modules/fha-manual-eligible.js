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
  const ZHL_TIP = 'Built by Justin Case. Karma appreciated 💛';
  const MIN_SCORE = 640;

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
      badge = document.createElement('div');
      badge.id = BADGE_ID;
      badge.style.cssText =
        'display:flex;align-items:center;gap:6px;' +
        'margin:8px 0 12px;padding:6px 10px;' +
        'border-radius:6px;border:1px solid transparent;' +
        'font:600 12px/1.2 Arial,Helvetica,sans-serif;' +
        'box-sizing:border-box;';
      // Insert immediately after the "Credit" h6 so it sits between
      // the heading and the per-borrower rows.
      const h6 = Array.from(creditSection.querySelectorAll('h6')).find(function (h) {
        return (h.textContent || '').trim() === 'Credit';
      });
      if (h6 && h6.parentElement === creditSection) {
        h6.insertAdjacentElement('afterend', badge);
      } else {
        creditSection.insertBefore(badge, creditSection.firstChild);
      }
    }
    paintBadge(badge, result);
  }

  function paintBadge(badge, result) {
    if (!result) {
      badge.style.background = '#f3f4f6';
      badge.style.borderColor = '#d1d5db';
      badge.style.color = '#374151';
      badge.textContent = 'No credit pulled yet — FHA eligibility unknown';
      badge.title = GUIDELINES + '\n\n' + ZHL_TIP;
      return;
    }
    const eligible = result.score >= MIN_SCORE;
    badge.innerHTML = '';
    const icon = document.createElement('span');
    icon.textContent = eligible ? '✓' : '✗';
    icon.style.cssText =
      'display:inline-flex;align-items:center;justify-content:center;' +
      'width:16px;height:16px;border-radius:50%;' +
      'font-size:11px;font-weight:700;' +
      'background:' + (eligible ? '#16a34a' : '#dc2626') + ';color:#fff;flex:0 0 auto;';
    const label = document.createElement('span');
    label.textContent = eligible ? 'FHA Manual Eligible' : 'FHA Manual Ineligible';
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
    // Tooltip layout:
    //   1) The pass/fail vs 640 summary with the qualifying borrower
    //   2) A heads-up about the PHH (680+) and Mr. Cooper (none) overlays
    //      when the score is in the 640–679 grey zone where it'd pass
    //      with most aggregators but not PHH
    //   3) The full guidelines block from above
    const summary = eligible
      ? 'Qualifying middle score ' + result.score + ' meets ZHL\'s FHA Manual UW floor of ' + MIN_SCORE + '.'
      : 'Qualifying middle score ' + result.score + ' is below ZHL\'s FHA Manual UW floor of ' + MIN_SCORE + '.';
    const overlayNote = (eligible && result.score < 680)
      ? '\n\nHeads up: PHH requires ≥ 680, so this file is eligible at Amerihome / PennyMac but NOT at PHH. Mr. Cooper does not allow manual UW at any score.'
      : '';
    badge.title =
      summary +
      '\nQualifying borrower: ' + result.borrower +
      '\n(Middle of the three bureau scores per borrower; LOWER middle when there are multiple borrowers.)' +
      overlayNote +
      '\n\n' + GUIDELINES +
      '\n\n' + ZHL_TIP;
  }

  function removeBadge() {
    const b = document.getElementById(BADGE_ID);
    if (b) b.remove();
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
    chrome.storage.local.get([__ZHL_FEATURE_KEY], function (data) {
      if (data[__ZHL_FEATURE_KEY] === false) return;
      __zhlRunModule();
    });
  } else {
    __zhlRunModule();
  }
})();
