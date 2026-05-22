// ZHL Productivity Pack module — feature key: feature_pricingExceptionWorkflow
//
// Adds a "Pricing Exception Workflow" button to LOP's loan toolbar (next to
// Copy LOP file / Stage / Paste-from-staged). Click → opens a guided
// multi-step modal that walks the LO through the PE submission checklist
// per the manager's spec:
//
//   Q: Is this loan locked?
//      Yes → Imported pricing? → Comp PE fields? → No lock-diff alert? →
//            Comp LE in eFolder? → < 2.5 pts? →
//              under 2.5: email RM "ZG#### is ready for PE request"
//              over  2.5: surface 3 justification questions, include in email
//      No  → Updated scenario assigned? → Comp LE on tasks? →
//            Enter ZHL + Comp pricing details → compute PE $ + points →
//            < 2.5 pts? → same email branches
//
// Output is a previewable email body the LO can Copy or Open in mail.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_pricingExceptionWorkflow';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[Pricing Exception Workflow v' + VERSION + '] loaded');

  const ZHL_TIP    = 'Built by Justin Case. Karma appreciated 💛';
  const BUTTON_ID  = 'zhl-pe-workflow-btn';
  const MODAL_ID   = 'zhl-pe-workflow-modal';
  const STORAGE_KEY_RM = 'zhlPeWorkflowRmEmail';

  // ---- helpers ------------------------------------------------------------
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function parseNum(s) {
    if (s == null) return 0;
    const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
  }
  function formatMoney(n) {
    if (n == null || isNaN(n)) n = 0;
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    return sign + '$' + abs.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function formatPctDisplay(n) {
    return (Math.round(Number(n) * 1000) / 1000).toFixed(3) + '%';
  }

  // ---- page data extraction -----------------------------------------------
  function extractBorrowerNames() {
    // Look for the "X Primary borrower" / "X Co-borrower" labels in the
    // borrower header. Falls back to empty if not on a page that shows them.
    const out = { primary: '', coborrower: '' };
    try {
      const all = document.querySelectorAll('span, div');
      for (const el of all) {
        const t = (el.textContent || '').trim();
        if (/Primary borrower$/i.test(t) && el.previousSibling) {
          const name = (el.previousSibling.textContent || '').trim();
          if (name && !out.primary) out.primary = name;
        }
        if (out.primary && out.coborrower) break;
      }
      // Fallback: scan for tab labels like "Mark Malone & Sarah Malone"
      if (!out.primary) {
        const tab = document.querySelector('[role="tab"][aria-selected="true"], [class*="tab"][aria-selected="true"]');
        if (tab) {
          const txt = (tab.textContent || '').trim();
          const m = txt.match(/^([^&]+?)(?:\s*&\s*(.+))?$/);
          if (m) {
            out.primary    = (m[1] || '').trim();
            out.coborrower = (m[2] || '').trim();
          }
        }
      }
    } catch (_) {}
    return out;
  }

  function extractLoanIdFromUrl() {
    const m = location.pathname.match(/\/loan-officer-portal\/([a-f0-9-]{8,})/i);
    return m ? m[1] : '';
  }

  // LOP shows the Encompass ZG# in a span near the borrower name
  // ("#ZG001260248246"). Pull it so the email auto-uses the ZG# instead of
  // the LOP UUID.
  function extractZgNumberFromDom() {
    try {
      const all = document.querySelectorAll('span, a, button');
      for (const el of all) {
        if (el.children && el.children.length > 0) continue; // leaf only
        const t = (el.textContent || '').trim();
        const m = t.match(/^#?(ZG\d{6,})$/i);
        if (m) return m[1].toUpperCase();
      }
    } catch (_) {}
    return '';
  }

  // Walk LOP's "Loan Details" right-rail card and return a { label: value }
  // map. Each row is a <div> with a <span> label and a <p> value (sometimes
  // wrapped in a <button>). Lets us pre-fill purchase price / loan amount /
  // rate / loan type into the unlocked-path comp pricing form.
  function extractLoanDetails() {
    const out = {};
    try {
      const headings = document.querySelectorAll('h6, h5, h4');
      let host = null;
      for (const h of headings) {
        if (/^\s*loan\s*details\s*$/i.test((h.textContent || '').replace(/\s+/g, ' '))) {
          // Walk up to a container that holds the grid of rows.
          let p = h.parentElement;
          for (let i = 0; i < 5 && p; i++) {
            if (p.querySelector('[class*="Grid"]')) { host = p; break; }
            p = p.parentElement;
          }
          if (!host) host = h.parentElement && h.parentElement.parentElement;
          break;
        }
      }
      if (!host) return out;
      const rows = host.querySelectorAll('div');
      for (const row of rows) {
        const span = row.querySelector(':scope > span');
        const valueEl = row.querySelector(':scope > p, :scope > button > p');
        if (!span || !valueEl) continue;
        const label = (span.textContent || '').trim();
        const value = (valueEl.textContent || '').trim();
        if (label && value && !out[label]) out[label] = value;
      }
    } catch (_) {}
    return out;
  }

  // ---- Closing-costs popup scrape -----------------------------------------
  // LOP's Loan Details card has a "Total closing costs" link that opens a
  // "Detailed cost summary" dialog. Inside, the "Lender costs" section's
  // Total = LE Section A (Box A) — discount points + origination fee — and
  // the "Credits" section's "Lender credit" is the lender credit value.
  // We click the link, wait for the dialog, scrape, then close it. To
  // avoid a visible flash we inject CSS that hides any LOP dialog while
  // the scrape runs.
  function findClosingCostsButton() {
    try {
      const headings = document.querySelectorAll('h6');
      let host = null;
      for (const h of headings) {
        if (/^\s*loan\s*details\s*$/i.test((h.textContent || '').replace(/\s+/g, ' '))) {
          host = h.closest('div').parentElement;
          let p = h.parentElement;
          for (let i = 0; i < 6 && p; i++) {
            if (p.querySelectorAll('button').length > 0) { host = p; break; }
            p = p.parentElement;
          }
          break;
        }
      }
      if (!host) return null;
      const rows = host.querySelectorAll('div');
      for (const row of rows) {
        const span = row.querySelector(':scope > span');
        if (!span) continue;
        const t = (span.textContent || '').replace(/\s+/g, ' ').trim();
        if (/^total\s*closing\s*costs$/i.test(t)) {
          return row.querySelector('button');
        }
      }
    } catch (_) {}
    return null;
  }

  function scrapeClosingCostsDialog(dialog) {
    const out = { boxA: 0, lenderCredits: 0 };
    try {
      // We walk through the rows; track which section we're in by header
      // text. The Lender costs section's Total row is Box A. The Credits
      // section's "Lender credit" row is the lender credit.
      const all = dialog.querySelectorAll('span');
      const arr = [];
      for (const s of all) arr.push((s.textContent || '').replace(/\s+/g, ' ').trim());
      let section = null;
      for (let i = 0; i < arr.length; i++) {
        const t = arr[i];
        if (/^lender\s*costs$/i.test(t))                                  { section = 'lender_costs'; continue; }
        if (/^fees\s+you\s+cannot\s+shop\s+for$/i.test(t))                { section = 'other_loan';   continue; }
        if (/^third[-\s]?party\s+costs$/i.test(t))                        { section = 'other_loan';   continue; }
        if (/^other\s+costs$/i.test(t))                                   { section = 'other';        continue; }
        if (/^taxes\s+and\s+other\s+government\s+fees$/i.test(t))         { section = 'taxes';        continue; }
        if (/^prepaids$/i.test(t))                                        { section = 'prepaids';     continue; }
        if (/^initial\s+escrow\s+payment\s+at\s+closing$/i.test(t))       { section = 'escrow';       continue; }
        if (/^credits$/i.test(t))                                         { section = 'credits';      continue; }
        if (section === 'lender_costs' && /^total$/i.test(t)) {
          out.boxA = parseNum(arr[i + 1] || '');
          section = null;
        }
        if (section === 'credits' && /^lender\s*credit$/i.test(t)) {
          out.lenderCredits = Math.abs(parseNum(arr[i + 1] || ''));
        }
      }
    } catch (_) {}
    return out;
  }

  function findCloseButton(dialog) {
    if (!dialog) return null;
    // Walk up to the dialog root to find the close button
    let root = dialog;
    for (let i = 0; i < 6 && root; i++) {
      const cands = root.querySelectorAll('button');
      for (const b of cands) {
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const t = (b.textContent || '').trim();
        if (aria === 'close' || aria === 'dismiss' || t === '×' || t === 'X' || t === '✕') return b;
      }
      root = root.parentElement;
    }
    return null;
  }

  // Returns a Promise resolving to { boxA, lenderCredits } (zeros on failure).
  function extractClosingCostsViaPopup() {
    return new Promise(function (resolve) {
      const btn = findClosingCostsButton();
      if (!btn) { resolve({ boxA: 0, lenderCredits: 0 }); return; }

      // Hide LOP dialogs so the popup doesn't flash on screen. We also pin
      // a 4 s safety timeout so we never leave LOP's UI invisible.
      const style = document.createElement('style');
      style.id = 'zhl-pe-hide-dialog';
      style.textContent =
        '[role="dialog"]:not([id^="zhl-"]), ' +
        '[class*="DialogBody"]:not([id^="zhl-"]), ' +
        '[class*="DialogOverlay"]:not([id^="zhl-"]) { ' +
          'visibility:hidden !important; opacity:0 !important; pointer-events:none !important; ' +
        '}';
      document.head.appendChild(style);
      function unhide() { try { style.remove(); } catch (_) {} }

      try { btn.click(); } catch (_) { unhide(); resolve({ boxA: 0, lenderCredits: 0 }); return; }

      const start = Date.now();
      const poll = setInterval(function () {
        const dialog = Array.from(document.querySelectorAll('[role="dialog"], [class*="DialogBody"]'))
          .find(function (d) { return /lender\s*costs/i.test(d.textContent || ''); });
        if (dialog) {
          clearInterval(poll);
          const values = scrapeClosingCostsDialog(dialog);
          const closeBtn = findCloseButton(dialog);
          if (closeBtn) { try { closeBtn.click(); } catch (_) {} }
          else { try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (_) {} }
          setTimeout(function () { unhide(); resolve(values); }, 50);
          return;
        }
        if (Date.now() - start > 4000) {
          clearInterval(poll);
          unhide();
          resolve({ boxA: 0, lenderCredits: 0 });
        }
      }, 100);
    });
  }

  // Map LOP's "Product name" (e.g. "Conf Home Poss 30 Yr Fixed", "FHA 30 Yr
  // Fixed", "VA 30 Yr ARM 5/6") onto the form's Loan type + FRM/ARM selects.
  function deriveLoanTypeFromProduct(productName) {
    const p = (productName || '').toLowerCase();
    if (!p) return { loanType: 'Conventional', armOrFrm: 'FRM' };
    let loanType = 'Conventional';
    if (/\bfha\b/.test(p))         loanType = 'FHA';
    else if (/\bva\b/.test(p))     loanType = 'VA';
    else if (/\busda\b/.test(p))   loanType = 'USDA';
    else if (/\bjumbo\b/.test(p))  loanType = 'Jumbo';
    else if (/\bconf?\b|\bconv\b|\bconventional\b|home\s*poss|home\s*ready/.test(p)) loanType = 'Conventional';
    const armOrFrm = /\barm\b|\d+\/\d+/.test(p) ? 'ARM'
                    : /\bfixed\b|\bfrm\b/.test(p) ? 'FRM'
                    : 'FRM';
    return { loanType: loanType, armOrFrm: armOrFrm };
  }

  // ---- button injection ---------------------------------------------------
  function findToolbarHost() {
    // Strategy 1: look for the "Paste from staged" button and use its parent.
    const buttons = document.querySelectorAll('button, a');
    for (const b of buttons) {
      const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^Paste from staged$/i.test(t)) return b.parentElement;
      if (/^Stage from this file$/i.test(t)) return b.parentElement;
    }
    // Strategy 2: find "Copy LOP file" text and use its container.
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (el.children.length > 0) continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^Copy LOP file:?$/i.test(t)) return el.parentElement;
    }
    return null;
  }

  function ensureButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const host = findToolbarHost();
    if (!host) return;
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.title = 'Walk through the Pricing Exception submission checklist and generate the RM email.\n\n' + ZHL_TIP;
    btn.style.cssText = [
      'margin-left:10px',
      'padding:6px 12px',
      'background:#fff',
      'color:#b45309',
      'border:1px solid #b45309',
      'border-radius:4px',
      'font:600 12px/1.2 Arial, Helvetica, sans-serif',
      'cursor:pointer',
      'vertical-align:middle'
    ].join(';');
    btn.textContent = '⚖ Pricing Exception Workflow';
    btn.addEventListener('mouseenter', function () { btn.style.background = '#fef3c7'; });
    btn.addEventListener('mouseleave', function () { btn.style.background = '#fff'; });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      openWorkflow();
    });
    host.appendChild(btn);
  }

  // ---- modal --------------------------------------------------------------
  let workflowState = null;

  function defaultState() {
    const names = extractBorrowerNames();
    const details = extractLoanDetails();
    const productMap = deriveLoanTypeFromProduct(details['Product name'] || '');
    return {
      step: 'start',
      history: [],
      locked: null,             // true | false
      borrowerName: names.primary || '',
      coborrowerName: names.coborrower || '',
      loName: '',               // set in openWorkflow() from chrome.storage
      loanId: extractLoanIdFromUrl(),
      loanLink: location.href,
      zgNumber: extractZgNumberFromDom(),
      // unlocked-path comp details — pre-filled from LOP's Loan Details
      // right-rail card when available.
      purchasePrice: parseNum(details['Purchase price']),
      loanAmount:    parseNum(details['Total loan amt.'] || details['Base loan amt.']),
      loanType:      productMap.loanType,
      armOrFrm:      productMap.armOrFrm,
      zhlRate:       parseNum(details['Interest Rate']),
      zhlBoxA:       0,
      zhlCredits:    0,
      compLender:    '',
      compRate:      0,
      compBoxA:      0,
      compCredits:   0,
      peDollars:     0,
      pePoints:      0,
      // big-PE answers
      reason:        '',
      expectations:  '',
      agentRel:      '',
      isOver25:      null,      // true | false (set at points-check)
      rmEmail:       ''
    };
  }

  function openWorkflow() {
    workflowState = defaultState();
    try {
      chrome.storage.local.get([STORAGE_KEY_RM, 'lo_name', '_zhl_tlm_user'], function (data) {
        workflowState.rmEmail = (data && data[STORAGE_KEY_RM]) || '';
        // LO name: prefer the explicit setup-page setting, fall back to
        // the Salesforce-captured identity name.
        const fromSetup = (data && data.lo_name) || '';
        const fromTlm   = (data && data._zhl_tlm_user && data._zhl_tlm_user.name) || '';
        workflowState.loName = fromSetup || fromTlm || '';
        renderModal();
      });
    } catch (_) { renderModal(); }
  }

  function closeModal() {
    const m = document.getElementById(MODAL_ID);
    if (m) m.remove();
  }

  function renderModal() {
    closeModal();
    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
      'background:rgba(0,0,0,0.45)',
      'z-index:2147483647',
      'display:flex', 'align-items:center', 'justify-content:center',
      'font:14px/1.4 Arial, Helvetica, sans-serif'
    ].join(';');
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });

    const panel = document.createElement('div');
    panel.style.cssText = [
      'background:#fff',
      'border-radius:8px',
      'padding:20px 24px',
      'max-width:640px',
      'width:94%',
      'max-height:92vh',
      'overflow:auto',
      'box-shadow:0 14px 44px rgba(0,0,0,0.32)'
    ].join(';');

    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">' +
        '<h3 style="margin:0;font-size:18px;color:#b45309;">⚖ Pricing Exception Workflow</h3>' +
        '<button id="zhl-pe-close" style="background:none;border:none;font-size:24px;color:#6b7280;cursor:pointer;line-height:1;padding:0 4px;margin-top:-4px;">×</button>' +
      '</div>' +
      '<div id="zhl-pe-body"></div>' +
      '<div style="margin-top:16px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid #e5e7eb;padding-top:12px;">' +
        '<button id="zhl-pe-back" type="button" style="background:#fff;color:#6b7280;border:1px solid #d1d5db;border-radius:4px;padding:6px 12px;font-size:12px;cursor:pointer;">← Back</button>' +
        '<span style="color:#6b7280;font-size:11px;font-style:italic;">' + ZHL_TIP + '</span>' +
      '</div>';

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    panel.querySelector('#zhl-pe-close').addEventListener('click', closeModal);
    panel.querySelector('#zhl-pe-back').addEventListener('click', goBack);
    renderStep();
  }

  function renderStep() {
    const body = document.getElementById('zhl-pe-body');
    const backBtn = document.getElementById('zhl-pe-back');
    if (!body) return;
    backBtn.style.visibility = workflowState.history.length > 0 ? 'visible' : 'hidden';
    const renderer = STEPS[workflowState.step];
    if (!renderer) {
      body.innerHTML = '<p style="color:#b91c1c;">Unknown step: ' + escapeHtml(workflowState.step) + '</p>';
      return;
    }
    renderer(body);
  }

  function goTo(step) {
    workflowState.history.push(workflowState.step);
    workflowState.step = step;
    renderStep();
  }
  function goBack() {
    if (workflowState.history.length === 0) return;
    workflowState.step = workflowState.history.pop();
    renderStep();
  }

  // ---- step renderers -----------------------------------------------------
  function btnPrimary(label, id) {
    return '<button type="button" id="' + id + '" style="background:#0b5cab;color:#fff;border:1px solid #0b5cab;border-radius:4px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;margin-right:8px;">' + escapeHtml(label) + '</button>';
  }
  function btnSecondary(label, id) {
    return '<button type="button" id="' + id + '" style="background:#fff;color:#374151;border:1px solid #d1d5db;border-radius:4px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;margin-right:8px;">' + escapeHtml(label) + '</button>';
  }
  function htmlChoice(title, yesLabel, noLabel) {
    return '<h4 style="margin:0 0 16px;font-size:15px;color:#111827;">' + escapeHtml(title) + '</h4>' +
      '<div style="display:flex;gap:8px;">' +
        btnPrimary(yesLabel, 'zhl-pe-yes') +
        btnSecondary(noLabel, 'zhl-pe-no') +
      '</div>';
  }
  function htmlBlocker(title, helpText) {
    return '<h4 style="margin:0 0 8px;font-size:15px;color:#111827;">' + escapeHtml(title) + '</h4>' +
      '<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:6px;padding:10px 12px;color:#78350f;font-size:13px;margin:10px 0;">' +
        '<strong>Action needed:</strong> ' + escapeHtml(helpText) +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
        btnPrimary('I\'ve done it — continue', 'zhl-pe-done') +
        btnSecondary('Close — I\'ll do this first', 'zhl-pe-cancel') +
      '</div>';
  }
  function makeCheckStep(question, blockerHelpIfNo, nextStep) {
    return function (body) {
      body.innerHTML = htmlChoice(question, 'Yes', 'Not yet');
      body.querySelector('#zhl-pe-yes').addEventListener('click', function () { goTo(nextStep); });
      body.querySelector('#zhl-pe-no').addEventListener('click', function () {
        body.innerHTML = htmlBlocker(question, blockerHelpIfNo);
        body.querySelector('#zhl-pe-done').addEventListener('click', function () { goTo(nextStep); });
        body.querySelector('#zhl-pe-cancel').addEventListener('click', closeModal);
      });
    };
  }

  const STEPS = {
    // --------- Q1: locked? ----------------------------------------------
    'start': function (body) {
      body.innerHTML =
        '<h4 style="margin:0 0 12px;font-size:15px;color:#111827;">Is this loan currently locked?</h4>' +
        '<p style="margin:0 0 16px;color:#6b7280;font-size:12px;">The required workflow differs depending on whether the loan is locked. Pick the matching path.</p>' +
        '<div style="display:flex;gap:8px;">' +
          btnPrimary('Yes — locked', 'zhl-pe-yes') +
          btnSecondary('No — not locked', 'zhl-pe-no') +
        '</div>';
      body.querySelector('#zhl-pe-yes').addEventListener('click', function () {
        workflowState.locked = true; goTo('L-import-pricing');
      });
      body.querySelector('#zhl-pe-no').addEventListener('click', function () {
        workflowState.locked = false; goTo('U-assigned-scenario');
      });
    },

    // --------- LOCKED PATH ----------------------------------------------
    'L-import-pricing': makeCheckStep(
      'Have you imported current pricing?',
      'Import current pricing in Encompass before submitting the PE request.',
      'L-comp-pe-fields'
    ),
    'L-comp-pe-fields': makeCheckStep(
      'Have you completed the required Comp PE fields in ENC Lock / Pricing Screen?',
      'Fill in the Comp PE fields on the ENC Lock / Pricing Screen (comp rate, comp credits, etc.).',
      'L-lock-alert'
    ),
    'L-lock-alert': makeCheckStep(
      'Have you confirmed there is NO lock-difference alert?',
      'Resolve any lock-difference alert before submitting. If it persists, contact lock desk.',
      'L-comp-le'
    ),
    'L-comp-le': makeCheckStep(
      'Have you uploaded the Comp LE to the eFolder?',
      'Upload the competitor LE to the loan\'s eFolder so the RM and lock desk can review it.',
      'points-check'
    ),

    // --------- UNLOCKED PATH -------------------------------------------
    'U-assigned-scenario': makeCheckStep(
      'Have you assigned an updated scenario / pricing?',
      'Assign the borrower\'s scenario / pricing in Pricing & Scenarios before requesting a PE.',
      'U-comp-le-tasks'
    ),
    'U-comp-le-tasks': makeCheckStep(
      'Have you uploaded the Comp LE to Tasks?',
      'Upload the competitor LE to the Tasks tab so the RM can pull it.',
      'U-enter-pricing'
    ),
    'U-enter-pricing': function (body) {
      const inputStyle = 'padding:6px 8px;border:1px solid #d1d5db;border-radius:4px;font:13px Arial,sans-serif;width:100%;box-sizing:border-box;';
      const labelStyle = 'display:block;font-size:11px;color:#6b7280;margin-bottom:2px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;';
      const fieldWrap = 'margin-bottom:10px;';
      function field(name, label, value, type) {
        return '<div style="' + fieldWrap + '"><label style="' + labelStyle + '">' + label + '</label>' +
          '<input id="' + name + '" type="text" ' + (type === 'select' ? '' : 'inputmode="decimal" ') +
          'value="' + escapeHtml(value) + '" style="' + inputStyle + '" /></div>';
      }
      function select(name, label, value, opts) {
        const options = opts.map(function (o) {
          return '<option value="' + escapeHtml(o) + '"' + (o === value ? ' selected' : '') + '>' + escapeHtml(o) + '</option>';
        }).join('');
        return '<div style="' + fieldWrap + '"><label style="' + labelStyle + '">' + label + '</label>' +
          '<select id="' + name + '" style="' + inputStyle + '">' + options + '</select></div>';
      }
      const s = workflowState;
      const autofilled = s.purchasePrice > 0 || s.loanAmount > 0 || s.zhlRate > 0;
      body.innerHTML =
        '<h4 style="margin:0 0 8px;font-size:15px;color:#111827;">Enter ZHL + competitor pricing</h4>' +
        '<p style="margin:0 0 14px;color:#6b7280;font-size:12px;">' +
          (autofilled ? '<span style="color:#15803d;font-weight:600;">✓ Auto-filled from LOP&rsquo;s Loan Details card</span> — verify and complete the Box A / lender-credits fields. ' : '') +
          'Net cost = Box A charges − Lender credits. PE $ = (ZHL net cost − Comp net cost).' +
        '</p>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">' +
          '<div>' + field('pe-purchase', 'Purchase price', s.purchasePrice || '') + field('pe-loan-amt', 'Loan amount', s.loanAmount || '') + '</div>' +
          '<div>' + select('pe-loan-type', 'Loan type', s.loanType, ['Conventional','FHA','VA','USDA','Jumbo']) +
                   select('pe-arm', 'FRM / ARM', s.armOrFrm, ['FRM','ARM']) + '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:8px;">' +
          '<div style="background:#f0f7ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px;">' +
            '<div style="font-weight:700;color:#0b5cab;margin-bottom:6px;font-size:12px;">ZHL pricing</div>' +
            field('pe-zhl-rate',    'Interest rate %',         s.zhlRate    || '') +
            field('pe-zhl-boxa',    'Total Box A charges ($)', s.zhlBoxA    || '') +
            field('pe-zhl-credits', 'Lender + other credits ($)', s.zhlCredits || '') +
          '</div>' +
          '<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:6px;padding:10px;">' +
            '<div style="font-weight:700;color:#b45309;margin-bottom:6px;font-size:12px;">Competitor</div>' +
            '<div style="' + fieldWrap + '"><label style="' + labelStyle + '">Competitor lender name</label>' +
              '<input id="pe-comp-lender" type="text" value="' + escapeHtml(s.compLender || '') +
              '" placeholder="e.g. Rocket, Better.com, local CU" style="' + inputStyle + '" /></div>' +
            field('pe-comp-rate',    'Interest rate %',         s.compRate    || '') +
            field('pe-comp-boxa',    'Total Box A charges ($)', s.compBoxA    || '') +
            field('pe-comp-credits', 'Lender + other credits ($)', s.compCredits || '') +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:14px;">' +
          btnPrimary('Calculate PE', 'zhl-pe-calc') +
        '</div>';

      body.querySelector('#zhl-pe-calc').addEventListener('click', function () {
        const s = workflowState;
        s.purchasePrice = parseNum(body.querySelector('#pe-purchase').value);
        s.loanAmount    = parseNum(body.querySelector('#pe-loan-amt').value);
        s.loanType      = body.querySelector('#pe-loan-type').value;
        s.armOrFrm      = body.querySelector('#pe-arm').value;
        s.zhlRate       = parseNum(body.querySelector('#pe-zhl-rate').value);
        s.zhlBoxA       = parseNum(body.querySelector('#pe-zhl-boxa').value);
        s.zhlCredits    = parseNum(body.querySelector('#pe-zhl-credits').value);
        s.compLender    = (body.querySelector('#pe-comp-lender').value || '').trim();
        s.compRate      = parseNum(body.querySelector('#pe-comp-rate').value);
        s.compBoxA      = parseNum(body.querySelector('#pe-comp-boxa').value);
        s.compCredits   = parseNum(body.querySelector('#pe-comp-credits').value);
        const zhlNet  = s.zhlBoxA  - s.zhlCredits;
        const compNet = s.compBoxA - s.compCredits;
        s.peDollars = zhlNet - compNet;
        s.pePoints  = s.loanAmount > 0 ? (s.peDollars / s.loanAmount) * 100 : 0;
        goTo('U-pe-result');
      });

      // Auto-fill ZHL Box A + lender credits from LOP's "Total closing
      // costs" popup if they're still empty. Opens/closes the popup
      // invisibly via injected CSS so the LO doesn't see a flash.
      if (!s.zhlBoxA && !s.zhlCredits) {
        const boxaInput = body.querySelector('#pe-zhl-boxa');
        const credInput = body.querySelector('#pe-zhl-credits');
        if (boxaInput && credInput) {
          boxaInput.placeholder    = 'Auto-filling from LOP…';
          credInput.placeholder    = 'Auto-filling from LOP…';
          extractClosingCostsViaPopup().then(function (vals) {
            if (vals && vals.boxA > 0) {
              s.zhlBoxA = vals.boxA;
              boxaInput.value = String(vals.boxA);
            } else {
              boxaInput.placeholder = '';
            }
            if (vals && (vals.lenderCredits || vals.lenderCredits === 0)) {
              s.zhlCredits = vals.lenderCredits;
              credInput.value = vals.lenderCredits > 0 ? String(vals.lenderCredits) : '';
            } else {
              credInput.placeholder = '';
            }
          }).catch(function () {
            boxaInput.placeholder = '';
            credInput.placeholder = '';
          });
        }
      }
    },
    'U-pe-result': function (body) {
      const s = workflowState;
      const isPositive = s.peDollars > 0;
      body.innerHTML =
        '<h4 style="margin:0 0 12px;font-size:15px;color:#111827;">PE amount calculation</h4>' +
        '<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:14px;margin-bottom:14px;">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;color:#374151;">' +
            '<div>ZHL net cost (Box A − credits):</div><div style="text-align:right;">' + formatMoney(s.zhlBoxA - s.zhlCredits) + '</div>' +
            '<div>Comp net cost (Box A − credits):</div><div style="text-align:right;">' + formatMoney(s.compBoxA - s.compCredits) + '</div>' +
            '<div style="border-top:1px solid #d1d5db;padding-top:6px;margin-top:4px;font-weight:700;color:#b45309;">PE $ needed (ZHL − Comp):</div>' +
            '<div style="border-top:1px solid #d1d5db;padding-top:6px;margin-top:4px;text-align:right;font-weight:700;color:' + (isPositive ? '#b91c1c' : '#15803d') + ';">' + formatMoney(s.peDollars) + '</div>' +
            '<div style="font-weight:700;color:#b45309;">PE in points (PE $ / loan amount):</div>' +
            '<div style="text-align:right;font-weight:700;color:' + (isPositive ? '#b91c1c' : '#15803d') + ';">' + formatPctDisplay(s.pePoints) + '</div>' +
          '</div>' +
        '</div>' +
        (s.peDollars <= 0
          ? '<div style="background:#dcfce7;border:1px solid #86efac;border-radius:6px;padding:10px;color:#14532d;font-size:12px;margin-bottom:14px;">PE calc came back ≤ $0 — ZHL is already at or beating the competitor on net cost. No PE needed unless the rate gap justifies it separately.</div>'
          : '') +
        '<div style="display:flex;gap:8px;">' +
          btnPrimary('Continue', 'zhl-pe-continue') +
          btnSecondary('Edit numbers', 'zhl-pe-edit') +
        '</div>';
      body.querySelector('#zhl-pe-continue').addEventListener('click', function () { goTo('points-check'); });
      body.querySelector('#zhl-pe-edit').addEventListener('click', goBack);
    },

    // --------- shared: < 2.5 pts? ---------------------------------------
    'points-check': function (body) {
      const s = workflowState;
      const shown = s.locked === false ? formatPctDisplay(s.pePoints) : '';
      body.innerHTML =
        '<h4 style="margin:0 0 12px;font-size:15px;color:#111827;">Is your PE request under 2.5 points?</h4>' +
        (shown
          ? '<p style="margin:0 0 16px;color:#374151;font-size:13px;">From the calculation: <strong>' + shown + '</strong>.</p>'
          : '<p style="margin:0 0 16px;color:#6b7280;font-size:12px;">If you don\'t know, check the PE points field on the ENC Lock screen.</p>'
        ) +
        '<div style="display:flex;gap:8px;">' +
          btnPrimary('Yes — under 2.5', 'zhl-pe-under') +
          btnSecondary('No — 2.5 or over', 'zhl-pe-over') +
        '</div>';
      body.querySelector('#zhl-pe-under').addEventListener('click', function () {
        s.isOver25 = false; goTo('email');
      });
      body.querySelector('#zhl-pe-over').addEventListener('click', function () {
        s.isOver25 = true; goTo('big-pe-questions');
      });
    },

    'big-pe-questions': function (body) {
      const s = workflowState;
      const ta = 'padding:8px 10px;border:1px solid #d1d5db;border-radius:4px;font:13px Arial,sans-serif;width:100%;box-sizing:border-box;min-height:60px;resize:vertical;';
      const label = 'display:block;font-size:12px;color:#374151;font-weight:600;margin-bottom:4px;';
      const wrap  = 'margin-bottom:12px;';
      const brName = (s.borrowerName || 'the borrower').trim();
      body.innerHTML =
        '<h4 style="margin:0 0 6px;font-size:15px;color:#111827;">PE > 2.5 points — additional justification required</h4>' +
        '<p style="margin:0 0 14px;color:#6b7280;font-size:12px;">Your manager wants these three answers included in the PE email.</p>' +
        '<div style="' + wrap + '"><label style="' + label + '">1. What is the main reason for needing this PE? Please be specific.</label>' +
          '<textarea id="pe-reason" style="' + ta + '">' + escapeHtml(s.reason) + '</textarea></div>' +
        '<div style="' + wrap + '"><label style="' + label + '">2. Have we set proper expectations with ' + escapeHtml(brName) + ' that any further price exceptions, including rate extensions, will be at their expense?</label>' +
          '<textarea id="pe-expectations" style="' + ta + '" placeholder="Yes — they understand additional PEs / extensions are at their cost. (or no, with detail)">' + escapeHtml(s.expectations) + '</textarea></div>' +
        '<div style="' + wrap + '"><label style="' + label + '">3. What is the relationship with the agent / partner?</label>' +
          '<textarea id="pe-agent" style="' + ta + '">' + escapeHtml(s.agentRel) + '</textarea></div>' +
        '<div style="display:flex;gap:8px;">' + btnPrimary('Generate email', 'zhl-pe-build-email') + '</div>';
      body.querySelector('#zhl-pe-build-email').addEventListener('click', function () {
        s.reason       = body.querySelector('#pe-reason').value.trim();
        s.expectations = body.querySelector('#pe-expectations').value.trim();
        s.agentRel     = body.querySelector('#pe-agent').value.trim();
        goTo('email');
      });
    },

    'email': function (body) {
      const s = workflowState;
      const email = buildEmail(s);

      // Optional: editable ZG# + borrower name + RM email row before output
      const fieldStyle = 'padding:5px 8px;border:1px solid #d1d5db;border-radius:4px;font:12px Arial,sans-serif;width:100%;box-sizing:border-box;';
      body.innerHTML =
        '<h4 style="margin:0 0 12px;font-size:15px;color:#111827;">Email to RM</h4>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">' +
          '<div><label style="display:block;font-size:11px;color:#6b7280;font-weight:600;margin-bottom:2px;">RM email</label>' +
            '<input id="pe-rm-email" type="email" value="' + escapeHtml(s.rmEmail) + '" placeholder="rm@zillowhomeloans.com" style="' + fieldStyle + '" /></div>' +
          '<div><label style="display:block;font-size:11px;color:#6b7280;font-weight:600;margin-bottom:2px;">ZG # (Encompass loan #)</label>' +
            '<input id="pe-zg-number" type="text" value="' + escapeHtml(s.zgNumber) + '" placeholder="ZGxxxxxxxx" style="' + fieldStyle + '" /></div>' +
        '</div>' +
        '<label style="display:block;font-size:11px;color:#6b7280;font-weight:600;margin-bottom:2px;">Subject</label>' +
        '<input id="pe-subject" type="text" value="' + escapeHtml(email.subject) + '" style="' + fieldStyle + 'margin-bottom:10px;" />' +
        '<label style="display:block;font-size:11px;color:#6b7280;font-weight:600;margin-bottom:2px;">Body</label>' +
        '<textarea id="pe-body" style="' + fieldStyle + 'min-height:280px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;">' + escapeHtml(email.body) + '</textarea>' +
        '<p style="margin:8px 0 0;color:#6b7280;font-size:11px;font-style:italic;">Tip: <strong>Open in Gmail</strong> opens a new Gmail compose tab with To + Subject filled in AND copies the formatted email to your clipboard — paste with <kbd>Ctrl</kbd>+<kbd>V</kbd> in the body field to drop the formatted table / headers / hyperlinks in. Attachments still need to be added manually. RM email is auto-saved for next time.</p>' +
        '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">' +
          btnPrimary('Open in Gmail + copy body', 'zhl-pe-mailto') +
          btnSecondary('Copy body only', 'zhl-pe-copy-body') +
          btnSecondary('Copy subject only', 'zhl-pe-copy-subj') +
        '</div>';

      // wire
      function read() {
        s.rmEmail   = body.querySelector('#pe-rm-email').value.trim();
        s.zgNumber  = body.querySelector('#pe-zg-number').value.trim();
        return {
          to: s.rmEmail,
          subject: body.querySelector('#pe-subject').value,
          body: body.querySelector('#pe-body').value
        };
      }
      // Re-render subject when ZG# changes (only if user hasn't manually edited the subject)
      let subjectAuto = true;
      body.querySelector('#pe-zg-number').addEventListener('input', function () {
        s.zgNumber = body.querySelector('#pe-zg-number').value.trim();
        if (subjectAuto) {
          const rebuilt = buildEmail(s);
          body.querySelector('#pe-subject').value = rebuilt.subject;
        }
      });
      body.querySelector('#pe-subject').addEventListener('input', function () { subjectAuto = false; });

      // Auto-save the RM email whenever the field loses focus, so once
      // the LO types it they never have to type it again.
      function persistRmEmail() {
        const v = (body.querySelector('#pe-rm-email').value || '').trim();
        if (!v) return;
        try { chrome.storage.local.set({ [STORAGE_KEY_RM]: v }); } catch (_) {}
      }
      body.querySelector('#pe-rm-email').addEventListener('blur', persistRmEmail);

      body.querySelector('#zhl-pe-mailto').addEventListener('click', function () {
        read();
        persistRmEmail();
        // Open Gmail with To + Subject but EMPTY body — Gmail's compose
        // URL only carries plain text in &body=, which loses our formatted
        // table / headers / hyperlinks. So we ALSO put the formatted HTML
        // (plus plain-text fallback) on the clipboard, and the LO does a
        // single Ctrl+V in Gmail's body field to get the nice version.
        const rebuilt = buildEmail(workflowState);
        const plain   = body.querySelector('#pe-body').value;
        const e       = read();
        copyHtmlAndPlain(this, rebuilt.html, plain, function () {
          const url = 'https://mail.google.com/mail/?view=cm&fs=1' +
            '&to=' + encodeURIComponent(e.to) +
            '&su=' + encodeURIComponent(e.subject);
          try { window.open(url, '_blank'); }
          catch (_) { window.location.href = url; }
        });
      });
      body.querySelector('#zhl-pe-copy-body').addEventListener('click', function () {
        read();
        persistRmEmail();
        const rebuilt = buildEmail(workflowState);
        const plain   = body.querySelector('#pe-body').value;
        copyHtmlAndPlain(this, rebuilt.html, plain);
      });
      body.querySelector('#zhl-pe-copy-subj').addEventListener('click', function () {
        const e = read();
        persistRmEmail();
        flashCopy(this, e.subject);
      });
    }
  };

  function flashCopy(btn, text) {
    try {
      navigator.clipboard.writeText(text).then(
        function () { flashLabel(btn, '✓ Copied'); },
        function () { flashLabel(btn, '✗ Failed'); }
      );
    } catch (_) {
      flashLabel(btn, '✗ Failed');
    }
  }
  // Put BOTH text/html and text/plain on the clipboard so a paste into
  // Gmail's body field (which accepts HTML) renders the formatted table,
  // while a paste into a plain-text target still gets the plain version.
  // Optional onDone callback fires after the write completes (or fails) so
  // the caller can chain a window.open() that needs to happen after.
  function copyHtmlAndPlain(btn, html, plain, onDone) {
    function done(ok, msg) {
      flashLabel(btn, msg);
      if (typeof onDone === 'function') onDone(ok);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
        const item = new ClipboardItem({
          'text/html':  new Blob([html],  { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' })
        });
        navigator.clipboard.write([item]).then(
          function () { done(true, '✓ Copied (formatted)'); },
          function () {
            navigator.clipboard.writeText(plain).then(
              function () { done(true, '✓ Copied (plain)'); },
              function () { done(false, '✗ Copy failed'); }
            );
          }
        );
        return;
      }
    } catch (_) {}
    try {
      navigator.clipboard.writeText(plain).then(
        function () { done(true, '✓ Copied'); },
        function () { done(false, '✗ Failed'); }
      );
    } catch (_) { done(false, '✗ Failed'); }
  }
  function flashLabel(btn, msg) {
    const orig = btn.textContent;
    btn.textContent = msg;
    setTimeout(function () { btn.textContent = orig; }, 1500);
  }

  // ---- email template -----------------------------------------------------
  function borrowerLabel(s) {
    const p = (s.borrowerName || '').trim();
    const c = (s.coborrowerName || '').trim();
    if (p && c) return p + ' & ' + c;
    return p || 'the borrower';
  }
  function loLabel(s) { return (s.loName || '').trim() || '(your name)'; }
  function loanIdForEmail(s) { return (s.zgNumber || s.loanId || '(loan id)').trim(); }
  function sizeLabel(s) { return s.isOver25 ? '2.5 points or over' : 'under 2.5 points'; }
  function compLabel(s)     { return (s.compLender || '').trim() || 'Competitor'; }

  // Build a complete email — returns { subject, body, html }.
  // body  = plain text (used by Open-in-Gmail compose URL, and as the
  //         text/plain on the clipboard)
  // html  = formatted version (used as text/html on the clipboard so Gmail's
  //         body field renders tables / bold / hyperlinks correctly)
  function buildEmail(s) {
    const id = loanIdForEmail(s);
    const heading = 'PE request for ' + borrowerLabel(s) + ' by ' + loLabel(s);
    if (s.locked === true) {
      return buildEmailLocked(s, id, heading);
    }
    return buildEmailUnlocked(s, id, heading);
  }

  function buildEmailLocked(s, id, heading) {
    // ----- plain text -----
    const lines = [
      'Hi,',
      '',
      heading,
      '',
      'Loan: ' + id,
      'LOP link: ' + s.loanLink,
      '',
      id + ' is ready for PE request.',
      '',
      'Pre-submission checklist (all complete):',
      '  ✓ Current pricing imported',
      '  ✓ Comp PE fields completed in ENC Lock / Pricing Screen',
      '  ✓ No lock-difference alert',
      '  ✓ Comp LE uploaded to eFolder',
      '',
      'PE request size: ' + sizeLabel(s),
      ''
    ];
    if (s.isOver25) lines.push.apply(lines, big25SectionPlain(s));
    lines.push('Thanks.');
    // ----- html -----
    const html = wrapHtml(
      htmlHeader(heading, id, s.loanLink) +
      '<p style="margin:14px 0 8px;">' + escapeHtml(id) + ' is ready for PE request.</p>' +
      '<p style="margin:14px 0 6px;font-weight:600;color:' + COLORS.accent + ';">Pre-submission checklist (all complete):</p>' +
      '<ul style="margin:0 0 14px;padding-left:22px;line-height:1.7;">' +
        '<li>Current pricing imported</li>' +
        '<li>Comp PE fields completed in ENC Lock / Pricing Screen</li>' +
        '<li>No lock-difference alert</li>' +
        '<li>Comp LE uploaded to eFolder</li>' +
      '</ul>' +
      '<p style="margin:14px 0;"><strong>PE request size:</strong> ' + escapeHtml(sizeLabel(s)) + '</p>' +
      (s.isOver25 ? big25SectionHtml(s) : '') +
      '<p style="margin-top:18px;">Thanks.</p>'
    );
    return {
      subject: 'PE Request for ' + borrowerLabel(s) + ' (' + id + ')' + (s.isOver25 ? ' — >2.5 pts' : ''),
      body: lines.join('\n'),
      html: html
    };
  }

  function buildEmailUnlocked(s, id, heading) {
    const zhlNet  = s.zhlBoxA  - s.zhlCredits;
    const compNet = s.compBoxA - s.compCredits;
    // ----- plain text -----
    const lines = [
      'Hi,',
      '',
      heading,
      '',
      'Loan: ' + id,
      'LOP link: ' + s.loanLink,
      '',
      'Loan scenario:',
      '  Purchase price:     ' + formatMoney(s.purchasePrice),
      '  Loan amount:        ' + formatMoney(s.loanAmount),
      '  Loan type:          ' + s.loanType + ' (' + s.armOrFrm + ')',
      '',
      'ZHL pricing:',
      '  Interest rate:      ' + formatPctDisplay(s.zhlRate),
      '  Total Box A:        ' + formatMoney(s.zhlBoxA),
      '  Lender credits:     ' + formatMoney(s.zhlCredits),
      '  Net cost (A − cr.): ' + formatMoney(zhlNet),
      '',
      'Competitor pricing (' + compLabel(s) + '):',
      '  Interest rate:      ' + formatPctDisplay(s.compRate),
      '  Total Box A:        ' + formatMoney(s.compBoxA),
      '  Lender credits:     ' + formatMoney(s.compCredits),
      '  Net cost (A − cr.): ' + formatMoney(compNet),
      '',
      'PE amount requested: ' + formatMoney(s.peDollars) + '  (' + formatPctDisplay(s.pePoints) + ')',
      'PE request size:     ' + sizeLabel(s),
      ''
    ];
    if (s.isOver25) lines.push.apply(lines, big25SectionPlain(s));
    lines.push('Attached: ZHL pricing summary, comp pricing summary, comp LE.');
    lines.push('');
    lines.push('Thanks.');
    // ----- html -----
    const html = wrapHtml(
      htmlHeader(heading, id, s.loanLink) +
      htmlSectionHeading('Loan scenario') +
      htmlKvTable([
        ['Purchase price', formatMoney(s.purchasePrice)],
        ['Loan amount',    formatMoney(s.loanAmount)],
        ['Loan type',      escapeHtml(s.loanType) + ' (' + escapeHtml(s.armOrFrm) + ')']
      ]) +
      htmlSectionHeading('Pricing comparison') +
      htmlComparisonTable(s, zhlNet, compNet) +
      '<p style="margin:16px 0;font-size:15px;line-height:1.6;">' +
        '<strong>PE amount requested:</strong> ' + escapeHtml(formatMoney(s.peDollars)) +
        ' <span style="color:#6b7280;">(' + escapeHtml(formatPctDisplay(s.pePoints)) + ')</span><br>' +
        '<strong>PE request size:</strong> ' + escapeHtml(sizeLabel(s)) +
      '</p>' +
      (s.isOver25 ? big25SectionHtml(s) : '') +
      '<p style="margin:18px 0 0;color:#6b7280;font-size:12px;font-style:italic;">Attached: ZHL pricing summary, comp pricing summary, comp LE.</p>' +
      '<p style="margin-top:14px;">Thanks.</p>'
    );
    const compForSubject = (s.compLender || '').trim() ? ' vs ' + (s.compLender || '').trim() : '';
    return {
      subject: 'PE Request for ' + borrowerLabel(s) + ' (' + id + ')' + compForSubject + (s.isOver25 ? ' — >2.5 pts' : ''),
      body: lines.join('\n'),
      html: html
    };
  }

  function big25SectionPlain(s) {
    const brName = (s.borrowerName || 'the borrower').trim();
    return [
      'Justification (PE > 2.5 pts):',
      '',
      '  1) Main reason for PE:',
      '     ' + (s.reason || '(not provided)'),
      '',
      '  2) Expectations set with ' + brName + ' that further PEs / rate extensions are at their cost:',
      '     ' + (s.expectations || '(not provided)'),
      '',
      '  3) Relationship with agent / partner:',
      '     ' + (s.agentRel || '(not provided)'),
      ''
    ];
  }
  function big25SectionHtml(s) {
    const brName = (s.borrowerName || 'the borrower').trim();
    return htmlSectionHeading('Justification (PE > 2.5 pts)') +
      '<ol style="margin:0 0 14px;padding-left:22px;line-height:1.6;">' +
        '<li style="margin-bottom:10px;">' +
          '<strong>Main reason for PE:</strong><br>' +
          '<span style="color:#374151;">' + escapeHtml(s.reason || '(not provided)') + '</span>' +
        '</li>' +
        '<li style="margin-bottom:10px;">' +
          '<strong>Expectations set with ' + escapeHtml(brName) + ' that further PEs / rate extensions are at their cost:</strong><br>' +
          '<span style="color:#374151;">' + escapeHtml(s.expectations || '(not provided)') + '</span>' +
        '</li>' +
        '<li style="margin-bottom:10px;">' +
          '<strong>Relationship with agent / partner:</strong><br>' +
          '<span style="color:#374151;">' + escapeHtml(s.agentRel || '(not provided)') + '</span>' +
        '</li>' +
      '</ol>';
  }

  // ---- HTML email helpers -------------------------------------------------
  const COLORS = { accent: '#b45309', zhl: '#0b5cab', comp: '#b45309', muted: '#6b7280', divider: '#fde68a' };
  function wrapHtml(inner) {
    return '<div style="font:14px Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.5;">' +
      '<p style="margin:0 0 10px;">Hi,</p>' +
      inner +
    '</div>';
  }
  function htmlHeader(heading, id, link) {
    return '<p style="margin:0 0 4px;font-size:15px;"><strong>' + escapeHtml(heading) + '</strong></p>' +
      '<p style="margin:0 0 14px;color:' + COLORS.muted + ';font-size:13px;">' +
        'Loan: ' + escapeHtml(id) + '<br>' +
        'LOP link: <a href="' + escapeHtml(link) + '" style="color:' + COLORS.zhl + ';">' + escapeHtml(link) + '</a>' +
      '</p>';
  }
  function htmlSectionHeading(title) {
    return '<h3 style="margin:18px 0 8px;font-size:14px;color:' + COLORS.accent + ';' +
      'border-bottom:2px solid ' + COLORS.divider + ';padding-bottom:4px;">' + escapeHtml(title) + '</h3>';
  }
  function htmlKvTable(rows) {
    return '<table style="border-collapse:collapse;margin-top:6px;">' +
      rows.map(function (r) {
        return '<tr>' +
          '<td style="padding:3px 16px 3px 0;color:' + COLORS.muted + ';">' + escapeHtml(r[0]) + '</td>' +
          '<td style="padding:3px 0;font-weight:600;">' + r[1] + '</td>' +
        '</tr>';
      }).join('') +
    '</table>';
  }
  function htmlComparisonTable(s, zhlNet, compNet) {
    const th = 'padding:6px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;';
    const td = 'padding:5px 12px;';
    const numericRight = 'text-align:right;';
    function row(label, zhl, comp) {
      return '<tr>' +
        '<td style="' + td + 'color:' + COLORS.muted + ';">' + escapeHtml(label) + '</td>' +
        '<td style="' + td + numericRight + '">' + escapeHtml(zhl) + '</td>' +
        '<td style="' + td + numericRight + '">' + escapeHtml(comp) + '</td>' +
      '</tr>';
    }
    return '<table style="border-collapse:collapse;border:1px solid #e5e7eb;margin-top:8px;">' +
      '<thead><tr style="background:#f9fafb;">' +
        '<th style="' + th + 'text-align:left;">&nbsp;</th>' +
        '<th style="' + th + numericRight + 'color:' + COLORS.zhl + ';">ZHL</th>' +
        '<th style="' + th + numericRight + 'color:' + COLORS.comp + ';">' + escapeHtml(compLabel(s)) + '</th>' +
      '</tr></thead>' +
      '<tbody>' +
        row('Interest rate',  formatPctDisplay(s.zhlRate),    formatPctDisplay(s.compRate)) +
        row('Total Box A',    formatMoney(s.zhlBoxA),         formatMoney(s.compBoxA)) +
        row('Lender credits', formatMoney(s.zhlCredits),      formatMoney(s.compCredits)) +
        '<tr style="background:#f9fafb;font-weight:700;">' +
          '<td style="' + td + 'border-top:1px solid #e5e7eb;">Net cost</td>' +
          '<td style="' + td + numericRight + 'border-top:1px solid #e5e7eb;color:' + COLORS.zhl + ';">' + escapeHtml(formatMoney(zhlNet)) + '</td>' +
          '<td style="' + td + numericRight + 'border-top:1px solid #e5e7eb;color:' + COLORS.comp + ';">' + escapeHtml(formatMoney(compNet)) + '</td>' +
        '</tr>' +
      '</tbody>' +
    '</table>';
  }

  // ---- scan loop ----------------------------------------------------------
  function scan() {
    try { ensureButton(); } catch (_) {}
  }
  const observer = new MutationObserver(function () { scan(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();
  setInterval(scan, 1500);
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
