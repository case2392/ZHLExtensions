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

  // React-controlled inputs need TRUSTED input events to actually
  // commit a programmatic write into the underlying React state.
  // The synthetic events dispatched by setter+dispatchEvent have
  // isTrusted=false, which the Constellation form library (LOP's
  // form framework) ignores for dirty-state tracking — so the
  // input.value updates visually but LOP's pricing engine keeps the
  // old number. Mirrors the va-calc.js setReactInputValue pattern
  // that fixed the same bug there.
  //
  // Path: focus → select existing text → execCommand('insertText')
  // → real .blur(). insertText routes through the browser's input
  // pipeline and produces trusted input/change events. The native
  // setter is kept as a fallback for browsers where execCommand
  // returns false (rare for Chrome but possible).
  const setReactValue = (el, value) => {
    const v = String(value);
    let viaExec = false;
    try {
      el.focus();
      try { el.setSelectionRange(0, (el.value || '').length); }
      catch (_) { try { el.select(); } catch (__) {} }
      viaExec = document.execCommand && document.execCommand('insertText', false, v);
    } catch (_) { viaExec = false; }
    if (!viaExec || String(el.value) !== v) {
      const proto = el.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, v);
      else el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  // Real .blur() (the DOM method, not a dispatched event) is what
  // forces React to fire its onBlur handler and commit the field.
  // A synthetic blur event with isTrusted=false often gets ignored.
  const fireCommit = (el) => {
    el.dispatchEvent(new Event('change', { bubbles: true }));
    try { el.blur(); } catch (_) {}
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

  const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));

  const applyLoanEdit = async () => {
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

    suppressEcho = true;
    try {
      // Write the DOLLAR amount first. LOP's React form has the
      // dollar amount as the source of truth — writing it triggers
      // LOP's own onChange handler which recomputes the percent
      // internally. We give it 200ms to settle before writing the
      // percent so the two writes don't race.
      if (dAmt) {
        setReactValue(dAmt, newDown.toFixed(2));
        try { dAmt.blur(); } catch (_) {}
        await waitMs(200);
        console.log('after dAmt write+blur — value:', dAmt.value);
      }
      // Then write the percent explicitly, in case LOP didn't
      // recompute it. Same trusted-event pattern + real blur +
      // settle.
      if (dPct) {
        setReactValue(dPct, newPct.toFixed(2));
        try { dPct.blur(); } catch (_) {}
        await waitMs(200);
        console.log('after dPct write+blur — value:', dPct.value);
      }
    } finally {
      await waitMs(50);
      suppressEcho = false;
    }
    // Verify the writes stuck. If LOP's React state reverted, the
    // input value will revert too. This is the smoking-gun log for
    // "did the down payment actually propagate to LOP's pricing
    // engine state".
    await waitMs(800);
    console.log('[Loan Amount] +1s settled — downAmt=' + (dAmt && dAmt.value) + ' downPct=' + (dPct && dPct.value));
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
  // LOP's purchase-price change keeps the down PERCENT constant and
  // programmatically rewrites the down-payment dollar input via React
  // state. React.value updates don't fire DOM input/change events,
  // and the MutationObserver doesn't see input.value writes either
  // (it's a property, not an attribute), so our wirePartner handlers
  // never fire after a purchase change. Result: loan amount stays at
  // (new purchase - OLD down), e.g. $540k - $100k = $440k even when
  // LOP rebalanced down to $67,500. Heartbeat poll picks the new
  // value up. We skip when the loan input is focused so we don't
  // overwrite text mid-type.
  setInterval(recalcLoanDisplay, 500);
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
