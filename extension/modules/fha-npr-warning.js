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

  // Walk up from a citizenship select to its borrower-pair tab
  // panel, then look up the tab label so we can name the offender
  // ("Nayibe Arenas" / "Sandra Arenas" / etc.) in the banner.
  function findBorrowerNameForSelect(sel) {
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
        const dataCy = p.getAttribute('data-cy') || '';
        const m = /borrower-pair-tab-(\d+)/.exec(dataCy);
        if (m) return 'Borrower pair ' + (parseInt(m[1], 10) + 1);
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
    const names = offenders.map(function (o) { return o.name; }).join(', ');
    const isPlural = offenders.length !== 1;
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
    chrome.storage.local.get([__ZHL_FEATURE_KEY], function (data) {
      if (data[__ZHL_FEATURE_KEY] === false) return;
      __zhlRunModule();
    });
  } else {
    __zhlRunModule();
  }
})();
