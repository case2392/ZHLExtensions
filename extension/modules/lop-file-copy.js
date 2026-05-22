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
  // perBorrower: when true, the table is rendered once per
  // borrower (Addresses, Employment, Other income each live inside
  // their own data-cy="<sectionType>-<borrowerIdx>" container).
  // The scraper iterates each instance and tags rows with their
  // borrower index so paste can drive the matching Add button.
  // When false, there's a single table for the whole pair
  // (Assets, Gifts, Real estate all share the borrower column).
  const TABLE_SCHEMAS = {
    addresses: {
      ariaLabel: 'Table for addresses',
      friendly: 'addresses',
      columns: ['Type', 'Address', 'Housing', 'Move in', 'Move out', 'Rent / mo'],
      perBorrower: true,
      sectionType: 'address-section'
    },
    employments: {
      ariaLabel: 'Table for employments',
      friendly: 'employments',
      columns: ['Type', 'Employer', 'Start Date', 'End Date', 'Income / yr', 'Income / mo', 'Source'],
      perBorrower: true,
      sectionType: 'employments-section'
    },
    otherIncomes: {
      ariaLabel: 'Table for other incomes',
      friendly: 'other-income entries',
      columns: ['Income source', 'Other description', 'End Date', 'Frequency', 'Income / yr', 'Income / mo', 'Source'],
      perBorrower: true,
      sectionType: 'other-incomes-section'
    },
    assets: {
      ariaLabel: 'Table for assets or credits',
      friendly: 'assets / credits',
      columns: ['Borrower(s)', 'Type', 'Financial institution', 'Account No. / Nickname', 'Amount', 'Source'],
      perBorrower: false
    },
    gifts: {
      ariaLabel: 'Table for gifts or grants',
      friendly: 'gifts or grants',
      columns: ['Borrower', 'Type', 'Source', 'Other description', 'Amount'],
      perBorrower: false
    },
    realEstate: {
      ariaLabel: 'Table for real estates',
      friendly: 'real-estate records',
      columns: ['Borrower(s)', 'Address', 'Mortgage / HELOC', 'Status', 'Intended', 'Property value', 'Net rental income'],
      perBorrower: false
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

  // For per-borrower tables, walk each data-cy="<sectionType>-N"
  // container and capture that section's table, tagging every
  // captured row with its borrower index (__borrowerIndex). Paste
  // uses that to drive the right Add button. For shared tables
  // (assets, gifts, real estate), there's one global table and
  // rows carry the borrower column inline.
  function readTableData(root) {
    root = root || document;
    const out = {};
    Object.keys(TABLE_SCHEMAS).forEach(function (key) {
      const schema = TABLE_SCHEMAS[key];
      const allRows = [];
      if (schema.perBorrower) {
        const sections = root.querySelectorAll('[data-cy^="' + schema.sectionType + '-"]');
        sections.forEach(function (sec) {
          const cy = sec.getAttribute('data-cy') || '';
          // Extract the trailing index — "address-section-0" → "0"
          const idx = cy.substring(schema.sectionType.length + 1);
          const table = sec.querySelector('table[aria-label="' + schema.ariaLabel + '"]');
          if (!table) return;
          const rows = readTableRows(table, schema.columns);
          rows.forEach(function (r) { r.__borrowerIndex = idx; });
          allRows.push.apply(allRows, rows);
        });
      } else {
        // Shared table — read all instances at document level. In
        // practice there should be exactly one, but iterate to be
        // safe against future LOP layout changes.
        const tables = root.querySelectorAll('table[aria-label="' + schema.ariaLabel + '"]');
        tables.forEach(function (table) {
          const rows = readTableRows(table, schema.columns);
          allRows.push.apply(allRows, rows);
        });
      }
      out[key] = allRows;
    });
    return out;
  }

  // Resolve the right table on the destination for a given staged
  // row. For per-borrower tables, scope to the matching
  // address-section-N / employments-section-N / other-incomes-section-N.
  // For shared tables, fall back to the document-level query.
  function findScopedTable(schemaKey, borrowerIdx) {
    const schema = TABLE_SCHEMAS[schemaKey];
    if (!schema) return null;
    if (schema.perBorrower && borrowerIdx != null) {
      const section = document.querySelector('[data-cy="' + schema.sectionType + '-' + borrowerIdx + '"]');
      if (section) {
        const t = section.querySelector('table[aria-label="' + schema.ariaLabel + '"]');
        if (t) return t;
      }
    }
    return document.querySelector('table[aria-label="' + schema.ariaLabel + '"]');
  }

  // ---- Stage --------------------------------------------------

  function stageFromCurrentPage() {
    console.group('[Copy LOP] Stage from current page');
    console.log('URL:', location.pathname);
    console.log('Loan ID:', loanIdFromUrl());
    console.log('Borrower name(s):', readBorrowerName());

    const fields = [];
    let totalSeen = 0;
    let excluded = 0;
    const allNamed = findAllNamedFields(document);
    console.log('Found', allNamed.length, 'named form fields on the page.');
    allNamed.forEach(function (el) {
      totalSeen++;
      if (isInExcludedSection(el)) {
        excluded++;
        return;
      }
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
    console.log('Captured', fields.length, 'fields (', excluded, 'excluded as Loan & Property /',
      totalSeen - excluded - fields.length, 'other skipped).');

    const tableData = readTableData(document);
    console.group('Table data');
    Object.keys(tableData).forEach(function (k) {
      console.log(k + ':', tableData[k].length, 'rows', tableData[k]);
    });
    console.groupEnd();

    const stage = {
      sourceLoanId: loanIdFromUrl(),
      sourceBorrowerName: readBorrowerName(),
      capturedAt: Date.now(),
      url: location.pathname,
      fields: fields,
      tableData: tableData
    };
    console.log('Full stage record:', stage);
    console.groupEnd();
    return stage;
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

  // Wait up to ~30s for the credit-report-reader content script
  // (running on zillowdocs.com) to stash the ref ID in storage,
  // then resolve with it. Returns null on timeout so the caller
  // can fall back to the manual-paste modal.
  function waitForAutoCapturedCreditRef(timeoutMs) {
    timeoutMs = timeoutMs || 30000;
    return new Promise(function (resolve) {
      // Clear any leftover from a previous capture so we don't
      // pick up a stale one.
      try { chrome.storage.local.remove(['zhlPendingCreditRef']); } catch (_) {}
      const t0 = Date.now();
      let done = false;
      const interval = setInterval(function () {
        if (done) return;
        try {
          chrome.storage.local.get(['zhlPendingCreditRef'], function (data) {
            if (done) return;
            const pending = data && data.zhlPendingCreditRef;
            if (pending && pending.refId && pending.capturedAt >= t0) {
              done = true;
              clearInterval(interval);
              try { chrome.storage.local.remove(['zhlPendingCreditRef']); } catch (_) {}
              resolve(pending.refId);
            } else if (Date.now() - t0 > timeoutMs) {
              done = true;
              clearInterval(interval);
              resolve(null);
            }
          });
        } catch (_) {
          if (Date.now() - t0 > timeoutMs) {
            done = true;
            clearInterval(interval);
            resolve(null);
          }
        }
      }, 500);
    });
  }

  function captureCreditReferenceFromUser(creditButtonInfo) {
    return new Promise(function (resolve) {
      // Arm the credit-report-reader content script BEFORE clicking
      // Hard/Soft so it only auto-closes tabs we opened. Without
      // this gate, every credit-report tab the LO opens manually
      // would get auto-closed too. The flag is checked on the
      // reader's load and consumed within ~60s; the reader also
      // clears it as soon as it picks it up.
      try {
        chrome.storage.local.set({
          zhlCreditCaptureArmed: { armedAt: Date.now() }
        }, function () {
          try { creditButtonInfo.button.click(); } catch (_) {}
        });
      } catch (_) {
        try { creditButtonInfo.button.click(); } catch (__) {}
      }

      // Start the auto-capture race.
      const autoP = waitForAutoCapturedCreditRef(30000);

      let resolved = false;
      function finish(refId) {
        if (resolved) return;
        resolved = true;
        removeModal();
        resolve(refId ? { refId: refId, pullType: creditButtonInfo.type } : null);
      }

      showModal(
        '<h3 style="margin:0 0 8px;font-size:16px;color:#1e3a8a;">Reading credit report…</h3>' +
        '<p style="margin:0 0 8px;color:#374151;font-size:13px;">' +
          'Clicked the <strong>' + escapeHtml(creditButtonInfo.type) + '</strong> credit button. ' +
          'A new tab is loading the credit report — the extension will auto-detect the reference ID ' +
          '(<code>CoreLogic-XXXXXXXXX</code>) and close the tab as soon as it finds it. ' +
          'No action needed unless the auto-read times out.' +
        '</p>' +
        '<div id="zhl-credit-auto-status" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px;margin:10px 0;font-size:13px;color:#1e3a8a;display:flex;align-items:center;gap:10px;">' +
          '<div style="width:18px;height:18px;border:2px solid #bfdbfe;border-top-color:#1d4ed8;border-radius:50%;animation:zhl-lop-copy-spin 0.8s linear infinite;"></div>' +
          '<span>Waiting for credit report to load…</span>' +
        '</div>' +
        '<details style="margin-top:8px;font-size:12px;color:#6b7280;">' +
          '<summary style="cursor:pointer;">Fallback: paste manually</summary>' +
          '<p style="margin:6px 0;">If the auto-read doesn\'t complete, copy <code>CoreLogic-XXXXXXXXX</code> from the report tab and paste here:</p>' +
          '<input id="zhl-credit-ref-input" type="text" placeholder="CoreLogic-XXXXXXXXX (or just the number)" ' +
            'style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:4px;font:13px monospace;box-sizing:border-box;">' +
          '<div style="margin-top:6px;text-align:right;">' +
            '<button id="zhl-credit-ref-manual-save" style="background:#006aff;color:#fff;border:1px solid #006aff;border-radius:4px;padding:5px 12px;font-weight:600;cursor:pointer;font-size:12px;">Use this ID</button>' +
          '</div>' +
        '</details>' +
        '<div style="text-align:right;margin-top:14px;">' +
          '<button id="zhl-credit-ref-skip" style="background:#fff;color:#374151;border:1px solid #d1d5db;border-radius:4px;padding:6px 14px;font-weight:600;cursor:pointer;">Skip credit reissue</button>' +
        '</div>',
        function (p) {
          p.querySelector('#zhl-credit-ref-skip').addEventListener('click', function () {
            finish(null);
          });
          p.querySelector('#zhl-credit-ref-manual-save').addEventListener('click', function () {
            const cleaned = cleanCreditReferenceId(p.querySelector('#zhl-credit-ref-input').value);
            if (cleaned) finish(cleaned);
          });
          p.querySelector('#zhl-credit-ref-input').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
              e.preventDefault();
              const cleaned = cleanCreditReferenceId(p.querySelector('#zhl-credit-ref-input').value);
              if (cleaned) finish(cleaned);
            }
          });
        }
      );

      // When auto-capture wins, update the modal to confirm + auto-close.
      autoP.then(function (refId) {
        if (resolved) return;
        if (!refId) {
          // Auto timed out — leave the modal open so the user can
          // paste manually or skip.
          const status = document.getElementById('zhl-credit-auto-status');
          if (status) {
            status.style.background = '#fef3c7';
            status.style.borderColor = '#fcd34d';
            status.style.color = '#92400e';
            status.innerHTML = '<span>⚠ Auto-read timed out. Use the fallback paste below, or skip.</span>';
          }
          return;
        }
        const status = document.getElementById('zhl-credit-auto-status');
        if (status) {
          status.style.background = '#ecfdf5';
          status.style.borderColor = '#6ee7b7';
          status.style.color = '#065f46';
          status.innerHTML = '<span>✓ Captured <code>' + escapeHtml(refId) + '</code> automatically. Saving…</span>';
        }
        setTimeout(function () { finish(refId); }, 600);
      });
    });
  }

  // Saves the loan file. Required before Choose action / Reissue
  // credit are enabled on the right-rail Credit card. Waits for
  // the save to actually commit by watching the Save button's
  // disabled state (it goes disabled mid-save then re-enables).
  async function saveLoanFile() {
    const saveBtn = document.querySelector('button[data-cy="save-loan-file-button"]');
    if (!saveBtn) return { ok: false, reason: 'Save button not found' };
    if (saveBtn.disabled || saveBtn.getAttribute('aria-disabled') === 'true') {
      // Nothing to save (already saved). That's still OK for our
      // downstream — the reissue still needs an enabled Choose
      // action, but if Save is disabled it usually means the file
      // is already in a saved state.
      console.log('[Copy LOP] Save button is disabled — already saved or nothing to save.');
      return { ok: true, alreadySaved: true };
    }
    console.log('[Copy LOP] Clicking Save loan file…');
    saveBtn.click();
    // Watch for the save cycle. The button typically goes disabled
    // mid-save then re-enables when done. Wait up to 8 seconds.
    await waitForCondition(function () {
      return saveBtn.disabled || saveBtn.getAttribute('aria-disabled') === 'true';
    }, 1500);
    // Then wait for it to be done (re-enabled or stays disabled
    // because there's nothing more to save).
    await wait(800);
    // Extra settle so LOP's right-rail can refresh and enable
    // Choose action.
    await wait(1200);
    return { ok: true };
  }

  // Paste side: drive Choose action → Reissue credit report →
  // fill reference ID → click Reissue. Returns { ok, reason }.
  // Used for HARD credit pulls — reissue replays an existing
  // CoreLogic report by reference ID.
  async function runHardReissue(refId) {
    if (!refId) return { ok: false, reason: 'No reference ID was staged.' };
    try {
      console.log('[Copy LOP] Hard reissue Step 1: looking for [data-cy="credit-actions-buttons"]');
      const actionBtn = document.querySelector('[data-cy="credit-actions-buttons"]');
      if (!actionBtn) return { ok: false, reason: 'Choose action button not found on the right rail.' };
      console.log('[Copy LOP] Step 1: clicking Choose action', actionBtn);
      actionBtn.click();
      await new Promise(function (r) { setTimeout(r, 200); });

      console.log('[Copy LOP] Step 2: looking for [data-cy="reissue-credit-button"]');
      const reissueItem = document.querySelector('[data-cy="reissue-credit-button"]');
      if (!reissueItem) return { ok: false, reason: '"Reissue credit report" menu item not found.' };
      console.log('[Copy LOP] Step 2: clicking Reissue credit report', reissueItem);
      reissueItem.click();
      await new Promise(function (r) { setTimeout(r, 400); });

      console.log('[Copy LOP] Step 3: looking for input[name="reissue.referenceId"]');
      const input = document.querySelector('input[name="reissue.referenceId"]');
      if (!input) return { ok: false, reason: 'Reference ID input not found in the dialog.' };
      console.log('[Copy LOP] Step 3: writing reference ID', refId);
      setReactInputValue(input, refId);
      try { input.blur(); } catch (_) {}
      await new Promise(function (r) { setTimeout(r, 250); });

      console.log('[Copy LOP] Step 4: looking for [data-cy="run-credit"]');
      const reissueBtn = document.querySelector('[data-cy="run-credit"]');
      if (!reissueBtn) return { ok: false, reason: 'Reissue button not found in the dialog.' };
      console.log('[Copy LOP] Step 4: clicking Reissue');
      reissueBtn.click();
      return { ok: true, action: 'hard-reissue', refId: refId };
    } catch (e) {
      console.error('[Copy LOP] runHardReissue threw:', e);
      return { ok: false, reason: String(e && e.message || e) };
    }
  }

  // Paste side: drive Choose action → Pull credit report →
  // click Pull credit. Used for SOFT pulls — reissue doesn't work
  // for soft credit (CoreLogic rejects with CR02), so we do a
  // fresh pull. The Pull-type select in the dialog defaults to
  // Soft so we don't need to touch it.
  async function runSoftPull() {
    try {
      console.log('[Copy LOP] Soft pull Step 1: looking for [data-cy="credit-actions-buttons"]');
      const actionBtn = document.querySelector('[data-cy="credit-actions-buttons"]');
      if (!actionBtn) return { ok: false, reason: 'Choose action button not found on the right rail.' };
      console.log('[Copy LOP] Soft pull Step 1: clicking Choose action', actionBtn);
      actionBtn.click();
      await new Promise(function (r) { setTimeout(r, 200); });

      console.log('[Copy LOP] Soft pull Step 2: looking for [data-cy="pull-credit-button"]');
      const pullItem = document.querySelector('[data-cy="pull-credit-button"]');
      if (!pullItem) return { ok: false, reason: '"Pull credit report" menu item not found.' };
      console.log('[Copy LOP] Soft pull Step 2: clicking Pull credit report', pullItem);
      pullItem.click();
      await new Promise(function (r) { setTimeout(r, 400); });

      // The Pull credit dialog opens with Pull type defaulted to
      // Soft and the borrower pair pre-selected. We trust the
      // default and just click the Pull credit submit button.
      console.log('[Copy LOP] Soft pull Step 3: looking for [data-cy="run-credit"] (Pull credit button)');
      const runBtn = document.querySelector('[data-cy="run-credit"]');
      if (!runBtn) return { ok: false, reason: 'Pull credit button not found in the dialog.' };
      console.log('[Copy LOP] Soft pull Step 3: clicking Pull credit');
      runBtn.click();
      return { ok: true, action: 'soft-pull' };
    } catch (e) {
      console.error('[Copy LOP] runSoftPull threw:', e);
      return { ok: false, reason: String(e && e.message || e) };
    }
  }

  // Dispatch the appropriate credit action based on what was
  // captured at stage time.
  async function runCreditAction(stage) {
    const pullType = stage.creditPullType;
    if (pullType === 'Hard' && stage.creditReferenceId) {
      return runHardReissue(stage.creditReferenceId);
    }
    if (pullType === 'Soft') {
      return runSoftPull();
    }
    return { ok: false, reason: 'No credit action staged (need pullType=Hard with refId, or pullType=Soft).' };
  }

  // Confirm every borrower the source had (one section per index)
  // is ready for credit on the destination:
  //   - personal-info-section has first / last / DOB / SSN populated
  //   - address-section has at least one address row
  // Both are required before LOP will let the credit pull run
  // (CoreLogic needs every applicant identified with an address).
  // Returns a per-borrower issue list so the summary surfaces
  // specifics.
  function verifyReadyForCredit(stage) {
    // Group source field values by personal-info-section index so
    // we know which borrowers the source had AND can label them
    // by name in the issue list.
    const srcSections = {};
    (stage.fields || []).forEach(function (rec) {
      if (!rec.scope || rec.scope.type !== 'personal-info-section') return;
      const k = rec.scope.index;
      if (!srcSections[k]) srcSections[k] = {};
      srcSections[k][rec.name] = rec.value;
    });
    const issues = [];
    const requiredPersonal = ['first', 'last', 'dob', 'ssn'];
    Object.keys(srcSections).sort().forEach(function (idx) {
      const src = srcSections[idx];
      const borrowerName = ((src.first || '') + ' ' + (src.last || '')).trim() ||
                           ('Borrower ' + (parseInt(idx, 10) + 1));

      // 1. Personal-info section
      const destSec = document.querySelector('[data-cy="personal-info-section-' + idx + '"]');
      if (!destSec) {
        issues.push(borrowerName + ': section missing on destination (add the borrower first)');
        return;  // can't check addresses either if the section is missing
      }
      requiredPersonal.forEach(function (field) {
        const srcVal = (src[field] || '').trim();
        if (!srcVal) return;  // source didn't have it — nothing to copy
        const destInput = destSec.querySelector('input[name="' + field + '"]');
        const destVal = destInput ? (destInput.value || '').trim() : '';
        if (!destVal) {
          issues.push(borrowerName + ': ' + field + ' not populated on destination');
        }
      });

      // 2. Address section — needs at least one address row.
      // The address-section-N container holds the addresses table;
      // we count real data rows (not the placeholder or the
      // inline edit form).
      const addrSec = document.querySelector('[data-cy="address-section-' + idx + '"]');
      if (!addrSec) {
        issues.push(borrowerName + ': no address section on destination');
      } else {
        const tbody = addrSec.querySelector('table[aria-label="Table for addresses"] tbody');
        const dataRows = tbody ? Array.from(tbody.querySelectorAll('tr')).filter(function (tr) {
          if (tr.getAttribute('data-cy') === 'add-entity-container') return false;
          const tds = tr.querySelectorAll('td');
          if (tds.length <= 1) return false;
          const txt = (tr.textContent || '').replace(/\s+/g, '').trim();
          return !!txt;
        }) : [];
        if (!dataRows.length) {
          issues.push(borrowerName + ': no address added (credit needs at least one)');
        }
      }
    });
    return { ok: issues.length === 0, issues: issues };
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

  // ---- Table row auto-paste ---------------------------------
  //
  // Each Full Application table (addresses, employment, other
  // income, assets, gifts, real estate) has an inline "+ Add X"
  // button that opens an edit form below the headers. We drive
  // each form by:
  //   1. Clicking the Add button
  //   2. Waiting for tr[data-cy="add-entity-container"] to appear
  //   3. Filling every field with React-trusted writes
  //   4. Clicking the table-specific save button
  //   5. Waiting for the form row to disappear (= save succeeded)
  //
  // Liabilities is intentionally skipped — those flow in from the
  // credit reissue on the destination.

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function waitForCondition(predicate, timeoutMs) {
    timeoutMs = timeoutMs || 3000;
    return new Promise(function (resolve) {
      const t0 = Date.now();
      const tick = function () {
        let res = null;
        try { res = predicate(); } catch (_) {}
        if (res) return resolve(res);
        if (Date.now() - t0 > timeoutMs) return resolve(null);
        setTimeout(tick, 80);
      };
      tick();
    });
  }

  function findTable(ariaLabel) {
    return document.querySelector('table[aria-label="' + ariaLabel + '"]');
  }
  function findAddButtonForTable(table) {
    // The Add button is in the section's title row above the table.
    // Walk up to a parent that contains a [data-cy="add-entity-button"].
    let cur = table.parentElement;
    while (cur && cur !== document.body) {
      const btn = cur.querySelector(':scope > div button[data-cy="add-entity-button"], button[data-cy="add-entity-button"]');
      if (btn) return btn;
      cur = cur.parentElement;
    }
    return null;
  }
  function getAddForm(table) {
    return table.querySelector('tr[data-cy="add-entity-container"]');
  }

  // Form-scoped setters. Each returns true on a successful write.
  function fInput(form, name) { return form ? form.querySelector('input[name="' + name + '"]') : null; }
  function fSelect(form, name) { return form ? form.querySelector('select[name="' + name + '"]') : null; }
  function fCheckbox(form, name) { return form ? form.querySelector('input[type="checkbox"][name="' + name + '"]') : null; }

  function writeInput(form, name, value) {
    const el = fInput(form, name);
    if (!el) { console.warn('[Copy LOP][table] input not found:', name); return false; }
    if (value == null || value === '') return false;
    setReactInputValue(el, String(value));
    return true;
  }
  function writeSelect(form, name, value) {
    const el = fSelect(form, name);
    if (!el) { console.warn('[Copy LOP][table] select not found:', name); return false; }
    if (value == null || value === '') return false;
    let exists = false;
    for (const opt of el.options) { if (opt.value === value) { exists = true; break; } }
    if (!exists) { console.warn('[Copy LOP][table] option not in select', name, ':', value); return false; }
    setReactSelectValue(el, value);
    return true;
  }
  function writeCheckbox(form, name, checked) {
    const el = fCheckbox(form, name);
    if (!el) return false;
    if (el.checked === !!checked) return true;
    el.click();
    return true;
  }

  // --- Parsers / mappers ---

  function parseAddressLine(line) {
    if (!line) return {};
    const parts = String(line).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (parts.length < 3) return { street: line };
    const last = parts[parts.length - 1];
    const m = /^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/.exec(last);
    if (!m) return { street: line };
    return {
      state: m[1],
      zip: m[2],
      city: parts[parts.length - 2],
      street: parts.slice(0, parts.length - 2).join(', ')
    };
  }

  function normalizeDateStr(d) {
    if (!d) return '';
    const t = String(d).trim();
    if (!t || /^present$/i.test(t)) return '';
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
    if (!m) return t;
    let yr = m[3];
    if (yr.length === 2) yr = (parseInt(yr, 10) > 50 ? '19' : '20') + yr;
    return m[1].padStart(2, '0') + '/' + m[2].padStart(2, '0') + '/' + yr;
  }

  function parseAmount(s) {
    if (s == null) return '';
    const t = String(s).replace(/[\$,\s]/g, '').replace(/\(/g, '-').replace(/\)/g, '');
    const n = parseFloat(t);
    if (!isFinite(n)) return '';
    return String(Math.round(n * 100) / 100);
  }

  function mapAddressType(typeText) {
    if (!typeText) return { type: 'Current address', mailing: false };
    const parts = String(typeText).split(',').map(function (s) { return s.trim().toLowerCase(); });
    const mailing = parts.indexOf('mailing') !== -1;
    let type = 'Current address';
    if (parts.indexOf('previous') !== -1 || parts.indexOf('prior') !== -1) type = 'Previous address';
    else if (mailing && parts.length === 1) type = 'Mailing address';
    return { type: type, mailing: mailing };
  }

  function mapHousingType(housingText) {
    if (!housingText) return '';
    const t = String(housingText).toLowerCase();
    if (/rent\s*free|living\s*rent\s*free/.test(t)) return 'LivingRentFree';
    if (/^own/.test(t)) return 'Own';
    if (/^rent/.test(t)) return 'Rent';
    return '';
  }

  function mapEmploymentType(t) {
    if (!t) return '';
    const s = String(t).toLowerCase();
    if (/previous|prior|past/.test(s)) return 'Previous';
    return 'Current';
  }

  const OTHER_INCOME_SOURCE_MAP = {
    'alimony': 'Alimony', 'auto allowance': 'AutoAllowance', 'boarder': 'Boarder',
    'capital gains': 'CapitalGains', 'child support': 'ChildSupport',
    'disability': 'Disability', 'foster care': 'FosterCare', 'housing': 'Housing',
    'interest / dividends': 'InterestAndDividends', 'interest/dividends': 'InterestAndDividends',
    'mortgage credit certificate': 'MortgageCreditCertificate',
    'mortgage differential payments': 'MortgageDifferentialPayments',
    'notes receivable': 'NotesReceivable', 'public assistance': 'PublicAssistance',
    'retirement': 'Retirement', 'royalties': 'Royalties',
    'separate maintenance': 'SeparateMaintenance', 'social security': 'SocialSecurity',
    'trust': 'Trust', 'unemployment': 'Unemployment', 'va compensation': 'VACompensation',
    'other': 'Other'
  };
  function mapOtherIncomeSource(text) {
    if (!text) return '';
    return OTHER_INCOME_SOURCE_MAP[String(text).toLowerCase().trim()] || '';
  }

  const ASSET_TYPE_MAP = {
    'checking account': 'CheckingAccount', 'savings account': 'SavingsAccount',
    'money market account': 'MoneyMarketAccount', 'certificate of deposit': 'CertificateOfDeposit',
    'mutual fund': 'MutualFund', 'stocks': 'Stocks', 'stock options': 'StockOptions',
    'bonds': 'Bonds', 'retirement account': 'RetirementAccount',
    'bridge loan proceeds': 'BridgeLoanProceeds',
    'individual development account': 'IndividualDevelopmentAccount',
    'trust account': 'TrustAccount', 'cash value of life insurance': 'CashValueOfLifeInsurance',
    'proceeds from sale of real estate': 'ProceedsFromSaleOfRealEstate',
    'proceeds from sale of non-real estate asset': 'ProceedsFromSaleOfNonRealEstateAsset',
    'secured borrowed funds': 'SecuredBorrowedFunds',
    'unsecured borrowed funds': 'UnsecuredBorrowedFunds',
    'earnest money credit': 'EarnestMoneyCredit',
    'employer assistance credit': 'EmployerAssistanceCredit',
    'lot equity credit': 'LotEquityCredit',
    'relocation funds credit': 'RelocationFundsCredit',
    'rent credit': 'RentCredit', 'sweat equity credit': 'SweatEquityCredit',
    'trade equity credit': 'TradeEquityCredit', 'other': 'Other'
  };
  function mapAssetType(text) {
    if (!text) return '';
    return ASSET_TYPE_MAP[String(text).toLowerCase().trim()] || '';
  }

  const GIFT_TYPE_MAP = {
    'cash gift': 'CashGift', 'equity gift': 'EquityGift', 'grant': 'Grant'
  };
  const GIFT_SOURCE_MAP = {
    'community nonprofit': 'CommunityNonprofit', 'employer': 'Employer',
    'federal agency': 'FederalAgency', 'local agency': 'LocalAgency',
    'relative': 'Relative', 'religious nonprofit': 'ReligiousNonprofit',
    'state agency': 'StateAgency', 'unmarried partner': 'UnmarriedPartner',
    'lender': 'Lender', 'other': 'Other'
  };
  function mapGiftType(text) {
    if (!text) return '';
    return GIFT_TYPE_MAP[String(text).toLowerCase().trim()] || '';
  }
  function mapGiftSource(text) {
    if (!text) return '';
    return GIFT_SOURCE_MAP[String(text).toLowerCase().trim()] || '';
  }

  function mapPropertyType(text) {
    if (!text) return '';
    const t = String(text).toLowerCase();
    if (/single/.test(t)) return 'Single';
    if (/2[ -]?4|two.*four|multi/.test(t)) return 'TwoToFourUnit';
    if (/condo/.test(t)) return 'Condo';
    if (/mobile|manufactured/.test(t)) return 'MobileOrManufactured';
    return '';
  }
  function mapOccupancy(text) {
    if (!text) return '';
    const t = String(text).toLowerCase();
    if (/primary/.test(t)) return 'PrimaryResidence';
    if (/second\s*home/.test(t)) return 'SecondHome';
    if (/investment/.test(t)) return 'InvestmentProperty';
    return '';
  }
  function mapRealEstateStatus(text) {
    if (!text) return '';
    const t = String(text).toLowerCase();
    if (/pending/.test(t)) return 'PendingSale';
    if (/^sold/.test(t)) return 'Sold';
    if (/retain/.test(t)) return 'Retained';
    return '';
  }
  function mapFinancialStatus(text) {
    if (!text) return '';
    const t = String(text).toLowerCase().trim();
    if (!t) return '';
    if (/free\s*and\s*clear|free\s*&\s*clear/.test(t)) return 'FreeAndClear';
    // Any non-empty Mortgage / HELOC content (e.g. "JPMCB - HOME
    // LENDING - 4654031444586", possibly multi-line for multi-lien
    // properties) implies WithLiabilities. LOP's real-estate form
    // requires a financial-status pick so we default to the more
    // common case rather than leaving it blank.
    return 'WithLiabilities';
  }

  // Drive an accessibility-combobox (role="combobox" + portaled
  // role="listbox") so we can pick a borrower from the Asset and
  // Real Estate forms. The standard "set .value" trick doesn't work
  // for these — they require an actual interaction that opens the
  // listbox, then a click on the desired option.
  async function selectComboboxOption(input, wantedText) {
    if (!input || !wantedText) return false;
    const want = String(wantedText).replace(/\s+/g, ' ').trim().toLowerCase();
    input.focus();
    input.click();
    await wait(180);
    // Some combobox implementations only open on keyboard input.
    if (input.getAttribute('aria-expanded') !== 'true') {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      await wait(180);
    }
    // Look for any visible listbox in the document — c11n portals
    // them out of the form to escape overflow clipping.
    const listboxes = document.querySelectorAll('[role="listbox"]');
    for (const lb of listboxes) {
      if (lb.offsetHeight === 0 && lb.offsetWidth === 0) continue;
      const options = lb.querySelectorAll('[role="option"]');
      for (const opt of options) {
        const t = (opt.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (!t) continue;
        if (t === want || t.indexOf(want) === 0 || want.indexOf(t) === 0) {
          opt.click();
          await wait(150);
          // Close the listbox by blurring the input.
          try { input.blur(); } catch (_) {}
          return true;
        }
      }
    }
    return false;
  }

  // Resolve a borrower name from the source ("Sekou Swaray") to a
  // borrower-id value present on the destination form. The Gifts
  // form has a plain <select name="borrowerId"> whose options carry
  // the uuid as value and the borrower's name as the option text.
  function resolveBorrowerIdFromSelect(form, borrowerNameText) {
    if (!borrowerNameText) return '';
    const select = fSelect(form, 'borrowerId');
    if (!select) return '';
    const want = String(borrowerNameText).trim().toLowerCase();
    for (const opt of select.options) {
      const optText = (opt.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!opt.value) continue;
      if (optText === want || want.indexOf(optText) === 0 || optText.indexOf(want) === 0) {
        return opt.value;
      }
    }
    return '';
  }

  // --- Per-table drivers ---

  async function pasteAddressRow(row) {
    const table = findScopedTable('addresses', row.__borrowerIndex);
    if (!table) return { ok: false, reason: 'table not found' };
    const addBtn = findAddButtonForTable(table);
    if (!addBtn) return { ok: false, reason: 'Add button not found' };
    if (addBtn.disabled) return { ok: false, reason: 'Add button is disabled (loan locked?)' };
    addBtn.click();
    await wait(250);
    const form = await waitForCondition(function () { return getAddForm(table); }, 3000);
    if (!form) return { ok: false, reason: 'Add form did not appear' };
    await wait(150);

    const typeInfo = mapAddressType(row['Type']);
    const addr = parseAddressLine(row['Address']);

    writeSelect(form, 'addressType', typeInfo.type);
    await wait(80);
    if (typeInfo.mailing) { writeCheckbox(form, 'isMailingAddress', true); await wait(80); }
    writeInput(form, 'streetAddress', addr.street);
    if (addr.unit) writeInput(form, 'unit', addr.unit);
    writeInput(form, 'city', addr.city);
    writeSelect(form, 'state', addr.state);
    writeInput(form, 'zipCode', addr.zip);
    writeSelect(form, 'country', 'US');
    await wait(120);
    writeSelect(form, 'housingType', mapHousingType(row['Housing']));
    await wait(200);
    // Monthly rent only appears when housing=Rent. Try after the wait.
    if (/rent/i.test(row['Housing'] || '')) {
      const rentAmt = parseAmount(row['Rent / mo']);
      if (rentAmt) {
        const rentInput = form.querySelector('input[name="monthlyRent"]');
        if (rentInput) { setReactInputValue(rentInput, rentAmt); await wait(120); }
      }
    }
    const moveIn = normalizeDateStr(row['Move in']);
    if (moveIn) {
      writeInput(form, 'moveInDate', moveIn);
      const el = fInput(form, 'moveInDate');
      if (el) { try { el.blur(); } catch (_) {} await wait(200); }
    }
    await wait(200);

    const saveBtn = form.querySelector('button[data-cy="save-address-button"]');
    if (!saveBtn) return { ok: false, reason: 'Save button not found' };
    saveBtn.click();
    const closed = await waitForCondition(function () { return !getAddForm(table); }, 4000);
    await wait(300);
    return closed ? { ok: true } : { ok: false, reason: 'Save did not close the form (validation error?)' };
  }

  async function pasteOtherIncomeRow(row) {
    const table = findScopedTable('otherIncomes', row.__borrowerIndex);
    if (!table) return { ok: false, reason: 'table not found' };
    const addBtn = findAddButtonForTable(table);
    if (!addBtn || addBtn.disabled) return { ok: false, reason: 'Add button not available' };
    addBtn.click();
    await wait(250);
    const form = await waitForCondition(function () { return getAddForm(table); }, 3000);
    if (!form) return { ok: false, reason: 'Add form did not appear' };
    await wait(150);

    writeSelect(form, 'source', mapOtherIncomeSource(row['Income source']));
    await wait(80);
    // Frequency: source has Income/yr or Income/mo. Pick whichever
    // is non-empty; prefer monthly when explicitly present.
    const yr = parseAmount(row['Income / yr']);
    const mo = parseAmount(row['Income / mo']);
    let amount = '', frequency = 'Annual';
    if (yr) { amount = yr; frequency = 'Annual'; }
    else if (mo) { amount = mo; frequency = 'Monthly'; }
    writeSelect(form, 'income.frequency', frequency);
    await wait(60);
    if (amount) writeInput(form, 'income.amount', amount);
    await wait(150);

    const saveBtn = form.querySelector('button[data-cy="save-other-income-button"]');
    if (!saveBtn) return { ok: false, reason: 'Save button not found' };
    saveBtn.click();
    const closed = await waitForCondition(function () { return !getAddForm(table); }, 4000);
    await wait(300);
    return closed ? { ok: true } : { ok: false, reason: 'Save did not close the form' };
  }

  async function pasteGiftRow(row) {
    const table = findTable('Table for gifts or grants');
    if (!table) return { ok: false, reason: 'table not found' };
    const addBtn = findAddButtonForTable(table);
    if (!addBtn || addBtn.disabled) return { ok: false, reason: 'Add button not available' };
    addBtn.click();
    await wait(250);
    const form = await waitForCondition(function () { return getAddForm(table); }, 3000);
    if (!form) return { ok: false, reason: 'Add form did not appear' };
    await wait(150);

    writeSelect(form, 'type', mapGiftType(row['Type']));
    await wait(60);
    writeSelect(form, 'source', mapGiftSource(row['Source']));
    await wait(60);
    const borrowerId = resolveBorrowerIdFromSelect(form, row['Borrower']);
    if (borrowerId) writeSelect(form, 'borrowerId', borrowerId);
    await wait(80);
    const amt = parseAmount(row['Amount']);
    if (amt) writeInput(form, 'amount', amt);
    await wait(150);

    const saveBtn = form.querySelector('button[data-cy="save-gift-button"]');
    if (!saveBtn) return { ok: false, reason: 'Save button not found' };
    saveBtn.click();
    const closed = await waitForCondition(function () { return !getAddForm(table); }, 4000);
    await wait(300);
    return closed ? { ok: true } : { ok: false, reason: 'Save did not close the form' };
  }

  async function pasteEmploymentRow(row) {
    const table = findScopedTable('employments', row.__borrowerIndex);
    if (!table) return { ok: false, reason: 'table not found' };
    const addBtn = findAddButtonForTable(table);
    if (!addBtn || addBtn.disabled) return { ok: false, reason: 'Add button not available' };
    addBtn.click();
    await wait(250);
    const form = await waitForCondition(function () { return getAddForm(table); }, 3000);
    if (!form) return { ok: false, reason: 'Add form did not appear' };
    await wait(150);

    writeSelect(form, 'employmentStatus', mapEmploymentType(row['Type']));
    await wait(80);
    writeInput(form, 'name', row['Employer']);
    const start = normalizeDateStr(row['Start Date']);
    if (start) writeInput(form, 'startDate', start);
    // End date: extract from "5/15/2026 5 months" — first token only.
    const endText = row['End Date'] || '';
    const endMatch = /(\d{1,2}\/\d{1,2}\/\d{2,4})/.exec(endText);
    if (endMatch) {
      const endEl = fInput(form, 'endDate');
      if (endEl) { setReactInputValue(endEl, normalizeDateStr(endMatch[1])); await wait(150); }
    }
    // Annual base income. The employment-incomes-table can take a
    // moment to render after the form opens, especially on the 2nd
    // and 3rd Add cycles (LOP doesn't always rebuild it
    // synchronously). Wait for it before trying to write.
    const incomeTable = await waitForCondition(function () {
      return form.querySelector('table[aria-label="employment-incomes-table"]') &&
             form.querySelector('input[name="base.amount"]');
    }, 2500);
    const yr = parseAmount(row['Income / yr']);
    if (yr && incomeTable) {
      writeSelect(form, 'base.frequency', 'Annual');
      await wait(80);
      writeInput(form, 'base.amount', yr);
      await wait(180);
    } else if (yr && !incomeTable) {
      console.warn('[Copy LOP][employment] income table did not render — base income left blank');
    }
    const baseInput = fInput(form, 'base.amount');
    if (baseInput) { try { baseInput.blur(); } catch (_) {} await wait(200); }

    // Save button — note: per the supplied DOM the employment form
    // re-uses save-other-income-button as its [data-cy]. Try both.
    let saveBtn = form.querySelector('button[data-cy="save-employment-button"]') ||
                  form.querySelector('button[data-cy="save-other-income-button"]');
    // Fallback: any button labeled "Add" inside the form
    if (!saveBtn) {
      const buttons = form.querySelectorAll('button');
      for (const b of buttons) {
        if ((b.textContent || '').trim() === 'Add') { saveBtn = b; break; }
      }
    }
    if (!saveBtn) return { ok: false, reason: 'Save button not found' };
    saveBtn.click();
    const closed = await waitForCondition(function () { return !getAddForm(table); }, 4000);
    await wait(400);
    return closed ? { ok: true } : { ok: false, reason: 'Save did not close the form' };
  }

  async function pasteAssetRow(row) {
    const table = findTable('Table for assets or credits');
    if (!table) return { ok: false, reason: 'table not found' };
    const addBtn = findAddButtonForTable(table);
    if (!addBtn || addBtn.disabled) return { ok: false, reason: 'Add button not available' };
    addBtn.click();
    await wait(250);
    const form = await waitForCondition(function () { return getAddForm(table); }, 3000);
    if (!form) return { ok: false, reason: 'Add form did not appear' };
    await wait(150);

    // Borrower(s) is a multi-select combobox — open the listbox
    // and click the matching option. The source row's text is like
    // "Sekou Swaray"; for multi-borrower assets the source carried
    // both names joined together — we attempt each token.
    const borrowerInput = form.querySelector('input[name="borrowerIds"]');
    if (borrowerInput && row['Borrower(s)']) {
      const names = String(row['Borrower(s)']).split(/\s*(?:&|and|,)\s*/).filter(Boolean);
      for (const name of names) {
        const ok = await selectComboboxOption(borrowerInput, name);
        console.log('[Copy LOP][assets] select borrower', name, '→', ok);
        await wait(120);
      }
    }
    writeSelect(form, 'type', mapAssetType(row['Type']));
    await wait(80);
    const inst = row['Financial institution'];
    if (inst && inst !== 'N/A') writeInput(form, 'financialInstitution', inst);
    const acct = row['Account No. / Nickname'];
    if (acct && acct !== 'N/A') writeInput(form, 'accountNumber', acct);
    const amt = parseAmount(row['Amount']);
    if (amt) writeInput(form, 'amount', amt);
    await wait(200);

    const saveBtn = form.querySelector('button[data-cy="save-asset-button"]');
    if (!saveBtn) return { ok: false, reason: 'Save button not found' };
    saveBtn.click();
    const closed = await waitForCondition(function () { return !getAddForm(table); }, 4000);
    await wait(300);
    if (!closed) {
      return { ok: false, reason: 'Save did not close — likely Borrower(s) field is required (it\'s a multi-select that this version can\'t drive). Please pick the borrower(s) manually for this row, then close.' };
    }
    return { ok: true };
  }

  async function pasteRealEstateRow(row) {
    const table = findTable('Table for real estates');
    if (!table) return { ok: false, reason: 'table not found' };
    const addBtn = findAddButtonForTable(table);
    if (!addBtn || addBtn.disabled) return { ok: false, reason: 'Add button not available' };
    addBtn.click();
    await wait(250);
    const form = await waitForCondition(function () { return getAddForm(table); }, 3000);
    if (!form) return { ok: false, reason: 'Add form did not appear' };
    await wait(150);

    // Borrower(s) is a multi-select combobox (named "borrowerIDs"
    // on this form — note the caps D).
    const borrowerInput = form.querySelector('input[name="borrowerIDs"]');
    if (borrowerInput && row['Borrower(s)']) {
      const names = String(row['Borrower(s)']).split(/\s*(?:&|and|,)\s*/).filter(Boolean);
      for (const name of names) {
        const ok = await selectComboboxOption(borrowerInput, name);
        console.log('[Copy LOP][real estate] select borrower', name, '→', ok);
        await wait(120);
      }
    }
    writeSelect(form, 'country', 'US');
    const addr = parseAddressLine(row['Address']);
    writeInput(form, 'streetAddress', addr.street);
    writeInput(form, 'city', addr.city);
    writeSelect(form, 'state', addr.state);
    writeInput(form, 'zipCode', addr.zip);
    await wait(120);

    // Property type / occupancy aren't captured in our source row
    // scrape today — leave for user.

    const pv = parseAmount(row['Property value']);
    if (pv) writeInput(form, 'propertyValue', pv);

    const status = mapRealEstateStatus(row['Status']);
    if (status) {
      writeSelect(form, 'status', status);
      await wait(300);  // PendingSale reveals an extra date field
      // If status is PendingSale or Sold, fill the date if we can
      // infer one. The scraped source row doesn't carry the date,
      // so this stays blank for the user.
    }

    const intended = mapOccupancy(row['Intended']);
    if (intended) writeSelect(form, 'intendedOccupancy', intended);

    const fs = mapFinancialStatus(row['Mortgage / HELOC']);
    if (fs) writeSelect(form, 'financialStatus', fs);

    await wait(200);

    const saveBtn = form.querySelector('button[data-cy="save-real-estate-button"]');
    if (!saveBtn) return { ok: false, reason: 'Save button not found' };
    saveBtn.click();
    const closed = await waitForCondition(function () { return !getAddForm(table); }, 4000);
    await wait(400);
    if (!closed) {
      // The source row scrape doesn't carry Property type or
      // Current occupancy (LOP only shows those in the form, not
      // the table), and the Pending sale / Sold date is also a
      // form-only field. The save validation typically fails on
      // those.
      const missing = ['Property type', 'Current occupancy'];
      if (status === 'PendingSale' || status === 'Sold') missing.push('Pending sale or sold date');
      return {
        ok: false,
        reason: 'Save did not close — finish these required fields manually: ' + missing.join(', ') + '.'
      };
    }
    return { ok: true };
  }

  // Orchestrator: walk every staged table and paste each row one
  // at a time, returning a per-table report.
  async function pasteAllTableRows(stage) {
    const out = {};
    if (!stage.tableData) return out;
    const drivers = {
      addresses: { fn: pasteAddressRow, label: 'addresses' },
      otherIncomes: { fn: pasteOtherIncomeRow, label: 'other income' },
      gifts: { fn: pasteGiftRow, label: 'gifts/grants' },
      employments: { fn: pasteEmploymentRow, label: 'employment' },
      assets: { fn: pasteAssetRow, label: 'assets' },
      realEstate: { fn: pasteRealEstateRow, label: 'real estate' }
    };
    for (const key of Object.keys(drivers)) {
      const rows = stage.tableData[key] || [];
      if (!rows.length) continue;
      const { fn, label } = drivers[key];
      out[key] = { label: label, attempted: rows.length, succeeded: 0, failed: [] };
      console.group('[Copy LOP][tables] ' + label + ' (' + rows.length + ' rows)');
      for (let i = 0; i < rows.length; i++) {
        updateProgress(
          'Adding ' + label + '…',
          'Row ' + (i + 1) + ' of ' + rows.length + ' — driving LOP\'s + Add form.'
        );
        let result;
        try { result = await fn(rows[i]); }
        catch (e) { result = { ok: false, reason: String(e && e.message || e) }; }
        console.log('Row', i + 1, ':', result, rows[i]);
        if (result.ok) out[key].succeeded++;
        else out[key].failed.push({ row: rows[i], reason: result.reason || 'unknown' });
        await wait(200);
      }
      console.groupEnd();
    }
    return out;
  }

  // ---- Paste --------------------------------------------------

  function pasteOnePass(stage, byKey, passNum) {
    let wrote = 0;
    let skippedLocked = 0;
    let noMatch = 0;
    let skippedEmpty = 0;
    const wroteFields = [];
    const skippedLockedFields = [];
    const noMatchFields = [];
    const skippedEmptyFields = [];

    findAllNamedFields(document).forEach(function (el) {
      // Mirror stage-side: never touch Loan & Property fields,
      // even if an older stage captured them.
      if (isInExcludedSection(el)) return;
      const tag = el.tagName.toLowerCase();
      const type = (el.type || '').toLowerCase();
      const scope = findSectionScope(el);
      const key = fieldKey(el.name, tag, type, el.value, scope);
      const rec = byKey[key];
      if (!rec) { noMatch++; noMatchFields.push(key); return; }
      if (!isEditable(el)) { skippedLocked++; skippedLockedFields.push(key); return; }

      try {
        if (tag === 'select') {
          if (!rec.value) { skippedEmpty++; skippedEmptyFields.push(key + ' (select empty)'); return; }
          let optionExists = false;
          for (const opt of el.options) {
            if (opt.value === rec.value) { optionExists = true; break; }
          }
          if (!optionExists) {
            skippedEmpty++;
            skippedEmptyFields.push(key + ' (option "' + rec.value + '" not in dest select)');
            return;
          }
          if (el.value === rec.value) { return; }
          setReactSelectValue(el, rec.value);
          wrote++;
          wroteFields.push(key + ' = ' + rec.value);
        } else if (type === 'checkbox' || type === 'radio') {
          if (el.checked === !!rec.checked) return;
          if (type === 'radio' && !rec.checked) return;
          setReactCheckedValue(el, rec.checked);
          wrote++;
          wroteFields.push(key + ' = ' + (rec.checked ? 'checked' : 'unchecked'));
        } else {
          if (rec.value == null || rec.value === '') { skippedEmpty++; skippedEmptyFields.push(key + ' (empty in source)'); return; }
          if (el.value === rec.value) { return; }
          setReactInputValue(el, rec.value);
          wrote++;
          wroteFields.push(key + ' = "' + rec.value + '"');
        }
      } catch (e) {
        console.warn('[Copy LOP] write failed for', el.name, e);
      }
    });

    console.group('[Copy LOP] Paste pass ' + (passNum || '?') +
      ': wrote ' + wrote + ', skippedLocked ' + skippedLocked +
      ', skippedEmpty ' + skippedEmpty + ', noMatch ' + noMatch);
    if (wroteFields.length) { console.log('Written:', wroteFields); }
    if (skippedLockedFields.length) { console.log('Skipped (read-only / disabled on dest):', skippedLockedFields); }
    if (skippedEmptyFields.length) { console.log('Skipped (empty in source / option not in dest):', skippedEmptyFields); }
    if (noMatchFields.length && noMatchFields.length < 40) { console.log('No matching source value:', noMatchFields); }
    else if (noMatchFields.length) { console.log('No matching source value:', noMatchFields.length, 'fields (truncated; first 20):', noMatchFields.slice(0, 20)); }
    console.groupEnd();

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
    console.group('[Copy LOP] Paste from stage');
    console.log('Stage source loan:', stage.sourceLoanId, 'borrower:', namesFromStage(stage) || stage.sourceBorrowerName);
    console.log('Stage has', (stage.fields || []).length, 'fields,',
      Object.keys(stage.tableData || {}).reduce(function (a, k) { return a + (stage.tableData[k] || []).length; }, 0), 'table rows.');
    console.log('Destination loan ID:', loanIdFromUrl());
    console.log('Destination borrower count:', countCurrentBorrowerSections(),
      'vs source:', countBorrowerSections(stage.fields));

    const byKey = {};
    (stage.fields || []).forEach(function (rec) {
      const key = fieldKey(rec.name, rec.tag, rec.type, rec.value, rec.scope);
      byKey[key] = rec;
    });
    console.log('Built lookup index with', Object.keys(byKey).length, 'keys.');

    let totalWrote = 0;
    let lastResult = { wrote: 0, skippedLocked: 0, noMatch: 0, skippedEmpty: 0 };
    let passes = 0;
    const MAX_PASSES = 4;
    showProgress(
      'Pasting fields…',
      'Pass 1 of up to ' + MAX_PASSES + '. Cascading questions (Decl A1/A2/A3) fill on later passes — please don\'t interact with the page until this finishes.'
    );
    while (passes < MAX_PASSES) {
      passes++;
      updateProgress(
        'Pasting fields — pass ' + passes + '…',
        'Written so far: ' + totalWrote + '. Each pass waits 250ms after writes so React can render any newly-revealed cascading fields.'
      );
      lastResult = pasteOnePass(stage, byKey, passes);
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
    // ORDER MATTERS:
    //   1. Field paste (done above)
    //   2. Table-row paste (so all the borrower-pair data is in)
    //   3. Save the loan file (required before Reissue credit's
    //      Choose action enables)
    //   4. Credit reissue
    let tableResults = {};
    const hasAnyTableRows = stage.tableData && Object.keys(stage.tableData).some(function (k) {
      return Array.isArray(stage.tableData[k]) && stage.tableData[k].length;
    });
    if (hasAnyTableRows) {
      updateProgress('Adding table rows…', 'Walking each + Add form on the page.');
      tableResults = await pasteAllTableRows(stage);
    }

    // Save the loan file so the Credit card's Choose action button
    // un-disables. Without this, the reissue step finds the menu
    // missing because the button never opened.
    let saveResult = null;
    if (stage.creditReferenceId) {
      updateProgress('Saving loan file…', 'Required before Choose action → Reissue credit becomes available.');
      console.group('[Copy LOP] Save loan file');
      saveResult = await saveLoanFile();
      console.log('Result:', saveResult);
      console.groupEnd();
    }

    let creditResult = null;
    if (stage.creditPullType) {
      console.group('[Copy LOP] Credit action: ' + stage.creditPullType);
      // Verify every borrower in the source's personal-info-sections
      // has matching first/last/DOB/SSN on the destination —
      // running credit before all borrowers are populated fails
      // (CoreLogic needs every applicant identified).
      const verify = verifyReadyForCredit(stage);
      if (!verify.ok) {
        console.warn('[Copy LOP] Skipping credit — borrowers not fully ready:', verify.issues);
        creditResult = {
          ok: false,
          reason: 'Skipped — borrower info incomplete: ' + verify.issues.join('; ') +
                  '. Finish each borrower\'s required fields then run credit manually.'
        };
      } else {
        const actionLabel = stage.creditPullType === 'Hard'
          ? 'Reissuing hard credit…'
          : 'Pulling soft credit…';
        const actionDesc = stage.creditPullType === 'Hard'
          ? 'Opening Choose action → Reissue credit report, filling reference ID ' + (stage.creditReferenceId || '?') + ', and clicking Reissue.'
          : 'Opening Choose action → Pull credit report, leaving Pull type as default (Soft), and clicking Pull credit.';
        updateProgress(actionLabel, actionDesc);
        await new Promise(function (r) { setTimeout(r, 600); });
        creditResult = await runCreditAction(stage);
      }
      console.log('Result:', creditResult);
      console.groupEnd();
    } else {
      console.log('[Copy LOP] No credit action staged — skipping.');
    }

    hideProgress();

    console.log('[Copy LOP] Paste totals: wrote', totalWrote, 'passes', passes,
      'skippedLocked', lastResult.skippedLocked,
      'skippedEmpty', lastResult.skippedEmpty,
      'noMatch', lastResult.noMatch);
    console.groupEnd();

    return {
      wrote: totalWrote,
      skippedLocked: lastResult.skippedLocked,
      noMatch: lastResult.noMatch,
      skippedEmpty: lastResult.skippedEmpty,
      passes: passes,
      borrowerMismatch: borrowerMismatch,
      creditResult: creditResult,
      saveResult: saveResult,
      tableResults: tableResults
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

  // ---- Progress overlay ----------------------------------------
  //
  // Multi-pass paste plus credit reissue takes several seconds.
  // Without feedback the user can't tell whether the click
  // registered. We paint a full-viewport overlay with a spinner
  // and a status line that updates as we move through each phase,
  // matching the Mark-All-As-Read overlay style.

  const PROGRESS_ID = 'zhl-lop-copy-progress';

  function showProgress(text, sub) {
    let overlay = document.getElementById(PROGRESS_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = PROGRESS_ID;
      overlay.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
        'background:rgba(255,255,255,0.92)',
        'z-index:2147483647',
        'display:flex', 'flex-direction:column',
        'align-items:center', 'justify-content:center',
        'gap:14px',
        'font:600 15px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif',
        'color:#0b5cab', 'text-align:center',
        'pointer-events:all', 'cursor:wait',
        'padding:24px'
      ].join(';');
      const spinner = document.createElement('div');
      spinner.style.cssText = [
        'width:36px', 'height:36px',
        'border:4px solid #cfe1f5',
        'border-top-color:#006aff',
        'border-radius:50%',
        'animation:zhl-lop-copy-spin 0.8s linear infinite'
      ].join(';');
      const msg = document.createElement('div');
      msg.setAttribute('data-zhl-progress-msg', '1');
      msg.textContent = text || 'Working…';
      const subEl = document.createElement('div');
      subEl.setAttribute('data-zhl-progress-sub', '1');
      subEl.style.cssText = 'font:500 12px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#6b7280;max-width:340px;';
      subEl.textContent = sub || '';
      overlay.appendChild(spinner);
      overlay.appendChild(msg);
      overlay.appendChild(subEl);
      document.body.appendChild(overlay);
      if (!document.getElementById('zhl-lop-copy-spin-style')) {
        const style = document.createElement('style');
        style.id = 'zhl-lop-copy-spin-style';
        style.textContent = '@keyframes zhl-lop-copy-spin { to { transform: rotate(360deg); } }';
        document.head.appendChild(style);
      }
    } else {
      updateProgress(text, sub);
    }
    return overlay;
  }

  function updateProgress(text, sub) {
    const overlay = document.getElementById(PROGRESS_ID);
    if (!overlay) return;
    if (text != null) {
      const m = overlay.querySelector('[data-zhl-progress-msg]');
      if (m) m.textContent = text;
    }
    if (sub != null) {
      const s = overlay.querySelector('[data-zhl-progress-sub]');
      if (s) s.textContent = sub;
    }
  }

  function hideProgress() {
    const overlay = document.getElementById(PROGRESS_ID);
    if (overlay) overlay.remove();
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
    console.log('[Copy LOP] Credit button detection:', creditBtn ? creditBtn.type + ' (clickable)' : 'none clickable');
    if (creditBtn) {
      if (creditBtn.type === 'Hard') {
        // Hard pull → open the report, capture the reference ID
        // for a Reissue on the destination.
        const captured = await captureCreditReferenceFromUser(creditBtn);
        console.log('[Copy LOP] Credit capture result:', captured);
        if (captured && captured.refId) {
          stage.creditReferenceId = captured.refId;
          stage.creditPullType = 'Hard';
        }
      } else if (creditBtn.type === 'Soft') {
        // Soft pull → no reference ID needed (Reissue doesn't
        // work for soft credit; CoreLogic rejects with CR02).
        // We just remember the pull type and on paste we'll do
        // a fresh soft pull via Choose action → Pull credit
        // report (which defaults to Soft).
        stage.creditPullType = 'Soft';
        stage.creditReferenceId = null;
        console.log('[Copy LOP] Soft pull detected — will do fresh soft pull on paste (no ref ID needed).');
      }
    }
    showProgress('Saving staged data…', 'Writing the captured fields + table rows to local storage.');
    await persistStage(stage);
    hideProgress();
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
            '<div style="margin-top:6px;font-size:11px;color:#15803d;font-style:italic;">' +
              'If CoreLogic returns <strong>CR02 Reference Number Not Found</strong>: that means CoreLogic rejected the ref ' +
              '(either it expired &mdash; refs usually live a few days &mdash; or the borrower SSN/DOB on this loan doesn\'t ' +
              'match the original pull). Fall back to <em>Choose action &rarr; Pull credit report</em> for a fresh pull.' +
            '</div>' +
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
      (function () {
        // If any table auto-paste ran, show a per-table report
        // instead of the "manual entry needed" warning.
        const tr = result.tableResults || {};
        const tableKeys = Object.keys(tr);
        if (!tableKeys.length) {
          return tableSummaryHtml;
        }
        let html = '<div style="margin-top:12px;background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:10px;color:#166534;font-size:13px;">' +
          '<strong>Table rows auto-added:</strong><ul style="margin:6px 0 0 18px;padding:0;">';
        tableKeys.forEach(function (k) {
          const r = tr[k];
          html += '<li><strong>' + escapeHtml(r.label) + ':</strong> ' + r.succeeded + ' of ' + r.attempted + ' rows added';
          if (r.failed.length) {
            html += ' &nbsp;<span style="color:#9a3412;">(' + r.failed.length + ' need manual)</span>';
          }
          html += '</li>';
        });
        html += '</ul></div>';
        // Surface specific failure reasons (truncated to the first
        // couple per table) so the LO knows what to clean up.
        const failures = [];
        tableKeys.forEach(function (k) {
          const r = tr[k];
          r.failed.slice(0, 3).forEach(function (f) {
            failures.push('<li><strong>' + escapeHtml(r.label) + ':</strong> ' + escapeHtml(f.reason) + '</li>');
          });
        });
        if (failures.length) {
          html += '<div style="margin-top:8px;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:10px;color:#92400e;font-size:12px;">' +
            '<strong>Rows that need finishing manually:</strong><ul style="margin:6px 0 0 18px;padding:0;">' +
            failures.join('') + '</ul></div>';
        }
        html += tableSummaryHtml;
        return html;
      })() +
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
