// ZHL Productivity Pack module — feature key: feature_vaCalc
// Wraps original module body in a chrome.storage.local feature-flag check.
// If the user disables this module on the setup page the body never runs.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_vaCalc';
  function __zhlRunModule() {
(function () {
  'use strict';

  const BUTTON_ID = 'rric-run-button';
  const PANEL_ID = 'rric-panel';
  const STUDENT_LOAN_BUTTON_ID = 'rric-sloan-button';
  const STUDENT_LOAN_PICKER_ID = 'rric-sloan-picker';
  const STUDENT_LOAN_PANEL_ID = 'rric-sloan-summary';
  const TRIGGER_VETERAN_TYPES = ['Regular military', 'National Guard or reserves'];

  const STUDENT_LOAN_CALCS = [
    { id: 'FHA', label: 'FHA',              desc: '0.5% of balance',     rate: 0.005 },
    { id: 'DU',  label: 'DU Conventional',  desc: '1% of balance',       rate: 0.01 },
    { id: 'LPA', label: 'LPA Conventional', desc: '0.5% of balance',     rate: 0.005 },
    { id: 'VA',  label: 'VA',               desc: '5% of balance ÷ 12', rate: 0.05 / 12 }
  ];

  const STUDENT_LOAN_KEYWORDS = [
    'DEPT OF ED', 'DEPT ED', 'DEPARTMENT OF ED', 'USDOE', 'US DEPT',
    'AIDVANTAGE', 'NELNET', 'MOHELA', 'FEDLOAN', 'EDFINANCIAL',
    'GREAT LAKES', 'SALLIE MAE', 'NAVIENT', 'MAXIMUS',
    'ECSI', 'DEFAULT RESOLUTION', 'STUDENT LOAN', 'STUDENT AID',
    'GRANITE STATE', 'OSLA'
  ];

  const FED_TAX_RATE = 0.15;
  const FICA_RATE = 0.07625;
  const STATE_TAX_RATE = 0.02;
  const MAINT_PER_SQFT = 0.14;
  const DEFAULT_SQFT = 2500;
  const NON_TAXABLE_GROSS_UP_RATE = 0.25;
  const BLEND_VA_GROSSUP_FACTOR = 1.25;

  const VA_REGION_BY_STATE = {
    Northeast: ['CT', 'ME', 'MA', 'NH', 'NJ', 'NY', 'PA', 'RI', 'VT'],
    Midwest:   ['IL', 'IN', 'IA', 'KS', 'MI', 'MN', 'MO', 'NE', 'ND', 'OH', 'SD', 'WI'],
    South:     ['AL', 'AR', 'DE', 'DC', 'FL', 'GA', 'KY', 'LA', 'MD', 'MS', 'NC', 'OK', 'SC', 'TN', 'TX', 'VA', 'WV', 'PR'],
    West:      ['AK', 'AZ', 'CA', 'CO', 'HI', 'ID', 'MT', 'NV', 'NM', 'OR', 'UT', 'WA', 'WY', 'GU']
  };

  const VA_TABLE_GT_80K = {
    Northeast: { 1: 450, 2: 755, 3: 909, 4: 1025, 5: 1062 },
    Midwest:   { 1: 441, 2: 738, 3: 889, 4: 1003, 5: 1039 },
    South:     { 1: 441, 2: 738, 3: 889, 4: 1003, 5: 1039 },
    West:      { 1: 491, 2: 823, 3: 990, 4: 1117, 5: 1158 }
  };
  const VA_TABLE_LE_80K = {
    Northeast: { 1: 390, 2: 654, 3: 788, 4: 888,  5: 921 },
    Midwest:   { 1: 382, 2: 641, 3: 772, 4: 868,  5: 902 },
    South:     { 1: 382, 2: 641, 3: 772, 4: 868,  5: 902 },
    West:      { 1: 425, 2: 713, 3: 859, 4: 967,  5: 1004 }
  };

  function regionFor(stateCode) {
    const code = (stateCode || '').toUpperCase();
    for (const [region, list] of Object.entries(VA_REGION_BY_STATE)) {
      if (list.includes(code)) return region;
    }
    return null;
  }

  function vaTableRequirement(familySize, region, loanAmount) {
    if (!region || !familySize) return null;
    const useGt80k = !loanAmount || loanAmount > 80000;
    const table = useGt80k ? VA_TABLE_GT_80K : VA_TABLE_LE_80K;
    const r = table[region];
    if (!r) return null;
    if (familySize <= 5) return r[Math.max(1, Math.min(familySize, 5))];
    return r[5] + (familySize - 5) * 75;
  }

  function parseMoney(s) {
    if (s == null) return 0;
    const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  function normalizeText(s) {
    return (s || '').replace(/\s+/g, ' ').replace(/[*.]/g, '').trim().toLowerCase();
  }

  function findLabel(text, scope) {
    const target = normalizeText(text);
    const root = scope || document;
    const labels = root.querySelectorAll('label');
    for (const lbl of labels) {
      const t = normalizeText(lbl.textContent);
      if (t === target || t === target + ' *') return lbl;
    }
    for (const lbl of labels) {
      const t = normalizeText(lbl.textContent);
      if (t.startsWith(target + ' ') || t.startsWith(target)) return lbl;
    }
    return null;
  }

  function findFieldByLabel(text, scope) {
    const lbl = findLabel(text, scope);
    if (!lbl) return null;
    if (lbl.htmlFor) {
      const el = document.getElementById(lbl.htmlFor);
      if (el) return el;
    }
    let parent = lbl.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      const candidates = parent.querySelectorAll('input, select, textarea');
      for (const c of candidates) {
        if (c.type !== 'hidden') return c;
      }
      parent = parent.parentElement;
    }
    return null;
  }

  function findSectionScope(headingText) {
    const target = normalizeText(headingText);
    const candidates = document.querySelectorAll('h1, h2, h3, h4, h5, h6, div, span, section');
    for (const el of candidates) {
      if (normalizeText(el.textContent) === target) {
        let s = el.closest('section') || el.parentElement;
        for (let i = 0; i < 4 && s; i++) {
          if (s.querySelectorAll('input, select').length > 0) return s;
          s = s.parentElement;
        }
      }
    }
    return null;
  }

  function getSelectText(el) {
    if (!el) return '';
    if (el.tagName === 'SELECT') {
      const opt = el.options[el.selectedIndex];
      return opt ? opt.text : '';
    }
    return el.value || el.textContent || '';
  }

  function getVeteranType() {
    return getSelectText(findFieldByLabel('Veteran type')).trim();
  }

  function getMaritalStatus() {
    return getSelectText(findFieldByLabel('Marital status')).trim().toLowerCase();
  }

  function getDependentCount() {
    const inp = findFieldByLabel('Dependent ages');
    if (!inp) return 0;
    const v = (inp.value || '').trim();
    if (!v) return 0;
    return v.split(/[,\s]+/).filter(Boolean).length;
  }

  function getPropertyState() {
    const scope = findSectionScope('Subject property') || findSectionScope('Property information');
    let stateInp = null;
    if (scope) stateInp = findFieldByLabel('State', scope);
    if (!stateInp) stateInp = findFieldByLabel('Property state');
    if (stateInp) {
      const v = getSelectText(stateInp).trim();
      const m = v.match(/\b([A-Z]{2})\b/);
      if (m) return m[1];
      return v.toUpperCase().slice(0, 2);
    }
    const headerMatch = (document.body.innerText || '').match(/,\s*([A-Z]{2})\b/);
    return headerMatch ? headerMatch[1] : '';
  }

  function getEmploymentIncome() {
    const scope = findSectionScope('Employment');
    if (!scope) return 0;
    let total = 0;
    const inputs = scope.querySelectorAll('input');
    for (const inp of inputs) {
      const lbl = inp.closest('label') || (inp.id && document.querySelector('label[for="' + CSS.escape(inp.id) + '"]'));
      const labelText = lbl ? normalizeText(lbl.textContent) : '';
      if (/(monthly income|base pay|bonus|commission|overtime|gross monthly|other|tips)/.test(labelText)) {
        total += parseMoney(inp.value);
      }
    }
    return total;
  }

  function getPanelNumber(label) {
    const target = normalizeText(label);
    const els = document.querySelectorAll('div, span, td, th, p, dt, dd, li, label');
    for (const el of els) {
      const t = normalizeText(el.textContent);
      if (!t) continue;
      if (t === target) {
        let sib = el.nextElementSibling;
        while (sib && !sib.textContent.trim()) sib = sib.nextElementSibling;
        if (sib) {
          const n = parseMoney(sib.textContent);
          if (n) return n;
        }
        const parent = el.parentElement;
        if (parent) {
          const txt = parent.textContent.replace(el.textContent, '');
          const n = parseMoney(txt);
          if (n) return n;
        }
      }
    }
    for (const el of els) {
      const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!raw) continue;
      const t = normalizeText(raw);
      if (t === target) continue;
      if (t.startsWith(target) && raw.length < label.length + 40) {
        const rest = raw.slice(raw.toLowerCase().indexOf(target) + target.length);
        const n = parseMoney(rest);
        if (n) return n;
      }
    }
    return 0;
  }

  function readOtherIncomeRows() {
    const rows = [];
    const tables = document.querySelectorAll('table[aria-label="Table for other incomes"]');
    for (const table of tables) {
      const headers = table.querySelectorAll('thead th');
      let srcCol = -1, moCol = -1;
      headers.forEach(function (th, i) {
        const t = normalizeText(th.textContent);
        if (t === 'income source') srcCol = i;
        if (t === 'income / mo' || t === 'income/mo') moCol = i;
      });
      if (srcCol < 0 || moCol < 0) continue;
      const trs = table.querySelectorAll('tbody > tr');
      for (const tr of trs) {
        const cells = tr.children;
        if (cells.length <= moCol) continue;
        const sourceText = (cells[srcCol] && cells[srcCol].textContent || '').trim();
        if (!sourceText) continue;
        const monthly = parseMoney(cells[moCol] && cells[moCol].textContent);
        rows.push({ source: sourceText, monthly: monthly });
      }
    }
    return rows;
  }

  function isVACompensationSource(source) {
    return /va\s*(compensation|disability)/i.test(source || '');
  }

  function getDisplayedVACompensation() {
    let total = 0;
    for (const row of readOtherIncomeRows()) {
      if (isVACompensationSource(row.source)) total += row.monthly;
    }
    return total;
  }

  function detectVACompensation() {
    return getDisplayedVACompensation() / BLEND_VA_GROSSUP_FACTOR;
  }

  function detectMilitaryEntitlements() {
    let total = 0;
    const inputs = document.querySelectorAll('input[name="militaryEntitlements.amount"]');
    for (const inp of inputs) {
      const amount = parseMoney(inp.value);
      if (!amount) continue;
      const row = inp.closest('tr');
      let freq = 'Monthly';
      if (row) {
        const sel = row.querySelector('select[name="militaryEntitlements.frequency"]');
        if (sel && sel.value) freq = sel.value;
      }
      total += /annual/i.test(freq) ? amount / 12 : amount;
    }
    return total / BLEND_VA_GROSSUP_FACTOR;
  }

  function detectNonTaxableIncome() {
    return detectVACompensation() + detectMilitaryEntitlements();
  }

  function getOtherIncomeTotal() {
    let total = 0;
    for (const row of readOtherIncomeRows()) {
      total += row.monthly;
    }
    return total;
  }

  function getGrossMonthlyIncome() {
    const panel = getPanelNumber('Monthly income');
    if (panel > 0) return panel;
    return getEmploymentIncome() + getOtherIncomeTotal();
  }

  function getMonthlyDebts() {
    return getPanelNumber('Monthly liabilities') || getPanelNumber('Monthly debts');
  }

  function getProposedPITI() {
    return getPanelNumber('Monthly PITI') || getPanelNumber('PITI');
  }

  function getDTI() {
    const target = 'dti';
    const els = document.querySelectorAll('div, span, td, th, p, dt, dd, li, label');
    for (const el of els) {
      const t = normalizeText(el.textContent);
      if (t !== target) continue;
      const sources = [];
      let sib = el.nextElementSibling;
      while (sib && !sib.textContent.trim()) sib = sib.nextElementSibling;
      if (sib) sources.push(sib.textContent);
      if (el.parentElement) {
        sources.push(el.parentElement.textContent.replace(el.textContent, ''));
      }
      for (const txt of sources) {
        const matches = txt.match(/(\d+(?:\.\d+)?)\s*%/g);
        if (matches && matches.length) {
          const nums = matches.map(function (m) { return parseFloat(m); });
          return Math.max.apply(null, nums);
        }
      }
    }
    return null;
  }

  function getLoanAmount() {
    return getPanelNumber('Total loan amt')
      || getPanelNumber('Base loan amt')
      || getPanelNumber('Total loan amount')
      || getPanelNumber('Base loan amount')
      || getPanelNumber('Loan amount')
      || getPanelNumber('Loan amt')
      || 0;
  }

  function readPageInputs() {
    const grossIncome = getGrossMonthlyIncome();
    const nonTaxableIncome = detectNonTaxableIncome();
    const monthlyDebts = getMonthlyDebts();
    const piti = getProposedPITI();
    const married = /^(married|separated)$/.test(getMaritalStatus());
    const familySize = 1 + (married ? 1 : 0) + getDependentCount();
    const state = getPropertyState();
    const region = regionFor(state);
    const loanAmount = getLoanAmount();
    const dti = getDTI();
    return {
      grossIncome,
      nonTaxableIncome,
      monthlyDebts,
      piti,
      maintenance: MAINT_PER_SQFT * DEFAULT_SQFT,
      childcare: 0,
      familySize,
      state,
      region,
      loanAmount,
      dti
    };
  }

  function calculate(state) {
    const gross = state.grossIncome || 0;
    const taxableIncome = Math.max(0, gross - (state.nonTaxableIncome || 0));
    const fedTax = taxableIncome * FED_TAX_RATE;
    const fica = taxableIncome * FICA_RATE;
    const stateTax = taxableIncome * STATE_TAX_RATE;
    const residual = gross
      - fedTax - fica - stateTax
      - (state.monthlyDebts || 0)
      - (state.piti || 0)
      - (state.maintenance || 0)
      - (state.childcare || 0);
    const requirement = vaTableRequirement(state.familySize, state.region, state.loanAmount);
    const dtiOver41 = state.dti != null && state.dti > 41;
    const requirement120 = requirement != null ? Math.round(requirement * 1.2 * 100) / 100 : null;
    return {
      taxableIncome,
      federalTax: fedTax,
      fica,
      stateTax,
      residualIncome: Math.round(residual * 100) / 100,
      requirement,
      requirement120,
      dtiOver41
    };
  }

  function setReactInputValue(input, value) {
    // The Constellation form library only marks the form dirty (and
    // enables Save) on *trusted* user-input events. Programmatic events
    // dispatched by us are isTrusted=false and get ignored, even though
    // the value visibly changes. document.execCommand('insertText', …)
    // routes through the browser's input pipeline, which produces
    // trusted events — same as if the user typed.
    let viaExec = false;
    try {
      input.focus();
      // Select existing content so insertText replaces it.
      try { input.setSelectionRange(0, (input.value || '').length); }
      catch (_) { try { input.select(); } catch (__) {} }
      viaExec = document.execCommand && document.execCommand('insertText', false, String(value));
    } catch (_) { viaExec = false; }

    if (!viaExec || String(input.value) !== String(value)) {
      // Fallback: native setter + synthetic events.
      const proto = Object.getPrototypeOf(input);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(input, value);
      else input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // change + blur commits the field in most form libraries.
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function fmt(n) {
    n = (n == null || isNaN(n)) ? 0 : n;
    return '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function getPageFontFamily() {
    const candidates = ['label', 'input', 'select', 'button', 'h2', 'h3', 'p'];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const ff = getComputedStyle(el).fontFamily;
      if (ff) return ff;
    }
    return getComputedStyle(document.body).fontFamily || '';
  }

  function applyResults(state, result) {
    const residualField = findFieldByLabel('VA residual income');
    if (residualField) setReactInputValue(residualField, result.residualIncome.toFixed(2));
    const deductionsField = findFieldByLabel('VA total deductions');
    if (deductionsField && result.requirement != null) {
      setReactInputValue(deductionsField, result.requirement.toFixed(2));
    }
  }

  function showPanel(initialState) {
    const existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();

    const state = Object.assign({}, initialState);
    const fontFamily = getPageFontFamily();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'rric-panel';
    if (fontFamily) panel.style.fontFamily = fontFamily;

    const header = document.createElement('div');
    header.className = 'rric-panel-header';
    const title = document.createElement('div');
    title.className = 'rric-panel-title';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'rric-panel-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', function () { panel.remove(); });
    header.appendChild(title);
    header.appendChild(close);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'rric-panel-body';
    panel.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'rric-panel-footer';
    const note = document.createElement('div');
    note.className = 'rric-panel-note';
    note.innerHTML =
      '<strong>Note:</strong> VA residual income must be at least 120% of the table ' +
      'requirement when borrower DTI is over 41%. Edit the highlighted fields, then re-run.';
    const rerun = document.createElement('button');
    rerun.type = 'button';
    rerun.className = 'rric-button rric-rerun';
    rerun.textContent = 'Re-run';
    footer.appendChild(note);
    footer.appendChild(rerun);
    panel.appendChild(footer);

    document.body.appendChild(panel);

    function addRow(label, valueText, opts) {
      opts = opts || {};
      const row = document.createElement('div');
      row.className = 'rric-row'
        + (opts.divider ? ' rric-divider' : '')
        + (opts.emphasis ? ' rric-emphasis' : '')
        + (opts.muted ? ' rric-muted' : '');
      const lbl = document.createElement('div');
      lbl.className = 'rric-label';
      lbl.textContent = label;
      const val = document.createElement('div');
      val.className = 'rric-value';
      val.textContent = valueText;
      row.appendChild(lbl);
      row.appendChild(val);
      body.appendChild(row);
      return row;
    }

    function addEditableRow(label, value, suffix, onChange) {
      const row = document.createElement('div');
      row.className = 'rric-row rric-editable';
      const lbl = document.createElement('div');
      lbl.className = 'rric-label';
      lbl.textContent = label;
      const val = document.createElement('div');
      val.className = 'rric-value';
      const wrap = document.createElement('span');
      wrap.className = 'rric-input-wrap';
      const dollar = document.createElement('span');
      dollar.className = 'rric-input-prefix';
      dollar.textContent = '$';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'rric-input';
      input.value = (Math.round((value || 0) * 100) / 100).toFixed(2);
      input.addEventListener('input', function () { onChange(parseMoney(input.value)); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); rerun.click(); }
      });
      wrap.appendChild(dollar);
      wrap.appendChild(input);
      val.appendChild(wrap);
      if (suffix) {
        const sfx = document.createElement('div');
        sfx.className = 'rric-suffix';
        sfx.textContent = suffix;
        val.appendChild(sfx);
      }
      row.appendChild(lbl);
      row.appendChild(val);
      body.appendChild(row);
    }

    function renderBody() {
      body.innerHTML = '';
      const result = calculate(state);
      title.textContent = 'Residual income: ' + fmt(result.residualIncome);

      addRow('Gross monthly income', fmt(state.grossIncome));
      addEditableRow('Non-Taxable Income (VA Disability, BAH, BAS, etc.)', state.nonTaxableIncome, 'Excluded from taxes', function (v) {
        state.nonTaxableIncome = v;
      });
      addRow('Taxable income', fmt(result.taxableIncome), { divider: true });
      addRow('− Federal tax (15%)', '−' + fmt(result.federalTax));
      addRow('− SS / Medicare (7.625%)', '−' + fmt(result.fica));
      addRow('− State tax (2%)', '−' + fmt(result.stateTax));
      addRow('− Monthly debts', '−' + fmt(state.monthlyDebts));
      addRow('− Proposed PITI', '−' + fmt(state.piti));
      addEditableRow('− Maintenance & utilities', state.maintenance, '2,500 sq ft × $0.14 default', function (v) {
        state.maintenance = v;
      });
      addEditableRow('− Childcare / daycare', state.childcare, 'Defaults to $0', function (v) {
        state.childcare = v;
      });
      addRow('= Residual income', fmt(result.residualIncome), { divider: true, emphasis: true });

      addRow('Family size', String(state.familySize), { divider: true });
      addRow('Property state', state.state || '—');
      addRow('VA region', state.region || '—');
      const loanLabel = state.loanAmount ? fmt(state.loanAmount) : 'Unknown — assuming > $80k';
      addRow('Loan amount', loanLabel);
      if (state.dti != null) {
        addRow('DTI', state.dti.toFixed(2) + '%');
      }
      addRow('VA table requirement', result.requirement != null ? fmt(result.requirement) : '—', { emphasis: true });
      if (result.dtiOver41 && result.requirement120 != null) {
        addRow('Required at 120% (DTI > 41%)', fmt(result.requirement120), { emphasis: true });
      }

      applyResults(state, result);
    }

    rerun.addEventListener('click', renderBody);
    renderBody();
  }

  function findEmploymentSummaryRows() {
    const rows = [];
    const tables = document.querySelectorAll('table[aria-label="Table for employments"]');
    for (const table of tables) {
      for (const tr of table.querySelectorAll('tbody > tr')) {
        if (tr.children.length < 8) continue;
        const firstCell = tr.children[0];
        if (!firstCell) continue;
        if (!firstCell.querySelector('svg')) continue;
        rows.push(tr);
      }
    }
    return rows;
  }

  function isEmploymentRowExpanded(summaryRow) {
    const next = summaryRow.nextElementSibling;
    return !!(next && next.querySelector('td[colspan]'));
  }

  function simulateClick(el) {
    if (!el) return;
    let rect;
    try { rect = el.getBoundingClientRect(); }
    catch (_) { rect = { left: 0, top: 0, width: 0, height: 0 }; }
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const mouseOpts = {
      bubbles: true, cancelable: true, view: window, button: 0,
      clientX: cx, clientY: cy
    };
    const pointerOpts = Object.assign({}, mouseOpts, {
      pointerType: 'mouse', isPrimary: true, pointerId: 1, buttons: 1
    });
    function fire(name, Cls, opts) {
      try { el.dispatchEvent(new Cls(name, opts)); return; }
      catch (_) { /* fall through */ }
      try { el.dispatchEvent(new Event(name, { bubbles: true, cancelable: true })); }
      catch (__) { /* give up on this event */ }
    }
    const hasPointer = typeof PointerEvent !== 'undefined';
    if (hasPointer) fire('pointerover', PointerEvent, pointerOpts);
    if (hasPointer) fire('pointerdown', PointerEvent, pointerOpts);
    fire('mousedown', MouseEvent, mouseOpts);
    if (hasPointer) fire('pointerup', PointerEvent, pointerOpts);
    fire('mouseup', MouseEvent, mouseOpts);
    fire('click', MouseEvent, mouseOpts);
  }

  function waitMs(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  async function clickAndWaitFor(target, predicate, maxMs) {
    simulateClick(target);
    const step = 25;
    const max = maxMs || 500;
    for (let elapsed = 0; elapsed < max; elapsed += step) {
      await waitMs(step);
      if (predicate()) return true;
    }
    return false;
  }

  async function toggleEmploymentRow(summaryRow, wantExpanded) {
    const predicate = wantExpanded
      ? function () { return isEmploymentRowExpanded(summaryRow); }
      : function () { return !isEmploymentRowExpanded(summaryRow); };
    if (predicate()) return true;
    const firstCell = summaryRow.children[0];
    const svg = firstCell ? firstCell.querySelector('svg') : null;
    const targets = [svg, firstCell, summaryRow].filter(Boolean);
    for (const target of targets) {
      if (await clickAndWaitFor(target, predicate)) return true;
    }
    return false;
  }

  function runCalculator() {
    runCalcAsync().catch(function (e) {
      console.error('[Residual Income Calc] error', e);
      alert('Calculator error: ' + e.message);
    });
  }

  async function runCalcAsync() {
    const summaryRows = findEmploymentSummaryRows();
    const expandedByUs = [];
    for (const row of summaryRows) {
      if (!isEmploymentRowExpanded(row)) {
        if (await toggleEmploymentRow(row, true)) expandedByUs.push(row);
      }
    }

    let initialState;
    try {
      initialState = readPageInputs();
    } finally {
      for (const row of expandedByUs) {
        await toggleEmploymentRow(row, false);
      }
    }

    if (!initialState || !initialState.grossIncome) {
      alert('Could not read gross monthly income from the Employment section or sidebar.');
      return;
    }
    showPanel(initialState);
  }

  function findMilitaryCompletedRow() {
    const labels = document.querySelectorAll('label, span');
    for (const el of labels) {
      if (normalizeText(el.textContent) === 'military service completed') {
        let row = el.parentElement;
        for (let i = 0; i < 4 && row; i++) {
          if (row.children.length > 1 || (row.offsetWidth > 200)) return row;
          row = row.parentElement;
        }
        return el.parentElement;
      }
    }
    return null;
  }

  function ensureButtonState() {
    const veteranType = getVeteranType();
    const shouldShow = TRIGGER_VETERAN_TYPES.some(function (t) {
      return normalizeText(veteranType) === normalizeText(t);
    });
    const existing = document.getElementById(BUTTON_ID);
    if (!shouldShow) {
      if (existing) existing.remove();
      return;
    }
    if (existing && existing.isConnected) return;
    const anchor = findMilitaryCompletedRow();
    if (!anchor) return;
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.className = 'rric-button';
    btn.textContent = 'Run Residual Income Calc';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      runCalculator();
    });
    anchor.appendChild(btn);
  }

  function ensureStudentLoanButton() {
    if (!document.querySelector('table[aria-label="Table for liabilities"]')) return;
    if (document.getElementById(STUDENT_LOAN_BUTTON_ID)) return;
    let header = null;
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (const h of headings) {
      if (normalizeText(h.textContent) === 'liabilities') {
        header = h.parentElement;
        break;
      }
    }
    if (!header) return;
    const addBtn = header.querySelector('button[data-cy="add-entity-button"]');
    const btn = document.createElement('button');
    btn.id = STUDENT_LOAN_BUTTON_ID;
    btn.type = 'button';
    btn.className = 'rric-button rric-secondary-button';
    btn.textContent = 'Calc Student Loans';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      showStudentLoanPicker();
    });
    if (addBtn) header.insertBefore(btn, addBtn);
    else header.appendChild(btn);
  }

  function textOf(el) { return el ? (el.textContent || '').trim() : ''; }

  function findLiabilityRows() {
    const rows = [];
    const tables = document.querySelectorAll('table[aria-label="Table for liabilities"]');
    for (const table of tables) {
      const headers = table.querySelectorAll('thead th');
      const cols = {};
      headers.forEach(function (th, i) {
        const t = normalizeText(th.textContent);
        if (t === 'borrower(s)' || t === 'borrowers') cols.borrower = i;
        else if (t === 'account type') cols.accountType = i;
        else if (t === 'company/payee' || t === 'company / payee') cols.payee = i;
        else if (t === 'account no') cols.accountNo = i;
        else if (t === 'unpaid balance') cols.balance = i;
        else if (t === 'mo payment' || t === 'monthly payment') cols.payment = i;
      });
      for (const tr of table.querySelectorAll('tbody > tr')) {
        if (tr.children.length < 6) continue;
        const firstCell = tr.children[0];
        if (!firstCell || !firstCell.querySelector('svg')) continue;
        rows.push({
          tr: tr,
          borrower: textOf(tr.children[cols.borrower]),
          accountType: textOf(tr.children[cols.accountType]),
          payee: textOf(tr.children[cols.payee]),
          accountNo: textOf(tr.children[cols.accountNo]),
          balance: parseMoney(textOf(tr.children[cols.balance])),
          paymentText: textOf(tr.children[cols.payment]),
          payment: parseMoney(textOf(tr.children[cols.payment]))
        });
      }
    }
    return rows;
  }

  function isStudentLoanByName(payee) {
    const upper = (payee || '').toUpperCase();
    return STUDENT_LOAN_KEYWORDS.some(function (k) { return upper.indexOf(k) !== -1; });
  }

  function getLoanId() {
    const fromUrl = (location.pathname || '').match(/(ZG\d{8,})/i);
    if (fromUrl) return fromUrl[1].toUpperCase();
    const fromHash = (location.hash || '').match(/(ZG\d{8,})/i);
    if (fromHash) return fromHash[1].toUpperCase();
    const bodyText = document.body && document.body.innerText || '';
    const fromBody = bodyText.match(/#?(ZG\d{8,})/i);
    if (fromBody) return fromBody[1].toUpperCase();
    return 'unknown-' + (location.pathname || '').replace(/[^a-z0-9]/gi, '-').slice(-40);
  }

  function hasChromeStorage() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  }

  function getOurPayments(loanId) {
    if (!hasChromeStorage()) return Promise.resolve({});
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(['rric_ourPayments'], function (data) {
          const all = (data && data.rric_ourPayments) || {};
          resolve(all[loanId] || {});
        });
      } catch (_) { resolve({}); }
    });
  }

  function setOurPayment(loanId, accountKey, info) {
    if (!hasChromeStorage()) return Promise.resolve();
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(['rric_ourPayments'], function (data) {
          const all = (data && data.rric_ourPayments) || {};
          if (!all[loanId]) all[loanId] = {};
          all[loanId][accountKey] = info;
          chrome.storage.local.set({ rric_ourPayments: all }, function () { resolve(); });
        });
      } catch (_) { resolve(); }
    });
  }

  function liabilityKey(lib) {
    if (lib.accountNo) return lib.accountNo.trim();
    return 'payee:' + (lib.payee || '').trim() + '|bal:' + (lib.balance || 0);
  }

  function isLiabilityRowExpanded(summaryRow) {
    const next = summaryRow.nextElementSibling;
    return !!(next && next.querySelector('td[colspan]'));
  }

  async function toggleLiabilityRow(summaryRow, wantExpanded) {
    const predicate = wantExpanded
      ? function () { return isLiabilityRowExpanded(summaryRow); }
      : function () { return !isLiabilityRowExpanded(summaryRow); };
    if (predicate()) return true;
    const firstCell = summaryRow.children[0];
    const svg = firstCell ? firstCell.querySelector('svg') : null;
    const targets = [svg, firstCell, summaryRow].filter(Boolean);
    for (const target of targets) {
      if (await clickAndWaitFor(target, predicate)) return true;
    }
    return false;
  }

  function showStudentLoanPicker() {
    const existing = document.getElementById(STUDENT_LOAN_PICKER_ID);
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = STUDENT_LOAN_PICKER_ID;
    overlay.className = 'rric-modal-overlay';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });

    const panel = document.createElement('div');
    panel.className = 'rric-panel rric-modal';
    const fontFamily = getPageFontFamily();
    if (fontFamily) panel.style.fontFamily = fontFamily;

    const header = document.createElement('div');
    header.className = 'rric-panel-header';
    const title = document.createElement('div');
    title.className = 'rric-panel-title';
    title.textContent = 'Calculate student loan payments';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'rric-panel-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', function () { overlay.remove(); });
    header.appendChild(title);
    header.appendChild(close);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'rric-panel-body';

    const intro = document.createElement('p');
    intro.className = 'rric-intro';
    intro.textContent = 'Choose the loan program. We will fill the monthly payment on student-loan liabilities that have no payment listed, then save and collapse each row.';
    body.appendChild(intro);

    for (const calc of STUDENT_LOAN_CALCS) {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'rric-choice-button';
      const lbl = document.createElement('strong');
      lbl.textContent = calc.label;
      const desc = document.createElement('span');
      desc.textContent = calc.desc;
      choice.appendChild(lbl);
      choice.appendChild(desc);
      choice.addEventListener('click', function () {
        overlay.remove();
        processStudentLoans(calc).catch(function (e) {
          console.error('[Residual Income Calc] student loan error', e);
          alert('Student loan calc error: ' + e.message);
        });
      });
      body.appendChild(choice);
    }

    panel.appendChild(body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }

  async function processStudentLoans(calc) {
    const liabilityRows = findLiabilityRows();
    const loanId = getLoanId();
    const ourPayments = await getOurPayments(loanId);
    const updated = [];
    const skipped = [];
    let detected = 0;

    for (const lib of liabilityRows) {
      if (!isStudentLoanByName(lib.payee)) continue;
      detected++;

      const key = liabilityKey(lib);
      const ours = ourPayments[key];

      if (lib.payment > 0 && !ours) {
        skipped.push({ lib: lib, reason: 'Payment already set (' + lib.paymentText + ') — entered manually, not overwritten' });
        continue;
      }
      if (!lib.balance || lib.balance <= 0) {
        skipped.push({ lib: lib, reason: 'No unpaid balance' });
        continue;
      }

      const expanded = await toggleLiabilityRow(lib.tr, true);
      if (!expanded) {
        skipped.push({ lib: lib, reason: 'Could not expand row' });
        continue;
      }

      const editForm = lib.tr.nextElementSibling;
      if (!editForm) {
        skipped.push({ lib: lib, reason: 'Edit form not found after expanding' });
        continue;
      }

      const accountTypeSelect = editForm.querySelector('select[name="type"]');
      const typeValue = accountTypeSelect ? accountTypeSelect.value : '';
      const confirmedStudent = typeValue === 'StudentLoan' || isStudentLoanByName(lib.payee);
      if (!confirmedStudent) {
        skipped.push({ lib: lib, reason: 'Account type not StudentLoan' });
        await toggleLiabilityRow(lib.tr, false);
        continue;
      }

      const payoff = editForm.querySelector('input[name="payoff"]');
      if (payoff && payoff.checked) {
        skipped.push({ lib: lib, reason: 'Payoff flag is set' });
        await toggleLiabilityRow(lib.tr, false);
        continue;
      }
      const exclude = editForm.querySelector('input[name="exclude"]');
      if (exclude && exclude.checked) {
        skipped.push({ lib: lib, reason: 'Exclude flag is set' });
        await toggleLiabilityRow(lib.tr, false);
        continue;
      }

      const paymentInput = editForm.querySelector('input[name="monthlyPayment"]');
      if (!paymentInput) {
        skipped.push({ lib: lib, reason: 'Monthly payment input not found' });
        await toggleLiabilityRow(lib.tr, false);
        continue;
      }

      const computed = Math.round(lib.balance * calc.rate * 100) / 100;
      try { paymentInput.focus(); } catch (_) {}
      setReactInputValue(paymentInput, computed.toFixed(2));
      await waitMs(150);
      try { paymentInput.blur(); } catch (_) {}
      await waitMs(150);

      const saveBtn = editForm.querySelector('button[data-cy="save-liability-button"]');
      if (!saveBtn) {
        skipped.push({ lib: lib, reason: 'Save button not found' });
        continue;
      }
      if (typeof saveBtn.click === 'function') {
        saveBtn.click();
      } else {
        simulateClick(saveBtn);
      }

      let saved = false;
      for (let i = 0; i < 200; i++) {
        await waitMs(50);
        if (!isLiabilityRowExpanded(lib.tr)) { saved = true; break; }
      }
      if (saved) {
        await setOurPayment(loanId, key, {
          calc: calc.id,
          payment: computed,
          balance: lib.balance,
          ts: Date.now()
        });
        updated.push({ lib: lib, payment: computed, recalculated: !!ours, previousCalc: ours ? ours.calc : null });
      } else {
        skipped.push({
          lib: lib,
          reason: 'Save did not complete within 10s. Value entered ' + fmt(computed) +
                  '; row left expanded for manual review.'
        });
      }
    }

    showStudentLoanSummary({ calc: calc, detected: detected, updated: updated, skipped: skipped, loanId: loanId });
  }

  function showStudentLoanSummary(results) {
    const existing = document.getElementById(STUDENT_LOAN_PANEL_ID);
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = STUDENT_LOAN_PANEL_ID;
    panel.className = 'rric-panel';
    const fontFamily = getPageFontFamily();
    if (fontFamily) panel.style.fontFamily = fontFamily;

    const header = document.createElement('div');
    header.className = 'rric-panel-header';
    const title = document.createElement('div');
    title.className = 'rric-panel-title';
    title.textContent = results.calc.label + ' student loans: ' + results.updated.length + ' updated, ' + results.skipped.length + ' skipped';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'rric-panel-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', function () { panel.remove(); });
    header.appendChild(title);
    header.appendChild(close);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'rric-panel-body';

    function addLine(label, value, opts) {
      opts = opts || {};
      const row = document.createElement('div');
      row.className = 'rric-row' + (opts.divider ? ' rric-divider' : '') + (opts.muted ? ' rric-muted' : '');
      const lbl = document.createElement('div');
      lbl.className = 'rric-label';
      lbl.textContent = label;
      const val = document.createElement('div');
      val.className = 'rric-value';
      val.textContent = value;
      row.appendChild(lbl);
      row.appendChild(val);
      body.appendChild(row);
    }
    function addSubhead(text) {
      const h = document.createElement('div');
      h.className = 'rric-subhead';
      h.textContent = text;
      body.appendChild(h);
    }

    addLine('Formula', results.calc.label + ' (' + results.calc.desc + ')');
    addLine('Student loans detected', String(results.detected));
    addLine('Updated', String(results.updated.length));
    addLine('Skipped', String(results.skipped.length));

    if (results.updated.length > 0) {
      addSubhead('Updated');
      for (const u of results.updated) {
        const who = u.lib.borrower ? ' — ' + u.lib.borrower : '';
        let tag = '';
        if (u.recalculated) {
          tag = u.previousCalc && u.previousCalc !== results.calc.id
            ? ' (recalculated, was ' + u.previousCalc + ')'
            : ' (recalculated)';
        }
        addLine(u.lib.payee + who + tag, fmt(u.payment));
      }
    }
    if (results.skipped.length > 0) {
      addSubhead('Skipped');
      for (const s of results.skipped) {
        const who = s.lib.borrower ? ' — ' + s.lib.borrower : '';
        addLine(s.lib.payee + who, s.reason, { muted: true });
      }
    }
    if (results.detected === 0) {
      addSubhead('No student loans found');
      const note = document.createElement('p');
      note.className = 'rric-intro';
      note.textContent = 'No liability rows had a Company/Payee that matched a known student-loan servicer. If a row should have been included, tell us the servicer name so it can be added.';
      body.appendChild(note);
    }

    panel.appendChild(body);
    document.body.appendChild(panel);
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      try { ensureButtonState(); } catch (e) { console.error('[Residual Income Calc] observer error', e); }
      try { ensureStudentLoanButton(); } catch (e) { console.error('[Residual Income Calc] sloan observer error', e); }
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['value'] });
  document.addEventListener('change', schedule, true);
  document.addEventListener('input', schedule, true);
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
