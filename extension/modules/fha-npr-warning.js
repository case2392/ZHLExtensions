// ZHL Productivity Pack module — feature key: feature_fhaNprWarning
//
// Hard-stop warning when an LOP loan combines:
//   - Product = FHA (read from the "Product name" field in the
//     Loan Details sidebar)
//   - Any borrower's Citizenship = "Non-permanent resident alien"
//
// HUD removed Non-Permanent Resident Alien borrowers from FHA
// eligibility effective May 25, 2025. Originating this combination
// is an underwriting error. The warning needs to be impossible to
// miss, so we paint a sticky red banner across the top of the page
// AND outline the offending citizenship dropdown in red.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_fhaNprWarning';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[FHA NPR Warning v' + VERSION + '] loaded');

  const BANNER_ID = 'zhl-fha-npr-banner';
  const FIELD_FLAG_ATTR = 'data-zhl-fha-npr-flagged';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Read the "Product name" cell out of the Loan Details sidebar.
  // The DOM shape (per current LOP):
  //   <div ...><span>Product name</span><p>FHA 30 Yr Fixed</p></div>
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

  function isFhaProduct(name) {
    // Match "FHA" as a word so we don't false-positive on "Florida
    // Housing" or similar. LOP names them e.g. "FHA 30 Yr Fixed",
    // "FHA Streamline", etc.
    return /\bFHA\b/i.test(name || '');
  }

  // Read the borrower's name from the Legal first / last name
  // inputs inside a scope. Tries a few common LOP field-name
  // variants. Returns null if neither field is populated.
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
    let firstName = '';
    let lastName = '';
    for (const s of firstSelectors) {
      const inp = scope.querySelector(s);
      if (inp && inp.value) { firstName = inp.value.trim(); break; }
    }
    for (const s of lastSelectors) {
      const inp = scope.querySelector(s);
      if (inp && inp.value) { lastName = inp.value.trim(); break; }
    }
    if (firstName && lastName) return firstName + ' ' + lastName;
    return firstName || lastName || null;
  }

  // Walk up from a citizenship select to find the LARGEST ancestor
  // that still contains exactly one citizenship select — that's the
  // per-borrower section. Anything wider would contain the OTHER
  // borrower's select too, and the name lookup would conflate them
  // (which is how the v1.15.0 banner ended up listing the tab
  // label "Nayibe Arenas & Sandra Arenas" twice). Within that
  // scope, read the Legal first / last name inputs.
  function findBorrowerNameForSelect(sel) {
    let largestSafeScope = sel;
    let cur = sel.parentElement;
    while (cur && cur !== document.body) {
      const citizens = cur.querySelectorAll('select[name="citizenship"]');
      if (citizens.length > 1) break;
      largestSafeScope = cur;
      cur = cur.parentElement;
    }
    const name = readBorrowerNameFromScope(largestSafeScope);
    if (name) return name;
    // Fallbacks if the legal-name inputs are empty (rare — usually
    // citizenship is filled in well after the name is).
    let p = sel.parentElement;
    while (p && p !== document.body) {
      if (p.getAttribute && p.getAttribute('role') === 'tabpanel') {
        const tabId = p.getAttribute('aria-labelledby');
        if (tabId) {
          const tab = document.getElementById(tabId);
          if (tab) {
            const txt = (tab.textContent || '').trim();
            if (txt) return txt;
          }
        }
        break;
      }
      p = p.parentElement;
    }
    return 'Borrower';
  }

  function findOffenders() {
    const selects = document.querySelectorAll('select[name="citizenship"]');
    const offenders = [];
    for (const sel of selects) {
      if (sel.value !== 'NonPermanentResidentAlien') continue;
      // offsetParent === null filters hidden / unmounted tabs.
      if (sel.offsetParent === null) continue;
      offenders.push({ select: sel, name: findBorrowerNameForSelect(sel) });
    }
    return offenders;
  }

  function clearAllHighlights() {
    const flagged = document.querySelectorAll('[' + FIELD_FLAG_ATTR + ']');
    flagged.forEach(function (s) {
      s.removeAttribute(FIELD_FLAG_ATTR);
      s.style.borderColor = '';
      s.style.boxShadow = '';
      s.style.background = '';
    });
  }

  function applyHighlights(offenders) {
    const newSet = new Set();
    for (const o of offenders) newSet.add(o.select);
    // Clear stale flags from selects that are no longer offenders
    // (e.g. user fixed the citizenship).
    document.querySelectorAll('[' + FIELD_FLAG_ATTR + ']').forEach(function (s) {
      if (newSet.has(s)) return;
      s.removeAttribute(FIELD_FLAG_ATTR);
      s.style.borderColor = '';
      s.style.boxShadow = '';
      s.style.background = '';
    });
    for (const o of offenders) {
      if (o.select.hasAttribute(FIELD_FLAG_ATTR)) continue;
      o.select.setAttribute(FIELD_FLAG_ATTR, '1');
      o.select.style.borderColor = '#b91c1c';
      o.select.style.boxShadow = '0 0 0 3px rgba(185,28,28,.35)';
      o.select.style.background = '#fef2f2';
    }
  }

  function removeBanner() {
    const b = document.getElementById(BANNER_ID);
    if (b) b.remove();
  }

  function ensureBanner(productName, offenders) {
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
    const uniqueNames = [];
    const seen = new Set();
    for (const o of offenders) {
      if (seen.has(o.name)) continue;
      seen.add(o.name);
      uniqueNames.push(o.name);
    }
    const names = uniqueNames.join(', ');
    const isPlural = uniqueNames.length !== 1;
    const verbPhrase = isPlural ? 'are' : 'is';
    banner.innerHTML =
      '<span style="font-size:20px;margin-right:8px;vertical-align:-2px;">⚠</span>' +
      '<strong style="font-size:16px;">FHA INELIGIBLE</strong>' +
      ' &nbsp;—&nbsp; This is an <strong>' + escapeHtml(productName) + '</strong> loan but ' +
      '<strong>' + escapeHtml(names) + '</strong> ' + verbPhrase + ' marked ' +
      '<strong>Non-Permanent Resident Alien</strong>. ' +
      'HUD removed NPRA borrowers from FHA eligibility on May 25, 2025. ' +
      'Switch the loan product or the borrower citizenship before continuing.';
  }

  let scheduled = false;
  function scan() {
    scheduled = false;
    const productName = readProductName();
    if (!productName || !isFhaProduct(productName)) {
      removeBanner();
      clearAllHighlights();
      return;
    }
    const offenders = findOffenders();
    if (!offenders.length) {
      removeBanner();
      clearAllHighlights();
      return;
    }
    ensureBanner(productName, offenders);
    applyHighlights(offenders);
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(scan);
  }

  // Observe DOM and form changes so the banner appears immediately
  // when the user picks "Non-permanent resident alien" or the product
  // changes to/from FHA. Heartbeat picks up anything the observer
  // misses (the citizenship <select> value update doesn't always
  // fire a DOM mutation).
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
    chrome.storage.local.get([__ZHL_FEATURE_KEY, 'zhl_kill_switch'], function (data) {
      if (data.zhl_kill_switch === true) return;
      if (data[__ZHL_FEATURE_KEY] === false) return;
      __zhlRunModule();
    });
  } else {
    __zhlRunModule();
  }
})();
