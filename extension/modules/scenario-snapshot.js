// ZHL Productivity Pack module — feature key: feature_scenarioSnapshot
//
// Adds a "Snapshot" button to each scenario card on the
// Pricing & Scenarios → Scenarios page. Clicking it opens a clean,
// single-viewport modal listing EVERY label/value on the card —
// designed so an LO can grab one screenshot to attach to a support
// ticket instead of scrolling and stitching multiple screenshots.
//
// Two action buttons inside the modal:
//   - Print: opens a print-formatted new tab and auto-triggers
//     window.print() so the LO can save as PDF or send to printer.
//   - Copy as text: writes a plain-text version of the snapshot to
//     the clipboard for pasting directly into a ticket body.

(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_scenarioSnapshot';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[ZHL Scenario Snapshot v' + VERSION + '] loaded');

  const BTN_WRAPPER_ATTR = 'data-zhl-scenario-snapshot';
  const MODAL_ID = 'zhl-scenario-snapshot-modal';
  const ZHL_TIP = 'Built by Justin Case. Karma appreciated 💛';

  function track(event, props) {
    try { chrome.runtime.sendMessage({ type: 'TRACK', event: event, props: props || {} }); } catch (_) {}
  }

  function isOnScenariosPage() {
    return /\/pricing-and-scenarios\/scenarios/i.test(location.pathname);
  }

  function isScenarioCard(card) {
    const text = card.textContent || '';
    return text.indexOf('Loan purpose') !== -1
      && text.indexOf('Total loan amount') !== -1
      && text.indexOf('Interest rate') !== -1;
  }

  function getCardTitle(card) {
    const ps = card.querySelectorAll('p');
    for (const p of ps) {
      const t = (p.textContent || '').trim();
      if (/\d{1,2}\s*Yr\s*(Fixed|ARM|FHA|VA|Jumbo)/i.test(t)) return t;
    }
    return ps.length ? (ps[0].textContent || '').trim() : 'Scenario';
  }

  // Status flag at the top of the card — either "ASSIGNED TO LOAN" or
  // "RE-PRICE" (or absent on a fresh scenario). Surfaced in the
  // snapshot so support sees it.
  function getCardStatus(card) {
    const text = (card.textContent || '');
    if (/ASSIGNED\s*TO\s*LOAN/i.test(text)) return 'ASSIGNED TO LOAN';
    if (/RE-PRICE/i.test(text)) return 'RE-PRICE';
    return '';
  }

  // The card has a "Priced: <timestamp>" line; capture it so support
  // knows the freshness of the snapshot.
  function getPricedTimestamp(card) {
    const ps = card.querySelectorAll('p, span, time, small');
    for (const el of ps) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const m = t.match(/^Priced:\s*(.+)$/i);
      if (m) return m[1].trim();
    }
    return '';
  }

  // Subtitle line under the title — e.g. "Purchase - $291,000.00"
  function getCardSubtitle(card) {
    const ps = card.querySelectorAll('p');
    for (const p of ps) {
      const t = (p.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^(Purchase|Refinance|Cash\-?out)\s*[-–—]\s*\$/i.test(t)) return t;
    }
    return '';
  }

  // Walk every label/value row on the card and return them in DOM
  // order. Each "row" is a div whose <span> is the label and <p> is
  // the value. We dedupe by row element so we don't double-count
  // when a span is nested.
  function readAllCardFields(card) {
    const out = [];
    const seenRows = new Set();
    const spans = card.querySelectorAll('span');
    spans.forEach(function (span) {
      const label = (span.textContent || '').replace(/\s+/g, ' ').trim();
      if (!label) return;
      if (label.length > 60) return; // skip long paragraphs accidentally captured
      // Skip the title / subtitle / status / priced lines — those go in the header.
      if (/^(ASSIGNED\s*TO\s*LOAN|RE-PRICE)$/i.test(label)) return;
      if (/^Priced:/i.test(label)) return;
      const row = span.parentElement;
      if (!row || seenRows.has(row)) return;
      // The label/value row pattern is <div><span>Label</span><p>Value</p></div>.
      // Skip elements that don't match (the title block, badges, etc.).
      const p = row.querySelector(':scope > p');
      if (!p) return;
      const value = (p.textContent || '').replace(/\s+/g, ' ').trim();
      if (!value) return;
      seenRows.add(row);
      out.push({ label: label, value: value });
    });
    return out;
  }

  // ---- Modal UI ---------------------------------------------------
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function buildPlainTextSnapshot(title, subtitle, status, priced, fields) {
    const lines = [];
    lines.push('Scenario Snapshot');
    lines.push('=================');
    lines.push(title);
    if (subtitle) lines.push(subtitle);
    if (status) lines.push('Status: ' + status);
    if (priced) lines.push('Priced: ' + priced);
    lines.push('');
    // Right-pad labels to a fixed column so the text is readable when
    // pasted into a fixed-width font (tickets, Slack code blocks, etc.).
    let labelWidth = 0;
    fields.forEach(function (f) { if (f.label.length > labelWidth) labelWidth = f.label.length; });
    if (labelWidth > 24) labelWidth = 24;
    fields.forEach(function (f) {
      const pad = f.label.length < labelWidth ? ' '.repeat(labelWidth - f.label.length) : '';
      lines.push(f.label + pad + '    ' + f.value);
    });
    lines.push('');
    lines.push('— Captured via ZHL Productivity Pack v' + VERSION);
    return lines.join('\n');
  }

  function showSnapshotModal(card) {
    const existing = document.getElementById(MODAL_ID);
    if (existing) existing.remove();

    const title    = getCardTitle(card);
    const subtitle = getCardSubtitle(card);
    const status   = getCardStatus(card);
    const priced   = getPricedTimestamp(card);
    const fields   = readAllCardFields(card);

    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483646',
      'background:rgba(15,23,42,0.55)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif',
      'padding:24px'
    ].join(';');

    let fieldsHtml = '';
    fields.forEach(function (f) {
      fieldsHtml +=
        '<div style="display:flex;justify-content:space-between;gap:14px;padding:6px 0;border-bottom:1px solid #f1f5f9;">' +
          '<span style="color:#475569;font-size:12.5px;">' + escHtml(f.label) + '</span>' +
          '<span style="color:#0f172a;font-size:12.5px;font-weight:600;text-align:right;">' + escHtml(f.value) + '</span>' +
        '</div>';
    });

    const statusBadge = status
      ? '<span style="display:inline-block;background:' + (status === 'ASSIGNED TO LOAN' ? '#dcfce7' : '#fee2e2') + ';color:' + (status === 'ASSIGNED TO LOAN' ? '#065f46' : '#991b1b') + ';font-size:10px;font-weight:700;letter-spacing:1px;padding:3px 8px;border-radius:100px;margin-right:8px;">' + escHtml(status) + '</span>'
      : '';

    const card_ = document.createElement('div');
    card_.style.cssText = [
      'background:#fff', 'border-radius:10px',
      'max-width:520px', 'width:100%',
      'max-height:calc(100vh - 48px)', 'overflow-y:auto',
      'box-shadow:0 18px 48px rgba(0,0,0,0.3)',
      'color:#0f172a'
    ].join(';');
    card_.innerHTML =
      '<div style="padding:18px 20px 14px;border-bottom:1px solid #e5e7eb;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:11px;color:#006aff;text-transform:uppercase;letter-spacing:1.2px;font-weight:700;margin-bottom:4px;">Scenario Snapshot</div>' +
          '<h3 style="margin:0;font:700 17px/1.25 inherit;color:#0b3a73;">' + escHtml(title) + '</h3>' +
          (subtitle ? '<div style="margin-top:3px;font:500 12px/1.4 inherit;color:#334155;">' + escHtml(subtitle) + '</div>' : '') +
          '<div style="margin-top:8px;">' +
            statusBadge +
            (priced ? '<span style="font:500 11px inherit;color:#6b7280;">Priced: ' + escHtml(priced) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<button id="zhl-ss-close-x" aria-label="Close" style="background:none;border:none;font:400 22px/1 sans-serif;color:#6b7280;cursor:pointer;padding:0 2px;">&times;</button>' +
      '</div>' +
      '<div style="padding:6px 20px 16px;">' + fieldsHtml + '</div>' +
      '<div style="padding:12px 20px 16px;border-top:1px solid #e5e7eb;display:flex;gap:8px;justify-content:flex-end;align-items:center;background:#fafbfc;border-radius:0 0 10px 10px;">' +
        '<button id="zhl-ss-copy" style="padding:7px 12px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:5px;font:600 12.5px inherit;cursor:pointer;">Copy as text</button>' +
        '<button id="zhl-ss-print" style="padding:7px 12px;background:#0b3a73;color:#fff;border:1px solid #0b3a73;border-radius:5px;font:600 12.5px inherit;cursor:pointer;">Print</button>' +
        '<button id="zhl-ss-close" style="padding:7px 12px;background:#006aff;color:#fff;border:1px solid #006aff;border-radius:5px;font:600 12.5px inherit;cursor:pointer;">Close</button>' +
      '</div>' +
      '<div style="padding:8px 20px 12px;font:400 10.5px inherit;color:#94a3b8;border-top:1px solid #f1f5f9;text-align:right;">' + escHtml(ZHL_TIP) + '</div>';

    overlay.appendChild(card_);
    document.body.appendChild(overlay);

    function dismiss() { try { overlay.remove(); } catch (_) {} }
    card_.querySelector('#zhl-ss-close').addEventListener('click', dismiss);
    card_.querySelector('#zhl-ss-close-x').addEventListener('click', dismiss);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) dismiss(); });

    card_.querySelector('#zhl-ss-copy').addEventListener('click', function () {
      const txt = buildPlainTextSnapshot(title, subtitle, status, priced, fields);
      const btn = card_.querySelector('#zhl-ss-copy');
      const orig = btn.textContent;
      try {
        navigator.clipboard.writeText(txt).then(function () {
          btn.textContent = '✓ Copied';
          setTimeout(function () { btn.textContent = orig; }, 1500);
          track('scenario_snapshot_copy', { fieldCount: fields.length });
        }).catch(function (e) {
          console.warn('[ZHL Snapshot] clipboard write failed', e);
          btn.textContent = '✗ Copy failed';
          setTimeout(function () { btn.textContent = orig; }, 1500);
        });
      } catch (e) {
        console.warn('[ZHL Snapshot] clipboard API unavailable', e);
        btn.textContent = '✗ Copy unavailable';
      }
    });

    card_.querySelector('#zhl-ss-print').addEventListener('click', function () {
      openPrintView(title, subtitle, status, priced, fields);
      track('scenario_snapshot_print', { fieldCount: fields.length });
    });

    track('scenario_snapshot_open', { fieldCount: fields.length });
  }

  // Print path opens a separate window with print-formatted CSS and
  // triggers window.print() so the LO can save as PDF / send to a
  // printer without our modal's overlay interfering.
  function openPrintView(title, subtitle, status, priced, fields) {
    const w = window.open('', '_blank', 'width=700,height=900');
    if (!w) {
      alert('Print blocked by your browser\'s popup setting. Allow popups for LOP, or use Copy as text.');
      return;
    }
    let rows = '';
    fields.forEach(function (f) {
      rows += '<tr><td>' + escHtml(f.label) + '</td><td>' + escHtml(f.value) + '</td></tr>';
    });
    w.document.open();
    w.document.write(
      '<!doctype html><html><head><meta charset="utf-8"><title>Scenario Snapshot — ' + escHtml(title) + '</title>' +
      '<style>' +
        'body{font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:#0f172a;padding:32px;max-width:640px;margin:0 auto;}' +
        '.eyebrow{font:700 10px/1.2 inherit;color:#006aff;text-transform:uppercase;letter-spacing:1.3px;margin-bottom:6px;}' +
        'h1{font:700 19px/1.25 inherit;color:#0b3a73;margin:0 0 4px;}' +
        '.subtitle{font:500 13px/1.4 inherit;color:#334155;margin-bottom:8px;}' +
        '.meta{margin:8px 0 14px;font:500 11.5px inherit;color:#475569;}' +
        '.status{display:inline-block;padding:2px 8px;border-radius:100px;font:700 10px inherit;letter-spacing:1px;margin-right:8px;}' +
        '.status.assigned{background:#dcfce7;color:#065f46;}' +
        '.status.reprice{background:#fee2e2;color:#991b1b;}' +
        'table{width:100%;border-collapse:collapse;margin-top:10px;}' +
        'td{padding:7px 4px;border-bottom:1px solid #e5e7eb;font-size:12.5px;}' +
        'td:first-child{color:#475569;}' +
        'td:last-child{color:#0f172a;font-weight:600;text-align:right;}' +
        '.footer{margin-top:18px;font:400 10.5px inherit;color:#94a3b8;text-align:right;}' +
        '@media print { body { padding:18px; } }' +
      '</style></head><body>' +
      '<div class="eyebrow">Scenario Snapshot</div>' +
      '<h1>' + escHtml(title) + '</h1>' +
      (subtitle ? '<div class="subtitle">' + escHtml(subtitle) + '</div>' : '') +
      '<div class="meta">' +
        (status ? '<span class="status ' + (status === 'ASSIGNED TO LOAN' ? 'assigned' : 'reprice') + '">' + escHtml(status) + '</span>' : '') +
        (priced ? 'Priced: ' + escHtml(priced) : '') +
      '</div>' +
      '<table><tbody>' + rows + '</tbody></table>' +
      '<div class="footer">Captured via ZHL Productivity Pack v' + escHtml(VERSION) + ' &middot; ' + escHtml(ZHL_TIP) + '</div>' +
      '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},250);});<\/script>' +
      '</body></html>'
    );
    w.document.close();
  }

  // ---- Button injection -------------------------------------------
  // Each card's wrapper-parent already hosts the Calc 2-1 Buydown
  // button wrapper (when present). We add a sibling wrapper for
  // Snapshot so the two buttons stack consistently.
  function injectButton(card) {
    if (!isScenarioCard(card)) return;
    const wrapperParent = card.parentElement;
    if (!wrapperParent) return;
    if (wrapperParent.querySelector(':scope > [' + BTN_WRAPPER_ATTR + ']')) return;

    const wrapper = document.createElement('div');
    wrapper.setAttribute(BTN_WRAPPER_ATTR, '1');
    wrapper.style.cssText = 'margin: 6px 0 0 0; text-align: center;';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Snapshot';
    btn.title = 'Print or copy every field on this scenario card in one screen — useful when submitting LOP support tickets.\n\n' + ZHL_TIP;
    btn.style.cssText =
      'display:inline-block;padding:5px 14px;' +
      'background:#0b3a73;color:#fff;border:1px solid #0b3a73;border-radius:6px;' +
      'cursor:pointer;font:600 12px/1.2 Arial,Helvetica,sans-serif;' +
      'box-sizing:border-box;white-space:nowrap;';
    btn.addEventListener('mouseenter', function () { btn.style.background = '#062a55'; });
    btn.addEventListener('mouseleave', function () { btn.style.background = '#0b3a73'; });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      showSnapshotModal(card);
    });

    wrapper.appendChild(btn);
    wrapperParent.appendChild(wrapper);
  }

  function scanAndInject() {
    if (!isOnScenariosPage()) return;
    const candidates = document.querySelectorAll('div[class*="StyledCard"], div[class*="card"]');
    candidates.forEach(function (el) {
      try { injectButton(el); } catch (e) { console.warn('[ZHL Snapshot] inject error', e); }
    });
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      try { scanAndInject(); } catch (e) { console.warn('[ZHL Snapshot] scan error', e); }
    });
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
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
