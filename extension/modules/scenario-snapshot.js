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

  function padLabel(label, width) {
    if (label.length >= width) return label;
    return label + ' '.repeat(width - label.length);
  }

  function buildPlainTextSnapshot(title, subtitle, status, priced, fields, dialogs) {
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
      lines.push(padLabel(f.label, labelWidth) + '    ' + f.value);
    });

    // Dialog details (clicked through from the blue links on the card).
    (dialogs || []).forEach(function (d) {
      lines.push('');
      lines.push('--- ' + d.title + ' ---');
      let dialogLabelWidth = 0;
      (d.items || []).forEach(function (it) {
        if (it.type === 'kv' && it.label.length > dialogLabelWidth) dialogLabelWidth = it.label.length;
      });
      if (dialogLabelWidth > 28) dialogLabelWidth = 28;
      (d.items || []).forEach(function (it) {
        if (it.type === 'header')    lines.push('', '## ' + it.text, '');
        else if (it.type === 'tab')  lines.push('', '[' + it.text + ']');
        else if (it.type === 'subheader') lines.push('', it.text);
        else if (it.type === 'note') lines.push(it.text);
        else if (it.type === 'kv')   lines.push(padLabel(it.label, dialogLabelWidth) + '    ' + it.value);
        else if (it.type === 'table') {
          it.rows.forEach(function (cells) { lines.push(cells.join('\t')); });
        }
      });
    });

    lines.push('');
    lines.push('— Captured via ZHL Productivity Pack v' + VERSION);
    return lines.join('\n');
  }

  // ---- Deep dialog capture ----------------------------------------
  //
  // Four blue-link buttons on the scenario card open detail dialogs:
  //   Points / Price        → "Adjustments and compliance"
  //   Monthly P&I / PITI    → "Payment breakdown"
  //   Total closing costs   → "Detailed cost summary"
  //   Cash (to) / from      → "Cash (to)/from breakdown"
  //
  // The snapshot opens each dialog in turn, parses its contents,
  // closes it, then moves to the next. The user gets one
  // consolidated snapshot that includes everything.

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function waitFor(fn, timeoutMs) {
    return new Promise(function (resolve) {
      const start = Date.now();
      (function tick() {
        let v;
        try { v = fn(); } catch (_) { v = null; }
        if (v) return resolve(v);
        if (Date.now() - start >= (timeoutMs || 2000)) return resolve(null);
        setTimeout(tick, 50);
      })();
    });
  }

  function isHidden(el) {
    return !el || (el.hasAttribute && el.hasAttribute('hidden'));
  }
  function visibleText(el) {
    return (el && el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Find buttons on the card that open a Detail dialog. These are the
  // blue-text <button class="StyledTextButton..."> wrapping a <p> in
  // the data rows. Excludes the Re-price action button and the 3-dots
  // menu trigger.
  function findDialogButtons(card) {
    const out = [];
    card.querySelectorAll('button[class*="StyledTextButton"]').forEach(function (b) {
      if (b.disabled) return;
      if (b.closest('[aria-label="Scenario card buttons"]')) return;
      if (b.closest('[class*="MenuPopper"]')) return;
      const p = b.querySelector('p');
      if (!p || !visibleText(p)) return;
      out.push(b);
    });
    return out;
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    const close = dialog.querySelector('footer button')
               || dialog.querySelector('[class*="DialogClose"] button')
               || dialog.querySelector('button[aria-label="Close"]');
    if (close) { try { close.click(); return; } catch (_) {} }
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', bubbles: true, cancelable: true
      }));
    } catch (_) {}
  }

  async function captureDialogFor(triggerBtn) {
    const before = new Set();
    document.querySelectorAll('section[role="dialog"][aria-modal="true"]').forEach(function (d) { before.add(d); });

    try { triggerBtn.click(); } catch (_) { return null; }

    const dialog = await waitFor(function () {
      const all = document.querySelectorAll('section[role="dialog"][aria-modal="true"]');
      for (const d of all) if (!before.has(d)) return d;
      return null;
    }, 2500);
    if (!dialog) return null;

    await sleep(120); // let internal content render

    const titleEl = dialog.querySelector('header h4') || dialog.querySelector('h4');
    const title = titleEl ? visibleText(titleEl) : '';
    const items = parseDialogBody(dialog);

    closeDialog(dialog);
    await waitFor(function () { return !document.body.contains(dialog); }, 1500);
    await sleep(80);

    return { title: title, items: items };
  }

  // Compliance section: 3-column Grid with label / value / status icon.
  // <div class="Grid... dJAknD">
  //   <div class="Grid..."> <span>Label</span> </div>
  //   <div class="Grid..."> <span>Value</span> <span hidden-dupe>Value</span> </div>
  //   <div class="Grid..."> [SVG icon] or <span>Status text</span> </div>
  // </div>
  function looksLikeComplianceRow(el) {
    if (!el || el.tagName !== 'DIV') return false;
    if (!/Grid-c11n/.test(el.className || '')) return false;
    const cols = Array.from(el.children).filter(function (c) {
      return /Grid-c11n/.test(c.className || '');
    });
    return cols.length === 3;
  }

  function extractComplianceRow(el) {
    const cols = Array.from(el.children).filter(function (c) {
      return /Grid-c11n/.test(c.className || '');
    });
    if (cols.length !== 3) return null;
    const label  = visibleText(cols[0]);
    // The value column often has 2 sibling spans with the same text
    // (presentation duplicate). Dedupe a "X X" pattern.
    let value = visibleText(cols[1]);
    const dup = value.match(/^(.+?)\s+\1$/);
    if (dup) value = dup[1];
    const status = visibleText(cols[2]);
    if (!label) return null;
    return {
      label: label,
      value: status ? (value ? value + ' — ' + status : status) : value
    };
  }

  // Generic 2-child Flex row: a Flex container whose children resolve
  // to exactly 2 text-bearing branches (label, value). Used by Payment
  // breakdown, Cash to/from, Detailed cost summary line items.
  function looksLikeKVRow(el) {
    if (!el || el.tagName !== 'DIV') return false;
    if (!/Flex-c11n/.test(el.className || '')) return false;
    const kids = Array.from(el.children).filter(function (c) {
      return !isHidden(c) && c.tagName !== 'SVG';
    });
    if (kids.length < 2) return false;
    const withText = kids.filter(function (c) { return visibleText(c); });
    return withText.length === 2;
  }

  function extractKVRow(el) {
    const kids = Array.from(el.children).filter(function (c) {
      return !isHidden(c) && c.tagName !== 'SVG' && visibleText(c);
    });
    if (kids.length < 2) return null;
    return { label: visibleText(kids[0]), value: visibleText(kids[kids.length - 1]) };
  }

  function parseDialogBody(dialog) {
    const body = dialog.querySelector('[class*="DialogBody"]');
    if (!body) return [];
    const out = [];
    walkDialog(body, out, 0);
    // De-noise: drop kv rows where label == value (header-style sibling
    // pairs like "APR | Interest rate" — those are headers, not rows).
    // We still want to preserve them as a paired header line, though.
    return out;
  }

  function walkDialog(node, out, depth) {
    if (depth > 14) return;
    if (!node || isHidden(node)) return;

    for (const child of node.children) {
      if (isHidden(child)) continue;
      const tag = child.tagName;
      const cls = child.className || '';

      // Skip non-content
      if (tag === 'SVG' || tag === 'INPUT' || tag === 'IMG') continue;
      if (/DialogFooter|DialogClose/.test(cls)) continue;
      if (tag === 'BUTTON' && !child.querySelector('p')) continue;

      // Headers
      if (/^H[1-6]$/.test(tag)) {
        const t = visibleText(child);
        if (t) out.push({ type: 'header', text: t });
        continue;
      }

      // <p> section titles (Adjustments+Compliance "Base", "QM", "HOEPA";
      // Detailed cost summary "Loan costs", "Other costs", "Credits";
      // Cash to/from "Upfront costs", etc).
      if (tag === 'P') {
        const t = visibleText(child);
        if (!t) continue;
        const isHeaderClass = /sc-30b5f76e-1|sc-7e7c7851-[14]|sc-66fe4c72-[02]/.test(cls);
        if (isHeaderClass && t.length < 60) {
          out.push({ type: 'subheader', text: t });
          continue;
        }
        // Otherwise emit as a note (rare — footer annotations like Closing corp quote ID)
        if (t.length < 200) out.push({ type: 'note', text: t });
        continue;
      }

      // Tabpanel — emit a tab marker, then descend into the panel
      // even if hidden (we want all tabs' contents).
      if (child.matches && child.matches('[role="tabpanel"]')) {
        const tabId = child.getAttribute('aria-labelledby');
        const tabBtn = tabId ? document.getElementById(tabId) : null;
        const name = tabBtn ? visibleText(tabBtn) : '';
        if (name) out.push({ type: 'tab', text: name });
        walkDialog(child, out, depth + 1);
        continue;
      }

      // Tables (Adjustments Table)
      if (tag === 'TABLE') {
        const rows = [];
        child.querySelectorAll('thead tr, tbody tr').forEach(function (tr) {
          const cells = Array.from(tr.querySelectorAll('th, td')).map(visibleText);
          if (cells.some(Boolean)) rows.push(cells);
        });
        if (rows.length) out.push({ type: 'table', rows: rows });
        continue;
      }

      // Compliance 3-column row
      if (looksLikeComplianceRow(child)) {
        const r = extractComplianceRow(child);
        if (r) { out.push({ type: 'kv', label: r.label, value: r.value }); continue; }
      }

      // Generic 2-child Flex KV row
      if (looksLikeKVRow(child)) {
        const r = extractKVRow(child);
        if (r) { out.push({ type: 'kv', label: r.label, value: r.value }); continue; }
      }

      // Descend
      walkDialog(child, out, depth + 1);
    }
  }

  async function captureAllDialogs(card) {
    const buttons = findDialogButtons(card);
    const captured = [];
    for (const btn of buttons) {
      // Defensive cleanup: ensure no dialog is open
      const stray = document.querySelector('section[role="dialog"][aria-modal="true"]');
      if (stray) { closeDialog(stray); await sleep(150); }
      const result = await captureDialogFor(btn);
      if (result) captured.push(result);
    }
    const stray = document.querySelector('section[role="dialog"][aria-modal="true"]');
    if (stray) closeDialog(stray);
    return captured;
  }

  function renderDialogSectionHtml(d) {
    const parts = [];
    parts.push(
      '<div style="margin-top:14px;padding-top:12px;border-top:2px solid #e5e7eb;">' +
        '<div style="font:700 12.5px inherit;color:#0b3a73;margin-bottom:6px;">' + escHtml(d.title) + '</div>'
    );
    (d.items || []).forEach(function (it) {
      if (it.type === 'header') {
        parts.push('<div style="margin:8px 0 4px;font:700 11.5px inherit;color:#1e293b;">' + escHtml(it.text) + '</div>');
      } else if (it.type === 'tab') {
        parts.push('<div style="margin:7px 0 3px;font:700 10.5px inherit;color:#006aff;text-transform:uppercase;letter-spacing:1px;">' + escHtml(it.text) + '</div>');
      } else if (it.type === 'subheader') {
        parts.push('<div style="margin:6px 0 2px;font:700 11px inherit;color:#334155;">' + escHtml(it.text) + '</div>');
      } else if (it.type === 'note') {
        parts.push('<div style="margin:3px 0;font:400 11px inherit;color:#64748b;font-style:italic;">' + escHtml(it.text) + '</div>');
      } else if (it.type === 'kv') {
        parts.push(
          '<div style="display:flex;justify-content:space-between;gap:14px;padding:4px 0;border-bottom:1px solid #f1f5f9;">' +
            '<span style="color:#475569;font-size:11.5px;">' + escHtml(it.label) + '</span>' +
            '<span style="color:#0f172a;font-size:11.5px;font-weight:600;text-align:right;">' + escHtml(it.value) + '</span>' +
          '</div>'
        );
      } else if (it.type === 'table') {
        parts.push('<table style="width:100%;border-collapse:collapse;font:500 11px inherit;margin:4px 0;">');
        it.rows.forEach(function (cells, idx) {
          const cellTag = idx === 0 ? 'th' : 'td';
          parts.push('<tr>' + cells.map(function (c) {
            return '<' + cellTag + ' style="padding:3px 6px;border-bottom:1px solid #f1f5f9;text-align:left;">' + escHtml(c) + '</' + cellTag + '>';
          }).join('') + '</tr>');
        });
        parts.push('</table>');
      }
    });
    parts.push('</div>');
    return parts.join('');
  }

  async function showSnapshotModal(card) {
    const existing = document.getElementById(MODAL_ID);
    if (existing) existing.remove();

    const title    = getCardTitle(card);
    const subtitle = getCardSubtitle(card);
    const status   = getCardStatus(card);
    const priced   = getPricedTimestamp(card);
    const fields   = readAllCardFields(card);

    // Build overlay + loading state immediately so the user sees feedback
    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483646',
      'background:rgba(15,23,42,0.55)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif',
      'padding:24px'
    ].join(';');

    const card_ = document.createElement('div');
    card_.style.cssText = [
      'background:#fff', 'border-radius:10px',
      'max-width:560px', 'width:100%',
      'max-height:calc(100vh - 48px)', 'overflow-y:auto',
      'box-shadow:0 18px 48px rgba(0,0,0,0.3)',
      'color:#0f172a'
    ].join(';');

    const statusBadge = status
      ? '<span style="display:inline-block;background:' + (status === 'ASSIGNED TO LOAN' ? '#dcfce7' : '#fee2e2') + ';color:' + (status === 'ASSIGNED TO LOAN' ? '#065f46' : '#991b1b') + ';font-size:10px;font-weight:700;letter-spacing:1px;padding:3px 8px;border-radius:100px;margin-right:8px;">' + escHtml(status) + '</span>'
      : '';

    let fieldsHtml = '';
    fields.forEach(function (f) {
      fieldsHtml +=
        '<div style="display:flex;justify-content:space-between;gap:14px;padding:6px 0;border-bottom:1px solid #f1f5f9;">' +
          '<span style="color:#475569;font-size:12.5px;">' + escHtml(f.label) + '</span>' +
          '<span style="color:#0f172a;font-size:12.5px;font-weight:600;text-align:right;">' + escHtml(f.value) + '</span>' +
        '</div>';
    });

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
      '<div id="zhl-ss-body" style="padding:6px 20px 16px;">' +
        fieldsHtml +
        '<div id="zhl-ss-deep" style="margin-top:10px;padding:8px 10px;background:#eff6ff;border-radius:6px;color:#0b3a73;font:500 11.5px inherit;display:flex;align-items:center;gap:8px;">' +
          '<span style="display:inline-block;width:10px;height:10px;border:2px solid #006aff;border-top-color:transparent;border-radius:50%;animation:zhl-ss-spin 0.7s linear infinite;"></span>' +
          '<span>Capturing detail dialogs (Points, P&I, Closing costs, Cash to/from)…</span>' +
        '</div>' +
      '</div>' +
      '<div style="padding:12px 20px 16px;border-top:1px solid #e5e7eb;display:flex;gap:8px;justify-content:flex-end;align-items:center;background:#fafbfc;border-radius:0 0 10px 10px;">' +
        '<button id="zhl-ss-copy" disabled style="padding:7px 12px;background:#fff;color:#94a3b8;border:1px solid #e2e8f0;border-radius:5px;font:600 12.5px inherit;cursor:not-allowed;">Copy as text</button>' +
        '<button id="zhl-ss-print" disabled style="padding:7px 12px;background:#cbd5e1;color:#fff;border:1px solid #cbd5e1;border-radius:5px;font:600 12.5px inherit;cursor:not-allowed;">Print</button>' +
        '<button id="zhl-ss-close" style="padding:7px 12px;background:#006aff;color:#fff;border:1px solid #006aff;border-radius:5px;font:600 12.5px inherit;cursor:pointer;">Close</button>' +
      '</div>' +
      '<div style="padding:8px 20px 12px;font:400 10.5px inherit;color:#94a3b8;border-top:1px solid #f1f5f9;text-align:right;">' + escHtml(ZHL_TIP) + '</div>' +
      '<style>@keyframes zhl-ss-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }</style>';

    overlay.appendChild(card_);
    document.body.appendChild(overlay);

    let cancelled = false;
    function dismiss() { cancelled = true; try { overlay.remove(); } catch (_) {} }
    card_.querySelector('#zhl-ss-close').addEventListener('click', dismiss);
    card_.querySelector('#zhl-ss-close-x').addEventListener('click', dismiss);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) dismiss(); });

    track('scenario_snapshot_open', { fieldCount: fields.length });

    // Async capture all dialogs, then enable Copy/Print and append data
    let dialogs = [];
    try {
      dialogs = await captureAllDialogs(card);
    } catch (e) {
      console.warn('[ZHL Snapshot] dialog capture failed', e);
    }
    if (cancelled) return;

    // Replace the loading indicator with the rendered dialog sections
    const body = card_.querySelector('#zhl-ss-body');
    const loader = card_.querySelector('#zhl-ss-deep');
    if (loader) loader.remove();
    let html = '';
    dialogs.forEach(function (d) { html += renderDialogSectionHtml(d); });
    if (!html) {
      html = '<div style="margin-top:10px;padding:8px 10px;background:#fef3c7;border-radius:6px;color:#92400e;font:500 11.5px inherit;">Detail dialogs unavailable — captured card fields only.</div>';
    }
    body.insertAdjacentHTML('beforeend', html);

    // Enable buttons now that we have the full payload
    const copyBtn  = card_.querySelector('#zhl-ss-copy');
    const printBtn = card_.querySelector('#zhl-ss-print');
    copyBtn.disabled = false;
    copyBtn.style.background = '#fff';
    copyBtn.style.color = '#0f172a';
    copyBtn.style.borderColor = '#cbd5e1';
    copyBtn.style.cursor = 'pointer';
    printBtn.disabled = false;
    printBtn.style.background = '#0b3a73';
    printBtn.style.color = '#fff';
    printBtn.style.borderColor = '#0b3a73';
    printBtn.style.cursor = 'pointer';

    copyBtn.addEventListener('click', function () {
      const txt = buildPlainTextSnapshot(title, subtitle, status, priced, fields, dialogs);
      const orig = copyBtn.textContent;
      try {
        navigator.clipboard.writeText(txt).then(function () {
          copyBtn.textContent = '✓ Copied';
          setTimeout(function () { copyBtn.textContent = orig; }, 1500);
          track('scenario_snapshot_copy', { fieldCount: fields.length, dialogCount: dialogs.length });
        }).catch(function (e) {
          console.warn('[ZHL Snapshot] clipboard write failed', e);
          copyBtn.textContent = '✗ Copy failed';
          setTimeout(function () { copyBtn.textContent = orig; }, 1500);
        });
      } catch (e) {
        console.warn('[ZHL Snapshot] clipboard API unavailable', e);
        copyBtn.textContent = '✗ Copy unavailable';
      }
    });

    printBtn.addEventListener('click', function () {
      openPrintView(title, subtitle, status, priced, fields, dialogs);
      track('scenario_snapshot_print', { fieldCount: fields.length, dialogCount: dialogs.length });
    });
  }

  // Print path opens a separate window with print-formatted CSS and
  // triggers window.print() so the LO can save as PDF / send to a
  // printer without our modal's overlay interfering.
  function openPrintView(title, subtitle, status, priced, fields, dialogs) {
    const w = window.open('', '_blank', 'width=720,height=960');
    if (!w) {
      alert('Print blocked by your browser\'s popup setting. Allow popups for LOP, or use Copy as text.');
      return;
    }
    let mainRows = '';
    fields.forEach(function (f) {
      mainRows += '<tr><td>' + escHtml(f.label) + '</td><td>' + escHtml(f.value) + '</td></tr>';
    });

    function renderDialogSection(d) {
      const parts = [];
      parts.push('<div class="dialog-section">');
      parts.push('<h2>' + escHtml(d.title) + '</h2>');
      (d.items || []).forEach(function (it) {
        if (it.type === 'header')       parts.push('<h3>' + escHtml(it.text) + '</h3>');
        else if (it.type === 'tab')     parts.push('<div class="tab">' + escHtml(it.text) + '</div>');
        else if (it.type === 'subheader') parts.push('<h4>' + escHtml(it.text) + '</h4>');
        else if (it.type === 'note')    parts.push('<div class="note">' + escHtml(it.text) + '</div>');
        else if (it.type === 'kv') {
          parts.push('<div class="kv"><span class="k">' + escHtml(it.label) + '</span><span class="v">' + escHtml(it.value) + '</span></div>');
        } else if (it.type === 'table') {
          parts.push('<table class="dtab"><tbody>');
          it.rows.forEach(function (cells, idx) {
            const tag = idx === 0 ? 'th' : 'td';
            parts.push('<tr>' + cells.map(function (c) { return '<' + tag + '>' + escHtml(c) + '</' + tag + '>'; }).join('') + '</tr>');
          });
          parts.push('</tbody></table>');
        }
      });
      parts.push('</div>');
      return parts.join('');
    }

    let dialogsHtml = '';
    (dialogs || []).forEach(function (d) { dialogsHtml += renderDialogSection(d); });

    w.document.open();
    w.document.write(
      '<!doctype html><html><head><meta charset="utf-8"><title>Scenario Snapshot — ' + escHtml(title) + '</title>' +
      '<style>' +
        'body{font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:#0f172a;padding:32px;max-width:680px;margin:0 auto;}' +
        '.eyebrow{font:700 10px/1.2 inherit;color:#006aff;text-transform:uppercase;letter-spacing:1.3px;margin-bottom:6px;}' +
        'h1{font:700 19px/1.25 inherit;color:#0b3a73;margin:0 0 4px;}' +
        '.subtitle{font:500 13px/1.4 inherit;color:#334155;margin-bottom:8px;}' +
        '.meta{margin:8px 0 14px;font:500 11.5px inherit;color:#475569;}' +
        '.status{display:inline-block;padding:2px 8px;border-radius:100px;font:700 10px inherit;letter-spacing:1px;margin-right:8px;}' +
        '.status.assigned{background:#dcfce7;color:#065f46;}' +
        '.status.reprice{background:#fee2e2;color:#991b1b;}' +
        'table{width:100%;border-collapse:collapse;margin-top:6px;}' +
        'td{padding:6px 4px;border-bottom:1px solid #e5e7eb;font-size:12px;}' +
        'td:first-child{color:#475569;}' +
        'td:last-child{color:#0f172a;font-weight:600;text-align:right;}' +
        '.dialog-section{margin-top:18px;padding-top:14px;border-top:2px solid #cbd5e1;page-break-inside:avoid;}' +
        '.dialog-section h2{font:700 14px inherit;color:#0b3a73;margin:0 0 6px;}' +
        '.dialog-section h3{font:700 12.5px inherit;color:#1e293b;margin:8px 0 4px;}' +
        '.dialog-section h4{font:700 11.5px inherit;color:#334155;margin:6px 0 2px;}' +
        '.dialog-section .tab{font:700 10px inherit;color:#006aff;text-transform:uppercase;letter-spacing:1.2px;margin:8px 0 4px;}' +
        '.dialog-section .note{font:400 11px inherit;color:#64748b;font-style:italic;margin:3px 0;}' +
        '.dialog-section .kv{display:flex;justify-content:space-between;gap:14px;padding:4px 0;border-bottom:1px solid #f1f5f9;}' +
        '.dialog-section .kv .k{color:#475569;font-size:11.5px;}' +
        '.dialog-section .kv .v{color:#0f172a;font-size:11.5px;font-weight:600;text-align:right;}' +
        '.dialog-section table.dtab th, .dialog-section table.dtab td{text-align:left;font-size:11px;padding:3px 6px;}' +
        '.footer{margin-top:22px;font:400 10.5px inherit;color:#94a3b8;text-align:right;}' +
        '@media print { body { padding:18px; } .dialog-section { page-break-inside:avoid; } }' +
      '</style></head><body>' +
      '<div class="eyebrow">Scenario Snapshot</div>' +
      '<h1>' + escHtml(title) + '</h1>' +
      (subtitle ? '<div class="subtitle">' + escHtml(subtitle) + '</div>' : '') +
      '<div class="meta">' +
        (status ? '<span class="status ' + (status === 'ASSIGNED TO LOAN' ? 'assigned' : 'reprice') + '">' + escHtml(status) + '</span>' : '') +
        (priced ? 'Priced: ' + escHtml(priced) : '') +
      '</div>' +
      '<table><tbody>' + mainRows + '</tbody></table>' +
      dialogsHtml +
      '<div class="footer">Captured via ZHL Productivity Pack v' + escHtml(VERSION) + ' &middot; ' + escHtml(ZHL_TIP) + '</div>' +
      '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},300);});<\/script>' +
      '</body></html>'
    );
    w.document.close();
  }

  // ---- 3-dots menu injection --------------------------------------
  //
  // Each scenario card has a 3-dots overflow menu next to the
  // RE-PRICE / ASSIGNED label. When the LO opens that menu, LOP
  // renders a <section role="menu"> with menuitem buttons (currently
  // just "View details"). We watch for that menu and inject a
  // "Snapshot" menuitem next to View details. Clicking it closes the
  // menu and opens the full snapshot modal.

  const MENUITEM_ATTR = 'data-zhl-snapshot-menuitem';

  function findCardFromTrigger(triggerContainer) {
    let cur = triggerContainer;
    while (cur && cur !== document.body) {
      // The scenario card body sits a few divs up from the trigger.
      // Use the same heuristic that already identifies a scenario card.
      if (cur.tagName === 'DIV' && isScenarioCard(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function injectSnapshotMenuItem(menu) {
    if (!menu || menu.querySelector('[' + MENUITEM_ATTR + ']')) return;
    const tabId = menu.getAttribute('aria-labelledby');
    if (!tabId) return;
    const triggerContainer = document.getElementById(tabId.split(/\s+/)[0]);
    if (!triggerContainer) return;
    const card = findCardFromTrigger(triggerContainer);
    if (!card) return;

    // Copy styling from an existing menuitem so our entry looks native.
    const existing = menu.querySelector('button[role="menuitem"]');
    if (!existing) return;

    const item = document.createElement('button');
    item.setAttribute('role', 'menuitem');
    item.setAttribute(MENUITEM_ATTR, '1');
    item.className = existing.className;
    item.textContent = 'Snapshot';
    item.title = 'Capture every field on this scenario card — including all detail dialogs — for a support ticket attachment.\n\n' + ZHL_TIP;
    item.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      // Close the menu by re-clicking the 3-dots trigger button (toggles).
      const triggerBtn = triggerContainer.querySelector('button');
      if (triggerBtn) { try { triggerBtn.click(); } catch (_) {} }
      // Open the snapshot — async, but we don't await here.
      showSnapshotModal(card);
    });
    menu.appendChild(item);
  }

  // Remove any leftover under-card buttons from earlier versions of
  // this module. Safe to call repeatedly.
  function cleanupLegacyButtons() {
    document.querySelectorAll('[' + BTN_WRAPPER_ATTR + ']').forEach(function (el) {
      try { el.remove(); } catch (_) {}
    });
  }

  let menuScheduled = false;
  function scheduleMenuScan() {
    if (menuScheduled) return;
    menuScheduled = true;
    requestAnimationFrame(function () {
      menuScheduled = false;
      if (!isOnScenariosPage()) return;
      document.querySelectorAll('section[role="menu"]').forEach(function (menu) {
        try { injectSnapshotMenuItem(menu); }
        catch (e) { console.warn('[ZHL Snapshot] menu inject error', e); }
      });
    });
  }

  const observer = new MutationObserver(scheduleMenuScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(function () {
    cleanupLegacyButtons();
    scheduleMenuScan();
  }, 2000);
  cleanupLegacyButtons();
  scheduleMenuScan();
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
