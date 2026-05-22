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
    return {
      step: 'start',
      history: [],
      locked: null,             // true | false
      borrowerName: names.primary || '',
      coborrowerName: names.coborrower || '',
      loanId: extractLoanIdFromUrl(),
      loanLink: location.href,
      zgNumber: '',
      // unlocked-path comp details
      purchasePrice: 0,
      loanAmount:    0,
      loanType:      'Conventional',
      armOrFrm:      'FRM',
      zhlRate:       0,
      zhlBoxA:       0,
      zhlCredits:    0,
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
      chrome.storage.local.get([STORAGE_KEY_RM], function (data) {
        workflowState.rmEmail = (data && data[STORAGE_KEY_RM]) || '';
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
      body.innerHTML =
        '<h4 style="margin:0 0 8px;font-size:15px;color:#111827;">Enter ZHL + competitor pricing</h4>' +
        '<p style="margin:0 0 14px;color:#6b7280;font-size:12px;">Used to compute the PE amount. Net cost = Box A charges − Lender credits. PE $ = (ZHL net cost − Comp net cost).</p>' +
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
        s.compRate      = parseNum(body.querySelector('#pe-comp-rate').value);
        s.compBoxA      = parseNum(body.querySelector('#pe-comp-boxa').value);
        s.compCredits   = parseNum(body.querySelector('#pe-comp-credits').value);
        // PE math:
        const zhlNet  = s.zhlBoxA  - s.zhlCredits;
        const compNet = s.compBoxA - s.compCredits;
        s.peDollars = zhlNet - compNet;
        s.pePoints  = s.loanAmount > 0 ? (s.peDollars / s.loanAmount) * 100 : 0;
        goTo('U-pe-result');
      });
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
        '<p style="margin:8px 0 0;color:#6b7280;font-size:11px;font-style:italic;">⚠ Attachments (Comp LE, ZHL pricing summary, etc.) can\'t be added via mailto: — attach them manually after the email opens.</p>' +
        '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">' +
          btnPrimary('Open in mail', 'zhl-pe-mailto') +
          btnSecondary('Copy body', 'zhl-pe-copy-body') +
          btnSecondary('Copy subject', 'zhl-pe-copy-subj') +
          btnSecondary('Save RM email for next time', 'zhl-pe-save-rm') +
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

      body.querySelector('#zhl-pe-mailto').addEventListener('click', function () {
        const e = read();
        const url = 'mailto:' + encodeURIComponent(e.to) +
          '?subject=' + encodeURIComponent(e.subject) +
          '&body=' + encodeURIComponent(e.body);
        try { window.open(url, '_blank'); }
        catch (_) { window.location.href = url; }
      });
      body.querySelector('#zhl-pe-copy-body').addEventListener('click', function () {
        const e = read();
        flashCopy(this, e.body);
      });
      body.querySelector('#zhl-pe-copy-subj').addEventListener('click', function () {
        const e = read();
        flashCopy(this, e.subject);
      });
      body.querySelector('#zhl-pe-save-rm').addEventListener('click', function () {
        const e = read();
        try {
          chrome.storage.local.set({ [STORAGE_KEY_RM]: e.to }, function () {
            flashLabel(body.querySelector('#zhl-pe-save-rm'), '✓ Saved');
          });
        } catch (_) {}
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
  function flashLabel(btn, msg) {
    const orig = btn.textContent;
    btn.textContent = msg;
    setTimeout(function () { btn.textContent = orig; }, 1500);
  }

  // ---- email template -----------------------------------------------------
  function buildEmail(s) {
    const id = s.zgNumber || s.loanId || '(loan id)';
    const greeting = 'Hi,';
    if (s.locked === true) {
      // Locked path — short email with completed checklist
      const lines = [
        greeting,
        '',
        id + ' is ready for PE request.',
        '',
        'Pre-submission checklist (all complete):',
        '  ✓ Current pricing imported',
        '  ✓ Comp PE fields completed in ENC Lock / Pricing Screen',
        '  ✓ No lock-difference alert',
        '  ✓ Comp LE uploaded to eFolder',
        '',
        'PE request size: ' + (s.isOver25 ? '2.5 points or over' : 'under 2.5 points'),
        ''
      ];
      if (s.isOver25) lines.push.apply(lines, big25Section(s));
      lines.push('LOP link: ' + s.loanLink);
      lines.push('');
      lines.push('Thanks.');
      return {
        subject: id + ' is ready for PE request' + (s.isOver25 ? ' (>2.5 pts)' : ''),
        body: lines.join('\n')
      };
    }
    // Unlocked path — include comp details + calculation
    const lines = [
      greeting,
      '',
      'PE request — ' + id,
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
      '  Net cost (A − cr.): ' + formatMoney(s.zhlBoxA - s.zhlCredits),
      '',
      'Competitor pricing:',
      '  Interest rate:      ' + formatPctDisplay(s.compRate),
      '  Total Box A:        ' + formatMoney(s.compBoxA),
      '  Lender credits:     ' + formatMoney(s.compCredits),
      '  Net cost (A − cr.): ' + formatMoney(s.compBoxA - s.compCredits),
      '',
      'PE amount requested: ' + formatMoney(s.peDollars) + '  (' + formatPctDisplay(s.pePoints) + ')',
      'PE request size:     ' + (s.isOver25 ? '2.5 points or over' : 'under 2.5 points'),
      ''
    ];
    if (s.isOver25) lines.push.apply(lines, big25Section(s));
    lines.push('Attached: ZHL pricing summary, comp pricing summary, comp LE.');
    lines.push('');
    lines.push('Thanks.');
    return {
      subject: 'PE Request — ' + id + (s.isOver25 ? ' (>2.5 pts)' : ''),
      body: lines.join('\n')
    };
  }
  function big25Section(s) {
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
