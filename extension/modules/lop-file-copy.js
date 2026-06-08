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

  // ---- Demographics "provided through" sweep -----------------------
  // The HMDA "The demographic information was provided through" Select
  // on the Government Monitoring page is a required field. When it's
  // unset on save, LOP's validation rejects the page — which has been
  // observed to cascade and prevent credit consent from committing on
  // the brand-new co-borrower section.
  //
  // Two stable native <select> names:
  //   primaryBorrower.collection.method
  //   coBorrower.collection.method
  // Option values: Email, FaceToFace, Fax, Internet, Mail, Telephone.
  //
  // These ARE captured by findAllNamedFields when present, but many
  // older source loans never had them filled — so a normal stage→paste
  // round-trip leaves the destination empty. We capture explicitly,
  // and on paste fall back to "FaceToFace" if the source was blank so
  // the form validates and the broader save (incl. credit consent)
  // can commit. FaceToFace is the most common LO collection method
  // for a synchronous call/meeting with the borrower; the LO can
  // override on the page after paste if it should be something else.
  const DEMOGRAPHIC_COLLECTION_METHOD_NAMES = [
    'primaryBorrower.collection.method',
    'coBorrower.collection.method'
  ];
  const DEMOGRAPHIC_COLLECTION_METHOD_FALLBACK = 'FaceToFace';

  function findDemographicCollectionMethodSelects(doc) {
    doc = doc || document;
    const found = [];
    DEMOGRAPHIC_COLLECTION_METHOD_NAMES.forEach(function (name) {
      const el = doc.querySelector('select[name="' + name + '"]');
      if (el) found.push({ name: name, control: el });
    });
    return found;
  }

  function captureDemographicCollectionMethod(doc) {
    return findDemographicCollectionMethodSelects(doc).map(function (e) {
      return { name: e.name, value: e.control.value || '' };
    });
  }

  async function pasteDemographicCollectionMethod(records) {
    const elements = findDemographicCollectionMethodSelects(document);
    if (!elements.length) return { wrote: 0, found: 0, fallbacks: 0 };
    // Index source records by name so we tolerate borrower-count
    // mismatches (source had 1 borrower, dest has 2, etc.).
    const byName = {};
    (records || []).forEach(function (r) { byName[r.name] = r; });
    let wrote = 0;
    let fallbacks = 0;
    for (const el of elements) {
      const rec = byName[el.name];
      let value = rec && rec.value;
      if (!value) {
        // Source was blank — fall back so the page validates on save.
        value = DEMOGRAPHIC_COLLECTION_METHOD_FALLBACK;
        fallbacks++;
      }
      // Skip if destination already matches.
      if (el.control.value === value) continue;
      // Skip if the option isn't in this destination's <select>.
      const hasOption = Array.prototype.some.call(el.control.options, function (o) { return o.value === value; });
      if (!hasOption) {
        console.warn('[Copy LOP] Demographics collection.method option not available on dest:', el.name, value);
        continue;
      }
      try {
        setReactSelectValue(el.control, value);
        wrote++;
        console.log('[Copy LOP] Demographics collection.method set:', el.name, '→', value, rec && rec.value ? '(from source)' : '(fallback FaceToFace — source was blank)');
      } catch (e) {
        console.warn('[Copy LOP] Demographics collection.method set failed', el.name, e);
      }
    }
    return { wrote: wrote, found: elements.length, fallbacks: fallbacks };
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

  // Opens each row of a table-of-rows-that-expand on the source
  // loan to read the inline edit form for that row. Used to grab
  // fields that LOP only shows in the form (Property type,
  // Current occupancy, Property link on liabilities, etc.) that
  // aren't visible in the table cells.
  async function expandRowAndReadForm(row, formFieldSelector, fieldReader) {
    // The expanded form lives in the NEXT tr — a single direct-
    // child td with colspan, holding the edit form. NOTE: we
    // check DIRECT children only, because the form can contain
    // nested tables (e.g. Real Estate has an internal
    // real-estate-liabilities-table with its own tds). A simple
    // querySelectorAll('td') would count those nested tds and
    // mis-report the form-tr as "not the form".
    function isFormRow(tr) {
      if (!tr) return false;
      const directTds = Array.from(tr.children).filter(function (c) { return c.tagName === 'TD'; });
      if (directTds.length !== 1) return false;
      return !!tr.querySelector(formFieldSelector);
    }
    // First: if the row is ALREADY expanded (the LO had it open
    // for inspection before staging), the form is the next
    // sibling and we should read it in-place. Clicking the
    // chevron here would CLOSE it.
    let alreadyOpen = isFormRow(row.nextElementSibling);
    if (!alreadyOpen) {
      // Click the chevron in the first td (or the row itself) to
      // expand. Use full mouse-event sequence so React's onClick
      // handler picks it up even through styled wrappers.
      const chev = row.querySelector('td:first-child svg');
      const trigger = chev ? chev.parentElement : row;
      try { clickWithMouseEvents(trigger); }
      catch (_) { try { clickWithMouseEvents(row); } catch (__) {} }
    }
    // Wait for the form row to appear and to contain the marker
    // input/select that proves the form is mounted.
    const formRoot = await waitForCondition(function () {
      return isFormRow(row.nextElementSibling) ? row.nextElementSibling : null;
    }, 3000);
    if (!formRoot) {
      console.warn('[Copy LOP] expandRowAndReadForm: form did not open for row',
        row.querySelector('td:nth-child(4)')?.textContent || row);
      return null;
    }
    // Tiny settle so React hydrates the form's initial values.
    await wait(150);
    let captured = null;
    try { captured = fieldReader(formRoot); } catch (e) { console.warn('[Copy LOP] form read threw', e); }
    // Only collapse if we opened it (don't toggle off a row the
    // user had open).
    if (!alreadyOpen) {
      const cancelBtn = Array.from(formRoot.querySelectorAll('button'))
        .find(function (b) { return (b.textContent || '').trim() === 'Cancel'; });
      if (cancelBtn) cancelBtn.click();
      else {
        const chev = row.querySelector('td:first-child svg');
        const trigger = chev ? chev.parentElement : row;
        try { clickWithMouseEvents(trigger); } catch (_) {}
      }
      await waitForCondition(function () {
        return !isFormRow(row.nextElementSibling);
      }, 2000);
      await wait(120);
    }
    return captured;
  }

  // Source-side: open each real-estate row's edit form to grab
  // the form-only fields the table doesn't show (Property type,
  // ----- Pricing scenario capture (source-side) ----------------
  //
  // Reads the source Full Application page for everything the
  // destination's Pricing & Scenarios → Pricing tab needs to
  // produce the same scenario, plus the active scenario's
  // product name + interest rate from the right-rail "Loan
  // Details" panel. All inputs already live on Full App, so no
  // cross-page navigation is required.
  function scrapePricingScenarioFromSource() {
    console.group('[Copy LOP][scenario scrape]');
    function v(sec, name) {
      if (!sec) return '';
      const el = sec.querySelector('input[name="' + name + '"], select[name="' + name + '"]');
      if (!el) return '';
      if (el.tagName === 'SELECT') {
        const val = (el.value || '').trim();
        if (val) return val;
        if (el.selectedOptions && el.selectedOptions.length) return (el.selectedOptions[0].value || '').trim();
        return '';
      }
      return (el.value || '').trim();
    }
    function checked(sec, name) {
      if (!sec) return false;
      const el = sec.querySelector('input[type="checkbox"][name="' + name + '"]');
      return !!(el && el.checked);
    }
    const subj = document.querySelector('[data-cy="subject-property-section"]');
    const loan = document.querySelector('[data-cy="loan-information-section"]');
    // Pricing info section doesn't have a stable data-cy on every
    // version of LOP, so fall back to the heading.
    let pricing = document.getElementById('PricingInfo');
    if (!pricing) {
      const h = Array.from(document.querySelectorAll('h5')).find(function (x) {
        return /pricing\s+information/i.test((x.textContent || '').trim());
      });
      if (h) pricing = h.closest('div');
    }
    console.log('Sections found:', {
      subjectProperty: !!subj,
      loanInformation: !!loan,
      pricingInfo: !!pricing
    });

    const subjectProperty = {
      addressStreet: v(subj, 'addressStreet'),
      addressUnit: v(subj, 'addressUnit'),
      addressZIP: v(subj, 'addressZIP'),
      addressCity: v(subj, 'addressCity'),
      addressState: v(subj, 'addressState'),
      addressCountyName: v(subj, 'addressCountyName'),
      addressCountyFIPS: v(subj, 'addressCountyFIPS'),
      propertyUse: v(subj, 'propertyUse'),
      propertyType: v(subj, 'propertyType'),
      attachmentType: v(subj, 'attachmentType'),
      financedUnits: v(subj, 'financedUnits'),
      pud: checked(subj, 'pud'),
      mixedUse: checked(subj, 'mixedUse'),
      fhaSecondaryResidence: checked(subj, 'fhaSecondaryResidence')
    };
    const loanInformation = {
      loanPurpose: v(loan, 'loanPurpose'),
      estClosingDate: v(loan, 'estClosingDate'),
      loanType: v(loan, 'loanType'),
      amortizationType: v(loan, 'amortizationType'),
      loanTerm: v(loan, 'loanTerm'),
      purchasePrice: v(loan, 'purchasePrice'),
      baseLoanAmount: v(loan, 'baseLoanAmount'),
      downPayment: v(loan, 'downPayment'),
      downPaymentPercent: v(loan, 'downPaymentPercent'),
      conventionalMortgageInsuranceType: v(loan, 'conventionalMortgageInsuranceType'),
      appraisedValue: v(loan, 'appraisedValue'),
      loanToValue: v(loan, 'loanToValue'),
      homeownersInsurance: v(loan, 'homeownersInsurance'),
      taxes: v(loan, 'taxes'),
      homeownersAssociationDues: v(loan, 'homeownersAssociationDues'),
      otherMonthlyPayment: v(loan, 'otherMonthlyPayment'),
      sellerCreditLumpSum: v(loan, 'sellerCreditLumpSum')
    };
    const pricingInfo = {
      documentationType: v(pricing, 'documentationType'),
      escrowType: v(pricing, 'escrowType'),
      isFirstTimeHomebuyer: checked(pricing, 'isFirstTimeHomebuyer'),
      militaryType: v(pricing, 'militaryType'),
      vaUsageType: v(pricing, 'vaUsageType'),
      isVaFundingFeeExempt: checked(pricing, 'isVaFundingFeeExempt')
    };

    // Right-rail "Loan Details" panel — read the label/value pairs.
    // Each row is <span>Label</span><p>Value</p> (or <button><p>Value</p></button>).
    const loanDetails = readLoanDetailsPanel();
    console.log('Loan Details panel pairs:', loanDetails);

    const out = {
      subjectProperty: subjectProperty,
      loanInformation: loanInformation,
      pricingInfo: pricingInfo,
      // Currently-assigned scenario snapshot used to match a row
      // on the destination after Run pricing returns.
      assignedScenario: {
        productName: loanDetails['Product name'] || '',
        loanPurpose: loanDetails['Loan purpose'] || loanInformation.loanPurpose,
        purchasePrice: loanDetails['Purchase price'] || loanInformation.purchasePrice,
        downPayment: loanDetails['Down payment'] || loanInformation.downPayment,
        baseLoanAmount: loanDetails['Base loan amt.'] || loanInformation.baseLoanAmount,
        totalLoanAmount: loanDetails['Total loan amt.'] || '',
        ltv: loanDetails['LTV'] || loanInformation.loanToValue,
        interestRate: loanDetails['Interest Rate'] || '',
        pointsPrice: loanDetails['Points / Price'] || '',
        apr: loanDetails['APR'] || '',
        monthlyPiti: loanDetails['Monthly PITI'] || '',
        lockPeriod: loanDetails['Lock period'] || '',
        firstTimeHomebuyer: loanDetails['First time homebuyer'] || '',
        zip: loanDetails['Zip code'] || subjectProperty.addressZIP
      }
    };
    console.log('Stage pricingScenario =', out);
    console.groupEnd();
    return out;
  }

  // Right-rail "Loan Details" panel sits next to the eligibility
  // panel on Full Application. Structure: each entry is a Flex
  // box with <span>Label</span><p>Value</p>; some values are
  // wrapped in <button><p>...</p></button> (Monthly PITI, etc).
  function readLoanDetailsPanel() {
    const result = {};
    const headings = Array.from(document.querySelectorAll('h5, h6'));
    const heading = headings.find(function (h) {
      return /^loan\s*details/i.test((h.textContent || '').replace(/\s+/g, ' ').trim());
    });
    if (!heading) {
      console.warn('[Copy LOP][loan details] heading not found');
      return result;
    }
    // The panel container is typically the heading's grand-parent
    // (a card div). Walk up until we find an element that holds
    // multiple Flex rows with label/value pairs.
    let panel = heading.parentElement;
    for (let i = 0; i < 6 && panel; i++) {
      const rows = panel.querySelectorAll('div > span + p, div > span + button > p');
      if (rows.length >= 4) break;
      panel = panel.parentElement;
    }
    if (!panel) {
      console.warn('[Copy LOP][loan details] panel not found from heading');
      return result;
    }
    // Each row: a Flex div whose first child is a <span> (label)
    // and second child is <p> or <button><p></p></button> (value).
    const flexRows = panel.querySelectorAll('div');
    flexRows.forEach(function (row) {
      const span = row.querySelector(':scope > span');
      if (!span) return;
      const label = (span.textContent || '').replace(/\s+/g, ' ').trim();
      if (!label) return;
      // Skip if this row has nested rows (parent containers can match too)
      const valueEl = row.querySelector(':scope > p, :scope > button > p');
      if (!valueEl) return;
      const value = (valueEl.textContent || '').replace(/\s+/g, ' ').trim();
      if (value && !result[label]) result[label] = value;
    });
    return result;
  }

  // Current occupancy, Pending sale / sold date,
  // willBePaidPriorToClosing). Returns one entry per real-estate
  // row, keyed by the row's display address so paste can match
  // by address.
  async function scrapeRealEstateFromSource() {
    const table = document.querySelector('table[aria-label="Table for real estates"]');
    if (!table) return [];
    const tbody = table.querySelector('tbody');
    if (!tbody) return [];
    const rows = Array.from(tbody.children).filter(function (tr) {
      const tds = tr.querySelectorAll('td');
      if (tds.length <= 1) return false;
      // skip the empty-state placeholder and totals row
      return (tr.textContent || '').trim().length > 0 &&
             tr.getAttribute('data-cy') !== 'add-entity-container';
    });
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // Display address — used as the join key on paste
      const tds = row.querySelectorAll('td');
      const addressCell = tds[3];  // Address column
      const displayAddress = addressCell ? (addressCell.textContent || '').replace(/\s+/g, ' ').trim() : '';
      const captured = await expandRowAndReadForm(row,
        'select[name="propertyType"], select[name="currentOccupancy"]',
        function (formRoot) {
          function v(name) {
            const el = formRoot.querySelector('input[name="' + name + '"], select[name="' + name + '"]');
            if (!el) return '';
            // Selects on a readonly source-side form sometimes
            // come back with .value === '' because LOP marks every
            // option as disabled and React hasn't reflected a
            // selected attribute. Walk options for one that's
            // actually selected (via .selected property), then
            // fall back to .value.
            if (el.tagName === 'SELECT') {
              const val = el.value || '';
              if (val) return val.trim();
              for (const opt of el.options) {
                if (opt.selected && opt.value) return (opt.value || '').trim();
              }
              if (el.selectedOptions && el.selectedOptions.length && el.selectedOptions[0].value) {
                return el.selectedOptions[0].value.trim();
              }
              // Last resort: look for the option whose textContent
              // matches what LOP visibly displays. Native selects
              // expose the displayed text via the option's text,
              // but if React doesn't sync .value at all, there's
              // nothing visible to anchor on — leave blank.
              return '';
            }
            return (el.value || '').trim();
          }
          function checked(name) {
            const el = formRoot.querySelector('input[type="checkbox"][name="' + name + '"]');
            return !!(el && el.checked);
          }
          const result = {
            displayAddress: displayAddress,
            propertyType: v('propertyType'),
            currentOccupancy: v('currentOccupancy'),
            estimatedClosingDate: v('estimatedClosingDate'),
            willBePaidPriorToClosing: checked('willBePaidPriorToClosing'),
            // Re-capture these in case the row scrape was wrong:
            propertyValue: v('propertyValue'),
            status: v('status'),
            intendedOccupancy: v('intendedOccupancy'),
            financialStatus: v('financialStatus'),
            taxes: v('taxes'),
            insurance: v('insurance'),
            hoaDues: v('hoaDues')
          };
          console.log('[Copy LOP][RE scrape]', displayAddress, '→', result);
          return result;
        });
      if (captured) out.push(captured);
      else console.warn('[Copy LOP][RE scrape] could not open row for', displayAddress);
    }
    return out;
  }

  // Read the E (Exclude) / P (Payoff) tags that LOP shows
  // inline next to the Company/Payee cell in the liabilities
  // table. Lets us skip opening rows that don't carry any
  // editable state (most non-mortgage liabilities).
  function readLiabilityRowTags(row) {
    const tds = row.querySelectorAll('td');
    const companyCell = tds[3];
    const out = { exclude: false, payoff: false };
    if (!companyCell) return out;
    companyCell.querySelectorAll('button').forEach(function (btn) {
      const t = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      if (t === 'E') out.exclude = true;
      else if (t === 'P') out.payoff = true;
    });
    return out;
  }

  // Source-side: open each liability row's edit form ONLY when
  // the row carries something we need to copy — an "E" / "P" tag
  // (Exclude / Payoff state) or a Mortgage / HELOC account type
  // (likely linked to a Real Estate property). Non-mortgage rows
  // with no tags are skipped to keep stage fast; they have
  // nothing for us to capture beyond what the credit pull will
  // already give the destination.
  async function scrapeLiabilitiesFromSource() {
    const table = document.querySelector('table[aria-label="Table for liabilities"]');
    if (!table) return [];
    const tbody = table.querySelector('tbody');
    if (!tbody) return [];
    const allRows = Array.from(tbody.children).filter(function (tr) {
      const tds = tr.querySelectorAll('td');
      if (tds.length <= 1) return false;
      if (tr.getAttribute('data-cy') === 'add-entity-container') return false;
      const acctText = tds[4] ? (tds[4].textContent || '').trim() : '';
      return !!acctText;
    });
    // Filter to rows that actually have something to capture.
    const targetRows = allRows.filter(function (tr) {
      const tds = tr.querySelectorAll('td');
      const accountType = tds[2] ? (tds[2].textContent || '').trim().toLowerCase() : '';
      if (/mortgage|heloc|home\s*equity/.test(accountType)) return true;
      const tags = readLiabilityRowTags(tr);
      return tags.exclude || tags.payoff;
    });
    console.log('[Copy LOP][liabilities] ' + allRows.length + ' total rows, ' +
      targetRows.length + ' need opening (others have no E/P tag and aren\'t mortgages).');
    const out = [];
    for (let i = 0; i < targetRows.length; i++) {
      const row = targetRows[i];
      const visibleTags = readLiabilityRowTags(row);
      const captured = await expandRowAndReadForm(row,
        'input[name="creditor"], input[name="accountIdentifier"]',
        function (formRoot) {
          function v(name) {
            const el = formRoot.querySelector('input[name="' + name + '"], select[name="' + name + '"]');
            return el ? (el.value || '').trim() : '';
          }
          function checked(name) {
            const el = formRoot.querySelector('input[type="checkbox"][name="' + name + '"]');
            return !!(el && el.checked);
          }
          // Capture the Property link by its DISPLAYED ADDRESS
          // (not the uuid — uuids differ across loans). Paste-side
          // matches by option text.
          let realEstateAddress = '';
          const reSelect = formRoot.querySelector('select[name="realEstateID"]');
          if (reSelect && reSelect.value) {
            const selectedOpt = Array.from(reSelect.options).find(function (o) { return o.value === reSelect.value; });
            if (selectedOpt) realEstateAddress = (selectedOpt.textContent || '').replace(/\s+/g, ' ').trim();
          }
          return {
            accountIdentifier: v('accountIdentifier'),
            creditor: v('creditor'),
            type: v('type'),
            payoff: checked('payoff'),
            exclude: checked('exclude'),
            reason: v('reason'),
            realEstateAddress: realEstateAddress
          };
        });
      if (captured) {
        // Sanity-check: the table's E/P tags should agree with
        // what the form said. Log a warning if they don't (could
        // mean the row's tag rendering changed or the form open
        // captured stale state).
        if (visibleTags.exclude !== captured.exclude) {
          console.warn('[Copy LOP][liability] exclude mismatch for', captured.accountIdentifier,
            '— tag says', visibleTags.exclude, 'form says', captured.exclude);
        }
        if (visibleTags.payoff !== captured.payoff) {
          console.warn('[Copy LOP][liability] payoff mismatch for', captured.accountIdentifier,
            '— tag says', visibleTags.payoff, 'form says', captured.payoff);
        }
        out.push(captured);
      }
    }
    return out;
  }

  // Destination-side: after credit pull populates dest
  // liabilities, walk each captured source liability and apply
  // its Property / Payoff / Exclude+Reason settings to the
  // matching dest row (matched by accountIdentifier). Returns a
  // per-row report.
  async function applyLiabilityEdits(liabilityEdits) {
    console.group('[Copy LOP][liability edits] applyLiabilityEdits');
    if (!liabilityEdits || !liabilityEdits.length) {
      console.log('No edits to apply.');
      console.groupEnd();
      return { total: 0, applied: 0, skipped: 0, errors: [] };
    }
    // Only edits that actually carry data need a matching row.
    const actionable = liabilityEdits.filter(function (e) {
      return e && (e.payoff || e.exclude || e.realEstateAddress);
    });
    const wantedAccts = actionable
      .map(function (e) { return (e.accountIdentifier || '').trim(); })
      .filter(Boolean);
    console.log('Staged edits:', liabilityEdits.length,
      '— actionable:', actionable.length,
      '— wanted accountIdentifiers:', wantedAccts);

    // Helper: read the current dest table's rows + account #s
    function readDestTableSnapshot() {
      const t = document.querySelector('table[aria-label="Table for liabilities"]');
      if (!t) return { table: null, rows: [], accts: [] };
      const tbody = t.querySelector('tbody');
      if (!tbody) return { table: t, rows: [], accts: [] };
      const rows = Array.from(tbody.children).filter(function (tr) {
        const tds = tr.querySelectorAll('td');
        if (tds.length <= 1) return false;
        if (tr.getAttribute('data-cy') === 'add-entity-container') return false;
        const txt = (tr.textContent || '').replace(/\s+/g, '').trim();
        return !!txt;
      });
      const accts = rows.map(function (tr) {
        const tds = tr.querySelectorAll('td');
        return tds[4] ? (tds[4].textContent || '').replace(/\s+/g, ' ').trim() : '';
      }).filter(Boolean);
      return { table: t, rows: rows, accts: accts };
    }

    // Wait until either:
    //   - every wanted accountIdentifier appears in the dest table, OR
    //   - the row count is stable for several poll cycles
    //     (meaning credit returned and any remaining wanted accts
    //     simply aren't in this dest's pull), OR
    //   - 90 seconds passes (hard cap)
    updateProgress('Waiting for credit pull to populate liabilities…',
      'Watching the destination liabilities table for ' + wantedAccts.length + ' matching account(s).');
    const TIMEOUT_MS = 90 * 1000;
    const STABLE_REQUIRED = 4; // 4 polls × 800ms = ~3.2s of no change
    const t0 = Date.now();
    let lastAcctCount = -1;
    let stableTicks = 0;
    let lastSnap = readDestTableSnapshot();
    while (Date.now() - t0 < TIMEOUT_MS) {
      const snap = readDestTableSnapshot();
      lastSnap = snap;
      const presentWanted = wantedAccts.filter(function (a) {
        return snap.accts.indexOf(a) !== -1;
      });
      const allPresent = wantedAccts.length === 0 || presentWanted.length === wantedAccts.length;
      // Progress log every ~3s
      if ((Date.now() - t0) % 3000 < 850) {
        console.log('Polling liabilities…',
          'dest rows:', snap.accts.length,
          '| wanted ' + wantedAccts.length + ' / present ' + presentWanted.length,
          '| missing:', wantedAccts.filter(function (a) { return snap.accts.indexOf(a) === -1; }));
      }
      if (allPresent) {
        console.log('All wanted accts present at', Date.now() - t0, 'ms.');
        break;
      }
      // Stable-row-count exit: if row count hasn't moved for a few
      // ticks AND we have at least 1 row, the pull is done and
      // remaining wanted accts won't show up.
      if (snap.accts.length > 0 && snap.accts.length === lastAcctCount) {
        stableTicks++;
        if (stableTicks >= STABLE_REQUIRED) {
          console.warn('Row count stable for', stableTicks, 'ticks — proceeding even though some wanted accts are missing.');
          break;
        }
      } else {
        stableTicks = 0;
      }
      lastAcctCount = snap.accts.length;
      await wait(800);
    }
    if (!lastSnap.table) {
      console.warn('Liability table never rendered.');
      console.groupEnd();
      return { total: liabilityEdits.length, applied: 0, skipped: liabilityEdits.length, errors: [{ reason: 'Liabilities never populated' }] };
    }
    // Small final settle so React finishes hydrating any final row
    await wait(400);
    console.log('Final dest accts:', lastSnap.accts);

    const out = { total: liabilityEdits.length, applied: 0, skipped: 0, errors: [] };
    for (let i = 0; i < liabilityEdits.length; i++) {
      const edit = liabilityEdits[i];
      // Skip if there's nothing meaningful to apply
      if (!edit.payoff && !edit.exclude && !edit.realEstateAddress) {
        out.skipped++;
        continue;
      }
      updateProgress(
        'Applying liability edits…',
        'Row ' + (i + 1) + ' of ' + liabilityEdits.length + ' (' + (edit.creditor || edit.accountIdentifier || 'unknown') + ')'
      );
      // Find a matching dest row by account #. If it's not there
      // yet, give it one more short window — handles the case
      // where the pull was still streaming when we exited the
      // wait loop above on stable-row-count.
      let matchedRow = findLiabilityRowByAcct(edit.accountIdentifier);
      if (!matchedRow) {
        console.log('Row not found yet for', edit.accountIdentifier, '— extra-waiting up to 12s.');
        const extraT0 = Date.now();
        while (Date.now() - extraT0 < 12000) {
          await wait(700);
          matchedRow = findLiabilityRowByAcct(edit.accountIdentifier);
          if (matchedRow) {
            console.log('Row appeared for', edit.accountIdentifier, 'after extra', Date.now() - extraT0, 'ms.');
            break;
          }
        }
      }
      if (!matchedRow) {
        const snap = readDestTableSnapshot();
        console.warn('Still no match for', edit.accountIdentifier, '— dest accts now:', snap.accts);
        out.errors.push({ accountIdentifier: edit.accountIdentifier, reason: 'No matching dest row (dest had: ' + snap.accts.join(', ') + ')' });
        continue;
      }
      // Expand → apply → save
      const result = await expandRowAndApply(matchedRow, edit);
      console.log('Row apply result for', edit.accountIdentifier, ':', result);
      if (result.ok) out.applied++;
      else out.errors.push({ accountIdentifier: edit.accountIdentifier, reason: result.reason });
    }
    console.log('applyLiabilityEdits totals:', out);
    console.groupEnd();
    return out;
  }

  function findLiabilityRowByAcct(wantAcct) {
    const want = (wantAcct || '').trim();
    if (!want) return null;
    const t = document.querySelector('table[aria-label="Table for liabilities"]');
    if (!t) return null;
    const tbody = t.querySelector('tbody');
    if (!tbody) return null;
    return Array.from(tbody.children).find(function (tr) {
      const tds = tr.querySelectorAll('td');
      if (tds.length <= 1) return false;
      const acct = tds[4] ? (tds[4].textContent || '').replace(/\s+/g, ' ').trim() : '';
      return acct === want;
    }) || null;
  }

  async function expandRowAndApply(row, edit) {
    const chev = row.querySelector('td:first-child svg');
    const trigger = chev ? chev.parentElement : row;
    try { trigger.click(); } catch (_) { try { row.click(); } catch (__) {} }
    const formRoot = await waitForCondition(function () {
      const next = row.nextElementSibling;
      return next && next.querySelector('input[name="creditor"]') ? next : null;
    }, 3000);
    if (!formRoot) return { ok: false, reason: 'Edit form did not open' };
    await wait(200);

    // Payoff checkbox
    if (edit.payoff) {
      const cb = formRoot.querySelector('input[type="checkbox"][name="payoff"]');
      if (cb && !cb.checked) { cb.click(); await wait(150); }
    }
    // Exclude checkbox + Reason (Reason renders only after Exclude is checked)
    if (edit.exclude) {
      const cb = formRoot.querySelector('input[type="checkbox"][name="exclude"]');
      if (cb && !cb.checked) { cb.click(); await wait(250); }
      if (edit.reason) {
        const reasonSel = await waitForCondition(function () {
          return formRoot.querySelector('select[name="reason"]');
        }, 1500);
        if (reasonSel) {
          setReactSelectValue(reasonSel, edit.reason);
          await wait(150);
        }
      }
    }
    // Property link — map source address text to dest option
    if (edit.realEstateAddress) {
      const reSel = formRoot.querySelector('select[name="realEstateID"]');
      if (reSel) {
        const want = edit.realEstateAddress.toLowerCase();
        const opt = Array.from(reSel.options).find(function (o) {
          return (o.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() === want;
        });
        if (opt) {
          setReactSelectValue(reSel, opt.value);
          await wait(150);
        } else {
          console.warn('[Copy LOP][liability] no matching property option for', edit.realEstateAddress);
        }
      }
    }

    // Save
    const saveBtn = formRoot.querySelector('button[data-cy="save-liability-button"]');
    if (!saveBtn) return { ok: false, reason: 'Save button not found' };
    if (saveBtn.disabled || saveBtn.getAttribute('aria-disabled') === 'true') {
      // Try cancel-and-collapse rather than leaving an unsaved
      // form open
      const cancelBtn = Array.from(formRoot.querySelectorAll('button'))
        .find(function (b) { return (b.textContent || '').trim() === 'Cancel'; });
      if (cancelBtn) cancelBtn.click();
      return { ok: false, reason: 'Save button stayed disabled (form invalid?)' };
    }
    saveBtn.click();
    await waitForCondition(function () {
      const next = row.nextElementSibling;
      return !next || !next.querySelector('input[name="creditor"]');
    }, 3000);
    await wait(300);
    return { ok: true };
  }

  async function stageFromCurrentPage() {
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

    // Demographics collection.method — captured explicitly so we
    // can fall back to a safe default on paste if the source was
    // blank (the field is HMDA-required for save to pass).
    const demographicCollectionMethod = captureDemographicCollectionMethod(document);
    console.log('Demographics collection.method capture:', demographicCollectionMethod);

    const tableData = readTableData(document);
    console.group('Table data');
    Object.keys(tableData).forEach(function (k) {
      console.log(k + ':', tableData[k].length, 'rows', tableData[k]);
    });
    console.groupEnd();

    // Open each row of Real Estate / Liabilities to capture
    // form-only fields the table doesn't show. These take a few
    // seconds each so we surface progress. Run when we have any
    // real estate rows or more than just the placeholder
    // liability row — we lower the gate to >= 1 actual-content row
    // (tbody includes a placeholder row even when empty).
    let realEstateDetails = [];
    let liabilityEdits = [];
    const reTable = document.querySelector('table[aria-label="Table for real estates"]');
    const liabTable = document.querySelector('table[aria-label="Table for liabilities"]');
    function countContentRows(table) {
      if (!table) return 0;
      const rows = table.querySelectorAll('tbody tr');
      let n = 0;
      rows.forEach(function (tr) {
        const tds = tr.querySelectorAll('td');
        if (tds.length <= 1) return;
        if (!(tr.textContent || '').trim()) return;
        if (tr.getAttribute('data-cy') === 'add-entity-container') return;
        n++;
      });
      return n;
    }
    const reCount = countContentRows(reTable);
    const liabCount = countContentRows(liabTable);
    console.log('[Copy LOP] Per-row scrape gate — RE content rows:', reCount, 'Liab content rows:', liabCount);
    if (reCount >= 1 || liabCount >= 1) {
      showProgress('Reading per-row details…', 'Opening each Real Estate / Liability row to capture fields that LOP only shows in the form.');
      try {
        updateProgress('Reading Real Estate rows…', 'Opening each row to capture Property type / Current occupancy / Pending-sale date.');
        realEstateDetails = await scrapeRealEstateFromSource();
        console.log('[Copy LOP] Real estate details captured:', realEstateDetails.length, 'entries', realEstateDetails);
      } catch (e) { console.warn('[Copy LOP] real estate scrape failed', e); }
      try {
        updateProgress('Reading Liability rows…', 'Opening each row to capture Payoff / Exclude+Reason / Property link.');
        liabilityEdits = await scrapeLiabilitiesFromSource();
        console.log('[Copy LOP] Liability edits captured:', liabilityEdits.length, 'entries', liabilityEdits);
      } catch (e) { console.warn('[Copy LOP] liability scrape failed', e); }
      hideProgress();
    }

    // Pricing scenario capture — read Subject Property + Loan
    // Information + Pricing Info sections from the source's Full
    // Application page, AND the right-rail "Loan Details" panel
    // that shows the currently-assigned scenario (product name,
    // interest rate, points). All of this lives on the same
    // Full App page so no cross-page navigation is needed.
    let pricingScenario = null;
    try {
      pricingScenario = scrapePricingScenarioFromSource();
      console.log('[Copy LOP] Pricing scenario captured:', pricingScenario);
    } catch (e) { console.warn('[Copy LOP] pricing scenario scrape failed', e); }

    const stage = {
      sourceLoanId: loanIdFromUrl(),
      sourceBorrowerName: readBorrowerName(),
      capturedAt: Date.now(),
      url: location.pathname,
      fields: fields,
      tableData: tableData,
      realEstateDetails: realEstateDetails,
      liabilityEdits: liabilityEdits,
      pricingScenario: pricingScenario,
      demographicCollectionMethod: demographicCollectionMethod
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
      // The button stays disabled until the form is "dirty"
      // (a paste should make it dirty). If it's still disabled
      // we have nothing to save — that's fine, the file's
      // already in a saved state.
      console.log('[Copy LOP] Save button is disabled — already saved or nothing to save.');
      return { ok: true, alreadySaved: true };
    }
    console.log('[Copy LOP] Clicking Save loan file…', saveBtn);
    // Full mouse-event sequence so React's onClick handler fires
    // even when a plain .click() gets swallowed by the styled
    // wrapper (which we hit earlier on the Choose action button).
    try {
      saveBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      saveBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      saveBtn.click();
    } catch (e) {
      console.warn('[Copy LOP] Save click sequence threw:', e);
      try { saveBtn.click(); } catch (_) {}
    }
    // Wait for the save cycle to begin (button goes disabled).
    const wentDisabled = await waitForCondition(function () {
      return saveBtn.disabled || saveBtn.getAttribute('aria-disabled') === 'true';
    }, 2000);
    if (!wentDisabled) {
      console.warn('[Copy LOP] Save button never went disabled — click may not have fired.');
    } else {
      console.log('[Copy LOP] Save in progress (button disabled), waiting for it to complete…');
    }
    // Then wait for the save to complete. Some LOP saves take a
    // few seconds; cap at 10s.
    await waitForCondition(function () {
      // Save is done when the button is enabled OR when Choose
      // action becomes enabled (which is what we actually need).
      const action = document.querySelector('[data-cy="credit-actions-buttons"]');
      const actionReady = action && !action.disabled && action.getAttribute('aria-disabled') !== 'true';
      const saveDoneOrIdle = !saveBtn.disabled && saveBtn.getAttribute('aria-disabled') !== 'true';
      return actionReady || saveDoneOrIdle;
    }, 10000);
    // One more beat for the right-rail to render the enabled
    // Choose action.
    await wait(1500);
    const action = document.querySelector('[data-cy="credit-actions-buttons"]');
    const actionEnabled = !!(action && !action.disabled && action.getAttribute('aria-disabled') !== 'true');
    console.log('[Copy LOP] Save complete. Choose action enabled:', actionEnabled);
    return { ok: true, actionEnabled: actionEnabled };
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
      if (actionBtn.disabled || actionBtn.getAttribute('aria-disabled') === 'true') {
        return { ok: false, reason: 'Choose action button is still disabled — file may not have saved successfully. Try Save manually, then click Choose action → Reissue credit report.' };
      }
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
      if (actionBtn.disabled || actionBtn.getAttribute('aria-disabled') === 'true') {
        return { ok: false, reason: 'Choose action button is still disabled — file may not have saved successfully. Try Save manually, then click Choose action → Pull credit report.' };
      }
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

  // ===== Pricing & Scenarios auto-assign =========================
  //
  // After credit lands on the destination, drive Pricing &
  // Scenarios → Pricing: fill the form from the staged
  // pricingScenario, click Run pricing, find the row matching
  // the source's assigned product+rate, check it, click Assign
  // to loan, navigate back to Full Application.
  //
  // Heavy console logging throughout — every step prints what it
  // expects to find, what it found, and the action it took, so
  // failure modes are diagnosable from the console alone.

  async function runPricingAssign(stage) {
    console.group('[Copy LOP][pricing] runPricingAssign');
    if (!stage || !stage.pricingScenario) {
      console.warn('[Copy LOP][pricing] no pricingScenario staged — skipping');
      console.groupEnd();
      return { ok: false, reason: 'No pricingScenario captured at stage time. Re-stage the source loan with this extension version.' };
    }
    const ps = stage.pricingScenario;
    console.log('Source assignedScenario:', ps.assignedScenario);
    console.log('Source subjectProperty:', ps.subjectProperty);
    console.log('Source loanInformation:', ps.loanInformation);
    console.log('Source pricingInfo:', ps.pricingInfo);

    // Step 1: wait for credit to land. The pricing form needs
    // the dest's credit score + DTI which only populate after
    // CoreLogic returns. Poll for ~60s.
    try {
      const credit = await waitForCreditToLand(60000);
      console.log('[Copy LOP][pricing] credit settle:', credit);
    } catch (e) {
      console.warn('[Copy LOP][pricing] credit-settle wait threw — proceeding anyway', e);
    }

    // Step 2: navigate to Pricing & Scenarios → Pricing
    const navResult = await navigateToPricingTab();
    console.log('[Copy LOP][pricing] navigate result:', navResult);
    if (!navResult.ok) {
      console.groupEnd();
      return { ok: false, reason: 'Could not navigate to Pricing tab: ' + navResult.reason };
    }

    // Step 3: wait for the pricing form to mount
    const form = await waitForCondition(function () {
      // The pricing form has inputs named "mortgageType",
      // "fixedTerms", "armTerms", "purchasePrice", etc.
      const mt = document.querySelector('input[name="mortgageType"]');
      const pp = document.querySelector('input[name="purchasePrice"]');
      return (mt && pp) ? mt.closest('form') : null;
    }, 15000);
    if (!form) {
      console.warn('[Copy LOP][pricing] Pricing form never mounted');
      console.groupEnd();
      return { ok: false, reason: 'Pricing form did not appear after navigation.' };
    }
    console.log('[Copy LOP][pricing] Pricing form mounted', form);

    // Step 4: fill the form from staged data
    const fillResult = await fillPricingForm(form, stage);
    console.log('[Copy LOP][pricing] form fill result:', fillResult);

    // Step 4.5: dismiss the ZIP autocomplete + date picker
    // poppers that the form opens during fill. Run pricing
    // bounces with "Failed to run pricing" when these are open.
    await dismissPricingFormPoppers(form);

    // Step 5: click Run pricing
    const runBtn = Array.from(document.querySelectorAll('button')).find(function (b) {
      return /^run\s*pricing$/i.test((b.textContent || '').trim());
    });
    if (!runBtn) {
      console.warn('[Copy LOP][pricing] Run pricing button not found');
      console.groupEnd();
      return { ok: false, reason: 'Run pricing button not found on Pricing tab.' };
    }
    console.log('[Copy LOP][pricing] Clicking Run pricing', runBtn,
      'disabled=' + runBtn.disabled, 'aria-disabled=' + runBtn.getAttribute('aria-disabled'));
    if (runBtn.disabled || runBtn.getAttribute('aria-disabled') === 'true') {
      console.groupEnd();
      return { ok: false, reason: 'Run pricing stayed disabled — required fields missing. Check the fill result above.' };
    }
    clickWithMouseEvents(runBtn);

    // Step 6: wait for results to render
    const results = await waitForPricingResults(45000);
    console.log('[Copy LOP][pricing] results wait outcome:', results);
    if (!results.ok) {
      console.groupEnd();
      return { ok: false, reason: 'Pricing results never appeared: ' + results.reason };
    }

    // Step 7: pick matching product row + rate row
    const pick = await pickMatchingProductAndRate(ps.assignedScenario);
    console.log('[Copy LOP][pricing] product/rate pick result:', pick);
    if (!pick.ok) {
      console.groupEnd();
      return { ok: false, reason: 'Could not pick matching product/rate: ' + pick.reason };
    }

    // Step 8: click Assign to loan
    const assign = await clickAssignToLoan();
    console.log('[Copy LOP][pricing] Assign to loan result:', assign);
    if (!assign.ok) {
      console.groupEnd();
      return { ok: false, reason: 'Could not click Assign to loan: ' + assign.reason };
    }

    // Step 9: navigate back to Full Application
    const back = await navigateBackToFullApp();
    console.log('[Copy LOP][pricing] navigate back result:', back);

    console.groupEnd();
    return {
      ok: true,
      pickedProduct: pick.productName,
      pickedRate: pick.interestRate,
      points: pick.points
    };
  }

  // Wait for the credit pull to land for EVERY borrower on the
  // file. The right-rail Credit card lists each borrower by
  // name (e.g. "Mark Malone" / "Sarah Malone") with Soft / Hard
  // rows that fill in 3-digit scores once the pull completes.
  // We don't proceed until each name has at least one numeric
  // score next to it — otherwise pricing can run against an
  // incomplete preflight (and may pick the wrong tier).
  async function waitForCreditToLand(timeoutMs) {
    console.group('[Copy LOP][pricing] waitForCreditToLand');
    const expectedBorrowers = expectedBorrowerNamesForCredit();
    console.log('Expected borrowers (need a score each):', expectedBorrowers);
    const t0 = Date.now();
    let lastSeen = null;
    while (Date.now() - t0 < timeoutMs) {
      const seen = readPerBorrowerCreditScores();
      lastSeen = seen;
      // Every expected name needs to map to a name in `seen`
      // whose score array has at least one 3-digit entry.
      const allReady = expectedBorrowers.every(function (name) {
        const key = (name || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const hit = seen.find(function (s) {
          const sn = (s.name || '').replace(/\s+/g, ' ').trim().toLowerCase();
          return sn === key || sn.indexOf(key) !== -1 || key.indexOf(sn) !== -1;
        });
        return hit && hit.scores.length > 0;
      });
      if (allReady && expectedBorrowers.length > 0) {
        console.log('Per-borrower credit scores ready at', Date.now() - t0, 'ms:', seen);
        console.groupEnd();
        return { ok: true, perBorrower: seen, elapsed: Date.now() - t0 };
      }
      // Log a snapshot every few seconds so the console shows
      // progress (otherwise it looks frozen).
      if ((Date.now() - t0) % 4000 < 850) {
        console.log('Polling… expected', expectedBorrowers.length, 'borrowers; seen so far:', seen);
      }
      await wait(800);
    }
    console.warn('[Copy LOP][pricing] not every borrower had a score within', timeoutMs, 'ms. Last seen:', lastSeen);
    console.groupEnd();
    return { ok: false, reason: 'timed out waiting for per-borrower credit scores', lastSeen: lastSeen };
  }

  // Read every borrower name on the destination's personal-info
  // sections so we know how many scores to wait for.
  function expectedBorrowerNamesForCredit() {
    const names = [];
    document.querySelectorAll('[data-cy^="personal-info-section-"]').forEach(function (sec) {
      const first = sec.querySelector('input[name="first"]');
      const last = sec.querySelector('input[name="last"]');
      const f = first ? (first.value || '').trim() : '';
      const l = last ? (last.value || '').trim() : '';
      const name = (f + ' ' + l).trim();
      if (name) names.push(name);
    });
    return names;
  }

  // Look at the right-rail Credit card and return one entry
  // per borrower with their visible Hard (and Soft when pulled)
  // scores. LOP names each borrower's container with
  // [data-cy="<Borrower Name>"] and each score grid with
  // [data-cy="Hard"] / [data-cy="Soft"]; the 3-digit FICO spans
  // are direct children of those grids. We rely on these
  // data-cy attributes for a clean targeted read instead of the
  // earlier text-slicing heuristic (which broke when borrower
  // names appeared in tooltips or label text elsewhere on the
  // page).
  function readPerBorrowerCreditScores() {
    const result = [];
    const expected = expectedBorrowerNamesForCredit();
    expected.forEach(function (name) {
      // Primary: data-cy="<Borrower Name>" container
      let container = document.querySelector('[data-cy="' + cssEscape(name) + '"]');
      if (!container) {
        // Fallback: case-insensitive scan of [data-cy] attributes
        const all = document.querySelectorAll('[data-cy]');
        const target = name.toLowerCase();
        for (const el of all) {
          if ((el.getAttribute('data-cy') || '').toLowerCase() === target) {
            container = el; break;
          }
        }
      }
      if (!container) {
        result.push({ name: name, scores: [], hard: [], soft: [] });
        return;
      }
      function readGrid(typeCy) {
        const grid = container.querySelector('[data-cy="' + typeCy + '"]');
        if (!grid) return [];
        // The grid has a "Hard"/"Soft" label cell then three score
        // spans. Pull all 3-digit FICO-shaped strings from direct
        // descendants — skip dashes ("-") that show before a pull.
        const spans = grid.querySelectorAll('span');
        const out = [];
        spans.forEach(function (sp) {
          const t = (sp.textContent || '').replace(/\s+/g, '').trim();
          if (/^[3-8]\d{2}$/.test(t)) out.push(t);
        });
        return out;
      }
      const hard = readGrid('Hard');
      const soft = readGrid('Soft');
      result.push({
        name: name,
        scores: hard.concat(soft),
        hard: hard,
        soft: soft
      });
    });
    return result;
  }

  function cssEscape(s) {
    // Minimal CSS attribute-selector escape for borrower names.
    // Borrower names can contain ', " or other special chars.
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(s);
    }
    return String(s).replace(/(["'\\])/g, '\\$1');
  }

  async function navigateToPricingTab() {
    console.group('[Copy LOP][pricing] navigateToPricingTab');
    const link = document.querySelector('a[data-cy="subnav-pricing-scenarios"]');
    if (!link) {
      console.warn('Pricing & Scenarios subnav link not found');
      console.groupEnd();
      return { ok: false, reason: 'Pricing & Scenarios subnav link not in DOM' };
    }
    console.log('Clicking subnav:', link.href);
    clickWithMouseEvents(link);
    const ok = await waitForCondition(function () {
      return /pricing-and-scenarios/.test(location.pathname);
    }, 8000);
    console.log('URL now:', location.pathname);
    console.groupEnd();
    return ok ? { ok: true } : { ok: false, reason: 'URL never updated to /pricing-and-scenarios' };
  }

  async function fillPricingForm(form, stage) {
    console.group('[Copy LOP][pricing] fillPricingForm');
    const ps = stage.pricingScenario || {};
    const li = ps.loanInformation || {};
    const sp = ps.subjectProperty || {};
    const pi = ps.pricingInfo || {};
    const wrote = [];
    const skipped = [];

    // The Loan type, Fixed (Yrs), ARM (Fixed yrs) inputs are
    // comboboxes. Use selectComboboxOption — text-match the
    // option label.
    async function writeCombobox(name, value) {
      const inp = form.querySelector('input[name="' + name + '"]');
      if (!inp) { skipped.push(name + ' (input not found)'); return; }
      if (!value) { skipped.push(name + ' (no source value)'); return; }
      console.log('[combobox]', name, '→', value);
      const ok = await selectComboboxOption(inp, value);
      if (ok) wrote.push(name + '=' + value);
      else skipped.push(name + ' (option "' + value + '" not in list)');
    }
    function writeF(name, value, label) {
      label = label || name;
      const el = form.querySelector('input[name="' + name + '"], select[name="' + name + '"]');
      if (!el) { skipped.push(label + ' (input not found)'); return; }
      if (value == null || value === '') { skipped.push(label + ' (no source value)'); return; }
      if (el.tagName === 'SELECT') {
        const exists = Array.from(el.options || []).some(function (o) { return o.value === value; });
        if (!exists) { skipped.push(label + ' (option "' + value + '" not in select)'); return; }
        setReactSelectValue(el, value);
      } else {
        setReactInputValue(el, value);
      }
      wrote.push(label + '=' + value);
    }
    function writeCB(name, want, label) {
      label = label || name;
      const el = form.querySelector('input[type="checkbox"][name="' + name + '"]');
      if (!el) { skipped.push(label + ' (checkbox not found)'); return; }
      if (!!el.checked === !!want) { return; }
      setReactCheckedValue(el, !!want);
      wrote.push(label + '=' + (want ? 'checked' : 'unchecked'));
    }

    // Loan type — values like Conventional / FHA / VA
    await writeCombobox('mortgageType', mapMortgageType(li.loanType));
    await wait(150);
    // Fixed (Yrs) / ARM (Fixed yrs) — depends on amortizationType
    if (li.amortizationType === 'Fixed') {
      await writeCombobox('fixedTerms', li.loanTerm);
    } else if (li.amortizationType === 'Adjustable') {
      await writeCombobox('armTerms', li.loanTerm);
    }
    await wait(150);
    // Loan purpose select — usually pre-populated and disabled
    writeF('loanPurpose', li.loanPurpose, 'loanPurpose');
    // Money fields
    writeF('purchasePrice', stripDollar(li.purchasePrice), 'purchasePrice');
    writeF('appraisedValue', stripDollar(li.appraisedValue), 'appraisedValue');
    // Down payment $ + %  (downPayments.0.* on the dest)
    writeF('downPayments.0.downPayment', stripDollar(li.downPayment), 'downPayment');
    writeF('downPayments.0.downPaymentPercent', stripPercent(li.downPaymentPercent), 'downPaymentPercent');
    writeF('sellerCreditAmount', stripDollar(li.sellerCreditLumpSum), 'sellerCreditAmount');
    // Credit score — read from the eligibility panel (it
    // appeared after the credit pull).
    const fico = readDestFico();
    if (fico) writeF('fico', fico, 'fico');
    // Property / location
    // LOP's pricing form accepts only the 5-digit ZIP — the
    // source's addressZIP can carry a ZIP+4 ("30504-5682") which
    // causes a "Failed to run pricing" toast when submitted.
    writeF('propertyZIP', stripZipToFive(sp.addressZIP), 'propertyZIP');
    // LOP may open a "Select a City" modal when the ZIP maps to
    // multiple municipalities. Dismiss it by selecting the matching
    // city before continuing — otherwise the modal blocks the rest
    // of the form writes and Run pricing.
    const cityPickerResult = await dismissCityPickerIfPresent(sp.addressCity, sp.addressState);
    if (cityPickerResult.opened) {
      console.log('[Copy LOP][pricing] City picker handled:', cityPickerResult);
    }
    writeF('propertyCity', sp.addressCity, 'propertyCity');
    writeF('propertyCountyName', sp.addressCountyName, 'propertyCountyName');
    writeF('propertyState', sp.addressState, 'propertyState');
    writeF('propertyType', sp.propertyType, 'propertyType');
    writeF('attachmentType', sp.attachmentType, 'attachmentType');
    writeF('occupancyType', sp.propertyUse, 'occupancyType');
    writeCB('isPlannedUnitDevelopment', sp.pud, 'isPlannedUnitDevelopment');
    // Escrow
    writeF('escrowType', pi.escrowType, 'escrowType');
    // HOI / Taxes / HOA / other monthly
    writeF('hoiAmount', stripDollar(li.homeownersInsurance), 'hoiAmount');
    writeF('taxesAmount', stripDollar(li.taxes), 'taxesAmount');
    writeF('homeownersAssociationDues', stripDollar(li.homeownersAssociationDues), 'homeownersAssociationDues');
    writeF('otherMonthlyPayment', stripDollar(li.otherMonthlyPayment), 'otherMonthlyPayment');
    // FTHB
    writeCB('isFirstTimeHomebuyer', pi.isFirstTimeHomebuyer, 'isFirstTimeHomebuyer');
    // Est closing date
    writeF('estClosingDate', li.estClosingDate, 'estClosingDate');
    // Lock period — use 45 days default if source had it
    const lockDays = parseLockDays(ps.assignedScenario && ps.assignedScenario.lockPeriod);
    if (lockDays) writeF('lockPeriod', lockDays, 'lockPeriod');

    console.log('Wrote fields:', wrote);
    console.log('Skipped fields:', skipped);
    console.groupEnd();
    return { wrote: wrote, skipped: skipped };
  }

  function stripDollar(s) {
    if (s == null) return '';
    return String(s).replace(/[$,\s]/g, '').trim();
  }
  function stripPercent(s) {
    if (s == null) return '';
    return String(s).replace(/[%\s]/g, '').trim();
  }
  function stripZipToFive(s) {
    if (s == null) return '';
    const m = String(s).match(/(\d{5})/);
    return m ? m[1] : '';
  }

  // After writing into LOP's pricing form, the ZIP combobox
  // shows a Google-Places-style autocomplete popper and the
  // est-closing-date input opens a calendar popper. Both sit on
  // top of the form and cause Run pricing to bounce with
  // "Failed to run pricing. Please check the form for errors
  // and try again." (the popper intercepts the form's submit
  // validation). Close them with Escape + blur + a body click
  // before clicking Run pricing.
  async function dismissPricingFormPoppers(form) {
    console.group('[Copy LOP][pricing] dismissPricingFormPoppers');
    const targets = [];
    const zipInput = form.querySelector('input[name="propertyZIP"]');
    const dateInput = form.querySelector('input[name="estClosingDate"]');
    if (zipInput) targets.push({ el: zipInput, name: 'propertyZIP' });
    if (dateInput) targets.push({ el: dateInput, name: 'estClosingDate' });
    for (const t of targets) {
      try {
        console.log('Dismissing popper on', t.name);
        t.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        t.el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true, cancelable: true }));
        await wait(80);
        try { t.el.blur(); } catch (_) {}
        await wait(80);
      } catch (e) {
        console.warn('Popper dismiss threw for', t.name, e);
      }
    }
    // One final body-click catches any other open portaled
    // popper (custom dropdowns, tooltips, etc.) — but only
    // outside the form so it doesn't accidentally close fields
    // mid-update. Click an empty area of the eligibility panel
    // (the right rail), or fall back to the document body.
    try {
      const safe = document.querySelector('[class*="Eligibility"]') ||
                   document.querySelector('h1, h2') ||
                   document.body;
      if (safe && safe !== form && !form.contains(safe)) {
        console.log('Body-click on neutral area:', safe.tagName);
        clickWithMouseEvents(safe);
      }
    } catch (e) {
      console.warn('Body-click for popper dismiss threw', e);
    }
    await wait(150);
    console.groupEnd();
  }

  // After writing the ZIP into LOP's pricing form, LOP may open a
  // "Select a City" modal when the ZIP code maps to multiple
  // municipalities (e.g. 28081 → Centerview / Fisher Town / Glass /
  // Kannapolis / Royal Oaks / Shady Brook). Paste then stalls
  // because the modal blocks the form and the subsequent city /
  // county / state writes have no effect until it's dismissed.
  // Look for the modal, pick the row matching the staged city
  // (state too, when available), click its radio, and click Select.
  // Falls back to the first row only when no city match is found
  // AND no targetCity was provided — otherwise leaves the modal
  // open so the LO can pick correctly (better than silently picking
  // the wrong municipality on a real loan).
  async function dismissCityPickerIfPresent(targetCity, targetState) {
    const dialog = await waitForCondition(function () {
      const dialogs = document.querySelectorAll('section[role="dialog"][aria-modal="true"]');
      for (const d of dialogs) {
        const h = d.querySelector('h4');
        if (h && /select a city/i.test(h.textContent || '')) return d;
      }
      return null;
    }, 1800);
    if (!dialog) return { opened: false };

    console.group('[Copy LOP][pricing] dismissCityPickerIfPresent');
    console.log('Modal opened. Matching against city="' + (targetCity || '') + '", state="' + (targetState || '') + '"');
    const want = String(targetCity || '').trim().toLowerCase();
    const wantState = String(targetState || '').trim().toLowerCase();
    const rows = Array.prototype.slice.call(dialog.querySelectorAll('tbody tr'));
    let chosen = null;
    let chosenCity = '';
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) continue;
      const cityText = (cells[1].textContent || '').trim().toLowerCase();
      const stateText = (cells[3].textContent || '').trim().toLowerCase();
      if (cityText === want && (!wantState || stateText === wantState)) {
        chosen = row;
        chosenCity = (cells[1].textContent || '').trim();
        console.log('Matched row:', chosenCity);
        break;
      }
    }
    if (!chosen && !want && rows.length) {
      chosen = rows[0];
      const cells = chosen.querySelectorAll('td');
      chosenCity = cells.length >= 2 ? (cells[1].textContent || '').trim() : '(first)';
      console.warn('No target city provided; falling back to first row:', chosenCity);
    }
    if (!chosen) {
      console.warn('No row matched "' + targetCity + '" — leaving modal open for LO to pick.');
      console.groupEnd();
      return { opened: true, selected: false, reason: 'no-match' };
    }
    const radio = chosen.querySelector('input[type="radio"]');
    if (radio) {
      try {
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
        if (desc && desc.set) desc.set.call(radio, true); else radio.checked = true;
        radio.dispatchEvent(new Event('click', { bubbles: true }));
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        radio.dispatchEvent(new Event('input', { bubbles: true }));
        radio.click();
      } catch (e) {
        console.warn('Radio click threw', e);
      }
      await wait(140);
    }
    const selectBtn = await waitForCondition(function () {
      const btns = dialog.querySelectorAll('footer button');
      for (const b of btns) {
        if (!b.disabled && /^select\s*$/i.test((b.textContent || '').trim())) return b;
      }
      return null;
    }, 1500);
    if (!selectBtn) {
      console.warn('Select button did not enable; modal still open');
      console.groupEnd();
      return { opened: true, selected: false, reason: 'select-button-disabled' };
    }
    selectBtn.click();
    await wait(180);
    console.log('Selected:', chosenCity);
    console.groupEnd();
    return { opened: true, selected: true, city: chosenCity };
  }

  function parseLockDays(s) {
    if (!s) return '';
    const m = String(s).match(/(\d+)\s*days?/i);
    return m ? m[1] : '';
  }
  function mapMortgageType(loanType) {
    if (!loanType) return '';
    const v = String(loanType).trim();
    // The Loan Information uses raw values like "Conventional",
    // "FHA", "VA". The pricing combobox accepts the same labels.
    return v;
  }
  function readDestFico() {
    // The eligibility panel shows "Credit score: NNN" once the
    // pull lands. Read it.
    const text = (document.body.textContent || '');
    const m = text.match(/credit\s*score[:\s]*([3-8]\d{2})\b/i);
    return m ? m[1] : '';
  }

  // Wait for pricing results to render. The results table has
  // product groups like "3.00% Down Payment | 97.000% LTV"
  // headings with rows under them. Detection: any "Ineligible
  // Products" header (always present once pricing has run) or a
  // table row with class containing "pricing-results".
  async function waitForPricingResults(timeoutMs) {
    console.group('[Copy LOP][pricing] waitForPricingResults');
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const hasIneligible = Array.from(document.querySelectorAll('h2, h3, h4, h5')).some(function (h) {
        return /ineligible\s*products/i.test((h.textContent || '').trim());
      });
      const hasRowCheckbox = !!document.querySelector('[data-cy="pricing-results-row-checkbox"]');
      const hasArrowOrRow = !!document.querySelector('td button[data-cy*="expand"]') ||
        Array.from(document.querySelectorAll('td')).some(function (td) {
          return /\b\d+\.\d+%\s*Down\s*Payment/i.test((td.textContent || '').trim());
        });
      if (hasRowCheckbox || hasIneligible || hasArrowOrRow) {
        console.log('Results detected at', Date.now() - t0, 'ms — ineligible?', hasIneligible,
          'rowCheckbox?', hasRowCheckbox, 'rowOrArrow?', hasArrowOrRow);
        console.groupEnd();
        return { ok: true, elapsed: Date.now() - t0 };
      }
      await wait(800);
    }
    console.warn('Pricing results never rendered in', timeoutMs, 'ms');
    console.groupEnd();
    return { ok: false, reason: 'no results in time' };
  }

  // Pick the row whose product name (e.g. "Conf Home Poss 30 Yr
  // Fixed") matches the source's assignedScenario. If the source
  // product is at the top of the eligible list (always shown
  // expanded by default), check its single eligible-rate row. If
  // the source product is in a nested list (expanded by clicking
  // the row's arrow td), expand it first, then pick the row
  // whose interest rate matches.
  async function pickMatchingProductAndRate(assigned) {
    console.group('[Copy LOP][pricing] pickMatchingProductAndRate');
    const productWant = (assigned.productName || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const rateWant = (assigned.interestRate || '').replace(/[%\s]/g, '');
    const pointsWant = (assigned.pointsPrice || '').match(/[\d.]+/);
    const pointsWantNum = pointsWant ? pointsWant[0] : '';
    console.log('Want product:', productWant, 'rate:', rateWant, 'pointsBase:', pointsWantNum);

    if (!productWant) {
      console.warn('No product name in assignedScenario; cannot match.');
      console.groupEnd();
      return { ok: false, reason: 'no source product name to match against' };
    }

    // Scan ALL visible rows that contain BOTH the product name
    // text AND an interest rate cell + checkbox. The results
    // table is a flat table-of-tables; the top-level rows
    // collapse/expand to show nested rate rows.
    function findRowsForProduct(wantText) {
      const rows = Array.from(document.querySelectorAll('tr'));
      return rows.filter(function (tr) {
        const t = (tr.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        return t.indexOf(wantText) !== -1;
      });
    }

    let productRows = findRowsForProduct(productWant);
    console.log('Rows containing product text:', productRows.length);
    if (!productRows.length) {
      // Try a softer match — first 4 words of the product name
      const shortWant = productWant.split(/\s+/).slice(0, 4).join(' ');
      productRows = findRowsForProduct(shortWant);
      console.log('Fallback match using', shortWant, '→ rows:', productRows.length);
    }
    if (!productRows.length) {
      console.warn('No rows containing product name; available product names:',
        Array.from(document.querySelectorAll('tr')).slice(0, 30).map(function (r) {
          return (r.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        })
      );
      console.groupEnd();
      return { ok: false, reason: 'no row containing the product name "' + assigned.productName + '"' };
    }

    // Find the row that is the PRODUCT HEADER (collapsed parent)
    // — it has an arrow svg in its first td. Click that arrow
    // to expand. The header row has the product name but no
    // checkbox.
    let parentRow = null;
    for (const r of productRows) {
      const hasArrow = r.querySelector('td:first-child svg, td:first-child button');
      const hasCheckbox = r.querySelector('[data-cy="pricing-results-row-checkbox"]');
      if (hasArrow && !hasCheckbox) { parentRow = r; break; }
    }
    if (parentRow) {
      console.log('Found product header row, expanding…', parentRow);
      const arrowCell = parentRow.querySelector('td:first-child');
      if (arrowCell) {
        clickWithMouseEvents(arrowCell);
        await wait(500);
      }
    } else {
      console.log('No collapsed header row — product list may already be expanded.');
    }

    // Now find the rate row whose Int. rate cell matches rateWant.
    // Re-query: the rows-of-rates show as siblings after the
    // expanded header. Each has a checkbox.
    const allCheckboxRows = Array.from(document.querySelectorAll('tr')).filter(function (tr) {
      return !!tr.querySelector('[data-cy="pricing-results-row-checkbox"]');
    });
    console.log('All rate rows with a checkbox:', allCheckboxRows.length);

    // Score every rate row: prefer rows that ALSO mention the
    // product text (siblings under the same expanded product),
    // then match the rate cell.
    function rowRateValue(tr) {
      // The Int. rate column shows e.g. "6.490%". Try to find
      // it by looking for cells whose text is "N.NNN%".
      const cells = Array.from(tr.querySelectorAll('td')).map(function (td) {
        return (td.textContent || '').replace(/\s+/g, ' ').trim();
      });
      for (const c of cells) {
        const m = c.match(/^([0-9]+\.[0-9]{2,3})%$/);
        if (m) return m[1];
      }
      return '';
    }

    const candidates = allCheckboxRows.map(function (tr) {
      const rate = rowRateValue(tr);
      const containsProduct = (tr.textContent || '').toLowerCase().indexOf(productWant) !== -1;
      return { row: tr, rate: rate, containsProduct: containsProduct };
    });
    console.log('Candidate rows:', candidates.slice(0, 12).map(function (c) {
      return { rate: c.rate, hasProductText: c.containsProduct, snippet: (c.row.textContent || '').replace(/\s+/g, ' ').slice(0, 100) };
    }));

    // Pick: exact rate match preferred, then product-context preferred.
    // Compare numerically since "6.490" and "6.49" should match.
    function rateEqual(a, b) {
      const na = parseFloat(a);
      const nb = parseFloat(b);
      if (isNaN(na) || isNaN(nb)) return false;
      return Math.abs(na - nb) < 0.005;
    }
    let pick = null;
    if (rateWant) {
      pick = candidates.find(function (c) { return c.containsProduct && rateEqual(c.rate, rateWant); }) ||
             candidates.find(function (c) { return rateEqual(c.rate, rateWant); });
    }
    if (!pick) {
      console.warn('No exact rate match; falling back to the first product-context row.');
      pick = candidates.find(function (c) { return c.containsProduct; });
    }
    if (!pick) {
      console.error('[Copy LOP][pricing] no candidate row matched at all');
      console.groupEnd();
      return { ok: false, reason: 'no row matched product "' + assigned.productName + '" at rate ' + assigned.interestRate };
    }
    console.log('Picked row:', pick.rate, '|', (pick.row.textContent || '').replace(/\s+/g, ' ').slice(0, 120));
    const cb = pick.row.querySelector('[data-cy="pricing-results-row-checkbox"]');
    if (!cb) {
      console.error('Picked row has no checkbox??');
      console.groupEnd();
      return { ok: false, reason: 'matched row has no checkbox' };
    }
    if (!cb.checked) {
      clickWithMouseEvents(cb);
      await wait(500);
    }
    console.groupEnd();
    return { ok: true, productName: assigned.productName, interestRate: pick.rate, points: assigned.pointsPrice };
  }

  async function clickAssignToLoan() {
    console.group('[Copy LOP][pricing] clickAssignToLoan');
    // The button text is "Assign to loan"; the wrapper is a
    // disabled-when-no-row-checked styled button. Click the
    // INNER button (the one with the text), not the tooltip
    // wrapper.
    const btn = await waitForCondition(function () {
      const all = Array.from(document.querySelectorAll('button'));
      return all.find(function (b) {
        const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
        return /^assign\s*to\s*loan$/i.test(t) && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
      });
    }, 6000);
    if (!btn) {
      console.warn('Assign to loan button not found (or stayed disabled)');
      console.groupEnd();
      return { ok: false, reason: 'Assign to loan button not enabled' };
    }
    console.log('Clicking Assign to loan:', btn);
    clickWithMouseEvents(btn);
    await wait(800);
    // LOP usually navigates to /scenarios after assign; wait for
    // either that URL or a confirmation toast.
    const navOk = await waitForCondition(function () {
      return /\/scenarios(?:$|\/|\?)/.test(location.pathname) ||
        (document.body.textContent || '').toLowerCase().indexOf('assigned') !== -1;
    }, 10000);
    console.log('Post-assign nav OK:', navOk, 'at', location.pathname);
    console.groupEnd();
    return { ok: true };
  }

  async function navigateBackToFullApp() {
    console.group('[Copy LOP][pricing] navigateBackToFullApp');
    const link = document.querySelector('a[data-cy="subnav-full-application"]');
    if (!link) {
      console.warn('Full application subnav link not found');
      console.groupEnd();
      return { ok: false, reason: 'full-application link missing' };
    }
    clickWithMouseEvents(link);
    const ok = await waitForCondition(function () {
      return /\/full-application(?:$|\/|\?)/.test(location.pathname);
    }, 8000);
    console.log('Now at', location.pathname);
    console.groupEnd();
    return ok ? { ok: true } : { ok: false, reason: 'URL never updated to /full-application' };
  }

  // Before the field paste runs, check the borrower count on the
  // destination. If the source had more borrowers than the dest
  // (e.g. source=2 pair, dest=1), drive LOP's "+" tab to add the
  // missing co-borrower(s) so personal-info-section-1 (etc.)
  // actually exists when we try to write into it. Otherwise the
  // co-borrower's first/last/dob/ssn/etc. either silently fall on
  // the primary or get reported as noMatch.
  async function addMissingBorrowersToDest(stage) {
    const srcBorrowers = countBorrowerSections(stage.fields);
    const destBorrowers = countCurrentBorrowerSections();
    if (srcBorrowers <= destBorrowers) return { ok: true, added: 0 };
    const toAdd = srcBorrowers - destBorrowers;

    // Group source fields by borrower-section index so we can
    // pull each missing co-borrower's first/middle/last/suffix.
    const srcSections = {};
    (stage.fields || []).forEach(function (rec) {
      if (!rec.scope || rec.scope.type !== 'personal-info-section') return;
      const k = rec.scope.index;
      if (!srcSections[k]) srcSections[k] = {};
      srcSections[k][rec.name] = rec.value;
    });

    console.group('[Copy LOP] Add missing co-borrowers (' + toAdd + ' to add)');
    let added = 0;
    for (let idx = destBorrowers; idx < srcBorrowers; idx++) {
      const src = srcSections[String(idx)];
      if (!src) {
        console.warn('[Copy LOP] No source data for borrower index', idx);
        continue;
      }
      updateProgress(
        'Adding co-borrower ' + (idx + 1) + '…',
        'Driving the + tab + Add a new borrower dialog.'
      );
      const result = await addOneCoBorrower(src);
      console.log('Add co-borrower', idx, 'result:', result);
      if (!result.ok) {
        console.groupEnd();
        return { ok: false, added: added, reason: result.reason };
      }
      added++;
      // Wait for the new personal-info-section to render in the DOM
      await waitForCondition(function () {
        return document.querySelectorAll('[data-cy^="personal-info-section-"]').length >= destBorrowers + added;
      }, 5000);
      await wait(600);
    }
    console.groupEnd();
    return { ok: true, added: added };
  }

  function findAddBorrowerTabButton() {
    // Primary: LOP gives the + tab a stable id.
    const byId = document.getElementById('add-primary-borrower');
    if (byId) return byId;

    // Fallback 1: any element with role=tab whose text is exactly "+".
    const tabs = document.querySelectorAll('[role="tab"]');
    for (const t of tabs) {
      const txt = (t.textContent || '').replace(/\s+/g, '').trim();
      if (txt === '+') return t;
    }

    // Fallback 2: walk every button looking for one with text "+" that
    // lives near the borrower-pair tabs.
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const txt = (btn.textContent || '').replace(/\s+/g, '').trim();
      if (txt !== '+') continue;
      let p = btn.parentElement;
      for (let i = 0; i < 8 && p; i++) {
        if (p.querySelector('[data-cy^="borrower-pair-tab-"]')) return btn;
        p = p.parentElement;
      }
    }
    // Fallback 3: aria-label "Add borrower" or similar
    for (const btn of buttons) {
      const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (/add\s*(co.?)?borrower/.test(lbl)) return btn;
    }
    return null;
  }

  async function addOneCoBorrower(srcBorrower) {
    const plusBtn = findAddBorrowerTabButton();
    if (!plusBtn) {
      return { ok: false, reason: '"+" tab button not found — DOM may have changed; please add co-borrower manually then re-paste' };
    }
    console.log('[Copy LOP] Clicking + tab', plusBtn,
      'disabled=' + plusBtn.disabled,
      'aria-disabled=' + plusBtn.getAttribute('aria-disabled'));
    // Use a full mouse-event sequence (mousedown→mouseup→click) so
    // React's tab handler actually picks it up. Bare .click() can
    // be swallowed by styled wrappers (same reason we needed the
    // full sequence for the Save button).
    clickWithMouseEvents(plusBtn);

    // Find the Add-new-borrower dialog. Be permissive about
    // selectors — LOP renders dialogs as section[role="dialog"][aria-modal]
    // but also sometimes as plain divs with role=dialog, and the
    // title may sit inside <header><h4> or be referenced via
    // aria-labelledby. Match any [role="dialog"] (or aria-modal)
    // whose visible text contains "Add a new borrower" near the top,
    // OR fall back to walking up from the input[name="first"] which
    // only exists on this dialog.
    let dialog = await waitForCondition(findAddBorrowerDialog, 6000);
    if (!dialog) {
      // Salvage: input[name="first"] only renders on this dialog.
      // If it's present, the dialog IS open — our wrapper match
      // just failed. Use the input's nearest sensible ancestor.
      const firstInput = document.querySelector('input[name="first"]');
      if (firstInput) {
        dialog = firstInput.closest('[role="dialog"], [aria-modal="true"], section, dialog, form') || firstInput.parentElement;
        console.log('[Copy LOP] Dialog found via input[name="first"] fallback:', dialog);
      }
    }
    if (!dialog) return { ok: false, reason: 'Add a new borrower dialog did not open' };

    await wait(200);
    fillAddBorrowerDialog(dialog, srcBorrower);
    await wait(250);

    // Ensure the "Coborrower with..." radio is selected (it's
    // usually the default, but be defensive in case LOP changes
    // the default to "New application" in some flow).
    const radios = dialog.querySelectorAll('input[type="radio"]');
    let coRadio = null;
    radios.forEach(function (r) {
      // The label text for the matching radio reads like
      // "Coborrower with Sekou Swaray". Walk to find it.
      let label = '';
      // Try the input's parent/sibling label first
      if (r.id) {
        const l = dialog.querySelector('label[for="' + r.id + '"]');
        if (l) label = (l.textContent || '').replace(/\s+/g, ' ').trim();
      }
      if (!label && r.parentElement) {
        label = (r.parentElement.textContent || '').replace(/\s+/g, ' ').trim();
      }
      if (/coborrower\s*with/i.test(label)) coRadio = r;
    });
    if (coRadio && !coRadio.checked) {
      console.log('[Copy LOP] Clicking "Coborrower with" radio');
      coRadio.click();
      await wait(150);
    }

    // Click Create borrower
    const createBtn = Array.from(dialog.querySelectorAll('button')).find(function (b) {
      return /^create\s*borrower$/i.test((b.textContent || '').trim());
    });
    if (!createBtn) return { ok: false, reason: '"Create borrower" button not found in dialog' };
    if (createBtn.disabled || createBtn.getAttribute('aria-disabled') === 'true') {
      // The button enables only when First name + Last name are
      // both filled. If we couldn't fill those, fall back to a
      // user-visible message.
      return { ok: false, reason: '"Create borrower" stayed disabled — First/Last name fill probably failed' };
    }
    console.log('[Copy LOP] Clicking Create borrower');
    createBtn.click();

    // Wait for the dialog to close
    await waitForCondition(function () {
      return !findAddBorrowerDialog() && !document.querySelector('input[name="first"]');
    }, 6000);
    await wait(500);
    return { ok: true };
  }

  function findAddBorrowerDialog() {
    const dlgs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
    for (const d of dlgs) {
      const head = (d.textContent || '').replace(/\s+/g, ' ').slice(0, 200);
      if (/add\s*(a\s*)?new\s*borrower/i.test(head)) return d;
      const labelId = d.getAttribute('aria-labelledby');
      if (labelId) {
        const lbl = document.getElementById(labelId);
        if (lbl && /add\s*(a\s*)?new\s*borrower/i.test(lbl.textContent || '')) return d;
      }
    }
    return null;
  }

  function clickWithMouseEvents(el) {
    try {
      ['mousedown', 'mouseup', 'click'].forEach(function (type) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0 }));
      });
    } catch (_) {
      try { el.click(); } catch (_) {}
    }
  }

  function fillAddBorrowerDialog(dialog, src) {
    // LOP names the inputs first/middle/last/suffix on the dialog.
    // Fall back to label-text matching if that ever changes.
    function pick(nameAttr, labelRe) {
      let inp = dialog.querySelector('input[name="' + nameAttr + '"]');
      if (inp) return inp;
      const labels = dialog.querySelectorAll('label');
      for (const lbl of labels) {
        const t = (lbl.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (!labelRe.test(t)) continue;
        const id = lbl.getAttribute('for');
        if (id) {
          const found = document.getElementById(id);
          if (found && found.tagName === 'INPUT') return found;
        }
        const wrap = lbl.parentElement;
        if (wrap) {
          const found = wrap.querySelector('input[type="text"], input:not([type])');
          if (found) return found;
        }
      }
      return null;
    }

    const firstInput = pick('first', /^(legal\s*)?first\s*name/);
    const middleInput = pick('middle', /^middle\s*name/);
    const lastInput = pick('last', /^(legal\s*)?last\s*name/);
    const suffixInput = pick('suffix', /^suffix/);

    if (firstInput && src.first) setReactInputValue(firstInput, src.first);
    if (middleInput && src.middle) setReactInputValue(middleInput, src.middle);
    if (lastInput && src.last) setReactInputValue(lastInput, src.last);
    if (suffixInput && src.suffix) setReactInputValue(suffixInput, src.suffix);
  }

  // Confirm every borrower the source had (one section per index)
  // is ready for credit on the destination:
  //   - personal-info-section has first / last / DOB / SSN populated
  //   - address-section has at least one address row
  // Both are required before LOP will let the credit pull run
  // (CoreLogic needs every applicant identified with an address).
  // Returns a per-borrower issue list so the summary surfaces
  // specifics.
  // Re-write softCreditConsent / hardCreditConsent from the staged
  // values onto every borrower's credit-consent-section. Used as
  // a fallback when the first paste missed a freshly-added
  // co-borrower's consent dropdowns.
  async function retryCreditConsentPaste(stage) {
    const bySection = {};
    (stage.fields || []).forEach(function (rec) {
      if (!rec.scope || rec.scope.type !== 'credit-consent-section') return;
      const k = rec.scope.index;
      if (!bySection[k]) bySection[k] = {};
      bySection[k][rec.name] = rec.value;
    });
    for (const idx of Object.keys(bySection)) {
      const sec = document.querySelector('[data-cy="credit-consent-section-' + idx + '"]');
      if (!sec) continue;
      const vals = bySection[idx];
      ['softCreditConsent', 'hardCreditConsent'].forEach(function (name) {
        if (!vals[name]) return;
        const el = sec.querySelector('select[name="' + name + '"]');
        if (!el) return;
        const cur = (el.value || '').trim();
        if (cur === vals[name]) return;
        const optionExists = Array.from(el.options || []).some(function (o) { return o.value === vals[name]; });
        if (!optionExists) return;
        setReactSelectValue(el, vals[name]);
        console.log('[Copy LOP][consent retry] set', name, 'on borrower', idx, '→', vals[name]);
      });
      await wait(120);
    }
  }

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

      // 3. Credit consent — LOP rejects the credit pull when any
      // borrower is missing soft/hard consent. The brand-new
      // co-borrower (just added via the + tab) usually defaults
      // to a blank consent dropdown and the source's "Verbal"
      // value needs to land before credit fires.
      const consentSec = document.querySelector('[data-cy="credit-consent-section-' + idx + '"]');
      if (consentSec) {
        const softSel = consentSec.querySelector('select[name="softCreditConsent"]') ||
                        consentSec.querySelector('input[name="softCreditConsent"]');
        const hardSel = consentSec.querySelector('select[name="hardCreditConsent"]') ||
                        consentSec.querySelector('input[name="hardCreditConsent"]');
        const softVal = softSel ? (softSel.value || '').trim() : '';
        const hardVal = hardSel ? (hardSel.value || '').trim() : '';
        if (!softVal) issues.push(borrowerName + ': soft credit consent not set');
        if (!hardVal) issues.push(borrowerName + ': hard credit consent not set');
      } else {
        // The consent section is rendered alongside the personal-
        // info section; if it's not there for this borrower index,
        // the new co-borrower's UI hasn't fully hydrated yet.
        issues.push(borrowerName + ': credit-consent section not yet rendered (try re-paste in a moment)');
      }
    });
    return { ok: issues.length === 0, issues: issues };
  }

  // Stages older than this are dropped from chrome.storage on the
  // next load — keeps the "Paste from staged" picker tidy and
  // prevents stale data from sitting around indefinitely. A loan
  // staged this morning is useful at 4 PM; one staged 3 days ago
  // almost certainly isn't, and showing it just clutters the list.
  const STAGE_TTL_MS = 24 * 60 * 60 * 1000;

  function loadStages() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get([STORAGE_KEY], function (data) {
          const arr = (data && data[STORAGE_KEY]) || [];
          if (!Array.isArray(arr)) return resolve([]);
          const now = Date.now();
          const fresh = arr.filter(function (s) {
            const ts = Number(s && s.capturedAt) || 0;
            return ts && (now - ts) < STAGE_TTL_MS;
          });
          // If we dropped anything, persist the trimmed list so
          // expired stages don't keep getting filtered on every read.
          if (fresh.length !== arr.length) {
            try {
              const payload = {};
              payload[STORAGE_KEY] = fresh;
              chrome.storage.local.set(payload, function () { resolve(fresh); });
              return;
            } catch (_) {}
          }
          resolve(fresh);
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
    const norm = String(text).toLowerCase().trim();
    // Exact match first.
    if (ASSET_TYPE_MAP[norm]) return ASSET_TYPE_MAP[norm];
    // Fuzzy fallback: LOP sometimes renders the asset row's Type cell
    // with a one-letter badge appended to the type name (e.g. the
    // "D" pill next to "Checking account" that marks the asset as a
    // depository account). cell.textContent collects both, producing
    // strings like "checking account d" or "checking accountd" that
    // miss the exact-match table. Pick the longest known type that
    // appears at the start of the normalized cell text.
    let best = '';
    let bestLen = 0;
    for (const key of Object.keys(ASSET_TYPE_MAP)) {
      if (norm.indexOf(key) === 0 && key.length > bestLen) {
        best = ASSET_TYPE_MAP[key];
        bestLen = key.length;
      }
    }
    return best;
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

  // Multi-select combobox driver for Borrower(s) fields that
  // accept multiple borrowers (e.g. Real Estate). The dropdown
  // contains a [role="option"] for each borrower, each holding
  // a checkbox + label. Different LOP versions wire the click
  // handler differently — sometimes the checkbox commits, other
  // times the label, other times the option wrapper. We try
  // each in turn and VERIFY the chip actually appears in the
  // combobox wrapper before declaring success.
  async function selectMultiBorrowerCombobox(input, wantNames) {
    if (!input || !wantNames || !wantNames.length) return { ok: false, reason: 'no names' };
    // The chips render inside the combobox's wrapper as
    // <span class="StyledTag…">Name<button>X</button></span>.
    const wrap = input.closest('[class*="StyledComboboxInput"]') || input.parentElement;
    function chipsInWrap() {
      if (!wrap) return [];
      return Array.from(wrap.querySelectorAll('[class*="StyledTag"]'))
        .map(function (c) {
          // Strip the close button text so just the name remains
          const clone = c.cloneNode(true);
          clone.querySelectorAll('button').forEach(function (b) { b.remove(); });
          return (clone.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        });
    }
    function hasChip(want) {
      return chipsInWrap().some(function (c) {
        return c && (c === want || c.indexOf(want) !== -1 || want.indexOf(c) !== -1);
      });
    }
    async function openListbox() {
      try { input.focus(); } catch (_) {}
      clickWithMouseEvents(input);
      await wait(220);
      if (input.getAttribute('aria-expanded') !== 'true') {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        await wait(220);
      }
    }
    function findOptionForName(want) {
      const lbs = document.querySelectorAll('[role="listbox"]');
      for (const lb of lbs) {
        if (lb.offsetHeight === 0 && lb.offsetWidth === 0) continue;
        const options = lb.querySelectorAll('[role="option"]');
        for (const opt of options) {
          const t = (opt.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
          if (t === want || t.indexOf(want) === 0 || want.indexOf(t) === 0) return opt;
        }
        // Fallback: a <label> in the listbox whose text matches
        const labels = lb.querySelectorAll('label');
        for (const lbl of labels) {
          const t = (lbl.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
          if (t === want || t.indexOf(want) === 0 || want.indexOf(t) === 0) {
            return lbl.closest('[role="option"]') || lbl.parentElement;
          }
        }
      }
      return null;
    }
    const matched = [];
    const missed = [];
    for (const name of wantNames) {
      const want = String(name).replace(/\s+/g, ' ').trim().toLowerCase();
      if (hasChip(want)) { matched.push(name); continue; }

      await openListbox();
      const hit = findOptionForName(want);
      if (!hit) {
        console.warn('[Copy LOP][multi-borrower] no option for', name);
        missed.push(name);
        continue;
      }

      // Try checkbox → label → option wrapper, verifying chip each time
      const checkbox = hit.querySelector('input[type="checkbox"]');
      const label = hit.querySelector('label');
      let committed = false;

      if (checkbox) {
        clickWithMouseEvents(checkbox);
        await wait(220);
        committed = hasChip(want);
      }
      if (!committed && label) {
        clickWithMouseEvents(label);
        await wait(220);
        committed = hasChip(want);
      }
      if (!committed) {
        clickWithMouseEvents(hit);
        await wait(220);
        committed = hasChip(want);
      }
      // Final salvage: type the name and press Enter
      if (!committed) {
        try {
          input.focus();
          setReactInputValue(input, name);
          await wait(200);
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
          await wait(220);
          committed = hasChip(want);
        } catch (_) {}
      }

      if (committed) matched.push(name);
      else {
        console.warn('[Copy LOP][multi-borrower] chip never committed for', name,
          '— tried checkbox/label/wrapper/type+Enter');
        missed.push(name);
      }
    }
    // Close the listbox so subsequent form fields don't get
    // blocked by the popper.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    try { input.blur(); } catch (_) {}
    await wait(150);
    return { ok: missed.length === 0, matched: matched, missed: missed };
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

    // Borrower(s) is a MULTI-SELECT combobox (named "borrowerIds"
    // on the asset form — lowercase "d", unlike real estate's
    // "borrowerIDs"). The dropdown shows a checkbox next to each
    // borrower name. Picking via the single-select combobox helper
    // returns true but doesn't always commit the chip (LOP's
    // multi-select wants the underlying checkbox toggled, not the
    // option div clicked). Use the dedicated multi picker — same
    // helper used by pasteRealEstateRow above.
    const borrowerInput = form.querySelector('input[name="borrowerIds"]');
    if (borrowerInput && row['Borrower(s)']) {
      const wantNames = String(row['Borrower(s)']).split(/\s*(?:&|and|,)\s*/).filter(Boolean);
      const result = await selectMultiBorrowerCombobox(borrowerInput, wantNames);
      console.log('[Copy LOP][assets] select borrowers', wantNames, '→', result);
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
      // Inspect the still-open form and figure out which required field
      // failed validation, so the LO sees a useful message instead of a
      // stale "probably Borrower(s)" guess.
      const stillForm = getAddForm(table);
      const missing = [];
      if (stillForm) {
        const typeSel = stillForm.querySelector('select[name="type"]');
        if (typeSel && !typeSel.value) {
          const sourceType = row['Type'] || '(empty)';
          missing.push('Asset or credit type (source had "' + sourceType + '" — no matching LOP option found, pick manually)');
        }
        const borrowerChips = stillForm.querySelectorAll('[data-cy^="combobox-tag-"], .css-1rhbuit-multiValue');
        if (borrowerChips.length === 0) {
          missing.push('Borrower(s)');
        }
        const instInput = stillForm.querySelector('input[name="financialInstitution"]');
        if (instInput && instInput.required && !instInput.value) missing.push('Financial institution');
        const amtInput = stillForm.querySelector('input[name="amount"]');
        if (amtInput && amtInput.required && !amtInput.value) missing.push('Amount');
      }
      const reason = missing.length
        ? 'Save did not close — required field(s) empty: ' + missing.join(', ') + '. Fill the highlighted field(s) manually, then click Add.'
        : 'Save did not close — fill any red-outlined required field manually, then click Add.';
      return { ok: false, reason: reason };
    }
    return { ok: true };
  }

  // Look up the captured form-only details from
  // scrapeRealEstateFromSource() for a given row, joining on the
  // displayed address.
  function findRealEstateDetails(stage, row) {
    if (!stage || !stage.realEstateDetails) return null;
    const want = String(row['Address'] || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!want) return null;
    return stage.realEstateDetails.find(function (d) {
      return String(d.displayAddress || '').replace(/\s+/g, ' ').trim().toLowerCase() === want;
    }) || null;
  }

  async function pasteRealEstateRow(row, stage) {
    const table = findTable('Table for real estates');
    if (!table) return { ok: false, reason: 'table not found' };
    const addBtn = findAddButtonForTable(table);
    if (!addBtn || addBtn.disabled) return { ok: false, reason: 'Add button not available' };
    addBtn.click();
    await wait(250);
    const form = await waitForCondition(function () { return getAddForm(table); }, 3000);
    if (!form) return { ok: false, reason: 'Add form did not appear' };
    await wait(150);

    // Borrower(s) is a MULTI-SELECT combobox (named "borrowerIDs"
    // on this form). The dropdown shows a checkbox next to each
    // borrower name. Picking via the single-select combobox helper
    // returns true but doesn't always commit the chip (LOP's
    // multi-select wants the underlying checkbox toggled, not the
    // option div clicked). Use a dedicated picker that opens the
    // listbox once and clicks each name's checkbox by label match.
    const borrowerInput = form.querySelector('input[name="borrowerIDs"]');
    if (borrowerInput && row['Borrower(s)']) {
      const wantNames = String(row['Borrower(s)']).split(/\s*(?:&|and|,)\s*/).filter(Boolean);
      const result = await selectMultiBorrowerCombobox(borrowerInput, wantNames);
      console.log('[Copy LOP][real estate] select borrowers', wantNames, '→', result);
    }
    // Existing address dropdown — when the borrower's saved
    // addresses match this property's address, picking the
    // matching option auto-fills Country/Address/City/State/Zip
    // (and clears the "Address is required" red text). The select
    // options carry the full one-line address as the value.
    const existingSel = form.querySelector('select[name="existingAddresses"]');
    if (existingSel) {
      const want = String(row['Address'] || '').replace(/\s+/g, ' ').trim().toLowerCase();
      let matchVal = '';
      for (const opt of existingSel.options) {
        const ov = (opt.value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (ov && (ov === want || ov.indexOf(want) === 0 || want.indexOf(ov) === 0)) {
          matchVal = opt.value;
          break;
        }
      }
      if (matchVal) {
        writeSelect(form, 'existingAddresses', matchVal);
        await wait(150);
      }
    }

    writeSelect(form, 'country', 'US');
    const addr = parseAddressLine(row['Address']);
    writeInput(form, 'streetAddress', addr.street);
    writeInput(form, 'city', addr.city);
    writeSelect(form, 'state', addr.state);
    writeInput(form, 'zipCode', addr.zip);
    // Dismiss the Google-Places autocomplete popper that the
    // streetAddress input pops open (it overlaps the form and
    // can block Save).
    const streetInput = form.querySelector('input[name="streetAddress"]');
    if (streetInput) { try { streetInput.blur(); } catch (_) {} }
    document.body.click();
    await wait(150);

    // Form-only fields (Property type, Current occupancy,
    // PendingSale date, willBePaidPriorToClosing) come from the
    // source-side scrapeRealEstateFromSource() pass that opens
    // each row's edit form. Match by address.
    const details = findRealEstateDetails(stage, row);
    if (!details) {
      console.warn('[Copy LOP][real estate] no source-side details for',
        row['Address'], '— stage.realEstateDetails has',
        (stage.realEstateDetails || []).length, 'entries');
    }
    if (details) {
      if (details.propertyType) writeSelect(form, 'propertyType', details.propertyType);
      if (details.currentOccupancy) writeSelect(form, 'currentOccupancy', details.currentOccupancy);
    }

    // Property value — prefer the form-captured value over the
    // row's display (rows can lose precision on rounding).
    const pv = parseAmount(details && details.propertyValue ? details.propertyValue : row['Property value']);
    if (pv) writeInput(form, 'propertyValue', pv);

    const status = (details && details.status) || mapRealEstateStatus(row['Status']);
    if (status) {
      writeSelect(form, 'status', status);
      await wait(300);  // PendingSale reveals an extra date field
      if ((status === 'PendingSale' || status === 'Sold') && details && details.estimatedClosingDate) {
        writeInput(form, 'estimatedClosingDate', details.estimatedClosingDate);
        await wait(150);
      }
      if (details && details.willBePaidPriorToClosing) {
        const cb = form.querySelector('input[type="checkbox"][name="willBePaidPriorToClosing"]');
        if (cb && !cb.checked) { cb.click(); await wait(120); }
      }
    }

    const intended = (details && details.intendedOccupancy) || mapOccupancy(row['Intended']);
    if (intended) writeSelect(form, 'intendedOccupancy', intended);

    const fs = (details && details.financialStatus) || mapFinancialStatus(row['Mortgage / HELOC']);
    if (fs) writeSelect(form, 'financialStatus', fs);

    // Expenses
    if (details) {
      if (details.taxes) writeInput(form, 'taxes', details.taxes);
      if (details.insurance) writeInput(form, 'insurance', details.insurance);
      if (details.hoaDues) writeInput(form, 'hoaDues', details.hoaDues);
    }

    await wait(200);

    const saveBtn = form.querySelector('button[data-cy="save-real-estate-button"]');
    if (!saveBtn) return { ok: false, reason: 'Save button not found' };
    saveBtn.click();
    const closed = await waitForCondition(function () { return !getAddForm(table); }, 4000);
    await wait(400);
    if (!closed) {
      // If we DID open the source row and capture details, save
      // should generally succeed — the only thing the dest can be
      // missing is the multi-select Borrower(s) which the
      // combobox driver may not always pick reliably. If we did
      // NOT capture details (source had no form opened), the
      // form-only required fields are blank.
      const missing = [];
      if (!details || !details.propertyType) missing.push('Property type');
      if (!details || !details.currentOccupancy) missing.push('Current occupancy');
      if ((status === 'PendingSale' || status === 'Sold') && !(details && details.estimatedClosingDate)) {
        missing.push('Pending sale or sold date');
      }
      const reason = missing.length
        ? 'Save did not close — finish these required fields manually: ' + missing.join(', ') + '.'
        : 'Save did not close — check Borrower(s) selection and validation errors.';
      return { ok: false, reason: reason };
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
        try { result = await fn(rows[i], stage); }
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
    console.log('Stage extras — realEstateDetails:',
      (stage.realEstateDetails || []).length, 'entries; liabilityEdits:',
      (stage.liabilityEdits || []).length, 'entries.');
    if (!(stage.realEstateDetails || []).length &&
        stage.tableData && (stage.tableData.realEstate || []).length) {
      console.warn('[Copy LOP] Stage has Real Estate rows but no realEstateDetails — ' +
        're-stage the source loan (with this extension version loaded) to capture ' +
        'Property type / Current occupancy / Pending-sale date from the source form.');
    }

    // STEP 0: if the source has more borrowers than the destination,
    // click the "+" tab and add the missing co-borrower(s) BEFORE we
    // start writing fields. Otherwise the co-borrower's first/last/
    // DOB/SSN, addresses, etc. either silently fall on the primary
    // borrower's section or get logged as noMatch.
    let addBorrowersResult = null;
    const srcBorrowersBefore = countBorrowerSections(stage.fields);
    const destBorrowersBefore = countCurrentBorrowerSections();
    if (srcBorrowersBefore > destBorrowersBefore) {
      showProgress(
        'Adding co-borrower' + (srcBorrowersBefore - destBorrowersBefore > 1 ? 's' : '') + '…',
        'Source has ' + srcBorrowersBefore + ' borrower(s), destination has ' + destBorrowersBefore +
        '. Driving the + tab so the missing section(s) exist before pasting.'
      );
      addBorrowersResult = await addMissingBorrowersToDest(stage);
      console.log('Add missing borrowers result:', addBorrowersResult);
      if (!addBorrowersResult.ok) {
        hideProgress();
        console.groupEnd();
        return {
          wrote: 0, skippedLocked: 0, noMatch: 0, skippedEmpty: 0, passes: 0,
          borrowerMismatch: { source: srcBorrowersBefore, destination: countCurrentBorrowerSections() },
          addBorrowersResult: addBorrowersResult,
          aborted: true,
          abortReason: 'Could not add co-borrower automatically: ' + addBorrowersResult.reason
        };
      }
      // Give LOP a moment to settle after the dialog closes and
      // the new tab/section renders.
      await new Promise(function (r) { setTimeout(r, 500); });
    }

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

    // Demographics collection.method — explicit pass after the
    // general field paste. Falls back to FaceToFace if source was
    // blank so LOP's save validation doesn't bounce the page (which
    // had been cascading into rolled-back credit consent).
    const demographicResult = await pasteDemographicCollectionMethod(stage.demographicCollectionMethod || []);
    console.log('[Copy LOP] Demographics collection.method paste:', demographicResult);
    totalWrote += demographicResult.wrote;

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
    if (stage.creditPullType) {
      // Save BEFORE running the credit action — Choose action
      // (for both Hard reissue and Soft pull) is disabled until
      // the loan file has been saved at least once. The old
      // version gated this on creditReferenceId which was only
      // set for Hard pulls, so Soft pulls skipped save and then
      // failed at the "Pull credit report" menu lookup because
      // Choose action was still disabled.
      updateProgress('Saving loan file…', 'Required before Choose action → Pull / Reissue credit becomes available.');
      console.group('[Copy LOP] Save loan file');
      saveResult = await saveLoanFile();
      console.log('Result:', saveResult);
      console.groupEnd();
      // Two-save settle so LOP's credit-pull cache picks up the
      // new co-borrower's consent record. The first save commits
      // everything we wrote during paste; LOP's consent change
      // also auto-commits inline with a "Granted on …" timestamp,
      // BUT the credit-eligibility endpoint reads from a separate
      // cache layer that can lag for a few seconds. Without the
      // double-save + longer settle, credit reissue fires while
      // LOP still believes Borrower 2 hasn't consented and the
      // pull bounces with "Missing credit consent".
      updateProgress('Letting consent commit…', 'Waiting 3s for LOP to propagate the new co-borrower\'s Verbal consent across services.');
      await new Promise(function (r) { setTimeout(r, 3000); });
      // Second save — this is cheap, but it forces another
      // backend round-trip that lets LOP's credit-eligibility
      // cache re-read the consent state.
      updateProgress('Re-saving so credit sees the latest consent…', 'A second save forces LOP\'s credit-eligibility cache to refresh.');
      console.group('[Copy LOP] Save loan file (consent settle)');
      const secondSave = await saveLoanFile();
      console.log('Result:', secondSave);
      console.groupEnd();
      await new Promise(function (r) { setTimeout(r, 1500); });
    }

    let creditResult = null;
    let liabilityEditResults = null;
    // When a co-borrower was just auto-added on THIS paste, LOP's
    // credit-eligibility cache holds onto stale "no consent for
    // Borrower 2" state for several seconds even after Save Loan
    // File commits the new consent. Empirically a double-save +
    // 4.5s settle wasn't always enough (the cache lag varies).
    // The reliable workaround is a page refresh — LOP rebuilds
    // the credit cache from scratch on load. We stash a "pending
    // credit action" record in chrome.storage and trigger the
    // reload; the init code at the bottom of this module reads
    // the flag on the next page load and resumes the credit pull
    // + liability edits automatically.
    const justAddedBorrower = addBorrowersResult && addBorrowersResult.added > 0;
    if (stage.creditPullType && justAddedBorrower) {
      const pending = {
        loanId: loanIdFromUrl(),
        creditPullType: stage.creditPullType,
        creditReferenceId: stage.creditReferenceId || '',
        liabilityEdits: stage.liabilityEdits || [],
        pricingScenario: stage.pricingScenario || null,
        armedAt: Date.now()
      };
      try {
        await new Promise(function (resolve) {
          chrome.storage.local.set({ zhlPendingCreditAction: pending }, resolve);
        });
        console.log('[Copy LOP] Armed post-refresh credit action and reloading the page.');
        updateProgress('Refreshing the page…',
          'A page reload clears LOP\'s credit-eligibility cache so the new co-borrower\'s consent is picked up. Credit will fire automatically once the page comes back.');
        await new Promise(function (r) { setTimeout(r, 600); });
        location.reload();
        // Don't fall through to the modal — the page is reloading.
        return {
          wrote: totalWrote,
          skippedLocked: lastResult.skippedLocked,
          noMatch: lastResult.noMatch,
          skippedEmpty: lastResult.skippedEmpty,
          passes: passes,
          borrowerMismatch: borrowerMismatch,
          addBorrowersResult: addBorrowersResult,
          tableResults: tableResults,
          saveResult: saveResult,
          pendingCredit: pending,
          aborted: false
        };
      } catch (e) {
        console.warn('[Copy LOP] Could not arm post-refresh credit; falling back to inline path.', e);
      }
    }

    if (stage.creditPullType) {
      console.group('[Copy LOP] Credit action: ' + stage.creditPullType);
      // Verify every borrower in the source's personal-info-sections
      // has matching first/last/DOB/SSN on the destination —
      // running credit before all borrowers are populated fails
      // (CoreLogic needs every applicant identified). Also checks
      // soft/hard credit consent is set on every borrower so the
      // pull doesn't bounce with "co-borrower didn't consent".
      let verify = verifyReadyForCredit(stage);
      // If consent is the only remaining issue, try patching it
      // in once more from the staged values — the auto-add path
      // sometimes loses the consent dropdowns on the brand-new
      // co-borrower section before the field paste reaches them.
      const onlyConsentMissing = verify.issues.length > 0 &&
        verify.issues.every(function (s) { return /credit consent/i.test(s); });
      if (onlyConsentMissing) {
        console.log('[Copy LOP] Consent missing; retrying consent paste then re-verifying.');
        await retryCreditConsentPaste(stage);
        await new Promise(function (r) { setTimeout(r, 600); });
        verify = verifyReadyForCredit(stage);
      }
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

    // Apply per-liability edits (Payoff / Exclude+Reason /
    // Property link) — runs after the credit pull/reissue
    // populates the dest liabilities. Skips silently when source
    // had no liability edits to apply.
    //
    // CRITICAL: gate this on every borrower having a credit
    // score visible. runCreditAction returns as soon as the
    // Reissue click goes through, but CoreLogic streams scores
    // + liabilities back over many seconds. If we kick off
    // liability edits before all scores have landed, the pull
    // isn't actually done and some staged accounts won't be in
    // the dest table yet. The applyLiabilityEdits-side wait
    // catches some of that, but it can stable-exit too early
    // (especially on multi-borrower files where Borrower 1's
    // liabilities arrive ~5s before Borrower 2's).
    if (stage.liabilityEdits && stage.liabilityEdits.length &&
        creditResult && creditResult.ok) {
      updateProgress('Waiting for every borrower\'s credit to land before liability edits…',
        'CoreLogic streams scores + liabilities back over many seconds. Watching the right-rail Credit card for a FICO next to every borrower.');
      console.group('[Copy LOP] Pre-liability credit wait');
      const creditWait = await waitForCreditToLand(120000);
      console.log('Pre-liability credit wait result:', creditWait);
      console.groupEnd();
      // Even if creditWait timed out, fall through to
      // applyLiabilityEdits — it has its own table-side wait
      // with stable-row-count detection and per-row retries.
      console.group('[Copy LOP] Liability edits');
      liabilityEditResults = await applyLiabilityEdits(stage.liabilityEdits);
      console.log('Result:', liabilityEditResults);
      console.groupEnd();
    }

    // Pricing scenario auto-assign — runs after liability edits
    // (so the right rail's DTI / liabilities are settled) when:
    //   - the source had an assigned scenario at stage time
    //   - the credit pull succeeded on the destination
    let pricingResult = null;
    if (stage.pricingScenario && stage.pricingScenario.assignedScenario &&
        stage.pricingScenario.assignedScenario.productName &&
        creditResult && creditResult.ok) {
      updateProgress('Running pricing scenario…',
        'Filling the Pricing form from the source loan, running pricing, finding ' +
        stage.pricingScenario.assignedScenario.productName + ' @ ' +
        stage.pricingScenario.assignedScenario.interestRate + ', and clicking Assign to loan.');
      pricingResult = await runPricingAssign(stage);
      console.log('[Copy LOP] runPricingAssign result:', pricingResult);
    } else if (stage.pricingScenario) {
      console.log('[Copy LOP] Skipping pricing (credit not ok, or no assignedScenario captured).');
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
      addBorrowersResult: addBorrowersResult,
      creditResult: creditResult,
      saveResult: saveResult,
      tableResults: tableResults,
      liabilityEditResults: liabilityEditResults,
      pricingResult: pricingResult
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
      // text a little so it doesn't feel glued on. flex-wrap lets the
      // panel break to a second row gracefully when the viewport is
      // narrow — better than buttons individually wrapping text.
      panel.style.cssText =
        'display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap;row-gap:6px;margin-left:24px;' +
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
    stageBtn.textContent = 'Copy Old LOP';
    stageBtn.style.cssText =
      'background:#006aff;color:#fff;border:1px solid #006aff;border-radius:4px;' +
      'padding:6px 12px;font-weight:600;cursor:pointer;font-size:13px;white-space:nowrap;';
    stageBtn.addEventListener('mouseenter', function () { stageBtn.style.background = '#0056d2'; });
    stageBtn.addEventListener('mouseleave', function () { stageBtn.style.background = '#006aff'; });
    stageBtn.addEventListener('click', onStageClick);

    const pasteBtn = document.createElement('button');
    pasteBtn.type = 'button';
    pasteBtn.textContent = 'Paste New LOP';
    pasteBtn.style.cssText =
      'background:#fff;color:#006aff;border:1px solid #006aff;border-radius:4px;' +
      'padding:6px 12px;font-weight:600;cursor:pointer;font-size:13px;white-space:nowrap;';
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
    const stage = await stageFromCurrentPage();
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
      '<p style="margin-top:14px;color:#374151;font-size:13px;">Now open the destination loan, navigate to Full Application, and click <strong>Paste New LOP</strong>.</p>' +
      '<div style="text-align:right;margin-top:14px;"><button id="zhl-modal-close" style="background:#006aff;color:#fff;border:1px solid #006aff;border-radius:4px;padding:6px 14px;font-weight:600;cursor:pointer;">OK</button></div>',
      function (p) { p.querySelector('#zhl-modal-close').addEventListener('click', removeModal); }
    );
  }

  async function onPasteClick() {
    const stages = await loadStages();
    if (!stages.length) {
      showModal('<h3 style="margin:0 0 8px;font-size:16px;color:#dc2626;">Nothing staged yet</h3>' +
        '<p>Open the source loan\'s Full Application and click <strong>Copy Old LOP</strong> first.</p>' +
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
          // If paste armed a post-refresh credit pull, the page
          // is about to reload — don't pop a summary modal that
          // the LO would see for half a second before it
          // disappears. The resume handler shows its own modal
          // after the reload.
          if (result && result.pendingCredit) return;
          showSummary(stage, result);
        });
      }
    );
  }

  function showSummary(stage, result) {
    const headerName = namesFromStage(stage) || stage.sourceBorrowerName || '';
    const tableSummaryHtml = tableDataSummaryHtml(stage.tableData);
    if (result.aborted) {
      showModal(
        '<h3 style="margin:0 0 8px;font-size:16px;color:#991b1b;">Paste aborted</h3>' +
        '<p style="margin:0 0 8px;color:#7f1d1d;font-size:13px;">' +
          escapeHtml(result.abortReason || 'Unknown reason') +
        '</p>' +
        '<p style="margin:0 0 8px;color:#374151;font-size:12px;">' +
          'Add the missing borrower manually (click the <strong>+</strong> tab → ' +
          '<em>Coborrower with [name]</em> → Create borrower) and then re-paste.' +
        '</p>' +
        '<div style="text-align:right;margin-top:6px;">' +
          '<button id="zhl-modal-ok" style="background:#006aff;color:#fff;border:1px solid #006aff;border-radius:4px;padding:6px 14px;font-weight:600;cursor:pointer;">OK</button>' +
        '</div>',
        function (p) { p.querySelector('#zhl-modal-ok').addEventListener('click', removeModal); }
      );
      return;
    }
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
      (result.addBorrowersResult && result.addBorrowersResult.ok && result.addBorrowersResult.added
        ? '<div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:6px;padding:10px;margin:10px 0;color:#065f46;font-size:13px;">' +
          '<strong>✓ Auto-added ' + result.addBorrowersResult.added + ' co-borrower' +
            (result.addBorrowersResult.added === 1 ? '' : 's') + '</strong> ' +
          '&mdash; clicked the <strong>+</strong> tab and filled the <em>Add a new borrower</em> dialog ' +
          'so every source borrower has a section to paste into.' +
        '</div>'
        : '') +
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
      (result.liabilityEditResults
        ? '<div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:6px;padding:10px;margin:10px 0;color:#065f46;font-size:13px;">' +
          '<strong>Liability edits:</strong> applied ' + result.liabilityEditResults.applied +
          ' of ' + result.liabilityEditResults.total +
          (result.liabilityEditResults.skipped ? ' (' + result.liabilityEditResults.skipped + ' skipped — no change needed or no dest match)' : '') +
          (result.liabilityEditResults.errors && result.liabilityEditResults.errors.length
            ? '<div style="color:#9a3412;margin-top:4px;">Errors: ' +
              result.liabilityEditResults.errors.slice(0, 5).map(function (e) {
                return escapeHtml((e.accountIdentifier || '?') + ' — ' + (e.reason || ''));
              }).join('; ') +
              (result.liabilityEditResults.errors.length > 5 ? ' (+' + (result.liabilityEditResults.errors.length - 5) + ' more)' : '') +
              '</div>'
            : '') +
        '</div>'
        : '') +
      (result.pricingResult
        ? (result.pricingResult.ok
          ? '<div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:6px;padding:10px;margin:10px 0;color:#065f46;font-size:13px;">' +
            '<strong>✓ Pricing scenario assigned</strong> &mdash; picked <strong>' +
            escapeHtml(result.pricingResult.pickedProduct || '?') + '</strong> at <strong>' +
            escapeHtml(result.pricingResult.pickedRate || '?') + '%</strong>' +
            (result.pricingResult.points ? ' (' + escapeHtml(result.pricingResult.points) + ')' : '') +
            ' and clicked Assign to loan. Returned to Full Application.' +
            '</div>'
          : '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:10px;margin:10px 0;color:#991b1b;font-size:13px;">' +
            '<strong>⚠ Pricing scenario didn\'t assign:</strong> ' +
            escapeHtml(result.pricingResult.reason || 'unknown') +
            '. Open Pricing &amp; Scenarios → Pricing manually, find the matching row, and click Assign to loan.' +
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
        // Hint when the stage carried Real Estate rows but NO
        // realEstateDetails — that means the source-side form
        // scrape didn't run (or the user staged with an older
        // version). They need to re-stage.
        const reAttempted = tr.realEstate && tr.realEstate.attempted;
        const reHasDetails = (stage.realEstateDetails || []).length > 0;
        if (reAttempted && !reHasDetails) {
          html += '<div style="margin-top:8px;background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:10px;color:#991b1b;font-size:12px;">' +
            '<strong>⚠ Real Estate form-only fields weren\'t captured at stage time.</strong> ' +
            'Property type, Current occupancy, and Pending-sale date all live in the source form, ' +
            'not the source table. Re-open the source loan tab and click <em>Stage</em> again ' +
            '(with this extension version) — staging opens each Real Estate row to capture them.' +
            '</div>';
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

  // ---- Post-refresh credit resume -------------------------------
  // When paste auto-adds a co-borrower, the credit-eligibility
  // cache on LOP's backend can lag the consent commit for several
  // seconds. The reliable bypass is to reload the page (which
  // rebuilds the cache) and then re-trigger the credit pull. The
  // reload erases our JS state, so we stash a small "pending
  // credit action" record in chrome.storage before reloading;
  // this handler reads it on the next page load and resumes the
  // credit pull + liability edits.
  const PENDING_KEY = 'zhlPendingCreditAction';
  const PENDING_TTL_MS = 5 * 60 * 1000;

  function tryResumePendingCredit() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get([PENDING_KEY], async function (data) {
      const pending = data && data[PENDING_KEY];
      if (!pending) return;
      const age = Date.now() - (pending.armedAt || 0);
      if (age > PENDING_TTL_MS) {
        try { chrome.storage.local.remove([PENDING_KEY]); } catch (_) {}
        return;
      }
      // Only resume on the loan that armed it.
      const currentLoan = loanIdFromUrl();
      if (currentLoan && pending.loanId && currentLoan !== pending.loanId) return;
      // Wait for the Full Application page + the right-rail credit
      // button to render before we try to drive it.
      const ready = await waitForCondition(function () {
        return isOnFullApplicationPage() &&
          document.querySelector('[data-cy="credit-actions-buttons"]');
      }, 60000);
      if (!ready) {
        console.warn('[Copy LOP] Post-refresh resume: credit button never appeared; leaving flag alone.');
        return;
      }
      // Clear the flag BEFORE running so a second reload (or a
      // mistaken trigger) doesn't repeat the credit pull.
      try { chrome.storage.local.remove([PENDING_KEY]); } catch (_) {}
      console.log('[Copy LOP] Post-refresh resume: firing', pending.creditPullType, 'credit action.');
      const actionLabel = pending.creditPullType === 'Hard'
        ? 'Resuming hard credit reissue…'
        : 'Resuming soft credit pull…';
      showProgress(actionLabel,
        'Page reloaded so LOP\'s credit cache picked up the new co-borrower\'s consent. Firing credit now.');
      // Brief settle so React finishes mounting.
      await new Promise(function (r) { setTimeout(r, 1500); });
      const fakeStage = {
        creditPullType: pending.creditPullType,
        creditReferenceId: pending.creditReferenceId
      };
      const creditResult = await runCreditAction(fakeStage);
      console.log('[Copy LOP] Post-refresh credit result:', creditResult);
      let liabilityEditResults = null;
      if (pending.liabilityEdits && pending.liabilityEdits.length &&
          creditResult && creditResult.ok) {
        // Same gate as the inline path — wait for every
        // borrower's credit score to land before trying to
        // match liability accounts. CoreLogic streams scores
        // and liabilities together, so a missing per-borrower
        // score means the pull isn't done streaming.
        updateProgress('Waiting for every borrower\'s credit to land…',
          'CoreLogic streams scores + liabilities back over many seconds.');
        console.group('[Copy LOP] Post-refresh pre-liability credit wait');
        const creditWait = await waitForCreditToLand(120000);
        console.log('Pre-liability credit wait result:', creditWait);
        console.groupEnd();
        updateProgress('Applying liability edits…',
          'Applying Payoff / Exclude+Reason / Property link to each matching liability.');
        liabilityEditResults = await applyLiabilityEdits(pending.liabilityEdits);
        console.log('[Copy LOP] Post-refresh liability edits result:', liabilityEditResults);
      }
      // Post-refresh pricing scenario auto-assign
      let pricingResult = null;
      if (pending.pricingScenario && pending.pricingScenario.assignedScenario &&
          pending.pricingScenario.assignedScenario.productName &&
          creditResult && creditResult.ok) {
        updateProgress('Running pricing scenario…',
          'Filling Pricing form, running pricing, picking ' +
          pending.pricingScenario.assignedScenario.productName + ' @ ' +
          pending.pricingScenario.assignedScenario.interestRate + ', and Assign to loan.');
        pricingResult = await runPricingAssign({ pricingScenario: pending.pricingScenario });
        console.log('[Copy LOP] Post-refresh pricing result:', pricingResult);
      }
      hideProgress();
      // Surface a small toast-like modal so the LO knows the
      // resume ran (no full summary — most of that already
      // appeared before the refresh).
      const okHtml = '<h3 style="margin:0 0 8px;font-size:18px;color:#15803d;">🎉 Congrats on cloning your LOP file!</h3>' +
        '<p style="margin:0;color:#374151;font-size:13px;">Please <a href="https://zallwall.zillowgroup.com/justinca" target="_blank" rel="noopener" data-zhl-karma-link="lop-file-copy" style="color:#0b5cab;font-weight:700;text-decoration:underline;">leave Justin karma</a> if you found this useful 💛</p>';
      const failHtml = '<h3 style="margin:0 0 8px;font-size:16px;color:#991b1b;">Couldn\'t trigger credit after refresh</h3>' +
        '<p style="margin:0 0 6px;color:#7f1d1d;font-size:13px;">' +
        (creditResult && creditResult.reason ? escapeHtml(creditResult.reason) : 'Unknown error') +
        '</p><p style="margin:0;color:#374151;font-size:12px;">Run it manually: Choose action → ' +
        (pending.creditPullType === 'Hard'
          ? 'Reissue credit report, paste ref ID <code>' + escapeHtml(pending.creditReferenceId || '') + '</code>, click Reissue.'
          : 'Pull credit report, leave type Soft, click Pull credit.') +
        '</p>';
      showModal(
        (creditResult && creditResult.ok ? okHtml : failHtml) +
        '<div id="zhl-lop-copy-time-saved"></div>' +
        '<div style="text-align:right;margin-top:14px;"><button id="zhl-resume-ok" style="background:#006aff;color:#fff;border:1px solid #006aff;border-radius:4px;padding:6px 14px;font-weight:600;cursor:pointer;">OK</button></div>',
        function (p) {
          p.querySelector('#zhl-resume-ok').addEventListener('click', removeModal);
          // Time saved: ~15 min for the full clone + credit + liability
          // edits + pricing assign flow. Only credit on success.
          if (creditResult && creditResult.ok && window.__zhlTimeSaved) {
            const mins = 15;
            window.__zhlTimeSaved.record('lop-file-copy', mins).then(function (r) {
              const slot = p.querySelector('#zhl-lop-copy-time-saved');
              if (slot) slot.innerHTML = window.__zhlTimeSaved.renderHtml(mins, r.userTotal, r.globalTotal);
            });
          }
        }
      );
    });
  }

  // Run the resume check shortly after load — give the SPA a
  // moment to render the page chrome first.
  setTimeout(tryResumePendingCredit, 800);

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
    chrome.storage.local.get([__ZHL_FEATURE_KEY, 'zhl_kill_switch'], function (data) {
      if (data.zhl_kill_switch === true) return;
      if (data[__ZHL_FEATURE_KEY] === false) return;
      __zhlRunModule();
    });
  } else {
    __zhlRunModule();
  }
})();
