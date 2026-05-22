// ZHL Productivity Pack module — feature key: feature_netProceedsCalc
//
// Adds a "🏠 Net proceeds calc" button into the Assets section header on
// LOP's Financial Information page. Opens a modal with line items —
// Sale Price, Listing Agent Fee %, Buyer's Agent Fee %, Closing Costs,
// Mortgage/Loans/HELOC payoffs, Other — and live-computes the seller's
// net proceeds. Last values persist in localStorage for this tab.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_netProceedsCalc';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[Net Proceeds Calc v' + VERSION + '] loaded');

  const ZHL_TIP     = 'Built by Justin Case. Karma appreciated 💛';
  const BUTTON_ID   = 'zhl-net-proceeds-btn';
  const MODAL_ID    = 'zhl-net-proceeds-modal';
  const STORAGE_KEY = 'zhlNetProceedsValues';
  const DEFAULTS    = { salePrice: 0, listingPct: 3, buyerPct: 3, closingCosts: 0, payoffs: 0, other: 0 };

  // ---- formatting / parsing helpers ---------------------------------------
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
  function formatGroup(n) {
    if (!n && n !== 0) return '';
    const v = Number(n);
    if (!isFinite(v) || v === 0) return '';
    return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function formatPct(n) {
    if (n == null || isNaN(n)) return '0';
    return (Math.round(Number(n) * 1000) / 1000).toString();
  }

  // ---- compute ------------------------------------------------------------
  function compute(values) {
    const sale       = parseNum(values.salePrice);
    const listingFee = sale * (parseNum(values.listingPct) / 100);
    const buyerFee   = sale * (parseNum(values.buyerPct) / 100);
    const closing    = parseNum(values.closingCosts);
    const payoffs    = parseNum(values.payoffs);
    const other      = parseNum(values.other);
    const net        = sale - listingFee - buyerFee - closing - payoffs - other;
    return { sale, listingFee, buyerFee, closing, payoffs, other, net };
  }

  function loadValues() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (_) {}
    return Object.assign({}, DEFAULTS);
  }
  function saveValues(v) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch (_) {}
  }

  // ---- button injection ---------------------------------------------------
  function findAssetsSection() {
    return document.querySelector('[data-cy="assets-section"]');
  }
  function ensureButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const section = findAssetsSection();
    if (!section) return;
    // First child div holds the "Assets" h5 and the "Add asset or credit" button.
    const header = section.querySelector(':scope > div');
    if (!header) return;

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.title = 'Estimate net proceeds from sale of the current home.\n\n' + ZHL_TIP;
    btn.style.cssText = [
      'margin-left:12px',
      'padding:6px 12px',
      'background:#0b5cab',
      'color:#fff',
      'border:1px solid #0b5cab',
      'border-radius:6px',
      'font:600 12px/1.2 Arial, Helvetica, sans-serif',
      'cursor:pointer',
      'vertical-align:middle'
    ].join(';');
    btn.textContent = '🏠 Net proceeds calc';
    btn.addEventListener('mouseenter', function () { btn.style.background = '#0a4d8f'; });
    btn.addEventListener('mouseleave', function () { btn.style.background = '#0b5cab'; });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      openModal();
    });
    header.appendChild(btn);
  }

  // ---- modal --------------------------------------------------------------
  function closeModal() {
    const m = document.getElementById(MODAL_ID);
    if (m) m.remove();
  }

  function openModal() {
    closeModal();
    const data = loadValues();

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
      'max-width:580px',
      'width:92%',
      'max-height:92vh',
      'overflow:auto',
      'box-shadow:0 12px 40px rgba(0,0,0,0.3)'
    ].join(';');

    const inputBase = 'padding:6px 8px;border:1px solid #d1d5db;border-radius:4px;text-align:right;font:14px Arial,sans-serif;';
    const moneyInputStyle = inputBase + 'width:110px;';
    const pctInputStyle   = inputBase + 'width:60px;';
    const rowStyle = 'padding:9px 4px;border-bottom:1px solid #f3f4f6;';
    const labelStyle = rowStyle + 'color:#374151;';
    const inputCellStyle = rowStyle + 'text-align:right;';
    const amtCellStyle = rowStyle + 'text-align:right;width:135px;';
    const labelDimStyle = 'font-size:10px;color:#9ca3af;margin-top:2px;line-height:1.2;';

    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">' +
        '<h3 style="margin:0;font-size:18px;color:#0b5cab;">🏠 Net Proceeds from Sale</h3>' +
        '<button id="zhl-np-close" style="background:none;border:none;font-size:24px;color:#6b7280;cursor:pointer;line-height:1;padding:0 4px;margin-top:-4px;">×</button>' +
      '</div>' +
      '<p style="margin:0 0 14px;color:#6b7280;font-size:12px;">Estimate the seller\'s net proceeds after agent fees, closing costs, and payoffs. Defaults: 3% listing, 3% buyer, 1% closing costs (auto-fills from sale price).</p>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
        '<tbody>' +
          // Sale price
          '<tr>' +
            '<td style="' + labelStyle + '">Estimated Sale Price</td>' +
            '<td style="' + inputCellStyle + '">' +
              '<span style="color:#6b7280;margin-right:4px;">$</span>' +
              '<input id="np-sale" type="text" inputmode="decimal" value="' + formatGroup(data.salePrice) + '" style="' + moneyInputStyle + '" />' +
            '</td>' +
            '<td id="np-sale-amt" style="' + amtCellStyle + 'font-weight:600;color:#15803d;">$0.00</td>' +
          '</tr>' +
          // Listing fee
          '<tr>' +
            '<td style="' + labelStyle + '">Listing Agent Fee</td>' +
            '<td style="' + inputCellStyle + '">' +
              '<input id="np-listing-pct" type="text" inputmode="decimal" value="' + formatPct(data.listingPct) + '" style="' + pctInputStyle + '" />' +
              '<span style="color:#6b7280;margin-left:4px;">%</span>' +
            '</td>' +
            '<td id="np-listing-amt" style="' + amtCellStyle + 'color:#b91c1c;">-$0.00</td>' +
          '</tr>' +
          // Buyer fee
          '<tr>' +
            '<td style="' + labelStyle + '">Buyer\'s Agent Fee</td>' +
            '<td style="' + inputCellStyle + '">' +
              '<input id="np-buyer-pct" type="text" inputmode="decimal" value="' + formatPct(data.buyerPct) + '" style="' + pctInputStyle + '" />' +
              '<span style="color:#6b7280;margin-left:4px;">%</span>' +
            '</td>' +
            '<td id="np-buyer-amt" style="' + amtCellStyle + 'color:#b91c1c;">-$0.00</td>' +
          '</tr>' +
          // Closing costs
          '<tr>' +
            '<td style="' + labelStyle + '">' +
              'Estimated Closing Costs' +
              '<div style="' + labelDimStyle + '">Auto-fills at 1% of sale price; varies by state — adjust as needed.</div>' +
            '</td>' +
            '<td style="' + inputCellStyle + '">' +
              '<span style="color:#6b7280;margin-right:4px;">$</span>' +
              '<input id="np-closing" type="text" inputmode="decimal" value="' + formatGroup(data.closingCosts) + '" style="' + moneyInputStyle + '" />' +
            '</td>' +
            '<td id="np-closing-amt" style="' + amtCellStyle + 'color:#b91c1c;">-$0.00</td>' +
          '</tr>' +
          // Payoffs
          '<tr>' +
            '<td style="' + labelStyle + '">Mortgage / Loans / HELOC Payoffs</td>' +
            '<td style="' + inputCellStyle + '">' +
              '<span style="color:#6b7280;margin-right:4px;">$</span>' +
              '<input id="np-payoffs" type="text" inputmode="decimal" value="' + formatGroup(data.payoffs) + '" style="' + moneyInputStyle + '" />' +
            '</td>' +
            '<td id="np-payoffs-amt" style="' + amtCellStyle + 'color:#b91c1c;">-$0.00</td>' +
          '</tr>' +
          // Other
          '<tr>' +
            '<td style="' + labelStyle + '">Other</td>' +
            '<td style="' + inputCellStyle + '">' +
              '<span style="color:#6b7280;margin-right:4px;">$</span>' +
              '<input id="np-other" type="text" inputmode="decimal" value="' + formatGroup(data.other) + '" style="' + moneyInputStyle + '" />' +
            '</td>' +
            '<td id="np-other-amt" style="' + amtCellStyle + 'color:#b91c1c;">-$0.00</td>' +
          '</tr>' +
        '</tbody>' +
        '<tfoot>' +
          '<tr style="border-top:3px double #0b5cab;background:#f0f7ff;">' +
            '<td colspan="2" style="padding:14px 4px;font-weight:700;color:#0b5cab;font-size:14px;">Net Proceeds</td>' +
            '<td id="np-net" style="padding:14px 4px;text-align:right;font-weight:700;font-size:18px;color:#15803d;">$0.00</td>' +
          '</tr>' +
        '</tfoot>' +
      '</table>' +
      '<div style="margin-top:16px;display:flex;justify-content:space-between;align-items:center;gap:10px;">' +
        '<span style="color:#6b7280;font-size:11px;font-style:italic;">' + ZHL_TIP + '</span>' +
        '<div>' +
          '<button id="np-reset" type="button" style="background:#fff;color:#6b7280;border:1px solid #d1d5db;border-radius:4px;padding:6px 12px;font-size:12px;cursor:pointer;">Reset</button>' +
          '<button id="np-copy" type="button" style="background:#006aff;color:#fff;border:1px solid #006aff;border-radius:4px;padding:6px 14px;font-size:12px;cursor:pointer;margin-left:6px;font-weight:600;">Copy summary</button>' +
        '</div>' +
      '</div>';

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // -------- wire up inputs ----------
    const saleInput    = panel.querySelector('#np-sale');
    const listingInput = panel.querySelector('#np-listing-pct');
    const buyerInput   = panel.querySelector('#np-buyer-pct');
    const closingInput = panel.querySelector('#np-closing');
    const payoffsInput = panel.querySelector('#np-payoffs');
    const otherInput   = panel.querySelector('#np-other');
    const netCell      = panel.querySelector('#np-net');

    // Track whether user has touched closing manually — if not, keep
    // it auto-synced to 1% of sale price as they type.
    let userTouchedClosing = parseNum(data.closingCosts) > 0;

    function readValues() {
      return {
        salePrice:    parseNum(saleInput.value),
        listingPct:   parseNum(listingInput.value),
        buyerPct:     parseNum(buyerInput.value),
        closingCosts: parseNum(closingInput.value),
        payoffs:      parseNum(payoffsInput.value),
        other:        parseNum(otherInput.value)
      };
    }
    function update() {
      const v = readValues();
      const c = compute(v);
      panel.querySelector('#np-sale-amt').textContent    = formatMoney(c.sale);
      panel.querySelector('#np-listing-amt').textContent = c.listingFee === 0 ? '-$0.00' : '-' + formatMoney(c.listingFee);
      panel.querySelector('#np-buyer-amt').textContent   = c.buyerFee   === 0 ? '-$0.00' : '-' + formatMoney(c.buyerFee);
      panel.querySelector('#np-closing-amt').textContent = c.closing    === 0 ? '-$0.00' : '-' + formatMoney(c.closing);
      panel.querySelector('#np-payoffs-amt').textContent = c.payoffs    === 0 ? '-$0.00' : '-' + formatMoney(c.payoffs);
      panel.querySelector('#np-other-amt').textContent   = c.other      === 0 ? '-$0.00' : '-' + formatMoney(c.other);
      netCell.textContent = formatMoney(c.net);
      netCell.style.color = c.net >= 0 ? '#15803d' : '#b91c1c';
      saveValues(v);
    }

    saleInput.addEventListener('input', function () {
      if (!userTouchedClosing) {
        const sale = parseNum(saleInput.value);
        closingInput.value = sale > 0 ? formatGroup(Math.round(sale * 0.01)) : '';
      }
      update();
    });
    closingInput.addEventListener('input', function () { userTouchedClosing = true; update(); });
    [listingInput, buyerInput, payoffsInput, otherInput].forEach(function (el) {
      el.addEventListener('input', update);
    });

    // Blur formats the money fields with grouping (1,234,567)
    [saleInput, closingInput, payoffsInput, otherInput].forEach(function (el) {
      el.addEventListener('blur', function () {
        const n = parseNum(el.value);
        el.value = n > 0 ? formatGroup(n) : '';
      });
      el.addEventListener('focus', function () {
        el.select();
      });
    });

    // Close / reset / copy
    panel.querySelector('#zhl-np-close').addEventListener('click', closeModal);
    panel.querySelector('#np-reset').addEventListener('click', function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      closeModal();
      openModal();
    });
    panel.querySelector('#np-copy').addEventListener('click', function () {
      const v = readValues();
      const c = compute(v);
      const lines = [
        'Net Proceeds Estimate',
        '-----------------------------',
        'Sale price:             ' + formatMoney(c.sale),
        'Listing agent fee:      -' + formatMoney(c.listingFee) + '  (' + formatPct(v.listingPct) + '%)',
        'Buyer\'s agent fee:      -' + formatMoney(c.buyerFee) + '  (' + formatPct(v.buyerPct) + '%)',
        'Closing costs (est.):   -' + formatMoney(c.closing),
        'Mortgage/HELOC payoffs: -' + formatMoney(c.payoffs),
        'Other:                  -' + formatMoney(c.other),
        '-----------------------------',
        'NET PROCEEDS:           ' + formatMoney(c.net)
      ];
      const text = lines.join('\n');
      const btn = panel.querySelector('#np-copy');
      const orig = btn.textContent;
      function flash(msg) {
        btn.textContent = msg;
        setTimeout(function () { btn.textContent = orig; }, 1500);
      }
      try {
        navigator.clipboard.writeText(text).then(
          function () { flash('✓ Copied'); },
          function () { flash('✗ Copy failed'); console.log(text); }
        );
      } catch (e) {
        flash('✗ Copy failed');
        console.log(text);
      }
    });

    // Escape closes
    document.addEventListener('keydown', function onKey(e) {
      if (!document.getElementById(MODAL_ID)) {
        document.removeEventListener('keydown', onKey);
        return;
      }
      if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', onKey); }
    });

    update();
    saleInput.focus();
    saleInput.select();
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
