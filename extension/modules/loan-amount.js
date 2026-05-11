// ZHL Productivity Pack module — feature key: feature_loanAmount
// Wraps original module body in a chrome.storage.local feature-flag check.
// If the user disables this module on the setup page the body never runs.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_loanAmount';
  function __zhlRunModule() {
(() => {
  'use strict';

  const FIELD_ATTR = 'data-zhl-loan-amount';
  const LOAN_INPUT_ATTR = 'data-zhl-loan-amount-input';
  const WIRED_ATTR = 'data-zhl-wired';

  const fmtMoney = (n) =>
    isFinite(n)
      ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '';

  const parseNum = (s) => {
    if (s == null || s === '') return NaN;
    const cleaned = String(s).replace(/[^0-9.\-]/g, '');
    return cleaned === '' ? NaN : parseFloat(cleaned);
  };

  const setReactValue = (el, value) => {
    const proto =
      el.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const fireCommit = (el) => {
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };

  const $purchase = () => document.querySelector('input[name="purchasePrice"]');
  const $downAmt = () => document.querySelector('input[name="downPayments.0.downPayment"]');
  const $downPct = () => document.querySelector('input[name="downPayments.0.downPaymentPercent"]');
  const $loan = () => document.querySelector(`input[${LOAN_INPUT_ATTR}]`);

  let suppressEcho = false;

  const recalcLoanDisplay = () => {
    const loan = $loan();
    if (!loan || document.activeElement === loan) return;
    const p = parseNum($purchase()?.value);
    const d = parseNum($downAmt()?.value);
    if (!isFinite(p) || !isFinite(d)) {
      loan.value = '';
      return;
    }
    loan.value = fmtMoney(Math.max(0, +(p - d).toFixed(2)));
  };

  const applyLoanEdit = () => {
    const loan = $loan();
    if (!loan) return;
    const p = parseNum($purchase()?.value);
    if (!isFinite(p) || p <= 0) {
      loan.value = '';
      return;
    }
    let l = parseNum(loan.value);
    if (!isFinite(l)) {
      recalcLoanDisplay();
      return;
    }
    l = Math.min(Math.max(0, l), p);
    loan.value = fmtMoney(l);

    const newDown = +(p - l).toFixed(2);
    const newPct = +((newDown / p) * 100).toFixed(2);
    const dAmt = $downAmt();
    const dPct = $downPct();

    console.group('[Loan Amount] applyLoanEdit');
    console.log('purchase:', p, 'user-entered loan:', l, '→ computed newDown:', newDown, 'newPct:', newPct);
    console.log('downAmt input name:', dAmt && dAmt.name, 'current value:', dAmt && dAmt.value);
    console.log('downPct input name:', dPct && dPct.name, 'current value:', dPct && dPct.value);

    // Find any other inputs on the page that look like they hold a
    // loan-related amount — LOP may keep a separate "loanAmount" /
    // "baseLoanAmount" / "ltv" field that the scenario engine reads
    // instead of (or in addition to) downPayments.0.downPayment.
    const candidates = document.querySelectorAll(
      'input[name*="loan" i], input[name*="ltv" i], input[name*="baseLoan" i]'
    );
    if (candidates.length) {
      console.log('other loan-related inputs found on page:');
      candidates.forEach(function (c) {
        console.log('  name=' + c.name + ' value=' + c.value + ' tag=' + c.tagName + ' type=' + c.type);
      });
    } else {
      console.log('no other loan-related inputs found.');
    }

    suppressEcho = true;
    try {
      if (dAmt) {
        setReactValue(dAmt, newDown.toFixed(2));
        fireCommit(dAmt);
        console.log('after write — downAmt value:', dAmt.value);
      }
      if (dPct) {
        setReactValue(dPct, newPct.toFixed(2));
        fireCommit(dPct);
        console.log('after write — downPct value:', dPct.value);
      }
    } finally {
      Promise.resolve().then(() => {
        suppressEcho = false;
      });
    }
    // Poll for 4 seconds so we can see whether LOP's React state
    // reverts our writes (which would explain why the scenario reads
    // the wrong values).
    const startedAt = Date.now();
    const tick = setInterval(function () {
      const elapsed = Date.now() - startedAt;
      console.log('[Loan Amount] +' + elapsed + 'ms downAmt=' + (dAmt && dAmt.value) + ' downPct=' + (dPct && dPct.value));
      if (elapsed > 4000) clearInterval(tick);
    }, 500);
    console.groupEnd();
  };

  const wirePartner = (el) => {
    if (!el || el.getAttribute(WIRED_ATTR) === '1') return;
    el.setAttribute(WIRED_ATTR, '1');
    const handler = () => {
      if (suppressEcho) return;
      recalcLoanDisplay();
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
    el.addEventListener('blur', handler);
  };

  const buildAndInsert = () => {
    if (document.querySelector(`[${FIELD_ATTR}]`)) return;
    const purchaseInput = $purchase();
    if (!purchaseInput) return;
    const purchaseField = purchaseInput.closest('[class*="StyledFormField"]');
    if (!purchaseField) return;

    const clone = purchaseField.cloneNode(true);
    clone.setAttribute(FIELD_ATTR, 'true');

    const newInputId = '__zhl_la_input';
    const newLabelId = '__zhl_la_label';
    const newAdornId = '__zhl_la_adorn';

    clone.querySelectorAll('label').forEach((lbl) => {
      if (lbl.getAttribute('aria-hidden') === 'true') {
        lbl.id = newAdornId;
        lbl.setAttribute('for', newInputId);
      } else {
        lbl.id = newLabelId;
        lbl.setAttribute('for', newInputId);
        lbl.removeAttribute('data-required');
        lbl.textContent = 'Loan amount';
      }
    });

    const newInput = clone.querySelector('input');
    if (!newInput) return;
    newInput.id = newInputId;
    newInput.setAttribute('aria-labelledby', `${newLabelId} ${newAdornId}`);
    newInput.removeAttribute('name');
    newInput.removeAttribute('required');
    newInput.removeAttribute('aria-required');
    newInput.removeAttribute('aria-invalid');
    newInput.value = '';
    newInput.setAttribute(LOAN_INPUT_ATTR, 'true');
    newInput.setAttribute('autocomplete', 'off');

    newInput.addEventListener('blur', applyLoanEdit);
    newInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        newInput.blur();
      }
    });

    const grid = purchaseField.parentElement;
    const wrapper = document.createElement('div');
    wrapper.style.marginTop = '12px';
    wrapper.appendChild(clone);
    grid.insertAdjacentElement('afterend', wrapper);
  };

  const tick = () => {
    buildAndInsert();
    wirePartner($purchase());
    wirePartner($downAmt());
    wirePartner($downPct());
    recalcLoanDisplay();
  };

  const observer = new MutationObserver(() => tick());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  tick();
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
