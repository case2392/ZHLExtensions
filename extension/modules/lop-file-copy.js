// ZHL Productivity Pack module — feature key: feature_lopFileCopy
//
// "Copy LOP file" — stage every editable field on the source loan's
// Full Application page and paste them into a new (empty) loan.
//
// Workflow:
//   1. Open source loan → Full Application → click "Stage from this file".
//      Module snapshots every input/select/textarea/checkbox/radio with
//      a name attribute, plus a row count for every table section,
//      and stores the bundle under chrome.storage.local keyed by the
//      source loan ID. Stages persist across browser restarts and
//      multiple stages can co-exist (one per loan ID).
//   2. Open new loan → Full Application → click "Paste from staged".
//      Module shows a picker of available stages, then walks the
//      current page's named fields and writes the matching values.
//      Uses execCommand('insertText') + real .blur() (same trick as
//      loan-amount.js / va-calc.js) so React's controlled inputs
//      commit the value as if the user typed it. Radios / checkboxes
//      / selects use the native setter + a change event.
//   3. After paste, shows a summary panel: "Wrote N fields. Skipped
//      M (readonly/disabled). Manual entry needed for tables: X
//      addresses, Y employments, Z assets, A liabilities."
//
// Scope limitation in this v1:
//   - Tables (Addresses, Employment, Other income, Assets, Gifts,
//     Liabilities, Real estate) are NOT auto-pasted. Each row would
//     require driving an "Add" → fill form → save flow that's its
//     own substantial chunk of code per section. v1 reads table
//     contents for awareness and surfaces them in the summary so the
//     LO knows what's left to enter manually.

(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_lopFileCopy';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[LOP File Copy v' + VERSION + '] loaded');

  const PANEL_ID = 'zhl-lop-file-copy-panel';
  const MODAL_ID = 'zhl-lop-file-copy-modal';
  const STORAGE_KEY = 'zhlLopCopyStages';
  const ZHL_TIP = 'Built by Justin Case. Karma appreciated 💛';

  // ---- React-trusted writers (same trick as loan-amount.js) -----

  function setReactInputValue(el, value) {
    const v = String(value == null ? '' : value);
    let viaExec = false;
    try {
      el.focus();
      try { el.setSelectionRange(0, (el.value || '').length); }
      catch (_) { try { el.select(); } catch (__) {} }
      viaExec = document.execCommand && document.execCommand('insertText', false, v);
    } catch (_) { viaExec = false; }
    if (!viaExec || String(el.value) !== v) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, v);
      else el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    try { el.blur(); } catch (_) {}
  }

  function setReactSelectValue(el, value) {
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function setReactCheckedValue(el, checked) {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
    const want = !!checked;
    if (el.checked === want) return;
    if (el.type === 'radio' && want) {
      // Use .click() for radios so React's onChange wiring fires
      // exactly the way a real click would, including any cascading
      // form effects.
      try { el.click(); return; } catch (_) {}
    }
    if (desc && desc.set) desc.set.call(el, want);
    else el.checked = want;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('click', { bubbles: true }));
  }

  // ---- Field discovery ------------------------------------------

  // When the loan has a co-borrower on the same pair, LOP renders
  // the borrower-info sections side-by-side and BOTH columns have
  // inputs with the same `name` attributes (`first`, `middle`,
  // `last`, `dob`, `cellPhoneNumber`, …). To tell them apart we
  // record each captured field's enclosing per-borrower section
  // (identified by data-cy="<sectionType>-<index>"). On paste we
  // match by section type + index + name, so primary→primary and
  // co-borrower→co-borrower stay aligned.
  //
  // Declarations and Demographics fields don't need this because
  // LOP already namespaces them (primaryBorrower.*, coBorrower.*)
  // — their `name` attributes are globally unique.
  const SCOPED_SECTION_PREFIXES = [
    'personal-info-section',
    'address-section',
    'credit-consent-section',
    'employments-section',
    'other-incomes-section'
  ];

  // Sections to SKIP entirely. The Loan & Property panel
  // (Subject Property, Rental Income, Loan info, Pricing info,
  // Title info) is loan-specific and should NOT carry over from
  // a previous loan — copying the old property's address /
  // purchase price / rate / lock period into a brand-new loan
  // would be actively wrong. Detection is by ancestor div id —
  // every section's content sits inside a wrapper like
  // <div id="SubjectProperty-{borrowerPairId}">.
  const EXCLUDED_SECTION_IDS = [
    'SubjectProperty',
    'RentalIncome',
    'LoanInfo',
    'PricingInfo',
    'TitleInfo'
  ];

  function isInExcludedSection(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      const id = cur.id || '';
      for (const prefix of EXCLUDED_SECTION_IDS) {
        if (id === prefix || id.indexOf(prefix + '-') === 0) return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }

  function findSectionScope(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      const cy = cur.getAttribute && cur.getAttribute('data-cy');
      if (cy) {
        for (const prefix of SCOPED_SECTION_PREFIXES) {
          if (cy.indexOf(prefix + '-') === 0) {
            // Trailing token after the last dash is the index.
            const idx = cy.substring(prefix.length + 1);
            return { type: prefix, index: idx };
          }
        }
      }
      cur = cur.parentElement;
    }
    return null;
  }

  function findAllNamedFields(root) {
    root = root || document;
    const out = [];
    root.querySelectorAll('input[name], select[name], textarea[name]').forEach(function (el) {
      if (!el.name) return;
      out.push(el);
    });
    return out;
  }

  function isEditable(el) {
    if (el.disabled) return false;
    if (el.readOnly) return false;
    // <select> uses .disabled (no .readOnly). Don't filter out
    // selects whose options are individually disabled — the select
    // element itself decides.
    return true;
  }

  // Build the dedup/lookup key for a field. For inputs inside a
  // borrower-scoped section (Personal info, Addresses, etc.) we
  // include the section type + index so primary and co-borrower
  // don't collide. Radios use the value too because a radio group
  // shares one name across multiple inputs.
  function fieldKey(name, tag, type, value, scope) {
    let key = name;
    if (scope) key += '@' + scope.type + ':' + scope.index;
    if (tag === 'input' && (type === 'radio' || type === 'checkbox')) {
      key += '|' + value;
    }
    return key;
  }

  // ---- Loan / borrower context ----------------------------------

  function loanIdFromUrl() {
    const m = /\/loan-officer-portal\/([^/]+)\//.exec(location.pathname);
    return m ? m[1] : '';
  }

  function readBorrowerName() {
    // Read first+last directly from every personal-info-section on
    // the page (one per borrower, primary + co-borrower) and join
    // with " & ". This is the only reliable source — the previous
    // regex-based scan over page text picked up navigation labels
    // like "Pre-approval Letter" because they happen to match a
    // First-Last word shape.
    const sections = document.querySelectorAll('[data-cy^="personal-info-section-"]');
    const names = [];
    sections.forEach(function (sec) {
      const fnEl = sec.querySelector('input[name="first"]');
      const lnEl = sec.querySelector('input[name="last"]');
      const fn = fnEl ? (fnEl.value || '').trim() : '';
      const ln = lnEl ? (lnEl.value || '').trim() : '';
      const full = (fn + ' ' + ln).trim();
      if (full) names.push(full);
    });
    return names.join(' & ');
  }

  // Derive borrower names from a stored stage (for the paste
  // picker), so the picker label always reflects the captured
  // people regardless of what's on the current page.
  function namesFromStage(stage) {
    const byScope = {};
    (stage.fields || []).forEach(function (rec) {
      if (!rec.scope || rec.scope.type !== 'personal-info-section') return;
      if (rec.name !== 'first' && rec.name !== 'last') return;
      const k = rec.scope.index;
      if (!byScope[k]) byScope[k] = {};
      byScope[k][rec.name] = rec.value || '';
    });
    const names = Object.keys(byScope).sort().map(function (k) {
      const n = byScope[k];
      return ((n.first || '') + ' ' + (n.last || '')).trim();
    }).filter(Boolean);
    return names.join(' & ');
  }

  function isOnFullApplicationPage() {
    if (!/\/loan-officer-portal\//.test(location.pathname)) return false;
    // Heuristic: any of the major Full App sections must be present.
    const headings = Array.from(document.querySelectorAll('h4, h5'))
      .map(function (h) { return (h.textContent || '').trim(); });
    return headings.indexOf('Personal information') !== -1 ||
      headings.indexOf('Borrower information') !== -1 ||
      headings.indexOf('Declarations') !== -1 ||
      headings.indexOf('Demographics') !== -1;
  }

  // ---- Table awareness ------------------------------------------

  // For each table type we scrape the visible-row data (label per
  // column) into a structured form so the stage carries every
  // row's information forward, not just a count. Liabilities are
  // intentionally excluded — those flow in from the credit pull
  // on the destination loan, so copying them over would create
  // duplicates.
  //
  // Each entry: aria-label of the table + array of column headers
  // we want to capture (matched to th text). Rows where every
  // column we asked for is empty are dropped (totals/footers).
  const TABLE_SCHEMAS = {
    addresses: {
      ariaLabel: 'Table for addresses',
      friendly: 'addresses',
      columns: ['Type', 'Address', 'Housing', 'Move in', 'Move out', 'Rent / mo']
    },
    employments: {
      ariaLabel: 'Table for employments',
      friendly: 'employments',
      columns: ['Type', 'Employer', 'Start Date', 'End Date', 'Income / yr', 'Income / mo', 'Source']
    },
    otherIncomes: {
      ariaLabel: 'Table for other incomes',
      friendly: 'other-income entries',
      columns: ['Income source', 'Other description', 'End Date', 'Frequency', 'Income / yr', 'Income / mo', 'Source']
    },
    assets: {
      ariaLabel: 'Table for assets or credits',
      friendly: 'assets / credits',
      columns: ['Borrower(s)', 'Type', 'Financial institution', 'Account No. / Nickname', 'Amount', 'Source']
    },
    gifts: {
      ariaLabel: 'Table for gifts or grants',
      friendly: 'gifts or grants',
      columns: ['Borrower', 'Type', 'Source', 'Other description', 'Amount']
    },
    realEstate: {
      ariaLabel: 'Table for real estates',
      friendly: 'real-estate records',
      columns: ['Borrower(s)', 'Address', 'Mortgage / HELOC', 'Status', 'Intended', 'Property value', 'Net rental income']
    }
  };

  function readTableRows(table, wantedColumns) {
    // Map header text → column index so we read cells by header
    // name instead of by raw td position (LOP often pads with
    // empty leading cells for the expand-icon column).
    const thead = table.querySelector('thead');
    const headerCells = thead ? Array.from(thead.querySelectorAll('th')) : [];
    const headerIdx = {};
    headerCells.forEach(function (th, i) {
      const t = (th.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) headerIdx[t] = i;
    });
    const rows = [];
    table.querySelectorAll('tbody tr').forEach(function (tr) {
      const tds = tr.querySelectorAll('td');
      if (tds.length <= 1) return;  // empty-state placeholder uses one colspan td
      const row = {};
      let anyValue = false;
      wantedColumns.forEach(function (col) {
        const idx = headerIdx[col];
        if (idx == null) return;
        const cell = tds[idx];
        if (!cell) return;
        // Pull the leaf-most text; trim and collapse whitespace.
        const txt = (cell.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt) anyValue = true;
        row[col] = txt;
      });
      if (anyValue) rows.push(row);
    });
    // The last row of many LOP tables is a totals/summary footer
    // with only the $ cell populated. Drop it heuristically: if
    // the last row has no Type / Borrower(s) / Income source value
    // (i.e. the identifying first non-money column is empty) but
    // does have a $ cell, treat it as a totals footer.
    if (rows.length) {
      const identifyingCols = ['Type', 'Income source', 'Borrower(s)', 'Borrower', 'Address'];
      const last = rows[rows.length - 1];
      const hasIdentifier = identifyingCols.some(function (c) { return last[c]; });
      if (!hasIdentifier) rows.pop();
    }
    return rows;
  }

  function readTableData(root) {
    root = root || document;
    const out = {};
    Object.keys(TABLE_SCHEMAS).forEach(function (key) {
      const schema = TABLE_SCHEMAS[key];
      const t = root.querySelector('table[aria-label="' + schema.ariaLabel + '"]');
      if (!t) return;
      out[key] = readTableRows(t, schema.columns);
    });
    return out;
  }

  // ---- Stage --------------------------------------------------

  function stageFromCurrentPage() {
    const fields = [];
    findAllNamedFields(document).forEach(function (el) {
      // Skip Loan & Property fields entirely — those are
      // loan-specific (Subject Property address, Purchase price,
      // Lock period, Rate, etc.) and copying them from a previous
      // loan would be actively wrong on a new file.
      if (isInExcludedSection(el)) return;
      const tag = el.tagName.toLowerCase();
      const type = (el.type || '').toLowerCase();
      const scope = findSectionScope(el);
      const record = {
        name: el.name,
        tag: tag,
        type: type,
        scope: scope  // null when the field's name is globally unique (declarations, demographics)
      };
      if (tag === 'select') {
        record.value = el.value;
      } else if (type === 'checkbox' || type === 'radio') {
        record.checked = !!el.checked;
        record.value = el.value;
      } else {
        record.value = el.value;
      }
      fields.push(record);
    });
    return {
      sourceLoanId: loanIdFromUrl(),
      sourceBorrowerName: readBorrowerName(),
      capturedAt: Date.now(),
      url: location.pathname,
      fields: fields,
      tableData: readTableData(document)
    };
  }

  // ---- Credit reissue ------------------------------------------
  //
  // LOP's right-rail Credit card has two score rows ("Hard" and
  // "Soft"). Each row's label becomes a CLICKABLE BUTTON only
  // when that pull type was actually run on this loan; otherwise
  // the label is just a span. Clicking the button opens a new tab
  // with the credit report whose top header carries a reference
  // ID we can replay via Choose action → Reissue credit report
  // on a new loan.
  //
  // We can't auto-read across the new tab without a CoreLogic
  // host_permission (and a content script there) — so for v1 we
  // click the button to open the report, then prompt the user to
  // paste the reference ID. On paste, we drive Choose action →
  // Reissue credit report → fill ID → Reissue automatically.

  function findCreditButton() {
    // Prefer Hard (a hard pull is the strong evidence of a full
    // credit report). Fall back to Soft if Hard isn't clickable.
    for (const wanted of ['Hard', 'Soft']) {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if ((btn.textContent || '').replace(/\s+/g, ' ').trim() !== wanted) continue;
        // Filter out unrelated buttons by sanity-checking that
        // the button is inside a Credit-card region (some other
        // page button could have the same text). The Credit card
        // sits next to the Choose action button on the right rail.
        let p = btn.parentElement;
        for (let i = 0; i < 8 && p; i++) {
          if (p.querySelector('[data-cy="credit-actions-buttons"]')) {
            return { type: wanted, button: btn };
          }
          p = p.parentElement;
        }
      }
    }
    return null;
  }

  function cleanCreditReferenceId(raw) {
    if (!raw) return '';
    // Strip "CoreLogic-" prefix (case-insensitive) and any
    // surrounding whitespace; also tolerate the value being
    // pasted with the prefix in the middle (defensive).
    return String(raw).replace(/^CoreLogic[-\s]*/i, '').replace(/\s+/g, '').trim();
  }

  function captureCreditReferenceFromUser(creditButtonInfo) {
    return new Promise(function (resolve) {
      // Open the credit report in a new tab so the user can grab
      // the reference ID. .click() on the actual button preserves
      // any window.open / target=_blank wiring LOP uses.
      try { creditButtonInfo.button.click(); } catch (_) {}
      showModal(
        '<h3 style="margin:0 0 8px;font-size:16px;color:#1e3a8a;">Capture credit reference ID</h3>' +
        '<p style="margin:0 0 8px;color:#374151;font-size:13px;">' +
          'Clicked the <strong>' + escapeHtml(creditButtonInfo.type) + '</strong> credit button — a new tab ' +
          'should have opened with the credit report. ' +
          'Copy the reference ID from the top of that tab (looks like <code>CoreLogic-117747122510000</code>) ' +
          'and paste it below. You can close the report tab once you\'ve copied it.' +
        '</p>' +
        '<input id="zhl-credit-ref-input" type="text" placeholder="CoreLogic-XXXXXXXXX (or just the number)" ' +
          'style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:4px;font:13px monospace;box-sizing:border-box;margin-bottom:6px;">' +
        '<p style="margin:4px 0 0;color:#6b7280;font-size:11px;font-style:italic;">' +
          'The <code>CoreLogic-</code> prefix and any trailing spaces are stripped automatically.' +
        '</p>' +
        '<div style="text-align:right;margin-top:14px;">' +
          '<button id="zhl-credit-ref-skip" style="background:#fff;color:#374151;border:1px solid #d1d5db;border-radius:4px;padding:6px 14px;font-weight:600;cursor:pointer;margin-right:8px;">Skip credit reissue</button>' +
          '<button id="zhl-credit-ref-save" style="background:#006aff;color:#fff;border:1px solid #006aff;border-radius:4px;padding:6px 14px;font-weight:600;cursor:pointer;">Save reference ID</button>' +
        '</div>',
        function (p) {
          const input = p.querySelector('#zhl-credit-ref-input');
          input.focus();
          function save() {
            const cleaned = cleanCreditReferenceId(input.value);
            removeModal();
            resolve({ refId: cleaned, pullType: creditButtonInfo.type });
          }
          p.querySelector('#zhl-credit-ref-save').addEventListener('click', save);
          p.querySelector('#zhl-credit-ref-skip').addEventListener('click', function () {
            removeModal();
            resolve(null);
          });
          input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
          });
        }
      );
    });
  }

  // Paste side: drive Choose action → Reissue credit report →
  // fill reference ID → click Reissue. Returns { ok, reason }.
  async function runCreditReissue(refId) {
    if (!refId) return { ok: false, reason: 'No reference ID was staged.' };
    try {
      const actionBtn = document.querySelector('[data-cy="credit-actions-buttons"]');
      if (!actionBtn) return { ok: false, reason: 'Choose action button not found on the right rail.' };
      actionBtn.click();
      await new Promise(function (r) { setTimeout(r, 200); });

      const reissueItem = document.querySelector('[data-cy="reissue-credit-button"]');
      if (!reissueItem) return { ok: false, reason: '"Reissue credit report" menu item not found.' };
      reissueItem.click();
      await new Promise(function (r) { setTimeout(r, 400); });

      const input = document.querySelector('input[name="reissue.referenceId"]');
      if (!input) return { ok: false, reason: 'Reference ID input not found in the dialog.' };
      setReactInputValue(input, refId);
      try { input.blur(); } catch (_) {}
      await new Promise(function (r) { setTimeout(r, 250); });

      const reissueBtn = document.querySelector('[data-cy="run-credit"]');
      if (!reissueBtn) return { ok: false, reason: 'Reissue button not found in the dialog.' };
      reissueBtn.click();
      return { ok: true, refId: refId };
    } catch (e) {
      return { ok: false, reason: String(e && e.message || e) };
    }
  }

  function loadStages() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get([STORAGE_KEY], function (data) {
          const arr = (data && data[STORAGE_KEY]) || [];
          resolve(Array.isArray(arr) ? arr : []);
        });
      } catch (_) { resolve([]); }
    });
  }

  function saveStages(arr) {
    return new Promise(function (resolve) {
      try {
        const payload = {};
        payload[STORAGE_KEY] = arr;
        chrome.storage.local.set(payload, function () { resolve(); });
      } catch (_) { resolve(); }
    });
  }

  async function persistStage(stage) {
    const all = await loadStages();
    // Replace any existing stage for this loan id.
    const filtered = all.filter(function (s) { return s.sourceLoanId !== stage.sourceLoanId; });
    filtered.unshift(stage);
    // Cap at 10 stages to avoid runaway storage growth.
    await saveStages(filtered.slice(0, 10));
  }

  // ---- Paste --------------------------------------------------

  function pasteOnePass(stage, byKey) {
    let wrote = 0;
    let skippedLocked = 0;
    let noMatch = 0;
    let skippedEmpty = 0;

    findAllNamedFields(document).forEach(function (el) {
      // Mirror stage-side: never touch Loan & Property fields,
      // even if an older stage captured them.
      if (isInExcludedSection(el)) return;
      const tag = el.tagName.toLowerCase();
      const type = (el.type || '').toLowerCase();
      const scope = findSectionScope(el);
      const key = fieldKey(el.name, tag, type, el.value, scope);
      const rec = byKey[key];
      if (!rec) { noMatch++; return; }
      if (!isEditable(el)) { skippedLocked++; return; }

      try {
        if (tag === 'select') {
          if (!rec.value) { skippedEmpty++; return; }
          // Only set if the option exists on the destination select.
          let optionExists = false;
          for (const opt of el.options) {
            if (opt.value === rec.value) { optionExists = true; break; }
          }
          if (!optionExists) { skippedEmpty++; return; }
          if (el.value === rec.value) { return; }  // already correct
          setReactSelectValue(el, rec.value);
          wrote++;
        } else if (type === 'checkbox' || type === 'radio') {
          // Only flip when destination state differs.
          if (el.checked === !!rec.checked) return;
          // For radios, only the "true" side of a Y/N pair carries
          // the meaningful click (clicking "No" deselects "Yes" too).
          if (type === 'radio' && !rec.checked) return;
          setReactCheckedValue(el, rec.checked);
          wrote++;
        } else {
          // Plain text-style input
          if (rec.value == null || rec.value === '') { skippedEmpty++; return; }
          if (el.value === rec.value) { return; }
          setReactInputValue(el, rec.value);
          wrote++;
        }
      } catch (e) {
        console.warn('[LOP File Copy] write failed for', el.name, e);
      }
    });

    return {
      wrote: wrote,
      skippedLocked: skippedLocked,
      noMatch: noMatch,
      skippedEmpty: skippedEmpty
    };
  }

  // Multi-pass paste so cascading fields fill correctly. Some
  // questions on the Declarations form (e.g. A1, A2, A3) are only
  // rendered after their parent (A=Yes) is set. A single pass
  // writes A=Yes; React then re-renders and adds A1 to the DOM;
  // a second pass writes A1; React re-renders again to add A2 / A3
  // (which are selects that only appear after A1=Yes). Up to 4
  // passes with a 250ms settle catches any reasonable cascade
  // depth without taking forever.
  async function pasteStageOntoCurrentPage(stage) {
    const byKey = {};
    (stage.fields || []).forEach(function (rec) {
      const key = fieldKey(rec.name, rec.tag, rec.type, rec.value, rec.scope);
      byKey[key] = rec;
    });

    let totalWrote = 0;
    let lastResult = { wrote: 0, skippedLocked: 0, noMatch: 0, skippedEmpty: 0 };
    let passes = 0;
    const MAX_PASSES = 4;
    while (passes < MAX_PASSES) {
      passes++;
      lastResult = pasteOnePass(stage, byKey);
      totalWrote += lastResult.wrote;
      // Stop early when a pass writes nothing — no more cascading
      // fields are appearing.
      if (lastResult.wrote === 0) break;
      // Give React time to re-render before the next pass.
      await new Promise(function (r) { setTimeout(r, 250); });
    }

    // Surface borrower-section count mismatch so the LO knows
    // when they need to add a co-borrower (or remove one) on the
    // destination before re-pasting.
    const srcBorrowers = countBorrowerSections(stage.fields);
    const destBorrowers = countCurrentBorrowerSections();
    const borrowerMismatch = (srcBorrowers !== destBorrowers)
      ? { source: srcBorrowers, destination: destBorrowers }
      : null;

    // Credit reissue is the LAST step — by now DOB, SSN, address,
    // email, and phone have all been written, which are the inputs
    // CoreLogic needs to match the staged reference. Give the form
    // one more beat to settle before we open the reissue dialog.
    let creditResult = null;
    if (stage.creditReferenceId) {
      await new Promise(function (r) { setTimeout(r, 600); });
      creditResult = await runCreditReissue(stage.creditReferenceId);
    }

    return {
      wrote: totalWrote,
      skippedLocked: lastResult.skippedLocked,
      noMatch: lastResult.noMatch,
      skippedEmpty: lastResult.skippedEmpty,
      passes: passes,
      borrowerMismatch: borrowerMismatch,
      creditResult: creditResult
    };
  }

  function countBorrowerSections(fields) {
    const seen = {};
    (fields || []).forEach(function (rec) {
      if (rec.scope && rec.scope.type === 'personal-info-section') {
        seen[rec.scope.index] = true;
      }
    });
    return Object.keys(seen).length || 1;  // at least 1
  }

  function countCurrentBorrowerSections() {
    return document.querySelectorAll('[data-cy^="personal-info-section-"]').length || 1;
  }

  // ---- UI -------------------------------------------------------

  function fmtAgo(ts) {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function removeModal() {
    const m = document.getElementById(MODAL_ID);
    if (m) m.remove();
  }

  function showModal(contentHtml, onMount) {
    removeModal();
    const backdrop = document.createElement('div');
    backdrop.id = MODAL_ID;
    backdrop.style.cssText =
      'position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:2147483646;' +
      'display:flex;align-items:center;justify-content:center;font:14px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;';
    const panel = document.createElement('div');
    panel.style.cssText =
      'background:#fff;border-radius:8px;max-width:520px;width:92%;max-height:80vh;overflow:auto;' +
      'box-shadow:0 20px 60px rgba(0,0,0,0.3);padding:18px 20px;color:#1f2937;';
    panel.innerHTML = contentHtml;
    backdrop.appendChild(panel);
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) removeModal();
    });
    document.body.appendChild(backdrop);
    if (typeof onMount === 'function') onMount(panel);
  }

  function findSubnav() {
    // The LOP sub-navigation bar (Insights / Pre-approval / …
    // Premier Agent) is the parent of every subnav-* anchor. We
    // pick any one of those anchors and return its parent so we
    // can append our panel inline at the end of the bar.
    const anchor = document.querySelector('[data-cy="subnav-full-application"]') ||
                   document.querySelector('[data-cy="subnav-premier-agent"]') ||
                   document.querySelector('[data-cy^="subnav-"]');
    return anchor ? anchor.parentElement : null;
  }

  function ensurePanel() {
    if (document.getElementById(PANEL_ID)) return;
    if (!isOnFullApplicationPage()) return;
    const subnav = findSubnav();
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    if (subnav) {
      // Inline in the subnav, after the last existing link
      // (typically Premier Agent). Margin pushes it off the link
      // text a little so it doesn't feel glued on.
      panel.style.cssText =
        'display:inline-flex;gap:8px;align-items:center;margin-left:24px;' +
        'font:13px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2937;';
    } else {
      // Fallback: pinned to the top-center as a fixed overlay
      // when the subnav isn't on the page (e.g. an LOP layout
      // change). Same look as the previous version of v1.29.1.
      panel.style.cssText =
        'position:fixed;top:52px;left:50%;transform:translateX(-50%);z-index:2147483645;' +
        'background:#fff;border:1px solid #bfdbfe;border-radius:8px;' +
        'padding:8px 10px;box-shadow:0 6px 18px rgba(0,0,0,0.12);' +
        'font:13px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2937;' +
        'display:flex;gap:8px;align-items:center;';
    }
    panel.title = ZHL_TIP;

    const label = document.createElement('span');
    label.textContent = 'Copy LOP file:';
    label.style.cssText = 'color:#1e3a8a;font-weight:700;margin-right:4px;';

    const stageBtn = document.createElement('button');
    stageBtn.type = 'button';
    stageBtn.textContent = 'Stage from this file';
    stageBtn.style.cssText =
      'background:#006aff;color:#fff;border:1px solid #006aff;border-radius:4px;' +
      'padding:6px 12px;font-weight:600;cursor:pointer;font-size:13px;';
    stageBtn.addEventListener('mouseenter', function () { stageBtn.style.background = '#0056d2'; });
    stageBtn.addEventListener('mouseleave', function () { stageBtn.style.background = '#006aff'; });
    stageBtn.addEventListener('click', onStageClick);

    const pasteBtn = document.createElement('button');
    pasteBtn.type = 'button';
    pasteBtn.textContent = 'Paste from staged';
    pasteBtn.style.cssText =
      'background:#fff;color:#006aff;border:1px solid #006aff;border-radius:4px;' +
      'padding:6px 12px;font-weight:600;cursor:pointer;font-size:13px;';
    pasteBtn.addEventListener('mouseenter', function () { pasteBtn.style.background = '#eef6ff'; });
    pasteBtn.addEventListener('mouseleave', function () { pasteBtn.style.background = '#fff'; });
    pasteBtn.addEventListener('click', onPasteClick);

    panel.appendChild(label);
    panel.appendChild(stageBtn);
    panel.appendChild(pasteBtn);
    if (subnav) {
      subnav.appendChild(panel);
    } else {
      document.body.appendChild(panel);
    }
  }

  async function onStageClick() {
    const stage = stageFromCurrentPage();
    if (!stage.fields.length) {
      showModal('<h3 style="margin:0 0 8px;font-size:16px;color:#dc2626;">Nothing to stage</h3>' +
        '<p>No named form fields found on this page. Are you on the Full Application?</p>' +
        '<div style="text-align:right;margin-top:14px;"><button id="zhl-modal-close" style="background:#006aff;color:#fff;border:1px solid #006aff;border-radius:4px;padding:6px 14px;font-weight:600;cursor:pointer;">OK</button></div>',
        function (p) { p.querySelector('#zhl-modal-close').addEventListener('click', removeModal); });
      return;
    }
    // Optional credit-reference capture. If the source loan has a
    // clickable Hard or Soft credit button on the right rail, open
    // the credit report in a new tab and prompt the user for the
    // reference ID. They paste it in our modal; we strip the
    // "CoreLogic-" prefix and trailing whitespace and save it on
    // the stage so the paste side can drive a Reissue.
    const creditBtn = findCreditButton();
    if (creditBtn) {
      const captured = await captureCreditReferenceFromUser(creditBtn);
      if (captured && captured.refId) {
        stage.creditReferenceId = captured.refId;
        stage.creditPullType = captured.pullType;
      }
    }
    await persistStage(stage);
    const stageHeaderName = namesFromStage(stage) || stage.sourceBorrowerName || '';
    const tableSummary = tableDataSummaryHtml(stage.tableData);
    const creditLine = stage.creditReferenceId
      ? '<div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:6px;padding:8px 10px;margin:10px 0;color:#065f46;font-size:12px;">' +
        '<strong>✓ Credit reference captured</strong> &mdash; <code>' + escapeHtml(stage.creditReferenceId) + '</code>' +
        ' (' + escapeHtml(stage.creditPullType || 'pull') + '). Will auto-reissue on paste.' +
      '</div>'
      : '';
    showModal(
      '<h3 style="margin:0 0 8px;font-size:16px;color:#1e3a8a;">✓ Staged ' + stage.fields.length + ' fields</h3>' +
      '<p style="margin:0 0 8px;color:#6b7280;font-size:13px;">From <strong>' +
        escapeHtml(stageHeaderName || stage.sourceLoanId || '(unknown)') + '</strong>' +
        (stageHeaderName ? ' &nbsp;<span style="color:#9ca3af;">loan ' + escapeHtml(stage.sourceLoanId) + '</span>' : '') +
      '</p>' +
      creditLine +
      tableSummary +
      '<p style="margin-top:14px;color:#374151;font-size:13px;">Now open the destination loan, navigate to Full Application, and click <strong>Paste from staged</strong>.</p>' +
      '<div style="text-align:right;margin-top:14px;"><button id="zhl-modal-close" style="background:#006aff;color:#fff;border:1px solid #006aff;border-radius:4px;padding:6px 14px;font-weight:600;cursor:pointer;">OK</button></div>',
      function (p) { p.querySelector('#zhl-modal-close').addEventListener('click', removeModal); }
    );
  }

  async function onPasteClick() {
    const stages = await loadStages();
    if (!stages.length) {
      showModal('<h3 style="margin:0 0 8px;font-size:16px;color:#dc2626;">Nothing staged yet</h3>' +
        '<p>Open the source loan\'s Full Application and click <strong>Stage from this file</strong> first.</p>' +
        '<div style="text-align:right;margin-top:14px;"><button id="zhl-modal-close" style="background:#006aff;color:#fff;border:1px solid #006aff;border-radius:4px;padding:6px 14px;font-weight:600;cursor:pointer;">OK</button></div>',
        function (p) { p.querySelector('#zhl-modal-close').addEventListener('click', removeModal); });
      return;
    }
    const currentLoan = loanIdFromUrl();
    const safeStages = stages.filter(function (s) { return s.sourceLoanId !== currentLoan; });
    const useStages = safeStages.length ? safeStages : stages;
    const optionsHtml = useStages.map(function (s, i) {
      const td = s.tableData || {};
      const tcSummary = Object.keys(td)
        .filter(function (k) { return Array.isArray(td[k]) && td[k].length; })
        .map(function (k) { return td[k].length + ' ' + (TABLE_SCHEMAS[k] ? TABLE_SCHEMAS[k].friendly : k); })
        .join(' · ');
      // Prefer the names derived from captured first/last fields
      // over whatever was scanned off the page at stage time —
      // older stages may carry stale or wrong text in
      // sourceBorrowerName (the regex-based scan could pick up
      // navigation labels like "Pre-approval Letter").
      const borrowerLabel = namesFromStage(s) || s.sourceBorrowerName || '';
      return '<label style="display:block;padding:10px;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:8px;cursor:pointer;">' +
        '<input type="radio" name="zhl-stage-pick" value="' + i + '"' + (i === 0 ? ' checked' : '') + ' style="margin-right:8px;">' +
        '<strong>' + escapeHtml(borrowerLabel || s.sourceLoanId || '(unknown borrower)') + '</strong>' +
        '<div style="color:#6b7280;font-size:12px;margin-top:2px;">' +
          (s.fields ? s.fields.length : 0) + ' fields · staged ' + fmtAgo(s.capturedAt) +
          (tcSummary ? ' · tables: ' + escapeHtml(tcSummary) : '') +
        '</div>' +
        '<div style="color:#9ca3af;font-size:11px;margin-top:1px;">loan ' + escapeHtml(s.sourceLoanId || '?') + '</div>' +
        '</label>';
    }).join('');
    showModal(
      '<h3 style="margin:0 0 8px;font-size:16px;color:#1e3a8a;">Paste staged file into this loan</h3>' +
      '<p style="margin:0 0 12px;color:#6b7280;font-size:13px;">Pick which staged loan to paste from. Pasting writes every editable field that matches a stored field name on this page.</p>' +
      optionsHtml +
      '<div style="text-align:right;margin-top:6px;">' +
        '<button id="zhl-modal-cancel" style="background:#fff;color:#374151;border:1px solid #d1d5db;border-radius:4px;padding:6px 14px;font-weight:600;cursor:pointer;margin-right:8px;">Cancel</button>' +
        '<button id="zhl-modal-paste" style="background:#006aff;color:#fff;border:1px solid #006aff;border-radius:4px;padding:6px 14px;font-weight:600;cursor:pointer;">Paste</button>' +
      '</div>',
      function (p) {
        p.querySelector('#zhl-modal-cancel').addEventListener('click', removeModal);
        p.querySelector('#zhl-modal-paste').addEventListener('click', async function () {
          const sel = p.querySelector('input[name="zhl-stage-pick"]:checked');
          const idx = sel ? parseInt(sel.value, 10) : 0;
          const stage = useStages[idx];
          if (!stage) { removeModal(); return; }
          removeModal();
          const result = await pasteStageOntoCurrentPage(stage);
          showSummary(stage, result);
        });
      }
    );
  }

  function showSummary(stage, result) {
    const headerName = namesFromStage(stage) || stage.sourceBorrowerName || '';
    const tableSummaryHtml = tableDataSummaryHtml(stage.tableData);
    showModal(
      '<h3 style="margin:0 0 8px;font-size:16px;color:#15803d;">Pasted ' + result.wrote + ' fields</h3>' +
      '<p style="margin:0 0 8px;color:#6b7280;font-size:13px;">From <strong>' +
        escapeHtml(headerName || stage.sourceLoanId || '(unknown)') + '</strong>' +
        (headerName ? ' &nbsp;<span style="color:#9ca3af;">loan ' + escapeHtml(stage.sourceLoanId) + '</span>' : '') +
        (result.passes && result.passes > 1
          ? ' &nbsp;·&nbsp; <span style="color:#1e3a8a;">' + result.passes + ' passes for cascading fields</span>'
          : '') +
      '</p>' +
      '<div style="background:#f9fafb;border-radius:6px;padding:10px;margin:10px 0;font-size:13px;">' +
        '<div><strong>Written:</strong> ' + result.wrote + '</div>' +
        '<div><strong>Skipped — read-only / disabled:</strong> ' + result.skippedLocked +
          ' <span style="color:#6b7280;">(field is locked on this loan, can\'t be written)</span></div>' +
        '<div><strong>Skipped — empty in source:</strong> ' + result.skippedEmpty + '</div>' +
        '<div><strong>No matching source value:</strong> ' + result.noMatch +
          ' <span style="color:#6b7280;">(field name only exists on destination)</span></div>' +
      '</div>' +
      (result.borrowerMismatch
        ? '<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:10px;margin:10px 0;color:#92400e;font-size:13px;">' +
          '<strong>⚠ Borrower count mismatch:</strong> source had <strong>' + result.borrowerMismatch.source +
          '</strong> borrower' + (result.borrowerMismatch.source === 1 ? '' : 's') +
          ' on this pair but this loan has <strong>' + result.borrowerMismatch.destination +
          '</strong>. Add or remove the missing borrower (click the <strong>+</strong> tab → ' +
          '<em>Coborrower with [name]</em>) then re-paste to fill the second column.' +
        '</div>'
        : '') +
      (result.creditResult
        ? (result.creditResult.ok
          ? '<div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:6px;padding:10px;margin:10px 0;color:#065f46;font-size:13px;">' +
            '<strong>✓ Credit reissue triggered</strong> &mdash; opened Choose action &rarr; Reissue credit report, ' +
            'filled reference ID <code>' + escapeHtml(result.creditResult.refId) + '</code>, and clicked Reissue. ' +
            'Watch the right rail for the new pull to come back.' +
          '</div>'
          : '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:10px;margin:10px 0;color:#991b1b;font-size:13px;">' +
            '<strong>⚠ Credit reissue failed</strong> &mdash; ' + escapeHtml(result.creditResult.reason || 'unknown reason') +
            '. You can run it manually: <em>Choose action &rarr; Reissue credit report</em>, paste reference ID ' +
            (stage.creditReferenceId ? '<code>' + escapeHtml(stage.creditReferenceId) + '</code>' : '(staged value)') +
            ', then click Reissue.' +
          '</div>')
        : '') +
      '<div style="background:#eef6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px;margin:10px 0;color:#1e3a8a;font-size:12px;">' +
        '<strong>Multi-pair applications:</strong> if the source loan had more than one borrower-pair tab ' +
        '(<strong>+</strong> &rarr; <em>New application</em>), only the currently-visible tab gets staged. ' +
        'Switch to each source tab and click <em>Stage</em> again &mdash; each stage replaces the previous one ' +
        'for that loan, so paste one tab\'s worth at a time before moving on.' +
      '</div>' +
      '<div style="margin-top:12px;background:#fff7ed;border:1px solid #fdba74;border-radius:6px;padding:10px;color:#9a3412;font-size:12px;">' +
        '<strong>Tables still need manual entry in this version</strong> &mdash; addresses, employment, ' +
        'other income, assets, gifts/grants, and real estate require LOP\'s own ' +
        '<em>+ Add</em> button flow that this module can\'t drive yet (each form has its own field structure ' +
        'that I need to wire up per type). Liabilities will fill automatically from the credit pull.' +
        ' Use the captured row data below as your reference while you add each row.' +
      '</div>' +
      tableSummaryHtml +
      '<p style="margin-top:14px;color:#374151;font-size:12px;font-style:italic;">Tip: scroll the page to verify the fields look right. If a section didn\'t fill, it\'s either locked on this loan or wasn\'t expanded on the source when you staged.</p>' +
      '<div style="text-align:right;margin-top:14px;"><button id="zhl-modal-close" style="background:#006aff;color:#fff;border:1px solid #006aff;border-radius:4px;padding:6px 14px;font-weight:600;cursor:pointer;">OK</button></div>',
      function (p) { p.querySelector('#zhl-modal-close').addEventListener('click', removeModal); }
    );
  }

  function tableDataSummaryHtml(tableData) {
    // Render captured rows so the LO can see exactly what came
    // from the source, with full per-row detail collapsed under
    // a small "View rows" toggle per table.
    if (!tableData) return '';
    const entries = Object.keys(tableData).filter(function (k) {
      return Array.isArray(tableData[k]) && tableData[k].length;
    });
    if (!entries.length) return '';
    let html = '<details style="margin-top:8px;"><summary style="cursor:pointer;color:#1e3a8a;font-weight:600;">' +
      'View staged row data (' + entries.map(function (k) {
        return tableData[k].length + ' ' + TABLE_SCHEMAS[k].friendly;
      }).join(' · ') +
      ')</summary>' +
      '<div style="margin-top:6px;font-size:11px;color:#374151;max-height:240px;overflow:auto;background:#f9fafb;border-radius:4px;padding:8px;">';
    entries.forEach(function (k) {
      const rows = tableData[k];
      html += '<div style="margin-bottom:8px;"><strong>' + escapeHtml(TABLE_SCHEMAS[k].friendly) + ' (' + rows.length + '):</strong>';
      html += '<ul style="margin:4px 0 0 16px;padding:0;list-style:disc;">';
      rows.forEach(function (row) {
        const parts = TABLE_SCHEMAS[k].columns
          .map(function (col) { return row[col] ? col + ': ' + row[col] : null; })
          .filter(Boolean);
        html += '<li>' + escapeHtml(parts.join(' · ')) + '</li>';
      });
      html += '</ul></div>';
    });
    html += '</div></details>';
    return html;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- Scan loop ------------------------------------------------

  function scan() {
    if (!isOnFullApplicationPage()) {
      const p = document.getElementById(PANEL_ID);
      if (p) p.remove();
      return;
    }
    ensurePanel();
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      try { scan(); } catch (e) { console.warn('[LOP File Copy] scan error', e); }
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
