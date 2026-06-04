// ZHL Productivity Pack module — feature key: feature_loanStoryGenerator
// Adds a "Generate Loan Story for Encompass" button to the LOP Full
// Application subnav. Reads the full file, drafts the five Encompass
// ZG-Loan-Story sections (Property, Borrower, Employment/Income,
// Asset, Credit Notes) in a modal with a Copy button per section.
//
// Button activates only after a Hard credit pull is detected on the
// file (per data-cy="Hard" scores in the Credit section).
//
// Output voice: medium — one short sentence per insight. Editable
// textareas — the LO can edit / overwrite before copying.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_loanStoryGenerator';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = '1.0';
  const BUTTON_ID = 'zhl-loan-story-btn';
  const MODAL_ID = 'zhl-loan-story-modal';
  const PANEL_ID = 'zhl-lop-file-copy-panel'; // sibling we anchor next to
  const FULL_APP_RE = /\/loan-officer-portal\/[^/]+\/full-application/i;

  console.log('[ZHL Loan Story v' + VERSION + '] loaded');

  // -------------------------------------------------------------------
  // DOM helpers
  // -------------------------------------------------------------------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function txt(el) { return (el && el.textContent || '').replace(/\s+/g, ' ').trim(); }

  function inputVal(scope, name) {
    if (!scope) return '';
    const el = scope.querySelector('[name="' + name + '"]');
    if (!el) return '';
    if (el.tagName === 'SELECT') {
      const opt = el.options[el.selectedIndex];
      return opt ? (opt.textContent || el.value || '').trim() : (el.value || '');
    }
    return (el.value || '').trim();
  }

  function isChecked(scope, name) {
    if (!scope) return false;
    const el = scope.querySelector('input[type="checkbox"][name="' + name + '"]');
    return !!(el && el.checked);
  }

  function isFullAppPage() {
    return FULL_APP_RE.test(location.pathname);
  }

  // -------------------------------------------------------------------
  // Section discovery
  // -------------------------------------------------------------------
  function findSubjectPropertySection() {
    return $('[data-cy="subject-property-section"]');
  }

  function findLoanInfoSection() {
    return $('[data-cy="loan-information-section"]');
  }

  function findPricingInfoSection() {
    let p = document.getElementById('PricingInfo');
    if (p) return p;
    const h = $$('h5').find(function (x) { return /pricing\s+information/i.test(x.textContent || ''); });
    return h ? h.closest('div') : null;
  }

  function findCreditSection() {
    const h6s = $$('h6');
    for (const h of h6s) {
      if (txt(h) === 'Credit') return h.parentElement;
    }
    return null;
  }

  function findPersonalInfoSection(idx) {
    return $('[data-cy="personal-info-section-' + idx + '"]');
  }

  function findEmploymentSection(idx) {
    return $('[data-cy="employments-section-' + idx + '"]');
  }

  // Borrowers are indexed 0..N by personal-info-section-N. Return
  // an array of { idx, name, scope } for each borrower with a name.
  function discoverBorrowers() {
    const out = [];
    for (let i = 0; i < 4; i++) {
      const sec = findPersonalInfoSection(i);
      if (!sec) continue;
      const first = inputVal(sec, 'first') || inputVal(sec, 'firstName');
      const last  = inputVal(sec, 'last')  || inputVal(sec, 'lastName');
      const name = [first, last].filter(Boolean).join(' ').trim();
      if (!name) continue;
      out.push({ idx: i, name: name, first: first, last: last, scope: sec });
    }
    return out;
  }

  // -------------------------------------------------------------------
  // Hard pull detection (gating)
  // -------------------------------------------------------------------
  function isHardPullDone() {
    const credit = findCreditSection();
    if (!credit) return false;
    const hards = credit.querySelectorAll('[data-cy="Hard"]');
    for (const grid of hards) {
      const spans = grid.querySelectorAll('span');
      for (const s of spans) {
        if (/^\d{3}$/.test((s.textContent || '').trim())) return true;
      }
    }
    return false;
  }

  // -------------------------------------------------------------------
  // Property Notes
  // -------------------------------------------------------------------
  function buildPropertyNotes() {
    const sec = findSubjectPropertySection();
    if (!sec) return '';
    const propertyType = inputVal(sec, 'propertyType');
    const attachment   = inputVal(sec, 'attachmentType');
    const propertyUse  = inputVal(sec, 'propertyUse');
    const state        = inputVal(sec, 'addressState');
    const units        = inputVal(sec, 'financedUnits');
    const pud          = isChecked(sec, 'pud');
    const mixedUse     = isChecked(sec, 'mixedUse');

    const out = [];
    const parts = [propertyUse, attachment, propertyType].filter(Boolean);
    if (parts.length) out.push('Subject property: ' + parts.join(' / ') + (state ? ' in ' + state + '.' : '.'));
    if (units && units !== '1') out.push(units + '-unit property.');
    if (pud) out.push('PUD — HOA dues apply.');
    if (mixedUse) out.push('Mixed-use property — flagged on subject.');

    // Loan purpose hint (refi / purchase / construction)
    const loan = findLoanInfoSection();
    if (loan) {
      const purpose = inputVal(loan, 'loanPurpose');
      if (purpose && /construct/i.test(purpose)) out.push('Loan purpose is ' + purpose + ' — confirm property status.');
    }

    return out.join('\n');
  }

  // -------------------------------------------------------------------
  // Borrower Notes
  // -------------------------------------------------------------------
  function buildBorrowerNotes(borrowers) {
    const out = [];
    if (!borrowers.length) return '';

    const labels = borrowers.map(function (b, i) {
      return 'B' + (i + 1) + ' = ' + b.name;
    });
    out.push(labels.join(' · ') + '.');

    // FTHB lives on the Pricing Information section (isFirstTimeHomebuyer
    // checkbox). It's loan-level, not borrower-level, in LOP — but the
    // Encompass Loan Story treats it as borrower context.
    const pricing = findPricingInfoSection();
    if (pricing && isChecked(pricing, 'isFirstTimeHomebuyer')) {
      out.push('First-time homebuyer.');
    }

    // Marital status per borrower, when set.
    borrowers.forEach(function (b, i) {
      const marital = inputVal(b.scope, 'maritalStatus');
      if (marital) {
        out.push('B' + (i + 1) + ' marital status: ' + marital + '.');
      }
    });

    // Loan purpose (helps the processor understand intent).
    const loan = findLoanInfoSection();
    if (loan) {
      const purpose = inputVal(loan, 'loanPurpose');
      if (purpose) out.push('Loan purpose: ' + purpose + '.');
    }

    return out.join('\n');
  }

  // -------------------------------------------------------------------
  // Employment / Income Notes
  // -------------------------------------------------------------------
  //
  // Each borrower's employments-section-N has a "Table for employments"
  // where tbody children alternate between data rows and edit-panel rows
  // (the latter being a single <td colspan="10"> that wraps the expanded
  // edit form, including a nested "employment-incomes-table" with the
  // Base / Overtime / Bonus / Commission / Military / Other breakdown
  // and per-type Monthly amount).
  //
  // The income-type table sits in the DOM even when the row appears
  // collapsed in the UI (it's just hidden), so we can read each type's
  // Monthly amount span — an empty span means that type isn't used.
  // -------------------------------------------------------------------

  // Read the income-type breakdown from an edit-panel TR. Returns an
  // array of { type, monthly } for every income type with a non-empty
  // Monthly amount cell.
  function readIncomeBreakdown(editPanelTr) {
    if (!editPanelTr) return [];
    const t = editPanelTr.querySelector('table[aria-label="employment-incomes-table"]');
    if (!t) return [];
    const out = [];
    t.querySelectorAll(':scope > tbody > tr').forEach(function (tr) {
      const cells = tr.querySelectorAll(':scope > td');
      if (cells.length < 4) return;
      // Income-type label sits in the first cell, in the first <span>
      // child (the rest of the row is form controls).
      const labelEl = cells[0].querySelector('span');
      const label = labelEl ? (labelEl.textContent || '').trim() : '';
      if (!label) return;
      // Monthly amount sits in the last cell as a single <span>. If
      // empty, this income type isn't in use for this employment row.
      const lastSpans = cells[cells.length - 1].querySelectorAll('span');
      let monthly = '';
      for (const s of lastSpans) {
        const t = (s.textContent || '').trim();
        if (t) { monthly = t; break; }
      }
      if (monthly) out.push({ type: label, monthly: monthly });
    });
    return out;
  }

  // Walk the outer employments table for a borrower, pairing each data
  // row with its edit-panel sibling to capture the income breakdown.
  function readEmploymentRecords(borrowerIdx) {
    const sec = findEmploymentSection(borrowerIdx);
    if (!sec) return [];
    const table = sec.querySelector('table[aria-label="Table for employments"]')
               || sec.querySelector('table');
    if (!table) return [];
    const tbody = table.querySelector(':scope > tbody');
    if (!tbody) return [];

    const trs = Array.from(tbody.children).filter(function (n) { return n.tagName === 'TR'; });
    const out = [];
    for (let i = 0; i < trs.length; i++) {
      const tr = trs[i];
      if (tr.getAttribute('data-cy') === 'add-entity-container') continue;
      const cells = Array.from(tr.querySelectorAll(':scope > td'));
      if (!cells.length) continue;
      // Skip edit-panel rows (single <td colspan="10">) — they're consumed
      // by the preceding data row's pair-up logic, not standalone.
      if (cells.length === 1 && cells[0].getAttribute('colspan')) continue;

      const cellText = cells.map(function (c) {
        return (c.textContent || '').replace(/\s+/g, ' ').trim();
      });
      // Column order: [chevron, status-icon, Type, Employer, Start, End,
      // Income/yr, Income/mo, Source, actions]
      const type     = cellText[2] || '';
      const employer = cellText[3] || '';
      // Skip totals row (no employer name, no type)
      if (!employer && !type) continue;

      // Edit panel is the next TR (when expanded — DOM present even when
      // visually collapsed).
      const editTr = trs[i + 1];
      const breakdown = (editTr && editTr.querySelectorAll(':scope > td').length === 1)
        ? readIncomeBreakdown(editTr)
        : [];

      out.push({
        type: type,
        employer: employer,
        startDate: cellText[4] || '',
        endDate:   cellText[5] || '',
        incomeYr:  cellText[6] || '',
        incomeMo:  cellText[7] || '',
        source:    cellText[8] || '',
        breakdown: breakdown
      });
    }
    return out;
  }

  // Format the income breakdown as a short phrase for the loan story.
  //   Only Base                 → "Base income only"
  //   Base + Overtime + Bonus   → "Has overtime + bonus on top of base"
  //   Self-employed / no base   → "{Types listed}"
  function describeIncomeBreakdown(breakdown) {
    if (!breakdown || !breakdown.length) return '';
    const types = breakdown.map(function (b) { return b.type; });
    const isBase = function (t) { return /^base$/i.test(t); };
    const hasBase = types.some(isBase);
    const nonBase = types.filter(function (t) { return !isBase(t); });
    if (hasBase && nonBase.length === 0) return 'Base income only';
    if (hasBase && nonBase.length > 0) return 'Has ' + nonBase.join(' + ').toLowerCase() + ' on top of base';
    return 'Income types: ' + types.join(', ');
  }

  function buildEmploymentNotes(borrowers) {
    if (!borrowers.length) return '';
    const out = [];

    borrowers.forEach(function (b, i) {
      const tag = 'B' + (i + 1);
      const recs = readEmploymentRecords(b.idx);
      if (!recs.length) { out.push(tag + ': no employment on file.'); return; }

      const current = recs.filter(function (r) { return /current/i.test(r.type); });
      const prior   = recs.filter(function (r) { return /previous|prior/i.test(r.type); });

      current.forEach(function (r) {
        let line = tag + ': ' + (r.employer || '(unnamed)');
        if (r.startDate) line += ', current since ' + r.startDate;
        line += '.';
        const phrase = describeIncomeBreakdown(r.breakdown);
        const total = r.incomeMo || '';
        if (phrase) {
          line += ' ' + phrase;
          if (total) {
            line += /only$/i.test(phrase)
              ? ' (' + total + '/mo)'
              : ' (' + total + '/mo total)';
          }
          line += '.';
        } else if (total) {
          line += ' ' + total + '/mo.';
        }
        out.push(line);
      });

      // Prior employments — just list dates, no income detail
      prior.forEach(function (r) {
        const window = [r.startDate, r.endDate].filter(Boolean).join(' → ');
        out.push(tag + ' prior: ' + (r.employer || '(unnamed)') + (window ? ' (' + window + ')' : '') + '.');
      });
    });

    return out.join('\n');
  }

  // -------------------------------------------------------------------
  // Asset Notes
  // -------------------------------------------------------------------
  function findGiftsTable() {
    // Global Gifts table (assets/gifts share the borrower column).
    return document.querySelector('table[aria-label="Table for gifts or grants"]');
  }
  function findAssetsTable() {
    return document.querySelector('table[aria-label="Table for assets"]');
  }

  function parseMoney(s) {
    if (!s) return 0;
    const m = String(s).replace(/[^0-9.\-]/g, '');
    if (!m) return 0;
    const n = parseFloat(m);
    return isNaN(n) ? 0 : n;
  }

  function fmtMoney(n) {
    return '$' + (Math.round(n)).toLocaleString('en-US');
  }

  function readGifts() {
    const t = findGiftsTable();
    if (!t) return { rows: [], total: 0 };
    const rows = [];
    let total = 0;
    t.querySelectorAll('tbody > tr').forEach(function (tr) {
      if (tr.getAttribute('data-cy') === 'add-entity-container') return;
      const cells = $$('td', tr).map(txt);
      if (!cells.length) return;
      // Column order generally: caret, Source, Type, Amount, Deposited?, Borrower
      const source = cells[1] || '';
      const type   = cells[2] || '';
      const amount = cells[3] || '';
      if (!source && !type && !amount) return;
      const n = parseMoney(amount);
      total += n;
      rows.push({ source: source, type: type, amount: amount, n: n });
    });
    return { rows: rows, total: total };
  }

  function buildAssetNotes() {
    const out = [];
    const gifts = readGifts();
    if (gifts.rows.length) {
      const sources = Array.from(new Set(gifts.rows.map(function (r) { return r.source; }).filter(Boolean)));
      out.push('Gift funds: ' + fmtMoney(gifts.total) + ' total' + (sources.length ? ' from ' + sources.join(', ') : '') + '.');
    }

    // Asset count / sources — best-effort, just count rows so the
    // processor knows what they're seeing.
    const at = findAssetsTable();
    if (at) {
      let cnt = 0;
      at.querySelectorAll('tbody > tr').forEach(function (tr) {
        if (tr.getAttribute('data-cy') === 'add-entity-container') return;
        if ($$('td', tr).length) cnt++;
      });
      if (cnt) out.push(cnt + ' asset account' + (cnt === 1 ? '' : 's') + ' on file — verify Plaid vs. statement docs.');
    }

    return out.join('\n');
  }

  // -------------------------------------------------------------------
  // Credit Notes — only LO-touched items
  // -------------------------------------------------------------------
  //
  // Per spec: "only things the LO changes." We surface:
  //   - liabilities flagged for payoff or excluded from DTI
  //   - presence of the existing Collections badge (if the FHA / Collections
  //     module has tagged a tradeline with the 5% rule)
  //   - presence of the existing student-loan calc output (if FHA / DU /
  //     LPA / VA payment was filled by the Calc Student Loans button)
  // -------------------------------------------------------------------
  function findLiabilitiesTable() {
    return document.querySelector('table[aria-label="Table for liabilities"]');
  }

  function readEditedLiabilities() {
    const t = findLiabilitiesTable();
    if (!t) return { paidOff: [], excluded: [] };
    const paidOff = [];
    const excluded = [];
    t.querySelectorAll('tbody > tr').forEach(function (tr) {
      if (tr.getAttribute('data-cy') === 'add-entity-container') return;
      // Heuristic markers — payoff toggle / exclude-from-DTI toggle.
      // These reflect LO action.
      const rowText = (tr.textContent || '').toLowerCase();
      const accountCell = $$('td', tr).map(txt).find(Boolean) || '';
      if (/pay\s*off|paid\s*at\s*closing/.test(rowText)) paidOff.push(accountCell);
      if (/exclude|omit/.test(rowText)) excluded.push(accountCell);
    });
    return { paidOff: paidOff, excluded: excluded };
  }

  function detectCollectionsBadge() {
    // The FHA / Collections badge module renders inline notes near the
    // Credit section. We sniff for the "5%" text in any badge element it
    // emits. Safe fallback if the module isn't loaded — returns false.
    const credit = findCreditSection();
    if (!credit) return false;
    const text = (credit.textContent || '');
    return /5\s*%\s*rule|collections?\s*\$?\s*[1-9]/i.test(text);
  }

  function detectStudentLoanCalc() {
    // The Calc Student Loans module writes payment values into the
    // liabilities table. We can't reliably tell which were typed vs.
    // calc'd without a marker — so we flag presence of any student
    // loan row so the LO can confirm calc method in the loan story.
    const t = findLiabilitiesTable();
    if (!t) return false;
    return /student\s*loan/i.test(t.textContent || '');
  }

  function buildCreditNotes() {
    const out = [];
    const edits = readEditedLiabilities();
    if (edits.paidOff.length) {
      out.push('Paying off at closing: ' + edits.paidOff.join('; ') + '.');
    }
    if (edits.excluded.length) {
      out.push('Excluded from DTI per LO: ' + edits.excluded.join('; ') + '.');
    }
    if (detectCollectionsBadge()) {
      out.push('Collections present — 5% rule applied per ZHL collections guidance.');
    }
    if (detectStudentLoanCalc()) {
      out.push('Student loans on file — confirm FHA / DU / LPA / VA calc method used for monthly payment.');
    }
    if (!out.length) out.push('No credit concerns noted by LO.');
    return out.join('\n');
  }

  // -------------------------------------------------------------------
  // Modal UI
  // -------------------------------------------------------------------
  const SECTIONS = [
    { key: 'property',   label: 'Property Notes',             builder: function (b) { return buildPropertyNotes(b); } },
    { key: 'borrower',   label: 'Borrower Notes',             builder: function (b) { return buildBorrowerNotes(b); } },
    { key: 'employment', label: 'Employment / Income Notes',  builder: function (b) { return buildEmploymentNotes(b); } },
    { key: 'asset',      label: 'Asset Notes',                builder: function (b) { return buildAssetNotes(b); } },
    { key: 'credit',     label: 'Credit Notes',               builder: function (b) { return buildCreditNotes(b); } }
  ];

  // The employment-incomes-table inside each employment row's expanded
  // edit panel is only mounted in the DOM when the row is expanded. If
  // the LO clicks Generate Loan Story while rows are collapsed, the
  // income breakdown comes back empty. Preflight by clicking the
  // chevron-down on each collapsed row so React mounts the income
  // table before we read it.
  async function expandCollapsedEmployments(borrowers) {
    let clickedAny = false;
    for (const b of borrowers) {
      const sec = findEmploymentSection(b.idx);
      if (!sec) continue;
      const table = sec.querySelector('table[aria-label="Table for employments"]');
      if (!table) continue;
      table.querySelectorAll('svg[class*="IconChevronDown"]').forEach(function (svg) {
        const td = svg.closest('td');
        if (!td) return;
        try { td.click(); clickedAny = true; } catch (_) {}
      });
    }
    if (clickedAny) {
      await new Promise(function (r) { setTimeout(r, 260); });
    }
  }

  async function openModal() {
    const existing = document.getElementById(MODAL_ID);
    if (existing) existing.remove();

    const borrowers = discoverBorrowers();
    // Make sure the inner income tables are mounted before we read.
    try { await expandCollapsedEmployments(borrowers); } catch (e) {
      console.warn('[ZHL Loan Story] expand preflight failed', e);
    }

    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.className = 'zhl-ls-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'zhl-ls-dialog';

    const header = document.createElement('div');
    header.className = 'zhl-ls-header';
    header.innerHTML =
      '<div class="zhl-ls-title">Loan Story for Encompass</div>' +
      '<div class="zhl-ls-sub">Auto-drafted from this loan file. Edit any section before copying. Paste each section into the matching Encompass field.</div>';
    dialog.appendChild(header);

    SECTIONS.forEach(function (sec) {
      const row = document.createElement('div');
      row.className = 'zhl-ls-section';

      const headRow = document.createElement('div');
      headRow.className = 'zhl-ls-section-head';
      const label = document.createElement('div');
      label.className = 'zhl-ls-section-label';
      label.textContent = sec.label;
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'zhl-ls-copy';
      copyBtn.textContent = 'Copy';
      headRow.appendChild(label);
      headRow.appendChild(copyBtn);
      row.appendChild(headRow);

      const ta = document.createElement('textarea');
      ta.className = 'zhl-ls-textarea';
      ta.rows = 5;
      ta.value = sec.builder(borrowers) || '';
      row.appendChild(ta);

      copyBtn.addEventListener('click', function () {
        try {
          navigator.clipboard.writeText(ta.value).then(function () {
            copyBtn.textContent = 'Copied';
            copyBtn.classList.add('zhl-ls-copy--ok');
            setTimeout(function () {
              copyBtn.textContent = 'Copy';
              copyBtn.classList.remove('zhl-ls-copy--ok');
            }, 1400);
          });
        } catch (_) {
          ta.select();
          document.execCommand && document.execCommand('copy');
        }
        try { chrome.runtime.sendMessage({ type: 'TRACK', event: 'loan_story_copy', props: { section: sec.key } }); } catch (_) {}
      });

      dialog.appendChild(row);
    });

    const footer = document.createElement('div');
    footer.className = 'zhl-ls-footer';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'zhl-ls-close';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', function () { overlay.remove(); });
    footer.appendChild(closeBtn);
    dialog.appendChild(footer);

    overlay.appendChild(dialog);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') {
        const el = document.getElementById(MODAL_ID);
        if (el) el.remove();
        document.removeEventListener('keydown', onKey);
      }
    });
    document.body.appendChild(overlay);

    try { chrome.runtime.sendMessage({ type: 'TRACK', event: 'loan_story_open', props: { borrowers: borrowers.length } }); } catch (_) {}
  }

  // -------------------------------------------------------------------
  // Button injection
  // -------------------------------------------------------------------
  function findInjectionTarget() {
    // ONLY anchor next to the existing Productivity Pack panel (which
    // lop-file-copy injects on the Full Application page and removes
    // when the LO navigates away). Sibling-mounting onto the persistent
    // subnav row was the old fallback — but it caused our button to
    // outlive Full App and show up on Premier Agent / Tasks / etc.
    // Same lifecycle as Copy from Stage and Pricing Exception now.
    const panel = document.getElementById(PANEL_ID);
    if (panel) return { kind: 'panel', el: panel };
    return null;
  }

  function removeButton() {
    const existing = document.getElementById(BUTTON_ID);
    if (existing) { try { existing.remove(); } catch (_) {} }
  }

  function makeButton() {
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.title = 'Generate the five Encompass ZG-Loan-Story sections from this file.\n\nBuilt by Justin Case. Karma appreciated \u{1F49B}';
    btn.textContent = '\u{1F4DD} Generate Loan Story for Encompass';
    btn.className = 'zhl-ls-btn';
    btn.addEventListener('click', function () {
      if (btn.classList.contains('zhl-ls-btn--disabled')) return;
      openModal();
    });
    return btn;
  }

  function syncButtonState(btn) {
    const ok = isHardPullDone();
    if (ok) {
      btn.classList.remove('zhl-ls-btn--disabled');
      btn.title = 'Generate the five Encompass ZG-Loan-Story sections from this file.\n\nBuilt by Justin Case. Karma appreciated \u{1F49B}';
    } else {
      btn.classList.add('zhl-ls-btn--disabled');
      btn.title = 'Available after a hard credit pull is on file.\n\nBuilt by Justin Case. Karma appreciated \u{1F49B}';
    }
  }

  function tryInject() {
    // Off Full App? Clean up any leftover button. Even though our
    // anchor (the Copy LOP file panel) usually unmounts when LOP
    // re-renders the subnav content, this guard catches the case
    // where our button got attached and the panel hasn't been torn
    // down yet — keeps us strictly on Full Application.
    if (!isFullAppPage()) { removeButton(); return; }
    // The Copy LOP file panel needs to be present to anchor next to;
    // also confirms we're actually on the Full App content (not just
    // a URL match against a still-loading page).
    const target = findInjectionTarget();
    if (!target) { removeButton(); return; }
    const existing = document.getElementById(BUTTON_ID);
    if (existing) {
      // If the existing button is no longer inside the current panel
      // (LOP may have re-mounted the panel), re-attach it.
      if (existing.parentElement !== target.el) {
        try { existing.remove(); } catch (_) {}
      } else {
        syncButtonState(existing);
        return;
      }
    }
    const btn = makeButton();
    target.el.appendChild(btn);
    syncButtonState(btn);
  }

  // SPA-safe polling — subnav re-renders on file/route changes.
  function init() {
    tryInject();
    setInterval(tryInject, 1000);
  }

  init();
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
