// ZHL Productivity Pack module — feature key: feature_vaNonSpouseWarning
//
// Hard-stop warning when an LOP loan combines:
//   - Product = VA (read from the "Product name" field in the Loan
//     Details sidebar — matches /\bVA\b/i against names like "VA 30
//     Yr Fixed", "VA IRRRL", etc.)
//   - At least one borrower has a qualifying VA veteran type
//     ("Regular military" or "National Guard or reserves")
//   - At least one OTHER borrower does NOT have a qualifying veteran
//     type — i.e. they're a non-veteran co-borrower
//   - At least one borrower on the loan is NOT marked "Married"
//
// ZHL policy: a non-veteran co-borrower can only be on a VA loan if
// they're the legally married spouse of the veteran. If everyone on
// the loan independently qualifies for VA (e.g. two service members),
// fine. If the non-veteran is the veteran's married spouse, fine.
// Anything else is an underwriting error.
//
// The warning needs to be impossible to miss, so we paint a sticky
// red banner across the top of the page AND outline the offending
// fields (the non-vet co-borrower's veteran type + any borrower's
// marital status that isn't Married) in red. Same visual language
// as the FHA Non-Permanent Resident Alien banner (fha-npr-warning.js).

(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_vaNonSpouseWarning';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[VA Non-Spouse Warning v' + VERSION + '] loaded');

  const BANNER_ID = 'zhl-va-nonspouse-banner';
  const FIELD_FLAG_ATTR = 'data-zhl-va-nonspouse-flagged';
  const QUALIFYING_VETERAN_TYPES = ['Regular military', 'National Guard or reserves'];

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalize(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function getSelectText(sel) {
    if (!sel) return '';
    const opt = sel.options && sel.options[sel.selectedIndex];
    return opt ? (opt.text || '').trim() : '';
  }

  // Read "Product name" out of the Loan Details sidebar (same shape
  // as the FHA NPR banner uses). Returns "" if the sidebar hasn't
  // rendered yet.
  function readProductName() {
    const spans = document.querySelectorAll('span');
    for (const sp of spans) {
      const t = (sp.textContent || '').trim();
      if (t !== 'Product name') continue;
      const cell = sp.parentElement;
      if (!cell) continue;
      const p = cell.querySelector('p');
      if (p) return (p.textContent || '').trim();
    }
    return '';
  }

  function isVAProduct(name) {
    // Match "VA" as a word so we don't false-positive on "Conv" or
    // brand names containing "va" as a substring. LOP renders e.g.
    // "VA 30 Yr Fixed", "VA IRRRL", "VA 15 Yr Fixed".
    return /\bVA\b/i.test(name || '');
  }

  function isQualifyingVeteranType(text) {
    const n = normalize(text);
    return QUALIFYING_VETERAN_TYPES.some(function (t) {
      return normalize(t) === n;
    });
  }

  // ZHL guideline: borrower has to be flat-out "Married" to count as
  // the veteran's spouse. "Separated" / "Unmarried" / "Divorced" etc.
  // don't satisfy the rule — those people aren't legally married to
  // the veteran for VA-eligibility purposes.
  function isMarried(text) {
    return normalize(text) === 'married';
  }

  function readBorrowerNameFromScope(scope) {
    if (!scope) return null;
    const firstSelectors = [
      'input[name="legalFirstName"]',
      'input[name="firstName"]',
      'input[name*="legalFirstName" i]',
      'input[name*="firstName" i]'
    ];
    const lastSelectors = [
      'input[name="legalLastName"]',
      'input[name="lastName"]',
      'input[name*="legalLastName" i]',
      'input[name*="lastName" i]'
    ];
    let first = '', last = '';
    for (const s of firstSelectors) {
      const inp = scope.querySelector(s);
      if (inp && inp.value) { first = inp.value.trim(); break; }
    }
    for (const s of lastSelectors) {
      const inp = scope.querySelector(s);
      if (inp && inp.value) { last = inp.value.trim(); break; }
    }
    if (first && last) return first + ' ' + last;
    return first || last || null;
  }

  // For each visible veteranType select, walk up to find the SMALLEST
  // ancestor that contains it + exactly one maritalStatus select —
  // that's the borrower's form section. Inside that scope, read the
  // borrower's name + marital status.
  function findBorrowers() {
    const out = [];
    const vtSelects = document.querySelectorAll('select[name="veteranType"]');
    for (const vt of vtSelects) {
      if (vt.offsetParent === null) continue;
      let scope = vt.parentElement;
      let bestScope = null;
      while (scope && scope !== document.body) {
        const vts = scope.querySelectorAll('select[name="veteranType"]');
        const mss = scope.querySelectorAll('select[name="maritalStatus"]');
        if (vts.length > 1) break;
        if (vts.length === 1 && mss.length >= 1) {
          bestScope = scope;
        }
        scope = scope.parentElement;
      }
      if (!bestScope) continue;
      const msSelect = bestScope.querySelector('select[name="maritalStatus"]');
      const vtText = getSelectText(vt);
      const msText = getSelectText(msSelect);
      out.push({
        scope: bestScope,
        veteranTypeSelect: vt,
        veteranTypeText: vtText,
        maritalSelect: msSelect,
        maritalText: msText,
        isVeteran: isQualifyingVeteranType(vtText),
        isMarried: isMarried(msText),
        name: readBorrowerNameFromScope(bestScope) || 'Borrower'
      });
    }
    return out;
  }

  function clearHighlights() {
    document.querySelectorAll('[' + FIELD_FLAG_ATTR + ']').forEach(function (el) {
      el.removeAttribute(FIELD_FLAG_ATTR);
      el.style.borderColor = '';
      el.style.boxShadow = '';
      el.style.background = '';
    });
  }

  function highlightField(el) {
    if (!el) return;
    el.setAttribute(FIELD_FLAG_ATTR, '1');
    el.style.borderColor = '#b91c1c';
    el.style.boxShadow = '0 0 0 3px rgba(185,28,28,.35)';
    el.style.background = '#fef2f2';
  }

  function applyHighlights(toFlag) {
    const newSet = new Set(toFlag);
    document.querySelectorAll('[' + FIELD_FLAG_ATTR + ']').forEach(function (el) {
      if (newSet.has(el)) return;
      el.removeAttribute(FIELD_FLAG_ATTR);
      el.style.borderColor = '';
      el.style.boxShadow = '';
      el.style.background = '';
    });
    for (const el of toFlag) {
      if (el.hasAttribute(FIELD_FLAG_ATTR)) continue;
      highlightField(el);
    }
  }

  function removeBanner() {
    const b = document.getElementById(BANNER_ID);
    if (b) b.remove();
  }

  function ensureBanner(productName, nonVetCoborrowers, unmarriedBorrowers) {
    let banner = document.getElementById(BANNER_ID);
    if (!banner) {
      banner = document.createElement('div');
      banner.id = BANNER_ID;
      banner.title = 'Built by Justin Case. Karma appreciated 💛';
      banner.setAttribute('style',
        'position:fixed;top:0;left:0;right:0;z-index:2147483646;' +
        'background:#b91c1c;color:#fff;' +
        'padding:14px 28px;' +
        'font:700 15px/1.45 Arial,Helvetica,sans-serif;' +
        'text-align:center;letter-spacing:.2px;' +
        'box-shadow:0 4px 14px rgba(0,0,0,.4);' +
        'border-bottom:4px solid #7f1d1d;' +
        'pointer-events:auto;'
      );
      (document.body || document.documentElement).appendChild(banner);
    }
    const nonVetNames = [];
    const seenN = new Set();
    nonVetCoborrowers.forEach(function (b) {
      if (seenN.has(b.name)) return;
      seenN.add(b.name);
      nonVetNames.push(b.name);
    });
    const unmarriedNames = [];
    const seenU = new Set();
    unmarriedBorrowers.forEach(function (b) {
      if (seenU.has(b.name)) return;
      seenU.add(b.name);
      unmarriedNames.push(b.name);
    });
    const nonVetList = nonVetNames.join(', ');
    const unmarriedList = unmarriedNames.join(', ');
    const isPlural = nonVetNames.length !== 1;
    banner.innerHTML =
      '<span style="font-size:20px;margin-right:8px;vertical-align:-2px;">⚠</span>' +
      '<strong style="font-size:16px;">VA INELIGIBLE CO-BORROWER</strong>' +
      ' &nbsp;—&nbsp; This is a <strong>' + escapeHtml(productName) + '</strong> loan, but ' +
      '<strong>' + escapeHtml(nonVetList) + '</strong> ' +
      (isPlural ? 'are' : 'is') + ' marked as a non-veteran (or non-qualifying) co-borrower' +
      ' and <strong>' + escapeHtml(unmarriedList) + '</strong> ' +
      (unmarriedNames.length === 1 ? 'is' : 'are') + ' not marked <strong>Married</strong>.' +
      ' &nbsp;ZHL only allows non-veteran co-borrowers on a VA loan when they\'re the' +
      ' veteran\'s legally married spouse, or when they independently qualify for VA.' +
      ' &nbsp;Fix the veteran type, mark both borrowers Married, or remove the co-borrower.';
  }

  let scheduled = false;
  function scan() {
    scheduled = false;
    const productName = readProductName();
    if (!productName || !isVAProduct(productName)) {
      removeBanner();
      clearHighlights();
      return;
    }
    const borrowers = findBorrowers();
    if (borrowers.length < 2) {
      // Solo borrower → spouse rule doesn't apply.
      removeBanner();
      clearHighlights();
      return;
    }
    const vets = borrowers.filter(function (b) { return b.isVeteran; });
    const nonVets = borrowers.filter(function (b) { return !b.isVeteran; });
    if (vets.length === 0) {
      // No qualifying veteran on the file — that's a different problem
      // (VA loan with no eligible veteran) but not the one we're
      // flagging here. Stay quiet.
      removeBanner();
      clearHighlights();
      return;
    }
    if (nonVets.length === 0) {
      // Every borrower is independently VA-qualified. No spouse
      // requirement to enforce.
      removeBanner();
      clearHighlights();
      return;
    }
    // Spouse rule: every borrower on the file has to be marked Married.
    // If any borrower (vet or non-vet) is not Married, the non-vet
    // co-borrower can't be on the loan.
    const unmarriedBorrowers = borrowers.filter(function (b) { return !b.isMarried; });
    if (unmarriedBorrowers.length === 0) {
      // Everyone Married → assume they're married to each other → OK.
      // (LOP doesn't model spouse-of-whom explicitly; we trust the
      // marital status fields.)
      removeBanner();
      clearHighlights();
      return;
    }

    ensureBanner(productName, nonVets, unmarriedBorrowers);
    const toFlag = [];
    nonVets.forEach(function (b) { if (b.veteranTypeSelect) toFlag.push(b.veteranTypeSelect); });
    unmarriedBorrowers.forEach(function (b) { if (b.maritalSelect) toFlag.push(b.maritalSelect); });
    applyHighlights(toFlag);
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(scan);
  }

  // Observe DOM and form changes so the banner appears immediately
  // when the user picks a non-qualifying veteran type or changes
  // marital status. Heartbeat picks up anything the observer misses
  // (React-controlled select value updates don't always fire a DOM
  // mutation we can hook).
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ['value']
  });
  document.addEventListener('change', schedule, true);
  document.addEventListener('input', schedule, true);
  schedule();
  setInterval(scan, 2000);
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
